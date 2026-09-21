// Wait for a fresh sample from one synchronized position. Analysis streams stay
// open until aborted, so awaiting the analyze command itself would never finish.
export function analyzePosition(
  syncer,
  {id, color, command, signal, duration = 1000, timeout = 15000},
) {
  return new Promise((resolve, reject) => {
    let sample = null
    let settled = false
    let elapsed = false
    let budgetTimer, timeoutTimer
    const finish = (error) => {
      if (settled) return
      settled = true
      clearTimeout(budgetTimer)
      clearTimeout(timeoutTimer)
      syncer.removeListener('analysis-update', update)
      syncer.controller.removeListener('stopped', stopped)
      signal.removeEventListener('abort', aborted)
      if (error) reject(error)
      else resolve(sample)
    }
    const aborted = () =>
      finish(Object.assign(new Error('Stopped'), {name: 'AbortError'}))
    const stopped = () => finish(new Error('The analysis engine stopped.'))
    const update = () => {
      const analysis = syncer.analysis
      if (
        syncer.treePosition !== id ||
        !analysis ||
        !Number.isFinite(analysis.winrate)
      )
        return
      sample = analysis
      const visits = analysis.variations.reduce(
        (sum, variation) => sum + (variation.visits || 0),
        0,
      )
      if (visits >= 100 || elapsed) finish()
    }
    if (signal.aborted) {
      aborted()
      return
    }
    syncer.on('analysis-update', update)
    syncer.controller.on('stopped', stopped)
    signal.addEventListener('abort', aborted, {once: true})
    budgetTimer = setTimeout(() => {
      elapsed = true
      if (sample) finish()
    }, duration)
    timeoutTimer = setTimeout(
      () => finish(new Error('The engine did not return analysis in time.')),
      timeout,
    )
    syncer
      .queueCommand({name: command, args: [color, '10']})
      .then((response) => {
        if (!settled)
          finish(
            new Error(
              response?.error
                ? 'The engine rejected the analysis command.'
                : 'The engine ended analysis without a usable result.',
            ),
          )
      })
      .catch((error) => finish(error))
  })
}

// A hung GTP process must not hold a stopped job forever. Stop the process on
// timeout so queued commands cannot leak into a later analysis run.
export async function engineOperation(syncer, operation, timeout = 15000) {
  let timer
  try {
    return await Promise.race([
      operation,
      new Promise((_, reject) => {
        timer = setTimeout(async () => {
          await syncer.stop().catch(() => {})
          reject(new Error('The engine did not return analysis in time.'))
        }, timeout)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}
