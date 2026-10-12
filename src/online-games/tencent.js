// Tencent Go (txwq.qq.com) has its own accounts and records. Do not query Fox:
// older shared accounts such as FineArt exist on both and hide this distinction.
const USER_INFO =
  'https://wshall.huanle.qq.com/wxnseed/txwq_fetch_personal_info'
const CHESS =
  'https://cgi.huanle.qq.com/happyapp/cgi-bin/CommonMobileCGI/TXWQFetchChess'
const LIST =
  'https://cgi.huanle.qq.com/happyapp/cgi-bin/CommonMobileCGI/TXWQFetchChessList'
const LIST_UNAVAILABLE =
  'Tencent found this player, but its game list is currently unavailable. Try a game share link.'

function result(item) {
  const winner = {1: 'B', 2: 'W'}[item.winner]
  if (!winner)
    return item.winner != null && Number(item.winner) === 0 ? '0' : ''
  const reason = Number(item.reason)
  const point = Number(item.point)
  if (reason === 3) return `${winner}+R`
  if (reason === 2 || reason === 14) return `${winner}+T`
  if (point === -1) return `${winner}+R`
  if (point === -2) return `${winner}+T`
  return item.point != null && Number.isFinite(point) && point >= 0
    ? `${winner}+${point / 100}`
    : winner
}

module.exports = {
  id: 'tencent',
  name: 'Tencent Go',
  modes: ['nickname', 'id', 'link'],
  async search({keyword, mode}, request) {
    if (mode === 'link') {
      let url
      try {
        url = new URL(keyword)
      } catch (_) {
        throw new Error('Enter a valid Tencent game share link.')
      }
      const id = url.searchParams.get('chessid')
      if (
        !['https:', 'http:'].includes(url.protocol) ||
        !['h5.txwq.qq.com', 'share.txwq.qq.com'].includes(url.hostname) ||
        !/^\d+$/.test(id || '')
      )
        throw new Error('Enter a valid Tencent game share link.')
      // Fetch only our fixed Tencent endpoint, never the supplied URL.
      const record = await this.download({id}, request)
      const sgf = require('@sabaki/sgf')
      const tree = sgf.parse(record.content)[0]
      const root = tree?.data
      if (!root) throw new Error('The server returned an invalid game record.')
      let moves = 0
      for (let node = tree; node; node = node.children[0])
        if (node.data.B || node.data.W) moves++
      return {
        user: null,
        games: [
          {
            id,
            black: root.PB?.[0] || '',
            white: root.PW?.[0] || '',
            date: root.DT?.[0] || '',
            result: root.RE?.[0] || '',
            moves,
          },
        ],
        nextCursor: null,
      }
    }
    if (mode === 'id' && !/^\d+$/.test(keyword))
      throw new Error('Tencent player IDs must contain digits only.')
    const info = await request(USER_INFO, {
      srcuid: '0',
      dstuid: mode === 'id' ? keyword : '0',
      dstuin: '0',
      username: mode === 'nickname' ? keyword : '',
      accounttype: '0',
      clienttype: '0',
    })
    if (
      Number(info.result ?? info.ret ?? -1) !== 0 ||
      !/^\d+$/.test(String(info.uid ?? '')) ||
      String(info.uid) === '0' ||
      !info.username
    )
      throw new Error('User not found. Check the nickname or try a player ID.')
    const user = {id: String(info.uid), name: String(info.username)}
    const json = await request(LIST, {
      type: '7',
      frommobile: '1',
      fetchnum: '20',
      srcuid: '0',
      username: user.name,
      lastCode: '0',
      // The mobile API requires a nonempty session field even for public
      // searches. Its anonymous value '0' is accepted without a login token.
      txwqsession: '0',
    })
    // Preserve a verified player when a server rejects the list request, rather
    // than claiming that the player has no games.
    if (Number(json.result ?? json.ret ?? -1) !== 0)
      return {user, games: [], nextCursor: null, notice: LIST_UNAVAILABLE}
    if (!Array.isArray(json.chesslist))
      throw new Error('The server returned an invalid response.')
    // Refuse an unfiltered global snapshot (FetchChessSummary can return one).
    if (
      json.chesslist.length &&
      json.chesslist.some(
        (item) =>
          String(item?.blackuid) !== user.id &&
          String(item?.whiteuid) !== user.id,
      )
    )
      throw new Error('The server returned an invalid response.')
    const seen = new Set()
    const games = json.chesslist
      .filter((item) => {
        const id = String(item?.chessid ?? '')
        if (!/^\d+$/.test(id) || seen.has(id)) return false
        seen.add(id)
        return true
      })
      .map((item) => ({
        id: String(item.chessid),
        black: String(item.blacknick ?? item.blackenname ?? ''),
        white: String(item.whitenick ?? item.whiteenname ?? ''),
        date: String(item.starttime ?? ''),
        result: result(item),
        moves: /^\d+$/.test(String(item.movenum)) ? Number(item.movenum) : null,
      }))
    return {user, games, nextCursor: null}
  },
  async download({id}, request) {
    if (!/^\d+$/.test(id))
      throw new Error('The server returned an invalid game record.')
    const json = await request(CHESS, {chessid: id})
    const content =
      typeof json.chess === 'string'
        ? json.chess.replace(/^\uFEFF/, '').trim()
        : ''
    if (Number(json.result ?? 0) !== 0 || !/^\(\s*;/.test(content))
      throw new Error('The server returned an invalid game record.')
    return {content, extension: 'sgf'}
  },
}
