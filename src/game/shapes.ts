import type { FeatureCollection, Geometry, Position } from 'geojson'
import type { CountryFeatureProps } from '../data/types'

export interface OutlinePath {
  path: string
  viewBox: string
}

export type Ring = [number, number][]

function asLngLat(pos: Position): [number, number] {
  return [pos[0], pos[1]]
}

/** Land rings for a country (no archipelago hulls). Coordinates are [lng, lat]. */
export function countryRings(geojson: FeatureCollection<Geometry, CountryFeatureProps>, iso2: string): Ring[] {
  const rings: Ring[] = []
  for (const f of geojson.features) {
    if (f.properties.iso2 !== iso2 || f.properties.kind === 'hull') continue
    const g = f.geometry
    if (!g) continue
    if (g.type === 'Polygon') {
      for (const ring of g.coordinates) rings.push(ring.map(asLngLat))
    } else if (g.type === 'MultiPolygon') {
      for (const poly of g.coordinates) for (const ring of poly) rings.push(ring.map(asLngLat))
    }
  }
  return rings
}

type RingInfo = {
  ring: Ring
  area: number
  minX: number
  minY: number
  maxX: number
  maxY: number
}

function ringInfo(ring: Ring): RingInfo {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const [x, y] of ring) {
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minY = Math.min(minY, y)
    maxY = Math.max(maxY, y)
  }
  return { ring, area: ringArea(ring), minX, minY, maxX, maxY }
}

function havKm(lng1: number, lat1: number, lng2: number, lat2: number) {
  const r = Math.PI / 180
  const dLat = (lat2 - lat1) * r
  const dLng = (lng2 - lng1) * r
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLng / 2) ** 2
  return 12742 * Math.asin(Math.min(1, Math.sqrt(s)))
}

/** Lower bound: great-circle distance between bounding boxes (0 if they overlap). */
function bboxGapKm(a: RingInfo, b: RingInfo) {
  const dx = a.maxX < b.minX ? b.minX - a.maxX : b.maxX < a.minX ? a.minX - b.maxX : 0
  const dy = a.maxY < b.minY ? b.minY - a.maxY : b.maxY < a.minY ? a.minY - b.maxY : 0
  if (!dx && !dy) return 0
  const lat = (Math.min(a.maxY, b.maxY) + Math.max(a.minY, b.minY)) / 2
  return havKm(0, lat, dx, lat + dy)
}

function minRingDistanceKm(a: RingInfo, b: RingInfo) {
  const gap = bboxGapKm(a, b)
  const stepA = Math.max(1, Math.floor(a.ring.length / 36))
  const stepB = Math.max(1, Math.floor(b.ring.length / 36))
  let min = Infinity
  for (let i = 0; i < a.ring.length; i += stepA) {
    const [x1, y1] = a.ring[i]
    for (let j = 0; j < b.ring.length; j += stepB) {
      const [x2, y2] = b.ring[j]
      const d = havKm(x1, y1, x2, y2)
      if (d < min) min = d
    }
  }
  return Number.isFinite(min) ? min : gap
}

function minDistToKept(ring: RingInfo, kept: RingInfo[]) {
  let min = Infinity
  for (const k of kept) {
    if (bboxGapKm(ring, k) >= min) continue
    const d = minRingDistanceKm(ring, k)
    if (d < min) min = d
  }
  return min
}

/**
 * Rings to draw and score against. Drops distant overseas islands (Canaries, Azores, Hawaii)
 * but keeps nearby iconic ones (Japan's home islands, Sicily, Hong Kong, Hainan, Corsica).
 * `mainland` is true when the prompt should say "mainland Spain" rather than just the name.
 */
export function drawRingsForCountry(
  geojson: FeatureCollection<Geometry, CountryFeatureProps>,
  iso2: string,
): { rings: Ring[]; mainland: boolean } {
  const infos = countryRings(geojson, iso2).map(ringInfo).filter((r) => r.ring.length >= 3 && r.area > 0)
  if (!infos.length) return { rings: [], mainland: false }
  infos.sort((a, b) => b.area - a.area)
  const main = infos[0]
  const total = infos.reduce((s, r) => s + r.area, 0)
  const archipelago = main.area / total < 0.65
  const kept: RingInfo[] = [main]
  const nearKm = 80
  const closeKm = 160
  const closeRatio = 0.002
  const midKm = 250
  const midRatio = 0.01
  const majorKm = 650
  const majorRatio = 0.2
  const archiNearKm = 400
  const archiNearRatio = 0.005
  const archiMajorKm = 1500
  const archiMajorRatio = 0.08

  const shouldKeep = (d: number, ratio: number) => {
    if (d <= nearKm) return true
    if (archipelago && ratio >= archiMajorRatio && d <= archiMajorKm) return true
    if (archipelago && ratio >= archiNearRatio && d <= archiNearKm) return true
    if (ratio >= majorRatio && d <= majorKm) return true
    if (d <= closeKm && ratio >= closeRatio) return true
    if (d <= midKm && ratio >= midRatio) return true
    return false
  }

  let grew = true
  while (grew) {
    grew = false
    for (const ring of infos) {
      if (kept.includes(ring)) continue
      const d = minDistToKept(ring, kept)
      if (shouldKeep(d, ring.area / main.area)) {
        kept.push(ring)
        grew = true
      }
    }
  }

  let droppedFar = false
  let droppedArea = 0
  let keptOffshore = 0
  for (const ring of infos) {
    if (kept.includes(ring)) {
      const d = ring === main ? 0 : minRingDistanceKm(ring, main)
      if (d > nearKm) keptOffshore += ring.area
      continue
    }
    droppedArea += ring.area
    if (minRingDistanceKm(ring, main) > 300) droppedFar = true
  }
  const mainland =
    (droppedFar || droppedArea / total >= 0.005) &&
    keptOffshore / main.area < 0.01 &&
    !kept.some((r) => r !== main && r.area / main.area >= 0.08)

  return { rings: kept.map((r) => r.ring), mainland }
}

function ringArea(ring: Ring) {
  let a = 0
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i]
    const [x2, y2] = ring[(i + 1) % ring.length]
    a += x1 * y2 - x2 * y1
  }
  return Math.abs(a / 2)
}

function distPointSeg(p: [number, number], a: [number, number], b: [number, number]) {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const l2 = dx * dx + dy * dy
  if (!l2) return Math.hypot(p[0] - a[0], p[1] - a[1])
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2))
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))
}

function simplifyRing(ring: Ring, tol: number): Ring {
  if (ring.length <= 8) return ring
  const keep = new Uint8Array(ring.length)
  keep[0] = 1
  keep[ring.length - 1] = 1
  const stack: [number, number][] = [[0, ring.length - 1]]
  while (stack.length) {
    const [i, j] = stack.pop()!
    let max = -1
    let idx = 0
    for (let k = i + 1; k < j; k++) {
      const d = distPointSeg(ring[k], ring[i], ring[j])
      if (d > max) {
        max = d
        idx = k
      }
    }
    if (max > tol) {
      keep[idx] = 1
      stack.push([i, idx], [idx, j])
    }
  }
  return ring.filter((_, i) => keep[i])
}

function pickRings(rings: Ring[], budget = 1800): Ring[] {
  const ranked = rings
    .filter((r) => r.length >= 3)
    .map((r) => ({ r, a: ringArea(r) }))
    .sort((a, b) => b.a - a.a)
  const out: Ring[] = []
  let pts = 0
  for (const { r } of ranked) {
    if (pts > 80 && pts + r.length > budget) continue
    out.push(r)
    pts += r.length
    if (pts >= budget) break
  }
  return out
}

/** Compact SVG path for a country silhouette. North is up. */
export function ringsToOutline(rings: Ring[], opts?: { precise?: boolean; detail?: 'full' }): OutlinePath | null {
  const full = opts?.detail === 'full'
  const precise = !!opts?.precise || full
  const picked = pickRings(rings, full ? 50000 : precise ? 8000 : 1800)
  if (!picked.length) return null
  const simplified = picked.map((r) => {
    if (full) {
      const a = ringArea(r)
      return r.length <= 24 ? r : simplifyRing(r, Math.max(0.00025, Math.sqrt(a) * 0.00035))
    }
    const a = ringArea(r)
    const tol = precise ? Math.max(0.003, Math.sqrt(a) * 0.0025) : Math.max(0.04, Math.sqrt(a) * 0.012)
    return simplifyRing(r, tol)
  })
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const ring of simplified) {
    for (const [x, y] of ring) {
      minX = Math.min(minX, x)
      maxX = Math.max(maxX, x)
      minY = Math.min(minY, y)
      maxY = Math.max(maxY, y)
    }
  }
  const w = Math.max(0.01, maxX - minX)
  const h = Math.max(0.01, maxY - minY)
  const pad = Math.max(w, h) * 0.04
  const dec = full ? 5 : precise ? 4 : 3
  const fmt = (n: number) => n.toFixed(dec)
  const parts: string[] = []
  for (const ring of simplified) {
    if (ring.length < 3) continue
    const cmds = ring.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${fmt(x)} ${fmt(-y)}`)
    parts.push(`${cmds.join('')}Z`)
  }
  if (!parts.length) return null
  return {
    path: parts.join(''),
    viewBox: `${fmt(minX - pad)} ${fmt(-maxY - pad)} ${fmt(w + pad * 2)} ${fmt(h + pad * 2)}`,
  }
}

function boundsOf(points: [number, number][]) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const [x, y] of points) {
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minY = Math.min(minY, y)
    maxY = Math.max(maxY, y)
  }
  if (!Number.isFinite(minX)) return null
  return { minX, minY, maxX, maxY, w: Math.max(1e-6, maxX - minX), h: Math.max(1e-6, maxY - minY) }
}

/** Fit points into a square, preserving aspect ratio (scale + translation only). */
export function fitPoints(points: [number, number][], size: number, pad = 4): [number, number][] {
  const b = boundsOf(points)
  if (!b) return []
  const inner = size - pad * 2
  const scale = inner / Math.max(b.w, b.h)
  const ox = pad + (inner - b.w * scale) / 2
  const oy = pad + (inner - b.h * scale) / 2
  return points.map(([x, y]) => [ox + (x - b.minX) * scale, oy + (y - b.minY) * scale])
}

function fillPolygon(grid: Uint8Array, size: number, pts: [number, number][]) {
  if (pts.length < 3) return
  const minY = Math.max(0, Math.floor(Math.min(...pts.map((p) => p[1]))))
  const maxY = Math.min(size - 1, Math.ceil(Math.max(...pts.map((p) => p[1]))))
  for (let y = minY; y <= maxY; y++) {
    const xs: number[] = []
    for (let i = 0; i < pts.length; i++) {
      const [x1, y1] = pts[i]
      const [x2, y2] = pts[(i + 1) % pts.length]
      if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) {
        xs.push(x1 + ((y - y1) / (y2 - y1)) * (x2 - x1))
      }
    }
    xs.sort((a, b) => a - b)
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const a = Math.max(0, Math.floor(xs[i]))
      const b = Math.min(size - 1, Math.ceil(xs[i + 1]))
      const row = y * size
      for (let x = a; x <= b; x++) grid[row + x] = 1
    }
  }
}

function rasterizeRings(rings: Ring[], size: number): Uint8Array {
  const grid = new Uint8Array(size * size)
  const all = rings.flat()
  if (all.length < 3) return grid
  const b = boundsOf(all)
  if (!b) return grid
  const fitted = rings.map((r) => fitPoints(r, size))
  for (const pts of fitted) fillPolygon(grid, size, pts)
  return grid
}

/** Close each stroke and fill. Coordinates may be in any space. */
function rasterizeStrokes(strokes: [number, number][][], size: number): Uint8Array {
  const rings = strokes.filter((s) => s.length >= 3)
  return rasterizeRings(rings, size)
}

function iou(a: Uint8Array, b: Uint8Array) {
  let inter = 0
  let union = 0
  for (let i = 0; i < a.length; i++) {
    const av = a[i]
    const bv = b[i]
    if (av | bv) union++
    if (av & bv) inter++
  }
  return union ? inter / union : 0
}

const RASTER = 96

/**
 * Scale- and translation-invariant shape score in 0…1 (intersection-over-union of filled
 * silhouettes). Rotation is not normalized — north-up drawings score best.
 */
export function shapeOverlap(strokes: [number, number][][], country: Ring[]): number {
  if (!strokes.some((s) => s.length >= 3) || !country.length) return 0
  return iou(rasterizeStrokes(strokes, RASTER), rasterizeRings(country, RASTER))
}

export function outlineForCountry(
  geojson: FeatureCollection<Geometry, CountryFeatureProps>,
  iso2: string,
  opts?: { precise?: boolean; detail?: 'full' },
): OutlinePath | null {
  return ringsToOutline(countryRings(geojson, iso2), opts)
}

export function outlineForDraw(
  geojson: FeatureCollection<Geometry, CountryFeatureProps>,
  iso2: string,
): { outline: OutlinePath | null; mainland: boolean } {
  const { rings, mainland } = drawRingsForCountry(geojson, iso2)
  return { outline: ringsToOutline(rings, { detail: 'full' }), mainland }
}
