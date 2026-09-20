import type { Country, Place } from '../data/types'

/** Must stay in sync with STREAK_LENGTH in questions.ts. */
const TOP_N = 5

export interface StreakList {
  id: string
  title: string
  /** Phrase used in miss feedback: "Greece ranks #85 by land area". */
  metric: string
  value: (c: Country) => number | null
  format: (v: number) => string
  /** Sort descending (true) or ascending (false). */
  desc: boolean
  /** When set, only these countries are on the list. */
  include?: (c: Country) => boolean
  /** Miss copy when the guess is outside the set, e.g. "in Africa". */
  outsideLabel?: string
  /** Geographic scope to frame on the map. Language-based lists are worldwide and omit this. */
  region?: { label: string }
}

export type RankInfo = { rank: number; value: string; total: number } | { outside: true }

const fmtPeople = (v: number) => (v >= 1e9 ? `${(v / 1e9).toFixed(2)} billion` : v >= 1e6 ? `${(v / 1e6).toFixed(1)} million` : v.toLocaleString('en-US'))
const fmtArea = (v: number) => `${Math.round(v).toLocaleString('en-US')} km²`
const fmtDensity = (v: number) => `${Math.round(v).toLocaleString('en-US')} / km²`
const fmtLat = (v: number) => `${Math.abs(v).toFixed(1)}°${v >= 0 ? 'N' : 'S'}`
const fmtCount = (v: number) => String(Math.round(v))
const fmtLetters = (v: number) => `${Math.round(v)} letters`

function density(c: Country): number | null {
  if (c.population == null || c.areaKm2 == null || c.areaKm2 <= 0) return null
  return c.population / c.areaKm2
}

function northLat(c: Country) {
  return c.bbox[3]
}

function southLat(c: Country) {
  return c.bbox[1]
}

/** Main official language only — CLDR also lists regional languages, which make noisy top-5s. */
function primaryLang(code: string) {
  return (c: Country) => {
    const first = c.languages[0]
    return !!first && (first.code === code || first.code.startsWith(`${code}_`))
  }
}

function langCount(c: Country) {
  const seen = new Set<string>()
  for (const l of c.languages) seen.add(l.code.split('_')[0] ?? l.code)
  return seen.size || null
}

function longestCapitalName(c: Country) {
  if (!c.capitals.length) return null
  return Math.max(...c.capitals.map((n) => n.length))
}

function capitalPop(places: Place[]) {
  const best = new Map<string, number>()
  for (const p of places) {
    if (!p.capital || !p.iso2 || p.population == null) continue
    const prev = best.get(p.iso2)
    if (prev == null || p.population > prev) best.set(p.iso2, p.population)
  }
  return (c: Country) => best.get(c.iso2) ?? null
}

const REGIONS: { id: string; name: string; in: string; match: (c: Country) => boolean }[] = [
  { id: 'africa', name: 'Africa', in: 'in Africa', match: (c) => c.region === 'Africa' },
  { id: 'americas', name: 'the Americas', in: 'in the Americas', match: (c) => c.region === 'Americas' },
  { id: 'asia', name: 'Asia', in: 'in Asia', match: (c) => c.region === 'Asia' },
  { id: 'europe', name: 'Europe', in: 'in Europe', match: (c) => c.region === 'Europe' },
  { id: 'oceania', name: 'Oceania', in: 'in Oceania', match: (c) => c.region === 'Oceania' },
]

const SUBREGIONS: { id: string; name: string; in: string; match: (c: Country) => boolean }[] = [
  { id: 'w-africa', name: 'West Africa', in: 'in West Africa', match: (c) => c.subregion === 'Western Africa' },
  { id: 'e-africa', name: 'East Africa', in: 'in East Africa', match: (c) => c.subregion === 'Eastern Africa' },
  { id: 'mid-africa', name: 'Central Africa', in: 'in Central Africa', match: (c) => c.subregion === 'Middle Africa' },
  { id: 'n-africa', name: 'North Africa', in: 'in North Africa', match: (c) => c.subregion === 'Northern Africa' },
  { id: 'w-asia', name: 'Western Asia', in: 'in Western Asia', match: (c) => c.subregion === 'Western Asia' },
  { id: 's-asia', name: 'South Asia', in: 'in South Asia', match: (c) => c.subregion === 'Southern Asia' },
  { id: 'se-asia', name: 'Southeast Asia', in: 'in Southeast Asia', match: (c) => c.subregion === 'South-Eastern Asia' },
  { id: 's-europe', name: 'Southern Europe', in: 'in Southern Europe', match: (c) => c.subregion === 'Southern Europe' },
  { id: 'w-europe', name: 'Western Europe', in: 'in Western Europe', match: (c) => c.subregion === 'Western Europe' },
  { id: 'e-europe', name: 'Eastern Europe', in: 'in Eastern Europe', match: (c) => c.subregion === 'Eastern Europe' },
  { id: 'n-europe', name: 'Northern Europe', in: 'in Northern Europe', match: (c) => c.subregion === 'Northern Europe' },
  { id: 'caribbean', name: 'the Caribbean', in: 'in the Caribbean', match: (c) => c.subregion === 'Caribbean' },
  { id: 's-america', name: 'South America', in: 'in South America', match: (c) => c.subregion === 'South America' },
  { id: 'c-america', name: 'Central America', in: 'in Central America', match: (c) => c.subregion === 'Central America' },
]

const LANGS: { code: string; name: string }[] = [
  { code: 'es', name: 'Spanish' },
  { code: 'fr', name: 'French' },
  { code: 'ar', name: 'Arabic' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'en', name: 'English' },
  { code: 'de', name: 'German' },
]

/** Every ranked list the pack can deal. Filtered to those with a clean top-N. */
export function streakLists(countries: Country[], places: Place[]): StreakList[] {
  const capPop = capitalPop(places)
  const all: StreakList[] = [
    { id: 'pop-desc', title: 'most populous countries', metric: 'by population', value: (c) => c.population, format: fmtPeople, desc: true },
    { id: 'pop-asc', title: 'least populous countries', metric: 'by population (smallest first)', value: (c) => c.population, format: fmtPeople, desc: false },
    { id: 'area-desc', title: 'largest countries by land area', metric: 'by land area', value: (c) => c.areaKm2, format: fmtArea, desc: true },
    { id: 'area-asc', title: 'smallest countries by land area', metric: 'by land area (smallest first)', value: (c) => c.areaKm2, format: fmtArea, desc: false },
    { id: 'density-desc', title: 'most densely populated countries', metric: 'by population density', value: density, format: fmtDensity, desc: true },
    { id: 'density-asc', title: 'least densely populated countries', metric: 'by population density (lowest first)', value: density, format: fmtDensity, desc: false },
    { id: 'north', title: 'northernmost countries', metric: 'by northernmost latitude', value: northLat, format: fmtLat, desc: true },
    { id: 'south', title: 'southernmost countries', metric: 'by southernmost latitude', value: southLat, format: fmtLat, desc: false },
    { id: 'name-long', title: 'countries with the longest English names', metric: 'by English name length', value: (c) => c.exonymEn.length, format: fmtLetters, desc: true },
    { id: 'cap-name-long', title: 'countries with the longest capital names', metric: 'by capital-name length', value: longestCapitalName, format: fmtLetters, desc: true },
    { id: 'lang-count', title: 'countries with the most official languages', metric: 'by number of official languages', value: langCount, format: fmtCount, desc: true },
    { id: 'cap-pop', title: 'countries with the largest capital cities', metric: 'by capital-city population', value: capPop, format: fmtPeople, desc: true },
    {
      id: 'pop-small-area',
      title: 'most populous countries smaller than 50,000 km²',
      metric: 'by population among countries under 50,000 km²',
      value: (c) => c.population,
      format: fmtPeople,
      desc: true,
      include: (c) => c.areaKm2 != null && c.areaKm2 < 50_000,
      outsideLabel: 'smaller than 50,000 km²',
    },
    {
      id: 'area-low-pop',
      title: 'largest countries by land area with under 10 million people',
      metric: 'by land area among countries under 10 million people',
      value: (c) => c.areaKm2,
      format: fmtArea,
      desc: true,
      include: (c) => c.population != null && c.population < 10_000_000,
      outsideLabel: 'a country with under 10 million people',
    },
  ]

  for (const r of REGIONS) {
    const region = { label: r.name }
    all.push(
      { id: `pop-${r.id}`, title: `most populous countries in ${r.name}`, metric: `by population ${r.in}`, value: (c) => c.population, format: fmtPeople, desc: true, include: r.match, outsideLabel: r.in, region },
      { id: `area-${r.id}`, title: `largest countries by land area in ${r.name}`, metric: `by land area ${r.in}`, value: (c) => c.areaKm2, format: fmtArea, desc: true, include: r.match, outsideLabel: r.in, region },
      { id: `pop-asc-${r.id}`, title: `least populous countries in ${r.name}`, metric: `by population (smallest first) ${r.in}`, value: (c) => c.population, format: fmtPeople, desc: false, include: r.match, outsideLabel: r.in, region },
      { id: `area-asc-${r.id}`, title: `smallest countries by land area in ${r.name}`, metric: `by land area (smallest first) ${r.in}`, value: (c) => c.areaKm2, format: fmtArea, desc: false, include: r.match, outsideLabel: r.in, region },
    )
  }

  for (const r of SUBREGIONS) {
    const region = { label: r.name }
    all.push(
      { id: `pop-${r.id}`, title: `most populous countries in ${r.name}`, metric: `by population ${r.in}`, value: (c) => c.population, format: fmtPeople, desc: true, include: r.match, outsideLabel: r.in, region },
      { id: `area-${r.id}`, title: `largest countries by land area in ${r.name}`, metric: `by land area ${r.in}`, value: (c) => c.areaKm2, format: fmtArea, desc: true, include: r.match, outsideLabel: r.in, region },
    )
  }

  for (const lang of LANGS) {
    const match = primaryLang(lang.code)
    all.push({
      id: `pop-lang-${lang.code}`,
      title: `most populous countries whose main official language is ${lang.name}`,
      metric: `by population among ${lang.name}-speaking countries`,
      value: (c) => c.population,
      format: fmtPeople,
      desc: true,
      include: match,
      outsideLabel: `a country whose main official language is ${lang.name}`,
    })
  }

  return all.filter((list) => usable(list, countries))
}

/** Countries in a geographically scoped list, for framing the map. */
export function listRegion(list: StreakList, countries: Country[]): { label: string; iso2s: string[] } | null {
  if (!list.region || !list.include) return null
  const iso2s = countries.filter(list.include).map((c) => c.iso2)
  return iso2s.length ? { label: list.region.label, iso2s } : null
}

export function findStreakList(id: string, countries: Country[], places: Place[]): StreakList | undefined {
  return streakLists(countries, places).find((l) => l.id === id)
}

export function rankedCountries(list: StreakList, countries: Country[], n: number): { iso2s: string[]; values: string[] } {
  const rows = sortByList(list, countries).slice(0, n)
  return { iso2s: rows.map((r) => r.c.iso2), values: rows.map((r) => list.format(r.v)) }
}

export function sortByList(list: StreakList, countries: Country[]) {
  return countries
    .filter((c) => !list.include || list.include(c))
    .map((c) => ({ c, v: list.value(c) }))
    .filter((r): r is { c: Country; v: number } => r.v != null)
    .sort((a, b) => {
      const d = list.desc ? b.v - a.v : a.v - b.v
      return d !== 0 ? d : a.c.iso2.localeCompare(b.c.iso2)
    })
}

/** Rank of a country on a streak list, or `outside` if it does not belong. */
export function countryRankOnList(list: StreakList, countries: Country[], iso2: string): RankInfo | null {
  const country = countries.find((c) => c.iso2 === iso2)
  if (!country) return null
  if (list.include && !list.include(country)) return { outside: true }
  if (list.value(country) == null) return { outside: true }
  const rows = sortByList(list, countries)
  const i = rows.findIndex((r) => r.c.iso2 === iso2)
  if (i < 0) return { outside: true }
  return { rank: i + 1, value: list.format(rows[i]!.v), total: rows.length }
}

function usable(list: StreakList, countries: Country[]) {
  const rows = sortByList(list, countries)
  if (rows.length < TOP_N) return false
  const cut = rows[TOP_N - 1]
  const next = rows[TOP_N]
  return !cut || !next || cut.v !== next.v
}
