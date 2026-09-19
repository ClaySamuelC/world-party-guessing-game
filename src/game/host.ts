import { haversineKm, scoreBid, scoreClick, scorePin, scoreStreakPick, BID_TOP_BONUS, STREAK_FINISH_BONUS } from './scoring'
import {
  BID_SECONDS,
  BID_SECONDS_PER_COUNTRY,
  DEFAULT_SETTINGS,
  ENDLESS_BATCH,
  MAX_PLAYERS,
  REVEAL_MS,
  STREAK_LISTS,
  STREAK_STRIKES,
  countryRankOnList,
  generatePack,
  normalizeSettings,
  type Answer,
  type FullQuestion,
  type MatchSettings,
  type PackInputs,
} from './questions'
import type { BidProgress, GuestMessage, HostMessage, Player, PlayerResult, StreakState } from './protocol'

/** How the host reaches other peers. Solo play passes a no-op transport. */
export interface HostTransport {
  broadcast(msg: HostMessage): void
  sendTo(peerId: string, msg: HostMessage): void
}

export interface MatchHostOptions {
  selfId: string
  selfName: string
  transport: HostTransport
  packInputs: PackInputs
  /** Called for every message the host emits so the host's own screen stays in sync. */
  onLocal: (msg: HostMessage, from: string) => void
}

type HostPhase = 'lobby' | 'question' | 'reveal' | 'finished'
/** Sub-phase inside a Bid and Guess question. */
type BidPhase = 'bid' | 'collect'

interface BidPlayerState {
  bid: number | null
  hits: string[]
  misses: string[]
  overbid: boolean
  done: boolean
  /** When the player finished (hit their bid) — earlier finishers break ties for the top bonus. */
  doneAt: number
}

const GRACE_MS = 1500

/** Authoritative match state. Lives only in the host's browser. */
export class MatchHost {
  private players = new Map<string, string>()
  private settings: MatchSettings = { ...DEFAULT_SETTINGS }
  private phase: HostPhase = 'lobby'
  private pack: FullQuestion[] = []
  private index = -1
  private answers = new Map<string, { answer: Answer; at: number }>()
  private deadline = 0
  private totals = new Map<string, number>()
  private usedCountries = new Set<string>()
  private usedPlaces = new Set<string>()
  private usedPrompts = new Set<string>()
  private scoredCount = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private destroyed = false

  // Bid and Guess
  private bidPhase: BidPhase = 'bid'
  private bidState = new Map<string, BidPlayerState>()

  // Guessing Streak
  private streak: StreakState | null = null
  private streakOrder: string[] = []
  private streakOffset = 0

  private readonly opts: MatchHostOptions

  constructor(opts: MatchHostOptions) {
    this.opts = opts
    this.players.set(opts.selfId, opts.selfName)
  }

  // ---- outbound ----

  private emit(msg: HostMessage) {
    if (this.destroyed) return
    this.opts.transport.broadcast(msg)
    this.opts.onLocal(msg, this.opts.selfId)
  }

  private emitTo(playerId: string, msg: HostMessage) {
    if (this.destroyed) return
    if (playerId === this.opts.selfId) this.opts.onLocal(msg, this.opts.selfId)
    else this.opts.transport.sendTo(playerId, msg)
  }

  private roster(): Extract<HostMessage, { t: 'roster' }> {
    const players: Player[] = [...this.players].map(([id, name]) => ({ id, name }))
    return { t: 'roster', hostId: this.opts.selfId, players, settings: this.settings }
  }

  // ---- lobby ----

  updateSettings(patch: Partial<MatchSettings>) {
    if (this.phase !== 'lobby') return
    this.settings = normalizeSettings({ ...this.settings, ...patch })
    this.emit(this.roster())
  }

  handlePeerMessage(from: string, msg: GuestMessage) {
    if (msg.t === 'hello') {
      if (this.players.has(from)) {
        this.opts.transport.sendTo(from, this.roster())
        return
      }
      if (this.phase !== 'lobby') {
        this.opts.transport.sendTo(from, { t: 'rejected', reason: 'A match is already in progress. Ask the host to invite you after it ends.' })
        return
      }
      if (this.players.size >= MAX_PLAYERS) {
        this.opts.transport.sendTo(from, { t: 'rejected', reason: `This room is full (${MAX_PLAYERS} players).` })
        return
      }
      this.players.set(from, msg.name.trim().slice(0, 24) || 'Player')
      this.emit(this.roster())
    } else if (msg.t === 'answer') {
      this.recordAnswer(from, msg.questionId, msg.answer)
    }
  }

  handlePeerLeave(peerId: string) {
    if (!this.players.delete(peerId)) return
    if (this.phase === 'lobby') this.emit(this.roster())
    else if (this.phase === 'question') {
      const q = this.current()
      if (q?.public.type === 'streak' && this.streak) {
        this.streakOrder = this.streakOrder.filter((id) => id !== peerId)
        if (this.streak.activeId === peerId) this.streakAdvanceTurn()
        else this.emitStreak()
      } else this.maybeRevealEarly()
    }
  }

  // ---- match flow ----

  async start() {
    if (this.phase !== 'lobby') return
    this.usedCountries.clear()
    this.usedPlaces.clear()
    this.usedPrompts.clear()
    this.pack = await this.deal(this.settings.endless ? ENDLESS_BATCH : this.settings.rounds)
    if (!this.pack.length || this.destroyed) return
    this.totals = new Map([...this.players.keys()].map((id) => [id, 0]))
    this.scoredCount = 0
    this.index = -1
    this.streakOffset = 0
    await this.nextQuestion()
  }

  /** Solo players press this after a reveal instead of waiting out the timer. */
  advance() {
    if (this.phase !== 'reveal') return
    this.clearTimer()
    void this.nextQuestion()
  }

  /** Host/solo can stop an endless (or in-progress) match. */
  endMatch() {
    if (this.phase === 'lobby' || this.phase === 'finished') return
    this.clearTimer()
    this.finish()
  }

  private isSolo() {
    return this.players.size === 1
  }

  private current(): FullQuestion | undefined {
    return this.pack[this.index]
  }

  private rememberKey(q: FullQuestion) {
    if (q.promptId) this.usedPrompts.add(q.promptId)
    if (q.key.type === 'click') this.usedCountries.add(q.key.iso2)
    else if (q.key.type === 'pin' && q.public.type === 'pin') this.usedPlaces.add(q.key.id)
  }

  private async deal(count: number) {
    const pack = await generatePack(this.settings, (Math.random() * 2 ** 32) >>> 0, this.opts.packInputs, {
      count,
      avoidCountries: this.usedCountries,
      avoidPlaces: this.usedPlaces,
      avoidPrompts: this.usedPrompts,
    })
    for (const q of pack) this.rememberKey(q)
    return pack
  }

  private async nextQuestion() {
    this.index++
    if (this.index >= this.pack.length && this.settings.endless) {
      const more = await this.deal(ENDLESS_BATCH)
      if (this.destroyed) return
      this.pack.push(...more)
    }
    if (this.index >= this.pack.length) {
      this.finish()
      return
    }
    this.phase = 'question'
    this.answers.clear()
    this.bidState.clear()
    this.streak = null
    const q = this.pack[this.index]
    const total = this.settings.endless ? 0 : this.pack.length
    const baseMs = this.settings.timeLimit * 1000

    if (q.public.type === 'bid') {
      this.bidPhase = 'bid'
      const bidMs = Math.min(baseMs, BID_SECONDS * 1000)
      this.deadline = Date.now() + bidMs
      this.emit({ t: 'question', index: this.index, total, q: q.public, timeLimitMs: bidMs })
      this.setTimer(() => this.startCollect(), bidMs + GRACE_MS)
      return
    }

    if (q.public.type === 'streak' && q.key.type === 'ranked') {
      // Hot-seat order: join order, rotated so a different player opens each streak question.
      const ids = [...this.players.keys()]
      const start = this.streakOffset++ % Math.max(1, ids.length)
      this.streakOrder = [...ids.slice(start), ...ids.slice(0, start)]
      this.streak = {
        activeId: this.streakOrder[0] ?? null,
        turn: 0,
        found: 0,
        total: q.key.iso2s.length,
        strikes: 0,
        maxStrikes: STREAK_STRIKES,
        claimed: [],
        lastMiss: null,
        missed: [],
        finished: [],
      }
      this.deadline = Date.now() + baseMs
      this.emit({ t: 'question', index: this.index, total, q: q.public, timeLimitMs: baseMs })
      this.emitStreak()
      this.setTimer(() => this.streakTimeout(), baseMs + GRACE_MS)
      return
    }

    this.deadline = Date.now() + baseMs
    this.emit({ t: 'question', index: this.index, total, q: q.public, timeLimitMs: baseMs })
    // Small grace period for network delay before closing the question.
    this.setTimer(() => this.reveal(), baseMs + GRACE_MS)
  }

  private finish() {
    this.phase = 'finished'
    this.emit({ t: 'finished', totals: Object.fromEntries(this.totals), rounds: this.scoredCount })
  }

  submitLocalAnswer(answer: Answer) {
    this.recordAnswer(this.opts.selfId, this.pack[this.index]?.public.id ?? '', answer)
  }

  private recordAnswer(playerId: string, questionId: string, answer: unknown) {
    if (this.phase !== 'question') return
    const q = this.current()
    if (!q || q.public.id !== questionId || !this.players.has(playerId)) return
    if (!isObject(answer)) return

    switch (q.public.type) {
      case 'bid':
        if (this.bidPhase === 'bid') {
          if (typeof answer.bid === 'number' && Number.isInteger(answer.bid) && answer.bid >= 0 && answer.bid <= 250) this.recordBid(playerId, answer.bid)
        } else if (isIso2(answer.iso2)) this.recordBidPick(playerId, answer.iso2)
        return
      case 'streak':
        if (isIso2(answer.iso2)) this.recordStreakPick(playerId, answer.iso2)
        return
      case 'click':
      case 'language':
        if (!isIso2(answer.iso2)) return
        this.recordSingle(playerId, { iso2: answer.iso2 })
        return
      case 'pin':
      case 'history':
        if (typeof answer.lat !== 'number' || typeof answer.lng !== 'number' || Math.abs(answer.lat) > 90 || Math.abs(answer.lng) > 360) return
        this.recordSingle(playerId, { lat: answer.lat, lng: answer.lng })
        return
    }
  }

  // ---- everyone-answers-at-once questions ----

  private recordSingle(playerId: string, answer: Answer) {
    if (this.answers.has(playerId)) return
    const q = this.current()!
    this.answers.set(playerId, { answer, at: Date.now() })
    this.emit({ t: 'answered', questionId: q.public.id, playerIds: [...this.answers.keys()] })
    this.maybeRevealEarly()
  }

  private maybeRevealEarly() {
    if (this.phase !== 'question') return
    const q = this.current()
    if (!q || q.public.type === 'streak') return
    if (q.public.type === 'bid') {
      const allDone = [...this.players.keys()].every((id) => this.bidState.get(id)?.done)
      if (this.bidPhase === 'bid') {
        if ([...this.players.keys()].every((id) => this.answers.has(id))) this.setTimer(() => this.startCollect(), this.isSolo() ? 0 : 400)
      } else if (allDone) this.setTimer(() => this.reveal(), this.isSolo() ? 0 : 600)
      return
    }
    const everyone = [...this.players.keys()].every((id) => this.answers.has(id))
    if (everyone) this.setTimer(() => this.reveal(), this.isSolo() ? 0 : 600)
  }

  // ---- Bid and Guess ----

  private recordBid(playerId: string, bid: number) {
    if (this.answers.has(playerId)) return
    const q = this.current()!
    this.answers.set(playerId, { answer: { bid }, at: Date.now() })
    this.emit({ t: 'answered', questionId: q.public.id, playerIds: [...this.answers.keys()] })
    this.maybeRevealEarly()
  }

  private bidProgress(): Record<string, BidProgress> {
    const out: Record<string, BidProgress> = {}
    for (const id of this.players.keys()) {
      const s = this.bidState.get(id)
      out[id] = s
        ? { bid: s.bid, hits: s.hits.length, misses: s.misses.length, overbid: s.overbid, done: s.done }
        : { bid: null, hits: 0, misses: 0, overbid: false, done: true }
    }
    return out
  }

  private startCollect() {
    if (this.phase !== 'question' || this.bidPhase !== 'bid') return
    const q = this.current()
    if (!q || q.key.type !== 'set') return
    this.bidPhase = 'collect'
    const setSize = q.key.iso2s.length
    let maxBid = 0
    for (const id of this.players.keys()) {
      const a = this.answers.get(id)?.answer
      const bid: number | null = a && 'bid' in a && typeof a.bid === 'number' ? a.bid : null
      const overbid = bid != null && bid > setSize
      // No bid or a zero bid = sit this one out. Overbid = instant fail, no collecting.
      const done = bid == null || bid === 0 || overbid
      if (bid && !overbid) maxBid = Math.max(maxBid, bid)
      this.bidState.set(id, { bid, hits: [], misses: [], overbid, done, doneAt: 0 })
    }
    const collectMs = this.settings.timeLimit * 1000 + maxBid * BID_SECONDS_PER_COUNTRY * 1000
    this.deadline = Date.now() + collectMs
    this.emit({ t: 'phase', questionId: q.public.id, phase: 'collect', timeLimitMs: collectMs, progress: this.bidProgress() })
    this.setTimer(() => this.reveal(), collectMs + GRACE_MS)
    this.maybeRevealEarly()
  }

  private recordBidPick(playerId: string, iso2: string) {
    const q = this.current()
    const s = this.bidState.get(playerId)
    if (!q || q.key.type !== 'set' || !s || s.done || s.bid == null) return
    if (s.hits.includes(iso2) || s.misses.includes(iso2)) return
    const ok = q.key.iso2s.includes(iso2)
    if (ok) s.hits.push(iso2)
    else s.misses.push(iso2)
    if (s.hits.length >= s.bid) {
      s.done = true
      s.doneAt = Date.now()
    }
    this.emitTo(playerId, { t: 'pick', questionId: q.public.id, iso2, ok })
    this.emit({ t: 'progress', questionId: q.public.id, progress: this.bidProgress() })
    this.maybeRevealEarly()
  }

  // ---- Guessing Streak ----

  private emitStreak() {
    const q = this.current()
    if (!q || !this.streak) return
    this.emit({ t: 'streak', questionId: q.public.id, state: { ...this.streak, claimed: this.streak.claimed.slice(), missed: this.streak.missed.slice(), finished: this.streak.finished.slice() } })
  }

  private recordStreakPick(playerId: string, iso2: string) {
    const q = this.current()
    const st = this.streak
    if (!q || q.key.type !== 'ranked' || !st || st.activeId !== playerId) return
    const key = q.key
    if (st.claimed.some((c) => c.iso2 === iso2)) return
    if (st.missed.includes(iso2)) return

    const target = new Set(key.iso2s)
    if (target.has(iso2)) {
      st.claimed.push({ iso2, playerId })
      st.found = st.claimed.length
      st.lastMiss = null
      if (st.found >= st.total) {
        st.activeId = null
        this.emitStreak()
        this.setTimer(() => this.reveal(), this.isSolo() ? 0 : 900)
        return
      }
      this.emitStreak()
      return
    }

    // Wrong: one strike, with rank context so the player learns something.
    const list = STREAK_LISTS.find((l) => l.id === key.listId)
    const info = list ? countryRankOnList(list, this.opts.packInputs.countries, iso2) : null
    const country = this.opts.packInputs.countries.find((c) => c.iso2 === iso2)
    st.missed.push(iso2)
    st.strikes++
    st.lastMiss = {
      playerId,
      iso2,
      name: country?.exonymEn ?? iso2,
      rank: info?.rank ?? 0,
      value: info?.value ?? '?',
      metric: key.metric,
      total: info?.total ?? 0,
    }
    this.emitStreak()
    if (st.strikes >= st.maxStrikes) this.streakAdvanceTurn()
  }

  private streakTimeout() {
    if (this.phase !== 'question' || !this.streak) return
    // Time ran out: treat as striking out and hand off / reveal.
    this.streak.strikes = this.streak.maxStrikes
    this.streak.lastMiss = null
    this.streakAdvanceTurn()
  }

  /** Active player is out (3 strikes or timeout); next player resumes the same remaining set. */
  private streakAdvanceTurn() {
    const st = this.streak
    if (!st || this.phase !== 'question') return
    if (st.activeId && !st.finished.includes(st.activeId)) st.finished.push(st.activeId)
    const next = this.streakOrder.find((id) => this.players.has(id) && !st.finished.includes(id))
    if (!next) {
      st.activeId = null
      this.emitStreak()
      this.setTimer(() => this.reveal(), this.isSolo() ? 0 : 900)
      return
    }
    st.activeId = next
    st.turn++
    st.strikes = 0
    st.missed = []
    st.lastMiss = null
    const turnMs = this.settings.timeLimit * 1000
    this.deadline = Date.now() + turnMs
    this.emitStreak()
    this.setTimer(() => this.streakTimeout(), turnMs + GRACE_MS)
  }

  // ---- reveal ----

  private reveal() {
    if (this.phase !== 'question') return
    this.phase = 'reveal'
    const q = this.current()!
    const timeLimitMs = this.settings.timeLimit * 1000
    const results: Record<string, PlayerResult> = {}

    if (q.public.type === 'bid' && q.key.type === 'set') {
      // Top-bonus goes to the highest fulfilled bid (earliest finisher wins ties). Only in parties.
      let bonusId: string | null = null
      if (!this.isSolo()) {
        let best = 0
        let bestAt = Infinity
        for (const [id, s] of this.bidState) {
          if (!s.bid || s.overbid || s.hits.length < s.bid) continue
          if (s.bid > best || (s.bid === best && s.doneAt < bestAt)) {
            best = s.bid
            bestAt = s.doneAt
            bonusId = id
          }
        }
      }
      for (const id of this.players.keys()) {
        const s = this.bidState.get(id)
        if (!s || s.bid == null) {
          results[id] = { answer: null, score: 0, bid: undefined, hits: [], misses: [] }
          continue
        }
        const score = scoreBid(s.bid, s.hits.length, s.overbid) + (id === bonusId ? BID_TOP_BONUS : 0)
        results[id] = { answer: { iso2s: s.hits, bid: s.bid }, score, bid: s.bid, hits: s.hits, misses: s.misses, overbid: s.overbid }
      }
    } else if (q.public.type === 'streak' && q.key.type === 'ranked' && this.streak) {
      const per = scoreStreakPick(q.key.iso2s.length)
      const complete = this.streak.found >= this.streak.total
      const closer = complete ? this.streak.claimed[this.streak.claimed.length - 1]?.playerId : null
      for (const id of this.players.keys()) {
        const mine = this.streak.claimed.filter((c) => c.playerId === id).map((c) => c.iso2)
        const score = mine.length * per + (id === closer ? STREAK_FINISH_BONUS : 0)
        results[id] = { answer: { iso2s: mine }, score, streak: mine.length }
      }
    } else {
      for (const id of this.players.keys()) {
        const a = this.answers.get(id)
        let r: PlayerResult = { answer: null, score: 0 }
        if (a && q.key.type === 'click' && 'iso2' in a.answer) {
          const correct = a.answer.iso2 === q.key.iso2
          r = { answer: a.answer, score: scoreClick(correct, this.deadline - a.at, timeLimitMs), correct }
        } else if (a && q.key.type === 'set' && 'iso2' in a.answer) {
          const correct = q.key.iso2s.includes(a.answer.iso2)
          r = { answer: a.answer, score: scoreClick(correct, this.deadline - a.at, timeLimitMs), correct }
        } else if (a && q.key.type === 'pin' && 'lat' in a.answer) {
          const distanceKm = haversineKm(a.answer.lat, a.answer.lng, q.key.lat, q.key.lng)
          r = { answer: a.answer, score: scorePin(distanceKm), distanceKm }
        } else if (q.key.type === 'click' || q.key.type === 'set') r.correct = false
        results[id] = r
      }
    }

    for (const id of this.players.keys()) this.totals.set(id, (this.totals.get(id) ?? 0) + (results[id]?.score ?? 0))
    this.scoredCount++
    this.emit({ t: 'reveal', questionId: q.public.id, key: q.key, results, totals: Object.fromEntries(this.totals) })
    // Solo waits for the Next button; parties auto-advance so everyone stays in sync.
    if (!this.isSolo()) this.setTimer(() => void this.nextQuestion(), q.key.type === 'set' || q.key.type === 'ranked' ? REVEAL_MS + 3000 : REVEAL_MS)
  }

  backToLobby() {
    if (this.phase !== 'finished') return
    this.clearTimer()
    this.phase = 'lobby'
    this.pack = []
    this.usedCountries.clear()
    this.usedPlaces.clear()
    this.usedPrompts.clear()
    this.emit(this.roster())
  }

  private setTimer(fn: () => void, ms: number) {
    this.clearTimer()
    this.timer = setTimeout(fn, ms)
  }

  private clearTimer() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  destroy() {
    this.destroyed = true
    this.clearTimer()
  }
}

function isObject(a: unknown): a is Record<string, unknown> {
  return !!a && typeof a === 'object'
}

function isIso2(v: unknown): v is string {
  return typeof v === 'string' && /^[A-Z]{2}$/.test(v)
}
