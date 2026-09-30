const {expect} = require('@playwright/test')
const {test} = require('./fixtures/electron-app')
const {
  loadSgfStringAndWait,
  attachAndWaitForEngines,
  detachAndWait,
  waitForRender,
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

async function graphState(page) {
  return page.evaluate(() => {
    const s = window.__sabaki
    return {
      phase: s.state.teachingReview?.phase,
      graph: s.state.teachingReview?.graph,
      winrate: s.inferredState.winrateData,
      scoreLead: s.inferredState.scoreLeadData,
      root: JSON.stringify(s.inferredState.gameTree.root),
    }
  })
}

async function setGraphMetric(page, metric) {
  await page.evaluate(
    (value) => window.sabaki.setting.set('board.analysis_type', value),
    metric,
  )
  await page.waitForFunction(
    (value) => window.__sabaki.state.analysisType === value,
    metric,
  )
  await waitForRender(page)
}

async function goToGraphNode(page, index) {
  await page.evaluate((i) => {
    const s = window.__sabaki
    const nodes = [
      ...s.inferredState.gameTree.listCurrentNodes(
        s.state.gameCurrents[s.state.gameIndex],
      ),
    ]
    s.setCurrentTreePosition(s.inferredState.gameTree, nodes[i].id)
  }, index)
  await waitForRender(page)
}

test('draws partial teaching results without SGF properties, retains them on stop and resumes the curve', async ({
  page,
}, testInfo) => {
  await prepare(page, testInfo, true)
  const original = await page.evaluate(() => ({
    root: JSON.stringify(window.__sabaki.inferredState.gameTree.root),
    position: window.__sabaki.state.treePosition,
    values: window.__sabaki.inferredState.winrateData,
  }))
  expect(original.values.every((value) => value == null)).toBe(true)
  await page.locator('.teaching-start').click()
  await page.waitForFunction(() => {
    const review = window.__sabaki.state.teachingReview
    return review?.phase === 'scanning' && review.graph?.completed >= 2
  })
  await expect(page.locator('#winrategraph')).toBeVisible()
  await expect(
    page.locator('#winrategraph svg path[stroke="#eee"]'),
  ).toHaveAttribute('d', /M 0,75 L 1,42/)
  await page.locator('.teaching-start').click()
  await page.waitForFunction(
    () => !window.__sabaki.state.teachingReview.running,
  )
  const stopped = await graphState(page)
  expect(stopped.phase).toBe('canceled')
  expect(stopped.graph.total).toBe(5)
  expect(stopped.graph.completed).toBeGreaterThanOrEqual(2)
  expect(stopped.graph.completed).toBeLessThan(5)
  expect(stopped.graph.winrate).toHaveLength(5)
  expect(stopped.graph.scoreLead).toHaveLength(5)
  expect(stopped.graph.winrate.slice(0, stopped.graph.completed)).toEqual([
    75,
    ...Array(stopped.graph.completed - 1).fill(42),
  ])
  expect(stopped.graph.winrate.slice(stopped.graph.completed)).toEqual(
    Array(5 - stopped.graph.completed).fill(null),
  )
  expect(stopped.winrate).toEqual(stopped.graph.winrate)
  expect(stopped.scoreLead).toEqual(stopped.graph.scoreLead)
  expect(stopped.root).toBe(original.root)
  expect(await page.evaluate(() => window.__sabaki.state.treePosition)).toBe(
    original.position,
  )

  // Closing the teaching panel does not discard the active curve.
  await page.locator('.teaching-close').click()
  await expect(page.locator('#teaching-review')).toBeHidden()
  await expect(page.locator('#winrategraph')).toBeVisible()
  expect((await graphState(page)).winrate).toEqual(stopped.winrate)
  await page.evaluate(() => window.__sabaki.openTeachingReview())
  await expect(page.locator('.teaching-start')).toHaveText('继续讲解当前分支')
  await page.locator('.teaching-start').click()
  await page.waitForFunction((completed) => {
    const review = window.__sabaki.state.teachingReview
    return review?.graph?.completed >= completed && review.reused >= completed
  }, stopped.graph.completed)
  await page.waitForFunction(
    () => window.__sabaki.state.teachingReview.phase === 'complete',
  )
  const complete = await graphState(page)
  expect(complete.graph.completed).toBe(5)
  expect(complete.graph.total).toBe(5)
  expect(complete.winrate).toEqual([75, 42, 42, 42, 42])
  expect(complete.scoreLead).toEqual([8, 2, 2, 2, 2])
  expect(complete.root).toBe(original.root)
  await expect(
    page.locator('#winrategraph svg path[stroke="#eee"]'),
  ).toHaveAttribute('d', 'M 0,75 L 1,42 L 2,42 L 3,42 L 4,42')
})

test('maps teaching positions across comment nodes and displays both metrics in each player perspective', async ({
  page,
}, testInfo) => {
  await prepare(
    page,
    testInfo,
    false,
    '(;GM[1]SZ[9]KM[7.5]RU[Chinese];C[before play];B[ai];C[after black];W[cc];C[after white];B[gg];W[])',
  )
  const original = await page.evaluate(() =>
    JSON.stringify(window.__sabaki.inferredState.gameTree.root),
  )
  await page.locator('.teaching-start').click()
  await page.waitForFunction(
    () => window.__sabaki.state.teachingReview.phase === 'complete',
  )
  const result = await graphState(page)
  expect(result.graph.winrate).toEqual([75, 42, 42, 42, 42])
  expect(result.graph.scoreLead).toEqual([8, 2, 2, 2, 2])
  expect(result.winrate).toEqual([75, 75, 42, 42, 42, 42, 42, 42])
  expect(result.scoreLead).toEqual([8, 8, 2, 2, 2, 2, 2, 2])
  expect(result.root).toBe(original)

  const main = page.locator('#winrategraph .main')
  const player = page.locator('#winrategraph .winrate-strip img.player')
  const line = page.locator('#winrategraph svg path[stroke="#eee"]')
  await goToGraphNode(page, 2) // First black move, after an annotation node.
  await expect(main).toHaveText('42%')
  await expect(player).toHaveAttribute('src', './img/ui/black.svg')
  await expect(line).toHaveAttribute('d', /M 0,75 L 1,75 L 2,42 L 3,42/)
  await setGraphMetric(page, 'scoreLead')
  await expect(main).toHaveText('+2')
  // Score lead uses its native units and the existing graph scale (20 points).
  await expect(line).toHaveAttribute('d', /M 0,70 L 1,70 L 2,55 L 3,55/)
  await goToGraphNode(page, 4)
  await expect(main).toHaveText('-2')
  await expect(player).toHaveAttribute('src', './img/ui/white.svg')
  await setGraphMetric(page, 'winrate')
  await expect(main).toHaveText('58%')
  await goToGraphNode(page, 5) // Annotation preserves the same board value.
  expect((await graphState(page)).winrate[5]).toBe(42)
  expect(
    await page.evaluate(() => window.__sabaki.state.teachingReview.stale),
  ).toBe(false)
  expect((await graphState(page)).root).toBe(original)
})
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
  await page.waitForFunction(() => {
    const review = window.__sabaki.state.teachingReview
    return review?.phase === 'scanning' && review.graph?.completed >= 1
  })
  await page.evaluate(() => {
    const s = window.__sabaki
    s.goToMoveNumber(2)
    s.setComment(s.state.treePosition, {comment: 'my new comment'})
  })
  expect(
    await page.evaluate(() => window.__sabaki.state.teachingReview.stale),
  ).toBe(false)
  expect(
    await page.evaluate(() => window.__sabaki.state.teachingReview.running),
  ).toBe(true)
  expect((await graphState(page)).winrate[0]).toBe(75)
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
  expect(
    await page.evaluate(() => window.__sabaki.inferredState.teachingGraph),
  ).toBeNull()
  expect((await graphState(page)).winrate.every((value) => value == null)).toBe(
    true,
  )
  expect(
    (await graphState(page)).scoreLead.every((value) => value == null),
  ).toBe(true)
  await expect(page.locator('.teaching-card')).toHaveCount(0)
})
test('changing to a sibling branch cancels the review and stop supports restarting', async ({
  page,
}, testInfo) => {
  await prepare(
    page,
    testInfo,
    true,
    '(;SZ[9]KM[7.5]RU[Chinese]SBKV[13]SBKS[-3];B[ai]SBKV[14]SBKS[-2](;W[cc]SBKV[15]SBKS[-1])(;W[gg]SBKV[16]SBKS[0]))',
  )
  const original = (await graphState(page)).root
  await page.locator('.teaching-start').click()
  await page.waitForFunction(() => {
    const review = window.__sabaki.state.teachingReview
    return review?.phase === 'scanning' && review.graph?.completed >= 2
  })
  const scanning = await graphState(page)
  expect(scanning.winrate.slice(0, 2)).toEqual([75, 42])
  // Unscanned nodes stay blank rather than mixing in old SGF evaluations.
  expect(scanning.winrate[2]).toBeNull()
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
  const changed = await graphState(page)
  expect(changed.winrate).toEqual([13, 14, 16])
  expect(changed.scoreLead).toEqual([-3, -2, 0])
  expect(changed.root).toBe(original)
  expect(
    await page.evaluate(() => window.__sabaki.inferredState.teachingGraph),
  ).toBeNull()
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
    expect((await graphState(page)).winrate[0]).toBe(75)
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
      graph: window.__sabaki.inferredState.teachingGraph,
      values: window.__sabaki.inferredState.winrateData,
    }))
    expect(state.teaching.running).toBe(false)
    expect(state.teaching.phase).toBe('canceled')
    expect(state.batch.completed).toBe(5)
    expect(state.batch.running).toBe(false)
    expect(state.graph).toBeNull()
    expect(state.values[0]).toBe(42)
    expect(state.values[1]).toBeLessThan(15)
    expect(state.values[2]).toBeGreaterThan(85)
    await page.locator('.teaching-start').click()
    await page.waitForFunction(
      () => window.__sabaki.state.teachingReview?.phase === 'complete',
    )
    expect(
      await page.evaluate(() => window.__sabaki.state.teachingReview.reused),
    ).toBeGreaterThan(0)
    await expect(page.locator('.teaching-cache')).toContainText('已复用')
    await expect(draw).toBeEnabled()
    expect((await graphState(page)).winrate).toEqual([75, 42, 42, 42, 42])
    // Explicit interactive analysis switches back to the GTP/SGF source too.
    await page.evaluate((id) => window.__sabaki.startAnalysis(id), syncer)
    expect(
      await page.evaluate(() => window.__sabaki.inferredState.teachingGraph),
    ).toBeNull()
    expect((await graphState(page)).winrate[1]).toBeLessThan(15)
    await page.evaluate(() => window.__sabaki.stopAnalysis())
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
                    text: '实战图黑1下在 A1；先看对方怎样应对。',
                    refs: [{diagramId: received.diagrams[0].id, step: 1}],
                    factIds: [
                      received.facts.find(
                        (f) =>
                          f.diagramId === received.diagrams[0].id &&
                          f.step === 1,
                      ).id,
                    ],
                  },
                  {
                    text: '先补一手前，先检查对方的威胁。',
                    refs: [{diagramId: received.diagrams[0].id, step: 1}],
                    factIds: [
                      received.facts.find(
                        (f) =>
                          f.diagramId === received.diagrams[0].id &&
                          f.step === 1,
                      ).id,
                    ],
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
    expect(received.diagrams.every((d) => d.legal)).toBe(true)
    expect(received.diagrams[0].source).toBe('sgf')
    expect(received.diagrams[0].verified).toBe(false)
    expect(received.learner.rank).toBe('10k')
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

test('learner strength adjusts explanation, reuses analysis and step references control only the teaching diagram', async ({
  page,
}, testInfo) => {
  await prepare(page, testInfo)
  await page.getByRole('combobox', {name: '学员棋力'}).selectOption('beginner')
  await page.locator('.teaching-start').click()
  await page.waitForFunction(
    () => window.__sabaki.state.teachingReview?.phase === 'complete',
  )
  await expect(page.locator('.teaching-interpretation')).toContainText(
    '棋盘事实讲解',
  )
  expect(
    await page.evaluate(
      () => window.__sabaki.state.teachingReview.cards[0].learner.tier,
    ),
  ).toBe('foundation')
  const before = await page.evaluate(() => window.__sabaki.state.treePosition)
  const reference = page.locator('.teaching-references button').first()
  await reference.click()
  const target = await page.evaluate(
    () => window.__sabaki.state.teachingReview.cards[0].paragraphs[0].refs[0],
  )
  await expect(
    page.locator(`[data-diagram-id="${target.diagramId}"] input[type=range]`),
  ).toHaveValue(String(target.step))
  expect(await page.evaluate(() => window.__sabaki.state.treePosition)).toBe(
    before,
  )
  await page.getByRole('combobox', {name: '学员棋力'}).selectOption('3d')
  await page.locator('.teaching-start').click()
  await page.waitForFunction(
    () => window.__sabaki.state.teachingReview?.phase === 'complete',
  )
  expect(
    await page.evaluate(
      () => window.__sabaki.state.teachingReview.cards[0].learner.tier,
    ),
  ).toBe('advanced')
  expect(
    await page.evaluate(() => window.__sabaki.state.teachingReview.reused),
  ).toBeGreaterThan(5)
  await expect(page.locator('.teaching-interpretation')).toContainText('时机')
})
