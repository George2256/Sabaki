// Shared, Electron-free snapshot and replay helpers. Coordinates are GTP;
// moves retain explicit colors rather than assuming SGF always alternates.
const {fromDimensions} = require('@sabaki/go-board')

const ruleNames = {
  chinese: 'chinese',
  china: 'chinese',
  中国: 'chinese',
  中國: 'chinese',
  japanese: 'japanese',
  japan: 'japanese',
  日本: 'japanese',
  korean: 'korean',
  korea: 'korean',
  aga: 'aga',
  'new zealand': 'new-zealand',
  'new-zealand': 'new-zealand',
  nz: 'new-zealand',
  'tromp-taylor': 'tromp-taylor',
  'tromp taylor': 'tromp-taylor',
}
const rules = [...new Set(Object.values(ruleNames))]
const positionError = (code) => Object.assign(new Error(code), {code})
function resolveRules(value) {
  return (
    ruleNames[
      String(value || '')
        .trim()
        .toLowerCase()
    ] || null
  )
}
function snapshot(tree, currents, rulesOverride = '') {
  // SGF conversion runs in the renderer bundle; the main process only needs
  // validation and replay, so it need not ship the SGF parser dependencies.
  const {parseVertex, parseCompressedVertices} = require('@sabaki/sgf')
  const nodes = [...tree.listCurrentNodes(currents)]
  const root = tree.root.data
  if (root.AE) throw positionError('unsupported-position')
  const size = String(root.SZ?.[0] || '19')
    .split(':')
    .map(Number)
  const boardXSize = size[0],
    boardYSize = size[size.length - 1]
  if (
    ![boardXSize, boardYSize].every(
      (n) => Number.isInteger(n) && n >= 2 && n <= 19,
    )
  )
    throw positionError('unsupported-position')
  const board = fromDimensions(boardXSize, boardYSize)
  const initialStones = ['AB', 'AW'].flatMap((property) =>
    (root[property] || []).flatMap(parseCompressedVertices).map((vertex) => {
      if (!board.has(vertex)) throw positionError('unsupported-position')
      return [property === 'AB' ? 'B' : 'W', board.stringifyVertex(vertex)]
    }),
  )
  const moves = [],
    anchors = []
  let beforeId = tree.root.id
  for (const node of nodes) {
    if (
      node.id !== tree.root.id &&
      ['AB', 'AW', 'AE', 'PL', 'SZ', 'KM', 'RU'].some((p) => node.data[p])
    )
      throw positionError('unsupported-position')
    if (node.data.B && node.data.W) throw positionError('unsupported-position')
    const color = node.data.B ? 'B' : node.data.W ? 'W' : null
    if (color) {
      const value = node.data[color][0]
      const vertex = parseVertex(value)
      // SGF tt is an old-style pass only on boards up to 19x19.
      const pass =
        value === '' || (value === 'tt' && boardXSize <= 19 && boardYSize <= 19)
      if (!pass && !board.has(vertex))
        throw positionError('unsupported-position')
      moves.push([color, pass ? 'pass' : board.stringifyVertex(vertex)])
      anchors.push({nodeId: node.id, beforeId, moveNumber: moves.length})
    }
    beforeId = node.id
  }
  const result = {
    rootId: tree.root.id,
    boardXSize,
    boardYSize,
    komi: Number(root.KM?.[0] ?? 0),
    rules: resolveRules(rulesOverride || root.RU?.[0]),
    originalRules: String(root.RU?.[0] || ''),
    initialPlayer:
      root.PL?.[0] ||
      moves[0]?.[0] ||
      (initialStones.filter(([c]) => c === 'B').length >= 2 ? 'W' : 'B'),
    initialStones,
    moves,
    anchors,
  }
  return result
}
function fingerprint(input) {
  // Includes anchors to prevent attaching a late result to a different SGF.
  return JSON.stringify(input)
}
function validateSnapshot(input) {
  if (!input || !rules.includes(input.rules))
    throw positionError('choose-rules')
  if (
    ![input.boardXSize, input.boardYSize].every(
      (x) => Number.isInteger(x) && x >= 2 && x <= 19,
    ) ||
    !Number.isFinite(input.komi) ||
    Math.abs(input.komi) > 400 ||
    (input.komi * 2) % 1 !== 0 ||
    !['B', 'W'].includes(input.initialPlayer) ||
    !Array.isArray(input.moves) ||
    input.moves.length < 1 ||
    input.moves.length > 1200 ||
    !Array.isArray(input.initialStones) ||
    input.initialStones.length > 361 ||
    !Array.isArray(input.anchors) ||
    input.anchors.length !== input.moves.length
  )
    throw positionError('unsupported-position')
  const board = fromDimensions(input.boardXSize, input.boardYSize)
  for (const entry of [...input.initialStones, ...input.moves]) {
    if (
      !Array.isArray(entry) ||
      entry.length !== 2 ||
      !['B', 'W'].includes(entry[0]) ||
      typeof entry[1] !== 'string' ||
      (entry[1] !== 'pass' && !/^[A-HJ-T]\d{1,2}$/.test(entry[1])) ||
      (entry[1] !== 'pass' && !board.has(board.parseVertex(entry[1])))
    )
      throw positionError('unsupported-position')
  }
  if (
    input.initialStones.some(([, coord]) => coord === 'pass') ||
    input.moves.some(
      ([color], index) =>
        color !==
        (index % 2 === 0
          ? input.initialPlayer
          : input.initialPlayer === 'B'
            ? 'W'
            : 'B'),
    )
  )
    throw positionError('unsupported-position')
  for (const anchor of input.anchors) {
    if (
      !anchor ||
      !['string', 'number'].includes(typeof anchor.nodeId) ||
      !['string', 'number'].includes(typeof anchor.beforeId)
    )
      throw positionError('unsupported-position')
  }
  replay(input, input.moves)
}
function replay(input, moves = input.moves) {
  let board = fromDimensions(input.boardXSize, input.boardYSize)
  for (const [color, coord] of input.initialStones) {
    const vertex = board.parseVertex(coord)
    if (!board.has(vertex) || board.get(vertex) !== 0)
      throw positionError('illegal-variation')
    board.set(vertex, color === 'B' ? 1 : -1)
  }
  if (!board.isValid()) throw positionError('illegal-variation')
  let lastWasPass = false
  for (const [color, coord] of moves) {
    const sign = color === 'B' ? 1 : -1
    const vertex = coord === 'pass' ? [-1, -1] : board.parseVertex(coord)
    if (coord !== 'pass' && !board.has(vertex))
      throw positionError('illegal-variation')
    const result = board.analyzeMove(sign, vertex)
    if (
      result.overwrite ||
      (result.ko && !lastWasPass) ||
      (result.suicide && !['tromp-taylor', 'new-zealand'].includes(input.rules))
    )
      throw positionError('illegal-variation')
    // KataGo's per-position policy mask checks superko from full history.
    // go-board retains its simple-ko marker on pass; a pass lifts that ban.
    board = board.makeMove(sign, vertex)
    lastWasPass = coord === 'pass'
  }
  return board
}
function coloredPV(pv, player) {
  if (!Array.isArray(pv) || pv.length > 40)
    throw positionError('illegal-variation')
  return pv.map((coord, index) => [
    index % 2 === 0 ? player : player === 'B' ? 'W' : 'B',
    coord,
  ])
}
function policyIndex(position, coord) {
  if (coord === 'pass') return position.boardXSize * position.boardYSize
  const x = 'ABCDEFGHJKLMNOPQRST'.indexOf(coord[0])
  const y = position.boardYSize - Number(coord.slice(1))
  if (
    !/^[A-HJ-T]\d{1,2}$/.test(coord) ||
    x < 0 ||
    x >= position.boardXSize ||
    !Number.isInteger(y) ||
    y < 0 ||
    y >= position.boardYSize
  )
    throw positionError('illegal-variation')
  return y * position.boardXSize + x
}
module.exports = {
  snapshot,
  fingerprint,
  validateSnapshot,
  replay,
  coloredPV,
  resolveRules,
  rules,
  policyIndex,
}
