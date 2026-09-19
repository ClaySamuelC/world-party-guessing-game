import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useEffect, useLayoutEffect, useRef } from 'react'
import type { FeatureCollection, Geometry } from 'geojson'
import type { CountryFeatureProps } from '../data/types'
import './map.css'

/** 'valid' = part of the answer set but not claimed by you (dimmer green). */
export type CountryRole = 'selected' | 'correct' | 'wrong' | 'valid'

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
  /** 'country' = polygons clickable; 'pin' = clicks fall through to the map; 'none' = read-only. */
  interaction: 'country' | 'pin' | 'none'
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
  onHover?: (iso2: string | null) => void
  onUserMove?: () => void
  onViewChange?: (view: { center: [number, number]; zoom: number }) => void
}

const BASE_STYLE: L.PathOptions = { color: '#1e293b', weight: 0.7, fillColor: '#94a3b8', fillOpacity: 1 }
const NON_PLAYABLE_STYLE: L.PathOptions = { ...BASE_STYLE, fillColor: '#64748b' }
const ISLAND_STYLE: L.PathOptions = { color: '#e2e8f0', weight: 1.7, fillColor: '#94a3b8', fillOpacity: 1 }
const TINY_STYLE: L.PathOptions = { color: '#f8fafc', weight: 2.3, fillColor: '#a5b4c8', fillOpacity: 1 }
const HULL_STYLE: L.PathOptions = { color: '#fbbf24', weight: 0, fillColor: '#cbd5e1', fillOpacity: 0, stroke: false }
const ROLE_STYLE: Record<CountryRole, L.PathOptions> = {
  selected: { fillColor: '#fbbf24', color: '#78350f', weight: 1.8 },
  correct: { fillColor: '#4ade80', color: '#14532d', weight: 1.8 },
  wrong: { fillColor: '#f87171', color: '#7f1d1d', weight: 1.8 },
  valid: { fillColor: '#a7f3d0', color: '#065f46', weight: 1.2 },
}

const MIN_ZOOM_FLOOR = 1.8
const MAX_ZOOM = 9
const START_CENTER: L.LatLngExpression = [20, 12]
const START_ZOOM = 2.85
const MIN_LAT = -56
const MAX_LAT = 78
const PAN_KEYS = new Set(['arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'a', 'd', 'w', 's'])

function styleFor(props: CountryFeatureProps, role: CountryRole | undefined, hovered: boolean): L.PathOptions {
  if (props.kind === 'hull') {
    return hovered
      ? { color: '#fbbf24', weight: 1.1, fillColor: '#fde68a', fillOpacity: 0.22, stroke: true }
      : HULL_STYLE
  }
  const base = !props.playable ? NON_PLAYABLE_STYLE : props.tiny ? TINY_STYLE : props.island ? ISLAND_STYLE : BASE_STYLE
  const withRole = role ? { ...base, ...ROLE_STYLE[role] } : base
  return hovered && props.playable && !role
    ? { ...withRole, fillColor: '#e2e8f0', color: '#fbbf24', weight: Math.max(withRole.weight ?? 1, 2.1) }
    : withRole
}

function wrapLng(lng: number) {
  return ((((lng + 180) % 360) + 360) % 360) - 180
}

function shiftGeometry(geom: Geometry, dLng: number): Geometry {
  const shift = (c: number[]): number[] => [c[0] + dLng, c[1]]
  const ring = (r: number[][]) => r.map(shift)
  if (geom.type === 'Polygon') return { type: 'Polygon', coordinates: geom.coordinates.map(ring) }
  if (geom.type === 'MultiPolygon') return { type: 'MultiPolygon', coordinates: geom.coordinates.map((p) => p.map(ring)) }
  if (geom.type === 'LineString') return { type: 'LineString', coordinates: geom.coordinates.map(shift) }
  if (geom.type === 'MultiLineString') return { type: 'MultiLineString', coordinates: geom.coordinates.map(ring) }
  return geom
}

function forEachCoord(geom: Geometry, fn: (lng: number, lat: number) => void) {
  if (geom.type === 'Polygon') {
    for (const ring of geom.coordinates) for (const c of ring) fn(c[0], c[1])
  } else if (geom.type === 'MultiPolygon') {
    for (const poly of geom.coordinates) for (const ring of poly) for (const c of ring) fn(c[0], c[1])
  } else if (geom.type === 'LineString') {
    for (const c of geom.coordinates) fn(c[0], c[1])
  } else if (geom.type === 'MultiLineString') {
    for (const line of geom.coordinates) for (const c of line) fn(c[0], c[1])
  }
}

/** Only copy features that sit on the Pacific seam — 3× the whole world is too expensive. */
function needsSeamWrap(geom: Geometry) {
  let minX = 180
  let maxX = -180
  forEachCoord(geom, (lng) => {
    if (lng < minX) minX = lng
    if (lng > maxX) maxX = lng
  })
  return minX < -140 || maxX > 140 || maxX - minX > 180
}

const seamWrapCache = new WeakMap<FeatureCollection<Geometry>, FeatureCollection<Geometry>>()

function withSeamWraps<P>(fc: FeatureCollection<Geometry, P>): FeatureCollection<Geometry, P> {
  const cached = seamWrapCache.get(fc as FeatureCollection<Geometry>)
  if (cached) return cached as FeatureCollection<Geometry, P>
  const features: FeatureCollection<Geometry, P>['features'] = []
  for (const f of fc.features) {
    features.push(f)
    if (!needsSeamWrap(f.geometry)) continue
    features.push({ ...f, geometry: shiftGeometry(f.geometry, -360) })
    features.push({ ...f, geometry: shiftGeometry(f.geometry, 360) })
  }
  const out = { type: 'FeatureCollection' as const, features }
  seamWrapCache.set(fc as FeatureCollection<Geometry>, out as FeatureCollection<Geometry>)
  return out
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
    const renderer = L.canvas({ padding: 0.5 })
    const map = L.map(containerRef.current, {
      zoomControl: true,
      attributionControl: false,
      minZoom: MIN_ZOOM_FLOOR,
      maxZoom: MAX_ZOOM,
      worldCopyJump: true,
      preferCanvas: true,
      maxBounds: [
        [MIN_LAT, -720],
        [MAX_LAT, 720],
      ],
      maxBoundsViscosity: 1,
      renderer,
      zoomSnap: 0,
      zoomDelta: 0.35,
      wheelPxPerZoomLevel: 180,
      zoomAnimation: true,
      fadeAnimation: false,
      markerZoomAnimation: false,
      easeLinearity: 0.16,
      // Leaflet's own keyboard pan jumps a fixed number of pixels.
      keyboard: false,
      scrollWheelZoom: false,
    })
    map.setView(START_CENTER, START_ZOOM)
    map.createPane('statesPane').style.zIndex = '420'
    map.createPane('lakesPane').style.zIndex = '455'
    const userMoved = () => propsRef.current.onUserMove?.()
    const reportView = () => {
      const c = map.getCenter()
      propsRef.current.onViewChange?.({ center: [c.lat, c.lng], zoom: map.getZoom() })
    }
    map.on('dragstart', () => {
      programmaticRef.current = false
      userMoved()
    })
    map.on('zoomstart', () => {
      if (!programmaticRef.current) userMoved()
    })
    map.on('moveend', reportView)
    reportView()

    const motion = {
      keys: new Set<string>(),
      vx: 0,
      vy: 0,
      panning: false,
      targetZoom: START_ZOOM,
      displayZoom: START_ZOOM,
      zoomAnchor: null as L.LatLng | null,
      zoomOrigin: null as L.Point | null,
      zooming: false,
      last: performance.now(),
      raf: 0,
    }
    let minZoom = MIN_ZOOM_FLOOR
    const applyMinZoom = () => {
      const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM_FLOOR, Math.log2(Math.max(map.getSize().x, 1) / 256)))
      minZoom = Number(next.toFixed(3))
      map.setMinZoom(minZoom)
      if (map.getZoom() < minZoom) {
        map.setZoom(minZoom, { animate: false })
        motion.targetZoom = minZoom
        motion.displayZoom = minZoom
      }
    }
    const rawPanBy = (dx: number, dy: number) => {
      ;(map as L.Map & { _rawPanBy: (p: L.Point) => void })._rawPanBy(L.point(dx, dy))
    }
    const worldWidthPx = () => map.getPixelWorldBounds().getSize().x
    const applyPan = (dx: number, dy: number) => {
      rawPanBy(dx, dy)
      const c = map.getCenter()
      const lat = Math.min(MAX_LAT, Math.max(MIN_LAT, c.lat))
      if (lat !== c.lat) {
        motion.vy = 0
        const y = map.project(c).y - map.project([lat, c.lng]).y
        rawPanBy(0, -y)
      }
      // Cross the antimeridian by sliding the pane a whole world width, exactly like Leaflet's own
      // worldCopyJump drag handler. Nothing is re-projected, so there is no hitch at the seam.
      if (c.lng > 180) rawPanBy(-worldWidthPx(), 0)
      else if (c.lng < -180) rawPanBy(worldWidthPx(), 0)
    }
    const mapPane = () => map.getPane('mapPane')!
    const applyVisualZoom = () => {
      const pane = mapPane()
      const pos = L.DomUtil.getPosition(pane) ?? L.point(0, 0)
      const origin = motion.zoomOrigin ?? L.point(map.getSize().x / 2, map.getSize().y / 2)
      const scale = 2 ** (motion.displayZoom - map.getZoom())
      if (Math.abs(scale - 1) < 0.0004) {
        pane.style.transformOrigin = ''
        L.DomUtil.setTransform(pane, pos)
        return
      }
      pane.style.transformOrigin = `${origin.x - pos.x}px ${origin.y - pos.y}px`
      L.DomUtil.setTransform(pane, pos, scale)
    }
    const commitVisualZoom = () => {
      const pane = mapPane()
      const pos = L.DomUtil.getPosition(pane) ?? L.point(0, 0)
      pane.style.transformOrigin = ''
      L.DomUtil.setTransform(pane, pos)
      if (motion.zoomAnchor && Math.abs(motion.displayZoom - map.getZoom()) > 0.0008) {
        programmaticRef.current = true
        map.setZoomAround(motion.zoomAnchor, motion.displayZoom, { animate: false })
        programmaticRef.current = false
      }
      motion.displayZoom = map.getZoom()
    }
    const syncZoomFromMap = () => {
      motion.targetZoom = map.getZoom()
      motion.displayZoom = motion.targetZoom
      motion.zooming = false
      motion.zoomAnchor = null
      const pane = mapPane()
      const pos = L.DomUtil.getPosition(pane) ?? L.point(0, 0)
      pane.style.transformOrigin = ''
      L.DomUtil.setTransform(pane, pos)
    }
    syncZoomRef.current = syncZoomFromMap
    const MAX_PAN = 1400
    const PAN_TAU = 0.09
    const ZOOM_TAU = 0.1
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
      if (motion.vx || motion.vy) {
        applyPan(motion.vx * dt, motion.vy * dt)
        map.fire('move')
        motion.panning = true
      } else if (motion.panning) {
        motion.panning = false
        map.fire('moveend')
      }

      const zoomGap = motion.targetZoom - motion.displayZoom
      if (Math.abs(zoomGap) > 0.00035) {
        motion.displayZoom += zoomGap * (1 - Math.exp(-dt / ZOOM_TAU))
        if (Math.abs(motion.displayZoom - map.getZoom()) >= 1.1) commitVisualZoom()
        applyVisualZoom()
        motion.zooming = true
      } else if (motion.zooming) {
        motion.displayZoom = motion.targetZoom
        commitVisualZoom()
        motion.zooming = false
      } else if (motion.vx || motion.vy) {
        applyVisualZoom()
      }

      const moving = !!(ax || ay || motion.vx || motion.vy || motion.zooming)
      motion.raf = moving ? requestAnimationFrame(step) : 0
    }

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      userMoved()
      const raw = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 800 : e.deltaY
      motion.targetZoom = clampZoom(motion.targetZoom - raw * 0.002, minZoom)
      motion.zoomOrigin = map.mouseEventToContainerPoint(e)
      motion.zoomAnchor = map.containerPointToLatLng(motion.zoomOrigin)
      motion.zooming = true
      kick()
    }
    map.getContainer().addEventListener('wheel', onWheel, { passive: false })
    map.on('dragstart', () => {
      commitVisualZoom()
      syncZoomFromMap()
    })
    map.on('zoomend', () => {
      if (!motion.zooming) syncZoomFromMap()
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
      map.getContainer().removeEventListener('wheel', onWheel)
      map.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    layerRef.current?.remove()
    const index = new Map<string, L.Path[]>()
    const layer = L.geoJSON<CountryFeatureProps>(withSeamWraps(props.geojson), {
      style: (f) => styleFor(f!.properties, undefined, false),
      onEachFeature: (feature, lyr) => {
        const iso2 = feature.properties.iso2
        if (iso2) {
          const list = index.get(iso2)
          if (list) list.push(lyr as L.Path)
          else index.set(iso2, [lyr as L.Path])
        }
        lyr.on('mouseover', (e) => {
          const t = (e.originalEvent?.target as HTMLElement | undefined) ?? null
          if (t?.closest('.wp-bubble, .wp-bubble-wrap')) return
          const p = propsRef.current
          if ((p.interaction !== 'country' && p.interaction !== 'pin') || !iso2 || !feature.properties.playable) return
          paintHoverRef.current(iso2)
          if (p.interaction === 'country') p.onHover?.(iso2)
        })
        lyr.on('mouseout', (e) => {
          const t = (e.originalEvent?.relatedTarget as HTMLElement | undefined) ?? null
          if (t?.closest('.wp-bubble, .wp-bubble-wrap')) return
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
          // A hull is invisible water around an archipelago; if real land of another country sits
          // under the pointer, that land wins.
          const hit = feature.properties.kind === 'hull' ? countryAt(layerRef.current, map, e.latlng) ?? iso2 : iso2
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
    const lakes = L.geoJSON(withSeamWraps(props.lakes), {
      pane: 'lakesPane',
      interactive: false,
      style: { color: '#071225', weight: 0.4, fillColor: '#0b1e3a', fillOpacity: 1, renderer: L.canvas({ padding: 0.15, pane: 'lakesPane' }) },
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
    const states = L.geoJSON(withSeamWraps(props.states), {
      pane: 'statesPane',
      interactive: false,
      style: { color: '#0f172a', weight: 0.45, opacity: 0.28, fill: false, renderer: L.canvas({ padding: 0.15, pane: 'statesPane' }) },
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
    el.classList.toggle('wp-cursor-pin', props.interaction === 'pin')
    el.classList.toggle('wp-cursor-country', props.interaction === 'country')
  }, [props.interaction])

  useEffect(() => {
    const group = pinLayerRef.current
    group.clearLayers()
    for (const line of props.lines ?? []) {
      L.polyline([line.from, line.to], { color: line.color ?? '#fbbf24', weight: 2, dashArray: '4 4', pane: 'markerPane', interactive: false }).addTo(group)
    }
    for (const pin of props.pins ?? []) {
      L.marker([pin.lat, pin.lng], { icon: pinIcon(pin.kind, pin.color, pin.label), interactive: false }).addTo(group)
    }
  }, [props.pins, props.lines])

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
      const wraps = labelLng > 140 || labelLng < -140 ? [0, -360, 360] : [0]
      for (const dLng of wraps) {
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
      savedViewRef.current = { center: [c.lat, c.lng], zoom: map.getZoom() }
    }
    if (cmd.restore) {
      const saved = savedViewRef.current
      if (!saved) {
        finish()
        return
      }
      if (cmd.instant) {
        map.setView(saved.center, saved.zoom, { animate: false })
        finish()
        return
      }
      map.once('moveend', finish)
      map.flyTo(saved.center, saved.zoom, { duration: 0.85, easeLinearity: 0.16 })
      return
    }
    if (cmd.center && cmd.zoom != null) {
      if (cmd.instant) {
        map.setView(cmd.center, cmd.zoom, { animate: false })
        finish()
        return
      }
      map.once('moveend', finish)
      map.flyTo(cmd.center, cmd.zoom, { duration: 0.85, easeLinearity: 0.16 })
      return
    }
    if (!cmd.bbox) {
      finish()
      return
    }
    const [w, s, e, n] = cmd.bbox
    const bounds = L.latLngBounds([s, w], [n, e])
    const fit = map.getBoundsZoom(bounds, false, L.point(72, 200))
    const zoom = Math.max(map.getMinZoom(), Math.min(6, fit - 1))
    map.once('moveend', finish)
    map.flyTo(bounds.getCenter(), zoom, { animate: true, duration: 1.2, easeLinearity: 0.16 })
  }, [props.flyTo])

  return <div ref={containerRef} className="wp-map" tabIndex={0} />
}
