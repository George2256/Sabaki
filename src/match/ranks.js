// Player ranks and the matching KataGo human SL profiles. Ranks are keys such
// as '15k', '3d' or 'pro'; profiles are humanSLProfile values ('rank_3d').

const ladder = [
  ...Array.from({length: 20}, (_, i) => `${20 - i}k`),
  ...Array.from({length: 9}, (_, i) => `${i + 1}d`),
  'pro',
]

// Modern professionals, who learned from AI, are the strongest and most
// AI-like human baseline the human model offers.
const proProfile = 'proyear_2023'
// Without a known rank only the strongest human baselines are used: the check
// then asks whether play is more AI-like than strong humans in general.
const unknownBand = ['rank_9d', proProfile]

const numerals = {
  初: 1,
  一: 1,
  二: 2,
  两: 2,
  兩: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
}

function number(text) {
  if (/^\d+$/.test(text)) return Number(text)
  if (text.includes('十')) {
    const [tens, ones] = text.split('十')
    return (tens ? numerals[tens] : 1) * 10 + (ones ? numerals[ones] : 0)
  }
  return numerals[text]
}

// Accepts SGF BR/WR values from Chinese, Korean-style and western servers:
// '2级', '3段', '初段', '十五级', '5k', '1d', '9p', 'P9段', '职业九段'.
function parseRank(value) {
  const text = String(value ?? '').trim()
  if (!text) return null
  if (/职业|職業|\bpro\b/i.test(text) || /^p\s*\d/i.test(text)) return 'pro'
  if (/^\d+\s*p$/i.test(text)) return 'pro'
  const match = text.match(
    /(\d+|[初一二两兩三四五六七八九十]+)\s*(级|級|kyu|k|段|dan|d)(?![a-z])/i,
  )
  if (!match) return null
  const n = number(match[1])
  if (!Number.isFinite(n) || n < 1) return null
  return /级|級|k/i.test(match[2])
    ? `${Math.min(n, 20)}k`
    : `${Math.min(n, 9)}d`
}

function profileFor(rank) {
  return rank === 'pro' ? proProfile : `rank_${rank}`
}

// The baseline band: the stated rank and up to `margin` steps stronger. The
// test compares against whichever rank in the band best explains the moves, so
// an underrated or quickly improving player is not judged by a weaker rank.
function bandFor(rank, margin = 3) {
  const index = ladder.indexOf(rank)
  if (index < 0) return unknownBand.slice()
  const steps = Math.max(0, Math.min(9, Math.floor(margin) || 0))
  return ladder.slice(index, index + steps + 1).map(profileFor)
}

function rankLabel(rank, language = 'en') {
  if (!rank) return ''
  const chinese = String(language).startsWith('zh')
  if (rank === 'pro') return chinese ? '职业' : 'pro'
  const n = rank.slice(0, -1)
  if (!chinese) return rank
  return `${n}${rank.endsWith('k') ? (language === 'zh-Hant' ? '級' : '级') : '段'}`
}

function profileLabel(profile, language = 'en') {
  if (profile === proProfile) return rankLabel('pro', language)
  const rank = String(profile).replace(/^rank_/, '')
  return ladder.includes(rank) ? rankLabel(rank, language) : profile
}

module.exports = {
  ladder,
  proProfile,
  unknownBand,
  parseRank,
  profileFor,
  bandFor,
  rankLabel,
  profileLabel,
}
