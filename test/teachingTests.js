import assert from 'assert'
import {mkdtemp, writeFile, rm} from 'fs/promises'
import {join, resolve} from 'path'
import {tmpdir} from 'os'
import sgf from '@sabaki/sgf'
import * as gametree from '../src/modules/gametree.js'
import {
  snapshot,
  fingerprint,
  validateSnapshot,
  replay,
} from '../src/teaching/position.js'
import {KataGo, config, profile} from '../src/teaching/katago.js'
import {losses, verifyMoment, budgets} from '../src/teaching/review.js'
import {
  validateConfig,
  validateExplanation,
  explain,
} from '../src/teaching/llm.js'
import {createService} from '../src/teaching/service.js'

const source = '(;SZ[9]KM[7.5]RU[Chinese]C[keep this];B[ai];W[cc];B[gg];W[])'
function position(content = source) {
  const tree = gametree.new({root: sgf.parse(content)[0]})
  return {tree, value: snapshot(tree, {})}
}
describe('teaching evidence and process boundaries', function () {
  this.timeout(10000)
  let directory, engine
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'sabaki-teaching-'))
    const model = join(directory, 'model.bin')
    await writeFile(model, 'test model identity')
    await writeFile(join(directory, 'analysis.cfg'), config)
    engine = {
      name: 'KataGo test',
      path: process.execPath,
      args: `"${resolve('test/engines/teachingEngine.js')}" gtp -model "${model}"`,
    }
  })
  afterEach(async () => {
    await rm(directory, {recursive: true, force: true})
  })
  it('captures the selected SGF branch, pass and rules without private comments', () => {
    const {tree, value} = position()
    validateSnapshot(value)
    assert.equal(value.rules, 'chinese')
    assert.deepEqual(value.moves[3], ['W', 'pass'])
    assert(!JSON.stringify(value).includes('keep this'))
    const changed = tree.mutate((draft) =>
      draft.updateProperty(tree.root.id, 'C', ['another comment']),
    )
    assert.equal(fingerprint(value), fingerprint(snapshot(changed, {})))
    assert.equal(replay(value).get([0, 8]), 1)
  })
  it('rejects unknown rules, midgame setup, oversized boards and consecutive colors', () => {
    assert.throws(
      () => validateSnapshot(position(source.replace('RU[Chinese]', '')).value),
      /choose-rules/,
    )
    assert.throws(
      () => position(source.replace(';W[cc]', ';W[cc]AB[dd]')),
      /unsupported-position/,
    )
    assert.throws(
      () => position(source.replace('SZ[9]', 'SZ[25]')),
      /unsupported-position/,
    )
    assert.throws(
      () =>
        validateSnapshot(position(source.replace(';W[cc]', ';B[cc]')).value),
      /unsupported-position/,
    )
  })
  it('replays captures, rejects overwrites and preserves pass in a variation', () => {
    const {value} = position(
      '(;SZ[9]KM[7.5]RU[Chinese]AB[aa][ba]AW[ab][bb];B[ca])',
    )
    validateSnapshot(value)
    assert.throws(() => replay(value, [['B', 'A9']]), /illegal-variation/)
    const board = replay(
      {
        ...value,
        initialStones: [
          ['W', 'A9'],
          ['B', 'B9'],
        ],
      },
      [
        ['B', 'A8'],
        ['W', 'pass'],
      ],
    )
    assert.equal(board.get([0, 0]), 0)
  })
  it('computes both losses from the mover perspective, including White', () => {
    assert.deepEqual(
      losses({scoreLead: 2, winrate: 0.4}, {scoreLead: 6, winrate: 0.6}, 'W'),
      {score: 4, winrate: 19.999999999999996},
    )
  })
  it('rejects immediate ko recapture locally and engine-forbidden moves in a variation', async () => {
    const {value} = position(
      '(;SZ[9]KM[7.5]RU[Chinese]AB[bg][dg][ch]AW[cg][bf][df][ce];B[cf];W[cg])',
    )
    assert.throws(() => validateSnapshot(value), /illegal-variation/)
    const client = new KataGo(engine, join(directory, 'analysis.cfg'))
    const analyze = client.analyze.bind(client)
    client.analyze = async (...args) => {
      const result = await analyze(...args)
      if (args[2]?.includePolicy) result.policy.fill(-1)
      return result
    }
    try {
      await assert.rejects(
        verifyMoment(client, position().value, {index: 0}, budgets.quick, 'en'),
        /illegal-variation/,
      )
    } finally {
      await client.close()
    }
  })
  it('uses a private analysis profile rather than GTP settings and preserves spaced model paths', () => {
    const built = profile(engine, join(directory, 'analysis.cfg'))
    assert(built.args.includes('analysis'))
    assert(!built.args.includes('gtp'))
  })
  it('reads final JSON results through a real child process, verifies three diagrams and rejects illegal PVs', async () => {
    const client = new KataGo(engine, join(directory, 'analysis.cfg'))
    try {
      const {value} = position()
      const card = await verifyMoment(
        client,
        value,
        {index: 0, crossing: true},
        budgets.quick,
        'zh-Hans',
      )
      assert.equal(card.kind, 'turning')
      assert.equal(card.evidence.loss.score, 6)
      assert.deepEqual(
        card.diagrams.map((d) => d.kind),
        ['actual', 'recommended', 'punishment'],
      )
      assert(card.diagrams.every((d) => d.replayId))
      assert(!card.diagrams[0].verified)
      const analyze = client.analyze.bind(client)
      client.analyze = async (...args) => {
        const result = await analyze(...args)
        if (args[1] === 0 && !args[2]?.allowMove)
          result.candidates[0].pv = ['E5', 'E5']
        return result
      }
      await assert.rejects(
        verifyMoment(client, value, {index: 0}, budgets.quick, 'en'),
        /illegal-variation/,
      )
    } finally {
      client.close()
    }
  })
  it('cancels pending work and kills a silent engine on timeout', async () => {
    const controller = new AbortController()
    const client = new KataGo(
      {...engine, args: engine.args.replace(' gtp', ' --slow gtp')},
      join(directory, 'analysis.cfg'),
      {signal: controller.signal},
    )
    const pending = client.analyze(position().value, 0)
    controller.abort()
    await assert.rejects(pending, {name: 'AbortError'})
    await client.close()
    assert(client.child.exitCode !== null || client.child.signalCode !== null)
    assert.equal(client.pending.size, 0)
    const silent = new KataGo(
      {...engine, args: engine.args.replace(' gtp', ' --slow gtp')},
      join(directory, 'analysis.cfg'),
      {timeout: 50},
    )
    await assert.rejects(silent.analyze(position().value, 0), /engine-timeout/)
    assert(silent.closed)
    await silent.close()
  })
  it('distinguishes a verified good move from an unstable estimate and skips empty PVs', async () => {
    const client = new KataGo(engine, join(directory, 'analysis.cfg'))
    const analyze = client.analyze.bind(client)
    const {value} = position()
    let mode = 'good'
    client.analyze = async (...args) => {
      const result = await analyze(...args)
      if (args[1] !== 0) return result
      const move = result.candidates[0]
      if (mode === 'good') {
        if (args[2]?.allowMove === 'E5') {
          move.scoreLead = -4
          move.winrate = 0.2
        } else {
          move.scoreLead = 2
          move.winrate = 0.42
          if (!args[2]?.allowMove) {
            move.move = 'A1'
            move.pv = ['A1', 'E5', 'F5']
            result.candidates.push({...move, move: 'E5', pv: ['E5']})
          }
        }
      } else if (mode === 'unstable' && !args[2]?.allowMove) {
        move.scoreLead = args[2].visits === budgets.quick.deep ? 20 : 8
      } else if (mode === 'empty' && !args[2]?.allowMove) move.pv = []
      return result
    }
    try {
      const good = await verifyMoment(
        client,
        value,
        {index: 0},
        budgets.quick,
        'en',
      )
      assert.equal(good.kind, 'good')
      assert.equal(good.evidence.alternative.gap, 6)
      assert.equal(good.diagrams[2].kind, 'alternative')
      mode = 'unstable'
      const uncertain = await verifyMoment(
        client,
        value,
        {index: 0},
        budgets.quick,
        'en',
      )
      assert.equal(uncertain.kind, 'uncertain')
      assert.equal(uncertain.stable, false)
      mode = 'empty'
      assert.equal(
        await verifyMoment(client, value, {index: 0}, budgets.quick, 'en'),
        null,
      )
    } finally {
      await client.close()
    }
  })
  it('falls back to the verified template when an LLM fabricates evidence', async () => {
    const service = createService({
      directory,
      getEngines: () => [engine],
      fetch: async () => ({
        ok: true,
        text: async () =>
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    lessonId: 'lesson-1',
                    paragraphs: [
                      {text: 'Invented result.', evidenceIds: ['unknown']},
                    ],
                  }),
                },
              },
            ],
          }),
      }),
    })
    service.configure({
      endpoint: 'http://localhost:11434/v1/chat/completions',
      model: 'test',
    })
    service.start({
      position: position().value,
      engineIndex: 0,
      budget: 'quick',
      useLLM: true,
    })
    await service.job.promise
    assert.equal(service.state.phase, 'complete')
    assert.equal(service.state.llmFallback, true)
    assert.equal(service.state.cards.length, 1)
    assert(!service.state.cards[0].paragraphs)
    assert(service.state.cards[0].summary)
  })
  it('keeps completed cards, authenticates the model and never mutates the snapshot', async () => {
    const service = createService({directory, getEngines: () => [engine]})
    const {value} = position()
    const original = JSON.stringify(value)
    service.start({position: value, engineIndex: 0, budget: 'quick'})
    await service.job.promise
    assert.equal(service.state.phase, 'complete')
    assert.equal(service.state.cards.length, 1)
    assert.match(service.state.cards[0].engine.modelSha256, /^[a-f0-9]{64}$/)
    assert.equal(JSON.stringify(value), original)
  })
  function countedService() {
    const calls = []
    let version = 'test-json'
    let onAnalyze = () => {}
    const service = createService({
      directory,
      getEngines: () => [engine],
      clientFactory: (engine, filename, options) => {
        const client = new KataGo(engine, filename, options)
        const analyze = client.analyze.bind(client)
        client.analyze = async (...args) => {
          calls.push({turn: args[1], options: args[2]})
          onAnalyze()
          return analyze(...args)
        }
        const request = client.request.bind(client)
        client.request = async (...args) => {
          const result = await request(...args)
          return args[0].action === 'query_version'
            ? {...result, version}
            : result
        }
        return client
      },
    })
    return {
      service,
      calls,
      setOnAnalyze: (callback) => {
        onAnalyze = callback
      },
      setVersion: (value) => {
        version = value
      },
    }
  }
  it('resumes an interrupted scan from the first unfinished position', async () => {
    const {service, calls} = countedService()
    const input = {position: position().value, engineIndex: 0, budget: 'quick'}
    const stop = (state) => {
      if (state.phase === 'scanning' && state.completed === 2)
        service.job.controller.abort()
    }
    service.on('change', stop)
    service.start(input)
    await service.job.promise
    assert.equal(service.state.phase, 'canceled')
    assert.equal(service.cache.scan.length, 2)
    service.removeListener('change', stop)
    const before = calls.length
    service.start(input)
    await service.job.promise
    assert.equal(service.state.phase, 'complete')
    assert.equal(calls[before].turn, 2)
    assert.equal(calls.filter((c) => c.options.visits === 100).length, 5)
    assert(service.state.reused >= 2)
    assert.equal(service.state.cards.length, 1)
  })
  it('reuses completed deep queries after cancellation, without caching aborted queries', async () => {
    const {service, calls, setOnAnalyze} = countedService()
    const input = {position: position().value, engineIndex: 0, budget: 'quick'}
    setOnAnalyze(() => {
      if (calls.length === 8) service.job.controller.abort()
    })
    service.start(input)
    await service.job.promise
    assert.equal(service.state.phase, 'canceled')
    assert.equal(service.cache.queries.size, 7)
    setOnAnalyze(() => {})
    const before = calls.length
    service.start(input)
    await service.job.promise
    assert.equal(calls[before].options.visits, 800)
    assert.equal(service.state.cards[0].evidence.loss.score, 6)
    assert.equal(service.state.cards[0].diagrams.length, 3)
    // Request ids stay unique across processes, including mixed cached/new evidence.
    const requestPrefix = (id) => id.slice(0, id.lastIndexOf('-'))
    assert.notEqual(
      requestPrefix(service.state.cards[0].evidence.best.queryId),
      requestPrefix(service.cache.scan[0].id),
    )
    const finished = calls.length
    service.start({...input, language: 'zh-Hans'})
    await service.job.promise
    assert.equal(calls.length, finished)
    assert.match(service.state.cards[0].summary, /实战/)
  })
  it('invalidates cached analysis for changed history, rules, komi, budget, engine or model contents', async () => {
    const {service, calls, setVersion} = countedService()
    let input = {position: position().value, engineIndex: 0, budget: 'quick'}
    const run = async () => {
      service.start(input)
      await service.job.promise
      assert.equal(service.state.phase, 'complete')
    }
    await run()
    const first = calls.length
    await run()
    assert.equal(calls.length, first)
    for (const change of [
      () => {
        input = {...input, budget: 'standard'}
      },
      () => {
        input.position = {...input.position, komi: 6.5}
      },
      () => {
        input.position = {...input.position, rules: 'japanese'}
      },
      () => {
        input.position = {
          ...input.position,
          moves: [
            ...input.position.moves.slice(0, 3),
            ['W', 'pass'],
            ['B', 'H9'],
          ],
          anchors: [
            ...input.position.anchors,
            {nodeId: 'new', beforeId: input.position.anchors[3].nodeId},
          ],
        }
      },
      () => {
        setVersion('changed-engine-version')
      },
      async () => {
        await writeFile(join(directory, 'model.bin'), 'new model at same path')
      },
      async () => {
        const human = join(directory, 'human.bin')
        await writeFile(human, 'human model')
        engine = {...engine, args: `${engine.args} -human-model "${human}"`}
      },
      async () => {
        await writeFile(join(directory, 'human.bin'), 'changed human model')
      },
    ]) {
      await change()
      const previous = calls.length
      await run()
      assert(calls.length > previous)
      assert.equal(calls[previous].turn, 0)
    }
  })
  it('rejects forged LLM references, coordinates and metrics; permits only cited interpretation', async () => {
    const lesson = {
      id: 'lesson',
      diagrams: [{id: 'recommended', verified: true}],
    }
    const valid = {
      lessonId: 'lesson',
      paragraphs: [
        {
          text: 'Compare the shapes in the recommended line.',
          evidenceIds: ['recommended'],
        },
      ],
    }
    assert.equal(validateExplanation(valid, lesson).length, 1)
    for (const bad of [
      {...valid, lessonId: 'other'},
      {
        ...valid,
        paragraphs: [{text: 'Play at Q16.', evidenceIds: ['recommended']}],
      },
      {
        ...valid,
        paragraphs: [
          {text: 'It loses 6 points.', evidenceIds: ['recommended']},
        ],
      },
      {
        ...valid,
        paragraphs: [{text: 'Compare the shapes.', evidenceIds: ['invented']}],
      },
    ])
      assert.throws(() => validateExplanation(bad, lesson))
    assert.throws(() =>
      validateConfig({
        endpoint: 'http://example.com/v1/chat/completions',
        model: 'x',
      }),
    )
    const controller = new AbortController()
    const result = await explain(
      lesson,
      validateConfig({
        endpoint: 'http://localhost:11434/v1/chat/completions',
        model: 'test',
      }),
      {
        signal: controller.signal,
        fetch: async () => ({
          ok: true,
          text: async () =>
            JSON.stringify({
              choices: [{message: {content: JSON.stringify(valid)}}],
            }),
        }),
      },
    )
    assert.equal(result.length, 1)
  })
})
