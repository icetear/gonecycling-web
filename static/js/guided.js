// Pure helpers for the guided stage planner ("Next stage"): selecting and
// sorting target candidates around the desired distance. Without network/DOM →
// testable in Node. Distances are straight-line (metres) from the current cursor.

/**
 * Is `distanceMeters` within the distance band around the desired distance?
 * Default: 0.6×…1.4× — so targets „roughly at the desired distance" are
 * accepted (like iOS ringCandidates).
 */
export function withinBand(distanceMeters, desiredMeters, lo = 0.6, hi = 1.4) {
  return distanceMeters >= desiredMeters * lo && distanceMeters <= desiredMeters * hi;
}

/** Removes candidates with the same name (first occurrence wins). */
export function dedupByName(candidates) {
  const seen = new Set();
  const out = [];
  for (const c of candidates || []) {
    const key = String(c && c.name ? c.name : "").trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

/**
 * Sorts/trims the candidates: mandatory stops first, then by proximity to the
 * desired distance (smallest deviation first). Returns at most `limit` entries.
 */
export function rankCandidates(found, desiredMeters, limit = 12) {
  return dedupByName(found)
    .slice()
    .sort((a, b) => {
      if (!!a.mandatory !== !!b.mandatory) return a.mandatory ? -1 : 1;
      return Math.abs(a.distanceMeters - desiredMeters) - Math.abs(b.distanceMeters - desiredMeters);
    })
    .slice(0, limit);
}
