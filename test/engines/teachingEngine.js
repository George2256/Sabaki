// Deterministic JSON protocol engine: tests use explicit synthetic evaluations,
// not claims of real KataGo strength. Every PV is built from legal empty points.
const {createInterface} = require('readline')
const {replay, policyIndex} = require('../../src/teaching/position')
const input = createInterface({input: process.stdin})
const slow = process.argv.includes('--slow')
// Later turns answer later, so parallel scans can be stopped part way.
const stagger = process.argv.includes('--stagger')
input.on('line', (line) => {
  const query = JSON.parse(line)
  if (query.action === 'query_version')
    return send({id: query.id, version: 'test-json'})
  try {
    const turn = query.analyzeTurns[0]
    const moves = query.moves.slice(0, turn)
    const board = replay(query, moves)
    const player = moves.length
      ? moves[moves.length - 1][0] === 'B'
        ? 'W'
        : 'B'
      : query.initialPlayer
    const free = [
      'E5',
      'F5',
      'E6',
      'F6',
      'G5',
      'G6',
      'C5',
      'C6',
      'D5',
      'D6',
    ].filter(
      (c) =>
        board.has(board.parseVertex(c)) &&
        board.get(board.parseVertex(c)) === 0,
    )
    const move = query.allowMoves?.[0].moves[0] || free[0] || 'pass'
    const playedBad = moves.some(
      ([color, coord]) => color === 'B' && coord === 'A1',
    )
    const scoreLead =
      query.allowMoves?.[0].moves[0] === 'A1' || playedBad ? 2 : 8
    const pv = [move, ...free.filter((c) => c !== move).slice(0, 2)]
    const result = {
      id: query.id,
      turnNumber: turn,
      isDuringSearch: false,
      rootInfo: {
        currentPlayer: player,
        visits: query.maxVisits,
        scoreLead,
        winrate: scoreLead === 2 ? 0.42 : 0.75,
      },
      moveInfos: [
        {
          move,
          pv,
          order: 0,
          visits: query.maxVisits,
          scoreLead,
          winrate: scoreLead === 2 ? 0.42 : 0.75,
        },
      ],
    }
    if (query.includePolicy)
      result.policy = [
        ...board.signMap.flat().map((stone) => (stone ? -1 : 0.01)),
        0.01,
      ]
    // A stand-in for the human SL model: players of stronger profiles find the
    // engine's move more often; the rest is spread over the empty points.
    const profile = query.overrideSettings?.humanSLProfile
    if (query.includePolicy && profile) {
      const share = profile.startsWith('proyear')
        ? 0.6
        : profile.endsWith('d')
          ? 0.4
          : 0.2
      const cells = board.signMap.flat()
      const empty = cells.filter((stone) => !stone).length
      const policy = cells.map((stone) =>
        stone ? -1 : (1 - share - 0.01) / Math.max(1, empty - 1),
      )
      policy.push(0.01)
      policy[policyIndex(query, move)] = share
      result.humanPolicy = policy
    }
    // Split output chunks and emit an intermediate update to exercise framing.
    send({...result, isDuringSearch: true})
    setTimeout(() => send(result), stagger ? 600 * turn : slow ? 500 : 5)
  } catch {
    send({id: query.id, error: 'illegal move'})
  }
})
function send(value) {
  const line = JSON.stringify(value) + '\n'
  const half = Math.floor(line.length / 2)
  process.stdout.write(line.slice(0, half))
  process.stdout.write(line.slice(half))
}
