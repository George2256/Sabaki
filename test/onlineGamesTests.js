import assert from 'assert'
import {createService} from '../src/online-games/index.js'

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
