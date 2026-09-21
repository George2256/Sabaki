// Fox's public chessbook API, adapted from GoAgent's services/fox.ts.
const BASE = 'https://h5.foxwq.com/yehuDiamond/chessbook_local'
const first = (...values) =>
  values.map((x) => String(x ?? '').trim()).find(Boolean) || ''

function result(item) {
  if (item.result) return String(item.result)
  const winner = {1: 'B', 2: 'W'}[item.winner]
  if (!winner) return ''
  const point = Number(item.point)
  const suffix =
    item.point == null || !Number.isFinite(point)
      ? ''
      : point === -1
        ? '+R'
        : point === -2
          ? '+T'
          : point < 0
            ? '+'
            : `+${point / 100}`
  return winner + suffix
}

module.exports = {
  id: 'fox',
  name: 'Fox Go',
  async search({keyword, mode}, request) {
    let user = {id: keyword, name: keyword}
    if (mode !== 'id') {
      const json = await request(
        'https://newframe.foxwq.com/cgi/QueryUserInfoPanel',
        {
          srcuid: '0',
          username: keyword,
        },
      )
      if (Number(json.result ?? json.errcode ?? -1) !== 0 || !json.uid) {
        throw new Error(
          'User not found. Check the nickname or try a player ID.',
        )
      }
      user = {
        id: String(json.uid),
        name: first(json.username, json.name, json.englishname, keyword),
      }
    } else if (!/^\d+$/.test(keyword)) {
      throw new Error('Fox player IDs must contain digits only.')
    }
    const json = await request(`${BASE}/YHWQFetchChessList`, {
      srcuid: '0',
      dstuid: user.id,
      type: '1',
      lastcode: '0',
      searchkey: '',
      uin: user.id,
    })
    if (json.result != null && Number(json.result) !== 0)
      throw new Error('The server could not load the games. Please try again.')
    const items = json.data ?? json.chesslist
    if (!Array.isArray(items))
      throw new Error('The server returned an invalid response.')
    const seen = new Set()
    const games = items
      .filter((item) => {
        const id = first(item?.chessid)
        if (!id || seen.has(id)) return false
        seen.add(id)
        return true
      })
      .map((item) => ({
        id: String(item.chessid),
        black: first(
          item.blacknick,
          item.blacknickname,
          item.blackname,
          item.blackenname,
        ),
        white: first(
          item.whitenick,
          item.whitenickname,
          item.whitename,
          item.whiteenname,
        ),
        date: first(item.starttime, item.dt),
        result: result(item),
        moves: /^\d+$/.test(String(item.movenum)) ? Number(item.movenum) : null,
      }))
    // This endpoint exposes a recent-games snapshot, not a verified history cursor.
    return {user, games, nextCursor: null}
  },
  async download({id}, request) {
    const json = await request(`${BASE}/YHWQFetchChess`, {chessid: id})
    const content =
      typeof json.chess === 'string'
        ? json.chess.replace(/^\uFEFF/, '').trim()
        : ''
    if (!/^\(\s*;/.test(content))
      throw new Error('The server returned an invalid game record.')
    return {content, extension: 'sgf'}
  },
}
