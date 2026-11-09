#!/usr/bin/env node
// Command-line AI assistance check for servers: runs the same KataGo scan and
// rank-calibrated evidence as Sabaki's AI Match panel on SGF files, without
// Electron. See docs/ai-match.md.

const fs = require('fs')
const os = require('os')
const {join, basename, resolve} = require('path')
const sgf = require('@sabaki/sgf')
const {snapshot, resolveRules} = require('../src/teaching/position')
const {createService} = require('../src/match/service')
const {analyze} = require('../src/match/stats')
const {combineEvidence} = require('../src/match/evidence')
const {parseRank, ladder, profileLabel} = require('../src/match/ranks')

const usage = `Usage: node scripts/ai-check.js [options] <game.sgf>...

Engine
  --katago <path>          KataGo executable (default: katago)
  --model <path>           main network, e.g. kata1-b18c384nbt-*.bin.gz
  --human-model <path>     human SL network b18c384nbt-humanv0.bin.gz
  --budget <name>          quick | standard | thorough (default: standard)

Baseline
  --rank-black <rank>      override the SGF BR, e.g. 2k, 3d, pro, unknown
  --rank-white <rank>      override the SGF WR
  --margin <n>             also accept honest play up to n ranks stronger
                           than stated (default: 3)

Counting
  --from <n>               first counted move (default: 1)
  --to <n>                 last counted move
  --exclude-decided        skip positions above 99% / below 1% winrate

Output
  --player <name>          combine the evidence of this player over all games
  --json                   machine-readable output
  --work <dir>             directory for the KataGo analysis config
`

function parseArgs(argv) {
  const options = {files: [], budget: 'standard', margin: 3, from: 1}
  const value = (i) => {
    if (argv[i + 1] == null) throw new Error(`${argv[i]} needs a value`)
    return argv[i + 1]
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') options.help = true
    else if (arg === '--json') options.json = true
    else if (arg === '--exclude-decided') options.excludeDecided = true
    else if (arg.startsWith('--')) {
      const key = arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())
      options[key] = value(i++)
    } else options.files.push(arg)
  }
  return options
}

// SGF files from servers name ranks in many ways; 'unknown' selects the
// strong-player baseline explicitly.
function rankOption(value, fallback) {
  if (value == null) return parseRank(fallback)
  if (value === 'unknown') return null
  const rank = ladder.includes(value) ? value : parseRank(value)
  if (!rank) throw new Error(`Unknown rank: ${value}`)
  return rank
}

function mainLine(root) {
  const nodes = []
  for (let node = root; node; node = node.children[0]) nodes.push(node)
  return nodes
}

function loadGame(file) {
  const [root] = sgf.parse(fs.readFileSync(file, 'utf8'))
  if (!root) throw new Error(`${file}: no game`)
  const tree = {root, listCurrentNodes: () => mainLine(root)}
  const rules = resolveRules(root.data.RU?.[0]) ? '' : 'chinese'
  return {root, position: snapshot(tree, {}, rules)}
}

function playerReport(summary, name, rank) {
  const e = summary.evidence
  return {
    name,
    rank,
    verdict: e?.available ? e.verdict : 'uncalibrated',
    log10E: e?.available ? e.log10E : null,
    baseline: e?.band ?? null,
    favorable: e?.favorable ?? null,
    counted: summary.counted,
    matched: e?.matched ?? null,
    expected: e?.expected ?? null,
    segments: e?.segments ?? [],
    descriptive: {
      top1: summary.top1,
      top3: summary.top3,
      aiEquivalent: summary.matched,
      averageScoreLoss: summary.scoreLoss,
      averageWinrateLoss: summary.winrateLoss,
      mistakes: summary.mistakes,
      blunders: summary.blunders,
    },
    evidence: e,
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help || !options.files.length) {
    process.stdout.write(usage)
    return
  }
  for (const key of ['model', 'humanModel'])
    if (!options[key])
      throw new Error(
        `--${key === 'model' ? 'model' : 'human-model'} is required`,
      )
  const engine = {
    name: 'KataGo',
    path: options.katago || 'katago',
    args: [
      'gtp',
      '-model',
      resolve(options.model),
      '-human-model',
      resolve(options.humanModel),
    ]
      .map((arg) => JSON.stringify(arg))
      .join(' '),
  }
  const service = createService({
    directory: options.work || join(os.tmpdir(), 'sabaki-ai-check'),
    getEngines: () => [engine],
    searchDirectories: [],
    throttle: 2000,
  })
  service.on('change', (state) => {
    if (!options.json && state.running)
      process.stderr.write(
        `\r  ${state.phase} ${state.completed}/${state.total}   `,
      )
  })
  const games = []
  for (const file of options.files) {
    const {root, position} = loadGame(file)
    const ranks = {
      B: rankOption(options.rankBlack, root.data.BR?.[0]),
      W: rankOption(options.rankWhite, root.data.WR?.[0]),
    }
    if (!options.json) process.stderr.write(`${basename(file)}\n`)
    service.start({
      position,
      engineIndex: 0,
      budget: options.budget,
      ranks,
      margin: Number(options.margin),
    })
    await service.job.promise
    if (!options.json) process.stderr.write('\n')
    const {state} = service
    if (state.phase !== 'complete')
      throw new Error(`${file}: ${state.error || state.phase}`)
    if (!state.humanModel) throw new Error('The human model was not loaded')
    const report = analyze(position, state.results, {
      bands: state.bands,
      from: Number(options.from) || 1,
      to: Number(options.to) || Infinity,
      excludeDecided: !!options.excludeDecided,
    })
    games.push({
      file,
      moves: position.moves.length,
      engine: state.engine,
      visits: state.visits,
      rules: position.rules,
      komi: position.komi,
      black: playerReport(report.black, root.data.PB?.[0] || '', ranks.B),
      white: playerReport(report.white, root.data.PW?.[0] || '', ranks.W),
    })
  }

  const output = {games}
  if (options.player) {
    const own = games.flatMap((g) =>
      [g.black, g.white].filter((p) => p.name === options.player),
    )
    output.player = {
      name: options.player,
      ...combineEvidence(own.map((p) => p.evidence)),
    }
  }
  if (options.json) {
    process.stdout.write(JSON.stringify(output, null, 2) + '\n')
    return
  }

  const pct = (x) => (x == null ? '-' : `${(x * 100).toFixed(1)}%`)
  for (const game of games) {
    console.log(`\n${game.file}  (${game.moves} moves)`)
    for (const [color, p] of [
      ['B', game.black],
      ['W', game.white],
    ]) {
      const band = p.baseline
        ? `${profileLabel(p.baseline[0])}..${profileLabel(p.baseline.at(-1))}`
        : '-'
      console.log(
        `  ${color} ${(p.name || '?').padEnd(20)} ${p.verdict.padEnd(12)} log10E=${p.log10E?.toFixed(2) ?? '-'}  baseline ${band}  matched ${p.matched}/${p.counted} (expected ${p.expected?.toFixed(1) ?? '-'})  top1 ${pct(p.descriptive.top1)}`,
      )
      for (const s of p.segments)
        console.log(
          `      moves ${s.from}-${s.to}: ${s.matched}/${s.moves} matched, expected ${s.expected.toFixed(1)}`,
        )
    }
  }
  if (output.player) {
    const p = output.player
    console.log(
      `\n${p.name}: ${p.games} games, log10E=${p.log10E.toFixed(2)}, ${p.verdict}`,
    )
  }
  // Calibration: on games known to be honest, the share of players reaching
  // E >= 10^k must stay below 10^-k; much more means the baseline is off.
  const values = games.flatMap((g) =>
    [g.black, g.white].map((p) => p.log10E).filter((x) => x != null),
  )
  if (values.length > 1) {
    const share = (k) => values.filter((x) => x >= k).length / values.length
    console.log(
      `\nCalibration over ${values.length} players: E>=10 ${pct(share(1))} (bound 10%), E>=100 ${pct(share(2))} (bound 1%), E>=10^4 ${pct(share(4))} (bound 0.01%)`,
    )
  }
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`)
  process.exit(1)
})
