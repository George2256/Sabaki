const {expect} = require('@playwright/test')
const {test} = require('./fixtures/electron-app')
const {loadSgfStringAndWait, detachAndWait} = require('./helpers')
const path = require('path')
const engine = {
  name: 'Automatic replay',
  path: process.execPath,
  args: [
    path.resolve(__dirname, '../test/engines/replayEngine.js'),
    '--transcript',
    path.resolve(
      __dirname,
      '../test/resources/engine-transcripts/katago-1.16.4/endgame-9.kata-analyze.txt',
    ),
  ]
    .map((x) => JSON.stringify(x))
    .join(' '),
}

async function prepare(
  electronApp,
  page,
  {ready = false, supported = true, delayed = false} = {},
) {
  await loadSgfStringAndWait(page, '(;SZ[9]KM[7.5];B[aa];W[bb])')
  await electronApp.evaluate(
    ({ipcMain}, {engine, ready, supported, delayed}) => {
      let phase = ready ? 'ready' : 'idle'
      let attempts = 0
      for (const method of ['status', 'install', 'cancel'])
        ipcMain.removeHandler('engineSetup:' + method)
      ipcMain.handle('engineSetup:status', () => ({
        ok: true,
        data: {phase, supported, engine: ready ? engine : null},
      }))
      ipcMain.handle('engineSetup:install', async (event) => {
        attempts++
        phase = 'downloading'
        event.sender.send('engineSetup:change', {
          phase,
          supported,
          source: 'Tsinghua mirror',
          package: 1,
          packages: 7,
          received: 5,
          total: 10,
        })
        if (delayed)
          return new Promise((resolve) => {
            global.__finishEngineSetup = () => {
              phase = 'ready'
              resolve({ok: true, data: engine})
            }
          })
        if (attempts === 1) {
          phase = 'error'
          return {
            ok: false,
            error:
              'Unable to download. Please check your connection and retry.',
          }
        }
        phase = 'ready'
        event.sender.send('engineSetup:change', {phase, supported, engine})
        return {ok: true, data: engine}
      })
      ipcMain.handle('engineSetup:cancel', (event) => {
        phase = 'canceled'
        event.sender.send('engineSetup:change', {phase, supported})
        return {ok: true}
      })
    },
    {engine, ready, supported, delayed},
  )
}

test('first analysis opens setup, download failure can be retried and the game is analyzed', async ({
  electronApp,
  page,
}) => {
  await prepare(electronApp, page)
  await page.locator('#bar .analyze-game').click()
  await expect(page.locator('#enginesetup')).toHaveClass(/show/)
  await expect(page.locator('#enginesetup .primary')).toHaveText(
    'Prepare and analyze',
  )
  await page.locator('#enginesetup .primary').click()
  await expect(page.locator('#enginesetup [role=alert]')).toContainText(
    'Unable to download',
  )
  await expect(page.locator('#enginesetup .primary')).toHaveText('Try again')
  await page.locator('#enginesetup .primary').click()
  await expect(page.locator('#enginesetup')).not.toHaveClass(/show/)
  await page.waitForFunction(
    () => window.__sabaki.state.batchAnalysis?.completed === 3,
  )
  expect(
    await page.evaluate(() =>
      window.__sabaki.inferredState.winrateData.every(Number.isFinite),
    ),
  ).toBe(true)
  const ids = await page.evaluate(() =>
    window.__sabaki.state.attachedEngineSyncers.map((x) => x.id),
  )
  await detachAndWait(page, ids)
})

test('an already prepared engine starts analysis without another download', async ({
  electronApp,
  page,
}) => {
  await prepare(electronApp, page, {ready: true})
  await page.locator('#bar .analyze-game').click()
  await page.waitForFunction(
    () => window.__sabaki.state.batchAnalysis?.completed === 3,
  )
  await expect(page.locator('#enginesetup')).not.toHaveClass(/show/)
  expect(
    await page.evaluate(
      () => window.__sabaki.state.attachedEngineSyncers.length,
    ),
  ).toBe(1)
})

for (const stopped of [false, true])
  test(`a saved KataGo ${stopped ? 'that is stopped' : 'that is not loaded'} is loaded without setup or downloads`, async ({
    electronApp,
    page,
  }) => {
    await prepare(electronApp, page)
    const configured = {...engine, name: 'KataGo'}
    await page.evaluate(
      async ({configured, stopped}) => {
        await window.sabaki.setting.set('engines.list', [configured])
        if (stopped) {
          const [syncer] = window.__sabaki.attachEngines([configured])
          await syncer.queueCommand({name: 'list_commands', args: []})
          await syncer.stop()
        }
      },
      {configured, stopped},
    )
    await electronApp.evaluate(({ipcMain}) => {
      global.__setupRequests = []
      for (const method of ['status', 'install']) {
        ipcMain.removeHandler('engineSetup:' + method)
        ipcMain.handle('engineSetup:' + method, () => {
          global.__setupRequests.push(method)
          return {ok: false, error: 'Unexpected setup request'}
        })
      }
    })
    await page.locator('#bar .analyze-game').click()
    await page.waitForFunction(
      () => window.__sabaki.state.batchAnalysis?.completed === 3,
    )
    await expect(page.locator('#enginesetup')).not.toHaveClass(/show/)
    expect(await electronApp.evaluate(() => global.__setupRequests)).toEqual([])
    expect(
      await page.evaluate(
        () => window.__sabaki.state.attachedEngineSyncers.length,
      ),
    ).toBe(1)
    expect(
      await page.evaluate(() => window.sabaki.setting.get('engines.list')),
    ).toEqual([configured])
  })

test('a failed saved engine connection retries the existing engine without downloading', async ({
  electronApp,
  page,
}) => {
  await prepare(electronApp, page)
  await page.evaluate(async (engine) => {
    await window.sabaki.setting.set('engines.list', [
      {...engine, name: 'KataGo', path: '/nonexistent/katago'},
    ])
  }, engine)
  await electronApp.evaluate(({ipcMain}) => {
    global.__downloads = 0
    ipcMain.removeHandler('engineSetup:install')
    ipcMain.handle('engineSetup:install', () => {
      global.__downloads++
      return {ok: false}
    })
  })
  await page.locator('#bar .analyze-game').click()
  await expect(page.locator('#enginesetup [role=alert]')).toContainText(
    'Unable to connect',
  )
  await expect(page.locator('#enginesetup')).not.toContainText('380 MB')
  await page.locator('#enginesetup .primary').click()
  await expect(page.locator('#enginesetup [role=alert]')).toContainText(
    'Unable to connect',
  )
  expect(await electronApp.evaluate(() => global.__downloads)).toBe(0)
})

test('a discovered local engine is configured and analyzed on systems without bundled downloads', async ({
  electronApp,
  page,
}) => {
  await prepare(electronApp, page, {supported: false})
  await electronApp.evaluate(({ipcMain}, engine) => {
    ipcMain.removeHandler('engineSetup:status')
    ipcMain.handle('engineSetup:status', () => ({
      ok: true,
      data: {
        phase: 'local',
        supported: false,
        engine,
        existing: true,
        local: true,
      },
    }))
    ipcMain.removeHandler('engineSetup:install')
    ipcMain.handle('engineSetup:install', () => ({ok: true, data: engine}))
  }, engine)
  await page.locator('#bar .analyze-game').click()
  await page.waitForFunction(
    () => window.__sabaki.state.batchAnalysis?.completed === 3,
  )
  await expect(page.locator('#enginesetup')).not.toHaveClass(/show/)
})

test('canceling setup ignores a late completion and leaves the game untouched', async ({
  electronApp,
  page,
}) => {
  await prepare(electronApp, page, {delayed: true})
  await page.locator('#bar .analyze-game').click()
  await page.locator('#enginesetup .primary').click()
  await expect(page.locator('#enginesetup progress')).toHaveAttribute(
    'value',
    '50',
  )
  await page
    .locator('#enginesetup')
    .getByRole('button', {name: 'Cancel', exact: true})
    .click()
  await expect(page.locator('#enginesetup')).not.toHaveClass(/show/)
  await electronApp.evaluate(() => global.__finishEngineSetup())
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 100)))
  expect(
    await page.evaluate(() => ({
      engines: window.__sabaki.state.attachedEngineSyncers.length,
      analysis: window.__sabaki.state.batchAnalysis,
    })),
  ).toEqual({engines: 0, analysis: null})
})

test('changing the game during setup prevents analysis of the replacement', async ({
  electronApp,
  page,
}) => {
  await prepare(electronApp, page, {delayed: true})
  await page.locator('#bar .analyze-game').click()
  await page.locator('#enginesetup .primary').click()
  await expect(page.locator('#enginesetup progress')).toHaveAttribute(
    'value',
    '50',
  )
  await page.evaluate(async () => {
    const s = window.__sabaki
    await s.loadContent('(;SZ[9]PB[Replacement];B[hh])', 'sgf', {
      suppressAskForSave: true,
    })
  })
  await electronApp.evaluate(() => global.__finishEngineSetup())
  await expect(page.locator('#enginesetup')).not.toHaveClass(/show/)
  expect(
    await page.evaluate(() => window.__sabaki.state.batchAnalysis),
  ).toBeNull()
})

test('unsupported systems have a clear explanation and no download button', async ({
  electronApp,
  page,
}) => {
  await prepare(electronApp, page, {supported: false})
  await page.locator('#bar .analyze-game').click()
  await expect(page.locator('#enginesetup')).toContainText(
    'Apple silicon Macs with macOS 15',
  )
  await expect(page.locator('#enginesetup .primary')).toBeDisabled()
})

for (const [language, title, action] of [
  ['zh-Hans', '自动配置引擎', '准备并分析'],
  ['zh-Hant', '自動設定引擎', '準備並分析'],
])
  test.describe(language, () => {
    test.use({appLanguage: language})
    test('setup and retry instructions are localized', async ({
      electronApp,
      page,
    }, testInfo) => {
      await prepare(electronApp, page)
      await expect(page.locator('#bar .analyze-game')).toHaveText('全局分析')
      await page.locator('#bar .analyze-game').click()
      await expect(page.locator('#enginesetup h2')).toHaveText(title)
      await expect(page.locator('#enginesetup .primary')).toHaveText(action)
      await page.screenshot({path: testInfo.outputPath('engine-setup.png')})
      await page.locator('#enginesetup .primary').click()
      await expect(page.locator('#enginesetup [role=alert]')).toContainText(
        language === 'zh-Hans' ? '下载失败' : '下載失敗',
      )
      await expect(page.locator('#enginesetup .primary')).toHaveText(
        '重试'.replace('试', language === 'zh-Hant' ? '試' : '试'),
      )
    })
  })
