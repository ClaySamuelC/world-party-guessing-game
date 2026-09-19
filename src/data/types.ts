/** Shared data shapes written by scripts/build-data.ts and read by the app. */

export interface Endonym {
  text: string
  /** English name of the language, when we know it. */
  language: string | null
}

export interface Country {
  /** ISO 3166-1 alpha-2 (join key everywhere). */
  iso2: string
  iso3: string | null
  /** Usual English name (Unicode CLDR `en`). */
  exonymEn: string
  /** Name(s) in the country's official / primary language(s). */
  endonyms: Endonym[]
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
  /** Official / de-facto official languages per CLDR territoryInfo (CLDR codes + English names). */
  languages: CountryLanguage[]
}

export interface CountryLanguage {
  /** CLDR language code, e.g. "es", "zh_Hant", "pt". */
  code: string
  /** English display name from CLDR, when known. */
  name: string | null
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
  /** Small island / archipelago — draw a stronger outline. */
  island: boolean
  /** City-state or microstate — show a magnifier in country-click mode. */
  tiny: boolean
  /** Spread-out island group: water between islands should still hit this country. */
  archipelago: boolean
  /** Land polygon vs. the invisible convex hull used for archipelago hit-testing. */
  kind: 'land' | 'hull'
  labelLat: number
  labelLng: number
}

/** One sentence (UDHR Article 1) in a language, for the Language Sample mini-game. */
export interface LanguageSample {
  /** CLDR language code matching Country.languages[].code. */
  code: string
  name: string
  sample: string
  /** Text direction of the sample. */
  dir: 'ltr' | 'rtl'
  sourceUrl: string
  sourceLabel: string
}

/** A curated historical event with a place, for the Historical Pin mini-game. */
export interface HistoryEvent {
  id: string
  /** The question, e.g. "Pin where Columbus first landed in the Americas (1492)". */
  text: string
  /** Short name of the place shown on reveal. */
  name: string
  lat: number
  lng: number
  /** ISO2 of the country the place is in today, when applicable. */
  iso2: string | null
  sourceUrl: string
  sourceLabel: string
}

export interface SourcesManifest {
  generatedAt: string
  sources: { name: string; url: string; license: string; use: string }[]
  notes: string[]
}
