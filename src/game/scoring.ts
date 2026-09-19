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

export function formatKm(km: number): string {
  return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km).toLocaleString('en-US')} km`
}
