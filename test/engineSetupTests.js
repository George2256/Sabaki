import assert from 'assert'
import {
  mkdtemp,
  rm,
  readFile,
  writeFile,
  mkdir,
  access,
  readdir,
  chmod,
  symlink,
  realpath,
} from 'fs/promises'
import {tmpdir} from 'os'
import {join} from 'path'
import {createHash} from 'crypto'
import {createServer} from 'http'
import argvsplit from 'argv-split'
import {
  createService,
  downloadPackage,
  supported,
  validateEngine,
} from '../src/engine-setup.js'
import {manifest} from '../src/engine-setup-manifest.js'

const bytes = Buffer.from('verified package')
const pkg = {
  name: 'katago',
  root: 'katago/test',
  filename: 'katago.tar.gz',
  sha256: createHash('sha256').update(bytes).digest('hex'),
  maxBytes: 100,
}
const platform = {platform: 'darwin', arch: 'arm64', release: '24.0.0'}

describe('automatic engine setup', function () {
  this.timeout(10000)
  let directory, server, baseUrl, requests
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'sabaki-setup-'))
    requests = []
    server = createServer((req, res) => {
      requests.push(req.url)
      if (req.url === '/stall') return
      if (req.url === '/bad') return res.end('bad checksum')
      res.setHeader('Content-Length', bytes.length)
      res.end(bytes)
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    baseUrl = `http://127.0.0.1:${server.address().port}`
  })
  afterEach(async () => {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
    await rm(directory, {recursive: true, force: true})
  })
  const mirror = (url) => ({name: 'test', url})

  it('rejects bad checksums, falls back and reuses only a verified cache', async () => {
    const filename = join(directory, pkg.filename)
    const options = {
      fetch,
      signal: new AbortController().signal,
      mirrors: [mirror(baseUrl + '/bad'), mirror(baseUrl + '/good')],
    }
    await downloadPackage(pkg, filename, options)
    assert.deepStrictEqual(await readFile(filename), bytes)
    assert.deepStrictEqual(requests, ['/bad', '/good'])
    await downloadPackage(pkg, filename, options)
    assert.strictEqual(requests.length, 2)
    await writeFile(filename, 'corrupt cache')
    await downloadPackage(pkg, filename, options)
    assert.strictEqual(requests.length, 4)
    await assert.rejects(access(filename + '.part'))
  })

  it('times out a silent source and tries the next one', async () => {
    await downloadPackage(pkg, join(directory, pkg.filename), {
      fetch,
      signal: new AbortController().signal,
      timeout: 40,
      mirrors: [mirror(baseUrl + '/stall'), mirror(baseUrl + '/good')],
    })
    assert.deepStrictEqual(requests, ['/stall', '/good'])
  })

  it('cancels without contacting the next source or leaving a partial file', async () => {
    const controller = new AbortController()
    const promise = downloadPackage(pkg, join(directory, pkg.filename), {
      fetch,
      signal: controller.signal,
      mirrors: [mirror(baseUrl + '/stall'), mirror(baseUrl + '/good')],
    })
    setTimeout(() => controller.abort(), 40)
    await assert.rejects(promise, {name: 'AbortError'})
    assert(!requests.includes('/good'))
    await assert.rejects(access(join(directory, pkg.filename + '.part')))
  })

  it('refuses oversized downloads before installing them', async () => {
    await assert.rejects(
      downloadPackage({...pkg, maxBytes: 1}, join(directory, pkg.filename), {
        fetch,
        signal: new AbortController().signal,
        mirrors: [mirror(baseUrl + '/good')],
      }),
      /Unable to download/,
    )
    await assert.rejects(access(join(directory, pkg.filename)))
  })

  function service(options = {}) {
    return createService({
      directory,
      fetch,
      platform,
      localPaths: [],
      packages: [pkg],
      mirrors: () => [mirror(baseUrl + '/good')],
      extract: async (p, archive, staging) => {
        const root = join(staging, p.root)
        await mkdir(join(root, 'bin'), {recursive: true})
        await mkdir(join(root, 'share/katago'), {recursive: true})
        await writeFile(join(root, 'bin/katago'), 'fake binary')
        await writeFile(join(root, 'share/katago', manifest.model), 'model')
        await writeFile(join(root, 'LICENSE'), 'upstream license')
      },
      validate: async () => {},
      ...options,
    })
  }

  it('shares concurrent installs, registers only after validation and survives restart', async () => {
    let validations = 0,
      registrations = 0
    const setup = service({
      validate: async (engine) => {
        await access(engine.path)
        assert.strictEqual(registrations, 0)
        validations++
      },
      register: () => {
        registrations++
      },
    })
    const first = setup.install()
    assert.strictEqual(setup.install(), first)
    const engine = await first
    assert.strictEqual(validations, 1)
    assert.strictEqual(registrations, 1)
    assert.strictEqual((await service().status()).phase, 'ready')
    assert.deepStrictEqual((await service().status()).engine, engine)
    assert.strictEqual(
      await readFile(
        join(directory, manifest.id, 'licenses/katago-LICENSE'),
        'utf8',
      ),
      'upstream license',
    )
    assert(
      !(await readdir(directory)).some((name) => name.startsWith('.setup-')),
    )
  })

  it('does not register a failed runtime, preserves the old install and can retry', async () => {
    const old = join(directory, manifest.id)
    await mkdir(old)
    await writeFile(join(old, 'old'), 'working installation')
    let registrations = 0
    const setup = service({
      validate: async () => {
        throw new Error('bad model')
      },
      register: () => {
        registrations++
      },
    })
    await assert.rejects(setup.install(), /bad model/)
    assert.strictEqual(setup.state.phase, 'error')
    assert.strictEqual(registrations, 0)
    assert.strictEqual(
      await readFile(join(old, 'old'), 'utf8'),
      'working installation',
    )
    setup.validate = async () => {}
    await setup.install()
    assert.strictEqual(registrations, 1)
    assert.strictEqual(setup.state.phase, 'ready')
    assert.strictEqual(requests.length, 1, 'retry reuses the verified package')
  })

  it('does not register if canceled during validation', async () => {
    let checking,
      registrations = 0
    const started = new Promise((resolve) => {
      checking = resolve
    })
    const setup = service({
      validate: async (_, {signal}) => {
        checking()
        await new Promise((_, reject) =>
          signal.addEventListener(
            'abort',
            () =>
              reject(
                Object.assign(new Error('Canceled'), {name: 'AbortError'}),
              ),
            {once: true},
          ),
        )
      },
      register: () => {
        registrations++
      },
    })
    const promise = setup.install()
    await started
    const canceled = setup.cancel()
    await assert.rejects(promise, {name: 'AbortError'})
    await canceled
    assert.strictEqual(registrations, 0)
    assert.strictEqual(setup.state.phase, 'canceled')
    assert(
      !(await readdir(directory)).some((name) => name.startsWith('.setup-')),
    )
  })

  it('only enables the bundled runtime on supported Macs', async () => {
    assert(supported(platform))
    assert(supported({...platform, release: '25.0.0'}))
    for (const variant of [
      {arch: 'x64'},
      {release: '23.0.0'},
      {platform: 'win32'},
    ])
      assert(!supported({...platform, ...variant}))
    await assert.rejects(
      service({platform: {...platform, arch: 'x64'}}).install(),
      /Apple silicon/,
    )
    assert.strictEqual(requests.length, 0)
  })

  async function localInstallation() {
    const root = join(directory, '本地 KataGo')
    const executable = join(root, 'bin', 'katago')
    const model = join(root, 'share/katago', manifest.model)
    await mkdir(join(root, 'bin'), {recursive: true})
    await mkdir(join(root, 'share/katago'), {recursive: true})
    await writeFile(executable, 'local binary')
    await chmod(executable, 0o755)
    await writeFile(model, 'local model')
    return {executable, model}
  }

  it('configures a local installation without downloads, even on an unsupported bundled platform', async () => {
    const {executable, model} = await localInstallation()
    let registered,
      validations = 0
    const setup = service({
      localPaths: [executable],
      platform: {...platform, arch: 'x64'},
      validate: async (engine) => {
        validations++
        assert.strictEqual(engine.path, executable)
        assert.deepStrictEqual(argvsplit(engine.args), [
          'gtp',
          '-model',
          await realpath(model),
          '-config',
          join(directory, 'local-gtp.cfg'),
        ])
        assert.strictEqual(registered, undefined)
      },
      register: (engine) => {
        registered = engine
      },
    })
    const status = await setup.status()
    assert.strictEqual(status.phase, 'local')
    assert.strictEqual(status.supported, false)
    assert.strictEqual(registered, undefined)
    const engine = await setup.install()
    assert.deepStrictEqual(registered, engine)
    assert.strictEqual(validations, 1)
    assert.strictEqual(setup.state.phase, 'ready')
    assert.strictEqual(requests.length, 0)
    assert.strictEqual(await readFile(executable, 'utf8'), 'local binary')
  })

  it('discovers local symlink installations when install is called directly and preserves its config', async () => {
    const {executable} = await localInstallation()
    const alias = join(directory, 'katago')
    await symlink(executable, alias)
    await writeFile(join(directory, 'local-gtp.cfg'), 'maxVisits = 1234\n')
    const setup = service({localPaths: [alias]})
    const engine = await setup.install()
    assert.strictEqual(engine.path, alias)
    assert.strictEqual(requests.length, 0)
    assert.strictEqual(
      await readFile(join(directory, 'local-gtp.cfg'), 'utf8'),
      'maxVisits = 1234\n',
    )
  })

  it('keeps failed local validation retrying the local engine without downloads or registration', async () => {
    const {executable} = await localInstallation()
    let registrations = 0
    const setup = service({
      localPaths: [executable],
      validate: async () => {
        throw new Error('bad local model')
      },
      register: () => {
        registrations++
      },
    })
    await assert.rejects(setup.install(), /bad local model/)
    await assert.rejects(setup.install(), /bad local model/)
    assert.strictEqual(requests.length, 0)
    assert.strictEqual(registrations, 0)
  })

  it('reuses an installed automatic runtime even for a direct install request', async () => {
    await service().install()
    assert.strictEqual(requests.length, 1)
    await service().install()
    assert.strictEqual(requests.length, 1)
  })

  it('round-trips engine arguments with Chinese, spaces, quotes and backslashes', () => {
    const runtime = join(directory, '棋谱 "quote" \\folder')
    const engine = service().engine(runtime)
    assert.deepStrictEqual(argvsplit(engine.args), [
      'gtp',
      '-model',
      join(runtime, 'model.bin.gz'),
      '-config',
      join(runtime, 'gtp.cfg'),
    ])
  })

  it('reports process failures and kills a silent validation process on timeout', async () => {
    const filename = join(directory, 'silent.js')
    await writeFile(filename, 'setInterval(() => {}, 1000)')
    await assert.rejects(
      validateEngine(
        {path: process.execPath, args: JSON.stringify(filename)},
        {timeout: 40},
      ),
      /could not start/,
    )
    await assert.rejects(
      validateEngine(
        {path: join(directory, 'missing'), args: ''},
        {timeout: 40},
      ),
      /could not start/,
    )
  })
})
