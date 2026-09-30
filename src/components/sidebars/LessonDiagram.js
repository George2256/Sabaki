import {h, Component} from 'preact'
import {BoundedGoban} from '@sabaki/shudan'
import {replay} from '../../teaching/position.js'
import {t as text} from '../../teaching/strings.js'

export default class LessonDiagram extends Component {
  constructor(props) {
    super(props)
    this.state = {step: props.diagram.moves.length, width: 300}
  }
  componentDidMount() {
    this.observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width > 0)
        this.setState({width: entry.contentRect.width})
    })
    this.observer.observe(this.element)
  }
  componentWillUnmount() {
    this.observer.disconnect()
  }
  revealStep(step) {
    this.setState({step})
    this.element.closest('.lesson-diagram').scrollIntoView({block: 'nearest'})
  }
  render({position, index, diagram, language}, {step, width}) {
    const t = (key, params) => text(language, key, params)
    const prefix = position.moves.slice(0, index)
    const board = replay(position, [...prefix, ...diagram.moves.slice(0, step)])
    const markerMap = board.signMap.map((row) => row.map(() => null))
    diagram.moves.slice(0, step).forEach(([color, coord], i) => {
      if (coord === 'pass') return
      const [x, y] = board.parseVertex(coord)
      if (board.get([x, y]) === (color === 'B' ? 1 : -1))
        markerMap[y][x] = {type: 'label', label: String(i + 1)}
    })
    return h(
      'section',
      {
        class: 'lesson-diagram',
        'data-kind': diagram.kind,
        'data-diagram-id': diagram.id,
        'aria-label': t(diagram.kind),
      },
      h('h4', {}, t(diagram.kind)),
      h(
        'div',
        {
          class: 'lesson-board',
          ref: (el) => {
            this.element = el
          },
        },
        h(BoundedGoban, {
          maxWidth: Math.max(100, width),
          maxHeight: Math.max(100, width),
          signMap: board.signMap,
          markerMap,
          showCoordinates: true,
          fuzzyStonePlacement: false,
          animateStonePlacement: false,
          coordX: (x) => 'ABCDEFGHJKLMNOPQRST'[x],
          coordY: (y) => position.boardYSize - y,
        }),
      ),
      h(
        'div',
        {class: 'lesson-diagram-controls'},
        h(
          'button',
          {
            type: 'button',
            disabled: step === 0,
            'aria-label': t('previous'),
            onClick: () => this.setState({step: step - 1}),
          },
          '‹',
        ),
        h('input', {
          type: 'range',
          min: 0,
          max: diagram.moves.length,
          value: step,
          'aria-label': t(diagram.kind),
          onInput: (evt) =>
            this.setState({step: Number(evt.currentTarget.value)}),
        }),
        h('span', {}, `${step}/${diagram.moves.length}`),
        h(
          'button',
          {
            type: 'button',
            disabled: step === diagram.moves.length,
            'aria-label': t('next'),
            onClick: () => this.setState({step: step + 1}),
          },
          '›',
        ),
      ),
      h(
        'div',
        {class: 'lesson-moves'},
        diagram.moves.map(([color, coord], i) =>
          h(
            'button',
            {
              type: 'button',
              class: i + 1 === step ? 'current' : '',
              onClick: () => this.setState({step: i + 1}),
            },
            `${i + 1}. ${color === 'B' ? '●' : '○'} ${coord === 'pass' ? t('pass') : coord}`,
          ),
        ),
      ),
      h(
        'p',
        {class: 'lesson-note'},
        t(diagram.verified ? 'verified' : 'actualNote'),
      ),
    )
  }
}
