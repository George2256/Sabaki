const {expect} = require('@playwright/test')
const {test} = require('./fixtures/electron-app')
const {readFileSync} = require('fs')
const path = require('path')

const tencentGame = readFileSync(
  path.resolve(__dirname, '../test/sgf/tencent-ai-game.sgf'),
  'utf8',
)
const tencentList = JSON.parse(
  readFileSync(
    path.resolve(__dirname, '../test/resources/tencent-player-list.json'),
    'utf8',
  ),
)
const ogsGame = readFileSync(
  path.resolve(__dirname, '../test/sgf/ogs-game.sgf'),
  'utf8',
)
const ogsList = JSON.parse(
  readFileSync(
    path.resolve(__dirname, '../test/resources/ogs-player-list.json'),
    'utf8',
  ),
)

async function prepareOgs(electronApp, page) {
  // Exercise the real IPC service and OGS adapter, replacing only HTTP responses.
  await electronApp.evaluate(
    (_, {list, content}) => {
      global.__ogsRequests = []
      global.fetch = async (url) => {
        const endpoint = new URL(url)
        global.__ogsRequests.push(String(url))
        if (endpoint.hostname !== 'online-go.com')
          throw new Error('Unexpected server')
        let data
        let status = 200
        if (endpoint.pathname === '/api/v1/players/') {
          data = {
            results:
              endpoint.searchParams.get('username') === 'anoek'
                ? [{id: 1, username: 'anoek'}]
                : [],
          }
        } else if (endpoint.pathname === '/api/v1/players/1/') {
          data = {id: 1, username: 'anoek'}
        } else if (endpoint.pathname === '/api/v1/players/1/games/') {
          if (endpoint.searchParams.get('page') === '2') {
            if (global.__ogsFailPage) {
              global.__ogsFailPage = false
              status = 503
            }
            data = {
              ...list,
              next: null,
              results: [
                list.results[0],
                {
                  ...list.results[1],
                  id: 3,
                  players: {
                    black: {username: 'Next page'},
                    white: {username: 'anoek'},
                  },
                },
              ],
            }
          } else data = list
        } else if (endpoint.pathname === '/api/v1/games/88868859/') {
          data = {
            ...list.results[0],
            gamedata: {
              players: {
                black: {username: '한지석'},
                white: {username: 'anoek'},
              },
              moves: Array(23).fill([0, 0]),
            },
          }
        } else if (endpoint.pathname === '/api/v1/games/88868859/sgf') {
          data = content
        } else if (endpoint.pathname === '/api/v1/games/404/') {
          status = 403
        } else throw new Error(`Unexpected request: ${endpoint}`)
        return {
          ok: status === 200,
          status,
          json: async () => data,
          text: async () => data,
        }
      }
    },
    {list: ogsList, content: ogsGame},
  )
  await page.evaluate(() => window.__sabaki.openDrawer('onlinegames'))
  await expect(page.locator('#onlinegames select').first()).toHaveValue('fox')
  await page.locator('#onlinegames select').first().selectOption('ogs')
}

test('OGS nickname and ID searches paginate, retry errors and import SGF through the real adapter', async ({
  electronApp,
  page,
}) => {
  await prepareOgs(electronApp, page)
  for (const [mode, keyword] of [
    ['nickname', 'anoek'],
    ['id', '1'],
  ]) {
    await page.locator('#onlinegames select').nth(1).selectOption(mode)
    await page.locator('#onlinegames input').fill(keyword)
    await page.locator('#onlinegames button[type=submit]').click()
    await expect(page.locator('#onlinegames tbody tr')).toHaveCount(2)
    await expect(page.locator('#onlinegames .online-status')).toContainText(
      'anoek · ID 1 · 2 games',
    )
    await expect(page.locator('#onlinegames tbody tr').first()).toContainText(
      'W+R',
    )
    await expect(page.locator('#onlinegames [role=alert]')).toHaveCount(0)
  }
  await electronApp.evaluate(() => {
    global.__ogsFailPage = true
  })
  await page.getByRole('button', {name: 'Load more', exact: true}).click()
  await expect(page.locator('#onlinegames [role=alert]')).toContainText(
    'unavailable',
  )
  await expect(page.locator('#onlinegames tbody tr')).toHaveCount(2)
  await page.getByRole('button', {name: 'Load more', exact: true}).click()
  await expect(page.locator('#onlinegames tbody tr')).toHaveCount(3)
  await expect(page.locator('#onlinegames tbody')).toContainText('Next page')
  await expect(page.locator('#onlinegames [role=alert]')).toHaveCount(0)
  await expect(page.locator('#onlinegames .online-pagination')).toHaveCount(0)
  await page.screenshot({path: 'test-results/online-games-ogs.png'})
  await page.locator('#onlinegames tbody button').first().click()
  await expect(page.locator('#onlinegames')).not.toHaveClass(/show/)
  const imported = await page.evaluate(() => {
    const tree = window.__sabaki.state.gameTrees[0]
    return {
      black: tree.root.data.PB[0],
      white: tree.root.data.PW[0],
      size: tree.root.data.SZ[0],
      komi: tree.root.data.KM[0],
      result: tree.root.data.RE[0],
      moves: tree.getHeight() - 1,
    }
  })
  expect(imported).toEqual({
    black: '한지석',
    white: 'anoek',
    size: '9',
    komi: '6.5',
    result: 'W+R',
    moves: 23,
  })
  const requests = await electronApp.evaluate(() => global.__ogsRequests)
  expect(requests.filter((url) => url.includes('/sgf'))).toHaveLength(1)
  expect(
    requests.filter((url) => new URL(url).searchParams.get('page') === '2'),
  ).toHaveLength(2)
})

test('OGS links show historical names and move counts, and provider changes clear pagination', async ({
  electronApp,
  page,
}) => {
  await prepareOgs(electronApp, page)
  await page.locator('#onlinegames input').fill('anoek')
  await page.locator('#onlinegames button[type=submit]').click()
  await expect(page.locator('#onlinegames .online-pagination')).toHaveCount(1)
  await page.locator('#onlinegames select').nth(1).selectOption('link')
  await expect(page.locator('#onlinegames input')).toHaveAttribute(
    'placeholder',
    'Paste an OGS game link',
  )
  await expect(page.locator('#onlinegames .online-pagination')).toHaveCount(0)
  await expect(page.locator('#onlinegames tbody tr')).toHaveCount(0)
  await page
    .locator('#onlinegames input')
    .fill('https://online-go.com/game/88868859')
  await page.locator('#onlinegames button[type=submit]').click()
  await expect(page.locator('#onlinegames tbody tr')).toHaveCount(1)
  await expect(page.locator('#onlinegames tbody')).toContainText('한지석')
  await expect(page.locator('#onlinegames tbody')).toContainText('23')
  await page.locator('#onlinegames tbody button').click()
  await expect(page.locator('#onlinegames')).not.toHaveClass(/show/)
  await page.evaluate(() => window.__sabaki.openDrawer('onlinegames'))
  await page.locator('#onlinegames select').first().selectOption('tencent')
  await expect(page.locator('#onlinegames .online-pagination')).toHaveCount(0)
  await expect(page.locator('#onlinegames tbody tr')).toHaveCount(0)
  await page.locator('#onlinegames select').nth(1).selectOption('link')
  await expect(page.locator('#onlinegames input')).toHaveAttribute(
    'placeholder',
    'Paste a Tencent game share link',
  )
})

test('OGS invalid IDs, missing nicknames and private games show actionable errors', async ({
  electronApp,
  page,
}) => {
  await prepareOgs(electronApp, page)
  for (const [mode, keyword, error] of [
    ['id', 'abc', 'greater than zero'],
    ['nickname', 'missing', 'User not found'],
    ['link', 'https://example.com/game/1', 'valid OGS game link'],
    ['link', 'https://online-go.com/game/404', 'private or unavailable'],
  ]) {
    await page.locator('#onlinegames select').nth(1).selectOption(mode)
    await page.locator('#onlinegames input').fill(keyword)
    await page.locator('#onlinegames button[type=submit]').click()
    await expect(page.locator('#onlinegames [role=alert]')).toContainText(error)
    await expect(page.locator('#onlinegames button[type=submit]')).toBeEnabled()
  }
  expect(await electronApp.evaluate(() => global.__ogsRequests.length)).toBe(2)
})

async function prepare(electronApp, page) {
  await electronApp.evaluate(({ipcMain}) => {
    ipcMain.removeHandler('onlineGames:search')
    ipcMain.handle('onlineGames:search', (_, input) => {
      global.__onlineSearchProvider = input.provider
      global.__onlineSearchMode = input.mode
      if (input.keyword === 'tencent-list')
        return {
          ok: true,
          data: {
            user: {id: '35938987', name: 'George2256'},
            games: [],
            notice:
              'Tencent found this player, but its game list is currently unavailable. Try a game share link.',
          },
        }
      return input.keyword === 'empty'
        ? {ok: true, data: {user: {id: '42', name: 'empty'}, games: []}}
        : input.keyword === 'error'
          ? {ok: false, error: 'The request timed out. Please try again.'}
          : {
              ok: true,
              data: {
                user: {id: '42', name: '测试棋手'},
                games: [
                  {
                    id: '1',
                    black: '测试棋手',
                    white: '对手',
                    date: '2026-09-21',
                    result: 'B+R',
                    moves: 123,
                  },
                ],
              },
            }
    })
    ipcMain.removeHandler('onlineGames:download')
    ipcMain.handle('onlineGames:download', async (_, input) => {
      global.__onlineDownloadProvider = input.provider
      return {
        ok: true,
        data: {
          content: '(;GM[1]SZ[19]PB[测试棋手]PW[对手];B[pd];W[dd])',
          extension: 'sgf',
        },
      }
    })
  })
  await page.evaluate(() => window.__sabaki.openDrawer('onlinegames'))
  await expect(page.locator('#onlinegames select').first()).toHaveValue('fox')
}

test('search, show result and import a remote game', async ({
  electronApp,
  page,
}) => {
  await prepare(electronApp, page)
  await page.locator('#onlinegames input').fill('测试棋手')
  await page.locator('#onlinegames button[type=submit]').click()
  await expect(page.locator('#onlinegames tbody tr')).toHaveCount(1)
  await expect(page.locator('#onlinegames tbody')).toContainText('测试棋手')
  await page.screenshot({path: 'test-results/online-games.png'})
  await page.locator('#onlinegames tbody button').click()
  await expect(page.locator('#onlinegames')).not.toHaveClass(/show/)
  expect(
    await page.evaluate(
      () => window.__sabaki.state.gameTrees[0].root.data.PB[0],
    ),
  ).toBe('测试棋手')
})

test('empty results and request errors remain recoverable', async ({
  electronApp,
  page,
}) => {
  await prepare(electronApp, page)
  for (const query of ['empty', 'error', 'player']) {
    await page.locator('#onlinegames input').fill(query)
    await page.locator('#onlinegames button[type=submit]').click()
    if (query === 'empty')
      await expect(page.locator('#onlinegames .online-empty')).toContainText(
        'No recent games',
      )
    else if (query === 'error')
      await expect(page.locator('#onlinegames [role=alert]')).toContainText(
        'timed out',
      )
    else await expect(page.locator('#onlinegames tbody tr')).toHaveCount(1)
  }
})

test('Tencent selection searches and imports through the selected provider', async ({
  electronApp,
  page,
}) => {
  await prepare(electronApp, page)
  await page.locator('#onlinegames select').first().selectOption('tencent')
  await page.locator('#onlinegames select').nth(1).selectOption('link')
  await page
    .locator('#onlinegames input')
    .fill(
      'https://h5.txwq.qq.com/txwqshare/index.html?chessid=1791816699030102047',
    )
  await page.locator('#onlinegames button[type=submit]').click()
  await expect(page.locator('#onlinegames tbody tr')).toHaveCount(1)
  expect(await electronApp.evaluate(() => global.__onlineSearchProvider)).toBe(
    'tencent',
  )
  expect(await electronApp.evaluate(() => global.__onlineSearchMode)).toBe(
    'link',
  )
  await page.locator('#onlinegames tbody button').click()
  await expect(page.locator('#onlinegames')).not.toHaveClass(/show/)
  expect(
    await electronApp.evaluate(() => global.__onlineDownloadProvider),
  ).toBe('tencent')
  expect(
    await page.evaluate(
      () => window.__sabaki.state.gameTrees[0].root.data.PB[0],
    ),
  ).toBe('测试棋手')
})

test('Tencent nickname and ID searches use the real adapter and import the supplied game', async ({
  electronApp,
  page,
}) => {
  // Keep the real IPC handlers and provider; intercept only the network.
  await electronApp.evaluate(
    (_, {list, content}) => {
      global.__tencentRequests = []
      global.fetch = async (url) => {
        global.__tencentRequests.push(String(url))
        const endpoint = new URL(url)
        const data = endpoint.pathname.endsWith('/txwq_fetch_personal_info')
          ? {result: 0, uid: 35938987, username: 'George2256'}
          : endpoint.pathname.endsWith('/TXWQFetchChessList')
            ? list
            : endpoint.pathname.endsWith('/TXWQFetchChess')
              ? {result: 0, chess: content}
              : null
        if (!data) throw new Error(`Unexpected request: ${endpoint.pathname}`)
        return {ok: true, json: async () => data}
      }
    },
    {list: tencentList, content: tencentGame},
  )
  await page.evaluate(() => window.__sabaki.openDrawer('onlinegames'))
  await expect(page.locator('#onlinegames select').first()).toHaveValue('fox')
  await page.locator('#onlinegames select').first().selectOption('tencent')
  for (const [mode, keyword] of [
    ['nickname', 'George2256'],
    ['id', '35938987'],
  ]) {
    await page.locator('#onlinegames select').nth(1).selectOption(mode)
    await page.locator('#onlinegames input').fill(keyword)
    await page.locator('#onlinegames button[type=submit]').click()
    await expect(page.locator('#onlinegames tbody tr')).toHaveCount(
      tencentList.chesslist.length,
    )
    await expect(page.locator('#onlinegames .online-status')).toContainText(
      'George2256 · ID 35938987',
    )
    await expect(page.locator('#onlinegames [role=alert]')).toHaveCount(0)
    await expect(page.locator('#onlinegames tbody tr').first()).toContainText(
      'B+R',
    )
    await expect(page.locator('#onlinegames tbody tr').first()).toContainText(
      '149',
    )
    await expect(page.locator('#onlinegames button[type=submit]')).toBeEnabled()
  }
  const calls = await electronApp.evaluate(() => global.__tencentRequests)
  expect(calls).toHaveLength(4)
  for (const request of calls.filter((url) => url.includes('FetchChessList'))) {
    const url = new URL(request)
    expect(url.hostname).toBe('cgi.huanle.qq.com')
    expect(url.searchParams.get('username')).toBe('George2256')
    expect(url.searchParams.get('txwqsession')).toBe('0')
  }
  await page.locator('#onlinegames tbody button').first().click()
  await expect(page.locator('#onlinegames')).not.toHaveClass(/show/)
  const game = await page.evaluate(() => {
    const tree = window.__sabaki.state.gameTrees[0]
    return {
      black: tree.root.data.PB[0],
      white: tree.root.data.PW[0],
      komi: tree.root.data.KM[0],
      result: tree.root.data.RE[0],
      moves: tree.getHeight() - 1,
    }
  })
  expect(game).toEqual({
    black: 'George2256',
    white: '围棋精灵',
    komi: '7.5',
    result: 'B+R',
    moves: 149,
  })
})

test('Tencent list failures preserve the player and do not claim there are no games', async ({
  electronApp,
  page,
}) => {
  await prepare(electronApp, page)
  await page.locator('#onlinegames select').first().selectOption('tencent')
  await page.locator('#onlinegames input').fill('tencent-list')
  await page.locator('#onlinegames button[type=submit]').click()
  await expect(page.locator('#onlinegames .online-status')).toHaveText(
    'George2256 · ID 35938987',
  )
  await expect(page.locator('#onlinegames [role=alert]')).toContainText(
    'game list is currently unavailable',
  )
  await expect(page.locator('#onlinegames .online-empty')).toHaveText(
    'Game records could not be loaded.',
  )
  await page.locator('#onlinegames select').nth(1).selectOption('link')
  await page
    .locator('#onlinegames input')
    .fill(
      'https://h5.txwq.qq.com/txwqshare/index.html?chessid=1791816699030102047',
    )
  await page.locator('#onlinegames button[type=submit]').click()
  await expect(page.locator('#onlinegames [role=alert]')).toHaveCount(0)
  await expect(page.locator('#onlinegames tbody tr')).toHaveCount(1)
  await page.locator('#onlinegames select').first().selectOption('fox')
  await expect(page.locator('#onlinegames select').nth(1)).toHaveValue(
    'nickname',
  )
  await expect(page.locator('#onlinegames option[value=link]')).toHaveCount(0)
})

for (const [language, title, search, timeout] of [
  ['zh-Hans', '网棋棋谱', '查询', '请求超时'],
  ['zh-Hant', '網棋棋譜', '查詢', '請求逾時'],
]) {
  test.describe(language, () => {
    test.use({appLanguage: language})
    test('localized panel and errors', async ({electronApp, page}) => {
      await prepare(electronApp, page)
      await expect(page.locator('#onlinegames h2')).toHaveText(title)
      await expect(
        page.locator('#onlinegames option[value=tencent]'),
      ).toHaveText(language === 'zh-Hans' ? '腾讯围棋' : '騰訊圍棋')
      await expect(page.locator('#onlinegames option[value=ogs]')).toHaveText(
        'OGS（Online-Go.com）',
      )
      await page.locator('#onlinegames select').first().selectOption('ogs')
      await page.locator('#onlinegames select').nth(1).selectOption('link')
      await expect(page.locator('#onlinegames input')).toHaveAttribute(
        'placeholder',
        language === 'zh-Hans' ? '粘贴 OGS 对局链接' : '貼上 OGS 對局連結',
      )
      await page.locator('#onlinegames select').nth(1).selectOption('nickname')
      await expect(page.locator('#onlinegames button[type=submit]')).toHaveText(
        search,
      )
      await page.locator('#onlinegames input').fill('error')
      await page.locator('#onlinegames button[type=submit]').click()
      await expect(page.locator('#onlinegames [role=alert]')).toContainText(
        timeout,
      )
      await page.locator('#onlinegames input').fill('测试棋手')
      await page.locator('#onlinegames button[type=submit]').click()
      await expect(page.locator('#onlinegames tbody tr')).toHaveCount(1)
      await page.screenshot({path: `test-results/online-games-${language}.png`})
    })
  })
}

test('closing the drawer discards an in-flight download', async ({
  electronApp,
  page,
}) => {
  await prepare(electronApp, page)
  await electronApp.evaluate(({ipcMain}) => {
    ipcMain.removeHandler('onlineGames:download')
    ipcMain.handle(
      'onlineGames:download',
      () =>
        new Promise((resolve) => {
          global.__finishOnlineDownload = () =>
            resolve({
              ok: true,
              data: {content: '(;PB[Should not load])', extension: 'sgf'},
            })
        }),
    )
  })
  await page.locator('#onlinegames input').fill('player')
  await page.locator('#onlinegames button[type=submit]').click()
  await page.locator('#onlinegames tbody button').click()
  await expect(page.locator('#onlinegames tbody button')).toContainText(
    'Downloading',
  )
  await page.locator('#onlinegames .online-footer button').click()
  await expect(page.locator('#onlinegames')).not.toHaveClass(/show/)
  await electronApp.evaluate(() => global.__finishOnlineDownload())
  await page.evaluate(() => window.__sabaki.openDrawer('onlinegames'))
  await expect(page.locator('#onlinegames tbody button')).toBeEnabled()
  expect(
    await page.evaluate(() => window.__sabaki.state.gameTrees[0].root.data.PB),
  ).toBeUndefined()
})

test('canceling the save prompt preserves the current game', async ({
  electronApp,
  page,
}) => {
  await prepare(electronApp, page)
  await page.evaluate(() => window.__sabaki.makeMove([3, 3]))
  const original = await page.evaluate(
    () => window.__sabaki.state.gameTrees[0].root.id,
  )
  await electronApp.evaluate(({dialog}) => {
    dialog.showMessageBox = async () => ({response: 2})
  })
  await page.locator('#onlinegames input').fill('player')
  await page.locator('#onlinegames button[type=submit]').click()
  await page.locator('#onlinegames tbody button').click()
  await expect(page.locator('#onlinegames tbody button')).toBeEnabled()
  expect(
    await page.evaluate(() => window.__sabaki.state.gameTrees[0].root.id),
  ).toBe(original)
  await expect(page.locator('#onlinegames')).toHaveClass(/show/)
})
