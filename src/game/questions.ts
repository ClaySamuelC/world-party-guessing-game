import type { FeatureCollection, Geometry } from 'geojson'
import { formatEndonym } from '../data/names'
import type { Country, CountryFeatureProps, ExportCommodity, HistoryEvent, LanguageSample, Place } from '../data/types'
import { outlineForCountry, outlineForDraw, type OutlinePath } from './shapes'
import { listRegion, rankedCountries, streakLists } from './streak-lists'

export type { RankInfo, StreakList } from './streak-lists'
export { countryRankOnList, findStreakList, rankedCountries, streakLists } from './streak-lists'

/** Every mini-game in the party pack. */
export type MiniGameId = 'click' | 'pin' | 'language' | 'history' | 'bid' | 'streak' | 'export' | 'eliminate' | 'name' | 'draw'

export interface MiniGameInfo {
  id: MiniGameId
  name: string
  blurb: string
}

export const MINI_GAMES: MiniGameInfo[] = [
  { id: 'click', name: 'Country click', blurb: 'Click the country from its name, flag, or capital.' },
  { id: 'pin', name: 'Pin the location', blurb: 'Drop a pin on a capital, city, or famous place. Closer is better.' },
  { id: 'language', name: 'Language sample', blurb: 'Read a sentence, click any country where that language is official.' },
  { id: 'export', name: 'Export guess', blurb: 'Click one of the top 3 countries that export a commodity. Source shown after.' },
  { id: 'history', name: 'Historical pin', blurb: 'Pin where a historical event happened. Source shown after.' },
  { id: 'bid', name: 'Bid and guess', blurb: 'Auction how many you can click. Solo: 30 seconds to find as many as you can — wrong clicks cost points.' },
  { id: 'streak', name: 'Guessing streak', blurb: 'Find the top countries in any order. Three strikes and you are out.' },
  { id: 'name', name: 'Name the country', blurb: 'See only the outline. Type the name — suggestions appear as you type.' },
  { id: 'draw', name: 'Draw the country', blurb: 'Given a name and a few stats, sketch the shape. Scale does not matter. Small island nations are skipped.' },
  { id: 'eliminate', name: 'Elimination', blurb: 'Click the named country to knock it out. Misses stay in the pool; eliminated countries stay highlighted.' },
]

export const ALL_MINI_GAMES: MiniGameId[] = MINI_GAMES.map((g) => g.id)
/** Party pack rotation — Elimination is its own match mode, not a checkbox. */
export const PARTY_GAMES: MiniGameInfo[] = MINI_GAMES.filter((g) => g.id !== 'eliminate')
export const PARTY_GAME_IDS: MiniGameId[] = PARTY_GAMES.map((g) => g.id)

export type MatchMode = 'party' | 'eliminate'

export type EliminateScope = 'world' | 'Africa' | 'Americas' | 'Asia' | 'Europe' | 'Oceania'

export const ELIMINATE_SCOPES: { id: EliminateScope; label: string }[] = [
  { id: 'world', label: 'the whole world' },
  { id: 'Africa', label: 'Africa' },
  { id: 'Americas', label: 'the Americas' },
  { id: 'Asia', label: 'Asia' },
  { id: 'Europe', label: 'Europe' },
  { id: 'Oceania', label: 'Oceania' },
]

export interface MatchSettings {
  /** Party pack vs exclusive Elimination. */
  matchMode: MatchMode
  /** Which party-pack mini-games are in the rotation. Ignored in Elimination mode. */
  types: MiniGameId[]
  rounds: number
  /** Keep dealing questions until the host ends the match. */
  endless: boolean
  /** Seconds per question (per turn for Guessing Streak; collect-phase base for Bid and Guess). */
  timeLimit: number
  /** Elimination: which countries stay in the pool. */
  eliminateScope: EliminateScope
  /** Pin / history: hold-and-drag a circle instead of dropping a point. */
  pinCircle: boolean
}

export const DEFAULT_SETTINGS: MatchSettings = {
  matchMode: 'party',
  types: PARTY_GAME_IDS.slice(),
  rounds: 10,
  endless: false,
  timeLimit: 20,
  eliminateScope: 'world',
  pinCircle: false,
}
/** How many questions to pre-generate at a time in endless mode. */
export const ENDLESS_BATCH = 16
export const MAX_PLAYERS = 8
export const REVEAL_MS = 6000
/** Seconds on the auction clock (resets every time someone raises). Solo rush window too. */
export const BID_SECONDS = 30
/** Extra collect time per country bid, so bigger bids are feasible. */
export const BID_SECONDS_PER_COUNTRY = 2
/** How many ranks a Guessing Streak question asks for. */
export const STREAK_LENGTH = 5
/** Seconds on the clock for one Guessing Streak turn (solo or hot-seat). */
export const STREAK_SECONDS = 45
/** Wrong clicks allowed before a player is out of a Guessing Streak. */
export const STREAK_STRIKES = 3

/** Sanitise a settings patch from the lobby. */
export function normalizeSettings(s: MatchSettings): MatchSettings {
  const matchMode: MatchMode = s.matchMode === 'eliminate' ? 'eliminate' : 'party'
  const types = PARTY_GAME_IDS.filter((t) => s.types.includes(t))
  const eliminateScope = ELIMINATE_SCOPES.some((x) => x.id === s.eliminateScope) ? s.eliminateScope : 'world'
  return {
    ...s,
    matchMode,
    types: types.length ? types : PARTY_GAME_IDS.slice(),
    eliminateScope,
    pinCircle: !!s.pinCircle,
  }
}

/** What the host actually deals this match. */
export function effectiveTypes(s: MatchSettings): MiniGameId[] {
  return s.matchMode === 'eliminate' ? ['eliminate'] : normalizeSettings(s).types
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
  /**
   * When the question is scoped to a named place on the map (East Africa, the Caribbean, …),
   * every client frames and tints that area. This is the search space, not the answer.
   */
  region?: { label: string; iso2s: string[] }
  /** Name the country: silhouette only — never includes the ISO code. */
  outline?: OutlinePath
  /** Draw the country: facts shown with the name (the country is not a secret). */
  stats?: { population: number | null; areaKm2: number | null; capital: string; region: string }
  /** Elimination: countries already knocked out this match. */
  eliminated?: string[]
}

export type ClickAnswer = { iso2: string }
export type PinAnswer = { lat: number; lng: number; radiusKm?: number }
export type BidAnswer = { bid: number }
/** Fold in a Bid and Guess auction (multiplayer only). */
export type PassAnswer = { pass: true }
/** Result-only answer for multi-pick games: what the player actually collected. */
export type SetAnswer = { iso2s: string[]; bid?: number }
export type DrawAnswer = { strokes: [number, number][][]; done?: boolean }
export type Answer = ClickAnswer | PinAnswer | BidAnswer | PassAnswer | SetAnswer | DrawAnswer

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
  /** Streak list id — host uses it to rank a wrong guess. */
  listId: string
  /** Short label for miss feedback, e.g. "by land area". */
  metric: string
}
export interface DrawKey {
  type: 'draw'
  iso2: string
  name: string
  outline: OutlinePath
}
export type AnswerKey = ClickKey | PinKey | SetKey | RankedKey | DrawKey

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
  /** Famous places for Pin the location (wonders, landmarks, points of interest). */
  landmarks: HistoryEvent[]
  /** Top-3 export commodities for Export Guess. */
  exports: ExportCommodity[]
  geojson: FeatureCollection<Geometry, CountryFeatureProps>
  /** Loads the raw SVG for a flag; only needed on the host. */
  loadFlagSvg: (iso2: string) => Promise<string | null>
}

export interface PackOptions {
  count?: number
  avoidCountries?: Set<string>
  avoidPlaces?: Set<string>
  /** Ids of language / history / landmark / bid / streak / export prompts already used this match. */
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

/**
 * Draw the country skips microstates and small island / archipelago nations (Fiji, Jamaica,
 * Maldives, …). Larger island countries with a drawable mainland shape (Japan, UK, NZ, Cuba)
 * stay in the pool.
 */
const DRAW_SKIP_EXTRA = new Set(['MU', 'KM', 'CV', 'SC', 'ST', 'MV'])

function isSmallIslandForDraw(country: Country, flags: { island: boolean; tiny: boolean } | undefined): boolean {
  if (DRAW_SKIP_EXTRA.has(country.iso2)) return true
  if (flags?.tiny) return true
  if (flags?.island && (country.areaKm2 == null || country.areaKm2 < 100_000)) return true
  return false
}

// Ranked Guessing Streak lists live in streak-lists.ts.

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
  const enabled = effectiveTypes(settings)

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
  const landmarks = shuffle(inputs.landmarks, rnd)
  const cats = shuffle(bidCategories(inputs.countries), rnd)
  const lists = shuffle(streakLists(inputs.countries, inputs.places), rnd)
  const exportPool = shuffle(
    inputs.exports.filter((e) => e.iso2s.every((iso2) => byIso.has(iso2))),
    rnd,
  )

  // Pin is doubled in the bag so location questions show up more often.
  const bag: MiniGameId[] = []
  for (const t of enabled) {
    bag.push(t)
    if (t === 'pin') bag.push(t)
  }
  const order = shuffle(bag, rnd)
  const types: MiniGameId[] = []
  for (let i = 0; i < count; i++) types.push(order[i % order.length])

  const pack: FullQuestion[] = []
  let ci = 0
  let pi = 0

  const drawFlags = new Map<string, { island: boolean; tiny: boolean }>()
  for (const f of inputs.geojson.features) {
    const iso2 = f.properties.iso2
    if (!iso2 || f.properties.kind === 'hull') continue
    drawFlags.set(iso2, { island: f.properties.island, tiny: f.properties.tiny })
  }

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
  const nextDrawCountry = (): Country | undefined => {
    for (let n = 0; n < countries.length * 2; n++) {
      const country = nextCountry()
      if (!country) return undefined
      if (!isSmallIslandForDraw(country, drawFlags.get(country.iso2))) return country
    }
    return undefined
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
  const lmc = { i: 0 }
  const bc = { i: 0 }
  const sc = { i: 0 }
  const xc = { i: 0 }

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
      const tryLandmark = landmarks.length > 0 && rnd() < 0.55
      if (tryLandmark) {
        const lm = nextFrom(landmarks, lmc, (l) => `land:${l.id}`)
        if (lm) {
          usedPrompts.add(`land:${lm.id}`)
          pack.push({
            promptId: `land:${lm.id}`,
            public: { id, type: 'pin', text: lm.text },
            key: {
              type: 'pin',
              lat: lm.lat,
              lng: lm.lng,
              name: lm.name,
              iso2: lm.iso2,
              id: lm.id,
              sourceUrl: lm.sourceUrl,
              sourceLabel: lm.sourceLabel,
            },
          })
          continue
        }
      }
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
    } else if (type === 'export') {
      const commodity = nextFrom(exportPool, xc, (e) => `export:${e.id}`)
      if (!commodity) continue
      usedPrompts.add(`export:${commodity.id}`)
      pack.push({
        promptId: `export:${commodity.id}`,
        public: {
          id,
          type: 'export',
          text: `Click one of the top 3 countries that export ${commodity.name}`,
          hint: `As of ${commodity.year}`,
        },
        key: {
          type: 'set',
          iso2s: [...commodity.iso2s],
          title: `Top ${commodity.name} exporters`,
          sourceUrl: commodity.sourceUrl,
          sourceLabel: commodity.sourceLabel,
        },
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
        public: {
          id,
          type: 'streak',
          text: `Click the ${STREAK_LENGTH} ${list.title} — any order`,
          count: STREAK_LENGTH,
          region: listRegion(list, inputs.countries) ?? undefined,
        },
        key: {
          type: 'ranked',
          iso2s: ranked.iso2s,
          values: ranked.values,
          title: `Top ${STREAK_LENGTH} ${list.title}`,
          listId: list.id,
          metric: list.metric,
        },
      })
    } else if (type === 'eliminate') {
      pack.push({
        public: { id, type: 'eliminate', text: 'Click the named country to eliminate it' },
        key: { type: 'click', iso2: '' },
      })
    } else if (type === 'name') {
      const country = nextCountry()
      if (!country) continue
      const outline = outlineForCountry(inputs.geojson, country.iso2, { precise: true })
      if (!outline) continue
      usedCountries.add(country.iso2)
      pack.push({
        public: { id, type: 'name', text: 'Name this country', outline },
        key: { type: 'click', iso2: country.iso2 },
      })
    } else if (type === 'draw') {
      const country = nextDrawCountry()
      if (!country) continue
      const { outline, mainland } = outlineForDraw(inputs.geojson, country.iso2)
      if (!outline) continue
      const name = mainland ? `mainland ${country.exonymEn}` : country.exonymEn
      usedCountries.add(country.iso2)
      pack.push({
        public: {
          id,
          type: 'draw',
          text: `Draw ${name}`,
          stats: {
            population: country.population,
            areaKm2: country.areaKm2,
            capital: country.capitals[0] ?? '—',
            region: [country.subregion, country.region].filter(Boolean).join(', ') || '—',
          },
        },
        key: { type: 'draw', iso2: country.iso2, name, outline },
      })
    }
  }
  return pack
}