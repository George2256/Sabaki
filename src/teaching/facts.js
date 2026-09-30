const {replay} = require('./position')

// These are replay facts, not inferred life/death, territory or sente labels.
function groups(board) {
  const seen = new Set(),
    result = []
  board.signMap.forEach((row, y) =>
    row.forEach((sign, x) => {
      const vertex = [x, y],
        coord = board.stringifyVertex(vertex)
      if (!sign || seen.has(coord)) return
      const stones = board
        .getChain(vertex)
        .map((v) => board.stringifyVertex(v))
        .sort()
      stones.forEach((c) => seen.add(c))
      result.push({
        color: sign > 0 ? 'B' : 'W',
        anchor: stones[0],
        stones,
        liberties: board
          .getLiberties(vertex)
          .map((v) => board.stringifyVertex(v))
          .sort(),
      })
    }),
  )
  return result
}
function region(position, coord) {
  if (coord === 'pass') return 'pass'
  const x = 'ABCDEFGHJKLMNOPQRST'.indexOf(coord[0]),
    y = Number(coord.slice(1)) - 1
  const edge = Math.max(
    1,
    Math.min(
      3,
      Math.floor(Math.min(position.boardXSize, position.boardYSize) / 4),
    ),
  )
  const horizontal = Math.min(x, position.boardXSize - 1 - x) < edge
  const vertical = Math.min(y, position.boardYSize - 1 - y) < edge
  return horizontal && vertical
    ? 'corner'
    : horizontal || vertical
      ? 'side'
      : 'center'
}
function describeLine(position, index, diagram) {
  const prefix = position.moves.slice(0, index)
  let before = replay(position, prefix),
    beforeGroups = groups(before)
  return diagram.moves.map(([color, move], i) => {
    const after = replay(position, [
      ...prefix,
      ...diagram.moves.slice(0, i + 1),
    ])
    const afterGroups = groups(after)
    const surviving = (g) =>
      afterGroups.find(
        (a) =>
          a.color === g.color && a.stones.some((c) => g.stones.includes(c)),
      )
    const captured = beforeGroups
      .filter((g) => g.color !== color)
      .flatMap((g) => {
        const stones = g.stones.filter(
          (c) => after.get(after.parseVertex(c)) !== (g.color === 'B' ? 1 : -1),
        )
        return stones.length ? [{color: g.color, stones}] : []
      })
    const own = afterGroups.find(
      (g) => g.color === color && g.stones.includes(move),
    )
    const parents = own
      ? beforeGroups.filter(
          (g) =>
            g.color === color && g.stones.some((c) => own.stones.includes(c)),
        )
      : []
    const atari = afterGroups
      .filter((g) => {
        if (g.liberties.length !== 1) return false
        const old = beforeGroups.find(
          (b) =>
            b.color === g.color && b.stones.some((c) => g.stones.includes(c)),
        )
        return !old || old.liberties.length > 1
      })
      .map((g) => ({
        color: g.color,
        anchor: g.anchor,
        size: g.stones.length,
        liberty: g.liberties[0],
      }))
    const escaped = beforeGroups
      .filter((g) => g.color === color && g.liberties.length === 1)
      .flatMap((g) => {
        const a = surviving(g)
        return a && a.liberties.length > 1
          ? [{anchor: g.anchor, before: 1, after: a.liberties.length}]
          : []
      })
    const fact = {
      id: `${diagram.id}-step-${i + 1}`,
      diagramId: diagram.id,
      step: i + 1,
      color,
      move,
      region: region(position, move),
      captured,
      atari,
      escaped,
      connected: parents.length > 1 ? parents.map((g) => g.anchor) : [],
      groupChanges: beforeGroups.flatMap((g) => {
        const a = surviving(g)
        const afterLiberties = a ? a.liberties.length : 0
        return afterLiberties !== g.liberties.length
          ? [
              {
                color: g.color,
                anchor: g.anchor,
                before: g.liberties.length,
                after: afterLiberties,
              },
            ]
          : []
      }),
      ownGroup: own
        ? {
            anchor: own.anchor,
            size: own.stones.length,
            liberties: own.liberties.length,
          }
        : null,
    }
    before = after
    beforeGroups = afterGroups
    return fact
  })
}
function enrichLesson(lesson, position) {
  const board = replay(position, position.moves.slice(0, lesson.index))
  lesson.context.groups = groups(board)
  lesson.facts = lesson.diagrams.flatMap((d) => [
    {
      id: `${d.id}-position`,
      diagramId: d.id,
      step: 0,
      groups: lesson.context.groups,
    },
    ...describeLine(position, lesson.index, d),
  ])
  return lesson
}
function salience(fact) {
  return (
    fact.captured.reduce((n, g) => n + g.stones.length * 3, 0) +
    fact.escaped.length * 5 +
    fact.connected.length * 3 +
    fact.atari
      .filter((g) => g.color !== fact.color)
      .reduce((n, g) => n + g.size + 2, 0) +
    (fact.groupChanges || []).filter(
      (g) => g.color !== fact.color && g.before <= 4 && g.after < g.before,
    ).length
  )
}
module.exports = {groups, region, describeLine, enrichLesson, salience}
