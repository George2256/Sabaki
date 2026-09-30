import {h, Component} from 'preact'
import sabaki from '../../modules/sabaki.js'
import {rules} from '../../teaching/position.js'
import {t as text} from '../../teaching/strings.js'
import LessonDiagram from './LessonDiagram.js'

const setting = {
  get: (key) => window.sabaki.setting.get(key),
  set: (key, value) => window.sabaki.setting.set(key, value),
}
export default class TeachingReview extends Component {
  constructor(props) {
    super(props)
    this.state = {
      engines: [],
      engineIndex: '',
      rules: '',
      budget: setting.get('teaching.budget'),
      endpoint: 'http://127.0.0.1:11434/v1/chat/completions',
      model: '',
      token: '',
      configured: false,
      useLLM: false,
      error: null,
    }
    this.refresh = async () => {
      const result = await window.sabaki.teaching.status()
      if (!this.mounted || !result.ok) return
      const engines = result.data.engines
      this.setState((state) => ({
        engines,
        engineIndex:
          engines.some((e) => e.index === Number(state.engineIndex)) &&
          state.engineIndex !== ''
            ? state.engineIndex
            : (engines[0]?.index ?? ''),
        configured: !!result.data.llm,
        ...(result.data.llm
          ? {endpoint: result.data.llm.endpoint, model: result.data.llm.model}
          : {}),
      }))
    }
    this.start = async () => {
      this.setState({error: null})
      try {
        await sabaki.startTeachingReview({
          engineIndex:
            this.state.engineIndex === ''
              ? null
              : Number(this.state.engineIndex),
          rules: this.state.rules,
          budget: this.state.budget,
          useLLM: this.state.useLLM,
        })
      } catch (error) {
        this.setState({error: error.message})
      }
    }
    this.configure = async () => {
      const result = await window.sabaki.teaching.configure({
        endpoint: this.state.endpoint,
        model: this.state.model,
        token: this.state.token,
      })
      this.setState({
        token: '',
        configured: result.ok,
        error: result.ok ? null : result.error,
      })
    }
  }
  componentDidMount() {
    this.mounted = true
    this.refresh()
    this.unsubscribe = window.sabaki.setting.onDidChange(({key}) => {
      if (key === 'engines.list') this.refresh()
    })
  }
  componentWillUnmount() {
    this.mounted = false
    this.unsubscribe()
  }
  render({review, position, active, engineGameOngoing}, state) {
    const language = setting.get('app.lang')
    const t = (key, params) => text(language, key, params)
    const busy = !!review?.running
    const canResume =
      !review?.stale &&
      ['canceled', 'failed'].includes(review?.phase) &&
      review.engineIndex === Number(state.engineIndex) &&
      review.budget === state.budget &&
      (!state.rules || state.rules === position?.rules)
    const error = state.error || review?.error
    const field = (key, value, onChange, options) =>
      h(
        'label',
        {},
        h('span', {}, t(key)),
        h('select', {value, disabled: busy, onChange}, options),
      )
    return h(
      'section',
      {id: 'teaching-review', hidden: !active, 'aria-label': t('title')},
      h(
        'div',
        {class: 'teaching-controls'},
        h(
          'div',
          {class: 'teaching-header'},
          h('h3', {}, t('title')),
          h(
            'button',
            {
              type: 'button',
              class: 'teaching-close',
              'aria-label': t('close'),
              title: t('close'),
              onClick: () => sabaki.closeTeachingReview(),
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
            setting.set('teaching.budget', evt.currentTarget.value)
          },
          ['quick', 'standard', 'thorough'].map((value) =>
            h('option', {value}, t(value)),
          ),
        ),
        h(
          'details',
          {class: 'teaching-llm'},
          h('summary', {}, t('llm')),
          ...['endpoint', 'model', 'token'].map((key) =>
            h(
              'label',
              {},
              h('span', {}, t(key)),
              h('input', {
                type: key === 'token' ? 'password' : 'text',
                value: state[key],
                disabled: busy,
                autoComplete: 'off',
                onInput: (evt) =>
                  this.setState({
                    [key]: evt.currentTarget.value,
                    configured: false,
                    useLLM: false,
                  }),
              }),
            ),
          ),
          h(
            'button',
            {type: 'button', disabled: busy, onClick: this.configure},
            t('configure'),
          ),
          state.configured && h('p', {}, t('configured')),
          h(
            'label',
            {class: 'teaching-consent'},
            h('input', {
              type: 'checkbox',
              checked: state.useLLM,
              disabled: busy || !state.configured,
              onChange: (evt) =>
                this.setState({useLLM: evt.currentTarget.checked}),
            }),
            t('llmConsent'),
          ),
        ),
        h(
          'button',
          {
            type: 'button',
            class: 'teaching-start',
            disabled:
              !busy && (engineGameOngoing != null || !state.engines.length),
            onClick: () => (busy ? sabaki.stopTeachingReview() : this.start()),
          },
          t(busy ? 'stop' : canResume ? 'resume' : 'start'),
        ),
        review &&
          h(
            'p',
            {role: 'status', class: 'teaching-status'},
            `${t(review.phase)} ${review.completed ?? 0}/${review.total ?? 0}`,
          ),
        review?.reused > 0 &&
          h(
            'p',
            {class: 'teaching-cache'},
            t('reused', {count: review.reused}),
          ),
        canResume && h('p', {class: 'teaching-cache'}, t('resumeNote')),
        error && h('p', {role: 'alert', class: 'teaching-error'}, t(error)),
        review?.stale &&
          h('p', {role: 'status', class: 'teaching-error'}, t('stale')),
        review?.llmFallback &&
          h('p', {class: 'teaching-error'}, t('llmFallback')),
        review?.skipped > 0 &&
          h('p', {}, t('skipped', {count: review.skipped})),
      ),
      !review?.stale &&
        position &&
        review?.cards?.map((card) =>
          h(
            'article',
            {class: 'teaching-card', key: card.id},
            h(
              'div',
              {class: 'teaching-card-heading'},
              h(
                'h3',
                {},
                `${t('move', {number: card.moveNumber})} · ${t(card.kind)}`,
              ),
              h(
                'button',
                {
                  type: 'button',
                  onClick: () => {
                    const tree = sabaki.inferredState.gameTree
                    if (
                      tree.root.id === position.rootId &&
                      tree.get(card.nodeId)
                    )
                      sabaki.setCurrentTreePosition(tree, card.nodeId)
                  },
                },
                t('locate'),
              ),
            ),
            h('p', {}, card.summary),
            card.warning && h('p', {class: 'teaching-error'}, card.warning),
            card.diagrams.map((diagram) =>
              h(LessonDiagram, {
                key: diagram.id,
                position,
                index: card.index,
                diagram,
                language,
              }),
            ),
            card.paragraphs?.map((paragraph) =>
              h(
                'div',
                {class: 'teaching-interpretation'},
                h('strong', {}, t('interpretation')),
                h('p', {}, paragraph.text),
                h(
                  'small',
                  {},
                  paragraph.evidenceIds
                    .map((id) => t(card.diagrams.find((d) => d.id === id).kind))
                    .join(' · '),
                ),
              ),
            ),
            h(
              'details',
              {class: 'teaching-evidence'},
              h('summary', {}, t('evidence')),
              h(
                'p',
                {},
                t('metadata', {
                  rules: t(card.evidence.rules),
                  komi: card.evidence.komi,
                  engine: `${card.engine.name} ${card.engine.version}`,
                }),
              ),
              h(
                'p',
                {},
                t('visits', {
                  best: card.evidence.best.visits,
                  actual: card.evidence.played.visits,
                }),
              ),
              h(
                'p',
                {},
                `${card.engine.model} · SHA-256 ${card.engine.modelSha256}`,
              ),
              h(
                'p',
                {},
                card.diagrams
                  .map(
                    (d) =>
                      `${t(d.kind)}: ${d.sourceId || 'SGF'} → ${(d.legalityIds || []).join(', ')} → ${d.replayId}`,
                  )
                  .join('\n'),
              ),
              h('p', {}, t('estimates')),
            ),
          ),
        ),
      review?.phase === 'complete' &&
        !review.stale &&
        review.cards.length === 0 &&
        h('p', {class: 'teaching-empty'}, t('empty')),
    )
  }
}
