const {t} = require('./strings')
const {salience} = require('./facts')

function localExplanation(lesson, language) {
  const text = (key, values) => t(language, key, values)
  const player = (color) => text(color === 'B' ? 'black' : 'white')
  const paragraph = (key, values, facts) => ({
    text: text(key, values),
    factIds: facts.map((f) => f.id),
    refs: facts.map((f) => ({diagramId: f.diagramId, step: f.step})),
  })
  const actual = lesson.facts.find(
    (f) => f.diagramId.endsWith('-actual') && f.step === 1,
  )
  const recommended = lesson.facts.find(
    (f) => f.diagramId.endsWith('-recommended') && f.step === 1,
  )
  const response = lesson.facts.filter((f) =>
    /-(punishment|alternative)-step-/.test(f.id),
  )
  const best = lesson.facts.filter((f) => /-recommended-step-/.test(f.id))
  const compared = lesson.kind === 'good' ? response[0] : actual
  const gain = (recommended.groupChanges || []).find(
    (g) =>
      g.color === lesson.color &&
      g.before <= 3 &&
      g.after > g.before &&
      !compared.groupChanges?.some(
        (a) => a.anchor === g.anchor && a.after >= g.after,
      ),
  )
  // A remote low-liberty stone may be an intentional sacrifice. Only introduce
  // it when the compared lines actually address it; never label all atari urgent.
  const danger = lesson.context.groups.filter(
    (g) =>
      g.color === lesson.color &&
      g.liberties.length === 1 &&
      [actual, recommended].some((f) =>
        f.groupChanges?.some((a) => a.anchor === g.anchor),
      ),
  )
  const paragraphs = []
  if (danger.length)
    paragraphs.push(
      paragraph(
        'coachUrgent',
        {
          player: player(lesson.color),
          group: danger[0].anchor,
          liberty: danger[0].liberties[0],
        },
        [
          lesson.facts.find(
            (f) => f.diagramId === actual.diagramId && f.step === 0,
          ) || actual,
        ],
      ),
    )
  if (gain)
    paragraphs.push(
      paragraph(
        'coachLibertyChoice',
        {
          best: recommended.move,
          target: gain.anchor,
          before: gain.before,
          after: gain.after,
          comparison: text(
            lesson.diagrams.find((d) => d.id === compared.diagramId).kind,
          ),
          actual: compared.move,
          actualAfter:
            compared.groupChanges?.find((a) => a.anchor === gain.anchor)
              ?.after ?? gain.before,
        },
        [recommended, compared],
      ),
    )
  else
    paragraphs.push(
      paragraph(
        lesson.kind === 'good' ? 'coachGoodChoice' : 'coachCompare',
        {
          actual: compared.move === 'pass' ? text('pass') : compared.move,
          best: recommended.move === 'pass' ? text('pass') : recommended.move,
          actualRegion: text(`region-${compared.region}`),
          bestRegion: text(`region-${recommended.region}`),
        },
        [compared, recommended],
      ),
    )
  const describe = (fact) => {
    const values = {
      diagram: text(lesson.diagrams.find((d) => d.id === fact.diagramId).kind),
      step: fact.step,
      player: player(fact.color),
      move: fact.move === 'pass' ? text('pass') : fact.move,
    }
    if (fact.captured.length)
      return paragraph(
        'coachCapture',
        {
          ...values,
          target: fact.captured[0].stones[0],
          opponent: player(fact.captured[0].color),
          count: fact.captured[0].stones.length,
        },
        [fact],
      )
    if (fact.escaped.length)
      return paragraph(
        'coachEscape',
        {
          ...values,
          target: fact.escaped[0].anchor,
          count: fact.escaped[0].after,
        },
        [fact],
      )
    if (fact.connected.length)
      return paragraph(
        'coachConnect',
        {...values, first: fact.connected[0], second: fact.connected[1]},
        [fact],
      )
    const atari = fact.atari.find((g) => g.color !== fact.color)
    if (atari)
      return paragraph(
        'coachAtari',
        {
          ...values,
          target: atari.anchor,
          opponent: player(atari.color),
          liberty: atari.liberty,
        },
        [fact],
      )
    const pressure = fact.groupChanges?.find(
      (g) =>
        g.color !== fact.color &&
        g.before <= 4 &&
        g.after < g.before &&
        g.after > 1,
    )
    if (pressure)
      return paragraph(
        'coachPressure',
        {
          ...values,
          target: pressure.anchor,
          opponent: player(pressure.color),
          before: pressure.before,
          after: pressure.after,
        },
        [fact],
      )
    return null
  }
  // Start with the consequence in the played line, then contrast the solution.
  // Choose an early meaningful event, rather than mechanically narrating every move.
  const highlights = [response, best].map((line, index) => {
    const distance = (a, b) =>
      a === 'pass' || b === 'pass'
        ? Infinity
        : Math.abs(
            'ABCDEFGHJKLMNOPQRST'.indexOf(a[0]) -
              'ABCDEFGHJKLMNOPQRST'.indexOf(b[0]),
          ) + Math.abs(Number(a.slice(1)) - Number(b.slice(1)))
    const candidates = line.filter(
      (f) =>
        salience(f) > 0 &&
        Math.min(
          distance(f.move, actual.move),
          distance(f.move, recommended.move),
        ) <= 4 &&
        (index === 0 ? f.color !== lesson.color : f.color === lesson.color),
    )
    const related =
      gain &&
      candidates.find(
        (f) =>
          f.atari.some((g) => g.anchor === gain.anchor) ||
          f.captured.some((g) => g.stones.includes(gain.anchor)),
      )
    return (
      related ||
      candidates.sort((a, b) => a.step - b.step || salience(b) - salience(a))[0]
    )
  })
  for (const fact of highlights.filter(Boolean)) {
    const value = describe(fact)
    if (value) paragraphs.push(value)
  }
  if (!highlights.some(Boolean)) {
    const responseFact =
      response.find((f) => f.color !== lesson.color) || response[0]
    if (responseFact)
      paragraphs.push(
        paragraph(
          'coachRead',
          {
            player: player(responseFact.color),
            move:
              responseFact.move === 'pass' ? text('pass') : responseFact.move,
            diagram: text(
              lesson.diagrams.find((d) => d.id === responseFact.diagramId).kind,
            ),
            step: responseFact.step,
          },
          [responseFact],
        ),
      )
  }
  const tactic = highlights.find(Boolean)
  const key =
    danger.length || gain || tactic?.escaped.length
      ? 'habit-liberties'
      : tactic?.connected.length
        ? 'habit-connect'
        : tactic?.captured.length || tactic?.atari.length
          ? 'habit-response'
          : 'habit-compare'
  const refs = tactic ? [tactic] : [actual, recommended]
  paragraphs.push(paragraph(`${key}-${lesson.learner.tier}`, {}, refs))
  return paragraphs
}
module.exports = {localExplanation}
