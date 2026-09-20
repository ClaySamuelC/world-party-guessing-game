import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useEffect, useLayoutEffect, useRef } from 'react'
import type { FeatureCollection, Geometry } from 'geojson'
import type { CountryFeatureProps } from '../data/types'
import './map.css'

/** 'valid' = part of the answer set but not claimed by you (dimmer green). 'region' = in-scope search area. */
export type CountryRole = 'selected' | 'correct' | 'wrong' | 'valid' | 'region' | 'eliminated'

export interface MapPin {
  id: string
  lat: number
  lng: number
  label: string
  kind: 'mine' | 'target' | 'other'
  color?: string
}

export interface WorldMapProps {
  geojson: FeatureCollection<Geometry, CountryFeatureProps>
  lakes?: FeatureCollection<Geometry>
  states?: FeatureCollection<Geometry>
  /** 'country' = polygons clickable; 'pin' = click a point; 'circle' = hold-drag a radius; 'none' = read-only. */
  interaction: 'country' | 'pin' | 'circle' | 'none'
  roles?: Record<string, CountryRole>
  /**
   * Change this when the round / screen changes. Clears hover and any role paint that
   * would otherwise stick on the canvas after a pin→click transition (Leaflet canvas
   * keeps the last setStyle until we explicitly rewrite it).
   */
  highlightKey?: string | number
  pins?: MapPin[]
  /** Straight line from my pin to the target after a reveal. */
  lines?: { from: [number, number]; to: [number, number]; color?: string }[]
  /** Change the value to fly the map to a bbox [w, s, e, n] or a saved view. */
  flyTo?: {
    nonce: number
    bbox?: [number, number, number, number]
    center?: [number, number]
    zoom?: number
    save?: boolean
    restore?: boolean
    instant?: boolean
  } | null
  onCountryClick?: (iso2: string) => void
  onMapClick?: (lat: number, lng: number) => void
  onCircle?: (lat: number, lng: number, radiusKm: number) => void
  circles?: { lat: number; lng: number; radiusKm: number; color?: string }[]
  onHover?: (iso2: string | null) => void
  onUserMove?: () => void
  onViewChange?: (view: { center: [number, number]; zoom: number }) => void
}

const BASE_STYLE: L.PathOptions = { color: '#1e293b', weight: 0.7, fillColor: '#94a3b8', fillOpacity: 1 }
const NON_PLAYABLE_STYLE: L.PathOptions = { ...BASE_STYLE, fillColor: '#64748b' }
const ISLAND_STYLE: L.PathOptions = { color: '#e2e8f0', weight: 1.7, fillColor: '#94a3b8', fillOpacity: 1 }
const TINY_STYLE: L.PathOptions = { color: '#f8fafc', weight: 2.3, fillColor: '#a5b4c8', fillOpacity: 1 }
const HULL_LINE = { dashArray: '4 6', lineCap: 'round' as const, lineJoin: 'round' as const }
/** Always-on grouping ring for archipelagos — quiet enough to ignore, clear enough to aim at. */
const HULL_STYLE: L.PathOptions = { color: '#7b93b0', weight: 1.15, opacity: 0.3, fillColor: '#94a3b8', fillOpacity: 0.03, stroke: true, ...HULL_LINE }
const HULL_HOVER_STYLE: L.PathOptions = { color: '#cbd5e1', weight: 1.35, opacity: 0.5, fillColor: '#e2e8f0', fillOpacity: 0.07, stroke: true, ...HULL_LINE }
const ROLE_STYLE: Record<CountryRole, L.PathOptions> = {
  selected: { fillColor: '#fbbf24', color: '#78350f', weight: 1.8 },
  correct: { fillColor: '#4ade80', color: '#14532d', weight: 1.8 },
  wrong: { fillColor: '#f87171', color: '#7f1d1d', weight: 1.8 },
  valid: { fillColor: '#a7f3d0', color: '#065f46', weight: 1.2 },
  region: { fillColor: '#7dd3fc', color: '#0c4a6e', weight: 1.35 },
  eliminated: { fillColor: '#c084fc', color: '#581c87', weight: 1.6 },
}

const MIN_ZOOM_FLOOR = 1.8
const MAX_ZOOM = 9
const START_CENTER: L.LatLngExpression = [20, 12]
const START_ZOOM = 2.85
const MIN_LAT = -56
const MAX_LAT = 78
const PAN_KEYS = new Set(['arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'a', 'd', 'w', 's'])
/** Zoom levels per wheel pixel (a 100px notch ≈ 0.45 levels). */
const WHEEL_ZOOM_PER_PX = 0.0045
/** Largest zoom step a single wheel event may request (trackpads can report huge deltas). */
const WHEEL_MAX_STEP = 1
/** Zoom step for the +/− buttons and double-click. */
const BUTTON_ZOOM_STEP = 1
/** Time constant of the exponential approach toward the target zoom (seconds). */
const ZOOM_TAU = 0.11
/**
 * While a zoom is in flight the canvases are only CSS-scaled from their last raster. Beyond this
 * many levels away the bitmap is visibly soft, so redraw mid-flight instead of waiting to settle.
 */
const REDRAW_EVERY_LEVELS = 1
/**
 * How far past the viewport each canvas is rasterised (fraction of the viewport per side). Area
 * grows as (1 + 2p)²: 0.75 was 6.25 viewports, which on a HiDPI screen (Leaflet doubles the
 * backing store there) meant three ~100MB canvases the GPU would not composite; every zoom frame
 * went through software. 0.3 keeps them small enough to stay on the GPU; pans repaint before the
 * edge of the raster shows.
 */
const CANVAS_PADDING = 0.3
/** Pan distance (fraction of the viewport) after which the canvases are repainted during a pan. */
const REDRAW_EVERY_PAN = CANVAS_PADDING * 0.7
/**
 * Leaflet rasterises canvases at 2× on any screen with devicePixelRatio > 1, including Windows
 * laptops at 125%. Only pay for that (4× the pixels) where the display can actually show it.
 */
const RETINA_MIN_DPR = 1.5
/** How long the old (CSS-scaled) canvas stays on top after a settle, fading off the new raster. */
const SETTLE_FADE_MS = 120
/**
 * Start the offscreen settle this many zoom levels before the animation arrives, so the new
 * bitmap is already under the ghost by the time motion stops.
 */
const SETTLE_PREFETCH_LEVELS = 0.14

/**
 * Leaflet paints by resizing the live canvas (which clears it) then stroking every path. The
 * browser only composites after that JS yields, so the user never sees a blank frame — they see
 * the previous CSS-scaled bitmap snap to a newly-stroked one. A ghost copy of the old bitmap
 * stays on top through the paint; on a final settle it fades out, on a mid-flight redraw it is
 * dropped the same frame so zoom can keep going.
 */
const canvasSwap = { fade: false }

type CanvasRenderer = L.Canvas & {
  _container: HTMLCanvasElement
  _bounds?: L.Bounds
  _map: L.Map
  _wpGhost?: HTMLCanvasElement
  _wpGhostTimer?: number
  _update: () => void
}

function prefersReducedMotion() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
}

const liveGhosts = new Set<CanvasRenderer>()

function dropCanvasGhost(r: CanvasRenderer) {
  if (r._wpGhostTimer != null) {
    clearTimeout(r._wpGhostTimer)
    r._wpGhostTimer = undefined
  }
  r._wpGhost?.remove()
  r._wpGhost = undefined
  liveGhosts.delete(r)
}

function dropAllCanvasGhosts() {
  for (const r of [...liveGhosts]) dropCanvasGhost(r)
}

function installCanvasGhostSwap() {
  const proto = L.Canvas.prototype as unknown as CanvasRenderer & { _wpSwap?: boolean }
  if (proto._wpSwap) return
  proto._wpSwap = true
  const origUpdate = proto._update
  proto._update = function (this: CanvasRenderer) {
    const map = this._map as (L.Map & { _animatingZoom?: boolean }) | undefined
    if (map?._animatingZoom && this._bounds) return
    const el = this._container
    dropCanvasGhost(this)
    let ghost: HTMLCanvasElement | undefined
    if (el?.parentNode && el.width > 0 && el.height > 0) {
      ghost = document.createElement('canvas')
      ghost.className = `${el.className} wp-canvas-ghost`
      ghost.width = el.width
      ghost.height = el.height
      ghost.getContext('2d')!.drawImage(el, 0, 0)
      ghost.style.cssText = el.style.cssText
      ghost.style.pointerEvents = 'none'
      el.parentNode.appendChild(ghost)
      this._wpGhost = ghost
      liveGhosts.add(this)
    }
    origUpdate.call(this)
    if (!ghost) return
    const fade = canvasSwap.fade && !prefersReducedMotion() ? SETTLE_FADE_MS : 0
    if (fade <= 0) {
      dropCanvasGhost(this)
      return
    }
    ghost.style.opacity = '1'
    ghost.style.transition = `opacity ${fade}ms ease-out`
    // Two frames: first paint of the ghost (covering the new raster), then fade it off.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (this._wpGhost !== ghost) return
        ghost.style.opacity = '0'
      })
    })
    this._wpGhostTimer = window.setTimeout(() => dropCanvasGhost(this), fade + 200)
  }
}

/**
 * Leaflet internals that its own flyTo / pinch-zoom use to step a view without a full reset.
 * Driving zoom through these keeps every layer's own transform logic in charge (canvases are
 * scaled from their last raster, markers are re-positioned but never scaled) and keeps
 * `containerPointToLatLng` correct on every frame, which a CSS scale of the whole pane did not.
 */
type MapInternals = L.Map & {
  _move: (center: L.LatLng, zoom: number) => L.Map
  _moveStart: (zoomChanged: boolean, noMoveStart: boolean) => L.Map
  _moveEnd: (zoomChanged: boolean) => L.Map
  _stop: () => L.Map
  _limitCenter: (center: L.LatLng, zoom: number, bounds?: L.LatLngBoundsExpression) => L.LatLng
  _rawPanBy: (p: L.Point) => void
}

function styleFor(props: CountryFeatureProps, role: CountryRole | undefined, hovered: boolean): L.PathOptions {
  if (props.kind === 'hull') {
    if (role) {
      const r = ROLE_STYLE[role]
      return { color: r.color, weight: 1.3, opacity: 0.48, fillColor: r.fillColor, fillOpacity: 0.07, stroke: true, ...HULL_LINE }
    }
    return hovered ? HULL_HOVER_STYLE : HULL_STYLE
  }
  const base = !props.playable ? NON_PLAYABLE_STYLE : props.tiny ? TINY_STYLE : props.island ? ISLAND_STYLE : BASE_STYLE
  const withRole = role ? { ...base, ...ROLE_STYLE[role] } : base
  return hovered && props.playable && (!role || role === 'region' || role === 'eliminated')
    ? { ...withRole, fillColor: '#e2e8f0', color: '#fbbf24', weight: Math.max(withRole.weight ?? 1, 2.1) }
    : withRole
}

function wrapLng(lng: number) {
  return ((((lng + 180) % 360) + 360) % 360) - 180
}

function clampLat(lat: number) {
  return Math.min(MAX_LAT, Math.max(MIN_LAT, lat))
}

/** Longitude of `to` that is closest to `from` (short path across the dateline). */
function nearestLng(from: number, to: number) {
  let best = to
  let bestD = Math.abs(to - from)
  for (const shift of [-360, 360]) {
    const n = to + shift
    const d = Math.abs(n - from)
    if (d < bestD) {
      bestD = d
      best = n
    }
  }
  return best
}

const WORLD_COPIES = [-360, 0, 360] as const

function shiftGeometry(geom: Geometry, dLng: number): Geometry {
  const shift = (c: number[]): number[] => [c[0] + dLng, c[1]]
  const ring = (r: number[][]) => r.map(shift)
  if (geom.type === 'Polygon') return { type: 'Polygon', coordinates: geom.coordinates.map(ring) }
  if (geom.type === 'MultiPolygon') return { type: 'MultiPolygon', coordinates: geom.coordinates.map((p) => p.map(ring)) }
  if (geom.type === 'LineString') return { type: 'LineString', coordinates: geom.coordinates.map(shift) }
  if (geom.type === 'MultiLineString') return { type: 'MultiLineString', coordinates: geom.coordinates.map(ring) }
  return geom
}

const worldCopyCache = new WeakMap<FeatureCollection<Geometry>, FeatureCollection<Geometry>>()

/** Three copies of the world so a view that straddles ±180 still has land on both edges. */
function withWorldCopies<P>(fc: FeatureCollection<Geometry, P>): FeatureCollection<Geometry, P> {
  const cached = worldCopyCache.get(fc as FeatureCollection<Geometry>)
  if (cached) return cached as FeatureCollection<Geometry, P>
  const features: FeatureCollection<Geometry, P>['features'] = []
  for (const f of fc.features) {
    features.push(f)
    features.push({ ...f, geometry: shiftGeometry(f.geometry, -360) })
    features.push({ ...f, geometry: shiftGeometry(f.geometry, 360) })
  }
  const out = { type: 'FeatureCollection' as const, features }
  worldCopyCache.set(fc as FeatureCollection<Geometry>, out as FeatureCollection<Geometry>)
  return out
}

/**
 * If a bbox was built with min/max longitude it can span the long way around
 * (Japan ∪ Alaska ≈ 300°). Prefer the short arc, then slide it next to `nearLng`.
 */
function shortPathBbox(bbox: [number, number, number, number], nearLng: number): [number, number, number, number] {
  let [w, s, e, n] = bbox
  const width = e - w
  if (width > 180) {
    const short = 360 - width
    if (short > 0 && short < width) {
      const nw = e
      const ne = w + 360
      w = nw
      e = ne
    }
  }
  const mid = (w + e) / 2
  const target = nearestLng(nearLng, mid)
  const shift = target - mid
  return [w + shift, s, e + shift, n]
}

type FastPath = L.Polyline & {
  _map?: L.Map
  _latlngs: unknown
  _rings: L.Point[][]
  _parts: L.Point[][]
  _rawPxBounds?: L.Bounds
  _pxBounds?: L.Bounds
  _renderer?: { _bounds?: L.Bounds }
  _updateBounds: () => void
  _clipPoints: () => void
  _project: () => void
  /** Web-Mercator coordinates at zoom 0, flattened [x0, y0, x1, y1, …], plus ring start offsets. */
  _wp?: {
    unit: Float64Array
    offsets: number[]
    box: [number, number, number, number]
    /** Per integer zoom: indices into `unit` that survive a 1px Douglas-Peucker pass at that zoom. */
    lod: Map<number, { idx: Uint32Array; offsets: number[] }>
  }
  /** `_rings` have not been produced for the current zoom (the layer was off screen). */
  _wpDirty?: boolean
}

function flattenRings(latlngs: unknown, out: L.LatLng[][]) {
  if (!Array.isArray(latlngs) || latlngs.length === 0) return
  if (latlngs[0] instanceof L.LatLng) out.push(latlngs as L.LatLng[])
  else for (const inner of latlngs) flattenRings(inner, out)
}

function sqSegDist(unit: Float64Array, p: number, a: number, b: number) {
  let x = unit[a * 2]
  let y = unit[a * 2 + 1]
  let dx = unit[b * 2] - x
  let dy = unit[b * 2 + 1] - y
  const px = unit[p * 2]
  const py = unit[p * 2 + 1]
  if (dx !== 0 || dy !== 0) {
    const t = ((px - x) * dx + (py - y) * dy) / (dx * dx + dy * dy)
    if (t > 1) {
      x += dx
      y += dy
    } else if (t > 0) {
      x += dx * t
      y += dy * t
    }
  }
  dx = px - x
  dy = py - y
  return dx * dx + dy * dy
}

/**
 * Radial-distance pass followed by Douglas-Peucker on one ring `[start, end)` of `unit`, keeping
 * indices. Same algorithm Leaflet runs on every redraw (`LineUtil.simplify`), done once per zoom
 * level on the cached coordinates instead.
 */
function simplifyRing(unit: Float64Array, start: number, end: number, sqTol: number, out: number[]) {
  const n = end - start
  if (n <= 2) {
    for (let i = start; i < end; i++) out.push(i)
    return
  }
  // Radial distance: drop points closer than the tolerance to the last kept point.
  const reduced: number[] = [start]
  let prev = start
  for (let i = start + 1; i < end - 1; i++) {
    const dx = unit[i * 2] - unit[prev * 2]
    const dy = unit[i * 2 + 1] - unit[prev * 2 + 1]
    if (dx * dx + dy * dy > sqTol) {
      reduced.push(i)
      prev = i
    }
  }
  reduced.push(end - 1)
  const m = reduced.length
  const keep = new Uint8Array(m)
  keep[0] = 1
  keep[m - 1] = 1
  const stack: number[] = [0, m - 1]
  while (stack.length) {
    const last = stack.pop()!
    const first = stack.pop()!
    let maxSq = 0
    let index = -1
    for (let i = first + 1; i < last; i++) {
      const d = sqSegDist(unit, reduced[i], reduced[first], reduced[last])
      if (d > maxSq) {
        index = i
        maxSq = d
      }
    }
    if (maxSq > sqTol) {
      keep[index] = 1
      stack.push(first, index, index, last)
    }
  }
  for (let i = 0; i < m; i++) if (keep[i]) out.push(reduced[i])
}

/**
 * Above this zoom a 1px tolerance is finer than the source data's vertex spacing, so simplification
 * would keep everything anyway; use the raw rings and let clipping do the work.
 */
const LOD_MAX_BUCKET = 6

/** Indices to draw at `zoom`: a 1px tolerance at the next integer zoom, so never coarser than Leaflet's own. */
function lodFor(cache: NonNullable<FastPath['_wp']>, zoom: number) {
  const bucket = Math.min(LOD_MAX_BUCKET + 1, Math.ceil(zoom))
  let lod = cache.lod.get(bucket)
  if (lod) return lod
  if (bucket > LOD_MAX_BUCKET) {
    const n = cache.unit.length / 2
    const idx = new Uint32Array(n)
    for (let i = 0; i < n; i++) idx[i] = i
    lod = { idx, offsets: cache.offsets }
  } else {
    const tol = 1 / 2 ** bucket
    const idx: number[] = []
    const offsets: number[] = []
    for (let r = 0; r < cache.offsets.length - 1; r++) {
      offsets.push(idx.length)
      simplifyRing(cache.unit, cache.offsets[r], cache.offsets[r + 1], tol * tol, idx)
    }
    offsets.push(idx.length)
    lod = { idx: Uint32Array.from(idx), offsets }
  }
  cache.lod.set(bucket, lod)
  return lod
}

function projectRings(path: FastPath, zoom: number, scale: number, ox: number, oy: number) {
  const cache = path._wp!
  const { unit } = cache
  const { idx, offsets } = lodFor(cache, zoom)
  const rings: L.Point[][] = []
  for (let r = 0; r < offsets.length - 1; r++) {
    const start = offsets[r]
    const end = offsets[r + 1]
    const ring: L.Point[] = new Array(end - start)
    for (let t = start; t < end; t++) {
      const i = idx[t]
      ring[t - start] = new L.Point(Math.round(unit[i * 2] * scale) - ox, Math.round(unit[i * 2 + 1] * scale) - oy)
    }
    rings.push(ring)
  }
  path._rings = rings
  path._wpDirty = false
}

/**
 * Every zoom end makes Leaflet re-project every vertex of every path through the generic
 * `latLngToLayerPoint` chain (~50ms for three world copies of the coastline). Mercator is linear in
 * 2^zoom, so project once at zoom 0 and from then on scale + offset in a tight loop. Paths that do
 * not touch the padded viewport get only their pixel bounds; their rings are produced on demand
 * the first time they scroll into view.
 */
function installFastProjection(layer: L.Layer) {
  if (!(layer instanceof L.Polyline)) return
  const path = layer as FastPath
  const clip = path._clipPoints
  // Simplification is done once per zoom level in `lodFor`; skip Leaflet's per-redraw pass.
  path.options.smoothFactor = 0
  path._project = function (this: FastPath) {
    const map = this._map
    if (!map) return
    let cache = this._wp
    if (!cache) {
      const rings: L.LatLng[][] = []
      flattenRings(this._latlngs, rings)
      let n = 0
      for (const r of rings) n += r.length
      const unit = new Float64Array(n * 2)
      const offsets: number[] = []
      const crs = map.options.crs!
      let k = 0
      let minX = Infinity
      let minY = Infinity
      let maxX = -Infinity
      let maxY = -Infinity
      for (const r of rings) {
        offsets.push(k / 2)
        for (const ll of r) {
          const p = crs.latLngToPoint(ll, 0)
          unit[k++] = p.x
          unit[k++] = p.y
          if (p.x < minX) minX = p.x
          if (p.y < minY) minY = p.y
          if (p.x > maxX) maxX = p.x
          if (p.y > maxY) maxY = p.y
        }
      }
      offsets.push(n)
      cache = this._wp = { unit, offsets, box: [minX, minY, maxX, maxY], lod: new Map() }
    }
    this._rings = []
    if (cache.unit.length === 0) return
    const crs = map.options.crs!
    const scale = crs.scale(map.getZoom()) / crs.scale(0)
    const origin = map.getPixelOrigin()
    const [minX, minY, maxX, maxY] = cache.box
    this._rawPxBounds = L.bounds(
      L.point(Math.round(minX * scale) - origin.x, Math.round(minY * scale) - origin.y),
      L.point(Math.round(maxX * scale) - origin.x, Math.round(maxY * scale) - origin.y),
    )
    this._updateBounds()
    this._wpDirty = true
  }
  path._clipPoints = function (this: FastPath) {
    if (this._wpDirty) {
      const rb = this._renderer?._bounds
      const map = this._map
      if (!rb?.min || !rb.max || !map || !this._pxBounds) {
        this._parts = []
        return
      }
      const w = (this.options.weight ?? 1) + 1
      if (!this._pxBounds.intersects(L.bounds(rb.min.subtract([w, w]), rb.max.add([w, w])))) {
        this._parts = []
        return
      }
      const crs = map.options.crs!
      const origin = map.getPixelOrigin()
      const zoom = map.getZoom()
      projectRings(this, zoom, crs.scale(zoom) / crs.scale(0), origin.x, origin.y)
    }
    clip.call(this)
  }
}

function pinIcon(kind: MapPin['kind'], color: string | undefined, label: string) {
  const c = color ?? (kind === 'target' ? '#22c55e' : kind === 'mine' ? '#fbbf24' : '#60a5fa')
  return L.divIcon({
    className: 'wp-pin',
    html: `<div class="wp-pin-dot" style="--c:${c}"></div><div class="wp-pin-label">${escapeHtml(label)}</div>`,
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  })
}

function bubbleIcon() {
  return L.divIcon({
    className: 'wp-bubble-wrap',
    html: `<button type="button" class="wp-bubble" aria-label="Select this country"></button>`,
    iconSize: [20, 20],
    iconAnchor: [-6, 10],
  })
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!)
}

function countryAt(layer: L.GeoJSON<CountryFeatureProps> | null, map: L.Map, latlng: L.LatLng): string | null {
  if (!layer) return null
  const point = map.latLngToLayerPoint(latlng)
  let land: string | null = null
  let hull: string | null = null
  layer.eachLayer((lyr) => {
    const feature = (lyr as L.Path & { feature?: GeoJSON.Feature<Geometry, CountryFeatureProps> }).feature
    if (!feature?.properties.playable || !feature.properties.iso2) return
    const path = lyr as L.Path & { _containsPoint?: (p: L.Point) => boolean }
    if (!path._containsPoint?.(point)) return
    if (feature.properties.kind === 'hull') hull = feature.properties.iso2
    else land = feature.properties.iso2
  })
  return land ?? hull
}

function clampZoom(z: number, minZ: number) {
  return Math.min(MAX_ZOOM, Math.max(minZ, z))
}

function typingInField(el: EventTarget | null) {
  if (!(el instanceof HTMLElement)) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

export function WorldMap(props: WorldMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const rendererRef = useRef<L.Canvas | null>(null)
  const layerRef = useRef<L.GeoJSON<CountryFeatureProps> | null>(null)
  const pinLayerRef = useRef<L.LayerGroup>(new L.LayerGroup())
  const magLayerRef = useRef<L.LayerGroup>(new L.LayerGroup())
  const lakesLayerRef = useRef<L.GeoJSON | null>(null)
  const statesLayerRef = useRef<L.GeoJSON | null>(null)
  const byIsoRef = useRef<Map<string, L.Path[]>>(new Map())
  const prevRolesRef = useRef<Record<string, CountryRole>>({})
  const hoveredRef = useRef<string | null>(null)
  const programmaticRef = useRef(false)
  const savedViewRef = useRef<{ center: [number, number]; zoom: number } | null>(null)
  const syncZoomRef = useRef<() => void>(() => {})
  /** Canvas hit-testing is only trustworthy when the paths were projected for the zoom on screen. */
  const freshRef = useRef<{ isFresh: () => boolean; ensure: () => void }>({ isFresh: () => true, ensure: () => {} })
  const propsRef = useRef(props)
  useLayoutEffect(() => {
    propsRef.current = props
  })

  const paintHover = (iso2: string | null) => {
    const prev = hoveredRef.current
    if (prev === iso2) return
    hoveredRef.current = iso2
    const roles = propsRef.current.roles
    const paint = (id: string | null, hovered: boolean) => {
      if (!id) return
      for (const lyr of byIsoRef.current.get(id) ?? []) {
        const feature = (lyr as L.Path & { feature?: GeoJSON.Feature<Geometry, CountryFeatureProps> }).feature
        if (!feature) continue
        // Do not bringToFront on hover: with L.canvas that permanently reorders hit-testing
        // so a large country (e.g. China) can steal mouseovers for the rest of the session.
        lyr.setStyle(styleFor(feature.properties, roles?.[id], hovered))
      }
    }
    paint(prev, false)
    paint(iso2, true)
  }
  const paintHoverRef = useRef(paintHover)
  paintHoverRef.current = paintHover

  const clearHover = () => {
    const prev = hoveredRef.current
    if (!prev) return
    hoveredRef.current = null
    const roles = propsRef.current.roles
    for (const lyr of byIsoRef.current.get(prev) ?? []) {
      const feature = (lyr as L.Path & { feature?: GeoJSON.Feature<Geometry, CountryFeatureProps> }).feature
      if (feature) lyr.setStyle(styleFor(feature.properties, roles?.[prev], false))
    }
  }

  const applyRoleStyle = (iso2: string, role: CountryRole | undefined) => {
    for (const lyr of byIsoRef.current.get(iso2) ?? []) {
      const feature = (lyr as L.Path & { feature?: GeoJSON.Feature<Geometry, CountryFeatureProps> }).feature
      if (!feature) continue
      lyr.setStyle(styleFor(feature.properties, role, hoveredRef.current === iso2))
      if (feature.properties.kind === 'hull') continue
      // Role paint should read above neighbours; clearing a role restores normal draw order
      // so the next hover/click hit-tests correctly on the canvas renderer.
      if (role) lyr.bringToFront()
      else lyr.bringToBack()
    }
  }

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    // Canvas, not SVG: ~90k coastline vertices as SVG paths must be re-rasterised on every frame of
    // a zoom animation, which is what made fly-to and wheel zoom stutter. A canvas is a bitmap the
    // GPU can scale for free; it only redraws once motion settles.
    // Must be set before any renderer is created; L.Canvas reads it on every repaint.
    ;(L.Browser as { retina: boolean }).retina = (window.devicePixelRatio || 1) >= RETINA_MIN_DPR
    installCanvasGhostSwap()
    const renderer = L.canvas({ padding: CANVAS_PADDING })
    rendererRef.current = renderer
    const map = L.map(containerRef.current, {
      // Replaced below with a control that routes through the same smooth zoom as the wheel.
      zoomControl: false,
      attributionControl: false,
      minZoom: MIN_ZOOM_FLOOR,
      maxZoom: MAX_ZOOM,
      worldCopyJump: true,
      preferCanvas: true,
      // Latitude only. Longitude wrap is handled by worldCopyJump + wrapCenter.
      maxBounds: [
        [MIN_LAT, -1e6],
        [MAX_LAT, 1e6],
      ],
      maxBoundsViscosity: 1,
      renderer,
      zoomSnap: 0,
      zoomDelta: BUTTON_ZOOM_STEP,
      // Keeps `leaflet-zoom-animated` (transform-origin 0 0) on the canvases; required for the
      // per-frame transform Leaflet applies to a renderer between redraws.
      zoomAnimation: true,
      fadeAnimation: false,
      // With this off Leaflet hides the whole marker pane (pins, island bubbles) for the duration
      // of any of its own zoom animations, which read as pins blinking out.
      markerZoomAnimation: true,
      easeLinearity: 0.16,
      // Leaflet's own keyboard pan jumps a fixed number of pixels.
      keyboard: false,
      // Wheel, double-click and the +/− buttons all go through the smooth zoom below.
      scrollWheelZoom: false,
      doubleClickZoom: false,
    })
    const internals = map as MapInternals
    map.setView(START_CENTER, START_ZOOM)
    map.createPane('statesPane').style.zIndex = '420'
    map.createPane('lakesPane').style.zIndex = '455'
    const userMoved = () => propsRef.current.onUserMove?.()
    const reportView = () => {
      const c = map.getCenter()
      propsRef.current.onViewChange?.({ center: [c.lat, c.lng], zoom: map.getZoom() })
    }
    map.on('moveend', reportView)
    reportView()

    const motion = {
      keys: new Set<string>(),
      vx: 0,
      vy: 0,
      panning: false,
      /** Pixels panned by keyboard since the canvases were last repainted. */
      panSinceRedraw: 0,
      /** Where the smooth zoom is heading. Only meaningful while `zooming`. */
      targetZoom: START_ZOOM,
      /** Container point that must stay put while zooming, and the latlng under it. */
      zoomOrigin: null as L.Point | null,
      zoomAnchor: null as L.LatLng | null,
      /** Our smooth zoom animation is running. */
      zooming: false,
      /** True while we are the ones firing zoomstart, so the handler can tell us from Leaflet. */
      driving: false,
      /** Zoom the canvases were last rasterised at. `map.getZoom()` differs from it mid-flight. */
      renderedZoom: START_ZOOM,
      /** Last pointer position over the map, for re-resolving hover after a redraw. */
      mouse: null as L.Point | null,
      /** Offscreen settle already ran for the current target, so arrival is a small fade. */
      prefetched: false,
      last: performance.now(),
      raf: 0,
    }
    let minZoom = MIN_ZOOM_FLOOR

    /** Everything the canvases show is drawn for the current zoom. */
    const isFresh = () => Math.abs(map.getZoom() - motion.renderedZoom) < 1e-9

    /** Re-resolve which country is under the pointer against freshly projected geometry. */
    const refreshHover = () => {
      const p = propsRef.current
      if (!motion.mouse || (p.interaction !== 'country' && p.interaction !== 'pin')) return
      const iso2 = countryAt(layerRef.current, map, map.containerPointToLatLng(motion.mouse))
      paintHoverRef.current(iso2)
      if (p.interaction === 'country') p.onHover?.(iso2)
    }

    /**
     * Finish the current zoom step for real: fires zoomend + moveend, which is what makes every
     * renderer re-project its paths and repaint at the current zoom. Same call Leaflet's own
     * flyTo / pinch use when they end.
     */
    const settle = (fade: boolean) => {
      canvasSwap.fade = fade
      internals._moveEnd(true)
      canvasSwap.fade = false
      motion.renderedZoom = map.getZoom()
      motion.panSinceRedraw = 0
      refreshHover()
    }

    /** Stop any smooth zoom in flight where it is and make the canvases match. */
    const cancelZoom = () => {
      motion.zooming = false
      motion.zoomAnchor = null
      motion.zoomOrigin = null
      motion.targetZoom = map.getZoom()
      if (!isFresh()) settle(false)
    }
    syncZoomRef.current = cancelZoom

    /** Make sure hit-testing sees geometry for the zoom on screen. Cheap no-op when it already does. */
    const ensureFresh = () => {
      if (!isFresh()) cancelZoom()
    }
    freshRef.current = { isFresh, ensure: ensureFresh }

    const applyMinZoom = () => {
      const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM_FLOOR, Math.log2(Math.max(map.getSize().x, 1) / 256)))
      minZoom = Number(next.toFixed(3))
      map.setMinZoom(minZoom)
      if (map.getZoom() < minZoom) {
        cancelZoom()
        programmaticRef.current = true
        map.setZoom(minZoom, { animate: false })
        programmaticRef.current = false
        motion.targetZoom = minZoom
      }
    }
    const wrapCenter = () => {
      const c = map.getCenter()
      const lat = clampLat(c.lat)
      const lng = wrapLng(c.lng)
      // Tolerance: a setView here is a full repaint, so do not do it for float noise.
      if (Math.abs(lat - c.lat) < 1e-7 && Math.abs(lng - c.lng) < 1e-7) return false
      if (lat !== c.lat) motion.vy = 0
      programmaticRef.current = true
      map.setView([lat, lng], map.getZoom(), { animate: false })
      programmaticRef.current = false
      return true
    }
    // Same path as mouse-drag: slide the pane, do not fire moveend. panBy({animate:false})
    // fires moveend every call, which redraws every canvas path (~3 world copies) at 60fps.
    const rawPanBy = (dx: number, dy: number) => {
      internals._rawPanBy(L.point(dx, dy).round())
    }
    const worldWidthPx = () => map.getPixelWorldBounds().getSize().x
    const applyPan = (dx: number, dy: number) => {
      rawPanBy(dx, dy)
      motion.panSinceRedraw += Math.hypot(dx, dy)
      const c = map.getCenter()
      const lat = clampLat(c.lat)
      if (lat !== c.lat) {
        motion.vy = 0
        rawPanBy(0, -(map.project(c).y - map.project([lat, c.lng]).y))
      }
      // Slide one world over, then ask Leaflet to repaint once. Firing move/moveend on
      // every frame redraws ~3 world-copies of every country and is what made keyboard
      // pan feel stuck.
      if (c.lng > 180) {
        rawPanBy(-worldWidthPx(), 0)
        return true
      }
      if (c.lng < -180) {
        rawPanBy(worldWidthPx(), 0)
        return true
      }
      // The canvases only cover the viewport plus padding; repaint before the edge shows.
      const size = map.getSize()
      return motion.panSinceRedraw > Math.min(size.x, size.y) * REDRAW_EVERY_PAN
    }

    /**
     * Put the map at `zoom` with `zoomAnchor` still under `zoomOrigin`. Goes through `_move`, the
     * same per-frame step Leaflet's flyTo uses: every layer repositions itself, the canvases are
     * CSS-scaled from their last raster, and map coordinates stay correct for the frame.
     */
    const applyZoom = (zoom: number) => {
      const size = map.getSize()
      const viewHalf = size.divideBy(2)
      const origin = motion.zoomOrigin ?? viewHalf
      const anchor = motion.zoomAnchor ?? map.getCenter()
      let center = map.unproject(map.project(anchor, zoom).add(viewHalf).subtract(origin), zoom)
      center = internals._limitCenter(center, zoom, map.options.maxBounds)
      center = L.latLng(center.lat, wrapLng(center.lng))
      internals._move(center, zoom)
    }

    /** Start or retarget the smooth zoom. `origin` is the container point to zoom around. */
    const zoomBy = (delta: number, origin: L.Point | null) => {
      // A programmatic fly-to in progress yields to the user immediately.
      internals._stop()
      programmaticRef.current = false
      const base = motion.zooming ? motion.targetZoom : map.getZoom()
      const target = clampZoom(base + delta, minZoom)
      const size = map.getSize()
      motion.zoomOrigin = origin ?? size.divideBy(2)
      // Resolved against the *current* frame, so retargeting mid-flight never jumps.
      motion.zoomAnchor = map.containerPointToLatLng(motion.zoomOrigin)
      if (Math.abs(target - map.getZoom()) < 1e-6 && !motion.zooming) return
      motion.targetZoom = target
      motion.prefetched = false
      // A new zoom owns the view; leftover settle ghosts would freeze at the old scale.
      dropAllCanvasGhosts()
      userMoved()
      if (!motion.zooming) {
        motion.zooming = true
        motion.driving = true
        internals._moveStart(true, false)
        motion.driving = false
      }
      kick()
    }

    const MAX_PAN = 1400
    const PAN_TAU = 0.09
    const kick = () => {
      if (!motion.raf) {
        motion.last = performance.now()
        motion.raf = requestAnimationFrame(step)
      }
    }
    const step = (now: number) => {
      const dt = Math.min(0.032, (now - motion.last) / 1000)
      motion.last = now
      let ax = 0
      let ay = 0
      if (motion.keys.has('arrowleft') || motion.keys.has('a')) ax -= 1
      if (motion.keys.has('arrowright') || motion.keys.has('d')) ax += 1
      if (motion.keys.has('arrowup') || motion.keys.has('w')) ay -= 1
      if (motion.keys.has('arrowdown') || motion.keys.has('s')) ay += 1
      if (ax || ay) {
        const len = Math.hypot(ax, ay) || 1
        const follow = 1 - Math.exp(-dt / PAN_TAU)
        motion.vx += ((ax / len) * MAX_PAN - motion.vx) * follow
        motion.vy += ((ay / len) * MAX_PAN - motion.vy) * follow
      } else {
        const follow = 1 - Math.exp(-dt / PAN_TAU)
        motion.vx += (0 - motion.vx) * follow
        motion.vy += (0 - motion.vy) * follow
        if (Math.abs(motion.vx) < 6) motion.vx = 0
        if (Math.abs(motion.vy) < 6) motion.vy = 0
      }
      let repaintPan = false
      if (motion.vx || motion.vy) {
        repaintPan = applyPan(motion.vx * dt, motion.vy * dt)
        motion.panning = true
        // The map slid under the zoom origin; keep zooming around what is there now.
        if (motion.zooming && motion.zoomOrigin) motion.zoomAnchor = map.containerPointToLatLng(motion.zoomOrigin)
      } else if (motion.panning) {
        motion.panning = false
        repaintPan = true
      }

      if (motion.zooming) {
        const cur = map.getZoom()
        const gap = motion.targetZoom - cur
        const arrived = Math.abs(gap) < 0.002
        applyZoom(arrived ? motion.targetZoom : cur + gap * (1 - Math.exp(-dt / ZOOM_TAU)))
        if (arrived) {
          motion.zooming = false
          motion.zoomAnchor = null
          motion.zoomOrigin = null
          motion.prefetched = false
          settle(true)
        } else if (Math.abs(map.getZoom() - motion.renderedZoom) > REDRAW_EVERY_LEVELS) {
          motion.prefetched = false
          settle(false)
        } else if (!motion.prefetched && Math.abs(gap) < SETTLE_PREFETCH_LEVELS) {
          // Paint the destination raster while the last bit of CSS-scale is still on screen.
          motion.prefetched = true
          settle(false)
        }
      } else if (repaintPan) {
        motion.panSinceRedraw = 0
        map.fire('moveend')
      }

      const moving = !!(ax || ay || motion.vx || motion.vy || motion.zooming)
      motion.raf = moving ? requestAnimationFrame(step) : 0
    }

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const px = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 800 : e.deltaY
      const delta = Math.max(-WHEEL_MAX_STEP, Math.min(WHEEL_MAX_STEP, -px * WHEEL_ZOOM_PER_PX))
      if (!delta) return
      zoomBy(delta, map.mouseEventToContainerPoint(e))
    }
    const container = map.getContainer()
    container.addEventListener('wheel', onWheel, { passive: false })
    const onPointerMove = (e: PointerEvent) => {
      motion.mouse = map.mouseEventToContainerPoint(e)
    }
    const onPointerLeave = () => {
      motion.mouse = null
    }
    const onPointerDown = (e: PointerEvent) => {
      motion.mouse = map.mouseEventToContainerPoint(e)
      // Clicks and drags must hit-test against geometry drawn for the zoom on screen.
      if (!(e.target instanceof Element && e.target.closest('.leaflet-control'))) ensureFresh()
    }
    container.addEventListener('pointermove', onPointerMove)
    container.addEventListener('pointerleave', onPointerLeave)
    container.addEventListener('pointerdown', onPointerDown, true)

    map.on('dblclick', (e) => {
      zoomBy(e.originalEvent.shiftKey ? -BUTTON_ZOOM_STEP : BUTTON_ZOOM_STEP, e.containerPoint)
    })
    // Leaflet's stock control, but routed through the smooth zoom instead of setZoom's
    // 250ms CSS transition, so buttons, wheel and double-click all feel the same.
    const SmoothZoomControl = (L.Control.Zoom as unknown as { extend: (p: object) => new (o: L.ControlOptions) => L.Control }).extend({
      _zoomIn(e: MouseEvent) {
        zoomBy(BUTTON_ZOOM_STEP * (e.shiftKey ? 3 : 1), null)
      },
      _zoomOut(e: MouseEvent) {
        zoomBy(-BUTTON_ZOOM_STEP * (e.shiftKey ? 3 : 1), null)
      },
    })
    // Bottom-right: the top corners are covered by the screen overlays (search box, prompt).
    map.addControl(new SmoothZoomControl({ position: 'bottomright' }))

    let dragOrigin: L.Point | null = null
    map.on('dragstart', () => {
      // Leaflet's drag already cancelled any fly-to; take over from wherever the view is.
      programmaticRef.current = false
      dropAllCanvasGhosts()
      cancelZoom()
      userMoved()
      dragOrigin = L.DomUtil.getPosition(map.getPane('mapPane')!)
    })
    map.on('drag', () => {
      // Leaflet only repaints canvases at dragend; with a small raster padding a long drag would
      // otherwise pull blank space into view. Repaint once per padding's worth of travel.
      if (!dragOrigin) return
      const pos = L.DomUtil.getPosition(map.getPane('mapPane')!)
      const size = map.getSize()
      const d = pos.subtract(dragOrigin)
      if (Math.abs(d.x) > size.x * REDRAW_EVERY_PAN || Math.abs(d.y) > size.y * REDRAW_EVERY_PAN) {
        dragOrigin = pos
        map.fire('moveend')
      }
    })
    map.on('dragend', () => {
      dragOrigin = null
      wrapCenter()
    })
    map.on('zoomstart', () => {
      if (motion.driving) return
      // A zoom we did not start (fly-to, pinch, setView). Drop ours; that one owns the view now.
      dropAllCanvasGhosts()
      motion.zooming = false
      motion.prefetched = false
      motion.zoomAnchor = null
      motion.zoomOrigin = null
      if (!programmaticRef.current) userMoved()
    })
    map.on('zoomend', () => {
      // Every zoomend is followed by a re-project + repaint (Leaflet's renderers listen to it too).
      motion.renderedZoom = map.getZoom()
      motion.panSinceRedraw = 0
      if (!motion.zooming) motion.targetZoom = map.getZoom()
      // Leaflet flyTo / setView end here; our settle() has already set the fade flag for wheel zooms.
      if (programmaticRef.current && !motion.zooming) canvasSwap.fade = true
      wrapCenter()
      requestAnimationFrame(() => {
        canvasSwap.fade = false
      })
    })

    const onKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase()
      if (!PAN_KEYS.has(key) || typingInField(e.target) || e.metaKey || e.ctrlKey || e.altKey) return
      e.preventDefault()
      if (motion.keys.size === 0) userMoved()
      motion.keys.add(key)
      kick()
    }
    const onKeyUp = (e: KeyboardEvent) => motion.keys.delete(e.key.toLowerCase())
    const onBlur = () => motion.keys.clear()
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)

    applyMinZoom()
    map.on('click', (e) => {
      const p = propsRef.current
      if (p.interaction === 'pin') {
        p.onMapClick?.(e.latlng.lat, wrapLng(e.latlng.lng))
        return
      }
      if (p.interaction !== 'country') return
      ensureFresh()
      const iso2 = countryAt(layerRef.current, map, e.latlng)
      if (iso2) p.onCountryClick?.(iso2)
    })
    pinLayerRef.current.addTo(map)
    magLayerRef.current.addTo(map)
    mapRef.current = map
    setTimeout(() => {
      map.invalidateSize()
      applyMinZoom()
    }, 0)
    const ro = new ResizeObserver(() => {
      map.invalidateSize()
      applyMinZoom()
    })
    ro.observe(containerRef.current)
    return () => {
      ro.disconnect()
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
      cancelAnimationFrame(motion.raf)
      container.removeEventListener('wheel', onWheel)
      container.removeEventListener('pointermove', onPointerMove)
      container.removeEventListener('pointerleave', onPointerLeave)
      container.removeEventListener('pointerdown', onPointerDown, true)
      map.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    layerRef.current?.remove()
    const index = new Map<string, L.Path[]>()
    const layer = L.geoJSON<CountryFeatureProps>(withWorldCopies(props.geojson), {
      style: (f) => styleFor(f!.properties, undefined, false),
      onEachFeature: (feature, lyr) => {
        installFastProjection(lyr)
        const iso2 = feature.properties.iso2
        if (iso2) {
          const list = index.get(iso2)
          if (list) list.push(lyr as L.Path)
          else index.set(iso2, [lyr as L.Path])
        }
        lyr.on('mouseover', (e) => {
          const t = (e.originalEvent?.target as HTMLElement | undefined) ?? null
          if (t?.closest('.wp-bubble, .wp-bubble-wrap')) return
          // Mid-zoom the canvas hit-test runs against stale geometry; hover is re-resolved
          // from the pointer position as soon as the canvases repaint.
          if (!freshRef.current.isFresh()) return
          const p = propsRef.current
          if ((p.interaction !== 'country' && p.interaction !== 'pin') || !iso2 || !feature.properties.playable) return
          paintHoverRef.current(iso2)
          if (p.interaction === 'country') p.onHover?.(iso2)
        })
        lyr.on('mouseout', (e) => {
          const t = (e.originalEvent?.relatedTarget as HTMLElement | undefined) ?? null
          if (t?.closest('.wp-bubble, .wp-bubble-wrap')) return
          if (!freshRef.current.isFresh()) return
          const still = countryAt(layerRef.current, map, e.latlng)
          if (still) {
            paintHoverRef.current(still)
            if (propsRef.current.interaction === 'country') propsRef.current.onHover?.(still)
            return
          }
          paintHoverRef.current(null)
          propsRef.current.onHover?.(null)
        })
        lyr.on('click', (e) => {
          L.DomEvent.stopPropagation(e)
          const p = propsRef.current
          if (p.interaction === 'pin') {
            p.onMapClick?.(e.latlng.lat, wrapLng(e.latlng.lng))
            return
          }
          if (p.interaction !== 'country' || !iso2 || !feature.properties.playable) return
          // Leaflet picked `lyr` against whatever geometry the canvas had; if a zoom was still in
          // flight that may be a neighbour. Re-resolve against fresh geometry so the answer that is
          // submitted is the country actually under the cursor. A hull is the grouping ring around an
          // archipelago; if real land of another country sits under the pointer, that land wins.
          const wasFresh = freshRef.current.isFresh()
          freshRef.current.ensure()
          const hit = wasFresh && feature.properties.kind !== 'hull' ? iso2 : (countryAt(layerRef.current, map, e.latlng) ?? iso2)
          p.onCountryClick?.(hit)
        })
      },
    })
    layer.addTo(map)
    layerRef.current = layer
    byIsoRef.current = index
    // A fresh layer has no roles painted yet; apply whatever the current props say.
    const roles = propsRef.current.roles ?? {}
    for (const iso2 in roles) applyRoleStyle(iso2, roles[iso2])
    prevRolesRef.current = { ...roles }
  }, [props.geojson])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    lakesLayerRef.current?.remove()
    lakesLayerRef.current = null
    if (!props.lakes) return
    const lakes = L.geoJSON(withWorldCopies(props.lakes), {
      pane: 'lakesPane',
      interactive: false,
      onEachFeature: (_f, lyr) => installFastProjection(lyr),
      style: { color: '#071225', weight: 0.4, fillColor: '#0b1e3a', fillOpacity: 1, renderer: L.canvas({ padding: CANVAS_PADDING, pane: 'lakesPane' }) },
    })
    lakes.addTo(map)
    lakesLayerRef.current = lakes
  }, [props.lakes])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    statesLayerRef.current?.remove()
    statesLayerRef.current = null
    if (!props.states) return
    const states = L.geoJSON(withWorldCopies(props.states), {
      pane: 'statesPane',
      interactive: false,
      onEachFeature: (_f, lyr) => installFastProjection(lyr),
      style: { color: '#0f172a', weight: 0.45, opacity: 0.28, fill: false, renderer: L.canvas({ padding: CANVAS_PADDING, pane: 'statesPane' }) },
    })
    states.addTo(map)
    statesLayerRef.current = states
  }, [props.states])

  // Wipe hover + role paint when the question changes. Canvas keeps the last fill until we
  // rewrite it; pin rounds leave hover on a country (often China after "pin the capital of…")
  // that then sticks into the next language/click round and breaks further hover updates.
  const highlightKeyRef = useRef(props.highlightKey)
  useEffect(() => {
    if (props.highlightKey === highlightKeyRef.current) return
    highlightKeyRef.current = props.highlightKey
    clearHover()
    const prev = prevRolesRef.current
    for (const iso2 in prev) applyRoleStyle(iso2, undefined)
    prevRolesRef.current = {}
    const next = propsRef.current.roles ?? {}
    for (const iso2 in next) applyRoleStyle(iso2, next[iso2])
    prevRolesRef.current = { ...next }
  }, [props.highlightKey])

  // Restyle only the countries whose role actually changed (a bid-collect click used to repaint
  // every country on the map).
  useEffect(() => {
    if (!layerRef.current) return
    const next = props.roles ?? {}
    const prev = prevRolesRef.current
    const changed = new Set<string>()
    for (const iso2 in prev) if (prev[iso2] !== next[iso2]) changed.add(iso2)
    for (const iso2 in next) if (prev[iso2] !== next[iso2]) changed.add(iso2)
    // Hover under the cursor must be redrawn against the new roles, even if that iso2's role
    // did not change (e.g. clearing everyone else's paint).
    if (hoveredRef.current) changed.add(hoveredRef.current)
    for (const iso2 of changed) applyRoleStyle(iso2, next[iso2])
    prevRolesRef.current = { ...next }
  }, [props.roles])

  useEffect(() => {
    // Leaving pin mode with the cursor still over a country would otherwise keep that hover
    // fill forever, because mouseout never fires if the pointer never moved.
    clearHover()
    const el = containerRef.current
    if (!el) return
    el.classList.toggle('wp-cursor-pin', props.interaction === 'pin' || props.interaction === 'circle')
    el.classList.toggle('wp-cursor-country', props.interaction === 'country')
  }, [props.interaction])

  useEffect(() => {
    const map = mapRef.current
    const el = containerRef.current
    if (!map || !el || props.interaction !== 'circle') return
    let start: L.LatLng | null = null
    let preview: L.Circle | null = null
    const minM = () => Math.max(8000, map.containerPointToLatLng([0, 0]).distanceTo(map.containerPointToLatLng([10, 0])))
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return
      if (e.target instanceof Element && e.target.closest('.leaflet-control')) return
      map.dragging.disable()
      start = map.mouseEventToLatLng(e as unknown as MouseEvent)
      preview = L.circle(start, {
        radius: minM(),
        color: '#fbbf24',
        weight: 2,
        fillColor: '#fbbf24',
        fillOpacity: 0.16,
        interactive: false,
      }).addTo(map)
      el.setPointerCapture(e.pointerId)
    }
    const onMove = (e: PointerEvent) => {
      if (!start || !preview) return
      const now = map.mouseEventToLatLng(e as unknown as MouseEvent)
      preview.setRadius(Math.max(minM(), start.distanceTo(now)))
    }
    const finish = (e: PointerEvent) => {
      if (!start) return
      const now = map.mouseEventToLatLng(e as unknown as MouseEvent)
      const meters = Math.max(minM(), start.distanceTo(now))
      const lat = start.lat
      const lng = wrapLng(start.lng)
      preview?.remove()
      preview = null
      start = null
      map.dragging.enable()
      propsRef.current.onCircle?.(lat, lng, meters / 1000)
    }
    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', finish)
    el.addEventListener('pointercancel', finish)
    return () => {
      preview?.remove()
      map.dragging.enable()
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', finish)
      el.removeEventListener('pointercancel', finish)
    }
  }, [props.interaction])

  useEffect(() => {
    const group = pinLayerRef.current
    group.clearLayers()
    for (const line of props.lines ?? []) {
      const toLng = nearestLng(line.from[1], line.to[1])
      for (const dLng of WORLD_COPIES) {
        L.polyline(
          [
            [line.from[0], line.from[1] + dLng],
            [line.to[0], toLng + dLng],
          ],
          // Share the country canvas: a path in its own pane would get its own full-size canvas.
          { color: line.color ?? '#fbbf24', weight: 2, dashArray: '4 4', interactive: false, renderer: rendererRef.current ?? undefined },
        ).addTo(group)
      }
    }
    for (const pin of props.pins ?? []) {
      for (const dLng of WORLD_COPIES) {
        L.marker([pin.lat, pin.lng + dLng], { icon: pinIcon(pin.kind, pin.color, pin.label), interactive: false }).addTo(group)
      }
    }
    for (const c of props.circles ?? []) {
      for (const dLng of WORLD_COPIES) {
        L.circle([c.lat, c.lng + dLng], {
          radius: c.radiusKm * 1000,
          color: c.color ?? '#fbbf24',
          weight: 2,
          fillColor: c.color ?? '#fbbf24',
          fillOpacity: 0.14,
          interactive: false,
          renderer: rendererRef.current ?? undefined,
        }).addTo(group)
      }
    }
  }, [props.pins, props.lines, props.circles])

  useEffect(() => {
    const group = magLayerRef.current
    group.clearLayers()
    if (props.interaction !== 'country') return
    const seen = new Set<string>()
    for (const feature of props.geojson.features) {
      const { iso2, tiny, playable, labelLat, labelLng, kind } = feature.properties
      if (kind === 'hull' || !tiny || !playable || !iso2 || seen.has(iso2)) continue
      seen.add(iso2)
      const select = () => {
        if (propsRef.current.interaction === 'country') propsRef.current.onCountryClick?.(iso2)
      }
      for (const dLng of WORLD_COPIES) {
      const marker = L.marker([labelLat, labelLng + dLng], {
        icon: bubbleIcon(),
        keyboard: false,
        zIndexOffset: 400,
        bubblingMouseEvents: false,
      })
      const highlight = (e: L.LeafletMouseEvent) => {
        L.DomEvent.stopPropagation(e)
        paintHoverRef.current(iso2)
        propsRef.current.onHover?.(null)
      }
      marker.on('mouseover', highlight)
      marker.on('mouseout', (e) => {
        L.DomEvent.stopPropagation(e)
        paintHoverRef.current(null)
        propsRef.current.onHover?.(null)
      })
      marker.on('add', () => {
        const el = marker.getElement()
        if (!el) return
        L.DomEvent.disableScrollPropagation(el)
        L.DomEvent.on(el, 'click', (ev) => {
          L.DomEvent.stop(ev)
          select()
        })
        L.DomEvent.on(el, 'pointerenter', () => {
          paintHoverRef.current(iso2)
          propsRef.current.onHover?.(null)
        })
        L.DomEvent.on(el, 'pointerleave', () => {
          paintHoverRef.current(null)
          propsRef.current.onHover?.(null)
        })
      })
      marker.on('click', (e) => {
        L.DomEvent.stopPropagation(e)
        select()
      })
      marker.addTo(group)
      }
    }
  }, [props.geojson, props.interaction])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !props.flyTo) return
    const cmd = props.flyTo
    const finish = () => {
      programmaticRef.current = false
    }
    programmaticRef.current = true
    syncZoomRef.current()
    if (cmd.save) {
      const c = map.getCenter()
      savedViewRef.current = { center: [c.lat, wrapLng(c.lng)], zoom: map.getZoom() }
    }
    const go = (center: L.LatLngExpression, zoom: number, duration: number, instant?: boolean) => {
      const latlng = L.latLng(center)
      const dest: [number, number] = [clampLat(latlng.lat), nearestLng(map.getCenter().lng, latlng.lng)]
      if (instant) {
        map.setView(dest, zoom, { animate: false })
        finish()
        return
      }
      map.once('moveend', finish)
      map.flyTo(dest, zoom, { duration, easeLinearity: 0.16 })
    }
    if (cmd.restore) {
      const saved = savedViewRef.current
      if (!saved) {
        finish()
        return
      }
      go(saved.center, saved.zoom, 0.85, cmd.instant)
      return
    }
    if (cmd.center && cmd.zoom != null) {
      go(cmd.center, cmd.zoom, 0.85, cmd.instant)
      return
    }
    if (!cmd.bbox) {
      finish()
      return
    }
    const [w, s, e, n] = shortPathBbox(cmd.bbox, map.getCenter().lng)
    const bounds = L.latLngBounds([s, w], [n, e])
    const fit = map.getBoundsZoom(bounds, false, L.point(72, 200))
    const zoom = Math.max(map.getMinZoom(), Math.min(6, fit - 1))
    go(bounds.getCenter(), zoom, 1.2, cmd.instant)
  }, [props.flyTo])

  return <div ref={containerRef} className="wp-map" tabIndex={0} />
}
