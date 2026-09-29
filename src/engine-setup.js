const EventEmitter = require('events')
const fs = require('fs/promises')
const {createReadStream} = require('fs')
const {createHash} = require('crypto')
const {spawn, execFile} = require('child_process')
const {promisify} = require('util')
const {join, dirname, basename, sep} = require('path')
const os = require('os')
const argvsplit = require('argv-split')
const {manifest, sources} = require('./engine-setup-manifest')

const exec = promisify(execFile)
const abortError = () =>
  Object.assign(new Error('Canceled'), {name: 'AbortError'})
const checkAbort = (signal) => {
  if (signal.aborted) throw abortError()
}

async function digest(filename) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(filename)) hash.update(chunk)
  return hash.digest('hex')
}

// Files are only promoted after the pinned digest matches. Interrupted or
// corrupt downloads never become executables or replace the verified cache.
async function downloadPackage(
  pkg,
  filename,
  {fetch, signal, progress = () => {}, mirrors = sources(pkg), timeout = 30000},
) {
  checkAbort(signal)
  try {
    if ((await digest(filename)) === pkg.sha256) return filename
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  await fs.mkdir(dirname(filename), {recursive: true})
  const part = `${filename}.part`
  for (const source of mirrors) {
    checkAbort(signal)
    const controller = new AbortController()
    const cancel = () => controller.abort()
    signal.addEventListener('abort', cancel, {once: true})
    let timer, file
    const resetTimeout = () => {
      clearTimeout(timer)
      timer = setTimeout(() => controller.abort(), timeout)
    }
    try {
      progress({source: source.name, received: 0, total: null})
      resetTimeout()
      const response = await fetch(source.url, {
        signal: controller.signal,
        headers: source.headers,
      })
      if (!response.ok || !response.body) throw new Error('Download failed')
      const total = Number(response.headers.get('content-length')) || null
      if (total > pkg.maxBytes) throw new Error('Download too large')
      file = await fs.open(part, 'w')
      const hash = createHash('sha256')
      let received = 0
      for await (const chunk of response.body) {
        checkAbort(signal)
        resetTimeout()
        received += chunk.length
        if (received > pkg.maxBytes) throw new Error('Download too large')
        hash.update(chunk)
        await file.writeFile(chunk)
        progress({source: source.name, received, total})
      }
      checkAbort(signal)
      if (hash.digest('hex') !== pkg.sha256)
        throw new Error('Checksum mismatch')
      await file.close()
      file = null
      await fs.rename(part, filename)
      return filename
    } catch (error) {
      if (signal.aborted) throw abortError()
      // Disk errors will not be fixed by changing the download source.
      if (['ENOSPC', 'EACCES', 'EROFS'].includes(error.code)) throw error
    } finally {
      clearTimeout(timer)
      controller.abort()
      signal.removeEventListener('abort', cancel)
      await file?.close()
      await fs.rm(part, {force: true})
    }
  }
  throw new Error('Unable to download. Please check your connection and retry.')
}

function supported({
  platform = process.platform,
  arch = os.machine(),
  release = os.release(),
} = {}) {
  return (
    platform === 'darwin' &&
    arch === 'arm64' &&
    Number(release.split('.')[0]) >= 24
  )
}

function makeConfig(threads) {
  return [
    'rules = tromp-taylor',
    'logDir = logs',
    'logAllGTPCommunication = false',
    'logSearchInfo = false',
    'logToStderr = true',
    `numSearchThreads = ${threads}`,
    'maxVisits = 500',
    'maxTime = 1.0',
    'nnCacheSizePowerOfTwo = 18',
    'nnMutexPoolSizePowerOfTwo = 16',
    'nnMaxBatchSize = 16',
    'conservativePass = true',
    '',
  ].join('\n')
}

// Set the library directory inside the launcher, because macOS strips DYLD_*
// variables inherited by system shell processes. No Homebrew installation,
// administrator access, shell profile edits or developer tools are required.
function makeLauncher() {
  return (
    '#!/bin/sh\n' +
    'runtime_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd) || exit 1\n' +
    'export DYLD_LIBRARY_PATH="$runtime_dir/lib"\n' +
    'exec "$runtime_dir/bin/katago" "$@"\n'
  )
}

async function extractPackage(pkg, archive, staging, {signal}) {
  checkAbort(signal)
  const {stdout} = await exec('/usr/bin/tar', ['-tzf', archive], {
    signal,
    timeout: 60000,
    maxBuffer: 4 * 1024 * 1024,
  })
  const entries = stdout.trim().split('\n')
  if (
    entries.some(
      (entry) =>
        !entry.startsWith(`${pkg.root}/`) || entry.split('/').includes('..'),
    )
  )
    throw new Error('Invalid package')
  await exec('/usr/bin/tar', ['-xzf', archive, '-C', staging], {
    signal,
    timeout: 120000,
  })
}

async function collectLibraries(root, runtime) {
  const lib = join(root, 'lib')
  let entries
  try {
    entries = await fs.readdir(lib)
  } catch (error) {
    if (error.code === 'ENOENT') return
    throw error
  }
  const realLib = await fs.realpath(lib)
  for (const name of entries.filter((name) => name.endsWith('.dylib'))) {
    const source = await fs.realpath(join(lib, name))
    if (!source.startsWith(realLib + sep)) throw new Error('Invalid package')
    // Copy aliases too: dylib load commands refer to libzip.5.dylib etc.
    await fs.copyFile(source, join(runtime, 'lib', name))
  }
}

// Verify an actual analysis sample, not just `katago version`: a missing
// model, unavailable Metal device or invalid config must fail before setup
// writes an engine into the user's settings.
function validateEngine(engine, {signal, timeout = 180000} = {}) {
  return new Promise((resolvePromise, reject) => {
    if (signal?.aborted) return reject(abortError())
    let child,
      timer,
      settled = false,
      output = '',
      stderr = ''
    const cancel = () => finish(abortError())
    const finish = (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', cancel)
      child?.kill('SIGKILL')
      if (error) {
        error.detail = stderr.slice(-4000)
        reject(error)
      } else resolvePromise()
    }
    try {
      child = spawn(engine.path, argvsplit(engine.args), {
        cwd: dirname(engine.path),
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    } catch (error) {
      finish(error)
      return
    }
    signal?.addEventListener('abort', cancel, {once: true})
    timer = setTimeout(
      () => finish(new Error('The engine could not start. Please retry.')),
      timeout,
    )
    child.on('error', () =>
      finish(new Error('The engine could not start. Please retry.')),
    )
    child.on('close', () =>
      finish(new Error('The engine could not start. Please retry.')),
    )
    child.stderr.on('data', (data) => {
      stderr = (stderr + data).slice(-4000)
    })
    child.stdin.on('error', () => {})
    child.stdout.on('data', (data) => {
      output = (output + data).slice(-65536)
      if (/(?:^|\n)\?\d*/.test(output)) {
        finish(new Error('The engine could not start. Please retry.'))
      } else if (
        /\binfo move \S+ visits \d+.*?\bwinrate (?:0(?:\.\d+)?|1(?:\.0+)?)(?:\s|$)/.test(
          output,
        )
      ) {
        finish()
      }
    })
    child.stdin.write(
      '1 protocol_version\n2 boardsize 19\n3 clear_board\n4 komi 7.5\n5 kata-analyze B 10\n',
    )
  })
}

class EngineSetup extends EventEmitter {
  constructor({
    directory,
    fetch,
    register = () => {},
    platform,
    extract = extractPackage,
    validate = validateEngine,
    packages = manifest.packages,
    mirrors = sources,
  } = {}) {
    super()
    this.directory = directory
    this.fetch = fetch
    this.register = register
    this.extract = extract
    this.validate = validate
    this.packages = packages
    this.mirrors = mirrors
    this.compatible = supported(platform)
    this.state = {phase: 'idle', supported: this.compatible, engine: null}
    this.job = null
  }

  update(patch) {
    this.state = {...this.state, ...patch}
    this.emit('change', this.state)
  }

  async status() {
    if (this.job || this.state.phase !== 'idle') return this.state
    try {
      const runtime = join(this.directory, manifest.id)
      const installed = JSON.parse(
        await fs.readFile(join(runtime, 'installed.json'), 'utf8'),
      )
      if (installed.id !== manifest.id) return this.state
      const engine = this.engine(runtime)
      for (const filename of [
        engine.path,
        join(runtime, 'bin/katago'),
        join(runtime, 'model.bin.gz'),
        join(runtime, 'gtp.cfg'),
      ])
        await fs.access(filename)
      this.update({phase: 'ready', engine})
    } catch (error) {
      if (error.code !== 'ENOENT') this.emit('diagnostic', error)
    }
    return this.state
  }

  engine(runtime) {
    // argv-split.join does not escape backslashes. JSON strings round-trip
    // through its double-quote parser, including spaces and quotes in paths.
    return {
      name: 'KataGo (Automatic)',
      path: join(runtime, 'katago'),
      args: [
        'gtp',
        '-model',
        join(runtime, 'model.bin.gz'),
        '-config',
        join(runtime, 'gtp.cfg'),
      ]
        .map((arg) => JSON.stringify(arg))
        .join(' '),
    }
  }

  install() {
    if (this.job) return this.job.promise
    if (!this.compatible)
      return Promise.reject(
        new Error(
          'Automatic setup supports Apple silicon Macs with macOS 15 or later.',
        ),
      )
    const job = {controller: new AbortController()}
    this.job = job
    this.update({
      phase: 'preparing',
      error: null,
      engine: null,
      received: 0,
      total: null,
    })
    job.promise = this.run(job.controller.signal)
      .catch((error) => {
        this.emit('diagnostic', error)
        this.update({
          phase: job.controller.signal.aborted ? 'canceled' : 'error',
          error: job.controller.signal.aborted
            ? null
            : error.code === 'ENOSPC'
              ? 'Not enough disk space. Free some space and retry.'
              : error.message.startsWith('Unable to download')
                ? error.message
                : 'The engine could not start. Please retry.',
        })
        throw error
      })
      .finally(() => {
        this.job = null
      })
    return job.promise
  }

  cancel() {
    this.job?.controller.abort()
    return this.job?.promise.catch(() => {}) || Promise.resolve()
  }

  async run(signal) {
    await fs.mkdir(this.directory, {recursive: true})
    const staging = await fs.mkdtemp(join(this.directory, '.setup-'))
    const runtime = join(staging, 'runtime')
    const destination = join(this.directory, manifest.id)
    try {
      await fs.mkdir(join(runtime, 'bin'), {recursive: true})
      await fs.mkdir(join(runtime, 'lib'), {recursive: true})
      await fs.mkdir(join(runtime, 'licenses'), {recursive: true})
      for (let i = 0; i < this.packages.length; i++) {
        const pkg = this.packages[i]
        const filename = join(this.directory, 'downloads', pkg.filename)
        let lastUpdate = 0
        this.update({
          phase: 'downloading',
          package: i + 1,
          packages: this.packages.length,
          received: 0,
          total: null,
        })
        await downloadPackage(pkg, filename, {
          fetch: this.fetch,
          signal,
          mirrors: this.mirrors(pkg),
          progress: (data) => {
            if (
              Date.now() - lastUpdate < 200 &&
              data.received !== 0 &&
              data.received !== data.total
            )
              return
            lastUpdate = Date.now()
            this.update(data)
          },
        })
        this.update({phase: 'verifying'})
        await this.extract(pkg, filename, staging, {signal})
        const root = join(staging, pkg.root)
        await collectLibraries(root, runtime)
        // Keep the original upstream licenses alongside the installed files.
        for (const name of await fs.readdir(root)) {
          if (/^(LICENSE|COPYING|NOTICE|AUTHORS)/i.test(name)) {
            await fs.cp(
              join(root, name),
              join(runtime, 'licenses', `${pkg.name}-${name}`),
              {recursive: true},
            )
          }
        }
        if (pkg.name === 'katago') {
          await fs.copyFile(
            join(root, 'bin/katago'),
            join(runtime, 'bin/katago'),
          )
          await fs.copyFile(
            join(root, 'share/katago', manifest.model),
            join(runtime, 'model.bin.gz'),
          )
        }
        await fs.rm(root, {recursive: true, force: true})
      }
      checkAbort(signal)
      await fs.chmod(join(runtime, 'bin/katago'), 0o755)
      await fs.writeFile(join(runtime, 'katago'), makeLauncher(), {mode: 0o755})
      await fs.mkdir(join(runtime, 'logs'), {recursive: true})
      const threads = Math.max(1, Math.min(4, Math.floor(os.cpus().length / 2)))
      await fs.writeFile(join(runtime, 'gtp.cfg'), makeConfig(threads))
      this.update({phase: 'checking'})
      await this.validate(this.engine(runtime), {signal})
      checkAbort(signal)
      await fs.writeFile(
        join(runtime, 'installed.json'),
        JSON.stringify({id: manifest.id, version: manifest.version}),
      )
      // Promote a validated runtime atomically, retaining the previous copy
      // until the rename succeeds. This also repairs a damaged installation.
      const backup = join(this.directory, `.previous-${basename(staging)}`)
      let hadPrevious = false
      try {
        await fs.rename(destination, backup)
        hadPrevious = true
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
      }
      try {
        await fs.rename(runtime, destination)
      } catch (error) {
        if (hadPrevious) await fs.rename(backup, destination)
        throw error
      }
      if (hadPrevious) await fs.rm(backup, {recursive: true, force: true})
      checkAbort(signal)
      const engine = this.engine(destination)
      await this.register(engine)
      this.update({phase: 'ready', engine, received: null, total: null})
      return engine
    } finally {
      await fs.rm(staging, {recursive: true, force: true})
    }
  }
}

exports.createService = (options) => new EngineSetup(options)
exports.downloadPackage = downloadPackage
exports.supported = supported
exports.validateEngine = validateEngine
exports.makeLauncher = makeLauncher
exports.makeConfig = makeConfig
