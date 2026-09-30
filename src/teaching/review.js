const {coloredPV, replay, policyIndex} = require('./position')
const {t} = require('./strings')

const budgets = {
  quick: {scan: 100, deep: 400, seconds: 2},
  standard: {scan: 150, deep: 800, seconds: 4},
  thorough: {scan: 250, deep: 1600, seconds: 8},
}
function losses(best, played, color) {
  const sign = color === 'B' ? 1 : -1
  return {
    score: sign * (best.scoreLead - played.scoreLead),
    winrate: sign * (best.winrate - played.winrate) * 100,
  }
}
function selectMoments(position, scan, limit = 5) {
  const options = position.moves
    .map(([color, actual], index) => {
      const before = scan[index].candidates[0] || scan[index].root,
        after = scan[index + 1].candidates[0] || scan[index + 1].root
      const loss = losses(before, after, color)
      const sign = color === 'B' ? 1 : -1
      const alternatives = scan[index].candidates.filter(
        (m) => m.move !== actual && m.visits >= 5,
      )
      const gap = alternatives.length
        ? Math.max(
            ...alternatives.map((m) => sign * (before.scoreLead - m.scoreLead)),
          )
        : 0
      const crossing = before.winrate > 0.5 !== after.winrate > 0.5
      const priority =
        Math.max(0, loss.score) +
        Math.max(0, loss.winrate) / 8 +
        (crossing && loss.winrate > 5 ? 3 : 0)
      return {
        index,
        priority: priority + (before.move === actual && gap > 1.5 ? 2 : 0),
        crossing,
      }
    })
    .filter((x) => x.priority >= 1)
    .sort((a, b) => b.priority - a.priority || a.index - b.index)
  const selected = []
  for (const candidate of options) {
    if (selected.every((x) => Math.abs(x.index - candidate.index) >= 5))
      selected.push(candidate)
    if (selected.length === limit) break
  }
  return selected.sort((a, b) => a.index - b.index)
}
async function diagram(client, position, index, kind, moves, analysis) {
  const prefix = position.moves.slice(0, index)
  replay(position, [...prefix, ...moves])
  // KataGo tolerates some illegal moves in supplied history. Check the raw
  // legal-move mask BEFORE each proposed move, rather than trusting acceptance
  // of a query containing the entire line as a legality check.
  const legalityIds = []
  for (let step = 0; step < moves.length; step++) {
    const history = [...prefix, ...moves.slice(0, step)]
    const legal = await client.analyze(
      {...position, moves: history},
      history.length,
      {
        visits: 2,
        maxTime: 1,
        includePolicy: true,
      },
    )
    const coord = moves[step][1]
    const point = policyIndex(position, coord)
    if (legal.policy[point] < 0) throw new Error('illegal-variation')
    legalityIds.push(legal.id)
  }
  const validation = await client.analyze(
    {...position, moves: [...prefix, ...moves]},
    prefix.length + moves.length,
    {visits: 32, maxTime: 1},
  )
  return {
    id: `${index + 1}-${kind}`,
    kind,
    moves,
    verified: kind !== 'actual',
    sourceId: analysis?.id || null,
    replayId: validation.id,
    legalityIds,
    visits: analysis?.candidates[0].visits || null,
  }
}
async function verifyMoment(client, position, moment, budget, language) {
  const {index} = moment
  const [color, actual] = position.moves[index]
  const firstBest = await client.analyze(position, index, {
    visits: budget.deep,
    maxTime: budget.seconds,
  })
  const firstActual = await client.analyze(position, index, {
    visits: budget.deep,
    maxTime: budget.seconds,
    allowMove: actual,
  })
  const confirmedBest = await client.analyze(position, index, {
    visits: budget.deep * 2,
    maxTime: budget.seconds * 2,
  })
  const confirmedActual = await client.analyze(position, index, {
    visits: budget.deep * 2,
    maxTime: budget.seconds * 2,
    allowMove: actual,
  })
  const best = confirmedBest.candidates[0],
    played = confirmedActual.candidates[0]
  if (
    [best, played, firstBest.candidates[0], firstActual.candidates[0]].some(
      (x) => x.visits < 80,
    )
  )
    return null
  const initialLoss = losses(
    firstBest.candidates[0],
    firstActual.candidates[0],
    color,
  )
  const loss = losses(best, played, color)
  const stable =
    Math.abs(loss.score - initialLoss.score) <=
      Math.max(1, Math.abs(loss.score) * 0.5) &&
    Math.abs(loss.winrate - initialLoss.winrate) <=
      Math.max(5, Math.abs(loss.winrate) * 0.5)
  let kind =
    loss.score >= 2 || (loss.winrate >= 8 && loss.score >= 0.5) ? 'bad' : null
  if (kind && !stable) kind = 'uncertain'
  if (
    kind === 'bad' &&
    moment.crossing &&
    best.winrate > 0.5 !== played.winrate > 0.5 &&
    loss.winrate >= 8
  )
    kind = 'turning'
  let alternative, alternativeAnalysis, gap
  if (
    !kind &&
    Math.abs(loss.score) <= 0.7 &&
    Math.abs(loss.winrate) <= 3 &&
    stable
  ) {
    alternative = confirmedBest.candidates.find(
      (x) => x.move !== actual && x.move !== best.move && x.visits >= 5,
    )
    if (alternative) {
      alternativeAnalysis = await client.analyze(position, index, {
        visits: budget.deep * 2,
        maxTime: budget.seconds * 2,
        allowMove: alternative.move,
      })
      gap = losses(played, alternativeAnalysis.candidates[0], color).score
      if (gap >= 2 && alternativeAnalysis.candidates[0].visits >= 80)
        kind = 'good'
    }
  }
  if (!kind || !best.pv.length) return null
  const actualMoves = position.moves.slice(index, index + 8)
  const recommendedMoves = coloredPV(best.pv.slice(0, 12), color)
  const responseAnalysis =
    kind === 'good'
      ? alternativeAnalysis
      : await client.analyze(position, index + 1, {
          visits: budget.deep * 2,
          maxTime: budget.seconds * 2,
        })
  if (
    responseAnalysis.candidates[0].visits < 80 ||
    !responseAnalysis.candidates[0].pv.length
  )
    return null
  const comparisonMoves =
    kind === 'good'
      ? coloredPV(responseAnalysis.candidates[0].pv.slice(0, 12), color)
      : [
          [color, actual],
          ...coloredPV(
            responseAnalysis.candidates[0].pv.slice(0, 11),
            color === 'B' ? 'W' : 'B',
          ),
        ]
  const diagrams = [
    await diagram(client, position, index, 'actual', actualMoves, null),
    await diagram(
      client,
      position,
      index,
      'recommended',
      recommendedMoves,
      confirmedBest,
    ),
    await diagram(
      client,
      position,
      index,
      kind === 'good' ? 'alternative' : 'punishment',
      comparisonMoves,
      responseAnalysis,
    ),
  ]
  const round = (x) => Math.max(0, x).toFixed(1)
  const params = {
    player: t(language, color === 'B' ? 'black' : 'white'),
    actual: actual === 'pass' ? t(language, 'pass') : actual,
    best: best.move === 'pass' ? t(language, 'pass') : best.move,
    score: round(kind === 'good' ? Math.abs(loss.score) : loss.score),
    winrate: round(loss.winrate),
    alternative: alternative?.move,
    gap: round(gap || 0),
  }
  const beforeBoard = replay(position, position.moves.slice(0, index))
  return {
    id: `lesson-${index + 1}`,
    ...position.anchors[index],
    index,
    color,
    actual,
    kind,
    stable,
    summary: t(
      language,
      kind === 'good' ? 'goodComparison' : 'comparison',
      params,
    ),
    warning: stable ? null : t(language, 'unstable'),
    diagrams,
    context: {
      boardXSize: position.boardXSize,
      boardYSize: position.boardYSize,
      toPlay: color,
      stones: beforeBoard.signMap.flatMap((row, y) =>
        row.flatMap((sign, x) =>
          sign
            ? [[sign > 0 ? 'B' : 'W', beforeBoard.stringifyVertex([x, y])]]
            : [],
        ),
      ),
    },
    evidence: {
      rules: position.rules,
      komi: position.komi,
      perspective: 'BLACK',
      budget: budget.deep * 2,
      best: {
        move: best.move,
        scoreLead: best.scoreLead,
        winrate: best.winrate,
        visits: best.visits,
        queryId: confirmedBest.id,
      },
      played: {
        move: played.move,
        scoreLead: played.scoreLead,
        winrate: played.winrate,
        visits: played.visits,
        queryId: confirmedActual.id,
      },
      loss,
      initialLoss,
      alternative: alternativeAnalysis
        ? {move: alternative.move, gap, queryId: alternativeAnalysis.id}
        : null,
    },
  }
}
module.exports = {budgets, losses, selectMoments, verifyMoment}
