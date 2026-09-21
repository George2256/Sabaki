const {expect} = require('@playwright/test')
const {test} = require('./fixtures/electron-app')
const {
  attachAndWaitForEngines,
  detachAndWait,
  loadSgfStringAndWait,
} = require('./helpers')
const path = require('path')
const fs = require('fs')
const engine = path.resolve(__dirname, '../test/engines/replayEngine.js')
const transcript = path.resolve(
  __dirname,
  '../test/resources/engine-transcripts/katago-1.16.4/endgame-9.kata-analyze.txt',
)
const sgf = '(;GM[1]SZ[9]KM[7.5];B[aa];W[bb];B[cc];W[dd])'

async function prepare(page, testInfo, slow = false, content = sgf) {
  await loadSgfStringAndWait(page, content)
  let source = transcript
  if (slow) {
    source = testInfo.outputPath('slow-analysis.txt')
    fs.mkdirSync(path.dirname(source), {recursive: true})
    fs.writeFileSync(
      source,
      fs
        .readFileSync(transcript, 'utf8')
        .split('\n')[0]
        .split(' info ')[0]
        .replace(/visits \d+/, 'visits 1') + '\n',
    )
  }
  return (
    await attachAndWaitForEngines(page, [
      {
        name: 'Batch replay',
        path: process.execPath,
        args: `"${engine}" --transcript "${source}" --max-komi 100`,
      },
    ])
  )[0]
}

test('fills every position, updates the curve without navigation and preserves existing data', async ({
  page,
}, testInfo) => {
  const id = await prepare(
    page,
    testInfo,
    false,
    sgf.replace('KM[7.5]', 'KM[7.5]SBKV[42]'),
  )
  try {
    const original = await page.evaluate(
      () => window.__sabaki.state.treePosition,
    )
    await page.evaluate(() => window.__sabaki.startBatchAnalysis())
    const result = await page.evaluate(() => {
      const s = window.__sabaki
      return {
        progress: s.state.batchAnalysis,
        position: s.state.treePosition,
        values: s.inferredState.winrateData,
      }
    })
    expect(result.progress.completed).toBe(5)
    expect(result.progress.running).toBe(false)
    expect(result.position).toBe(original)
    expect(result.values[0]).toBe(42)
    expect(result.values.every(Number.isFinite)).toBe(true)
    // The recorded engine reports ~97% for the side to move; black's
    // perspective must alternate as the side to move changes.
    expect(result.values[1]).toBeLessThan(15)
    expect(result.values[2]).toBeGreaterThan(85)
    await expect(
      page.locator('#winrategraph svg path[stroke="#eee"]'),
    ).toHaveAttribute('d', /4,/)
    await expect(
      page.locator('.batch-analysis-controls [role=status]'),
    ).toContainText('Complete 5/5')
  } finally {
    await detachAndWait(page, [id])
  }
})

test('stop keeps partial results and restart completes the remaining positions', async ({
  page,
}, testInfo) => {
  const id = await prepare(page, testInfo, true)
  try {
    await page.evaluate(() => {
      window.__sabaki.startBatchAnalysis()
    })
    await page.waitForFunction(
      () => window.__sabaki.state.batchAnalysis.completed >= 1,
    )
    await page.locator('.batch-analysis-controls button').click()
    await page.waitForFunction(
      () => !window.__sabaki.state.batchAnalysis.running,
    )
    const completed = await page.evaluate(
      () => window.__sabaki.state.batchAnalysis.completed,
    )
    expect(completed).toBeGreaterThan(0)
    expect(completed).toBeLessThan(5)
    await page.evaluate(() => window.__sabaki.startBatchAnalysis())
    expect(
      await page.evaluate(() => window.__sabaki.state.batchAnalysis.completed),
    ).toBe(5)
  } finally {
    await detachAndWait(page, [id])
  }
})

test('changing games cancels work without writing into the new game', async ({
  page,
}, testInfo) => {
  const id = await prepare(page, testInfo, true)
  try {
    await page.evaluate(() => {
      window.__sabaki.startBatchAnalysis()
    })
    await page.waitForFunction(
      () => window.__sabaki.state.batchAnalysis.completed >= 1,
    )
    await page.evaluate(async () => {
      const s = window.__sabaki
      await s.loadContent('(;GM[1]SZ[9]PB[New game];B[hh])', 'sgf', {
        suppressAskForSave: true,
      })
      await s.stopBatchAnalysis()
    })
    expect(
      await page.evaluate(() =>
        window.__sabaki.inferredState.winrateData.every(
          (value) => value == null,
        ),
      ),
    ).toBe(true)
  } finally {
    await detachAndWait(page, [id])
  }
})

test.describe('Chinese controls', () => {
  test.use({appLanguage: 'zh-Hans'})
  test('shows localized progress and stop controls', async ({
    page,
  }, testInfo) => {
    const id = await prepare(page, testInfo, true)
    try {
      await page.evaluate(() => {
        window.__sabaki.startBatchAnalysis()
      })
      await expect(page.locator('.batch-analysis-controls button')).toHaveText(
        '停止',
      )
      await expect(
        page.locator('.batch-analysis-controls [role=status]'),
      ).toContainText('分析中')
      await page.waitForFunction(
        () => window.__sabaki.state.batchAnalysis.completed >= 1,
      )
      await page.screenshot({
        path: testInfo.outputPath('batch-analysis-zh.png'),
      })
      await page.locator('.batch-analysis-controls button').click()
      await expect(page.locator('.batch-analysis-controls button')).toHaveText(
        '快速绘制',
      )
    } finally {
      await detachAndWait(page, [id])
    }
  })
})

test('imports Fox Japanese komi before sending the position to a strict engine', async ({
  page,
}, testInfo) => {
  const content =
    '(;GM[1]SZ[19]AP[GNU Go:3.8]AP[foxwq]RU[Japanese]KM[550]PB[聂卫平]PW[藤泽秀行];B[pd];W[dp])'
  const id = await prepare(page, testInfo, false, content)
  try {
    await page.evaluate(() => window.__sabaki.startBatchAnalysis())
    const result = await page.evaluate(
      (id) => ({
        komi: window.__sabaki.inferredState.gameTree.root.data.KM[0],
        engineKomi: window.__sabaki.state.attachedEngineSyncers.find(
          (s) => s.id === id,
        ).state.komi,
        completed: window.__sabaki.state.batchAnalysis.completed,
      }),
      id,
    )
    expect(result).toEqual({komi: '5.5', engineKomi: 5.5, completed: 3})
  } finally {
    await detachAndWait(page, [id])
  }
})
