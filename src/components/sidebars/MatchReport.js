import {h, Component} from 'preact'
import sabaki from '../../modules/sabaki.js'
import {showOpenDialog} from '../../modules/dialog.js'
import {rules} from '../../teaching/position.js'
import {t as text, formatEvidence, formatChance} from '../../match/strings.js'
import {analyze, budgets} from '../../match/stats.js'
import {ladder, parseRank, rankLabel, profileLabel} from '../../match/ranks.js'

const setting = {
  get: (key) => window.sabaki.setting.get(key),
  set: (key, value) => window.sabaki.setting.set(key, value),
}
const percent = (x) => (x == null ? '—' : `${(x * 100).toFixed(1)}%`)
const fixed = (x, digits = 2) => (x == null ? '—' : x.toFixed(digits))

export default class MatchReport extends Component {
  constructor(props) {
    super(props)
    this.state = {
      engines: [],
      engineIndex: '',
      rules: '',
      budget: setting.get('match.budget'),
      rankB: 'auto',
      rankW: 'auto',
      margin: String(setting.get('match.margin')),
      from: '1',
      to: '',
      excludeDecided: setting.get('match.exclude_decided'),
      filter: 'all',
      copied: false,
      error: null,
    }
    this.refresh = async () => {
      const result = await window.sabaki.match.status()
      if (!this.mounted || !result.ok) return
      const engines = result.data.engines
      this.setState((state) => ({
        engines,
        engineIndex:
          state.engineIndex !== '' &&
          engines.some((e) => e.index === Number(state.engineIndex))
            ? state.engineIndex
            : (engines[0]?.index ?? ''),
      }))
    }
    this.start = async () => {
      this.setState({error: null})
      try {
        await sabaki.startMatchReview({
          engineIndex:
            this.state.engineIndex === ''
              ? null
              : Number(this.state.engineIndex),
          rules: this.state.rules,
          budget: this.state.budget,
          ranks: this.ranks(),
          margin: Number(this.state.margin),
        })
      } catch (error) {
        this.setState({error: error.message})
      }
    }
    this.chooseHumanModel = async () => {
      const result = await showOpenDialog({
        properties: ['openFile'],
        filters: [{name: 'KataGo', extensions: ['gz', 'bin']}],
      })
      if (!result?.length) return
      await setting.set('match.human_model', result[0])
      this.refresh()
    }
    this.locate = (index) => {
      const {gameTree, position} = this.props
      const nodeId = position.anchors[index]?.nodeId
      if (gameTree.root.id === position.rootId && gameTree.get(nodeId) != null)
        sabaki.setCurrentTreePosition(gameTree, nodeId)
    }
  }

  componentDidMount() {
    this.mounted = true
    this.refresh()
    this.unsubscribe = window.sabaki.setting.onDidChange(({key}) => {
      if (key === 'engines.list' || key === 'match.human_model') this.refresh()
    })
  }

  componentWillUnmount() {
    this.mounted = false
    this.unsubscribe()
    clearTimeout(this.copiedTimer)
  }

  sgfRanks() {
    const data = this.props.gameTree.root.data
    return {B: parseRank(data.BR?.[0]), W: parseRank(data.WR?.[0])}
  }

  ranks() {
    const sgf = this.sgfRanks()
    const pick = (value, parsed) =>
      value === 'auto' ? parsed : value === 'unknown' ? null : value
    return {
      B: pick(this.state.rankB, sgf.B),
      W: pick(this.state.rankW, sgf.W),
    }
  }

  eta(review, t) {
    // Wait for a few fresh positions; the first batch includes engine start-up.
    if (review.phase !== 'scanning' || !(review.fresh >= 4)) return null
    const remaining = review.total - review.completed
    const seconds =
      (((Date.now() - review.startedAt) / review.fresh) * remaining) / 1000
    return seconds < 60
      ? t('etaSoon')
      : t('eta', {minutes: Math.ceil(seconds / 60)})
  }

  options() {
    const from = Math.max(1, Math.floor(Number(this.state.from)) || 1)
    const to = Math.floor(Number(this.state.to)) || Infinity
    return {
      from,
      to,
      excludeDecided: this.state.excludeDecided,
      bands: this.props.review?.bands,
    }
  }

  players() {
    const {gameTree, position} = this.props
    const data = gameTree.root.id === position?.rootId ? gameTree.root.data : {}
    return {B: data.PB?.[0] || '', W: data.PW?.[0] || ''}
  }

  bandLabel(band, language) {
    if (!band?.length) return ''
    const first = profileLabel(band[0], language)
    return band.length === 1
      ? first
      : `${first}～${profileLabel(band.at(-1), language)}`
  }

  evidenceLines(summary, t, language) {
    const e = summary.evidence
    if (!e?.available || !e.counted) return []
    return [
      t('baseline', {band: this.bandLabel(e.band, language)}),
      e.log10E > 0
        ? `${t('evidence', {value: formatEvidence(e.log10E)})} · ${t('chance', {value: formatChance(e.log10E)})}`
        : t('noEvidence'),
      t('matchedVsExpected', {
        matched: e.matched,
        counted: e.counted,
        expected: fixed(e.expected, 1),
      }),
    ]
  }

  reportText(report, t, language) {
    const {position} = this.props
    const players = this.players()
    const {from, to} = this.options()
    const name = (color) =>
      `${t(color === 'B' ? 'black' : 'white')}${players[color] ? ` ${players[color]}` : ''}`
    const rows = this.metricRows(report, t)
    const width = Math.max(...rows.map(([label]) => label.length))
    const verdicts = [report.black, report.white].flatMap((summary) => [
      `${name(summary.color)}: ${t(`verdict-${this.verdictOf(summary)}`)}`,
      ...this.evidenceLines(summary, t, language).map((line) => `  ${line}`),
    ])
    const segments = this.segments(report).map(
      ({color, segment}) => `  ${this.segmentText(color, segment, t)}`,
    )
    return [
      t('title'),
      `${name('B')} / ${name('W')}`,
      this.sourceLine(t),
      `${t('from')} ${from} – ${t('to')} ${to === Infinity ? t('end') : to}`,
      '',
      ...verdicts,
      ...(segments.length ? ['', t('segments'), ...segments] : []),
      '',
      `${''.padEnd(width)}  ${t('black')}  ${t('white')}`,
      ...rows.map(
        ([label, black, white]) => `${label.padEnd(width)}  ${black}  ${white}`,
      ),
      '',
      this.excludedLine(report, t),
      position?.rulesFallback ? t('rulesFallback') : null,
      t('disclaimer'),
    ]
      .filter((line) => line != null)
      .join('\n')
  }

  sourceLine(t) {
    const {review, position} = this.props
    return t('source', {
      engine: review.engine?.name || 'KataGo',
      version: review.engine?.version || '',
      model: review.engine?.model || '',
      human: review.engine?.humanModel || '—',
      visits: review.visits ?? '',
      rules: t(position.rules),
      komi: position.komi,
    })
  }

  excludedLine(report, t) {
    const sum = (key) => report.black.excluded[key] + report.white.excluded[key]
    return t('excludedSummary', {
      range: sum('range'),
      decided: sum('decided'),
      pass: sum('pass'),
    })
  }

  verdictOf(summary) {
    const e = summary.evidence
    if (summary.excluded.pending > 0) return 'pending'
    if (!e?.available) return 'uncalibrated'
    return e.verdict
  }

  segments(report) {
    return [report.black, report.white].flatMap((summary) =>
      (summary.evidence?.segments ?? []).map((segment) => ({
        color: summary.color,
        segment,
      })),
    )
  }

  segmentText(color, segment, t) {
    return t('segment', {
      player: t(color === 'B' ? 'black' : 'white'),
      from: segment.from,
      to: segment.to,
      moves: segment.moves,
      matched: segment.matched,
      expected: fixed(segment.expected, 1),
    })
  }

  metricRows(report, t) {
    const both = (format) => [format(report.black), format(report.white)]
    return [
      [t('counted'), ...both((s) => `${s.counted}/${s.total}`)],
      [t('matched'), ...both((s) => percent(s.matched))],
      [t('top1'), ...both((s) => percent(s.top1))],
      [t('top3'), ...both((s) => percent(s.top3))],
      [t('near'), ...both((s) => percent(s.near))],
      [
        t('scoreLoss'),
        ...both((s) =>
          s.scoreLoss == null ? '—' : t('points', {value: fixed(s.scoreLoss)}),
        ),
      ],
      [
        t('winrateLoss'),
        ...both((s) =>
          s.winrateLoss == null ? '—' : `${fixed(s.winrateLoss, 1)}%`,
        ),
      ],
      [t('mistakes'), ...both((s) => String(s.mistakes))],
      [t('blunders'), ...both((s) => String(s.blunders))],
    ]
  }

  renderTimeline(report, t, current) {
    const {position} = this.props
    const total = position.moves.length
    const row = (summary) => {
      const moves = summary.evidence?.moves ?? []
      const player = t(summary.color === 'B' ? 'black' : 'white')
      return h(
        'div',
        {class: 'match-timeline-row'},
        h('span', {}, player.slice(0, 1)),
        h(
          'svg',
          {
            viewBox: `0 0 ${total} 1`,
            preserveAspectRatio: 'none',
            role: 'img',
            'aria-label': `${t('timeline')} · ${player}`,
          },
          current >= 0 &&
            h('rect', {
              class: 'match-timeline-current',
              x: current,
              y: 0,
              width: 1,
              height: 1,
            }),
          moves.map((m) =>
            h(
              'g',
              {key: m.index, onClick: () => this.locate(m.index)},
              h('rect', {
                class: 'match-timeline-slot',
                x: m.index,
                y: 0,
                width: 0.9,
                height: 1,
              }),
              h(
                'rect',
                {
                  class: m.matched ? 'match-bar matched' : 'match-bar',
                  x: m.index,
                  y: 1 - m.posterior,
                  width: 0.9,
                  height: m.posterior,
                  style: {opacity: 0.35 + 0.65 * m.posterior},
                },
                h(
                  'title',
                  {},
                  t('moveTitle', {
                    number: m.moveNumber,
                    player,
                    match: t(m.matched ? 'matchYes' : 'matchNo'),
                    p: percent(m.p),
                    posterior: percent(m.posterior),
                  }),
                ),
              ),
            ),
          ),
        ),
      )
    }
    return h(
      'div',
      {class: 'match-timeline'},
      h('h4', {}, t('timeline')),
      row(report.black),
      row(report.white),
    )
  }

  renderReport(t, language) {
    const {review, position, gameTree, treePosition} = this.props
    const report = analyze(position, review.results, this.options())
    const players = this.players()
    const rows = this.metricRows(report, t)
    const filter = this.state.filter
    const posterior = new Map(
      [report.black, report.white].flatMap((s) =>
        (s.evidence?.moves ?? []).map((m) => [m.index, m]),
      ),
    )
    const records = report.records.filter((r) =>
      filter === 'black'
        ? r.color === 'B'
        : filter === 'white'
          ? r.color === 'W'
          : filter === 'issues'
            ? !r.excluded && r.level != null
            : filter === 'likely'
              ? posterior.get(r.index)?.posterior >= 0.5
              : true,
    )
    const current = position.anchors.findIndex(
      (anchor) => anchor.nodeId === treePosition,
    )
    const onTree = gameTree.root.id === position.rootId
    const calibrated = [report.black, report.white].some(
      (s) => s.evidence?.available,
    )
    const segments = this.segments(report)

    return h(
      'div',
      {class: 'match-result'},
      h(
        'div',
        {class: 'match-verdicts'},
        [report.black, report.white].map((summary) => {
          const verdict = this.verdictOf(summary)
          return h(
            'div',
            {class: `match-verdict verdict-${verdict}`},
            h(
              'span',
              {class: 'match-player'},
              t(summary.color === 'B' ? 'black' : 'white'),
              players[summary.color] && ` · ${players[summary.color]}`,
            ),
            h('strong', {}, t(`verdict-${verdict}`)),
            h('small', {}, t(`explain-${verdict}`)),
            this.evidenceLines(summary, t, language).map((line) =>
              h('small', {class: 'match-evidence'}, line),
            ),
          )
        }),
      ),
      calibrated && this.renderTimeline(report, t, current),
      calibrated &&
        h(
          'div',
          {class: 'match-segments'},
          h('h4', {}, t('segments')),
          segments.length
            ? segments.map(({color, segment}) =>
                h(
                  'button',
                  {
                    type: 'button',
                    disabled: !onTree,
                    onClick: () => this.locate(segment.start),
                  },
                  this.segmentText(color, segment, t),
                ),
              )
            : h('p', {class: 'match-note'}, t('noSegments')),
        ),
      h(
        'table',
        {class: 'match-table'},
        h(
          'thead',
          {},
          h(
            'tr',
            {},
            h('th', {}),
            h('th', {}, t('black')),
            h('th', {}, t('white')),
          ),
        ),
        h(
          'tbody',
          {},
          rows.map(([label, black, white]) =>
            h(
              'tr',
              {},
              h('th', {scope: 'row'}, label),
              h('td', {}, black),
              h('td', {}, white),
            ),
          ),
        ),
      ),
      h('p', {class: 'match-note'}, this.excludedLine(report, t)),
      review.engine && h('p', {class: 'match-note'}, this.sourceLine(t)),
      position.rulesFallback &&
        h('p', {class: 'match-note'}, t('rulesFallback')),
      h('p', {class: 'match-note match-disclaimer'}, t('disclaimer')),
      h(
        'button',
        {
          type: 'button',
          class: 'match-copy',
          onClick: async () => {
            try {
              await navigator.clipboard.writeText(
                this.reportText(report, t, language),
              )
              this.setState({copied: true})
              clearTimeout(this.copiedTimer)
              this.copiedTimer = setTimeout(
                () => this.setState({copied: false}),
                1500,
              )
            } catch {}
          },
        },
        t(this.state.copied ? 'copied' : 'copy'),
      ),
      h(
        'div',
        {class: 'match-details-heading'},
        h('h4', {}, t('details')),
        h(
          'select',
          {
            value: filter,
            'aria-label': t('details'),
            onChange: (evt) => this.setState({filter: evt.currentTarget.value}),
          },
          [
            'all',
            'black',
            'white',
            'issues',
            ...(calibrated ? ['likely'] : []),
          ].map((value) => h('option', {value}, t(value))),
        ),
      ),
      h(
        'ol',
        {class: 'match-moves'},
        records.map((r) => {
          const evidence = posterior.get(r.index)
          return h(
            'li',
            {key: r.index},
            h(
              'button',
              {
                type: 'button',
                disabled: !onTree,
                class: [
                  r.excluded
                    ? 'excluded'
                    : evidence?.posterior >= 0.5
                      ? 'likely'
                      : r.level || (r.top1 ? 'top1' : ''),
                  r.index === current ? 'current' : '',
                ].join(' '),
                onClick: () => this.locate(r.index),
              },
              h(
                'span',
                {class: 'match-move'},
                `${r.moveNumber} ${t(r.color === 'B' ? 'black' : 'white').slice(0, 1)} ${r.move}`,
              ),
              h(
                'span',
                {class: 'match-choice'},
                r.best == null
                  ? ''
                  : r.top1
                    ? t('aiTop')
                    : `${t('aiChoice', {move: r.best})} · ${
                        r.rank == null
                          ? t('unranked')
                          : t('rank', {rank: r.rank})
                      }`,
              ),
              h(
                'span',
                {class: 'match-loss'},
                r.scoreLoss == null
                  ? ''
                  : t('loss', {
                      score: fixed(r.scoreLoss, 1),
                      winrate: fixed(r.winrateLoss, 1),
                    }),
              ),
              h(
                'span',
                {class: 'match-tag'},
                r.excluded
                  ? t(`excluded-${r.excluded}`)
                  : evidence?.posterior >= 0.5
                    ? `AI ${percent(evidence.posterior)}`
                    : r.level
                      ? t(`level-${r.level}`)
                      : '',
              ),
            ),
          )
        }),
      ),
    )
  }

  render({review, position, active, engineGameOngoing}, state) {
    const language = setting.get('app.lang')
    const t = (key, params) => text(language, key, params)
    const busy = !!review?.running
    const ranks = this.ranks()
    const canResume =
      !review?.stale &&
      ['canceled', 'failed'].includes(review?.phase) &&
      review.engineIndex === Number(state.engineIndex) &&
      review.budget === state.budget &&
      review.ranks?.B === ranks.B &&
      review.ranks?.W === ranks.W &&
      review.margin === Number(state.margin) &&
      (!state.rules || state.rules === position?.rules)
    const error = state.error || review?.error
    const engine = state.engines.find(
      (e) => e.index === Number(state.engineIndex),
    )
    const sgf = this.sgfRanks()
    const field = (key, value, onChange, options) =>
      h(
        'label',
        {},
        h('span', {}, t(key)),
        h(
          'select',
          {value, disabled: busy, onChange, 'aria-label': t(key)},
          options,
        ),
      )
    const rankField = (key, color) =>
      field(
        key,
        state[key],
        (evt) => this.setState({[key]: evt.currentTarget.value}),
        [
          h(
            'option',
            {value: 'auto'},
            sgf[color]
              ? t('rankAuto', {rank: rankLabel(sgf[color], language)})
              : t('rankAutoUnknown'),
          ),
          ...ladder.map((rank) =>
            h('option', {value: rank}, rankLabel(rank, language)),
          ),
          h('option', {value: 'unknown'}, t('rankUnknown')),
        ],
      )

    return h(
      'section',
      {id: 'match-report', hidden: !active, 'aria-label': t('title')},
      h(
        'div',
        {class: 'match-controls'},
        h(
          'div',
          {class: 'match-header'},
          h('h3', {}, t('title')),
          h(
            'button',
            {
              type: 'button',
              class: 'match-close',
              'aria-label': t('close'),
              title: t('close'),
              onClick: () => sabaki.closeMatchReport(),
            },
            '×',
          ),
        ),
        field(
          'engine',
          state.engineIndex,
          (evt) => this.setState({engineIndex: evt.currentTarget.value}),
          state.engines.length
            ? state.engines.map((e) => h('option', {value: e.index}, e.name))
            : h('option', {value: ''}, '—'),
        ),
        !state.engines.length &&
          h(
            'button',
            {type: 'button', onClick: () => sabaki.openEngineSetup()},
            t('prepare'),
          ),
        engine &&
          (engine.humanModel
            ? h(
                'p',
                {class: 'match-note match-human'},
                t('humanFound', {name: engine.humanModel}),
              )
            : h(
                'div',
                {class: 'match-human-missing'},
                h('p', {class: 'match-error'}, t('humanMissing')),
                h(
                  'button',
                  {
                    type: 'button',
                    disabled: busy,
                    onClick: this.chooseHumanModel,
                  },
                  t('chooseHumanModel'),
                ),
              )),
        field(
          'rules',
          state.rules,
          (evt) => this.setState({rules: evt.currentTarget.value}),
          [
            h('option', {value: ''}, t('automatic')),
            ...rules.map((rule) => h('option', {value: rule}, t(rule))),
          ],
        ),
        field(
          'budget',
          state.budget,
          (evt) => {
            this.setState({budget: evt.currentTarget.value})
            setting.set('match.budget', evt.currentTarget.value)
          },
          Object.keys(budgets).map((value) =>
            h('option', {value}, t(value, {visits: budgets[value].visits})),
          ),
        ),
        rankField('rankB', 'B'),
        rankField('rankW', 'W'),
        field(
          'margin',
          state.margin,
          (evt) => {
            this.setState({margin: evt.currentTarget.value})
            setting.set('match.margin', Number(evt.currentTarget.value))
          },
          ['0', '3', '6'].map((value) =>
            h('option', {value}, t(`margin${value}`)),
          ),
        ),
        h(
          'div',
          {class: 'match-range'},
          ['from', 'to'].map((key) =>
            h(
              'label',
              {},
              h('span', {}, t(key)),
              h('input', {
                type: 'number',
                min: 1,
                step: 1,
                value: state[key],
                placeholder: key === 'to' ? t('end') : '1',
                'aria-label': t(key),
                onInput: (evt) =>
                  this.setState({[key]: evt.currentTarget.value}),
              }),
            ),
          ),
        ),
        h(
          'label',
          {class: 'match-check'},
          h('input', {
            type: 'checkbox',
            checked: state.excludeDecided,
            onChange: (evt) => {
              this.setState({excludeDecided: evt.currentTarget.checked})
              setting.set('match.exclude_decided', evt.currentTarget.checked)
            },
          }),
          t('excludeDecided'),
        ),
        h(
          'button',
          {
            type: 'button',
            class: 'match-start',
            disabled:
              !busy && (engineGameOngoing != null || !state.engines.length),
            onClick: () => (busy ? sabaki.stopMatchReview() : this.start()),
          },
          t(busy ? 'stop' : canResume ? 'resume' : 'start'),
        ),
        review &&
          h(
            'p',
            {role: 'status', class: 'match-status'},
            `${t(review.phase)} ${review.completed ?? 0}/${review.total ?? 0}`,
            busy && this.eta(review, t) && ` · ${this.eta(review, t)}`,
          ),
        review?.reused > 0 &&
          h('p', {class: 'match-note'}, t('reused', {count: review.reused})),
        error && h('p', {role: 'alert', class: 'match-error'}, t(error)),
        review?.stale &&
          h('p', {role: 'status', class: 'match-error'}, t('stale')),
      ),
      !review?.stale &&
        position &&
        review?.results?.length === position.moves.length + 1 &&
        this.renderReport(t, language),
    )
  }
}
