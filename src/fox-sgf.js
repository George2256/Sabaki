// Fox exports komi in hundredths of a point under Japanese/Korean rules,
// or hundredths of a stone under Chinese rules (one stone = two points).
// Sabaki replaces AP[] when saving, so a later local copy may no longer carry
// AP[foxwq]. An absolute komi of 100 or more is invalid for normal Go games
// and rejected by GTP engines, so repair that legacy encoding by rule even when
// the source marker was lost. Reading an already-normalized SGF stays safe.
exports.normalizeRoot = function (data) {
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
