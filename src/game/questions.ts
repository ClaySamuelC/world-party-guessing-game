import type { Country, Place } from '../data/types'

export type QuestionType = 'click' | 'pin'
export type GameMode = 'click' | 'pin' | 'both'

export interface MatchSettings {
  mode: GameMode
  rounds: number
  /** Seconds per question. */
  timeLimit: number
}

export const DEFAULT_SETTINGS: MatchSettings = { mode: 'both', rounds: 10, timeLimit: 20 }
export const MAX_PLAYERS = 8
export const REVEAL_MS = 6000

/** What every player sees. Never contains the answer. */
export interface PublicQuestion {
  id: string
  type: QuestionType
  /** Main instruction, e.g. "Click Japan" or "Pin the capital of Kenya". */
  text: string
  /** Secondary hint text (e.g. the endonym being asked about). */
  hint?: string
  /** Raw SVG of a flag, when the prompt is a flag. Sent inline so the ISO code is not leaked. */
  flagSvg?: string
}

export type ClickAnswer = { iso2: string }
export type PinAnswer = { lat: number; lng: number }
export type Answer = ClickAnswer | PinAnswer

export interface ClickKey {
  type: 'click'
  iso2: string
}
export interface PinKey {
  type: 'pin'
  lat: number
  lng: number
  name: string
  iso2: string | null
}
export type AnswerKey = ClickKey | PinKey

/** Host-side question: public part plus the key. */
export interface FullQuestion {
  public: PublicQuestion
  key: AnswerKey
}

// ---- seeded RNG so a pack can be reproduced from its seed ----

export function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function shuffle<T>(arr: T[], rnd: () => number): T[] {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

type ClickPromptKind = 'name' | 'flag' | 'endonym' | 'capital'
type PinPromptKind = 'city' | 'capitalOf'

export interface PackInputs {
  countries: Country[]
  places: Place[]
  /** Loads the raw SVG for a flag; only needed on the host. */
  loadFlagSvg: (iso2: string) => Promise<string | null>
}

export async function generatePack(settings: MatchSettings, seed: number, inputs: PackInputs): Promise<FullQuestion[]> {
  const rnd = mulberry32(seed)
  const countries = shuffle(inputs.countries, rnd)
  const byIso = new Map(inputs.countries.map((c) => [c.iso2, c]))

  // Pin targets: capitals of playable countries plus big cities. Prefer capitals.
  const capitals = inputs.places.filter((p) => p.capital && p.iso2 && byIso.has(p.iso2))
  const bigCities = inputs.places.filter((p) => !p.capital && (p.population ?? 0) >= 2_000_000)
  const pinPool = shuffle([...capitals, ...capitals, ...bigCities], rnd)

  const types: QuestionType[] = []
  for (let i = 0; i < settings.rounds; i++) {
    types.push(settings.mode === 'both' ? (i % 2 === 0 ? 'click' : 'pin') : settings.mode)
  }

  const usedCountries = new Set<string>()
  const usedPlaces = new Set<string>()
  const pack: FullQuestion[] = []
  let ci = 0
  let pi = 0

  for (let i = 0; i < types.length; i++) {
    const id = `q${i + 1}-${Math.floor(rnd() * 1e9).toString(36)}`
    if (types[i] === 'click') {
      let country: Country | undefined
      while (ci < countries.length && (!country || usedCountries.has(country.iso2))) country = countries[ci++]
      if (!country) break
      usedCountries.add(country.iso2)
      const kinds: ClickPromptKind[] = ['name', 'flag', 'name']
      if (country.endonyms.length) kinds.push('endonym')
      if (country.capitals.length) kinds.push('capital')
      const kind = kinds[Math.floor(rnd() * kinds.length)]
      const pub: PublicQuestion = { id, type: 'click', text: '' }
      switch (kind) {
        case 'name':
          pub.text = `Click ${country.exonymEn}`
          break
        case 'flag': {
          const svg = await inputs.loadFlagSvg(country.iso2)
          if (svg) {
            pub.text = 'Click the country with this flag'
            pub.flagSvg = svg
          } else pub.text = `Click ${country.exonymEn}`
          break
        }
        case 'endonym': {
          const endonym = country.endonyms[Math.floor(rnd() * country.endonyms.length)]
          pub.text = 'Click the country known locally as'
          pub.hint = endonym
          break
        }
        case 'capital':
          pub.text = 'Click the country whose capital is'
          pub.hint = country.capitals[Math.floor(rnd() * country.capitals.length)]
          break
      }
      pack.push({ public: pub, key: { type: 'click', iso2: country.iso2 } })
    } else {
      let place: Place | undefined
      while (pi < pinPool.length && (!place || usedPlaces.has(place.id))) place = pinPool[pi++]
      if (!place) break
      usedPlaces.add(place.id)
      const country = place.iso2 ? byIso.get(place.iso2) : undefined
      const kind: PinPromptKind = place.capital && country && rnd() < 0.5 ? 'capitalOf' : 'city'
      const pub: PublicQuestion = { id, type: 'pin', text: '' }
      if (kind === 'capitalOf' && country) {
        pub.text = `Pin the capital of ${country.exonymEn}`
      } else {
        pub.text = `Pin ${place.name}`
        if (country) pub.hint = country.exonymEn
      }
      pack.push({ public: pub, key: { type: 'pin', lat: place.lat, lng: place.lng, name: place.name, iso2: place.iso2 } })
    }
  }
  return pack
}
