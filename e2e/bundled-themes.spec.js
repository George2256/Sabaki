const {expect, _electron: electron} = require('@playwright/test')
const fs = require('fs')
const path = require('path')
const {test} = require('./fixtures/electron-app')
const {loadSgfStringAndWait} = require('./helpers')

test('bundled themes switch, load their textures, and persist', async ({
  page,
  electronApp,
}) => {
  const themes = await page.evaluate(() => window.sabaki.setting.getThemes())
  const bundled = Object.values(themes).filter((theme) => theme.bundled)
  expect(bundled).toHaveLength(15)

  await loadSgfStringAndWait(page, '(;GM[1]FF[4]SZ[19];B[pd];W[dd])')
  await page.evaluate(() => {
    window.__sabaki.goToEnd()
    window.__sabaki.setState({preferencesTab: 'themes'})
    window.__sabaki.openDrawer('preferences')
  })
  const select = page.locator('#preferences div.themes select')
  await expect(select).toBeVisible()

  for (const theme of bundled) {
    await select.selectOption(theme.id)
    await expect
      .poll(() => page.evaluate(() => window.__sabaki.state.currentThemeId))
      .toBe(theme.id)
    await expect(
      page.getByRole('button', {name: 'Uninstall', exact: true}),
    ).toHaveCount(0)

    // Exercise the actual stylesheet and decode every referenced PNG, including
    // stone variants that a two-move board might not happen to display.
    await page.waitForFunction((themePath) => {
      const sheet = [...document.styleSheets].find(
        (sheet) => sheet.href && decodeURI(sheet.href).includes(themePath),
      )
      return sheet && sheet.cssRules.length > 0
    }, theme.path)
    const textures = await page.evaluate(async (themePath) => {
      const sheet = [...document.styleSheets].find(
        (sheet) => sheet.href && decodeURI(sheet.href).includes(themePath),
      )
      const urls = [
        ...new Set(
          [...sheet.cssRules].flatMap((rule) =>
            [...rule.cssText.matchAll(/url\(["']?([^"')]+)["']?\)/g)].map(
              (match) => new URL(match[1], sheet.href).href,
            ),
          ),
        ),
      ]
      await Promise.all(
        urls.map(async (url) => {
          const image = new Image()
          image.src = url
          await image.decode()
        }),
      )
      return [
        '.shudan-goban-image',
        '.shudan-stone-image.shudan-sign_1',
        '.shudan-stone-image.shudan-sign_-1',
      ].map(
        (selector) =>
          getComputedStyle(document.querySelector(selector)).backgroundImage,
      )
    }, theme.path)
    for (const texture of textures) {
      expect(decodeURI(texture)).toContain(theme.path)
    }
  }

  const yunzi = 'bundled:sabaki-themes:yunzi'
  await select.selectOption(yunzi)
  const userData = await electronApp.evaluate(({app}) =>
    app.getPath('userData'),
  )
  await expect
    .poll(
      () =>
        JSON.parse(
          fs.readFileSync(path.join(userData, 'settings.json'), 'utf8'),
        )['theme.current'],
    )
    .toBe(yunzi)
  await page.evaluate(() => window.sabaki.setting.set('theme.current', null))
  await expect
    .poll(() =>
      page.evaluate(() =>
        [...document.querySelectorAll('link[rel=stylesheet]')].some((link) =>
          link.href.includes('/themes/sabaki-themes/'),
        ),
      ),
    )
    .toBe(false)

  // Restart against the saved userData without the fixture re-seeding settings.
  await select.selectOption(yunzi)
  await expect
    .poll(
      () =>
        JSON.parse(
          fs.readFileSync(path.join(userData, 'settings.json'), 'utf8'),
        )['theme.current'],
    )
    .toBe(yunzi)
  await electronApp.evaluate(({app}) => app.exit(0))
  const restarted = await electron.launch({
    executablePath: require('electron'),
    args: [path.resolve(__dirname, '..'), `--user-data-dir=${userData}`],
    env: {...process.env, SABAKI_E2E: '1'},
  })
  try {
    const restartedPage = await restarted.firstWindow()
    await restartedPage.waitForSelector('#goban')
    expect(
      await restartedPage.evaluate(() =>
        window.sabaki.setting.get('theme.current'),
      ),
    ).toBe(yunzi)
    await expect
      .poll(() =>
        restartedPage.evaluate(
          () =>
            getComputedStyle(document.querySelector('.shudan-goban-image'))
              .backgroundImage,
        ),
      )
      .toContain('/yunzi/images/Board.png')
  } finally {
    await restarted.evaluate(({app}) => app.exit(0))
    await restarted.close()
  }
})

test('user-installed themes coexist with bundled themes', async ({
  page,
  electronApp,
}) => {
  const userData = await electronApp.evaluate(({app}) =>
    app.getPath('userData'),
  )
  const directory = path.join(userData, 'themes', 'local-test')
  fs.mkdirSync(directory)
  fs.writeFileSync(
    path.join(directory, 'package.json'),
    JSON.stringify({
      name: 'local-test',
      main: 'styles.css',
    }),
  )
  fs.writeFileSync(
    path.join(directory, 'styles.css'),
    '.shudan-goban {opacity: 1}',
  )
  const themes = await page.evaluate(() => window.sabaki.setting.loadThemes())
  expect(themes['local-test'].bundled).toBe(false)
  expect(Object.values(themes).filter((theme) => theme.bundled)).toHaveLength(
    15,
  )
  await page.evaluate(() => {
    window.sabaki.setting.set('theme.current', 'local-test')
    window.__sabaki.setState({preferencesTab: 'themes'})
    window.__sabaki.openDrawer('preferences')
  })
  await expect(
    page.getByRole('button', {name: 'Uninstall', exact: true}),
  ).toBeVisible()
})
