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
import type { Country, CountryFeatureProps, Place, SourcesManifest } from '../src/data/types.ts'

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
  unwpp: 'https://ourworldindata.org/grapher/population-unwpp.csv?v=1&csvType=full&useColumnShortNames=true',
  wbArea: 'https://api.worldbank.org/v2/country/all/indicator/AG.LND.TOTL.K2?format=json&per_page=400&mrnev=1',
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

  const [ne50Text, placesText, unwppText, wbText] = await Promise.all([
    fetchCached('ne_50m_admin_0_countries.geojson', SOURCES.ne50),
    fetchCached('ne_10m_populated_places_simple.geojson', SOURCES.places),
    fetchCached('population-unwpp.csv', SOURCES.unwpp),
    fetchCached('worldbank-land-area.json', SOURCES.wbArea),
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
      properties: { iso2, name: String(f.properties.NAME_LONG ?? f.properties.NAME), playable: !!iso2 && playable.has(iso2) },
      geometry: roundGeometry(f.geometry, 3),
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
        properties: { iso2, name: String(f.properties.NAME_LONG ?? f.properties.NAME), playable: true },
        geometry: roundGeometry(f.geometry, 4),
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

    const endonyms: string[] = []
    const addName = (list: string[], n?: string | null) => {
      if (!n) return
      const t = n.trim()
      if (!t || t === iso2 || t === exonymEn || list.includes(t)) return
      list.push(t)
    }
    for (const lang of officialLanguages(territoryInfo[iso2])) {
      if (endonyms.length >= MAX_ENDONYMS) break
      const names = await cldrTerritoryNamesFallback(lang.replace(/_/g, '-'))
      let name = names?.[iso2]
      if (!name) {
        const neField = lang === 'zh_Hant' ? 'NAME_ZHT' : `NAME_${lang.split('_')[0].toUpperCase()}`
        name = p[neField] ? String(p[neField]) : undefined
      }
      addName(endonyms, name)
    }
    for (const n of override.endonyms ?? []) addName(endonyms, n)

    const alsoKnownAs: string[] = []
    for (const key of [`${iso2}-alt-short`, `${iso2}-alt-variant`]) addName(alsoKnownAs, enNames[key])
    for (const n of override.alsoKnownAs ?? []) addName(alsoKnownAs, n)
    for (const n of [p.NAME_LONG, p.FORMAL_EN, p.NAME]) addName(alsoKnownAs, n ? String(n) : null)

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
    }
  }

  const manifest: SourcesManifest = {
    generatedAt: new Date().toISOString(),
    sources: [
      { name: 'Natural Earth 50m/10m Admin 0 Countries', url: 'https://www.naturalearthdata.com/', license: 'Public domain', use: 'Country polygons, UN region/subregion, fallback multilingual names (via Wikidata, CC0)' },
      { name: 'Natural Earth 10m Populated Places', url: 'https://www.naturalearthdata.com/', license: 'Public domain', use: 'Capitals and major cities for pin questions' },
      { name: 'Unicode CLDR', url: 'https://cldr.unicode.org/', license: 'Unicode License v3', use: 'English exonyms, endonyms per official language, UN member list, ISO alpha-3 codes' },
      { name: 'UN World Population Prospects', url: 'https://population.un.org/wpp/', license: 'CC BY 3.0 IGO', use: 'Population (latest estimate year), via Our World in Data CSV mirror' },
      { name: 'World Bank Open Data (AG.LND.TOTL.K2)', url: 'https://data.worldbank.org/indicator/AG.LND.TOTL.K2', license: 'CC BY 4.0', use: 'Land area in km²' },
      { name: 'flag-icons', url: 'https://github.com/lipis/flag-icons', license: 'MIT', use: 'Flag SVGs by ISO alpha-2' },
    ],
    notes: [
      'Playable set = UN member states (per CLDR territory containment) plus TW, XK, PS, VA.',
      'Where the World Bank has no land-area row, areaKm2 is computed from the Natural Earth polygon and marked areaSource=computed.',
      'Alternate and contested names come from scripts/name-overrides.ts and are best-effort, not a statement of recognition.',
    ],
  }

  const geojson: FeatureCollection<CountryFeatureProps> = { type: 'FeatureCollection', features: outFeatures }
  await writeFile(path.join(OUT_DIR, 'countries.geojson'), JSON.stringify(geojson))
  await writeFile(path.join(OUT_DIR, 'countries.json'), JSON.stringify(countries))
  await writeFile(path.join(OUT_DIR, 'places.json'), JSON.stringify(places))
  await writeFile(path.join(OUT_DIR, 'sources.json'), JSON.stringify(manifest, null, 2))

  const list = Object.values(countries)
  const noPop = list.filter((c) => c.population == null).map((c) => c.iso2)
  const computedArea = list.filter((c) => c.areaSource === 'computed').map((c) => c.iso2)
  const noCapital = list.filter((c) => !c.capitals.length).map((c) => c.iso2)
  const noEndonym = list.filter((c) => !c.endonyms.length).map((c) => c.iso2)
  console.log(`countries: ${list.length}, map features: ${outFeatures.length}, places: ${places.length}`)
  console.log(`no population: ${noPop.join(', ') || 'none'}`)
  console.log(`area computed from polygon: ${computedArea.join(', ') || 'none'}`)
  console.log(`no capital: ${noCapital.join(', ') || 'none'}`)
  console.log(`no endonym distinct from exonym: ${noEndonym.join(', ') || 'none'}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
