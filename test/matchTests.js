import assert from 'assert'
import {mkdtemp, writeFile, rm} from 'fs/promises'
import {join, resolve} from 'path'
import {tmpdir} from 'os'
import sgf from '@sabaki/sgf'
import * as gametree from '../src/modules/gametree.js'
import {snapshot} from '../src/teaching/position.js'
import {KataGo} from '../src/teaching/katago.js'
import {
  analyze,
  compact,
  evaluateMove,
  matchGraph,
  summarize,
} from '../src/match/stats.js'
import {
  playerEvidence,
  combineEvidence,
  switching,
  settings,
} from '../src/match/evidence.js'
import {parseRank, bandFor, profileLabel} from '../src/match/ranks.js'
import {createService} from '../src/match/service.js'

// Synthetic evaluations: winrates are Black's, as KataGo reports them here.
const c = (move, visits, winrate, scoreLead = 0, extra = {}) => ({
  move,
  visits,
  winrate,
  scoreLead,
  ...extra,
})
function entry(candidates, human) {
  return {
    root: {
      winrate: candidates[0].winrate,
      scoreLead: candidates[0].scoreLead,
      visits: 400,
    },
    candidates: candidates.map((x, order) => ({order, ...x})),
    ...(human ? {human} : {}),
  }
}
const even = (move = 'Q16') => entry([c(move, 200, 0.5), c('A19', 120, 0.49)])

// Deterministic pseudo-random numbers (mulberry32) for reproducible tests.
function random(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
// Records of one player: p maps profiles to the probability that an honest
// player of that rank finds an AI-equivalent move.
const move = (index, matched, p) => ({
  index: index * 2,
  moveNumber: index * 2 + 1,
  color: 'B',
  matched,
  human: p,
  excluded: null,
})

describe('AI match statistics', () => {
  it('counts a top-3 match only when the candidate has 20% of the first choice visits', () => {
    const position = {moves: [['B', 'D4']]}
    const thin = [
      entry([c('C3', 300, 0.5), c('D4', 50, 0.49), c('E5', 70, 0.48)]),
      even(),
    ]
    let record = evaluateMove(position, thin, 0)
    assert.equal(record.rank, 2)
    assert.equal(record.top1, false)
    assert.equal(record.top3, false)
    const searched = [
      entry([c('C3', 300, 0.5), c('E5', 80, 0.49), c('D4', 60, 0.495)]),
      even(),
    ]
    record = evaluateMove(position, searched, 0)
    assert.equal(record.rank, 3)
    assert.equal(record.top3, true)
    // The played move's own evaluation from the same search is used.
    assert.equal(record.winrateLoss.toFixed(2), '0.50')
    assert.equal(record.near, true)
  })

  it('treats near-ties that were searched enough as AI-equivalent moves', () => {
    const position = {moves: [['W', 'D4']]}
    const human = {rank_3d: {C3: 0.3, D4: 0.2, E5: 0.1}}
    // D4 is 0.4 points and 0.5% worse for White with 25% of the visits.
    let results = [
      entry([c('C3', 200, 0.5, -1), c('D4', 50, 0.505, -0.6)], human),
      even(),
    ]
    let record = evaluateMove(position, results, 0)
    assert.equal(record.matched, true)
    assert.equal(record.human.rank_3d.toFixed(2), '0.50')
    // A barely searched tie is not trusted.
    results = [
      entry([c('C3', 200, 0.5, -1), c('D4', 10, 0.5, -1)], human),
      even(),
    ]
    record = evaluateMove(position, results, 0)
    assert.equal(record.matched, false)
    assert.equal(record.human.rank_3d.toFixed(2), '0.30')
  })

  it('measures White losses from White’s side and falls back to the next search', () => {
    const position = {moves: [['W', 'K10']]}
    const results = [
      entry([c('Q4', 300, 0.4, -2), c('R4', 90, 0.41, -1.8)]),
      entry([c('C3', 300, 0.46, 1.5)]),
    ]
    const record = evaluateMove(position, results, 0)
    assert.equal(record.rank, null)
    assert.equal(record.top3, false)
    assert.equal(record.winrateLoss.toFixed(2), '6.00')
    assert.equal(record.scoreLoss.toFixed(2), '3.50')
    assert.equal(record.level, 'mistake')
    assert.equal(record.near, false)
  })

  it('never reports a negative loss when the next search is more optimistic', () => {
    const position = {moves: [['B', 'K10']]}
    const results = [
      entry([c('Q4', 300, 0.5, 1)]),
      entry([c('C3', 300, 0.6, 3)]),
    ]
    const record = evaluateMove(position, results, 0)
    assert.equal(record.winrateLoss, 0)
    assert.equal(record.scoreLoss, 0)
    assert.equal(record.near, true)
  })

  it('classifies blunders by score or winrate', () => {
    const position = {moves: [['B', 'A1']]}
    const results = [
      entry([c('Q4', 300, 0.6, 2)]),
      entry([c('C3', 300, 0.3, -1)]),
    ]
    assert.equal(evaluateMove(position, results, 0).level, 'blunder')
  })

  it('excludes passes, moves outside the range and decided positions', () => {
    const position = {
      moves: [
        ['B', 'pass'],
        ['W', 'D4'],
        ['B', 'Q16'],
        ['W', 'C3'],
      ],
    }
    const results = [
      even(),
      even('D4'),
      even('Q16'),
      // White to move while Black wins 99.5%: decided for both sides.
      entry([c('C3', 200, 0.995), c('D3', 100, 0.99)]),
      even(),
    ]
    const reasons = (options) =>
      position.moves.map(
        (_, i) => evaluateMove(position, results, i, options).excluded,
      )
    assert.deepEqual(reasons({excludeDecided: true}), [
      'pass',
      null,
      null,
      'decided',
    ])
    assert.deepEqual(reasons(), ['pass', null, null, null])
    assert.deepEqual(reasons({from: 3}), ['pass', 'range', null, null])
    // A move without the following position is still pending.
    assert.equal(
      evaluateMove(position, results.slice(0, 4), 3).excluded,
      'pending',
    )
  })

  it('summarizes each color, including the AI-equivalent match rate', () => {
    const moves = []
    const results = []
    for (let i = 0; i < 40; i++) {
      const color = i % 2 ? 'W' : 'B'
      moves.push([color, 'Q16'])
      // Black always plays the first choice; White plays it 15 of 20 times
      // and otherwise the second choice, losing 1% and 0.4 points.
      const hit = color === 'B' || i % 8 !== 1
      results.push(
        entry(
          hit
            ? [c('Q16', 200, 0.5), c('D4', 120, 0.5)]
            : [c('D4', 200, 0.5), c('Q16', 120, 0.51, 0.4)],
        ),
      )
    }
    results.push(even())
    const report = analyze({moves}, results)
    assert.equal(report.black.counted, 20)
    assert.equal(report.black.top1, 1)
    assert.equal(report.white.top1, 15 / 20)
    assert.equal(report.white.top3, 1)
    assert.equal(report.white.near, 1)
    assert.equal(report.white.matched, 1)
    assert.equal(report.white.scoreLoss.toFixed(2), '0.10')
    assert.equal(report.black.evidence, null)
    assert.equal(summarize(report.records, 'B').excluded.pending, 0)
  })

  it('keeps the played move and its human probability when it ranks below the retained candidates', () => {
    const candidates = Array.from({length: 14}, (_, i) =>
      c(`A${i + 1}`, 100 - i, 0.5, 0, {order: i, pv: [`A${i + 1}`]}),
    )
    const result = {
      root: {winrate: 0.5, scoreLead: 0, visits: 1500},
      candidates,
    }
    const policy = Array(362).fill(0.001)
    policy[5] = -1
    const kept = compact(result, 'A13', {
      human: {rank_1d: policy},
      index: (move) => (move === 'A13' ? 7 : move === 'A1' ? 5 : 3),
    })
    assert.equal(kept.candidates.length, 11)
    assert.deepEqual(kept.candidates.at(-1).move, 'A13')
    assert.equal(kept.candidates.at(-1).rank, 13)
    assert(!('pv' in kept.candidates[0]))
    assert.equal(Object.keys(kept.human.rank_1d).length, 11)
    // Illegal points (-1) count as impossible.
    assert.equal(kept.human.rank_1d.A1, 0)
    const record = evaluateMove(
      {moves: [['B', 'A13']]},
      [kept, entry([c('C3', 100, 0.5)])],
      0,
    )
    assert.equal(record.rank, 13)
  })

  it('maps root estimates to graph percentages, leaving missing positions empty', () => {
    const graph = matchGraph([even(), null, entry([c('D4', 10, 0.1234, 3)])])
    assert.deepEqual(graph.winrate, [50, null, 12.34])
    assert.deepEqual(graph.scoreLead, [0, null, 3])
    assert.equal(graph.completed, 2)
    assert.equal(graph.total, 3)
  })
})

describe('player ranks', () => {
  it('reads ranks as written by Chinese, Korean-style and western servers', () => {
    const cases = {
      '2级': '2k',
      '3段': '3d',
      初段: '1d',
      十五级: '15k',
      二十级: '20k',
      '25k': '20k',
      '5k': '5k',
      '1D': '1d',
      业余5段: '5d',
      '10d': '9d',
      '9p': 'pro',
      P9段: 'pro',
      职业九段: 'pro',
      '': null,
      '?': null,
    }
    for (const [text, rank] of Object.entries(cases))
      assert.equal(parseRank(text), rank, text)
  })

  it('builds a baseline band from the stated rank towards stronger players', () => {
    assert.deepEqual(bandFor('2k', 3), [
      'rank_2k',
      'rank_1k',
      'rank_1d',
      'rank_2d',
    ])
    assert.deepEqual(bandFor('8d', 3), ['rank_8d', 'rank_9d', 'proyear_2023'])
    assert.deepEqual(bandFor('3d', 0), ['rank_3d'])
    assert.deepEqual(bandFor(null), ['rank_9d', 'proyear_2023'])
    assert.equal(profileLabel('rank_2k', 'zh-Hans'), '2级')
    assert.equal(profileLabel('proyear_2023', 'zh-Hans'), '职业')
  })
})

describe('AI assistance evidence', () => {
  it('reduces the whole-game pattern to the product of per-move ratios', () => {
    const ratios = [2, 0.25, 3, 1.5]
    const {logLR, posterior} = switching(ratios, {start: 1, on: 0, off: 0})
    assert.equal(logLR.toFixed(9), Math.log(2 * 0.25 * 3 * 1.5).toFixed(9))
    assert(posterior.every((p) => p === 1))
    // Never switching on gives no evidence at all.
    assert.equal(switching(ratios, {start: 0, on: 0, off: 0}).logLR, 0)
  })

  it('keeps false alarms for honest players within the e-value bound', () => {
    const next = random(1)
    let over20 = 0,
      over100 = 0,
      mean = 0
    const runs = 4000
    for (let run = 0; run < runs; run++) {
      const moves = Array.from({length: 80}, (_, i) => {
        const p = 0.05 + 0.9 * next()
        return move(i, next() < p, {rank_2k: p})
      })
      const e = playerEvidence(moves, 'B', ['rank_2k'])
      const value = 10 ** e.log10E
      mean += value / runs
      if (value >= 20) over20++
      if (value >= 100) over100++
    }
    // Markov's inequality guarantees at most 5% and 1%; in practice far less.
    assert(over20 / runs <= 0.05, `P(E >= 20) = ${over20 / runs}`)
    assert(over100 / runs <= 0.01, `P(E >= 100) = ${over100 / runs}`)
    assert(mean < 1.5, `mean E = ${mean}`)
  })

  it('stays conservative when the human model overrates how rarely humans find a move', () => {
    const next = random(2)
    let over20 = 0
    for (let run = 0; run < 2000; run++) {
      const moves = Array.from({length: 80}, (_, i) =>
        // The model says 1%, honest players find it 5% of the time.
        move(i, next() < 0.05, {rank_2k: 0.01}),
      )
      if (playerEvidence(moves, 'B', ['rank_2k']).log10E >= Math.log10(20))
        over20++
    }
    assert(over20 / 2000 <= 0.05, `P(E >= 20) = ${over20 / 2000}`)
  })

  it('does not accuse an honest player who is stronger than the stated rank within the band', () => {
    const next = random(3)
    let banded = 0,
      single = 0
    const runs = 2000
    for (let run = 0; run < runs; run++) {
      const moves = Array.from({length: 80}, (_, i) => {
        const weak = 0.1 + 0.4 * next()
        const strong = Math.min(0.95, weak + 0.25)
        // The player really plays like the stronger rank.
        return move(i, next() < strong, {rank_2k: weak, rank_1d: strong})
      })
      if (playerEvidence(moves, 'B', ['rank_2k', 'rank_1d']).log10E >= 2)
        banded++
      if (playerEvidence(moves, 'B', ['rank_2k']).log10E >= 2) single++
    }
    assert(banded / runs <= 0.01, `with band: ${banded / runs}`)
    // Judged only by the stated rank, the same honest player looks suspicious.
    assert(single / runs > 0.3, `without band: ${single / runs}`)
  })

  it('finds whole-game assistance decisively', () => {
    const next = random(4)
    const moves = Array.from({length: 80}, (_, i) =>
      move(i, next() < 0.92, {rank_2k: 0.1 + 0.6 * next()}),
    )
    const e = playerEvidence(moves, 'B', ['rank_2k'])
    assert(e.log10E >= 10, `log10 E = ${e.log10E}`)
    assert.equal(e.verdict, 'suspected')
  })

  it('locates on-and-off assistance and reports the stretches', () => {
    const next = random(5)
    const assisted = (i) => (i >= 20 && i < 45) || (i >= 65 && i < 85)
    let found = 0,
      inside = 0,
      outside = 0
    const runs = 50
    for (let run = 0; run < runs; run++) {
      const moves = Array.from({length: 100}, (_, i) => {
        const p = 0.1 + 0.5 * next()
        return move(i, next() < (assisted(i) ? 0.92 : p), {rank_2k: p})
      })
      const e = playerEvidence(moves, 'B', ['rank_2k'])
      if (e.log10E >= 2) found++
      const mean = (test) => {
        const values = e.moves.filter((_, i) => test(i)).map((m) => m.posterior)
        return values.reduce((a, b) => a + b, 0) / values.length
      }
      inside += mean(assisted) / runs
      outside += mean((i) => !assisted(i)) / runs
    }
    assert(found / runs >= 0.8, `detected in ${found}/${runs}`)
    assert(inside > 0.6, `posterior inside ${inside}`)
    assert(outside < 0.35, `posterior outside ${outside}`)
  })

  it('reports suspicious stretches with matches against the expected count', () => {
    const moves = Array.from({length: 60}, (_, i) =>
      move(i, i >= 20 && i < 45 ? true : i % 3 === 0, {rank_2k: 0.3}),
    )
    const e = playerEvidence(moves, 'B', ['rank_2k'])
    const main = e.segments.reduce((a, b) => (b.moves > a.moves ? b : a))
    assert(main.from <= 2 * 20 + 1 + 6 && main.to >= 2 * 44 + 1 - 6)
    assert.equal(main.matched, main.moves - 0)
    assert.equal(main.expected.toFixed(1), (0.3 * main.moves).toFixed(1))
  })

  it('keeps an honest player’s timeline flat and lists no stretches', () => {
    const next = random(6)
    let flagged = 0
    for (let run = 0; run < 200; run++) {
      const moves = Array.from({length: 90}, (_, i) => {
        const p = 0.1 + 0.6 * next()
        return move(i, next() < p, {rank_2k: p})
      })
      const e = playerEvidence(moves, 'B', ['rank_2k'])
      if (e.segments.length) flagged++
      if (e.log10E < 0)
        assert(Math.max(...e.moves.map((m) => m.posterior)) < 0.5)
    }
    assert.equal(flagged, 0)
  })

  it('needs human-model data for every counted move', () => {
    const moves = [move(0, true, {rank_2k: 0.2}), move(1, true, null)]
    const e = playerEvidence(moves, 'B', ['rank_2k'])
    assert.equal(e.available, false)
    const partial = playerEvidence([move(0, true, {rank_2k: 0.2})], 'B', [
      'rank_2k',
      'rank_1k',
    ])
    assert.equal(partial.available, false)
  })

  it('adds the evidence of several games', () => {
    const game = (log10E) => ({
      available: true,
      counted: 50,
      matched: 30,
      expected: 20,
      log10E,
    })
    const total = combineEvidence([game(1.5), game(2), game(2.1)])
    assert.equal(total.games, 3)
    assert.equal(total.log10E.toFixed(1), '5.6')
    assert.equal(total.verdict, 'suspected')
    assert.equal(combineEvidence([game(1.5), null]).verdict, 'normal')
    assert.equal(settings.floor, 0.05)
  })
})

describe('AI match service', function () {
  this.timeout(15000)
  const source = '(;SZ[9]KM[7.5]RU[Chinese]PB[secret];B[ai];W[cc];B[gg];W[])'
  let directory, engine
  const position = () =>
    snapshot(gametree.new({root: sgf.parse(source)[0]}), {})
  const make = (flag = '', calls = []) =>
    createService({
      directory,
      throttle: 0,
      searchDirectories: [],
      getEngines: () => [
        {
          ...engine,
          args: `"${resolve('test/engines/teachingEngine.js')}" ${flag} ${engine.args}`,
        },
      ],
      clientFactory: (engine, filename, options) => {
        const client = new KataGo(engine, filename, options)
        const original = client.analyze.bind(client)
        client.analyze = (...args) => {
          calls.push({turn: args[1], options: args[2], args: engine.args})
          return original(...args)
        }
        return client
      },
    })
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'sabaki-match-'))
    const model = join(directory, 'model.bin')
    await writeFile(model, 'test model identity')
    engine = {
      name: 'KataGo test',
      path: process.execPath,
      args: `gtp -model "${model}"`,
    }
  })
  afterEach(async () => {
    await rm(directory, {recursive: true, force: true})
  })

  it('analyzes every position of the branch without mutating the snapshot', async () => {
    const service = make()
    const value = position()
    const original = JSON.stringify(value)
    service.start({position: value, engineIndex: 0, budget: 'quick'})
    await service.job.promise
    const {state} = service
    assert.equal(state.phase, 'complete')
    assert.equal(state.running, false)
    assert.equal(state.completed, 5)
    assert.equal(state.results.length, 5)
    assert(state.results.every((r) => r.candidates.length > 0))
    assert.equal(state.graph.completed, 5)
    assert.equal(state.engine.model, 'model.bin')
    assert.equal(state.humanModel, null)
    assert.equal(state.visits, 200)
    assert.equal(JSON.stringify(value), original)
    assert(!JSON.stringify(state).includes('secret'))
    const report = analyze(value, state.results, {bands: state.bands})
    assert.equal(report.records.length, 4)
    assert.equal(report.records[3].excluded, 'pass')
    // Without the human model there is no calibrated evidence.
    assert.equal(report.black.evidence.available, false)
  })

  it('finds the human model next to the main model and queries every baseline rank', async () => {
    await writeFile(join(directory, 'b18c384nbt-humanv0.bin.gz'), 'human')
    const calls = []
    const service = make('', calls)
    assert.equal(
      (await service.status()).engines[0].humanModel,
      'b18c384nbt-humanv0.bin.gz',
    )
    const value = position()
    service.start({
      position: value,
      engineIndex: 0,
      budget: 'quick',
      ranks: {B: '2k', W: null},
      margin: 1,
    })
    await service.job.promise
    const {state} = service
    assert.equal(state.phase, 'complete', state.error)
    assert.equal(state.humanModel, 'b18c384nbt-humanv0.bin.gz')
    assert.match(calls[0].args, /-human-model ".*b18c384nbt-humanv0\.bin\.gz"$/)
    assert.deepEqual(state.bands, {
      B: ['rank_2k', 'rank_1k'],
      W: ['rank_9d', 'proyear_2023'],
    })
    assert.deepEqual(Object.keys(state.results[0].human), [
      'rank_2k',
      'rank_1k',
    ])
    assert.deepEqual(Object.keys(state.results[1].human), [
      'rank_9d',
      'proyear_2023',
    ])
    // The final position needs no human baseline.
    assert.equal(state.results[4].human, undefined)
    // One full search per position plus a one-visit query per baseline rank.
    assert.equal(calls.filter((c) => c.options.visits === 1).length, 8)
    assert.equal(calls.filter((c) => c.options.visits === 200).length, 5)
    const report = analyze(value, state.results, {bands: state.bands})
    assert.equal(report.black.evidence.available, true)
    assert.equal(report.black.evidence.counted, 2)
    assert.equal(report.black.evidence.verdict, 'insufficient')

    // Another rank reuses every full search and repeats only human queries.
    calls.length = 0
    service.start({
      position: value,
      engineIndex: 0,
      budget: 'quick',
      ranks: {B: '1d', W: null},
      margin: 0,
    })
    await service.job.promise
    assert.equal(service.state.phase, 'complete', service.state.error)
    assert.equal(calls.filter((c) => c.options.visits === 200).length, 0)
    assert.deepEqual(
      calls.filter((c) => c.options.visits === 1).map((c) => c.turn),
      [0, 2],
    )
    assert.deepEqual(Object.keys(service.state.results[0].human), ['rank_1d'])
    assert.deepEqual(Object.keys(service.state.results[1].human), [
      'rank_9d',
      'proyear_2023',
    ])
  })

  it('rejects engines that are not KataGo, unknown ranks and positions without rules', () => {
    const service = make()
    assert.throws(
      () =>
        service.start({position: position(), engineIndex: 3, budget: 'quick'}),
      /katago-required/,
    )
    assert.throws(
      () =>
        service.start({
          position: position(),
          engineIndex: 0,
          ranks: {B: '30k'},
        }),
      /invalid-rank/,
    )
    assert.throws(
      () =>
        service.start({
          position: {...position(), rules: null},
          engineIndex: 0,
        }),
      /choose-rules/,
    )
  })

  it('stops on cancel and resumes from the completed positions', async () => {
    const calls = []
    const service = make('--stagger', calls)
    const value = position()
    service.start({position: value, engineIndex: 0, budget: 'quick'})
    await new Promise((resolve) =>
      service.on('change', (state) => state.completed >= 2 && resolve()),
    )
    await service.cancel()
    assert.equal(service.state.phase, 'canceled')
    const done = service.state.results.filter(Boolean).length
    assert(done >= 2 && done < 5, `done ${done}`)
    calls.length = 0
    service.start({position: value, engineIndex: 0, budget: 'quick'})
    await service.job.promise
    assert.equal(service.state.phase, 'complete')
    assert.equal(service.state.reused, done)
    assert.equal(calls.length, 5 - done)
    // A different budget does not reuse earlier results.
    calls.length = 0
    service.start({position: value, engineIndex: 0, budget: 'standard'})
    await service.job.promise
    assert.equal(service.state.reused, 0)
    assert.equal(calls.length, 5)
  })
})

describe('AI check command line', function () {
  this.timeout(30000)
  let directory
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'sabaki-ai-check-'))
  })
  afterEach(async () => {
    await rm(directory, {recursive: true, force: true})
  })

  it('checks SGF files with ranks from BR/WR and combines one player’s games', async function () {
    if (process.platform === 'win32') this.skip()
    const {execFile} = await import('child_process')
    const {chmod} = await import('fs/promises')
    // A KataGo stand-in: the wrapper forwards the analysis arguments.
    const katago = join(directory, 'katago')
    await writeFile(
      katago,
      `#!/bin/sh\nexec "${process.execPath}" "${resolve('test/engines/teachingEngine.js')}" "$@"\n`,
    )
    await chmod(katago, 0o755)
    await writeFile(join(directory, 'model.bin.gz'), 'model')
    await writeFile(join(directory, 'human.bin.gz'), 'human')
    const games = ['a', 'b'].map((name) => join(directory, `${name}.sgf`))
    for (const file of games)
      await writeFile(
        file,
        '(;SZ[9]KM[7.5]RU[Chinese]PB[Kim]BR[3级]PW[Lee]WR[2段];B[ee];W[fe];B[ed];W[ai])',
      )
    const output = await new Promise((done, fail) =>
      execFile(
        process.execPath,
        [
          'scripts/ai-check.js',
          '--katago',
          katago,
          '--model',
          join(directory, 'model.bin.gz'),
          '--human-model',
          join(directory, 'human.bin.gz'),
          '--budget',
          'quick',
          '--margin',
          '1',
          '--player',
          'Kim',
          '--work',
          join(directory, 'work'),
          '--json',
          ...games,
        ],
        (error, stdout, stderr) =>
          error ? fail(new Error(stderr)) : done(stdout),
      ),
    )
    const report = JSON.parse(output)
    assert.equal(report.games.length, 2)
    const {black, white} = report.games[0]
    assert.equal(black.name, 'Kim')
    assert.equal(black.rank, '3k')
    assert.deepEqual(black.baseline, ['rank_3k', 'rank_2k'])
    assert.deepEqual(white.baseline, ['rank_2d', 'rank_3d'])
    assert.equal(black.verdict, 'insufficient')
    assert.equal(typeof black.log10E, 'number')
    assert.equal(black.evidence.moves.length, 2)
    assert.equal(report.player.games, 2)
    assert.equal(report.player.log10E.toFixed(6), (2 * black.log10E).toFixed(6))
  })
})
