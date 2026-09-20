import { haversineKm, scoreBid, scoreBidRush, scoreClick, scoreDraw, scorePin, scorePinCircle, scoreStreakPick, BID_TOP_BONUS, STREAK_FINISH_BONUS } from './scoring'
import { drawRingsForCountry, shapeOverlap } from './shapes'
import {
  BID_SECONDS,
  BID_SECONDS_PER_COUNTRY,
  DEFAULT_SETTINGS,
  ELIMINATE_SCOPES,
  ENDLESS_BATCH,
  MAX_PLAYERS,
  REVEAL_MS,
  STREAK_SECONDS,
  STREAK_STRIKES,
  countryRankOnList,
  findStreakList,
  generatePack,
  normalizeSettings,
  type Answer,
  type FullQuestion,
  type MatchSettings,
  type PackInputs,
} from './questions'
import type { AuctionState, BidProgress, GuestMessage, HostMessage, Player, PlayerResult, StreakState } from './protocol'

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
  /** Solo: no auction; bid is the set size so collecting ends when every country is found. */
  rush?: boolean
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
  private auction: AuctionState | null = null

  // Guessing Streak
  private streak: StreakState | null = null
  private streakOrder: string[] = []
  private streakOffset = 0

  // Elimination — persists across questions for the whole match
  private eliminated = new Set<string>()

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
      } else if (q?.public.type === 'bid' && this.bidPhase === 'bid' && this.auction) {
        this.auction.passed = this.auction.passed.filter((id) => id !== peerId)
        delete this.auction.bids[peerId]
        if (this.auction.highBidderId === peerId) this.reseatAuctionLeader()
        this.emitAuction(Math.max(0, this.deadline - Date.now()))
        this.maybeCloseAuction()
      } else this.maybeRevealEarly()
    }
  }

  // ---- match flow ----

  async start() {
    if (this.phase !== 'lobby') return
    this.usedCountries.clear()
    this.usedPlaces.clear()
    this.usedPrompts.clear()
    this.eliminated.clear()
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
    if (q.key.type === 'click' && q.key.iso2) this.usedCountries.add(q.key.iso2)
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

  private publishQuestion(q: FullQuestion): FullQuestion['public'] {
    return this.eliminated.size ? { ...q.public, eliminated: [...this.eliminated] } : q.public
  }

  private prepareEliminate(q: FullQuestion): boolean {
    const scope = this.settings.eliminateScope
    const pool = this.opts.packInputs.countries.filter((c) => (scope === 'world' ? true : c.region === scope))
    const remain = pool.filter((c) => !this.eliminated.has(c.iso2))
    if (!remain.length) return false
    const country = remain[Math.floor(Math.random() * remain.length)]!
    const label = ELIMINATE_SCOPES.find((s) => s.id === scope)?.label ?? 'the map'
    q.key = { type: 'click', iso2: country.iso2 }
    q.public = {
      ...q.public,
      text: `Click ${country.exonymEn} to eliminate it`,
      region: scope === 'world' ? undefined : { label, iso2s: pool.map((c) => c.iso2) },
    }
    return true
  }

  private async nextQuestion(skips = 0) {
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
    this.auction = null
    this.streak = null
    const q = this.pack[this.index]
    if (q.public.type === 'eliminate' && !this.prepareEliminate(q)) {
      if (skips > 24) {
        this.finish()
        return
      }
      await this.nextQuestion(skips + 1)
      return
    }
    const total = this.settings.endless ? 0 : this.pack.length
    const baseMs = this.settings.timeLimit * 1000

    if (q.public.type === 'bid') {
      if (this.isSolo()) {
        this.startSoloRush(total)
        return
      }
      this.bidPhase = 'bid'
      const bidMs = BID_SECONDS * 1000
      this.deadline = Date.now() + bidMs
      this.emit({ t: 'question', index: this.index, total, q: this.publishQuestion(q), timeLimitMs: bidMs })
      this.auction = { highBid: 0, highBidderId: null, passed: [], bids: {} }
      this.emitAuction(bidMs)
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
      const streakMs = STREAK_SECONDS * 1000
      this.deadline = Date.now() + streakMs
      this.emit({ t: 'question', index: this.index, total, q: this.publishQuestion(q), timeLimitMs: streakMs })
      this.emitStreak()
      this.setTimer(() => this.streakTimeout(), streakMs + GRACE_MS)
      return
    }

    this.deadline = Date.now() + baseMs
    this.emit({ t: 'question', index: this.index, total, q: this.publishQuestion(q), timeLimitMs: baseMs })
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
          if (!this.isSolo() && 'pass' in answer && answer.pass === true) this.recordAuctionPass(playerId)
          else if (typeof answer.bid === 'number' && Number.isInteger(answer.bid) && answer.bid >= 0 && answer.bid <= 250) this.recordBid(playerId, answer.bid)
        } else if (isIso2(answer.iso2)) this.recordBidPick(playerId, answer.iso2)
        return
      case 'streak':
        if (isIso2(answer.iso2)) this.recordStreakPick(playerId, answer.iso2)
        return
      case 'click':
      case 'language':
      case 'export':
      case 'eliminate':
      case 'name':
        if (!isIso2(answer.iso2)) return
        this.recordSingle(playerId, { iso2: answer.iso2 })
        return
      case 'pin':
      case 'history':
        if (typeof answer.lat !== 'number' || typeof answer.lng !== 'number' || Math.abs(answer.lat) > 90 || Math.abs(answer.lng) > 360) return
        {
          const radiusKm =
            typeof answer.radiusKm === 'number' && Number.isFinite(answer.radiusKm) ? Math.max(1, Math.min(8000, answer.radiusKm)) : undefined
          if (this.settings.pinCircle) {
            if (radiusKm == null) return
            this.recordSingle(playerId, { lat: answer.lat, lng: answer.lng, radiusKm })
          } else this.recordSingle(playerId, { lat: answer.lat, lng: answer.lng })
        }
        return
      case 'draw':
        this.recordDraw(playerId, answer)
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

  private recordDraw(playerId: string, raw: Record<string, unknown>) {
    if (!Array.isArray(raw.strokes)) return
    const strokes: [number, number][][] = []
    for (const s of raw.strokes.slice(0, 12)) {
      if (!Array.isArray(s)) continue
      const pts: [number, number][] = []
      for (const p of s.slice(0, 500)) {
        if (!Array.isArray(p) || typeof p[0] !== 'number' || typeof p[1] !== 'number') continue
        if (p[0] < -0.15 || p[0] > 1.15 || p[1] < -0.15 || p[1] > 1.15) continue
        pts.push([p[0], p[1]])
      }
      if (pts.length >= 2) strokes.push(pts)
    }
    const prev = this.answers.get(playerId)
    if (prev && 'strokes' in prev.answer && prev.answer.done) return
    const done = raw.done === true
    this.answers.set(playerId, { answer: { strokes, done }, at: prev?.at ?? Date.now() })
    if (done) {
      const q = this.current()!
      this.emit({ t: 'answered', questionId: q.public.id, playerIds: [...this.answers.keys()].filter((id) => {
        const a = this.answers.get(id)?.answer
        return !!a && 'done' in a && a.done
      }) })
      this.maybeRevealEarly()
    }
  }

  private maybeRevealEarly() {
    if (this.phase !== 'question') return
    const q = this.current()
    if (!q || q.public.type === 'streak') return
    if (q.public.type === 'bid') {
      const allDone = [...this.players.keys()].every((id) => this.bidState.get(id)?.done)
      if (this.bidPhase === 'collect' && allDone) this.setTimer(() => this.reveal(), this.isSolo() ? 0 : 600)
      return
    }
    if (q.public.type === 'draw') {
      const everyone = [...this.players.keys()].every((id) => {
        const a = this.answers.get(id)?.answer
        return !!a && 'done' in a && a.done
      })
      if (everyone) this.setTimer(() => this.reveal(), this.isSolo() ? 0 : 600)
      return
    }
    const everyone = [...this.players.keys()].every((id) => this.answers.has(id))
    if (everyone) this.setTimer(() => this.reveal(), this.isSolo() ? 0 : 600)
  }

  // ---- Bid and Guess ----

  private emitAuction(timeLimitMs: number) {
    const q = this.current()
    if (!q || !this.auction) return
    this.emit({
      t: 'auction',
      questionId: q.public.id,
      state: { highBid: this.auction.highBid, highBidderId: this.auction.highBidderId, passed: this.auction.passed.slice(), bids: { ...this.auction.bids } },
      timeLimitMs,
    })
  }

  private restartAuctionClock() {
    const bidMs = BID_SECONDS * 1000
    this.deadline = Date.now() + bidMs
    this.emitAuction(bidMs)
    this.setTimer(() => this.startCollect(), bidMs + GRACE_MS)
  }

  private reseatAuctionLeader() {
    const a = this.auction
    if (!a) return
    let best = 0
    let who: string | null = null
    for (const [id, bid] of Object.entries(a.bids)) {
      if (a.passed.includes(id) || !this.players.has(id)) continue
      if (bid > best) {
        best = bid
        who = id
      }
    }
    a.highBid = best
    a.highBidderId = who
  }

  private maybeCloseAuction() {
    if (this.isSolo() || !this.auction || this.bidPhase !== 'bid') return
    const active = [...this.players.keys()].filter((id) => !this.auction!.passed.includes(id))
    // Nobody left, or only the current leader remains — no one wants to raise further.
    if (active.length === 0 || (active.length === 1 && this.auction.highBidderId && active[0] === this.auction.highBidderId)) {
      this.setTimer(() => this.startCollect(), 400)
    }
  }

  private recordBid(playerId: string, bid: number) {
    if (this.isSolo()) return
    this.recordAuctionRaise(playerId, bid)
  }

  private recordAuctionRaise(playerId: string, bid: number) {
    if (!this.auction || this.auction.passed.includes(playerId)) return
    if (bid < 1 || bid <= this.auction.highBid) return
    this.auction.highBid = bid
    this.auction.highBidderId = playerId
    this.auction.bids[playerId] = bid
    this.answers.set(playerId, { answer: { bid }, at: Date.now() })
    this.restartAuctionClock()
    this.maybeCloseAuction()
  }

  private recordAuctionPass(playerId: string) {
    if (!this.auction || this.auction.passed.includes(playerId) || !this.players.has(playerId)) return
    this.auction.passed.push(playerId)
    if (this.auction.highBidderId === playerId) this.reseatAuctionLeader()
    this.emitAuction(Math.max(0, this.deadline - Date.now()))
    this.maybeCloseAuction()
  }

  private bidProgress(): Record<string, BidProgress> {
    const out: Record<string, BidProgress> = {}
    for (const id of this.players.keys()) {
      const s = this.bidState.get(id)
      out[id] = s
        ? { bid: s.rush ? null : s.bid, hits: s.hits.length, misses: s.misses.length, overbid: s.overbid, done: s.done, rush: s.rush }
        : { bid: null, hits: 0, misses: 0, overbid: false, done: true }
    }
    return out
  }

  /** Solo Bid and Guess: skip the auction; 30 seconds to click as many as you can. */
  private startSoloRush(total: number) {
    const q = this.current()
    if (!q || q.key.type !== 'set') return
    this.bidPhase = 'collect'
    const setSize = q.key.iso2s.length
    for (const id of this.players.keys()) {
      this.bidState.set(id, { bid: setSize, hits: [], misses: [], overbid: false, done: false, doneAt: 0, rush: true })
    }
    const rushMs = BID_SECONDS * 1000
    this.deadline = Date.now() + rushMs
    const text = soloBidPrompt(q.public.text)
    this.emit({ t: 'question', index: this.index, total, q: { ...this.publishQuestion(q), text }, timeLimitMs: rushMs })
    this.emit({ t: 'phase', questionId: q.public.id, phase: 'collect', timeLimitMs: rushMs, progress: this.bidProgress() })
    this.setTimer(() => this.reveal(), rushMs + GRACE_MS)
  }

  private startCollect() {
    if (this.phase !== 'question' || this.bidPhase !== 'bid') return
    const q = this.current()
    if (!q || q.key.type !== 'set') return
    this.bidPhase = 'collect'
    const setSize = q.key.iso2s.length
    const winnerId = this.auction?.highBidderId ?? null
    const winnerBid = this.auction?.highBid ?? 0
    let maxBid = 0
    for (const id of this.players.keys()) {
      const bid = id === winnerId && winnerBid > 0 ? winnerBid : null
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
    const list = findStreakList(key.listId, this.opts.packInputs.countries, this.opts.packInputs.places)
    const info = list ? countryRankOnList(list, this.opts.packInputs.countries, iso2) : null
    const country = this.opts.packInputs.countries.find((c) => c.iso2 === iso2)
    const outside = !info || 'outside' in info
    st.missed.push(iso2)
    st.strikes++
    st.lastMiss = {
      playerId,
      iso2,
      name: country?.exonymEn ?? iso2,
      rank: info && 'rank' in info ? info.rank : 0,
      value: info && 'rank' in info ? info.value : '',
      metric: outside ? (list?.outsideLabel ?? 'on this list') : key.metric,
      total: info && 'rank' in info ? info.total : 0,
      outside,
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
    const turnMs = STREAK_SECONDS * 1000
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
        if (s?.rush) {
          const score = scoreBidRush(s.hits.length, s.misses.length)
          results[id] = { answer: { iso2s: s.hits }, score, hits: s.hits, misses: s.misses, rush: true }
          continue
        }
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
          const radiusKm = a.answer.radiusKm
          const score = this.settings.pinCircle && radiusKm != null ? scorePinCircle(radiusKm, distanceKm) : scorePin(distanceKm)
          r = { answer: a.answer, score, distanceKm, radiusKm }
        } else if (a && q.key.type === 'draw' && 'strokes' in a.answer) {
          const overlap = shapeOverlap(a.answer.strokes, drawRingsForCountry(this.opts.packInputs.geojson, q.key.iso2).rings)
          r = { answer: a.answer, score: scoreDraw(overlap), overlap }
        } else if (q.key.type === 'click' || q.key.type === 'set') r.correct = false
        results[id] = r
      }
    }

    if (q.public.type === 'eliminate' && q.key.type === 'click' && Object.values(results).some((r) => r.correct)) {
      this.eliminated.add(q.key.iso2)
    }

    for (const id of this.players.keys()) this.totals.set(id, (this.totals.get(id) ?? 0) + (results[id]?.score ?? 0))
    this.scoredCount++
    this.emit({
      t: 'reveal',
      questionId: q.public.id,
      key: q.key,
      results,
      totals: Object.fromEntries(this.totals),
      eliminated: [...this.eliminated],
    })
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
    this.eliminated.clear()
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

/** "How many countries X can you click?" → rush prompt. */
function soloBidPrompt(text: string): string {
  const m = /^How many countries (.+) can you click\?$/.exec(text)
  return m ? `Click as many countries ${m[1]} as you can` : text
}
