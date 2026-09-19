import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useEffect, useLayoutEffect, useRef } from 'react'
import type { FeatureCollection, Geometry } from 'geojson'
import type { CountryFeatureProps } from '../data/types'
import './map.css'

export type CountryRole = 'selected' | 'correct' | 'wrong'

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
  /** 'country' = polygons clickable; 'pin' = clicks fall through to the map; 'none' = read-only. */
  interaction: 'country' | 'pin' | 'none'
  roles?: Record<string, CountryRole>
  pins?: MapPin[]
  /** Straight line from my pin to the target after a reveal. */
  lines?: { from: [number, number]; to: [number, number]; color?: string }[]
  /** Change the value to fly the map to a bbox [w, s, e, n]. */
  flyTo?: { bbox: [number, number, number, number]; nonce: number } | null
  onCountryClick?: (iso2: string) => void
  onMapClick?: (lat: number, lng: number) => void
  onHover?: (iso2: string | null) => void
}

const BASE_STYLE: L.PathOptions = { color: '#0f172a', weight: 0.6, fillColor: '#94a3b8', fillOpacity: 1 }
const NON_PLAYABLE_STYLE: L.PathOptions = { ...BASE_STYLE, fillColor: '#64748b' }
const ROLE_STYLE: Record<CountryRole, L.PathOptions> = {
  selected: { fillColor: '#fbbf24', color: '#78350f', weight: 1.5 },
  correct: { fillColor: '#4ade80', color: '#14532d', weight: 1.5 },
  wrong: { fillColor: '#f87171', color: '#7f1d1d', weight: 1.5 },
}

function styleFor(props: CountryFeatureProps, role: CountryRole | undefined, hovered: boolean): L.PathOptions {
  const base = props.playable ? BASE_STYLE : NON_PLAYABLE_STYLE
  const withRole = role ? { ...base, ...ROLE_STYLE[role] } : base
  return hovered && props.playable && !role ? { ...withRole, fillColor: '#cbd5e1', weight: 1.2 } : withRole
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

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!)
}

export function WorldMap(props: WorldMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const layerRef = useRef<L.GeoJSON<CountryFeatureProps> | null>(null)
  const pinLayerRef = useRef<L.LayerGroup>(new L.LayerGroup())
  const hoveredRef = useRef<string | null>(null)
  const propsRef = useRef(props)
  useLayoutEffect(() => {
    propsRef.current = props
  })

  // Create the map once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const map = L.map(containerRef.current, {
      zoomControl: true,
      attributionControl: false,
      minZoom: 2,
      maxZoom: 9,
      worldCopyJump: false,
      maxBounds: [
        [-85, -200],
        [85, 200],
      ],
      maxBoundsViscosity: 1,
      zoomSnap: 0.5,
    })
    map.setView([20, 10], 2)
    map.on('click', (e) => {
      const p = propsRef.current
      if (p.interaction === 'pin') p.onMapClick?.(e.latlng.lat, e.latlng.lng)
    })
    pinLayerRef.current.addTo(map)
    mapRef.current = map
    // Fit to the container after first layout.
    setTimeout(() => map.invalidateSize(), 0)
    const ro = new ResizeObserver(() => map.invalidateSize())
    ro.observe(containerRef.current)
    return () => {
      ro.disconnect()
      map.remove()
      mapRef.current = null
    }
  }, [])

  // Country layer: rebuilt only when the geojson object changes.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    layerRef.current?.remove()
    const layer = L.geoJSON<CountryFeatureProps>(props.geojson, {
      style: (f) => styleFor(f!.properties, undefined, false),
      onEachFeature: (feature, lyr) => {
        const iso2 = feature.properties.iso2
        const path = lyr as L.Path
        lyr.on('mouseover', () => {
          const p = propsRef.current
          if (p.interaction !== 'country' || !iso2 || !feature.properties.playable) return
          hoveredRef.current = iso2
          path.setStyle(styleFor(feature.properties, p.roles?.[iso2], true))
          path.bringToFront()
          p.onHover?.(iso2)
        })
        lyr.on('mouseout', () => {
          const p = propsRef.current
          hoveredRef.current = null
          path.setStyle(styleFor(feature.properties, iso2 ? p.roles?.[iso2] : undefined, false))
          p.onHover?.(null)
        })
        lyr.on('click', (e) => {
          const p = propsRef.current
          if (p.interaction === 'pin') {
            p.onMapClick?.(e.latlng.lat, e.latlng.lng)
            return
          }
          if (p.interaction === 'country' && iso2 && feature.properties.playable) {
            L.DomEvent.stopPropagation(e)
            p.onCountryClick?.(iso2)
          }
        })
      },
    })
    layer.addTo(map)
    // Keep pins above the polygons by using a dedicated pane.
    layerRef.current = layer
  }, [props.geojson])

  // Restyle when roles change.
  useEffect(() => {
    const layer = layerRef.current
    if (!layer) return
    layer.eachLayer((lyr) => {
      const feature = (lyr as L.Path & { feature: GeoJSON.Feature<Geometry, CountryFeatureProps> }).feature
      const iso2 = feature.properties.iso2
      const role = iso2 ? props.roles?.[iso2] : undefined
      ;(lyr as L.Path).setStyle(styleFor(feature.properties, role, hoveredRef.current === iso2))
      if (role) (lyr as L.Path).bringToFront()
    })
  }, [props.roles])

  // Cursor hint per interaction mode.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    el.classList.toggle('wp-cursor-pin', props.interaction === 'pin')
    el.classList.toggle('wp-cursor-country', props.interaction === 'country')
  }, [props.interaction])

  // Pins and lines.
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

  // Fly to a bbox on request.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !props.flyTo) return
    const [w, s, e, n] = props.flyTo.bbox
    map.flyToBounds(
      [
        [s, w],
        [n, e],
      ],
      { maxZoom: 9, padding: [40, 40], duration: 0.8 },
    )
  }, [props.flyTo])

  return <div ref={containerRef} className="wp-map" />
}
