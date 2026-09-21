const {expect} = require('@playwright/test')
const {test} = require('./fixtures/electron-app')

async function prepare(electronApp, page) {
  await electronApp.evaluate(({ipcMain}) => {
    ipcMain.removeHandler('onlineGames:search')
    ipcMain.handle('onlineGames:search', (_, input) =>
      input.keyword === 'empty'
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
            },
    )
    ipcMain.removeHandler('onlineGames:download')
    ipcMain.handle('onlineGames:download', async () => ({
      ok: true,
      data: {
        content: '(;GM[1]SZ[19]PB[测试棋手]PW[对手];B[pd];W[dd])',
        extension: 'sgf',
      },
    }))
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

for (const [language, title, search, timeout] of [
  ['zh-Hans', '网棋棋谱', '查询', '请求超时'],
  ['zh-Hant', '網棋棋譜', '查詢', '請求逾時'],
]) {
  test.describe(language, () => {
    test.use({appLanguage: language})
    test('localized panel and errors', async ({electronApp, page}) => {
      await prepare(electronApp, page)
      await expect(page.locator('#onlinegames h2')).toHaveText(title)
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
