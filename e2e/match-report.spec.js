const {expect} = require('@playwright/test')
const {test} = require('./fixtures/electron-app')
const {loadSgfStringAndWait, waitForRender} = require('./helpers')
const path = require('path')
const fs = require('fs')

// The test engine always prefers the first empty point of E5, F5, E6, F6 …,
// so Black matches twice and White's A1 is not among the candidates.
const source =
  '(;GM[1]SZ[9]KM[7.5]RU[Chinese]PB[Black player]PW[White player];B[ee];W[fe];B[ed];W[ai])'
test.use({appLanguage: 'zh-Hans'})

async function prepare(page, testInfo, {slow = false, human = true} = {}) {
  await loadSgfStringAndWait(page, source)
  const model = testInfo.outputPath('test-model.bin')
  fs.mkdirSync(path.dirname(model), {recursive: true})
  fs.writeFileSync(model, 'synthetic model')
  // The check finds KataGo's human style model next to the main model.
  if (human)
    fs.writeFileSync(
      testInfo.outputPath('b18c384nbt-humanv0.bin.gz'),
      'synthetic human model',
    )
  await page.evaluate(
    async (engine) => {
      await window.sabaki.setting.set('engines.list', [engine])
      window.__sabaki.openMatchReport()
    },
    {
      name: 'KataGo match test',
      path: process.execPath,
      args: `"${path.resolve(__dirname, '../test/engines/teachingEngine.js')}" ${slow ? '--stagger ' : ''}gtp -model "${model}"`,
    },
  )
  await expect(page.locator('#match-report .match-start')).toBeEnabled()
}

const row = (page, label) =>
  page.locator('.match-table tbody tr', {
    has: page.locator('th', {hasText: label}),
  })

test('reports match rates per player, recounts without a new scan and locates moves', async ({
  page,
}, testInfo) => {
  await prepare(page, testInfo)
  const root = await page.evaluate(() =>
    JSON.stringify(window.__sabaki.inferredState.gameTree.root),
  )
  await page.locator('#match-report .match-start').click()
  await page.waitForFunction(
    () => window.__sabaki.state.matchReview?.phase === 'complete',
  )
  await expect(page.locator('.match-status')).toHaveText('已完成 5/5')
  await expect(page.locator('#winrategraph')).toContainText('吻合度扫描')
  await expect(page.locator('.match-verdict')).toHaveCount(2)
  await expect(page.locator('.match-verdict').first()).toContainText(
    'Black player',
  )
  await expect(page.locator('.match-human')).toHaveText(
    '人类棋风模型：b18c384nbt-humanv0.bin.gz',
  )
  await expect(page.locator('.match-verdict').first()).toContainText('样本不足')
  // The SGF names no ranks, so the strongest human baselines are used.
  await expect(page.locator('.match-verdict').first()).toContainText(
    '基准 9段～职业',
  )
  await expect(page.locator('.match-timeline svg')).toHaveCount(2)

  await expect(row(page, '有效手数').locator('td')).toHaveText(['2/2', '2/2'])
  await page.locator('#match-report input[aria-label="起始手"]').fill('3')
  await expect(row(page, '有效手数').locator('td')).toHaveText(['1/2', '1/2'])
  await page.locator('#match-report input[aria-label="起始手"]').fill('1')
  await expect(row(page, '一选吻合度').locator('td')).toHaveText([
    '100.0%',
    '50.0%',
  ])
  await expect(row(page, '前三选吻合度').locator('td')).toHaveText([
    '100.0%',
    '50.0%',
  ])
  expect(
    await page.evaluate(() => window.__sabaki.state.matchReview.completed),
  ).toBe(5)
  await page.screenshot({path: testInfo.outputPath('match-summary.png')})

  const white = page.locator('.match-moves button').nth(3)
  await expect(white).toContainText('AI F6 · 不在候选中')
  await expect(page.locator('.match-moves button').first()).toContainText(
    '与 AI 一选相同',
  )
  await white.click()
  await waitForRender(page)
  const located = await page.evaluate(() => {
    const s = window.__sabaki
    return {
      position: s.state.treePosition,
      anchor: s.state.matchPosition.anchors[3].nodeId,
      root: JSON.stringify(s.inferredState.gameTree.root),
    }
  })
  expect(located.position).toBe(located.anchor)
  expect(located.root).toBe(root)
  await expect(white).toHaveClass(/current/)

  await page.locator('.match-moves').scrollIntoViewIfNeeded()
  await page.screenshot({path: testInfo.outputPath('match-report.png')})

  // Tabs switch pages; closing removes the panel and its tab.
  await page.locator('.sidebar-tabs button', {hasText: '棋谱'}).click()
  await expect(page.locator('#match-report')).toBeHidden()
  await page.locator('.sidebar-tabs button', {hasText: 'AI 吻合度'}).click()
  await expect(page.locator('#match-report')).toBeVisible()
  await page.locator('.match-close').click()
  await expect(page.locator('#match-report')).toHaveCount(0)
  await expect(page.locator('.sidebar-tabs')).toHaveCount(0)
})

test('explains a missing human model and marks the report stale when the branch changes', async ({
  page,
}, testInfo) => {
  await prepare(page, testInfo, {human: false})
  await expect(page.locator('.match-human-missing')).toContainText(
    'b18c384nbt-humanv0.bin.gz',
  )
  await page.locator('#match-report .match-start').click()
  await page.waitForFunction(
    () => window.__sabaki.state.matchReview?.phase === 'complete',
  )
  await expect(page.locator('.match-verdict').first()).toContainText('未校准')
  await expect(page.locator('.match-timeline')).toHaveCount(0)
  await page.evaluate(() => {
    const s = window.__sabaki
    const tree = s.inferredState.gameTree
    const last = [
      ...tree.listCurrentNodes(s.state.gameCurrents[s.state.gameIndex]),
    ].at(-1)
    s.setCurrentTreePosition(tree, last.id)
    s.makeMove([5, 5])
  })
  await expect(
    page.locator('#match-report .match-error[role="status"]'),
  ).toHaveText('棋局或选定分支已改变，请重新检测。')
  await expect(page.locator('.match-result')).toHaveCount(0)
})

test('keeps other engine work off the GPU while the check runs', async ({
  page,
}, testInfo) => {
  await prepare(page, testInfo, {slow: true})
  await page.locator('#match-report .match-start').click()
  await page.waitForFunction(
    () => window.__sabaki.state.matchReview?.phase === 'scanning',
  )
  await expect(page.locator('#match-report .match-start')).toHaveText('停止')
  const quickDraw = page.locator('.batch-analysis-controls button')
  await expect(quickDraw).toBeDisabled()
  await expect(quickDraw).toHaveAttribute('title', /AI 吻合度检测正在进行/)

  // Starting a teaching review first stops the match check.
  await page.evaluate(() =>
    window.__sabaki.startTeachingReview({engineIndex: 0, budget: 'quick'}),
  )
  const state = await page.evaluate(() => ({
    match: window.__sabaki.state.matchReview,
    teaching: window.__sabaki.state.teachingReview,
    matchGraph: window.__sabaki.state.matchGraphActive,
  }))
  expect(state.match.running).toBe(false)
  expect(state.match.phase).toBe('canceled')
  expect(state.teaching.running).toBe(true)
  expect(state.matchGraph).toBe(false)
  await page.evaluate(() => window.__sabaki.stopTeachingReview())
  await expect(page.locator('#match-report .match-start')).toHaveText(
    '继续检测',
  )
})
