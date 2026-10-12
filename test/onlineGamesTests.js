import assert from 'assert'
import {readFileSync} from 'fs'
import {createService} from '../src/online-games/index.js'
import {parse} from '../src/modules/fileformats/sgf.js'

// Captured from the user's official Tencent AI-game share link.
const tencentGame = readFileSync('test/sgf/tencent-ai-game.sgf', 'utf8')
const tencentList = JSON.parse(
  readFileSync('test/resources/tencent-player-list.json', 'utf8'),
)

function fixture(responses) {
  const calls = []
  const service = createService({
    fetchImpl: async (url, options) => {
      calls.push({url, options})
      return {ok: true, json: async () => responses.shift()}
    },
  })
  return {service, calls}
}

describe('online game providers', () => {
  it('uses independent Tencent endpoints for numeric nicknames and downloads', async () => {
    const {service, calls} = fixture([
      {result: 0, uid: '35938987', username: '12345'},
      {
        result: 0,
        chesslist: [
          {
            chessid: '1566713791010001299',
            blackuid: 20855500,
            whiteuid: 35938987,
            blacknick: '星阵围棋',
            whitenick: '12345',
            starttime: '2019-08-25 11:21:41',
            winner: 2,
            point: -1,
            movenum: 246,
          },
        ],
      },
      {chess: '(;GM[1]PB[星阵围棋]PW[12345];B[pd];W[dd])'},
    ])
    assert.deepEqual(service.list(), [
      {id: 'fox', name: 'Fox Go'},
      {id: 'tencent', name: 'Tencent Go', modes: ['nickname', 'id', 'link']},
    ])
    const data = await service.search({
      provider: 'tencent',
      keyword: '12345',
      mode: 'nickname',
    })
    assert.equal(calls[0].url.hostname, 'wshall.huanle.qq.com')
    assert.equal(calls[0].url.searchParams.get('username'), '12345')
    assert.equal(calls[1].url.hostname, 'cgi.huanle.qq.com')
    assert.equal(calls[1].url.searchParams.get('username'), '12345')
    assert.equal(calls[1].url.searchParams.get('txwqsession'), '0')
    assert.deepEqual(data, {
      user: {id: '35938987', name: '12345'},
      games: [
        {
          id: '1566713791010001299',
          black: '星阵围棋',
          white: '12345',
          date: '2019-08-25 11:21:41',
          result: 'W+R',
          moves: 246,
        },
      ],
      nextCursor: null,
    })
    const downloaded = await service.download({
      provider: 'tencent',
      id: data.games[0].id,
    })
    assert.equal(calls[2].url.hostname, 'cgi.huanle.qq.com')
    assert.equal(
      calls[2].url.searchParams.get('chessid'),
      '1566713791010001299',
    )
    assert.equal(downloaded.extension, 'sgf')
    assert.match(downloaded.content, /PW\[12345\]/)
  })
  it('queries Tencent IDs directly and rejects nonnumeric IDs before fetching', async () => {
    const {service, calls} = fixture([
      {result: 0, uid: 35938987, username: 'George2256'},
      {result: 0, chesslist: []},
    ])
    await assert.rejects(
      service.search({provider: 'tencent', keyword: 'abc', mode: 'id'}),
      /Tencent player IDs must contain digits only/,
    )
    assert.equal(calls.length, 0)
    const data = await service.search({
      provider: 'tencent',
      keyword: '35938987',
      mode: 'id',
    })
    assert.equal(calls.length, 2)
    assert.equal(calls[0].url.searchParams.get('dstuid'), '35938987')
    assert.equal(data.user.name, 'George2256')
    assert.deepEqual(data.games, [])
  })
  it('finds the supplied real Tencent game by both nickname and ID', async () => {
    for (const [mode, keyword] of [
      ['nickname', 'George2256'],
      ['id', '35938987'],
    ]) {
      const {service, calls} = fixture([
        {result: 0, uid: 35938987, username: 'George2256'},
        tencentList,
        {result: 0, chess: tencentGame},
      ])
      const data = await service.search({provider: 'tencent', mode, keyword})
      assert.deepEqual(data.user, {id: '35938987', name: 'George2256'})
      assert.equal(calls[1].url.searchParams.get('txwqsession'), '0')
      assert.equal(data.notice, undefined)
      assert.equal(data.games.length, tencentList.chesslist.length)
      assert.deepEqual(data.games[0], {
        id: '1791815734932291925',
        black: 'George2256',
        white: '围棋精灵',
        date: '2026-10-12 21:47:10',
        result: 'B+R',
        moves: 149,
      })
      const downloaded = await service.download({
        provider: 'tencent',
        id: data.games[0].id,
      })
      const [tree] = parse(downloaded.content)
      assert.equal(tree.root.data.PB[0], data.games[0].black)
      assert.equal(tree.root.data.RE[0], data.games[0].result)
      assert.equal(tree.getHeight() - 1, data.games[0].moves)
    }
  })
  it('uses Tencent result reasons for resignation and timeout, and preserves scored wins', async () => {
    const results = [
      {winner: 1, reason: 3, point: 0},
      {winner: 2, reason: 2, point: 0},
      {winner: 1, reason: 14, point: 0},
      {winner: 1, reason: 1, point: 1475},
      {winner: 2, reason: 1, point: 625},
      {winner: 0, reason: 4, point: 0},
      {winner: 1},
    ]
    const {service} = fixture([
      {result: 0, uid: 35938987, username: 'George2256'},
      {
        result: 0,
        chesslist: results.map((fields, index) => ({
          ...fields,
          blackuid: 35938987,
          chessid: String(index + 1),
        })),
      },
    ])
    const data = await service.search({
      provider: 'tencent',
      keyword: 'George2256',
      mode: 'nickname',
    })
    assert.deepEqual(
      data.games.map((game) => game.result),
      ['B+R', 'W+T', 'B+T', 'B+14.75', 'W+6.25', '0', 'B'],
    )
  })
  it('preserves a verified Tencent player when its list endpoint rejects the request', async () => {
    const {service} = fixture([
      {result: 0, uid: 35938987, username: 'George2256'},
      {result: 1000002, resultstr: '参数不正确'},
    ])
    const data = await service.search({
      provider: 'tencent',
      keyword: 'George2256',
      mode: 'nickname',
    })
    assert.deepEqual(data.user, {id: '35938987', name: 'George2256'})
    assert.match(data.notice, /game list is currently unavailable/)
    assert.deepEqual(data.games, [])
  })
  it('does not present unrelated global Tencent games as a player search', async () => {
    const {service} = fixture([
      {result: 0, uid: 35938987, username: 'George2256'},
      {
        result: 0,
        chesslist: [{chessid: '1', blackuid: 1, whiteuid: 2}],
      },
    ])
    await assert.rejects(
      service.search({provider: 'tencent', keyword: '35938987', mode: 'id'}),
      /invalid response/,
    )
  })
  it('imports an official Tencent share link through a fixed endpoint', async () => {
    const {service, calls} = fixture([
      {
        result: 0,
        chess: tencentGame,
      },
    ])
    const data = await service.search({
      provider: 'tencent',
      keyword:
        'https://h5.txwq.qq.com/txwqshare/index.html?boardsize=19&chessid=1791815734932291925&title=%25E3%2580%2590AI%25E6%25A3%258B%25E8%25B0%25B1%25E3%2580%2591&desc=%25E5%259B%25B4%25E6%25A3%258B%25E7%25B2%25BE%25E7%2581%25B5%255B3%25E6%25AE%25B5%255D%20VS%20George2256%255B2%25E7%25BA%25A7%255D&catelog=7&statisticsShareType=4&clientType=13&channelId=1001&isdasai=0&havejieshuo=0',
      mode: 'link',
    })
    assert.equal(calls.length, 1)
    assert.equal(calls[0].url.hostname, 'cgi.huanle.qq.com')
    assert.equal(
      calls[0].url.searchParams.get('chessid'),
      '1791815734932291925',
    )
    assert.equal(data.games[0].black, 'George2256')
    assert.equal(data.games[0].white, '围棋精灵')
    assert.equal(data.games[0].date, '2026-10-12')
    assert.equal(data.games[0].result, 'B+R')
    assert.equal(data.games[0].moves, 149)
    assert.equal(data.user, null)
    const [tree] = parse(tencentGame)
    assert.equal(tree.root.data.SZ[0], '19')
    assert.equal(tree.root.data.KM[0], '7.5')
    assert.equal(tree.root.data.RE[0], 'B+R')
    assert.equal(tree.getHeight() - 1, 149)
  })
  it('rejects invalid Tencent users, links and downloads without fetching arbitrary URLs', async () => {
    const {service, calls} = fixture([
      {result: 0, uid: 0, username: ''},
      {result: 0, chess: '<html>error</html>'},
    ])
    for (const keyword of [
      'https://example.com/?chessid=123',
      'https://h5.txwq.qq.com.example.com/?chessid=123',
      'https://h5.txwq.qq.com/txwqshare/index.html?chessid=abc',
      'not a url',
    ])
      await assert.rejects(
        service.search({provider: 'tencent', keyword, mode: 'link'}),
        /valid Tencent game share link/,
      )
    assert.equal(calls.length, 0)
    assert.throws(
      () => service.search({provider: 'fox', keyword: 'a', mode: 'link'}),
      /Invalid search mode/,
    )
    await assert.rejects(
      service.search({
        provider: 'tencent',
        keyword: 'missing',
        mode: 'nickname',
      }),
      /User not found/,
    )
    await assert.rejects(
      service.download({provider: 'tencent', id: '123'}),
      /invalid game record/,
    )
  })
  it('resolves even numeric nicknames and normalizes alternate fields without losing ten-point results', async () => {
    const {service, calls} = fixture([
      {result: 0, uid: 123, username: '12345'},
      {
        result: 0,
        chesslist: [
          {
            chessid: 'a',
            blacknickname: '黑',
            whiteenname: 'White',
            winner: 1,
            point: 1000,
            movenum: '100',
          },
          {chessid: 'a'},
          {blacknick: 'missing id'},
        ],
      },
    ])
    const data = await service.search({
      provider: 'fox',
      keyword: '12345',
      mode: 'nickname',
    })
    assert.equal(calls[0].url.searchParams.get('username'), '12345')
    assert.equal(calls[1].url.searchParams.get('dstuid'), '123')
    assert.equal(data.games.length, 1)
    assert.equal(data.games[0].black, '黑')
    assert.equal(data.games[0].result, 'B+10')
    assert.equal(data.games[0].moves, 100)
    assert.equal(data.nextCursor, null)
  })
  it('queries IDs directly and allows an empty list', async () => {
    const {service, calls} = fixture([{data: []}])
    assert.deepEqual(
      (await service.search({provider: 'fox', keyword: '123', mode: 'id'}))
        .games,
      [],
    )
    assert.equal(calls.length, 1)
    await assert.rejects(
      service.search({provider: 'fox', keyword: 'abc', mode: 'id'}),
      /digits/,
    )
  })
  it('rejects missing users, server errors and malformed lists', async () => {
    for (const response of [{result: 1}, {result: 0}, {data: {}}]) {
      const {service} = fixture([response])
      await assert.rejects(
        service.search({provider: 'fox', keyword: '123', mode: 'id'}),
      )
    }
    const {service} = fixture([{result: 0, uid: ''}])
    await assert.rejects(
      service.search({provider: 'fox', keyword: 'name', mode: 'nickname'}),
      /User not found/,
    )
  })
  it('downloads SGF only and rejects invalid records', async () => {
    const {service} = fixture([
      {chess: '\uFEFF(;GM[1];B[aa])'},
      {chess: '<html>error</html>'},
    ])
    assert.deepEqual(await service.download({provider: 'fox', id: '1'}), {
      content: '(;GM[1];B[aa])',
      extension: 'sgf',
    })
    await assert.rejects(
      service.download({provider: 'fox', id: '2'}),
      /invalid game record/,
    )
  })
  it('validates provider and input before making a request', () => {
    const {service, calls} = fixture([])
    assert.throws(
      () => service.search({provider: 'other', keyword: 'a', mode: 'nickname'}),
      /Unknown/,
    )
    assert.throws(
      () => service.search({provider: 'fox', keyword: ' ', mode: 'nickname'}),
      /valid/,
    )
    assert.equal(calls.length, 0)
  })
  it('supports adding a provider without changing the consumer interface', async () => {
    const service = createService({
      providers: [
        {
          id: 'sample',
          name: 'Sample',
          search: async () => ({
            user: {id: '1', name: 'A'},
            games: [],
            nextCursor: 'next',
          }),
          download: async () => ({content: '(;)', extension: 'sgf'}),
        },
      ],
    })
    assert.deepEqual(service.list(), [{id: 'sample', name: 'Sample'}])
    assert.equal(
      (
        await service.search({
          provider: 'sample',
          keyword: 'a',
          mode: 'nickname',
        })
      ).nextCursor,
      'next',
    )
  })
  it('reports network and timeout failures', async () => {
    for (const [error, message] of [
      [new TypeError('fetch failed'), /connection/],
      [Object.assign(new Error(), {name: 'TimeoutError'}), /timed out/],
    ]) {
      const service = createService({
        fetchImpl: async () => {
          throw error
        },
      })
      await assert.rejects(
        service.search({provider: 'fox', keyword: '1', mode: 'id'}),
        message,
      )
    }
  })
})
