/**
 * Builds the bundled data snapshot in public/data/.
 *
 *   npm run data            # uses cached downloads in .cache/data when present
 *   npm run data -- --fresh # re-download everything
 *
 * Sources (all public domain or intergovernmental open data, no state factbooks):
 *   - Natural Earth 50m admin-0 countries (polygons), 10m for microstates missing at 50m
 *   - Natural Earth 10m populated places (capitals, major cities)
 *   - Unicode CLDR (English exonyms, endonyms per official language, UN member list, ISO alpha-3)
 *   - UN World Population Prospects (via Our World in Data CSV mirror)
 *   - World Bank AG.LND.TOTL.K2 (land area, km²)
 */
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { NAME_OVERRIDES } from './name-overrides.ts'
import type { Country, CountryFeatureProps, CountryLanguage, Endonym, HistoryEvent, LanguageSample, Place, SourcesManifest } from '../src/data/types.ts'
import { HISTORY_EVENTS } from './history-events.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CACHE_DIR = path.join(ROOT, '.cache', 'data')
const OUT_DIR = path.join(ROOT, 'public', 'data')
const NODE_MODULES = path.join(ROOT, 'node_modules')
const FRESH = process.argv.includes('--fresh')

const NE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/'
const SOURCES = {
  ne50: NE + 'ne_50m_admin_0_countries.geojson',
  ne10: NE + 'ne_10m_admin_0_countries.geojson',
  places: NE + 'ne_10m_populated_places_simple.geojson',
  lakes: NE + 'ne_50m_lakes.geojson',
  states: NE + 'ne_50m_admin_1_states_provinces_lines.geojson',
  unwpp: 'https://ourworldindata.org/grapher/population-unwpp.csv?v=1&csvType=full&useColumnShortNames=true',
  wbArea: 'https://api.worldbank.org/v2/country/all/indicator/AG.LND.TOTL.K2?format=json&per_page=400&mrnev=1',
  udhr: 'https://raw.githubusercontent.com/eric-muller/udhr/main/data/udhr/',
}

/**
 * CLDR language code -> "UDHR in XML" translation key. Only languages that end up as an
 * official language of some playable country are fetched.
 */
const UDHR_KEYS: Record<string, string> = {
  en: 'eng', es: 'spa', fr: 'fra', de: 'deu_1996', pt: 'por_PT', it: 'ita', nl: 'nld', ru: 'rus', pl: 'pol', uk: 'ukr',
  cs: 'ces', sv: 'swe', da: 'dan', nb: 'nob', no: 'nob', nn: 'nno', fi: 'fin', hu: 'hun', ro: 'ron_2006', el: 'ell_monotonic',
  tr: 'tur', ar: 'arb', he: 'heb', fa: 'pes_1', hi: 'hin', bn: 'ben', ur: 'urd', zh: 'cmn_hans', zh_Hant: 'cmn_hant', ja: 'jpn',
  ko: 'kor', vi: 'vie', th: 'tha', id: 'ind', ms: 'mly_latn', sw: 'swh', am: 'amh', fil: 'tgl', mn: 'khk', ka: 'kat', hy: 'hye',
  is: 'isl', ne: 'nep', si: 'sin', my: 'mya', km: 'khm', lo: 'lao', kk: 'kaz', uz: 'uzn_latn', az: 'azj_latn', et: 'est',
  lv: 'lav', lt: 'lit', sk: 'slk', sl: 'slv', hr: 'hrv', sr: 'srp_cyrl', bs: 'bos_latn', bg: 'bul', sq: 'als', mk: 'mkd',
  so: 'som', af: 'afr', mt: 'mlt', lb: 'ltz', ps: 'pbu', tg: 'tgk', ky: 'kir', tk: 'tuk_latn', be: 'bel', ca: 'cat', ga: 'gle',
  dz: 'dzo', rw: 'kin', rn: 'run', sn: 'sna', ny: 'nya_chechewa', ln: 'lin', ti: 'tir', ha: 'hau_3', yo: 'yor', ig: 'ibo',
  zu: 'zul', xh: 'xho', st: 'sot', tn: 'tsn', ss: 'ssw', ay: 'ayr', qu: 'quz', gn: 'gug', ht: 'hat_popular', to: 'ton',
  sm: 'smo', fj: 'fij', bi: 'bis', tpi: 'tpi', mi: 'mri', mh: 'mah', pau: 'pau', ch: 'cha', dv: 'div', sg: 'sag', ab: 'abk',
  ku: 'kmr', fo: 'fao', kl: 'kal', ml: 'mal', cy: 'cym', eu: 'eus', nr: 'nbl', ts: 'tso_MZ', ve: 'ven', wo: 'wol', kg: 'kng',
  niu: 'niu', tet: 'tdt',
}
const RTL_LANGS = new Set(['ar', 'he', 'fa', 'ur', 'ps', 'dv', 'ku'])

function decodeXml(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

/** Article 1 of the UDHR in the given translation, or null if the file lacks it. */
async function udhrArticle1(key: string): Promise<string | null> {
  let xml: string
  try {
    xml = await fetchCached(`udhr_${key}.xml`, `${SOURCES.udhr}udhr_${key}.xml`)
  } catch {
    return null
  }
  const article = xml.match(/<article[^>]*number=["']1["'][^>]*>([\s\S]*?)<\/article>/)
  if (!article) return null
  const para = article[1].match(/<para[^>]*>([\s\S]*?)<\/para>/)
  if (!para) return null
  const text = decodeXml(para[1].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim()
  return text.length >= 20 ? text : null
}

/** Non-UN entities that are still playable. */
const EXTRA_PLAYABLE = ['TW', 'XK', 'PS', 'VA']
/** Codes used by data providers that differ from ISO. */
const PROVIDER_CODE_TO_ISO2: Record<string, string> = { OWID_KOS: 'XK', XKX: 'XK' }
const MAX_ENDONYMS = 4

// ---------- small helpers ----------

async function fetchCached(name: string, url: string): Promise<string> {
  const file = path.join(CACHE_DIR, name)
  if (!FRESH && existsSync(file)) return readFile(file, 'utf8')
  process.stdout.write(`downloading ${name} ... `)
  const res = await fetch(url, { headers: { 'User-Agent': 'world-party-guessing-game data build' } })
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`)
  const text = await res.text()
  await mkdir(CACHE_DIR, { recursive: true })
  await writeFile(file, text)
  console.log(`${(text.length / 1e6).toFixed(1)} MB`)
  return text
}

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, 'utf8')) as T
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else quoted = false
      } else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += c
  }
  if (field.length || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

type Ring = number[][]
type Geometry =
  | { type: 'Polygon'; coordinates: Ring[] }
  | { type: 'MultiPolygon'; coordinates: Ring[][] }
interface Feature<P = Record<string, unknown>> {
  type: 'Feature'
  properties: P
  geometry: Geometry
}
interface FeatureCollection<P = Record<string, unknown>> {
  type: 'FeatureCollection'
  features: Feature<P>[]
}

const EARTH_RADIUS_M = 6378137
const rad = (d: number) => (d * Math.PI) / 180

/** Spherical ring area (Chamberlain & Duquette), in m². */
function ringArea(ring: Ring): number {
  const n = ring.length
  if (n < 3) return 0
  let total = 0
  for (let i = 0; i < n; i++) {
    const lower = ring[i]
    const middle = ring[(i + 1) % n]
    const upper = ring[(i + 2) % n]
    total += (rad(upper[0]) - rad(lower[0])) * Math.sin(rad(middle[1]))
  }
  return Math.abs((total * EARTH_RADIUS_M * EARTH_RADIUS_M) / 2)
}

function polygonAreaKm2(polys: Ring[][]): number {
  let m2 = 0
  for (const poly of polys) {
    if (!poly.length) continue
    m2 += ringArea(poly[0])
    for (let i = 1; i < poly.length; i++) m2 -= ringArea(poly[i])
  }
  return m2 / 1e6
}

function polygons(geom: Geometry): Ring[][] {
  return geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates
}

function bboxOf(geom: Geometry): [number, number, number, number] {
  let w = 180, s = 90, e = -180, n = -90
  for (const poly of polygons(geom))
    for (const ring of poly)
      for (const [x, y] of ring) {
        if (x < w) w = x
        if (x > e) e = x
        if (y < s) s = y
        if (y > n) n = y
      }
  return [w, s, e, n]
}

/** Douglas–Peucker on one ring/line; keeps endpoints. */
function simplifyRing(ring: Ring, tol: number): Ring {
  if (ring.length <= 4) return ring
  const keep = new Uint8Array(ring.length)
  keep[0] = 1
  keep[ring.length - 1] = 1
  const stack: [number, number][] = [[0, ring.length - 1]]
  const tol2 = tol * tol
  while (stack.length) {
    const [a, b] = stack.pop()!
    if (b - a < 2) continue
    const [ax, ay] = ring[a]
    const [bx, by] = ring[b]
    const dx = bx - ax
    const dy = by - ay
    const len2 = dx * dx + dy * dy
    let maxD = -1
    let maxI = -1
    for (let i = a + 1; i < b; i++) {
      const [px, py] = ring[i]
      let d2: number
      if (len2 === 0) d2 = (px - ax) ** 2 + (py - ay) ** 2
      else {
        let t = ((px - ax) * dx + (py - ay) * dy) / len2
        t = t < 0 ? 0 : t > 1 ? 1 : t
        d2 = (px - (ax + t * dx)) ** 2 + (py - (ay + t * dy)) ** 2
      }
      if (d2 > maxD) {
        maxD = d2
        maxI = i
      }
    }
    if (maxD > tol2) {
      keep[maxI] = 1
      stack.push([a, maxI], [maxI, b])
    }
  }
  const out: Ring = []
  for (let i = 0; i < ring.length; i++) if (keep[i]) out.push(ring[i])
  return out
}

/** Simplify polygons for rendering; tiny polygons that collapse are dropped. */
function simplifyGeometry(geom: Geometry, tol: number): Geometry {
  const poly = (rings: Ring[]): Ring[] | null => {
    const out: Ring[] = []
    for (let i = 0; i < rings.length; i++) {
      const s = simplifyRing(rings[i], tol)
      if (s.length >= 4) out.push(s)
      else if (i === 0) return null
    }
    return out.length ? out : null
  }
  if (geom.type === 'Polygon') {
    const p = poly(geom.coordinates)
    return p ? { type: 'Polygon', coordinates: p } : geom
  }
  const polys: Ring[][] = []
  for (const p of geom.coordinates) {
    const s = poly(p)
    if (s) polys.push(s)
  }
  return polys.length ? { type: 'MultiPolygon', coordinates: polys } : geom
}

function simplifyLines(geom: unknown, tol: number): unknown {
  const g = geom as { type: string; coordinates: unknown }
  if (g.type === 'LineString') return { type: 'LineString', coordinates: simplifyRing(g.coordinates as Ring, tol) }
  if (g.type === 'MultiLineString') return { type: 'MultiLineString', coordinates: (g.coordinates as Ring[]).map((l) => simplifyRing(l, tol)) }
  return geom
}

function roundGeometry(geom: Geometry, decimals: number): Geometry {
  const f = 10 ** decimals
  const r = (v: number) => Math.round(v * f) / f
  const ring = (rg: Ring) => rg.map(([x, y]) => [r(x), r(y)])
  return geom.type === 'Polygon'
    ? { type: 'Polygon', coordinates: geom.coordinates.map(ring) }
    : { type: 'MultiPolygon', coordinates: geom.coordinates.map((p) => p.map(ring)) }
}

const isoOf = (p: Record<string, unknown>): string | null => {
  const v = String(p.ISO_A2_EH ?? p.ISO_A2 ?? '-99')
  return /^[A-Z]{2}$/.test(v) ? v : null
}

// ---------- CLDR ----------

interface CldrTerritories {
  main: Record<string, { localeDisplayNames: { territories: Record<string, string> } }>
}

const territoryNameCache = new Map<string, Record<string, string> | null>()
async function cldrTerritoryNames(locale: string): Promise<Record<string, string> | null> {
  if (territoryNameCache.has(locale)) return territoryNameCache.get(locale)!
  const file = path.join(NODE_MODULES, 'cldr-localenames-full', 'main', locale, 'territories.json')
  let result: Record<string, string> | null = null
  if (existsSync(file)) {
    const json = await readJson<CldrTerritories>(file)
    result = json.main[locale]?.localeDisplayNames.territories ?? null
  }
  territoryNameCache.set(locale, result)
  return result
}

/** Try `zh-Hant-TW`, then `zh-Hant`, then `zh`. */
async function cldrTerritoryNamesFallback(locale: string) {
  const parts = locale.split('-')
  while (parts.length) {
    const names = await cldrTerritoryNames(parts.join('-'))
    if (names) return names
    parts.pop()
  }
  return null
}

interface TerritoryInfo {
  supplemental: {
    territoryInfo: Record<
      string,
      { languagePopulation?: Record<string, { _populationPercent: string; _officialStatus?: string }> }
    >
  }
}

function featureProps(iso2: string | null, name: string, playable: boolean, geom: Geometry): CountryFeatureProps {
  const [w, s, e, n] = bboxOf(geom)
  return { iso2, name, playable, island: false, tiny: false, archipelago: false, kind: 'land', labelLat: (s + n) / 2, labelLng: (w + e) / 2 }
}

function convexHull(points: [number, number][]): [number, number][] {
  const pts = points
    .slice()
    .sort((a, b) => a[0] - b[0] || a[1] - b[1])
    .filter((p, i, a) => i === 0 || p[0] !== a[i - 1][0] || p[1] !== a[i - 1][1])
  if (pts.length < 3) return pts
  const cross = (o: [number, number], a: [number, number], b: [number, number]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lower: [number, number][] = []
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop()
    lower.push(p)
  }
  const upper: [number, number][] = []
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop()
    upper.push(p)
  }
  lower.pop()
  upper.pop()
  return lower.concat(upper)
}

function wrapLngAround(lng: number, center: number) {
  let d = lng - center
  while (d > 180) d -= 360
  while (d < -180) d += 360
  return center + d
}

/** Convex hull around every island so water between them still belongs to the country. */
function hullGeometry(geom: Geometry): Geometry | null {
  const polys = polygons(geom)
  if (polys.length < 2) return null
  const raw: [number, number][] = []
  for (const poly of polys) {
    for (const pt of poly[0] ?? []) raw.push([pt[0], pt[1]])
  }
  if (raw.length < 3) return null
  const cx = raw[0][0]
  const wrapped = raw.map(([x, y]) => [wrapLngAround(x, cx), y] as [number, number])
  const hull = convexHull(wrapped)
  if (hull.length < 3) return null
  return { type: 'Polygon', coordinates: [[...hull, hull[0]]] }
}

let languageNames: Record<string, string> | null = null
async function englishLanguageName(code: string): Promise<string | null> {
  if (!languageNames) {
    const file = path.join(NODE_MODULES, 'cldr-localenames-full', 'main', 'en', 'languages.json')
    const json = await readJson<{ main: { en: { localeDisplayNames: { languages: Record<string, string> } } } }>(file)
    languageNames = json.main.en.localeDisplayNames.languages
  }
  const key = code.replace(/_/g, '-')
  const parts = key.split('-')
  while (parts.length) {
    const name = languageNames[parts.join('-')]
    if (name && !name.startsWith('Unknown')) return name
    parts.pop()
  }
  return languageNames[code] ?? null
}

function officialLanguages(info: TerritoryInfo['supplemental']['territoryInfo'][string] | undefined): string[] {
  const langs = Object.entries(info?.languagePopulation ?? {})
  const ranked = (filter: (s?: string) => boolean) =>
    langs
      .filter(([, v]) => filter(v._officialStatus))
      .sort((a, b) => Number(b[1]._populationPercent) - Number(a[1]._populationPercent))
      .map(([k]) => k)
  // National official languages first, then regionally official ones (e.g. Zulu in ZA).
  const official = ranked((s) => s === 'official' || s === 'de_facto_official')
  const regional = ranked((s) => s === 'official_regional')
  if (official.length || regional.length) return [...official, ...regional]
  return ranked(() => true).slice(0, 1)
}

// ---------- main ----------

async function main() {
  await mkdir(OUT_DIR, { recursive: true })

  const [ne50Text, placesText, unwppText, wbText, lakesText, statesText] = await Promise.all([
    fetchCached('ne_50m_admin_0_countries.geojson', SOURCES.ne50),
    fetchCached('ne_10m_populated_places_simple.geojson', SOURCES.places),
    fetchCached('population-unwpp.csv', SOURCES.unwpp),
    fetchCached('worldbank-land-area.json', SOURCES.wbArea),
    fetchCached('ne_50m_lakes.geojson', SOURCES.lakes),
    fetchCached('ne_50m_admin_1_states_provinces_lines.geojson', SOURCES.states),
  ])
  const ne50 = JSON.parse(ne50Text) as FeatureCollection
  const placesFc = JSON.parse(placesText) as { features: { properties: Record<string, unknown> }[] }

  // CLDR supplemental data
  const containment = await readJson<{ supplemental: { territoryContainment: Record<string, { _contains: string[] }> } }>(
    path.join(NODE_MODULES, 'cldr-core', 'supplemental', 'territoryContainment.json'),
  )
  const unMembers = new Set(containment.supplemental.territoryContainment.UN._contains)
  const territoryInfo = (await readJson<TerritoryInfo>(path.join(NODE_MODULES, 'cldr-core', 'supplemental', 'territoryInfo.json')))
    .supplemental.territoryInfo
  const codeMappings = (
    await readJson<{ supplemental: { codeMappings: Record<string, { _alpha3?: string }> } }>(
      path.join(NODE_MODULES, 'cldr-core', 'supplemental', 'codeMappings.json'),
    )
  ).supplemental.codeMappings
  const iso3ToIso2 = new Map<string, string>()
  for (const [iso2, m] of Object.entries(codeMappings)) if (m._alpha3) iso3ToIso2.set(m._alpha3, iso2)
  const enNames = (await cldrTerritoryNames('en'))!

  const playable = new Set<string>([...unMembers, ...EXTRA_PLAYABLE])

  // ---- polygons: 50m, supplemented from 10m for playable codes missing at 50m ----
  const featuresByIso = new Map<string, Feature>()
  const outFeatures: Feature<CountryFeatureProps>[] = []
  for (const f of ne50.features) {
    const iso2 = isoOf(f.properties)
    if (iso2 && !featuresByIso.has(iso2)) featuresByIso.set(iso2, f)
    outFeatures.push({
      type: 'Feature',
      properties: featureProps(iso2, String(f.properties.NAME_LONG ?? f.properties.NAME), !!iso2 && playable.has(iso2), f.geometry),
      geometry: roundGeometry(simplifyGeometry(f.geometry, 0.0045), 3),
    })
  }
  const missing = [...playable].filter((c) => !featuresByIso.has(c))
  const ne10ByIso = new Map<string, Feature>()
  if (missing.length) {
    console.log(`missing at 50m, pulling from 10m: ${missing.join(', ')}`)
    const ne10 = JSON.parse(await fetchCached('ne_10m_admin_0_countries.geojson', SOURCES.ne10)) as FeatureCollection
    for (const f of ne10.features) {
      const iso2 = isoOf(f.properties)
      if (iso2 && !ne10ByIso.has(iso2)) ne10ByIso.set(iso2, f)
    }
    for (const iso2 of missing) {
      const f = ne10ByIso.get(iso2)
      if (!f) {
        console.warn(`  ! ${iso2} not found in Natural Earth 10m either`)
        continue
      }
      featuresByIso.set(iso2, f)
      outFeatures.push({
        type: 'Feature',
        properties: featureProps(iso2, String(f.properties.NAME_LONG ?? f.properties.NAME), true, f.geometry),
        geometry: roundGeometry(simplifyGeometry(f.geometry, 0.0008), 4),
      })
    }
  }
  const adm0ToIso2 = new Map<string, string>()
  for (const [iso2, f] of featuresByIso) adm0ToIso2.set(String(f.properties.ADM0_A3), iso2)

  // ---- places ----
  const places: Place[] = []
  const capitalsByIso = new Map<string, string[]>()
  const seenPlace = new Set<string>()
  for (const { properties: p } of placesFc.features) {
    const fcla = String(p.featurecla ?? '')
    const isCapital = fcla === 'Admin-0 capital' || fcla === 'Admin-0 capital alt' || Number(p.adm0cap) === 1
    const pop = p.pop_max != null ? Number(p.pop_max) : null
    const scalerank = Number(p.scalerank ?? 99)
    if (!isCapital && !(scalerank <= 2 || (pop ?? 0) >= 2_000_000)) continue
    const rawIso = String(p.iso_a2 ?? '')
    const iso2 = /^[A-Z]{2}$/.test(rawIso) ? rawIso : (adm0ToIso2.get(String(p.adm0_a3)) ?? null)
    const name = String(p.name)
    const key = `${name}|${iso2}`
    if (seenPlace.has(key)) continue
    seenPlace.add(key)
    places.push({
      id: `${iso2 ?? 'XX'}-${name}`.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      name,
      iso2,
      lat: Number(p.latitude),
      lng: Number(p.longitude),
      population: pop,
      capital: isCapital,
    })
    if (isCapital && iso2 && fcla !== 'Admin-0 capital alt') {
      const list = capitalsByIso.get(iso2) ?? []
      if (!list.includes(name)) list.push(name)
      capitalsByIso.set(iso2, list)
    }
  }

  // ---- population (UN WPP via OWID) ----
  const popRows = parseCsv(unwppText)
  const header = popRows[0].map((h) => h.toLowerCase())
  const codeIdx = header.indexOf('code')
  const yearIdx = header.indexOf('year')
  const popIdx = header.findIndex((h) => h.startsWith('population'))
  if (codeIdx < 0 || yearIdx < 0 || popIdx < 0) throw new Error(`Unexpected UN WPP CSV header: ${header.join(',')}`)
  const currentYear = new Date().getFullYear()
  const population = new Map<string, { value: number; year: number }>()
  for (const row of popRows.slice(1)) {
    const code = row[codeIdx]
    const iso2 = PROVIDER_CODE_TO_ISO2[code] ?? iso3ToIso2.get(code)
    const year = Number(row[yearIdx])
    const value = Number(row[popIdx])
    if (!iso2 || !Number.isFinite(value) || !value || year > currentYear) continue
    const prev = population.get(iso2)
    if (!prev || year > prev.year) population.set(iso2, { value, year })
  }

  // ---- land area (World Bank) ----
  const wb = JSON.parse(wbText) as [unknown, { countryiso3code: string; value: number | null; date: string }[]]
  const area = new Map<string, number>()
  for (const r of wb[1] ?? []) {
    const iso2 = PROVIDER_CODE_TO_ISO2[r.countryiso3code] ?? iso3ToIso2.get(r.countryiso3code)
    if (iso2 && r.value != null) area.set(iso2, r.value)
  }

  // ---- assemble countries ----
  const countries: Record<string, Country> = {}
  for (const iso2 of [...playable].sort()) {
    const f = featuresByIso.get(iso2)
    if (!f) continue
    const p = f.properties
    const exonymEn = enNames[iso2] ?? String(p.NAME_LONG ?? p.NAME)
    const override = NAME_OVERRIDES[iso2] ?? {}

    const endonyms: Endonym[] = []
    const languages: CountryLanguage[] = []
    const addEndonym = (text?: string | null, language?: string | null) => {
      if (!text) return
      const t = text.trim()
      if (!t || t === iso2 || t === exonymEn || endonyms.some((e) => e.text === t)) return
      endonyms.push({ text: t, language: language ?? null })
    }
    const addAlias = (list: string[], n?: string | null) => {
      if (!n) return
      const t = n.trim()
      if (!t || t === iso2 || t === exonymEn || list.includes(t)) return
      list.push(t)
    }
    for (const lang of officialLanguages(territoryInfo[iso2])) {
      const langName = await englishLanguageName(lang)
      if (!languages.some((l) => l.code === lang)) languages.push({ code: lang, name: langName })
      if (endonyms.length >= MAX_ENDONYMS) continue
      const names = await cldrTerritoryNamesFallback(lang.replace(/_/g, '-'))
      let name = names?.[iso2]
      if (!name) {
        const neField = lang === 'zh_Hant' ? 'NAME_ZHT' : `NAME_${lang.split('_')[0].toUpperCase()}`
        name = p[neField] ? String(p[neField]) : undefined
      }
      addEndonym(name, langName)
    }
    for (const n of override.endonyms ?? []) addEndonym(n.text, n.language ?? null)

    const alsoKnownAs: string[] = []
    for (const key of [`${iso2}-alt-short`, `${iso2}-alt-variant`]) addAlias(alsoKnownAs, enNames[key])
    for (const n of override.alsoKnownAs ?? []) addAlias(alsoKnownAs, n)
    for (const n of [p.NAME_LONG, p.FORMAL_EN, p.NAME]) addAlias(alsoKnownAs, n ? String(n) : null)

    const wbArea = area.get(iso2)
    const pop = population.get(iso2)
    const rawArea = wbArea ?? polygonAreaKm2(polygons((ne10ByIso.get(iso2) ?? f).geometry))
    const areaKm2 = rawArea < 100 ? Math.round(rawArea * 10) / 10 : Math.round(rawArea)
    countries[iso2] = {
      iso2,
      iso3: codeMappings[iso2]?._alpha3 ?? (typeof p.ISO_A3_EH === 'string' && /^[A-Z]{3}$/.test(p.ISO_A3_EH) ? p.ISO_A3_EH : null),
      exonymEn,
      endonyms,
      alsoKnownAs,
      ...(override.nameNote ? { nameNote: override.nameNote } : {}),
      capitals: capitalsByIso.get(iso2) ?? [],
      population: pop?.value ?? null,
      populationYear: pop?.year ?? null,
      areaKm2,
      areaSource: wbArea != null ? 'worldbank' : 'computed',
      region: p.REGION_UN ? String(p.REGION_UN) : null,
      subregion: p.SUBREGION ? String(p.SUBREGION) : null,
      bbox: bboxOf(f.geometry),
      unMember: unMembers.has(iso2),
      languages,
    }
  }

  const manifest: SourcesManifest = {
    generatedAt: new Date().toISOString(),
    sources: [
      { name: 'Natural Earth 50m/10m Admin 0 Countries', url: 'https://www.naturalearthdata.com/', license: 'Public domain', use: 'Country polygons, UN region/subregion, fallback multilingual names (via Wikidata, CC0)' },
      { name: 'Natural Earth 10m Populated Places', url: 'https://www.naturalearthdata.com/', license: 'Public domain', use: 'Capitals and major cities for pin questions' },
      { name: 'Natural Earth 50m Lakes', url: 'https://www.naturalearthdata.com/', license: 'Public domain', use: 'Inland water (Great Lakes, Victoria, Caspian, and other major lakes)' },
      { name: 'Natural Earth 50m Admin 1 states/provinces (lines)', url: 'https://www.naturalearthdata.com/', license: 'Public domain', use: 'Subtle internal outlines for USA, Canada, Mexico, India, and the UK' },
      { name: 'Unicode CLDR', url: 'https://cldr.unicode.org/', license: 'Unicode License v3', use: 'English exonyms, endonyms per official language, UN member list, ISO alpha-3 codes' },
      { name: 'UN World Population Prospects', url: 'https://population.un.org/wpp/', license: 'CC BY 3.0 IGO', use: 'Population (latest estimate year), via Our World in Data CSV mirror' },
      { name: 'World Bank Open Data (AG.LND.TOTL.K2)', url: 'https://data.worldbank.org/indicator/AG.LND.TOTL.K2', license: 'CC BY 4.0', use: 'Land area in km²' },
      { name: 'flag-icons', url: 'https://github.com/lipis/flag-icons', license: 'MIT', use: 'Flag SVGs by ISO alpha-2' },
      { name: 'UDHR in XML (Universal Declaration of Human Rights translations)', url: 'https://efele.net/udhr/', license: 'Public domain (UN text)', use: 'Article 1 in each official language for the Language Sample game; language ↔ country via CLDR official-language data' },
      { name: 'Wikipedia', url: 'https://en.wikipedia.org/', license: 'CC BY-SA 4.0', use: 'Reference link for each hand-written Historical Pin question (scripts/history-events.ts)' },
    ],
    notes: [
      'Historical Pin questions are written by the project and link to a Wikipedia article for context; coordinates are approximate to the named site.',
      'Playable set = UN member states (per CLDR territory containment) plus TW, XK, PS, VA.',
      'Where the World Bank has no land-area row, areaKm2 is computed from the Natural Earth polygon and marked areaSource=computed.',
      'Alternate and contested names come from scripts/name-overrides.ts and are best-effort, not a statement of recognition.',
    ],
  }

  const ALWAYS_TINY = new Set(['VA', 'MC', 'SM', 'SG', 'LI', 'AD', 'MT', 'BH', 'NR', 'TV', 'PW', 'MH', 'KI', 'TO', 'WS'])
  const NO_HULL = new Set(['ID', 'PH', 'JP', 'NZ', 'PG', 'AU', 'CU', 'MG', 'GB', 'US', 'CA', 'MX', 'IN', 'BR', 'CN', 'RU'])
  const hullFeatures: Feature<CountryFeatureProps>[] = []
  for (const feat of outFeatures) {
    const iso2 = feat.properties.iso2
    const c = iso2 ? countries[iso2] : undefined
    const src = iso2 ? featuresByIso.get(iso2) : undefined
    const sub = String(src?.properties.SUBREGION ?? c?.subregion ?? '')
    const continent = String(src?.properties.CONTINENT ?? '')
    const [w, s, e, n] = feat.properties.iso2 && c ? c.bbox : [feat.properties.labelLng, feat.properties.labelLat, feat.properties.labelLng, feat.properties.labelLat]
    const span = Math.max(e - w, n - s)
    const oceaniaIsland = continent === 'Oceania' && iso2 !== 'AU' && iso2 !== 'PG'
    const smallSea = /Polynesia|Micronesia|Caribbean/.test(sub) || (sub.includes('Melanesia') && iso2 !== 'PG')
    const tiny =
      !!c &&
      (ALWAYS_TINY.has(c.iso2) ||
        (c.areaKm2 != null && c.areaKm2 < 1000) ||
        ((oceaniaIsland || smallSea) && span < 3.5 && (c.areaKm2 == null || c.areaKm2 < 8000)))
    const island = tiny || oceaniaIsland || (smallSea && (c == null || c.areaKm2 == null || c.areaKm2 < 20000))
    const polyCount = polygons(feat.geometry).length
    const archipelago =
      !!iso2 &&
      feat.properties.playable &&
      island &&
      polyCount >= 2 &&
      !NO_HULL.has(iso2) &&
      (tiny || oceaniaIsland || smallSea || (c?.areaKm2 != null && c.areaKm2 < 20000))
    feat.properties.tiny = tiny
    feat.properties.island = island
    feat.properties.archipelago = archipelago
    feat.properties.kind = 'land'
    feat.properties.labelLat = (s + n) / 2
    feat.properties.labelLng = (w + e) / 2
    if (archipelago) {
      const hull = hullGeometry(feat.geometry)
      if (hull) {
        hullFeatures.push({
          type: 'Feature',
          properties: { ...feat.properties, kind: 'hull', tiny: false },
          geometry: roundGeometry(hull, 3),
        })
      }
    }
  }
  outFeatures.push(...hullFeatures)

  const lakesIn = JSON.parse(lakesText) as FeatureCollection
  const lakes: FeatureCollection = {
    type: 'FeatureCollection',
    features: lakesIn.features.map((f) => ({
      type: 'Feature' as const,
      properties: {},
      geometry: roundGeometry(simplifyGeometry(f.geometry, 0.006), 3),
    })),
  }

  const STATE_ISO2 = new Set(['US', 'CA', 'MX', 'IN', 'GB'])
  const STATE_ADM0 = new Set(['USA', 'CAN', 'MEX', 'IND', 'GBR'])
  const statesIn = JSON.parse(statesText) as FeatureCollection
  const states: FeatureCollection = {
    type: 'FeatureCollection',
    features: statesIn.features
      .filter((f) => {
        const p = f.properties
        const iso = String(p.iso_a2 ?? p.ISO_A2 ?? '')
        const adm0 = String(p.adm0_a3 ?? p.ADM0_A3 ?? '')
        return STATE_ISO2.has(iso) || STATE_ADM0.has(adm0)
      })
      .map((f) => ({
        type: 'Feature' as const,
        properties: {},
        geometry: simplifyLines(f.geometry, 0.006) as Geometry,
      })),
  }

  // Language samples: one UDHR Article 1 line per official language we have a translation for.
  const languageCodes = new Set<string>()
  for (const c of Object.values(countries)) for (const l of c.languages) languageCodes.add(l.code)
  const languageSamples: LanguageSample[] = []
  const missingSamples: string[] = []
  for (const code of [...languageCodes].sort()) {
    const key = UDHR_KEYS[code] ?? UDHR_KEYS[code.split('_')[0]]
    const sample = key ? await udhrArticle1(key) : null
    if (!sample) {
      missingSamples.push(code)
      continue
    }
    const name = (await englishLanguageName(code)) ?? code
    languageSamples.push({
      code,
      name,
      sample,
      dir: RTL_LANGS.has(code.split('_')[0]) ? 'rtl' : 'ltr',
      sourceUrl: `https://efele.net/udhr/d/udhr_${key}.html`,
      sourceLabel: `UDHR Article 1 · ${name} (UDHR in XML)`,
    })
  }

  const history: HistoryEvent[] = HISTORY_EVENTS.map((e) => ({ ...e, iso2: e.iso2 ?? null }))
  const badHistory = history.filter((e) => e.iso2 && !countries[e.iso2]).map((e) => e.id)
  if (badHistory.length) throw new Error(`history events with unknown iso2: ${badHistory.join(', ')}`)

  const geojson: FeatureCollection<CountryFeatureProps> = { type: 'FeatureCollection', features: outFeatures }
  await writeFile(path.join(OUT_DIR, 'languages.json'), JSON.stringify(languageSamples))
  await writeFile(path.join(OUT_DIR, 'history.json'), JSON.stringify(history))
  await writeFile(path.join(OUT_DIR, 'countries.geojson'), JSON.stringify(geojson))
  await writeFile(path.join(OUT_DIR, 'countries.json'), JSON.stringify(countries))
  await writeFile(path.join(OUT_DIR, 'places.json'), JSON.stringify(places))
  await writeFile(path.join(OUT_DIR, 'lakes.geojson'), JSON.stringify(lakes))
  await writeFile(path.join(OUT_DIR, 'states.geojson'), JSON.stringify(states))
  await writeFile(path.join(OUT_DIR, 'sources.json'), JSON.stringify(manifest, null, 2))

  const list = Object.values(countries)
  const noPop = list.filter((c) => c.population == null).map((c) => c.iso2)
  const computedArea = list.filter((c) => c.areaSource === 'computed').map((c) => c.iso2)
  const noCapital = list.filter((c) => !c.capitals.length).map((c) => c.iso2)
  const noEndonym = list.filter((c) => !c.endonyms.length).map((c) => c.iso2)
  console.log(
    `countries: ${list.length}, map features: ${outFeatures.length}, hulls: ${hullFeatures.length}, places: ${places.length}, lakes: ${lakes.features.length}, states: ${states.features.length}`,
  )
  console.log(`no population: ${noPop.join(', ') || 'none'}`)
  console.log(`area computed from polygon: ${computedArea.join(', ') || 'none'}`)
  console.log(`no capital: ${noCapital.join(', ') || 'none'}`)
  console.log(`no endonym distinct from exonym: ${noEndonym.join(', ') || 'none'}`)
  console.log(`language samples: ${languageSamples.length}, history events: ${history.length}`)
  console.log(`official languages without a UDHR sample: ${missingSamples.join(', ') || 'none'}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
