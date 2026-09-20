export const MAX_SCORE = 1000
/** Pins within this distance of the target earn full marks. */
export const PIN_FULL_MARKS_KM = 25
/** Distance scale for the exponential fall-off past the full-marks radius. */
const PIN_DECAY_KM = 1200

const R_KM = 6371
const rad = (d: number) => (d * Math.PI) / 180

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = rad(lat2 - lat1)
  const dLng = rad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R_KM * Math.asin(Math.sqrt(a))
}

/** Correct click: 500 base + up to 500 for speed. Wrong: 0. */
export function scoreClick(correct: boolean, msRemaining: number, timeLimitMs: number): number {
  if (!correct) return 0
  const frac = Math.max(0, Math.min(1, msRemaining / timeLimitMs))
  return Math.round(MAX_SCORE / 2 + (MAX_SCORE / 2) * frac)
}

/** 1000 inside 25 km, then exp decay: ~435 at 1,000 km, ~190 at 2,000 km, ~15 at 5,000 km. */
export function scorePin(distanceKm: number): number {
  const d = Math.max(0, distanceKm - PIN_FULL_MARKS_KM)
  return Math.round(MAX_SCORE * Math.exp(-d / PIN_DECAY_KM))
}

/** Points per country delivered in Bid and Guess. */
export const BID_POINTS_PER_COUNTRY = 150
/** Extra for the highest bid that was actually fulfilled (multiplayer only). */
export const BID_TOP_BONUS = 200
/** Penalty for bidding more countries than exist in the category. */
export const OVERBID_PENALTY = -300

/**
 * Bid and Guess. Fulfil your bid: bid × 150 (+50 × bid over 3 as a risk bonus). Fall short:
 * lose 100 per missing country, down to −300. Overbid the whole category: flat −300.
 */
export function scoreBid(bid: number, hits: number, overbid: boolean): number {
  if (overbid) return OVERBID_PENALTY
  if (bid <= 0) return 0
  if (hits >= bid) return bid * BID_POINTS_PER_COUNTRY + Math.max(0, bid - 3) * 50
  return Math.max(OVERBID_PENALTY, -(bid - hits) * 100)
}

/** Solo Bid and Guess: no auction — 150 per correct country, −100 per miss. Can go negative. */
export const BID_RUSH_MISS = 100

export function scoreBidRush(hits: number, misses: number): number {
  return hits * BID_POINTS_PER_COUNTRY - misses * BID_RUSH_MISS
}

/** Guessing Streak: each rank claimed is worth an equal slice of 1000, plus 200 for closing the list. */
export function scoreStreakPick(listLength: number): number {
  return Math.round(MAX_SCORE / listLength)
}
export const STREAK_FINISH_BONUS = 200

export function formatKm(km: number): string {
  return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km).toLocaleString('en-US')} km`
}

/**
 * Pin-circle mode: 0 if the target is outside the circle. Inside, smaller circles score more.
 * Full marks around a 40 km radius, then exponential fall-off.
 */
export function scorePinCircle(radiusKm: number, distanceKm: number): number {
  if (distanceKm > radiusKm) return 0
  const r = Math.max(1, radiusKm)
  return Math.round(MAX_SCORE * Math.exp(-Math.max(0, r - 40) / 350))
}

/** Draw the country: IoU of filled silhouettes, 0…1000. */
export function scoreDraw(overlap: number): number {
  return Math.round(MAX_SCORE * Math.max(0, Math.min(1, overlap)))
}
