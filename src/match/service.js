const EventEmitter = require('events')
const fs = require('fs/promises')
const os = require('os')
const {randomUUID} = require('crypto')
const {join, basename, resolve, dirname} = require('path')
const argvsplit = require('argv-split')
const {KataGo, supports} = require('../teaching/katago')
const {
  validateSnapshot,
  fingerprint,
  policyIndex,
} = require('../teaching/position')
const {budgets, compact, matchGraph} = require('./stats')
const {ladder, bandFor} = require('./ranks')

// Many positions run at once with one search thread each: KataGo batches
// their network evaluations, single-threaded searches are stronger per visit,
// and with fixed symmetry and no root noise every run gives identical results,
// which a detection report needs.
const concurrency = 16
const config = [
  'reportAnalysisWinratesAs = BLACK',
  `numAnalysisThreads = ${concurrency}`,
  'numSearchThreadsPerAnalysisThread = 1',
  'nnRandomize = false',
  'wideRootNoise = 0.0',
  'nnCacheSizePowerOfTwo = 20',
  'nnMutexPoolSizePowerOfTwo = 16',
  `nnMaxBatchSize = ${concurrency}`,
  'maxVisits = 400',
  'logToStderr = true',
  'logAllRequests = false',
  'logAllResponses = false',
  'analysisPVLen = 2',
  '',
].join('\n')

const humanPattern = /human.*\.bin\.gz$/i

function modelPathOf(engine, flag) {
  const args = argvsplit(engine.args || '')
  const index = args.indexOf(flag)
  return index >= 0 && args[index + 1]
    ? resolve(dirname(engine.path), args[index + 1])
    : null
}

class MatchService extends EventEmitter {
  constructor({
    directory,
    getEngines,
    getHumanModel = () => '',
    searchDirectories = [join(os.homedir(), '.katago')],
    clientFactory = (engine, filename, options) =>
      new KataGo(engine, filename, options),
    throttle = 100,
  }) {
    super()
    Object.assign(this, {
      directory,
      getEngines,
      getHumanModel,
      searchDirectories,
      clientFactory,
      throttle,
    })
    this.state = {phase: 'idle', running: false, completed: 0, total: 0}
    this.cache = null
  }

  // The human SL model: from the engine's own -human-model argument, the
  // configured path, or a b18c384nbt-humanv0.bin.gz-style file next to the
  // main model or in ~/.katago.
  async humanModelFor(engine) {
    const own = modelPathOf(engine, '-human-model')
    if (own) return own
    const configured = this.getHumanModel()
    if (configured && (await fs.stat(configured).catch(() => null))?.isFile())
      return configured
    const model = modelPathOf(engine, '-model')
    for (const directory of [
      ...(model ? [dirname(model)] : []),
      ...this.searchDirectories,
    ]) {
      const name = (await fs.readdir(directory).catch(() => []))
        .sort()
        .find((name) => humanPattern.test(name))
      if (name) return join(directory, name)
    }
    return null
  }

  async status() {
    const engines = []
    for (const [index, engine] of this.getEngines().entries()) {
      if (!supports(engine)) continue
      const human = await this.humanModelFor(engine)
      engines.push({
        index,
        name: engine.name || 'KataGo',
        humanModel: human ? basename(human) : null,
      })
    }
    return {engines}
  }

  update(change, {immediate = true} = {}) {
    this.state = {...this.state, ...change}
    // Progress is coalesced; phase changes are delivered at once.
    if (!immediate) {
      this.timer ??= setTimeout(() => {
        this.timer = null
        this.emit('change', this.state)
      }, this.throttle)
      return
    }
    clearTimeout(this.timer)
    this.timer = null
    this.emit('change', this.state)
  }

  start(input) {
    if (this.job) throw new Error('already-running')
    validateSnapshot(input?.position)
    if (!Number.isInteger(input.engineIndex)) throw new Error('katago-required')
    const engine = this.getEngines()[input.engineIndex]
    if (!engine || !supports(engine)) throw new Error('katago-required')
    const ranks = {B: input.ranks?.B ?? null, W: input.ranks?.W ?? null}
    if (Object.values(ranks).some((r) => r != null && !ladder.includes(r)))
      throw new Error('invalid-rank')
    const margin = Math.max(0, Math.min(9, Math.floor(input.margin ?? 3) || 0))
    const bands = {B: bandFor(ranks.B, margin), W: bandFor(ranks.W, margin)}
    const budgetName = input.budget in budgets ? input.budget : 'standard'
    const job = {
      id: randomUUID(),
      controller: new AbortController(),
      position: structuredClone(input.position),
      engine: {...engine},
      budget: budgets[budgetName],
      bands,
    }
    const total = job.position.moves.length + 1
    this.job = job
    this.update({
      jobId: job.id,
      fingerprint: fingerprint(job.position),
      rootId: job.position.rootId,
      phase: 'preparing',
      running: true,
      engineIndex: input.engineIndex,
      budget: budgetName,
      visits: job.budget.visits,
      ranks,
      margin,
      bands,
      humanModel: null,
      completed: 0,
      total,
      reused: 0,
      results: Array(total).fill(null),
      graph: matchGraph(Array(total).fill(null)),
      engine: null,
      error: null,
    })
    job.promise = this.run(job)
      .catch((error) => {
        this.update({
          phase: job.controller.signal.aborted ? 'canceled' : 'failed',
          error: job.controller.signal.aborted ? null : error.message,
        })
      })
      .finally(async () => {
        await job.client?.close()
        this.job = null
        this.update({running: false})
      })
    return {jobId: job.id}
  }

  async cancel() {
    const job = this.job
    if (!job) return
    job.controller.abort()
    await job.promise
  }

  // One full search per position, then a one-visit query per baseline rank
  // for the human network's policy (the main evaluation comes from KataGo's
  // cache). Both are cached separately, so changing a player's rank only
  // repeats the cheap human queries.
  async analyzeTurn(client, job, turn, cache) {
    const {position, budget, bands, human} = job
    const move = position.moves[turn]
    let main = cache.results[turn]
    if (!main) {
      main = compact(
        await client.analyze(position, turn, {
          visits: budget.visits,
          maxTime: budget.maxTime,
        }),
        move?.[1],
      )
      cache.results[turn] = main
    }
    // The final position only supplies the evaluation after the last move.
    const profiles = human && move ? bands[move[0]] : []
    if (!profiles.length) return main
    const moves = [...new Set([...main.candidates.map((c) => c.move), move[1]])]
    const size = position.boardXSize * position.boardYSize + 1
    const probabilities = {}
    for (const profile of profiles) {
      const key = `${turn}:${profile}`
      if (!cache.human.has(key)) {
        const {humanPolicy: policy} = await client.analyze(position, turn, {
          visits: 1,
          maxTime: budget.maxTime,
          includePolicy: true,
          overrides: {humanSLProfile: profile},
        })
        if (!Array.isArray(policy) || policy.length !== size)
          throw new Error('human-model-failed')
        cache.human.set(
          key,
          Object.fromEntries(
            moves.map((m) => [
              m,
              Math.max(0, policy[policyIndex(position, m)] ?? 0),
            ]),
          ),
        )
      }
      probabilities[profile] = cache.human.get(key)
    }
    return {...main, human: probabilities}
  }

  done(job, cache, turn) {
    const move = job.position.moves[turn]
    if (!cache.results[turn]) return false
    if (!job.human || !move) return true
    return job.bands[move[0]].every((p) => cache.human.has(`${turn}:${p}`))
  }

  async run(job) {
    const {signal} = job.controller
    await fs.mkdir(this.directory, {recursive: true})
    const filename = join(this.directory, 'match.cfg')
    await fs.writeFile(filename, config)
    const modelPath = modelPathOf(job.engine, '-model')
    const model = await fs.stat(modelPath ?? '').catch(() => {
      throw new Error('katago-required')
    })
    const humanPath = await this.humanModelFor(job.engine)
    const human = humanPath ? await fs.stat(humanPath).catch(() => null) : null
    signal.throwIfAborted()
    job.human = !!human
    const engine =
      human && !modelPathOf(job.engine, '-human-model')
        ? {
            ...job.engine,
            args: `${job.engine.args} -human-model ${JSON.stringify(humanPath)}`,
          }
        : job.engine
    const client = (job.client = this.clientFactory(engine, filename, {
      signal,
      timeout: Math.max(60000, job.budget.maxTime * 3000),
    }))
    const version = await client.request({action: 'query_version'})
    signal.throwIfAborted()
    const identity = {
      name: job.engine.name || 'KataGo',
      version: String(version.version || 'unknown'),
      model: basename(modelPath),
      humanModel: human ? basename(humanPath) : null,
    }
    // Completed positions are kept for one game per window, so stopping and
    // starting again with the same engine, model and budget resumes the scan.
    const key = JSON.stringify({
      position: fingerprint(job.position),
      path: job.engine.path,
      args: job.engine.args,
      version: identity.version,
      model: [modelPath, model.size, model.mtimeMs],
      budget: job.budget,
      config,
    })
    const humanKey = human ? [humanPath, human.size, human.mtimeMs] : null
    if (this.cache?.key !== key)
      this.cache = {
        key,
        results: Array(this.state.total).fill(null),
        human: new Map(),
      }
    if (JSON.stringify(this.cache.humanKey) !== JSON.stringify(humanKey)) {
      this.cache.human = new Map()
      this.cache.humanKey = humanKey
    }
    const cache = this.cache
    const total = this.state.total
    const results = Array(total).fill(null)
    const queue = []
    for (let turn = 0; turn < total; turn++) {
      if (this.done(job, cache, turn))
        results[turn] = await this.analyzeTurn(client, job, turn, cache)
      else queue.push(turn)
    }
    const reused = total - queue.length
    this.update({
      phase: 'scanning',
      engine: identity,
      humanModel: identity.humanModel,
      completed: reused,
      reused,
      // Lets the panel estimate the remaining time from fresh positions only.
      startedAt: Date.now(),
      fresh: 0,
      results: results.slice(),
      graph: matchGraph(results),
    })
    let next = 0,
      completed = reused,
      failed = false
    const worker = async () => {
      while (next < queue.length && !failed) {
        const turn = queue[next++]
        let result
        try {
          result = await this.analyzeTurn(client, job, turn, cache)
        } catch (error) {
          failed = true
          throw error
        }
        signal.throwIfAborted()
        if (failed) return
        results[turn] = result
        this.update(
          {
            completed: ++completed,
            fresh: completed - reused,
            results: results.slice(),
            graph: matchGraph(results),
          },
          {immediate: false},
        )
      }
    }
    await Promise.all(
      Array.from({length: Math.min(concurrency, queue.length)}, worker),
    )
    await client.close()
    this.update({phase: 'complete'})
  }
}

module.exports = {
  createService: (options) => new MatchService(options),
  MatchService,
  config,
}
