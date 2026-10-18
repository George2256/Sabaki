import {h, Component} from 'preact'
import i18n from '../../i18n.js'
import translations from '../../online-games/strings.js'
import sabaki from '../../modules/sabaki.js'
import Drawer from './Drawer.js'

const t = i18n.context('OnlineGames')
const api = () => window.sabaki.onlineGames
const errorMessage = (error) =>
  Object.hasOwn(translations['zh-Hans'], error.message)
    ? error.message
    : 'Something went wrong. Please try again.'

export default class OnlineGamesDrawer extends Component {
  constructor() {
    super()
    this.state = {
      providers: [],
      provider: '',
      mode: 'nickname',
      keyword: '',
      games: [],
      user: null,
      busy: false,
      downloading: null,
      error: '',
      notice: '',
      searched: false,
      nextCursor: null,
      query: null,
    }
    this.generation = 0
  }

  componentDidUpdate(previous) {
    if (!previous.show && this.props.show) {
      this.input?.focus()
      if (!this.state.providers.length) this.loadProviders()
    } else if (previous.show && !this.props.show) {
      this.generation++
      this.setState({busy: false, downloading: null})
    }
  }

  componentWillUnmount() {
    this.generation++
  }

  async loadProviders() {
    const generation = ++this.generation
    try {
      const response = await api().list()
      if (generation !== this.generation) return
      if (!response.ok) throw new Error(response.error)
      this.setState({
        providers: response.data,
        provider: response.data[0]?.id || '',
        error: '',
      })
    } catch (error) {
      if (generation === this.generation)
        this.setState({
          error: 'Unable to load game servers. Please reopen this panel.',
        })
    }
  }

  async search(event, more = false) {
    event.preventDefault()
    if (this.state.busy || this.state.downloading || !this.state.keyword.trim())
      return
    if (more && (!this.state.nextCursor || !this.state.query)) return
    const generation = ++this.generation
    const query = more
      ? this.state.query
      : {
          provider: this.state.provider,
          keyword: this.state.keyword.trim(),
          mode: this.state.mode,
        }
    this.setState({
      busy: true,
      error: '',
      notice: '',
      ...(!more && {
        games: [],
        user: null,
        searched: false,
        nextCursor: null,
        query: null,
      }),
    })
    try {
      const response = await api().search({
        ...query,
        ...(more && {cursor: this.state.nextCursor}),
      })
      if (generation !== this.generation) return
      if (!response.ok) throw new Error(response.error)
      const games = more
        ? [
            ...new Map(
              [...this.state.games, ...response.data.games].map((game) => [
                game.id,
                game,
              ]),
            ).values(),
          ]
        : response.data.games
      this.setState({
        ...response.data,
        games,
        nextCursor: response.data.nextCursor ?? null,
        query,
        searched: true,
      })
    } catch (error) {
      if (generation === this.generation)
        this.setState({
          error: errorMessage(error),
        })
    } finally {
      if (generation === this.generation) this.setState({busy: false})
    }
  }

  async open(game) {
    if (this.state.downloading || this.state.busy) return
    const generation = ++this.generation
    this.setState({downloading: game.id, error: ''})
    try {
      const response = await api().download({
        provider: this.state.provider,
        id: game.id,
      })
      if (generation !== this.generation || !this.props.show) return
      if (!response.ok) throw new Error(response.error)
      // Use the normal loading path, including the unsaved-changes prompt.
      await sabaki.loadContent(response.data.content, response.data.extension)
    } catch (error) {
      if (generation === this.generation)
        this.setState({
          error: errorMessage(error),
        })
    } finally {
      if (generation === this.generation) this.setState({downloading: null})
    }
  }

  render(
    {show},
    {
      providers,
      provider,
      mode,
      keyword,
      games,
      user,
      busy,
      downloading,
      error,
      notice,
      searched,
      nextCursor,
    },
  ) {
    const disabled = busy || downloading != null
    const modes = providers.find((source) => source.id === provider)?.modes ?? [
      'nickname',
      'id',
    ]
    return h(
      Drawer,
      {type: 'onlinegames', show},
      h('h2', {}, t('Online Games')),
      h(
        'form',
        {onSubmit: (event) => this.search(event), class: 'online-search'},
        h(
          'select',
          {
            value: provider,
            'aria-label': t('Server'),
            disabled,
            onChange: (event) =>
              this.setState({
                provider: event.currentTarget.value,
                mode: 'nickname',
                games: [],
                user: null,
                searched: false,
                error: '',
                notice: '',
                nextCursor: null,
                query: null,
              }),
          },
          providers.map((source) =>
            h('option', {key: source.id, value: source.id}, t(source.name)),
          ),
        ),
        h(
          'select',
          {
            value: mode,
            'aria-label': t('Search by'),
            disabled,
            onChange: (event) =>
              this.setState({
                mode: event.currentTarget.value,
                games: [],
                user: null,
                searched: false,
                error: '',
                notice: '',
                nextCursor: null,
                query: null,
              }),
          },
          modes.map((value) =>
            h(
              'option',
              {value},
              t(
                {
                  nickname: 'Nickname',
                  id: 'Player ID',
                  link: 'Game share link',
                }[value],
              ),
            ),
          ),
        ),
        h('input', {
          ref: (element) => (this.input = element),
          type: 'text',
          value: keyword,
          maxLength: mode === 'link' ? 2000 : 100,
          'aria-label': t(
            mode === 'link' ? 'Game share link' : 'Player ID or nickname',
          ),
          placeholder:
            mode === 'link'
              ? t(
                  provider === 'ogs'
                    ? 'Paste an OGS game link'
                    : 'Paste a Tencent game share link',
                )
              : mode === 'id'
                ? t('Enter player ID')
                : t('Enter exact nickname'),
          disabled,
          onInput: (event) =>
            this.setState({
              keyword: event.currentTarget.value,
              nextCursor: null,
            }),
        }),
        h(
          'button',
          {type: 'submit', disabled: disabled || !provider || !keyword.trim()},
          busy ? t('Searching…') : t('Search'),
        ),
      ),
      h(
        'p',
        {class: 'online-status', role: 'status'},
        user
          ? `${user.name} · ID ${user.id}${notice ? '' : ` · ${games.length} ${t('games')}`}`
          : t(
              mode === 'link'
                ? 'Find a game by its share link.'
                : 'Find recent games by player ID or exact nickname.',
            ),
      ),
      error && h('p', {class: 'online-error', role: 'alert'}, t(error)),
      notice && h('p', {class: 'online-error', role: 'alert'}, t(notice)),
      h(
        'div',
        {class: 'online-results', 'aria-busy': disabled},
        games.length
          ? h(
              'table',
              {},
              h(
                'thead',
                {},
                h(
                  'tr',
                  {},
                  ['Date', 'Black', 'White', 'Result', 'Moves', ''].map(
                    (label) => h('th', {scope: 'col'}, label && t(label)),
                  ),
                ),
              ),
              h(
                'tbody',
                {},
                games.map((game) =>
                  h(
                    'tr',
                    {key: game.id},
                    h('td', {}, game.date || '—'),
                    h('td', {title: game.black}, game.black || '—'),
                    h('td', {title: game.white}, game.white || '—'),
                    h('td', {}, game.result || '—'),
                    h('td', {}, game.moves ?? '—'),
                    h(
                      'td',
                      {},
                      h(
                        'button',
                        {disabled, onClick: () => this.open(game)},
                        downloading === game.id ? t('Downloading…') : t('Open'),
                      ),
                    ),
                  ),
                ),
              ),
            )
          : h(
              'p',
              {class: 'online-empty'},
              busy
                ? t('Searching…')
                : notice
                  ? t('Game records could not be loaded.')
                  : searched
                    ? t('No recent games found for this player.')
                    : t('Game records will appear here.'),
            ),
        nextCursor &&
          h(
            'div',
            {class: 'online-pagination'},
            h(
              'button',
              {disabled, onClick: (event) => this.search(event, true)},
              busy ? t('Loading…') : t('Load more'),
            ),
          ),
      ),
      h(
        'div',
        {class: 'online-footer'},
        h(
          'span',
          {},
          t(
            'Recent games available from the server. Open a game, then save it as SGF.',
          ),
        ),
        h('button', {onClick: () => sabaki.closeDrawer()}, t('Close')),
      ),
    )
  }
}
