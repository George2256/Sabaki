// Public OGS REST API: https://docs.online-go.com/
const BASE = 'https://online-go.com/api/v1'
const NOT_FOUND = 'User not found. Check the nickname or try a player ID.'
const INVALID_RESPONSE = 'The server returned an invalid response.'
const INVALID_RECORD = 'The server returned an invalid game record.'
const GAME_UNAVAILABLE = 'This OGS game is private or unavailable.'
const gameErrors = {
  401: GAME_UNAVAILABLE,
  403: GAME_UNAVAILABLE,
  404: GAME_UNAVAILABLE,
}
const validId = (value) => /^[1-9]\d*$/.test(String(value ?? ''))

function result(game) {
  const outcome = typeof game.outcome === 'string' ? game.outcome : ''
  if (/^(cancellation|void|no result)$/i.test(outcome)) return 'Void'
  if (/^(tie|draw|0(?: points?)?)$/i.test(outcome)) return '0'
  const winner =
    game.black_lost === false && game.white_lost === true
      ? 'B'
      : game.black_lost === true && game.white_lost === false
        ? 'W'
        : ''
  if (!winner) return outcome
  if (!outcome) return winner
  const suffix = {resignation: 'R', timeout: 'T', disconnection: 'F'}[
    outcome.toLowerCase()
  ]
  const points = outcome.match(/^(\d+(?:\.\d+)?)(?: points?)?$/i)?.[1]
  return suffix || points
    ? `${winner}+${suffix || points}`
    : `${winner}+${outcome}`
}

function summary(game) {
  const players = game.gamedata?.players ?? game.players
  return {
    id: String(game.id),
    black: String(players?.black?.username ?? ''),
    white: String(players?.white?.username ?? ''),
    date: typeof game.started === 'string' ? game.started.slice(0, 10) : '',
    result: result(game),
    // The list endpoint omits move counts; don't download every SGF to count.
    moves: Array.isArray(game.gamedata?.moves)
      ? game.gamedata.moves.length
      : null,
  }
}

function linkId(keyword) {
  try {
    const url = new URL(keyword)
    const match = url.pathname.match(
      /^\/(?:game|api\/v1\/games)\/([1-9]\d*)(?:\/sgf)?\/?$/,
    )
    if (
      ['https:', 'http:'].includes(url.protocol) &&
      ['online-go.com', 'www.online-go.com'].includes(url.hostname) &&
      !url.username &&
      !url.password &&
      !url.port &&
      match
    )
      return match[1]
  } catch (_) {}
  throw new Error('Enter a valid OGS game link.')
}

module.exports = {
  id: 'ogs',
  name: 'OGS (Online-Go.com)',
  modes: ['nickname', 'id', 'link'],
  async search({keyword, mode, cursor}, request) {
    if (mode === 'link') {
      const id = linkId(keyword)
      const game = await request(
        `${BASE}/games/${id}/`,
        {},
        {errors: gameErrors},
      )
      if (
        String(game.id) !== id ||
        !game.players?.black ||
        !game.players?.white
      )
        throw new Error(INVALID_RESPONSE)
      return {user: null, games: [summary(game)], nextCursor: null}
    }
    if (mode === 'id' && !validId(keyword))
      throw new Error(
        'OGS player IDs must contain digits only and be greater than zero.',
      )
    const page = cursor == null ? 1 : Number(cursor)
    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      (cursor != null && (typeof cursor !== 'string' || !validId(cursor)))
    )
      throw new Error('Invalid game history page.')

    let player
    if (mode === 'id') {
      player = await request(
        `${BASE}/players/${keyword}/`,
        {},
        {errors: {404: NOT_FOUND}},
      )
      if (String(player.id) !== keyword) throw new Error(INVALID_RESPONSE)
    } else {
      const json = await request(`${BASE}/players/`, {username: keyword})
      if (!Array.isArray(json.results)) throw new Error(INVALID_RESPONSE)
      // Keep numeric nicknames distinct from IDs and never pick a fuzzy match.
      player = json.results.find((item) => item?.username === keyword)
      if (!player) throw new Error(NOT_FOUND)
    }
    if (
      !validId(player.id) ||
      typeof player.username !== 'string' ||
      !player.username
    )
      throw new Error(INVALID_RESPONSE)
    const user = {id: String(player.id), name: player.username}
    const endpoint = `${BASE}/players/${user.id}/games/`
    const json = await request(endpoint, {
      ended__isnull: 'false',
      ordering: '-ended',
      page_size: '20',
      page: String(page),
    })
    if (!Array.isArray(json.results)) throw new Error(INVALID_RESPONSE)
    if (
      json.results.some(
        (game) =>
          !game ||
          (String(game.black) !== user.id && String(game.white) !== user.id),
      )
    )
      throw new Error(INVALID_RESPONSE)
    let nextCursor = null
    if (json.next != null) {
      try {
        const next = new URL(json.next, BASE)
        const nextPage = next.searchParams.get('page')
        if (
          next.origin !== 'https://online-go.com' ||
          next.pathname !== new URL(endpoint).pathname ||
          !validId(nextPage) ||
          Number(nextPage) !== page + 1
        )
          throw new Error()
        // Only the page number crosses IPC. Never follow a server-supplied URL.
        nextCursor = nextPage
      } catch (_) {
        throw new Error(INVALID_RESPONSE)
      }
    }
    const seen = new Set()
    const games = json.results
      .filter((game) => {
        const id = String(game.id ?? '')
        if (!validId(id) || seen.has(id)) return false
        seen.add(id)
        return true
      })
      .map(summary)
    return {user, games, nextCursor}
  },
  async download({id}, request) {
    if (!validId(id)) throw new Error(INVALID_RECORD)
    const text = await request(
      `${BASE}/games/${id}/sgf`,
      {},
      {
        format: 'text',
        errors: gameErrors,
      },
    )
    const content =
      typeof text === 'string' ? text.replace(/^\uFEFF/, '').trim() : ''
    try {
      if (!/^\(\s*;/.test(content)) throw new Error()
      const trees = require('@sabaki/sgf').parse(content)
      if (
        trees.length !== 1 ||
        (trees[0].data.GM && trees[0].data.GM[0] !== '1')
      )
        throw new Error()
    } catch (_) {
      throw new Error(INVALID_RECORD)
    }
    return {content, extension: 'sgf'}
  },
}
