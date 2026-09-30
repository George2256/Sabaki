const {expect} = require('@playwright/test')
const {test} = require('./fixtures/electron-app')
const {
  loadSgfStringAndWait,
  attachAndWaitForEngines,
  detachAndWait,
} = require('./helpers')
const path = require('path')
const fs = require('fs')
const http = require('http')
const source =
  '(;GM[1]SZ[9]KM[7.5]RU[Chinese]C[original comment];B[ai];W[cc];B[gg];W[])'
test.use({appLanguage: 'zh-Hans'})
async function prepare(page, testInfo, slow = false, sgf = source) {
  await loadSgfStringAndWait(page, sgf)
  const model = testInfo.outputPath('test-model.bin')
  fs.mkdirSync(path.dirname(model), {recursive: true})
  fs.writeFileSync(model, 'synthetic model')
  await page.evaluate(
    async (engine) => {
      await window.sabaki.setting.set('engines.list', [engine])
      window.__sabaki.openTeachingReview()
    },
    {
      name: 'KataGo teaching test',
      path: process.execPath,
      args: `"${path.resolve(__dirname, '../test/engines/teachingEngine.js')}" ${slow ? '--slow ' : ''}gtp -model "${model}"`,
    },
  )
  await expect(page.locator('#teaching-review .teaching-start')).toBeEnabled()
}
test('shows three verified diagrams without changing SGF, navigation or comments', async ({
  page,
}, testInfo) => {
  await prepare(page, testInfo)
  const original = await page.evaluate(() => ({
    root: JSON.stringify(window.__sabaki.inferredState.gameTree.root),
    position: window.__sabaki.state.treePosition,
  }))
  await page.locator('.teaching-start').click()
  await page.waitForFunction(
    () => window.__sabaki.state.teachingReview?.phase === 'complete',
  )
  await expect(page.locator('.teaching-card')).toHaveCount(1)
  await expect(page.locator('.lesson-diagram')).toHaveCount(3)
  await expect(page.locator('.lesson-board .shudan-goban')).toHaveCount(3)
  await expect
    .poll(async () =>
      page
        .locator('.lesson-board')
        .first()
        .evaluate(
          (el) =>
            el.querySelector('.shudan-goban').getBoundingClientRect().width /
            el.getBoundingClientRect().width,
        ),
    )
    .toBeGreaterThan(0.85)
  await expect(page.locator('.teaching-card h3')).toContainText('关键转折')
  expect(
    await page.evaluate(() =>
      JSON.stringify(window.__sabaki.inferredState.gameTree.root),
    ),
  ).toBe(original.root)
  expect(await page.evaluate(() => window.__sabaki.state.treePosition)).toBe(
    original.position,
  )
  const actual = page.locator('.lesson-diagram[data-kind=actual]')
  await actual.locator('input[type=range]').fill('0')
  await expect(actual.locator('.lesson-diagram-controls span')).toHaveText(
    '0/4',
  )
  expect(await page.evaluate(() => window.__sabaki.state.treePosition)).toBe(
    original.position,
  )
  await page.screenshot({path: testInfo.outputPath('teaching-review.png')})
  await page.evaluate(() =>
    window.__sabaki.openCommentEditor(window.__sabaki.state.treePosition),
  )
  await expect(page.locator('#properties .edit textarea')).toBeVisible()
  await expect(page.locator('#properties .edit textarea')).toHaveValue(
    'original comment',
  )
  await page.evaluate(() => window.__sabaki.openTeachingReview())
  await page.locator('.teaching-close').click()
  await expect(page.locator('#teaching-review')).toBeHidden()
  expect(
    await page.evaluate(() => window.__sabaki.state.showTeachingReview),
  ).toBe(false)
})
test('browsing and comment edits are allowed; loading another game cancels stale work', async ({
  page,
}, testInfo) => {
  await prepare(page, testInfo, true)
  await page.locator('.teaching-start').click()
  await page.waitForFunction(
    () => window.__sabaki.state.teachingReview?.running,
  )
  await page.evaluate(() => {
    const s = window.__sabaki
    s.goToMoveNumber(2)
    s.setComment(s.state.treePosition, {comment: 'my new comment'})
  })
  expect(
    await page.evaluate(() => window.__sabaki.state.teachingReview.stale),
  ).toBe(false)
  await page.evaluate(() =>
    window.__sabaki.loadContent('(;SZ[9]KM[7.5]RU[Chinese];B[dd])', 'sgf', {
      suppressAskForSave: true,
    }),
  )
  await page.waitForFunction(
    () => !window.__sabaki.state.teachingReview.running,
  )
  expect(
    await page.evaluate(() => window.__sabaki.state.teachingReview.stale),
  ).toBe(true)
  expect(
    await page.evaluate(
      () => window.__sabaki.inferredState.gameTree.root.children[0].data.B[0],
    ),
  ).toBe('dd')
  await expect(page.locator('.teaching-card')).toHaveCount(0)
})
test('changing to a sibling branch cancels the review and stop supports restarting', async ({
  page,
}, testInfo) => {
  await prepare(
    page,
    testInfo,
    true,
    '(;SZ[9]KM[7.5]RU[Chinese];B[ai](;W[cc])(;W[gg]))',
  )
  await page.locator('.teaching-start').click()
  await page.waitForFunction(
    () => window.__sabaki.state.teachingReview?.running,
  )
  await page.evaluate(() => {
    const s = window.__sabaki,
      tree = s.inferredState.gameTree
    s.setCurrentTreePosition(tree, tree.root.children[0].children[1].id)
  })
  await page.waitForFunction(
    () => !window.__sabaki.state.teachingReview.running,
  )
  expect(
    await page.evaluate(() => window.__sabaki.state.teachingReview.stale),
  ).toBe(true)
  await page.locator('.teaching-start').click()
  await page.waitForFunction(() => window.__sabaki.state.teachingReview.running)
  await page.locator('.teaching-start').click()
  await page.waitForFunction(
    () => !window.__sabaki.state.teachingReview.running,
  )
  expect(
    await page.evaluate(() => window.__sabaki.state.teachingReview.phase),
  ).toBe('canceled')
})
test('quick draw protects teaching and a stopped review resumes after drawing', async ({
  page,
}, testInfo) => {
  await prepare(
    page,
    testInfo,
    true,
    source.replace('KM[7.5]', 'KM[7.5]SBKV[42]'),
  )
  const [syncer] = await attachAndWaitForEngines(page, [
    {
      name: 'Existing GTP',
      path: process.execPath,
      args: `"${path.resolve(__dirname, '../test/engines/replayEngine.js')}" --transcript "${path.resolve(__dirname, '../test/resources/engine-transcripts/katago-1.16.4/endgame-9.kata-analyze.txt')}"`,
    },
  ])
  try {
    await page.locator('.teaching-start').click()
    await page.waitForFunction(
      () =>
        window.__sabaki.state.teachingReview?.phase === 'scanning' &&
        window.__sabaki.state.teachingReview.completed >= 1,
    )
    const draw = page.locator('.batch-analysis-controls button')
    await expect(draw).toBeDisabled()
    await expect(draw).toHaveAttribute('title', /请先停止讲解/)
    await page.evaluate(async () => {
      await window.__sabaki.startBatchAnalysis()
      await window.__sabaki.analyzeGame()
    })
    expect(
      await page.evaluate(() => window.__sabaki.state.teachingReview.running),
    ).toBe(true)
    expect(
      await page.evaluate(() => window.__sabaki.state.batchAnalysis),
    ).toBeNull()
    await page.locator('.teaching-start').click()
    await page.waitForFunction(
      () => !window.__sabaki.state.teachingReview.running,
    )
    await expect(page.locator('.teaching-start')).toHaveText('继续讲解当前分支')
    await expect(draw).toBeEnabled()
    await draw.click()
    await page.waitForFunction(
      () =>
        window.__sabaki.state.batchAnalysis?.completed === 5 &&
        !window.__sabaki.state.batchAnalysis.running,
    )
    const state = await page.evaluate(() => ({
      teaching: window.__sabaki.state.teachingReview,
      batch: window.__sabaki.state.batchAnalysis,
    }))
    expect(state.teaching.running).toBe(false)
    expect(state.teaching.phase).toBe('canceled')
    expect(state.batch.completed).toBe(5)
    expect(state.batch.running).toBe(false)
    await page.locator('.teaching-start').click()
    await page.waitForFunction(
      () => window.__sabaki.state.teachingReview?.phase === 'complete',
    )
    expect(
      await page.evaluate(() => window.__sabaki.state.teachingReview.reused),
    ).toBeGreaterThan(0)
    await expect(page.locator('.teaching-cache')).toContainText('已复用')
    await expect(draw).toBeEnabled()
  } finally {
    await detachAndWait(page, [syncer])
  }
})
test('requires explicit rules instead of silently choosing engine defaults', async ({
  page,
}, testInfo) => {
  await prepare(page, testInfo, false, source.replace('RU[Chinese]', ''))
  await page.locator('.teaching-start').click()
  await expect(page.locator('#teaching-review [role=alert]')).toContainText(
    '请选择规则',
  )
  await page.locator('#teaching-review select').nth(1).selectOption('chinese')
  await page.locator('.teaching-start').click()
  await page.waitForFunction(
    () => window.__sabaki.state.teachingReview?.phase === 'complete',
  )
  await expect(page.locator('.teaching-card')).toHaveCount(1)
})
test('uses the optional LLM through main IPC and keeps its key out of settings', async ({
  page,
  electronApp,
}, testInfo) => {
  let received, authorization
  const server = http.createServer(async (req, res) => {
    let body = ''
    for await (const chunk of req) body += chunk
    const request = JSON.parse(body)
    received = JSON.parse(request.messages[1].content)
    authorization = req.headers.authorization
    res.setHeader('Content-Type', 'application/json')
    res.end(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                lessonId: received.lessonId,
                paragraphs: [
                  {
                    text: '比较推荐变化与实战后的应对，观察棋形的差异。',
                    evidenceIds: [received.diagrams[0].id],
                  },
                ],
              }),
            },
          },
        ],
      }),
    )
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    await prepare(page, testInfo)
    await page.locator('.teaching-llm summary').click()
    const fields = page.locator('.teaching-llm input[type=text]')
    await fields
      .nth(0)
      .fill(`http://127.0.0.1:${server.address().port}/v1/chat/completions`)
    await fields.nth(1).fill('test-model')
    await page
      .locator('.teaching-llm input[type=password]')
      .fill('test-session-key')
    await page.locator('.teaching-llm button').click()
    await expect(
      page.locator('.teaching-llm input[type=password]'),
    ).toHaveValue('')
    await page.locator('.teaching-llm input[type=checkbox]').check()
    await page.locator('.teaching-start').click()
    await page.waitForFunction(
      () => window.__sabaki.state.teachingReview?.phase === 'complete',
    )
    await expect(page.locator('.teaching-interpretation')).toContainText(
      '教学推断',
    )
    expect(authorization).toBe('Bearer test-session-key')
    expect(JSON.stringify(received)).not.toContain('original comment')
    expect(received.diagrams.every((d) => d.verified)).toBe(true)
    expect(received.engine.name).toBeUndefined()
    const userData = await electronApp.evaluate(({app}) =>
      app.getPath('userData'),
    )
    expect(
      fs.readFileSync(path.join(userData, 'settings.json'), 'utf8'),
    ).not.toContain('test-session-key')
    expect(
      await page.evaluate(async () =>
        JSON.stringify(await window.sabaki.teaching.status()),
      ),
    ).not.toContain('test-session-key')
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})
