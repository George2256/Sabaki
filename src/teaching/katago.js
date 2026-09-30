const EventEmitter = require('events')
const {spawn} = require('child_process')
const {dirname} = require('path')
const readline = require('readline')
const argvsplit = require('argv-split')
const {randomUUID} = require('crypto')

const abortError = () =>
  Object.assign(new Error('canceled'), {name: 'AbortError'})
function profile(engine, configPath) {
  const args = argvsplit(engine.args || '')
  const command = args.indexOf('gtp')
  const modelIndex = args.indexOf('-model')
  if (command < 0 || modelIndex < command || !args[modelIndex + 1])
    throw new Error('katago-required')
  const flags = ['-model', args[modelIndex + 1]]
  const humanIndex = args.indexOf('-human-model')
  if (humanIndex > command && args[humanIndex + 1])
    flags.push('-human-model', args[humanIndex + 1])
  return {
    path: engine.path,
    args: [
      ...args.slice(0, command),
      'analysis',
      ...flags,
      '-config',
      configPath,
    ],
  }
}
function supports(engine) {
  try {
    profile(engine, '')
    return true
  } catch {
    return false
  }
}
class KataGo extends EventEmitter {
  constructor(
    engine,
    configPath,
    {signal, spawnProcess = spawn, timeout = 60000} = {},
  ) {
    super()
    this.pending = new Map()
    this.serial = 0
    this.requestPrefix = `teaching-${randomUUID()}`
    this.timeout = timeout
    this.signal = signal
    const executable = profile(engine, configPath)
    let args = executable.args,
      path = executable.path
    if (process.env.FLATPAK_ID) {
      args = ['--host', `--directory=${dirname(path)}`, path, ...args]
      path = 'flatpak-spawn'
    }
    this.child = spawnProcess(path, args, {
      cwd: dirname(engine.path),
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    this.exited = new Promise((resolve) => this.child.once('close', resolve))
    this.stderr = ''
    this.child.stderr.on('data', (chunk) => {
      this.stderr = (this.stderr + chunk).slice(-4000)
    })
    this.child.stdin.on('error', () => this.fail(new Error('engine-stopped')))
    this.child.on('error', () => this.fail(new Error('engine-stopped')))
    this.child.on('close', () => this.fail(new Error('engine-stopped')))
    this.reader = readline.createInterface({input: this.child.stdout})
    this.reader.on('line', (line) => {
      if (line.length > 4 * 1024 * 1024)
        return this.fail(new Error('invalid-analysis'))
      let result
      try {
        result = JSON.parse(line)
      } catch {
        return this.fail(new Error('invalid-analysis'))
      }
      const pending = this.pending.get(result.id)
      if (!pending) return
      if (result.error) pending.finish(new Error('invalid-analysis'))
      else if (
        result.isDuringSearch !== true &&
        (pending.turn == null || result.turnNumber === pending.turn)
      )
        pending.finish(null, result)
    })
    this.abort = () => this.fail(abortError())
    signal?.addEventListener('abort', this.abort, {once: true})
    if (signal?.aborted) this.abort()
  }
  fail(error) {
    this.closed = true
    for (const pending of this.pending.values()) pending.finish(error)
    this.close()
  }
  close() {
    this.closed = true
    for (const pending of this.pending.values())
      pending.finish(new Error('engine-stopped'))
    this.signal?.removeEventListener('abort', this.abort)
    this.reader?.close()
    this.child?.kill('SIGKILL')
    return this.exited
  }
  request(input, turn = null) {
    if (this.closed || this.signal?.aborted)
      return Promise.reject(
        this.signal?.aborted ? abortError() : new Error('engine-stopped'),
      )
    const id = `${this.requestPrefix}-${++this.serial}`
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => this.fail(new Error('engine-timeout')),
        this.timeout,
      )
      const finish = (error, result) => {
        clearTimeout(timer)
        this.pending.delete(id)
        if (error) reject(error)
        else resolve(result)
      }
      this.pending.set(id, {finish, turn})
      this.child.stdin.write(JSON.stringify({...input, id}) + '\n')
    })
  }
  async analyze(
    position,
    turn,
    {visits = 100, maxTime = 1, allowMove = null, includePolicy = false} = {},
  ) {
    const input = {
      initialStones: position.initialStones,
      initialPlayer: position.initialPlayer,
      moves: position.moves,
      rules: position.rules,
      komi: position.komi,
      boardXSize: position.boardXSize,
      boardYSize: position.boardYSize,
      analyzeTurns: [turn],
      maxVisits: visits,
      analysisPVLen: 11,
      includePolicy,
      overrideSettings: {maxTime, ignorePreRootHistory: false},
    }
    const player =
      turn < position.moves.length
        ? position.moves[turn][0]
        : turn === 0
          ? position.initialPlayer
          : position.moves[turn - 1][0] === 'B'
            ? 'W'
            : 'B'
    if (allowMove)
      input.allowMoves = [{player, moves: [allowMove], untilDepth: 1}]
    const result = await this.request(input, turn)
    if (
      !result.rootInfo ||
      !Array.isArray(result.moveInfos) ||
      !Number.isFinite(result.rootInfo.visits) ||
      result.rootInfo.visits <= 0 ||
      !Number.isFinite(result.rootInfo.winrate) ||
      result.rootInfo.winrate < 0 ||
      result.rootInfo.winrate > 1 ||
      !Number.isFinite(result.rootInfo.scoreLead) ||
      result.rootInfo.currentPlayer !== player
    )
      throw new Error('invalid-analysis')
    const candidates = result.moveInfos
      .filter(
        (move) =>
          Number.isFinite(move.winrate) &&
          move.winrate >= 0 &&
          move.winrate <= 1 &&
          Number.isFinite(move.scoreLead) &&
          Number.isFinite(move.visits) &&
          move.visits > 0 &&
          typeof move.move === 'string' &&
          Array.isArray(move.pv) &&
          (move.pv.length === 0 || move.pv[0] === move.move),
      )
      .sort((a, b) => a.order - b.order || b.visits - a.visits)
    if (
      (!candidates.length && !includePolicy) ||
      (allowMove && candidates[0]?.move !== allowMove) ||
      (includePolicy &&
        (!Array.isArray(result.policy) ||
          result.policy.length !==
            position.boardXSize * position.boardYSize + 1 ||
          result.policy.some((p) => !Number.isFinite(p) || p < -1 || p > 1)))
    )
      throw new Error('invalid-analysis')
    return {
      id: result.id,
      turn,
      root: result.rootInfo,
      candidates,
      policy: result.policy,
    }
  }
}
const config = [
  'reportAnalysisWinratesAs = BLACK',
  'numAnalysisThreads = 1',
  'numSearchThreadsPerAnalysisThread = 2',
  'nnCacheSizePowerOfTwo = 18',
  'nnMutexPoolSizePowerOfTwo = 16',
  'nnMaxBatchSize = 16',
  'maxVisits = 100',
  'logToStderr = true',
  'logAllRequests = false',
  'logAllResponses = false',
  'analysisPVLen = 11',
  '',
].join('\n')
module.exports = {KataGo, config, supports, profile}
