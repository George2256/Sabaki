// AI match statistics. These pure functions are shared by the main-process
// service, the renderer and the command-line tool, so changing the counted
// range or exclusions never needs a new scan. Winrates are Black's probability
// in [0, 1]; score leads are Black's lead in points. Losses are converted to
// the mover's perspective.

const {playerEvidence} = require('./evidence')

const thresholds = {
  // A candidate counts as an AI choice only with at least 20% of the visits of
  // the first choice; otherwise a barely searched move would count as a match.
  choiceShare: 0.2,
  choices: 3,
  // "Almost matching": the played move loses at most one percentage point.
  nearWinrate: 1,
  // The played move's own evaluation from the same search is used when it has
  // at least this share of the first choice's visits.
  ownShare: 0.1,
  // AI-equivalent moves: the engine's choice, plus candidates searched with at
  // least 10% of its visits that lose at most 0.5 points and 1% winrate. They
  // keep near-ties from deciding a match by search noise or engine version.
  equivalent: {share: 0.1, score: 0.5, winrate: 1},
  // Decided game: the mover's best winrate is above or below these bounds.
  // KataGo passes 95% long before a game is settled (move 62 of Lee Sedol vs
  // AlphaGo game 1), while 99% marks the late endgame there (move 133).
  // Off by default: an assisted player who quickly wins a decisive lead would
  // otherwise have most moves dropped, and the human-model baseline already
  // gives simple moves in won positions little weight.
  decided: 0.99,
  mistake: {score: 2, winrate: 8},
  blunder: {score: 5, winrate: 20},
}

const budgets = {
  quick: {visits: 200, maxTime: 5},
  standard: {visits: 400, maxTime: 10},
  thorough: {visits: 1000, maxTime: 20},
}

// Reduces one KataGo analysis result to what the statistics need. The played
// move is kept even when it ranks below the retained candidates. `human` maps
// humanSLProfile names to KataGo humanPolicy arrays; only the probabilities of
// the retained moves are kept.
function compact(result, played = null, {human = null, index = null} = {}) {
  const keep = 10
  const pick = ({move, order, visits, winrate, scoreLead}) => ({
    move,
    order,
    visits,
    winrate,
    scoreLead,
  })
  const candidates = result.candidates.slice(0, keep).map(pick)
  const position = result.candidates.findIndex((c) => c.move === played)
  if (position >= keep)
    candidates.push({...pick(result.candidates[position]), rank: position + 1})
  const entry = {
    root: {
      winrate: result.root.winrate,
      scoreLead: result.root.scoreLead,
      visits: result.root.visits,
    },
    candidates,
  }
  if (human && index) {
    const moves = [...new Set([...candidates.map((c) => c.move), played])]
    entry.human = Object.fromEntries(
      Object.entries(human).map(([profile, policy]) => [
        profile,
        Object.fromEntries(
          moves
            .filter((move) => move != null)
            .map((move) => [move, Math.max(0, policy[index(move)] ?? 0)]),
        ),
      ]),
    )
  }
  return entry
}

function rankOf(entry, move) {
  const index = entry.candidates.findIndex((c) => c.move === move)
  if (index < 0) return null
  return entry.candidates[index].rank ?? index + 1
}

function equivalentMoves(entry, color) {
  const sign = color === 'B' ? 1 : -1
  const top = entry.candidates[0]
  const {share, score, winrate} = thresholds.equivalent
  return entry.candidates
    .filter(
      (c, k) =>
        k === 0 ||
        (c.visits >= share * top.visits &&
          sign * (top.scoreLead - c.scoreLead) <= score + 1e-9 &&
          sign * (top.winrate - c.winrate) * 100 <= winrate + 1e-9),
    )
    .map((c) => c.move)
}

function evaluateMove(position, results, index, options = {}) {
  const {from = 1, to = Infinity, excludeDecided = false} = options
  const [color, move] = position.moves[index]
  const moveNumber = index + 1
  const sign = color === 'B' ? 1 : -1
  const before = results[index],
    after = results[index + 1]
  const record = {
    index,
    moveNumber,
    color,
    move,
    best: before?.candidates[0]?.move ?? null,
    rank: null,
    top1: false,
    top3: false,
    near: false,
    matched: false,
    // Probability, per baseline profile, that a human of that rank plays an
    // AI-equivalent move here.
    human: null,
    scoreLoss: null,
    winrateLoss: null,
    level: null,
    excluded: null,
  }
  if (move === 'pass') return {...record, excluded: 'pass'}
  if (moveNumber < from || moveNumber > to) record.excluded = 'range'
  if (!before?.candidates.length || !after)
    return {...record, excluded: record.excluded || 'pending'}

  const best = before.candidates[0]
  const choices = before.candidates
    .slice(0, thresholds.choices)
    .filter(
      (c, k) => k === 0 || c.visits >= thresholds.choiceShare * best.visits,
    )
  record.rank = rankOf(before, move)
  record.top1 = record.rank === 1
  record.top3 = choices.some((c) => c.move === move)
  const equivalent = equivalentMoves(before, color)
  record.matched = equivalent.includes(move)
  if (before.human)
    record.human = Object.fromEntries(
      Object.entries(before.human).map(([profile, probabilities]) => [
        profile,
        Math.min(
          1,
          equivalent.reduce((sum, m) => sum + (probabilities[m] ?? 0), 0),
        ),
      ]),
    )

  // Prefer the same search's evaluation of the played move; a fresh search of
  // the next position is the fallback for moves the engine barely considered.
  const own = before.candidates.find(
    (c) => c.move === move && c.visits >= thresholds.ownShare * best.visits,
  )
  const played = own || after.candidates[0] || after.root
  record.scoreLoss = Math.max(0, sign * (best.scoreLead - played.scoreLead))
  record.winrateLoss = Math.max(0, sign * (best.winrate - played.winrate) * 100)
  // Tolerance keeps a displayed 1.0% loss from failing on rounding error.
  record.near =
    record.top1 || record.winrateLoss <= thresholds.nearWinrate + 1e-9
  record.level =
    record.scoreLoss >= thresholds.blunder.score ||
    record.winrateLoss >= thresholds.blunder.winrate
      ? 'blunder'
      : record.scoreLoss >= thresholds.mistake.score ||
          record.winrateLoss >= thresholds.mistake.winrate
        ? 'mistake'
        : null

  if (record.excluded) return record
  const moverWinrate = color === 'B' ? best.winrate : 1 - best.winrate
  if (
    excludeDecided &&
    (moverWinrate >= thresholds.decided ||
      moverWinrate <= 1 - thresholds.decided)
  )
    record.excluded = 'decided'
  return record
}

function summarize(records, color) {
  const own = records.filter((r) => r.color === color)
  const counted = own.filter((r) => !r.excluded)
  const n = counted.length
  const share = (test) => (n ? counted.filter(test).length / n : null)
  const mean = (key) =>
    n ? counted.reduce((sum, r) => sum + r[key], 0) / n : null
  const excluded = {pass: 0, range: 0, decided: 0, pending: 0}
  for (const r of own) if (r.excluded) excluded[r.excluded]++
  return {
    color,
    total: own.length,
    counted: n,
    excluded,
    top1: share((r) => r.top1),
    top3: share((r) => r.top3),
    near: share((r) => r.near),
    matched: share((r) => r.matched),
    scoreLoss: mean('scoreLoss'),
    winrateLoss: mean('winrateLoss'),
    mistakes: counted.filter((r) => r.level === 'mistake').length,
    blunders: counted.filter((r) => r.level === 'blunder').length,
  }
}

// `bands` maps each color to its baseline profiles (stated rank first). When a
// band is given and the scan carries human-model data, each player also gets
// rank-calibrated evidence.
function analyze(position, results, options = {}) {
  const records = position.moves.map((_, index) =>
    evaluateMove(position, results, index, options),
  )
  const visits = results.filter(Boolean).map((r) => r.root.visits)
  const player = (color) => ({
    ...summarize(records, color),
    evidence: options.bands?.[color]
      ? playerEvidence(records, color, options.bands[color])
      : null,
  })
  return {
    records,
    black: player('B'),
    white: player('W'),
    averageVisits: visits.length
      ? visits.reduce((a, b) => a + b, 0) / visits.length
      : null,
  }
}

function matchGraph(results) {
  return {
    winrate: results.map((r) =>
      r ? Math.round(r.root.winrate * 10000) / 100 : null,
    ),
    scoreLead: results.map((r) => (r ? r.root.scoreLead : null)),
    completed: results.filter(Boolean).length,
    total: results.length,
  }
}

module.exports = {
  thresholds,
  budgets,
  compact,
  equivalentMoves,
  evaluateMove,
  summarize,
  analyze,
  matchGraph,
}
