// Rank-calibrated statistical evidence of AI assistance for one player.
//
// Null hypothesis: an honest human of some rank in the baseline band. For
// every counted move, KataGo's human SL model gives the probability p that
// such a player picks an AI-equivalent move. Obvious moves have p near 1 and
// carry almost no evidence; hard positions carry the most.
//
// Alternative: a player who switches between their own play and consulting an
// AI, including on-and-off use within one game. While consulting, the player
// picks an AI-equivalent move with probability 1 - deviation * (1 - p). Four
// switching patterns are mixed with equal weight: the whole game, long
// stretches, on-and-off use and isolated moves. A forward-backward pass gives
// each move's posterior probability of assistance.
//
// E = P_alternative(moves) / max over the band of P_rank(moves) is an e-value:
// for an honest player of any rank in the band, P(E >= x) <= 1/x. This holds
// without simulation because the expected likelihood ratio under the null is
// 1 (Markov's inequality). E-values of one player's games may be multiplied,
// and checked after every game, with the same guarantee (a test martingale;
// Ville's inequality). The guarantee is only as good as the human model's fit
// to the population; calibrate on known honest games before relying on it.

const settings = {
  // Human-model probabilities below this are raised. Rare moves are where a
  // network is least reliable; raising p only makes the test more conservative.
  floor: 0.05,
  deviation: 0.25,
  // start: probability of assistance at the first counted move; on/off:
  // per-move probabilities of starting and stopping assistance.
  components: [
    {name: 'whole', weight: 0.25, start: 1, on: 0, off: 0},
    {name: 'stretch', weight: 0.25, start: 0.5, on: 0.02, off: 0.05},
    {name: 'intermittent', weight: 0.25, start: 0.3, on: 0.1, off: 0.2},
    {name: 'isolated', weight: 0.25, start: 0.3, on: 0.3, off: 0.7},
  ],
  minMoves: 15,
  // log10 of the e-value for one game.
  suspected: 4,
  elevated: 2,
  // Shorter runs are mostly chance clusters of easy matches.
  segment: {posterior: 0.5, minMoves: 5},
}

const clamp = (p) => Math.min(1 - 1e-9, Math.max(settings.floor, p))

function logSumExp(values) {
  const max = Math.max(...values)
  if (max === -Infinity) return -Infinity
  return max + Math.log(values.reduce((sum, v) => sum + Math.exp(v - max), 0))
}

// Two-state switching model over per-move likelihood ratios (assisted versus
// own play). Returns the log likelihood ratio against "never assisted" and the
// posterior probability of assistance for every move. Scaled recursions keep
// long games from overflowing.
function switching(ratios, {start, on, off}) {
  const n = ratios.length
  if (!n) return {logLR: 0, posterior: []}
  const forwardOwn = new Float64Array(n),
    forwardAssisted = new Float64Array(n)
  let own = 1 - start,
    assisted = start * ratios[0],
    logLR = 0
  for (let i = 0; i < n; i++) {
    if (i > 0) {
      const nextOwn = own * (1 - on) + assisted * off
      assisted = (own * on + assisted * (1 - off)) * ratios[i]
      own = nextOwn
    }
    const sum = own + assisted
    logLR += Math.log(sum)
    own /= sum
    assisted /= sum
    forwardOwn[i] = own
    forwardAssisted[i] = assisted
  }
  const posterior = new Array(n)
  let backOwn = 1,
    backAssisted = 1
  for (let i = n - 1; i >= 0; i--) {
    if (i < n - 1) {
      const nextOwn = (1 - on) * backOwn + on * ratios[i + 1] * backAssisted
      backAssisted = off * backOwn + (1 - off) * ratios[i + 1] * backAssisted
      backOwn = nextOwn
      const sum = backOwn + backAssisted
      backOwn /= sum
      backAssisted /= sum
    }
    const a = forwardAssisted[i] * backAssisted
    posterior[i] = a / (forwardOwn[i] * backOwn + a)
  }
  return {logLR, posterior}
}

function logLikelihood(moves, profile) {
  return moves.reduce((sum, r) => {
    const p = clamp(r.human[profile])
    return sum + Math.log(r.matched ? p : 1 - p)
  }, 0)
}

function verdictFor(log10E, counted, {pending = false, thresholds = {}} = {}) {
  const {suspected = settings.suspected, elevated = settings.elevated} =
    thresholds
  if (pending) return 'pending'
  if (counted < settings.minMoves) return 'insufficient'
  if (log10E >= suspected) return 'suspected'
  if (log10E >= elevated) return 'elevated'
  return 'normal'
}

function segmentsOf(moves, posterior, profile) {
  const segments = []
  let current = null
  moves.forEach((r, i) => {
    if (posterior[i] >= settings.segment.posterior) {
      current ??= {moves: []}
      current.moves.push(i)
    } else current = null
    if (current && current.moves.length === 1) segments.push(current)
  })
  return segments
    .filter((s) => s.moves.length >= settings.segment.minMoves)
    .map(({moves: indices}) => ({
      from: moves[indices[0]].moveNumber,
      to: moves[indices.at(-1)].moveNumber,
      start: moves[indices[0]].index,
      moves: indices.length,
      matched: indices.filter((i) => moves[i].matched).length,
      expected: indices.reduce((sum, i) => sum + moves[i].human[profile], 0),
      posterior:
        indices.reduce((sum, i) => sum + posterior[i], 0) / indices.length,
    }))
}

// `records` come from stats.evaluateMove; `band` lists humanSLProfile names
// with the stated rank first.
function playerEvidence(records, color, band) {
  const own = records.filter((r) => r.color === color)
  const pending = own.some((r) => r.excluded === 'pending')
  const moves = own.filter((r) => !r.excluded)
  if (
    !band?.length ||
    !moves.length ||
    moves.some((r) => !r.human || band.some((p) => !(p in r.human)))
  )
    return {
      available: moves.length === 0 && band?.length > 0,
      band,
      counted: moves.length,
      log10E: 0,
      verdict: verdictFor(0, moves.length, {pending}),
      moves: [],
      segments: [],
    }

  const base = band[0]
  const ratios = moves.map((r) => {
    const p = clamp(r.human[base])
    return r.matched
      ? (1 - settings.deviation * (1 - p)) / p
      : settings.deviation
  })
  const parts = settings.components.map((c) => ({
    ...c,
    ...switching(ratios, c),
  }))
  const logMixture = logSumExp(parts.map((c) => Math.log(c.weight) + c.logLR))
  // The most favorable baseline for the player: the rank in the band whose
  // honest play best explains the observed matches.
  const nulls = band.map((profile) => ({
    profile,
    logL: logLikelihood(moves, profile),
  }))
  const favorable = nulls.reduce((a, b) => (b.logL > a.logL ? b : a))
  const logE = logMixture + nulls[0].logL - favorable.logL
  // The switching model's posterior answers "where, if this player used an
  // AI". Weighting it by the probability of any use at all (even prior odds,
  // E / (1 + E)) keeps an honest player's timeline flat.
  const assisted = 1 / (1 + Math.exp(-logE))
  const posterior = moves.map(
    (_, i) =>
      assisted *
      parts.reduce(
        (sum, c) =>
          sum +
          Math.exp(Math.log(c.weight) + c.logLR - logMixture) * c.posterior[i],
        0,
      ),
  )
  const log10E = logE / Math.LN10
  return {
    available: true,
    band,
    favorable: favorable.profile,
    counted: moves.length,
    matched: moves.filter((r) => r.matched).length,
    expected: moves.reduce((sum, r) => sum + r.human[favorable.profile], 0),
    log10E,
    components: parts.map((c) => ({name: c.name, log10: c.logLR / Math.LN10})),
    moves: moves.map((r, i) => ({
      index: r.index,
      moveNumber: r.moveNumber,
      matched: r.matched,
      p: r.human[favorable.profile],
      posterior: posterior[i],
    })),
    // Stretches are reported only where the game as a whole carries notable
    // evidence; otherwise they would be chance clusters.
    segments:
      log10E >= settings.elevated
        ? segmentsOf(moves, posterior, favorable.profile)
        : [],
    verdict: verdictFor(log10E, moves.length, {pending}),
  }
}

// Evidence of one player over several games: e-values multiply, so their
// logarithms add. The default thresholds are stricter than for one game
// because a site checks many players.
function combineEvidence(list, thresholds = {suspected: 5, elevated: 3}) {
  const games = list.filter((e) => e?.available && e.counted > 0)
  const sum = (key) => games.reduce((total, e) => total + (e[key] ?? 0), 0)
  const log10E = sum('log10E')
  return {
    games: games.length,
    counted: sum('counted'),
    matched: sum('matched'),
    expected: sum('expected'),
    log10E,
    verdict: verdictFor(log10E, sum('counted'), {thresholds}),
  }
}

module.exports = {
  settings,
  switching,
  playerEvidence,
  combineEvidence,
  verdictFor,
}
