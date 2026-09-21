// Fox exports komi in hundredths of a point under Japanese/Korean rules,
// or hundredths of a stone under Chinese rules (one stone = two points).
// Restrict conversion to marked Fox records and encoded magnitudes so reading
// an already-normalized SGF again is safe and ordinary SGFs stay unchanged.
exports.normalizeRoot = function (data) {
  if (!data.AP?.some((value) => /^foxwq(?::|$)/i.test(value))) return
  const raw = data.KM?.[0]
  const komi = Number(raw)
  if (!Number.isFinite(komi) || Math.abs(komi) < 100) return
  const rules = (data.RU?.[0] || '').trim().toLowerCase()
  const divisor = ['chinese', 'cn'].includes(rules)
    ? 50
    : ['japanese', 'jp', 'korean', 'kr'].includes(rules)
      ? 100
      : null
  if (divisor != null) data.KM = [String(komi / divisor)]
}
