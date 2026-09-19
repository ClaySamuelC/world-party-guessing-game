import type { FeatureCollection, Geometry } from 'geojson'
import type { Country, CountryFeatureProps, HistoryEvent, LanguageSample, Place, SourcesManifest } from './types'

export interface Dataset {
  countries: Record<string, Country>
  countryList: Country[]
  places: Place[]
  languages: LanguageSample[]
  history: HistoryEvent[]
  geojson: FeatureCollection<Geometry, CountryFeatureProps>
  lakes: FeatureCollection<Geometry>
  states: FeatureCollection<Geometry>
  sources: SourcesManifest
}

let cached: Promise<Dataset> | null = null

async function getJson<T>(name: string): Promise<T> {
  const res = await fetch(`${import.meta.env.BASE_URL}data/${name}`)
  if (!res.ok) throw new Error(`Failed to load ${name} (${res.status})`)
  return res.json() as Promise<T>
}

/** Loads the bundled snapshot once and shares it across the app. */
export function loadDataset(): Promise<Dataset> {
  cached ??= (async () => {
    const [countries, places, geojson, lakes, states, languages, history, sources] = await Promise.all([
      getJson<Record<string, Country>>('countries.json'),
      getJson<Place[]>('places.json'),
      getJson<FeatureCollection<Geometry, CountryFeatureProps>>('countries.geojson'),
      getJson<FeatureCollection<Geometry>>('lakes.geojson'),
      getJson<FeatureCollection<Geometry>>('states.geojson'),
      getJson<LanguageSample[]>('languages.json'),
      getJson<HistoryEvent[]>('history.json'),
      getJson<SourcesManifest>('sources.json'),
    ])
    const countryList = Object.values(countries).sort((a, b) => a.exonymEn.localeCompare(b.exonymEn))
    return { countries, countryList, places, geojson, lakes, states, languages, history, sources }
  })()
  return cached
}

export function formatNumber(n: number | null): string {
  return n == null ? 'n/a' : n.toLocaleString('en-US')
}

export function formatArea(km2: number | null): string {
  if (km2 == null) return 'n/a'
  const mi2 = km2 * 0.386102
  const fmt = (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: v < 100 ? 1 : 0 })
  return `${fmt(km2)} km² (${fmt(mi2)} mi²)`
}
