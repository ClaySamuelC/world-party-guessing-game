/** Shared data shapes written by scripts/build-data.ts and read by the app. */

export interface Country {
  /** ISO 3166-1 alpha-2 (join key everywhere). */
  iso2: string
  iso3: string | null
  /** Usual English name (Unicode CLDR `en`). */
  exonymEn: string
  /** Name(s) in the country's official / primary language(s). */
  endonyms: string[]
  /** Other names in circulation (alternate, former, formal). */
  alsoKnownAs: string[]
  /** Present when the name depends on who is recognising the entity. */
  nameNote?: string
  /** Capital(s) per Natural Earth populated places. */
  capitals: string[]
  population: number | null
  populationYear: number | null
  areaKm2: number | null
  areaSource: 'worldbank' | 'computed' | null
  region: string | null
  subregion: string | null
  /** [west, south, east, north] in degrees. */
  bbox: [number, number, number, number]
  unMember: boolean
}

export interface Place {
  id: string
  name: string
  iso2: string | null
  lat: number
  lng: number
  population: number | null
  capital: boolean
}

export interface CountryFeatureProps {
  iso2: string | null
  name: string
  playable: boolean
}

export interface SourcesManifest {
  generatedAt: string
  sources: { name: string; url: string; license: string; use: string }[]
  notes: string[]
}
