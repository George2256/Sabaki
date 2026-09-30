import assert from 'assert'
import {mkdtemp, writeFile, readFile, rm} from 'fs/promises'
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
import {groups, describeLine, enrichLesson} from '../src/teaching/facts.js'
import {learnerProfile} from '../src/teaching/learner.js'
import {localExplanation} from '../src/teaching/coach.js'
import {scanGraph, graphForNodes} from '../src/teaching/graph.js'

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
    assert(service.state.cards[0].paragraphs.length >= 2)
    assert.equal(service.state.cards[0].explanation.source, 'local')
    assert.equal(service.state.cards[0].explanation.reason, 'llm-invalid')
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
  it('maps final black root estimates to SGF boards including root moves, passes and comment nodes', () => {
    const {tree, value} = position(
      '(;SZ[9]KM[7.5]RU[Chinese]B[ai]SBKV[99];C[after root];W[];C[after pass];B[gg])',
    )
    const scan = [
      {
        root: {winrate: 0.751234, scoreLead: 8.12345},
        candidates: [{winrate: 0.99, scoreLead: 40}],
      },
      {root: {winrate: 0.42, scoreLead: 2}},
      {root: {winrate: 0.5, scoreLead: 0}},
    ]
    const graph = scanGraph(scan, value.moves.length + 1)
    assert.deepEqual(graph.winrate, [75.12, 42, 50, null])
    assert.deepEqual(graph.scoreLead, [8.12345, 2, 0, null])
    const nodes = [...tree.listCurrentNodes({})]
    const review = {rootId: value.rootId, graph}
    const mapped = graphForNodes(value, review, nodes)
    assert.deepEqual(mapped.winrate, [42, 42, 50, 50, null])
    assert.deepEqual(mapped.scoreLead, [2, 2, 0, 0, null])
    assert.equal(graphForNodes(value, {...review, stale: true}, nodes), null)
    assert.equal(
      graphForNodes(value, {...review, rootId: 'other'}, nodes),
      null,
    )
    assert.equal(graphForNodes(value, review, nodes.slice(0, -1)), null)
    const sibling = nodes.map((node, i) =>
      i === nodes.length - 1 ? {...node, id: 'other-branch'} : node,
    )
    assert.equal(graphForNodes(value, review, sibling), null)
    const {tree: normalTree, value: normal} = position()
    const normalGraph = scanGraph([{root: {winrate: 0.75, scoreLead: 8}}], 5)
    const origin = graphForNodes(
      normal,
      {rootId: normal.rootId, graph: normalGraph},
      [...normalTree.listCurrentNodes({})],
    )
    assert.deepEqual(origin.winrate, [75, null, null, null, null])
  })
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
    assert.deepEqual(service.state.graph.winrate, [75, 42, null, null, null])
    assert.deepEqual(service.state.graph.scoreLead, [8, 2, null, null, null])
    assert.equal(service.state.graph.completed, 2)
    service.removeListener('change', stop)
    const before = calls.length
    service.start(input)
    await service.job.promise
    assert.equal(service.state.phase, 'complete')
    assert.equal(calls[before].turn, 2)
    assert.equal(calls.filter((c) => c.options.visits === 100).length, 5)
    assert.deepEqual(service.state.graph.winrate, [75, 42, 42, 42, 42])
    assert.deepEqual(service.state.graph.scoreLead, [8, 2, 2, 2, 2])
    assert.equal(service.state.graph.completed, 5)
    assert.equal(service.state.graph.total, 5)
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
    service.start({...input, language: 'zh-Hans', learnerRank: '3d'})
    await service.job.promise
    assert.equal(calls.length, finished)
    assert.match(service.state.cards[0].summary, /实战/)
    assert.equal(service.state.cards[0].learner.tier, 'advanced')
    assert(
      service.state.cards[0].paragraphs.some((p) => /时机|先手/.test(p.text)),
    )
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
  it('permits real coordinates, numbered moves and natural teaching language, rejects forged references and metrics, and retries malformed output once', async () => {
    const client = new KataGo(engine, join(directory, 'analysis.cfg'))
    let lesson
    try {
      lesson = await verifyMoment(
        client,
        position().value,
        {index: 0},
        budgets.quick,
        'zh-Hans',
      )
    } finally {
      await client.close()
    }
    const fact = lesson.facts.find(
      (f) => f.diagramId.endsWith('-recommended') && f.step === 1,
    )
    const paragraph = {
      text: '推荐图黑1下在 E5。先补一手，再观察对方的应手。',
      refs: [{diagramId: fact.diagramId, step: 1}],
      factIds: [fact.id],
    }
    const valid = {
      lessonId: lesson.id,
      paragraphs: [
        paragraph,
        {...paragraph, text: '先猜对方的应手，再翻变化图。'},
      ],
    }
    assert.equal(validateExplanation(valid, lesson).length, 2)
    for (const changed of [
      {text: 'Play at Q16.'},
      {text: 'Play at A999.'},
      {text: '白1下在 E5。'},
      {text: '看推荐图第 40 步。'},
      {text: 'It loses 6 points.'},
      {text: '这里必死。'},
      {refs: [{diagramId: 'invented', step: 1}]},
      {refs: [{diagramId: fact.diagramId, step: 500}]},
      {factIds: ['invented']},
    ])
      assert.throws(() =>
        validateExplanation(
          {...valid, paragraphs: [{...paragraph, ...changed}, paragraph]},
          lesson,
        ),
      )
    assert.throws(() =>
      validateConfig({
        endpoint: 'http://example.com/v1/chat/completions',
        model: 'x',
      }),
    )
    let calls = 0,
      received
    const result = await explain(
      lesson,
      validateConfig({
        endpoint: 'http://localhost:11434/v1/chat/completions',
        model: 'test',
      }),
      {
        signal: new AbortController().signal,
        fetch: async (_, options) => {
          calls++
          received = JSON.parse(JSON.parse(options.body).messages[1].content)
          return {
            ok: true,
            text: async () =>
              JSON.stringify({
                choices: [
                  {
                    message: {
                      content:
                        calls === 1 ? 'invalid JSON' : JSON.stringify(valid),
                    },
                  },
                ],
              }),
          }
        },
      },
    )
    assert.equal(result.length, 2)
    assert.equal(calls, 2)
    assert.equal(received.diagrams[0].source, 'sgf')
    assert.equal(received.diagrams[0].legal, true)
    assert.equal(received.diagrams[0].verified, false)
    assert(received.context.groups)
    assert.equal(received.styleReferences.length, 2)
    assert.equal(received.learner.rank, '10k')
  })
  it('keeps timeout and cancellation distinct and never retries a failed connection', async () => {
    const client = new KataGo(engine, join(directory, 'analysis.cfg'))
    let lesson
    try {
      lesson = await verifyMoment(
        client,
        position().value,
        {index: 0},
        budgets.quick,
        'en',
      )
    } finally {
      await client.close()
    }
    const waiting = (_, {signal}) =>
      new Promise((resolve, reject) =>
        signal.addEventListener('abort', () => reject(new Error('aborted')), {
          once: true,
        }),
      )
    await assert.rejects(
      explain(
        lesson,
        {},
        {fetch: waiting, signal: new AbortController().signal, timeout: 20},
      ),
      /llm-timeout/,
    )
    const controller = new AbortController()
    const pending = explain(
      lesson,
      {},
      {fetch: waiting, signal: controller.signal},
    )
    controller.abort()
    await assert.rejects(pending, {name: 'AbortError'})
    let calls = 0
    await assert.rejects(
      explain(
        lesson,
        {},
        {
          signal: new AbortController().signal,
          fetch: async () => {
            calls++
            return {ok: false}
          },
        },
      ),
      /llm-connection/,
    )
    assert.equal(calls, 1)
  })
  it('extracts concrete capture, connection and escaping facts without inventing life/death', () => {
    const capture = position(
      '(;SZ[9]KM[7.5]RU[Chinese]AB[ba][ab][cb]AW[bb];B[bc])',
    ).value
    const fact = describeLine(capture, 0, {
      id: 'capture',
      moves: capture.moves,
    })[0]
    assert.deepEqual(fact.captured, [{color: 'W', stones: ['B8']}])
    const connect = position('(;SZ[9]KM[7.5]RU[Chinese]AB[dd][fd];B[ed])').value
    assert.equal(
      describeLine(connect, 0, {id: 'connect', moves: connect.moves})[0]
        .connected.length,
      2,
    )
    const escape = position(
      '(;SZ[9]KM[7.5]RU[Chinese]AW[ba][ab][cb]AB[bb];B[bc])',
    ).value
    const escapeFact = describeLine(escape, 0, {
      id: 'escape',
      moves: escape.moves,
    })[0]
    assert.equal(escapeFact.escaped[0].anchor, 'B8')
    assert.equal(escapeFact.escaped[0].before, 1)
    assert.equal(escapeFact.escaped[0].after, 3)
    assert.throws(() => learnerProfile('invented'), /invalid-learner/)
  })
  it('explains a shared target and defensive timing in a real game instead of choosing an unrelated later event', async () => {
    const {value} = position(
      await readFile(
        resolve('test/resources/teaching/lee-alphago-1.sgf'),
        'utf8',
      ),
    )
    const index = 38
    const diagrams = [
      {
        id: '39-actual',
        kind: 'actual',
        moves: value.moves.slice(index, index + 4),
      },
      {
        id: '39-recommended',
        kind: 'recommended',
        moves: [
          ['B', 'H14'],
          ['W', 'J12'],
        ],
      },
      {
        id: '39-punishment',
        kind: 'punishment',
        moves: [
          ['B', 'M11'],
          ['W', 'N11'],
          ['B', 'L11'],
          ['W', 'H14'],
        ],
      },
    ]
    const lesson = {
      index,
      color: 'B',
      kind: 'bad',
      learner: learnerProfile('5k'),
      diagrams,
      context: {},
    }
    enrichLesson(lesson, value)
    const paragraphs = localExplanation(lesson, 'zh-Hans')
    assert.match(paragraphs[0].text, /J14.*2.*4/)
    assert.match(paragraphs[1].text, /第 4 步.*H14.*J14/)
    assert.deepEqual(paragraphs[1].refs, [
      {diagramId: '39-punishment', step: 4},
    ])
  })
  it('replays all 24 source-backed teaching fragments and produces traceable local explanations', async () => {
    const data = JSON.parse(
      await readFile(
        resolve('src/teaching/reference-library/patterns.json'),
        'utf8',
      ),
    )
    const {value} = position(
      await readFile(
        resolve('test/resources/teaching/lee-alphago-1.sgf'),
        'utf8',
      ),
    )
    validateSnapshot(value)
    assert.equal(data.length, 24)
    const names = new Set()
    for (const example of data) {
      assert(!names.has(example.id))
      names.add(example.id)
      assert.equal(example.reviewer, 'An Younggil 8p')
      const index = example.moveNumber - 1
      const moves = value.moves.slice(index, index + 8)
      const diagrams = ['actual', 'recommended', 'punishment'].map((kind) => ({
        id: `${example.id}-${kind}`,
        kind,
        legal: true,
        source: 'sgf',
        moves,
      }))
      // Reuse the recorded line to exercise replay facts, not to pretend that
      // historical variations are modern KataGo recommendations.
      const lesson = {
        id: example.id,
        color: value.moves[index][0],
        kind: 'bad',
        learner: learnerProfile('10k'),
        diagrams,
        context: {
          groups: groups(replay(value, value.moves.slice(0, index))),
          stones: [],
        },
        facts: diagrams.flatMap((d) => describeLine(value, index, d)),
      }
      const paragraphs = localExplanation(lesson, 'zh-Hans')
      assert(paragraphs.length >= 2)
      for (const paragraph of paragraphs) {
        assert(
          paragraph.refs.every((r) =>
            diagrams.some(
              (d) => d.id === r.diagramId && r.step <= d.moves.length,
            ),
          ),
        )
        assert(
          paragraph.factIds.every((id) =>
            lesson.facts.some((f) => f.id === id),
          ),
        )
        assert(!/必死|必活|保证先手/.test(paragraph.text))
      }
    }
  })
})
