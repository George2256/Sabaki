import {h, Component} from 'preact'
import i18n from '../../i18n.js'
import strings from '../../engine-setup-strings.js'
import sabaki from '../../modules/sabaki.js'
import Drawer from './Drawer.js'

const t = i18n.context('EngineSetup')
const busyPhases = ['preparing', 'downloading', 'verifying', 'checking']
const messages = {
  preparing: 'Preparing…',
  downloading: 'Downloading engine and model…',
  verifying: 'Checking downloaded files…',
  checking: 'Testing analysis on this computer…',
  ready: 'Ready to analyze',
  canceled: 'Setup canceled. Downloaded files are kept for your next attempt.',
}

export default class EngineSetupDrawer extends Component {
  constructor() {
    super()
    this.state = {
      phase: 'idle',
      supported: false,
      loading: true,
      connecting: false,
      error: '',
    }
    this.generation = 0
  }

  componentDidMount() {
    this.unsubscribe = window.sabaki.engineSetup.onChange((state) =>
      this.setState(state),
    )
  }

  componentDidUpdate(previous) {
    if (!previous.show && this.props.show) this.loadStatus()
    if (previous.show && !this.props.show) this.generation++
  }

  componentWillUnmount() {
    this.generation++
    this.unsubscribe?.()
  }

  async loadStatus() {
    const generation = ++this.generation
    this.setState({loading: true, connecting: false, error: '', engine: null})
    try {
      const existing = sabaki.getExistingAnalysisEngine()
      if (existing) {
        this.setState({
          phase: 'ready',
          engine: existing,
          existing: true,
          local: false,
          loading: false,
        })
        if (sabaki.automaticAnalysisIntent) await this.connect(existing)
        return
      }
      const response = await window.sabaki.engineSetup.status()
      if (generation !== this.generation) return
      if (!response.ok) throw new Error(response.error)
      await new Promise((resolve) =>
        this.setState({...response.data, loading: false}, resolve),
      )
      if (generation !== this.generation || !this.props.show) return
      if (response.data.phase === 'local' && sabaki.automaticAnalysisIntent)
        return this.prepare()
      // Reuse a prepared or locally discovered engine immediately.
      if (response.data.phase === 'ready' && sabaki.automaticAnalysisIntent)
        this.connect(response.data.engine)
    } catch (error) {
      if (generation === this.generation)
        this.setState({
          loading: false,
          error: 'The engine could not start. Please retry.',
        })
    }
  }

  async connect(engine) {
    const generation = this.generation
    this.setState({connecting: true, error: ''})
    try {
      await sabaki.finishEngineSetup(engine)
    } catch (error) {
      if (generation === this.generation)
        this.setState({
          error: Object.hasOwn(strings['zh-Hans'], error.message)
            ? error.message
            : 'Unable to connect the engine. Please retry.',
        })
    } finally {
      if (generation === this.generation) this.setState({connecting: false})
    }
  }

  async prepare() {
    if (
      this.state.connecting ||
      this.state.loading ||
      busyPhases.includes(this.state.phase)
    )
      return
    if (
      this.state.error ===
      'The game changed during setup. Click Analyze game again to analyze the current game.'
    ) {
      sabaki.openEngineSetup({analyze: true})
      return this.connect(this.state.engine)
    }
    // A connection failure must retry the same engine, never install another.
    if (this.state.engine && !this.state.local)
      return this.connect(this.state.engine)
    const generation = this.generation
    this.setState({phase: 'preparing', error: ''})
    try {
      const response = await window.sabaki.engineSetup.install()
      if (generation !== this.generation || !this.props.show) return
      if (!response.ok) throw new Error(response.error)
      await this.connect(response.data)
    } catch (error) {
      if (generation === this.generation && this.state.phase !== 'canceled')
        this.setState({
          phase: 'error',
          error: Object.hasOwn(strings['zh-Hans'], error.message)
            ? error.message
            : 'The engine could not start. Please retry.',
        })
    }
  }

  render({show}, state) {
    const busy =
      state.loading || state.connecting || busyPhases.includes(state.phase)
    const existing = state.existing || !!state.engine
    const percent = state.total
      ? Math.min(100, Math.floor((state.received * 100) / state.total))
      : null
    const step =
      state.phase === 'ready'
        ? 3
        : state.phase === 'checking'
          ? 2
          : ['downloading', 'verifying'].includes(state.phase)
            ? 1
            : 0
    return h(
      Drawer,
      {type: 'enginesetup', show},
      h('h2', {}, t('Automatic engine setup')),
      h(
        'p',
        {class: 'engine-setup-intro'},
        t(
          existing
            ? 'An existing engine was found. Sabaki will load it for analysis.'
            : 'Sabaki checks for an existing engine first. KataGo and its model are downloaded only when needed.',
        ),
      ),
      existing && h('p', {}, state.engine?.name),
      !existing &&
        h(
          'ol',
          {class: 'engine-setup-steps'},
          ['Setup', 'Download', 'Check', 'Ready'].map((label, i) =>
            h(
              'li',
              {
                class: i === step ? 'current' : i < step ? 'complete' : '',
                'aria-current': i === step ? 'step' : undefined,
              },
              t(label),
            ),
          ),
        ),
      h(
        'div',
        {class: 'engine-setup-status', role: 'status', 'aria-live': 'polite'},
        t(
          state.connecting || state.loading
            ? 'Preparing…'
            : messages[state.phase] || 'Prepare analysis',
        ),
        state.phase === 'downloading' &&
          h(
            'p',
            {},
            `${t(state.source || 'Tsinghua mirror')} · ${state.package || 1}/${state.packages || 7}`,
            state.received > 0 &&
              ` · ${(state.received / 1024 / 1024).toFixed(1)} MB`,
            percent != null && ` · ${percent}%`,
          ),
      ),
      busyPhases.includes(state.phase) &&
        h('progress', {
          max: 100,
          value:
            state.phase === 'downloading' && percent != null
              ? percent
              : undefined,
          'aria-label': t(messages[state.phase]),
        }),
      state.error &&
        h('p', {class: 'engine-setup-error', role: 'alert'}, t(state.error)),
      state.error &&
        existing &&
        h(
          'p',
          {class: 'engine-setup-note'},
          t(
            'Check the existing engine path, model and arguments in Preferences → Engines.',
          ),
        ),
      !state.loading &&
        !state.supported &&
        !existing &&
        h(
          'p',
          {class: 'engine-setup-error'},
          t(
            'Automatic setup supports Apple silicon Macs with macOS 15 or later.',
          ),
          h('br'),
          t('You can use an existing engine through Preferences → Engines.'),
        ),
      !existing &&
        h(
          'p',
          {class: 'engine-setup-note'},
          t(
            'The first download is about 380 MB. Keep about 1.5 GB of disk space available. Analysis runs locally on your computer.',
          ),
        ),
      !existing &&
        h(
          'p',
          {class: 'engine-setup-note'},
          t(
            'Downloads try Tsinghua and USTC mirrors, then the official source. Every file is verified before use.',
          ),
        ),
      h(
        'div',
        {class: 'engine-setup-actions'},
        h(
          'button',
          {type: 'button', onClick: () => sabaki.cancelEngineSetup()},
          t(busy ? 'Cancel' : 'Close'),
        ),
        h(
          'button',
          {
            type: 'button',
            class: 'primary',
            disabled: busy || (!state.supported && !state.engine),
            onClick: () => this.prepare(),
          },
          t(
            state.phase === 'error' || state.error
              ? 'Try again'
              : state.phase === 'ready'
                ? sabaki.automaticAnalysisIntent
                  ? 'Analyze game'
                  : 'Ready'
                : sabaki.automaticAnalysisIntent
                  ? 'Prepare and analyze'
                  : 'Prepare analysis',
          ),
        ),
      ),
    )
  }
}
