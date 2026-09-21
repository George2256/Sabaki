import assert from 'assert'
import EventEmitter from 'events'
import {analyzePosition, engineOperation} from '../src/modules/batchanalysis.js'

function fixture() {
  const syncer = new EventEmitter()
  syncer.controller = new EventEmitter()
  syncer.treePosition = 'node'
  syncer.queueCommand = () => new Promise(() => {})
  const controller = new AbortController()
  const sample = (visits = 100) => {
    syncer.analysis = {winrate: 70, sign: 1, variations: [{visits}]}
    syncer.emit('analysis-update')
  }
  return {
    syncer,
    controller,
    sample,
    options: {
      id: 'node',
      color: 'B',
      command: 'kata-analyze',
      signal: controller.signal,
      duration: 10,
      timeout: 100,
    },
  }
}

describe('batch position analysis', () => {
  it('accepts a fresh sample at the visit budget and removes listeners', async () => {
    const {syncer, sample, options} = fixture()
    const promise = analyzePosition(syncer, options)
    sample()
    assert.equal((await promise).winrate, 70)
    assert.equal(syncer.listenerCount('analysis-update'), 0)
    assert.equal(syncer.controller.listenerCount('stopped'), 0)
  })
  it('uses the latest valid sample when the time budget expires', async () => {
    const {syncer, sample, options} = fixture()
    const promise = analyzePosition(syncer, options)
    sample(1)
    assert.equal((await promise).winrate, 70)
  })
  it('rejects silent engines without manufacturing a winrate', async () => {
    const {syncer, options} = fixture()
    await assert.rejects(
      analyzePosition(syncer, {...options, timeout: 20}),
      /in time/,
    )
  })
  it('ignores another position and supports immediate cancellation', async () => {
    const {syncer, sample, controller, options} = fixture()
    const promise = analyzePosition(syncer, options)
    syncer.treePosition = 'other'
    sample()
    controller.abort()
    await assert.rejects(promise, {name: 'AbortError'})
    assert.equal(syncer.listenerCount('analysis-update'), 0)
  })
  it('handles process exit and rejected commands', async () => {
    const {syncer, options} = fixture()
    const promise = analyzePosition(syncer, options)
    syncer.controller.emit('stopped')
    await assert.rejects(promise, /engine stopped/)
    syncer.queueCommand = async () => ({error: true})
    await assert.rejects(analyzePosition(syncer, options), /rejected/)
  })
  it('kills a hung engine before releasing the job', async () => {
    let stopped = false
    await assert.rejects(
      engineOperation(
        {
          stop: async () => {
            stopped = true
          },
        },
        new Promise(() => {}),
        10,
      ),
      /in time/,
    )
    assert.equal(stopped, true)
  })
})
