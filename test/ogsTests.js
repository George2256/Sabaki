import assert from 'assert'
import {readFileSync} from 'fs'
import {createService} from '../src/online-games/index.js'
import {parse} from '../src/modules/fileformats/sgf.js'

const list = JSON.parse(
  readFileSync('test/resources/ogs-player-list.json', 'utf8'),
)
const content = readFileSync('test/sgf/ogs-game.sgf', 'utf8')
const player = {id: 1, username: 'anoek'}
const query = {provider: 'ogs', keyword: '1', mode: 'id'}

function fixture(responses) {
  const calls = []
  const service = createService({
    fetchImpl: async (url, options) => {
      calls.push({url, options})
      assert.ok(responses.length, `Unexpected request: ${url}`)
      const body = responses.shift()
      if (body instanceof Error) throw body
      return {
        ok: !body?.httpStatus,
        status: body?.httpStatus ?? 200,
        json: async () => body,
        text: async () => body,
      }
    },
  })
  return {service, calls}
}

describe('OGS game records', () => {
  it('finds real records by exact nickname and ID, then imports the original SGF', async () => {
    for (const [mode, keyword, info] of [
      ['nickname', 'anoek', {results: [player]}],
      ['id', '1', player],
    ]) {
      const {service, calls} = fixture([info, list, content])
      const data = await service.search({...query, mode, keyword})
      assert.deepEqual(data.user, {id: '1', name: 'anoek'})
      assert.deepEqual(data.games[0], {
        id: '88868859',
        black: 'Chaerogo',
        white: 'anoek',
        date: '2026-07-18',
        result: 'W+R',
        moves: null,
      })
      assert.equal(data.games[1].result, 'B+12.5')
      assert.equal(data.nextCursor, '2')
      assert.equal(calls.length, 2)
      assert.equal(
        calls[0].url.pathname,
        mode === 'id' ? '/api/v1/players/1/' : '/api/v1/players/',
      )
      if (mode === 'nickname')
        assert.equal(calls[0].url.searchParams.get('username'), keyword)
      assert.equal(calls[1].url.pathname, '/api/v1/players/1/games/')
      assert.equal(calls[1].url.searchParams.get('ended__isnull'), 'false')
      assert.equal(calls[1].url.searchParams.get('ordering'), '-ended')
      assert.equal(calls[1].url.searchParams.get('page_size'), '20')
      const record = await service.download({
        provider: 'ogs',
        id: data.games[0].id,
      })
      assert.equal(
        calls[2].url.href,
        'https://online-go.com/api/v1/games/88868859/sgf',
      )
      assert.equal(record.extension, 'sgf')
      const [tree] = parse(record.content)
      assert.equal(tree.root.data.PW[0], 'anoek')
      assert.equal(tree.root.data.PB[0], '한지석')
      assert.equal(tree.root.data.KM[0], '6.5')
      assert.equal(tree.root.data.RE[0], 'W+R')
      assert.equal(tree.getHeight() - 1, 23)
    }
  })

  it('treats numeric nicknames as exact usernames and refuses fuzzy results', async () => {
    const {service, calls} = fixture([
      {results: [{id: 2, username: '12345'}]},
      {results: [], next: null},
      {results: [{id: 3, username: 'anoek-other'}]},
    ])
    assert.deepEqual(
      (await service.search({...query, mode: 'nickname', keyword: '12345'}))
        .user,
      {id: '2', name: '12345'},
    )
    assert.equal(calls[0].url.searchParams.get('username'), '12345')
    await assert.rejects(
      service.search({...query, mode: 'nickname', keyword: 'anoek'}),
      /User not found/,
    )
  })

  it('requests subsequent pages through fixed endpoints and exposes only a page number', async () => {
    const {service, calls} = fixture([player, {...list, next: null}])
    const data = await service.search({...query, cursor: '2'})
    assert.equal(calls[1].url.searchParams.get('page'), '2')
    assert.equal(data.nextCursor, null)
    assert.equal(data.games.length, 2)
    for (const cursor of [
      'https://example.com/',
      '../2',
      '0',
      '-1',
      '1.5',
      {},
      2,
      '9007199254740992',
    ])
      await assert.rejects(
        service.search({...query, cursor}),
        /Invalid game history page/,
      )
    assert.equal(calls.length, 2)
    for (const next of [
      'https://example.com/?page=2',
      'https://online-go.com/api/v1/players/2/games/?page=2',
      'https://online-go.com/api/v1/players/1/games/?page=1',
      'https://online-go.com/api/v1/players/1/games/?page=abc',
    ]) {
      const {service, calls} = fixture([player, {...list, next}])
      await assert.rejects(service.search(query), /invalid response/)
      assert.equal(calls.length, 2)
    }
  })

  it('looks up official game and SGF links using the fixed game endpoint', async () => {
    for (const keyword of [
      'https://online-go.com/game/88868859',
      'http://www.online-go.com/game/88868859/?move=5#comments',
      'https://online-go.com/api/v1/games/88868859/sgf',
    ]) {
      const game = {
        ...list.results[0],
        gamedata: {
          players: {
            black: {username: '한지석'},
            white: {username: 'anoek'},
          },
          moves: Array(23).fill([0, 0]),
        },
      }
      const {service, calls} = fixture([game])
      const data = await service.search({...query, mode: 'link', keyword})
      assert.equal(data.user, null)
      assert.equal(data.games[0].moves, 23)
      assert.equal(data.games[0].black, '한지석')
      assert.equal(data.nextCursor, null)
      assert.equal(
        calls[0].url.href,
        'https://online-go.com/api/v1/games/88868859/',
      )
    }
    const {service, calls} = fixture([])
    for (const keyword of [
      'https://example.com/game/88868859',
      'https://online-go.com.example.com/game/88868859',
      'https://online-go.com/player/1',
      'https://online-go.com/game/0',
      'https://online-go.com/game/abc',
      'https://online-go.com:8080/game/1',
      'https://user:secret@online-go.com/game/1',
      'not a url',
    ])
      await assert.rejects(
        service.search({...query, mode: 'link', keyword}),
        /valid OGS game link/,
      )
    assert.equal(calls.length, 0)
    await assert.rejects(
      service.download({provider: 'ogs', id: '../1'}),
      /invalid game record/,
    )
    assert.equal(calls.length, 0)
  })

  it('normalizes resignations, timeouts, scored wins, ties and cancellations', async () => {
    const outcomes = [
      ['Resignation', false, true],
      ['Timeout', true, false],
      ['Disconnection', false, true],
      ['12.5 points', false, true],
      ['0.5 points', true, false],
      ['0 points', false, false],
      ['Cancellation', false, false],
      ['', false, true],
      ['Moderator decision', false, false],
    ]
    const {service} = fixture([
      player,
      {
        results: outcomes.map(([outcome, black_lost, white_lost], index) => ({
          ...list.results[0],
          id: index + 1,
          outcome,
          black_lost,
          white_lost,
        })),
        next: null,
      },
    ])
    assert.deepEqual(
      (await service.search(query)).games.map((game) => game.result),
      [
        'B+R',
        'W+T',
        'B+F',
        'B+12.5',
        'W+0.5',
        '0',
        'Void',
        'B',
        'Moderator decision',
      ],
    )
  })

  it('reports absent players, private games and rate limits with useful errors', async () => {
    const {service, calls} = fixture([
      {httpStatus: 404},
      {results: []},
      {httpStatus: 403},
      {httpStatus: 404},
      {httpStatus: 429},
    ])
    for (const keyword of ['abc', '0', '-1', '1/2'])
      await assert.rejects(
        service.search({...query, keyword}),
        /OGS player IDs/,
      )
    assert.equal(calls.length, 0)
    await assert.rejects(service.search(query), /User not found/)
    await assert.rejects(
      service.search({...query, mode: 'nickname', keyword: 'missing'}),
      /User not found/,
    )
    await assert.rejects(
      service.search({
        ...query,
        mode: 'link',
        keyword: 'https://online-go.com/game/1',
      }),
      /private or unavailable/,
    )
    await assert.rejects(
      service.download({provider: 'ogs', id: '1'}),
      /private or unavailable/,
    )
    await assert.rejects(service.search(query), /Too many requests/)
  })

  it('rejects malformed or unrelated player lists and mismatched game details', async () => {
    for (const response of [
      {},
      {results: {}},
      {results: [null]},
      {results: [{...list.results[0], black: 2, white: 3}]},
    ]) {
      const {service} = fixture([player, response])
      await assert.rejects(service.search(query), /invalid response/)
    }
    const {service} = fixture([{...list.results[0], id: 2}])
    await assert.rejects(
      service.search({
        ...query,
        mode: 'link',
        keyword: 'https://online-go.com/game/1',
      }),
      /invalid response/,
    )
  })

  it('deduplicates records and omits invalid game IDs', async () => {
    const {service} = fixture([
      player,
      {
        ...list,
        next: null,
        results: [
          list.results[0],
          list.results[0],
          {...list.results[0], id: null},
        ],
      },
    ])
    assert.equal((await service.search(query)).games.length, 1)
  })

  it('validates SGF text and preserves comments, moves and komi', async () => {
    const {service} = fixture([
      '\uFEFF' + content,
      '<html>error</html>',
      '(;GM[2])',
      '(;GM[1])(;GM[1])',
      '(;GM[1]C[broken)',
    ])
    assert.equal(
      (await service.download({provider: 'ogs', id: '88868859'})).content,
      content.trim(),
    )
    for (let i = 0; i < 4; i++)
      await assert.rejects(
        service.download({provider: 'ogs', id: '1'}),
        /invalid game record/,
      )
  })

  it('handles network failures and timeouts while reading SGF text', async () => {
    const {service} = fixture([new TypeError('fetch failed')])
    await assert.rejects(
      service.download({provider: 'ogs', id: '1'}),
      /connection/,
    )
    const timeout = createService({
      fetchImpl: async () => ({
        ok: true,
        text: async () => {
          throw Object.assign(new Error(), {name: 'TimeoutError'})
        },
      }),
    })
    await assert.rejects(
      timeout.download({provider: 'ogs', id: '1'}),
      /timed out/,
    )
  })
})
