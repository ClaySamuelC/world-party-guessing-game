import { formatEndonym } from '../data/names'
import type { Country, HistoryEvent, LanguageSample, Place } from '../data/types'

/** Every mini-game in the party pack. */
export type MiniGameId = 'click' | 'pin' | 'language' | 'history' | 'bid' | 'streak'

export interface MiniGameInfo {
  id: MiniGameId
  name: string
  blurb: string
}

export const MINI_GAMES: MiniGameInfo[] = [
  { id: 'click', name: 'Country click', blurb: 'Click the country from its name, flag, or capital.' },
  { id: 'pin', name: 'Pin the location', blurb: 'Drop a pin on a capital or major city. Closer is better.' },
  { id: 'language', name: 'Language sample', blurb: 'Read a sentence, click any country where that language is official.' },
  { id: 'history', name: 'Historical pin', blurb: 'Pin where a historical event happened. Source shown after.' },
  { id: 'bid', name: 'Bid and guess', blurb: 'Bid how many countries in a category you can click, then deliver.' },
  { id: 'streak', name: 'Guessing streak', blurb: 'Find the top countries in any order. Three strikes and you are out.' },
]

export const ALL_MINI_GAMES: MiniGameId[] = MINI_GAMES.map((g) => g.id)

export interface MatchSettings {
  /** Which mini-games are in the rotation. At least one. */
  types: MiniGameId[]
  rounds: number
  /** Keep dealing questions until the host ends the match. */
  endless: boolean
  /** Seconds per question (per turn for Guessing Streak, per phase for Bid and Guess). */
  timeLimit: number
}

export const DEFAULT_SETTINGS: MatchSettings = { types: ALL_MINI_GAMES.slice(), rounds: 10, endless: false, timeLimit: 20 }
/** How many questions to pre-generate at a time in endless mode. */
export const ENDLESS_BATCH = 16
export const MAX_PLAYERS = 8
export const REVEAL_MS = 6000
/** Seconds players get to enter a bid. */
export const BID_SECONDS = 12
/** Extra collect time per country bid, so bigger bids are feasible. */
export const BID_SECONDS_PER_COUNTRY = 2
/** How many ranks a Guessing Streak question asks for. */
export const STREAK_LENGTH = 5
/** Wrong clicks allowed before a player is out of a Guessing Streak. */
export const STREAK_STRIKES = 3

/** Sanitise a settings patch from the lobby. */
export function normalizeSettings(s: MatchSettings): MatchSettings {
  const types = ALL_MINI_GAMES.filter((t) => s.types.includes(t))
  return { ...s, types: types.length ? types : ['click'] }
}

/** What every player sees. Never contains the answer. */
export interface PublicQuestion {
  id: string
  type: MiniGameId
  /** Main instruction, e.g. "Click Japan" or "Pin the capital of Kenya". */
  text: string
  /** Secondary hint that is part of the ask (e.g. a capital name). */
  hint?: string
  /** Local names shown under an English country name — never the thing being guessed. */
  localNames?: string[]
  /** Raw SVG of a flag, when the prompt is a flag. Sent inline so the ISO code is not leaked. */
  flagSvg?: string
  /** Language sample: the sentence to show, plus its direction. */
  sample?: { text: string; dir: 'ltr' | 'rtl' }
  /** Guessing streak: how many ranks are asked for. */
  count?: number
}

export type ClickAnswer = { iso2: string }
export type PinAnswer = { lat: number; lng: number }
export type BidAnswer = { bid: number }
/** Result-only answer for multi-pick games: what the player actually collected. */
export type SetAnswer = { iso2s: string[]; bid?: number }
export type Answer = ClickAnswer | PinAnswer | BidAnswer | SetAnswer

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
  id: string
  sourceUrl?: string
  sourceLabel?: string
}
/** Any of these countries is a correct answer (language, bid). */
export interface SetKey {
  type: 'set'
  iso2s: string[]
  /** Human label of the set, e.g. "Spanish" or "Countries starting with A". */
  title: string
  sourceUrl?: string
  sourceLabel?: string
}
/** Top-N set for Guessing Streak: iso2s[0] is rank 1, but picks may be in any order. */
export interface RankedKey {
  type: 'ranked'
  iso2s: string[]
  /** Formatted value per rank, e.g. "1.43 billion". */
  values: string[]
  title: string
  /** STREAK_LISTS id — host uses it to rank a wrong guess. */
  listId: string
  /** Short label for miss feedback, e.g. "by land area". */
  metric: string
}
export type AnswerKey = ClickKey | PinKey | SetKey | RankedKey

/** Host-side question: public part plus the key. */
export interface FullQuestion {
  public: PublicQuestion
  key: AnswerKey
  /** Stable id of the prompt (language code, event id, category…) so the host avoids repeats. */
  promptId?: string
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

type ClickPromptKind = 'name' | 'flag' | 'capital'
type PinPromptKind = 'city' | 'capitalOf'

export interface PackInputs {
  countries: Country[]
  places: Place[]
  languages: LanguageSample[]
  history: HistoryEvent[]
  /** Loads the raw SVG for a flag; only needed on the host. */
  loadFlagSvg: (iso2: string) => Promise<string | null>
}

export interface PackOptions {
  count?: number
  avoidCountries?: Set<string>
  avoidPlaces?: Set<string>
  /** Ids of language / history / bid / streak prompts already used this match. */
  avoidPrompts?: Set<string>
}

// ---- category catalogue for Bid and Guess ----

export interface BidCategory {
  id: string
  title: string
  members: (c: Country) => boolean
}

/**
 * Bid categories that cannot be solved by painting a continent. Whole UN regions (Americas,
 * Africa, …) are intentionally excluded — those are trivial once you know the map.
 */
export function bidCategories(countries: Country[]): BidCategory[] {
  const cats: BidCategory[] = []
  const sized = (id: string, title: string, members: (c: Country) => boolean, min = 4, max = 18) => {
    const n = countries.filter(members).length
    if (n >= min && n <= max) cats.push({ id, title, members })
  }

  // Name trivia — you need the list, not the map shape.
  for (const letter of 'BCDFGHJKLMNPRSTVWZ'.split('')) {
    sized(`letter-${letter}`, `whose English name starts with "${letter}"`, (c) => c.exonymEn.toUpperCase().startsWith(letter))
  }
  sized('ends-stan', 'whose English name ends in "-stan"', (c) => /stan$/i.test(c.exonymEn))
  sized('ends-land', 'whose English name ends in "land"', (c) => /land$/i.test(c.exonymEn))
  sized('ends-ia', 'whose English name ends in "ia"', (c) => /ia$/i.test(c.exonymEn), 6, 30)
  sized('contains-new', 'whose English name contains "New"', (c) => /\bNew\b/.test(c.exonymEn))
  sized('double-letter', 'whose English name has a double letter (aa, bb, …)', (c) => /(.)\1/i.test(c.exonymEn.replace(/[^a-z]/gi, '')), 5, 40)
  sized('one-word', 'with a one-word English name of 4 letters or fewer', (c) => !/\s/.test(c.exonymEn) && c.exonymEn.length <= 4)
  sized('capital-A', 'whose capital starts with "A"', (c) => c.capitals.some((cap) => cap.toUpperCase().startsWith('A')))
  sized('capital-B', 'whose capital starts with "B"', (c) => c.capitals.some((cap) => cap.toUpperCase().startsWith('B')))
  sized('capital-K', 'whose capital starts with "K"', (c) => c.capitals.some((cap) => cap.toUpperCase().startsWith('K')))
  sized('capital-S', 'whose capital starts with "S"', (c) => c.capitals.some((cap) => cap.toUpperCase().startsWith('S')))

  // Facts you cannot read off the outline alone.
  sized('pop100m', 'with more than 100 million people', (c) => (c.population ?? 0) >= 100_000_000, 4, 20)
  sized('pop-under-1m', 'with fewer than 1 million people', (c) => c.population != null && c.population < 1_000_000, 8, 40)
  sized('pop-10-30m', 'with between 10 and 30 million people', (c) => {
    const p = c.population
    return p != null && p >= 10_000_000 && p < 30_000_000
  }, 8, 40)
  sized('area-1m', 'larger than 1 million km²', (c) => (c.areaKm2 ?? 0) >= 1_000_000, 4, 20)
  sized('area-under-50k', 'smaller than 50,000 km²', (c) => c.areaKm2 != null && c.areaKm2 < 50_000, 8, 50)

  for (const [code, name] of [
    ['es', 'Spanish'],
    ['fr', 'French'],
    ['ar', 'Arabic'],
    ['pt', 'Portuguese'],
    ['de', 'German'],
  ] as const) {
    sized(`lang-${code}`, `where ${name} is an official language`, (c) => c.languages.some((l) => l.code === code), 4, 28)
  }
  return cats
}

// ---- ranked lists for Guessing Streak ----

export interface StreakList {
  id: string
  title: string
  /** Phrase used in miss feedback: "Greece ranks #85 by land area". */
  metric: string
  value: (c: Country) => number | null
  format: (v: number) => string
  /** Sort descending (true) or ascending (false). */
  desc: boolean
}

const fmtPeople = (v: number) => (v >= 1e9 ? `${(v / 1e9).toFixed(2)} billion` : v >= 1e6 ? `${(v / 1e6).toFixed(1)} million` : v.toLocaleString('en-US'))
const fmtArea = (v: number) => `${Math.round(v).toLocaleString('en-US')} km²`

export const STREAK_LISTS: StreakList[] = [
  { id: 'pop-desc', title: 'most populous countries', metric: 'by population', value: (c) => c.population, format: fmtPeople, desc: true },
  { id: 'area-desc', title: 'largest countries by land area', metric: 'by land area', value: (c) => c.areaKm2, format: fmtArea, desc: true },
  { id: 'area-asc', title: 'smallest countries by land area', metric: 'by land area (smallest first)', value: (c) => c.areaKm2, format: fmtArea, desc: false },
  { id: 'pop-asc', title: 'least populous countries', metric: 'by population (smallest first)', value: (c) => c.population, format: fmtPeople, desc: false },
]

export function rankedCountries(list: StreakList, countries: Country[], n: number): { iso2s: string[]; values: string[] } {
  const rows = sortByList(list, countries).slice(0, n)
  return { iso2s: rows.map((r) => r.c.iso2), values: rows.map((r) => list.format(r.v)) }
}

function sortByList(list: StreakList, countries: Country[]) {
  return countries
    .map((c) => ({ c, v: list.value(c) }))
    .filter((r): r is { c: Country; v: number } => r.v != null)
    .sort((a, b) => (list.desc ? b.v - a.v : a.v - b.v))
}

/** 1-based rank of a country on a streak list, for miss feedback. */
export function countryRankOnList(list: StreakList, countries: Country[], iso2: string): { rank: number; value: string; total: number } | null {
  const rows = sortByList(list, countries)
  const i = rows.findIndex((r) => r.c.iso2 === iso2)
  if (i < 0) return null
  return { rank: i + 1, value: list.format(rows[i].v), total: rows.length }
}

// ---- pack generation ----

export async function generatePack(
  settings: MatchSettings,
  seed: number,
  inputs: PackInputs,
  options: PackOptions = {},
): Promise<FullQuestion[]> {
  const rnd = mulberry32(seed)
  const count = options.count ?? (settings.endless ? ENDLESS_BATCH : settings.rounds)
  const countries = shuffle(inputs.countries, rnd)
  const byIso = new Map(inputs.countries.map((c) => [c.iso2, c]))
  const enabled = settings.types.length ? settings.types : ['click' as MiniGameId]

  // Pin targets: capitals of playable countries plus big cities. Prefer capitals.
  const capitals = inputs.places.filter((p) => p.capital && p.iso2 && byIso.has(p.iso2))
  const bigCities = inputs.places.filter((p) => !p.capital && (p.population ?? 0) >= 2_000_000)
  const pinPool = shuffle([...capitals, ...capitals, ...bigCities], rnd)

  const usedCountries = new Set(options.avoidCountries)
  const usedPlaces = new Set(options.avoidPlaces)
  const usedPrompts = new Set(options.avoidPrompts)

  // Language pool: languages with a sample and at least one playable country. Favour languages
  // spoken in few countries (harder, more interesting) but keep the big ones in the mix.
  const langPool: { sample: LanguageSample; iso2s: string[] }[] = []
  for (const sample of inputs.languages) {
    const iso2s = inputs.countries.filter((c) => c.languages.some((l) => l.code === sample.code)).map((c) => c.iso2)
    if (!iso2s.length || sample.code === 'en') continue
    langPool.push({ sample, iso2s })
    if (iso2s.length <= 3) langPool.push({ sample, iso2s })
  }
  const langs = shuffle(langPool, rnd)
  const history = shuffle(inputs.history, rnd)
  const cats = shuffle(bidCategories(inputs.countries), rnd)
  const lists = shuffle(STREAK_LISTS, rnd)

  // Rotate through enabled types in a shuffled order so no two consecutive questions repeat a type
  // when several are enabled.
  const order = shuffle(enabled, rnd)
  const types: MiniGameId[] = []
  for (let i = 0; i < count; i++) types.push(order[i % order.length])

  const pack: FullQuestion[] = []
  let ci = 0
  let pi = 0

  const nextCountry = (): Country | undefined => {
    for (let n = 0; n < countries.length * 2; n++) {
      if (ci >= countries.length) {
        usedCountries.clear()
        ci = 0
      }
      const country = countries[ci++]
      if (country && !usedCountries.has(country.iso2)) return country
    }
    return countries[0]
  }
  const nextPlace = (): Place | undefined => {
    for (let n = 0; n < pinPool.length * 2; n++) {
      if (pi >= pinPool.length) {
        usedPlaces.clear()
        pi = 0
      }
      const place = pinPool[pi++]
      if (place && !usedPlaces.has(place.id)) return place
    }
    return pinPool[0]
  }
  /** Generic cursor over a shuffled pool with an id, skipping ones used this match. */
  const nextFrom = <T>(pool: T[], cursor: { i: number }, idOf: (t: T) => string): T | undefined => {
    if (!pool.length) return undefined
    for (let n = 0; n < pool.length * 2; n++) {
      if (cursor.i >= pool.length) cursor.i = 0
      const item = pool[cursor.i++]
      if (item && !usedPrompts.has(idOf(item))) return item
      if (n === pool.length) for (const p of pool) usedPrompts.delete(idOf(p))
    }
    return pool[0]
  }
  const lc = { i: 0 }
  const hc = { i: 0 }
  const bc = { i: 0 }
  const sc = { i: 0 }

  for (let i = 0; i < types.length; i++) {
    const id = `q${i + 1}-${Math.floor(rnd() * 1e9).toString(36)}`
    const type = types[i]
    if (type === 'click') {
      const country = nextCountry()
      if (!country) continue
      usedCountries.add(country.iso2)
      const kinds: ClickPromptKind[] = ['name', 'flag', 'name']
      if (country.capitals.length) kinds.push('capital')
      const kind = kinds[Math.floor(rnd() * kinds.length)]
      const pub: PublicQuestion = { id, type: 'click', text: '' }
      switch (kind) {
        case 'name':
          pub.text = `Click ${country.exonymEn}`
          if (country.endonyms.length) pub.localNames = country.endonyms.map(formatEndonym)
          break
        case 'flag': {
          const svg = await inputs.loadFlagSvg(country.iso2)
          if (svg) {
            pub.text = 'Click the country with this flag'
            pub.flagSvg = svg
          } else {
            pub.text = `Click ${country.exonymEn}`
            if (country.endonyms.length) pub.localNames = country.endonyms.map(formatEndonym)
          }
          break
        }
        case 'capital':
          pub.text = 'Click the country whose capital is'
          pub.hint = country.capitals[Math.floor(rnd() * country.capitals.length)]
          break
      }
      pack.push({ public: pub, key: { type: 'click', iso2: country.iso2 } })
    } else if (type === 'pin') {
      const place = nextPlace()
      if (!place) continue
      usedPlaces.add(place.id)
      const country = place.iso2 ? byIso.get(place.iso2) : undefined
      const kind: PinPromptKind = place.capital && country && rnd() < 0.5 ? 'capitalOf' : 'city'
      const pub: PublicQuestion = { id, type: 'pin', text: '' }
      if (kind === 'capitalOf' && country) {
        pub.text = `Pin the capital of ${country.exonymEn}`
        if (country.endonyms.length) pub.localNames = country.endonyms.map(formatEndonym)
      } else {
        pub.text = `Pin ${place.name}`
        if (country) pub.hint = country.exonymEn
      }
      pack.push({ public: pub, key: { type: 'pin', lat: place.lat, lng: place.lng, name: place.name, iso2: place.iso2, id: place.id } })
    } else if (type === 'language') {
      const entry = nextFrom(langs, lc, (l) => `lang:${l.sample.code}`)
      if (!entry) continue
      usedPrompts.add(`lang:${entry.sample.code}`)
      pack.push({
        promptId: `lang:${entry.sample.code}`,
        public: {
          id,
          type: 'language',
          text: 'Click a country where this language is official',
          sample: { text: entry.sample.sample, dir: entry.sample.dir },
        },
        key: { type: 'set', iso2s: entry.iso2s, title: entry.sample.name, sourceUrl: entry.sample.sourceUrl, sourceLabel: entry.sample.sourceLabel },
      })
    } else if (type === 'history') {
      const ev = nextFrom(history, hc, (e) => `hist:${e.id}`)
      if (!ev) continue
      usedPrompts.add(`hist:${ev.id}`)
      pack.push({
        promptId: `hist:${ev.id}`,
        public: { id, type: 'history', text: ev.text },
        key: { type: 'pin', lat: ev.lat, lng: ev.lng, name: ev.name, iso2: ev.iso2, id: ev.id, sourceUrl: ev.sourceUrl, sourceLabel: ev.sourceLabel },
      })
    } else if (type === 'bid') {
      const cat = nextFrom(cats, bc, (c) => `bid:${c.id}`)
      if (!cat) continue
      usedPrompts.add(`bid:${cat.id}`)
      const members = inputs.countries.filter(cat.members).map((c) => c.iso2)
      if (members.length < 2) continue
      pack.push({
        promptId: `bid:${cat.id}`,
        public: { id, type: 'bid', text: `How many countries ${cat.title} can you click?` },
        key: { type: 'set', iso2s: members, title: `Countries ${cat.title}` },
      })
    } else if (type === 'streak') {
      const list = nextFrom(lists, sc, (l) => `streak:${l.id}`)
      if (!list) continue
      usedPrompts.add(`streak:${list.id}`)
      const ranked = rankedCountries(list, inputs.countries, STREAK_LENGTH)
      if (ranked.iso2s.length < STREAK_LENGTH) continue
      pack.push({
        promptId: `streak:${list.id}`,
        public: { id, type: 'streak', text: `Click the ${STREAK_LENGTH} ${list.title} — any order`, count: STREAK_LENGTH },
        key: {
          type: 'ranked',
          iso2s: ranked.iso2s,
          values: ranked.values,
          title: `Top ${STREAK_LENGTH} ${list.title}`,
          listId: list.id,
          metric: list.metric,
        },
      })
    }
  }
  return pack
}