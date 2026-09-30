const EventEmitter = require('events')
const fs = require('fs/promises')
const {createReadStream} = require('fs')
const {createHash, randomUUID} = require('crypto')
const {join, basename, resolve, dirname} = require('path')
const argvsplit = require('argv-split')
const {KataGo, config, supports} = require('./katago')
const {validateSnapshot, fingerprint, policyIndex} = require('./position')
const {budgets, selectMoments, verifyMoment} = require('./review')
const {validateConfig, explain, referencePatterns} = require('./llm')
const {t} = require('./strings')
const {learnerProfile} = require('./learner')

async function hashModel(filename, signal) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(filename)) {
    signal.throwIfAborted()
    hash.update(chunk)
  }
  signal.throwIfAborted()
  return hash.digest('hex')
}

class TeachingService extends EventEmitter {
  constructor({
    directory,
    getEngines,
    fetch,
    clientFactory = (engine, filename, options) =>
      new KataGo(engine, filename, options),
  }) {
    super()
    Object.assign(this, {directory, getEngines, fetch, clientFactory})
    this.state = {
      phase: 'idle',
      running: false,
      cards: [],
      completed: 0,
      total: 0,
    }
    this.llm = null
  }
  status() {
    return {
      engines: this.getEngines().flatMap((engine, index) =>
        supports(engine) ? [{index, name: engine.name || 'KataGo'}] : [],
      ),
      llm: this.llm
        ? {endpoint: this.llm.endpoint, model: this.llm.model}
        : null,
    }
  }
  configure(input) {
    this.llm = validateConfig(input)
    return this.status()
  }
  update(change) {
    this.state = {...this.state, ...change}
    this.emit('change', this.state)
  }
  start(input) {
    if (this.job) throw new Error('already-running')
    validateSnapshot(input?.position)
    if (!Number.isInteger(input.engineIndex)) throw new Error('katago-required')
    const engine = this.getEngines()[input.engineIndex]
    if (!engine || !supports(engine)) throw new Error('katago-required')
    if (input.useLLM && !this.llm) throw new Error('invalid-llm-config')
    const budget = budgets[input.budget] || budgets.standard
    const job = {
      id: randomUUID(),
      controller: new AbortController(),
      position: structuredClone(input.position),
      engine: {...engine},
      budget,
      learner: learnerProfile(input.learnerRank),
      language: input.language || 'en',
      budgetName: input.budget in budgets ? input.budget : 'standard',
      llm: input.useLLM ? {...this.llm} : null,
    }
    this.job = job
    this.update({
      jobId: job.id,
      fingerprint: fingerprint(job.position),
      rootId: job.position.rootId,
      phase: 'preparing',
      engineIndex: input.engineIndex,
      budget: job.budgetName,
      learner: job.learner,
      running: true,
      cards: [],
      completed: 0,
      total: job.position.moves.length + 1,
      skipped: 0,
      error: null,
      llmFallback: false,
      reused: 0,
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
  async run(job) {
    await fs.mkdir(this.directory, {recursive: true})
    const filename = join(this.directory, 'analysis.cfg')
    await fs.writeFile(filename, config)
    const args = argvsplit(job.engine.args)
    const modelPath = resolve(
      dirname(job.engine.path),
      args[args.indexOf('-model') + 1],
    )
    const modelHash = await hashModel(modelPath, job.controller.signal)
    const humanIndex = args.indexOf('-human-model')
    const humanHash =
      humanIndex < 0
        ? null
        : await hashModel(
            resolve(dirname(job.engine.path), args[humanIndex + 1]),
            job.controller.signal,
          )
    const client = (job.client = this.clientFactory(job.engine, filename, {
      signal: job.controller.signal,
    }))
    const version = await client.request({action: 'query_version'})
    job.controller.signal.throwIfAborted()
    const identity = {
      name: job.engine.name || 'KataGo',
      version: String(version.version || 'unknown'),
      model: basename(modelPath),
      modelSha256: modelHash,
    }
    // Only the latest matching review is retained, within this window. SGF
    // graph values have no model/visit/PV provenance and never enter this cache.
    const cacheKey = JSON.stringify({
      position: fingerprint(job.position),
      path: job.engine.path,
      args: job.engine.args,
      version: identity.version,
      modelHash,
      humanHash,
      config,
      budget: job.budget,
    })
    if (this.cache?.key !== cacheKey)
      this.cache = {key: cacheKey, scan: [], queries: new Map()}
    const cache = this.cache
    const analyze = client.analyze.bind(client)
    client.analyze = async (position, turn, options) => {
      job.controller.signal.throwIfAborted()
      const key = createHash('sha256')
        .update(JSON.stringify({position, turn, options}))
        .digest('hex')
      if (cache.queries.has(key)) {
        const result = cache.queries.get(key)
        cache.queries.delete(key)
        cache.queries.set(key, result)
        this.update({reused: this.state.reused + 1})
        return structuredClone(result)
      }
      const result = await analyze(position, turn, options)
      job.controller.signal.throwIfAborted()
      cache.queries.set(key, structuredClone(result))
      // Bound memory even for unusually long verification lines.
      if (cache.queries.size > 2048)
        cache.queries.delete(cache.queries.keys().next().value)
      return result
    }
    const scan = cache.scan.slice()
    this.update({
      phase: 'scanning',
      completed: scan.length,
      reused: scan.length,
    })
    for (let turn = scan.length; turn <= job.position.moves.length; turn++) {
      const result = await client.analyze(job.position, turn, {
        visits: job.budget.scan,
        maxTime: 1,
        includePolicy: true,
      })
      if (
        turn < job.position.moves.length &&
        result.policy[policyIndex(job.position, job.position.moves[turn][1])] <
          0
      )
        throw new Error('illegal-variation')
      scan.push(result)
      cache.scan.push(structuredClone(result))
      this.update({completed: turn + 1})
    }
    const moments = selectMoments(job.position, scan, 5, job.learner)
    this.update({
      phase: 'verifying',
      completed: 0,
      total: moments.length,
      engine: identity,
    })
    for (const moment of moments) {
      let card
      try {
        card = await verifyMoment(
          client,
          job.position,
          moment,
          job.budget,
          job.language,
          job.learner,
        )
      } catch (error) {
        if (
          error.message !== 'illegal-variation' &&
          error.message !== 'invalid-analysis'
        )
          throw error
      }
      if (card) {
        card.engine = identity
        this.update({cards: [...this.state.cards, card]})
      } else this.update({skipped: this.state.skipped + 1})
      this.update({completed: this.state.completed + 1})
    }
    await client.close()
    if (job.controller.signal.aborted) return this.update({phase: 'canceled'})
    if (job.llm) {
      this.update({
        phase: 'explaining',
        completed: 0,
        total: this.state.cards.length,
      })
      for (const original of this.state.cards.slice()) {
        try {
          const paragraphs = await explain(original, job.llm, {
            fetch: this.fetch,
            signal: job.controller.signal,
            language: job.language,
          })
          this.update({
            cards: this.state.cards.map((card) =>
              card.id === original.id
                ? {
                    ...card,
                    paragraphs,
                    styleReferences: referencePatterns(original),
                    explanation: {source: 'llm', status: 'complete'},
                  }
                : card,
            ),
          })
        } catch (error) {
          if (job.controller.signal.aborted) throw error
          const reason = ['llm-invalid', 'llm-timeout'].includes(error.message)
            ? error.message
            : 'llm-connection'
          this.update({
            llmFallback: true,
            cards: this.state.cards.map((card) =>
              card.id === original.id
                ? {
                    ...card,
                    explanation: {source: 'local', status: 'fallback', reason},
                  }
                : card,
            ),
          })
        }
        this.update({completed: this.state.completed + 1})
      }
    }
    this.update({phase: 'complete'})
  }
}
module.exports = {
  createService: (options) => new TeachingService(options),
  TeachingService,
  t,
}
