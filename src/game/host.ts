import { haversineKm, scoreClick, scorePin } from './scoring'
import {
  DEFAULT_SETTINGS,
  MAX_PLAYERS,
  REVEAL_MS,
  generatePack,
  type Answer,
  type FullQuestion,
  type MatchSettings,
  type PackInputs,
} from './questions'
import type { GuestMessage, HostMessage, Player, PlayerResult } from './protocol'

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
  private timer: ReturnType<typeof setTimeout> | null = null
  private destroyed = false

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

  private roster(): Extract<HostMessage, { t: 'roster' }> {
    const players: Player[] = [...this.players].map(([id, name]) => ({ id, name }))
    return { t: 'roster', hostId: this.opts.selfId, players, settings: this.settings }
  }

  // ---- lobby ----

  updateSettings(patch: Partial<MatchSettings>) {
    if (this.phase !== 'lobby') return
    this.settings = { ...this.settings, ...patch }
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
    else if (this.phase === 'question') this.maybeRevealEarly()
  }

  // ---- match flow ----

  async start() {
    if (this.phase !== 'lobby') return
    const seed = (Math.random() * 2 ** 32) >>> 0
    this.pack = await generatePack(this.settings, seed, this.opts.packInputs)
    if (!this.pack.length || this.destroyed) return
    this.totals = new Map([...this.players.keys()].map((id) => [id, 0]))
    this.index = -1
    this.nextQuestion()
  }

  private nextQuestion() {
    this.index++
    if (this.index >= this.pack.length) {
      this.phase = 'finished'
      this.emit({ t: 'finished', totals: Object.fromEntries(this.totals) })
      return
    }
    this.phase = 'question'
    this.answers.clear()
    const timeLimitMs = this.settings.timeLimit * 1000
    this.deadline = Date.now() + timeLimitMs
    const q = this.pack[this.index]
    this.emit({ t: 'question', index: this.index, total: this.pack.length, q: q.public, timeLimitMs })
    // Small grace period for network delay before closing the question.
    this.setTimer(() => this.reveal(), timeLimitMs + 1500)
  }

  submitLocalAnswer(answer: Answer) {
    this.recordAnswer(this.opts.selfId, this.pack[this.index]?.public.id ?? '', answer)
  }

  private recordAnswer(playerId: string, questionId: string, answer: Answer) {
    if (this.phase !== 'question') return
    const q = this.pack[this.index]
    if (!q || q.public.id !== questionId || !this.players.has(playerId) || this.answers.has(playerId)) return
    if (!validAnswer(answer, q)) return
    this.answers.set(playerId, { answer, at: Date.now() })
    this.emit({ t: 'answered', questionId, playerIds: [...this.answers.keys()] })
    this.maybeRevealEarly()
  }

  private maybeRevealEarly() {
    if (this.phase !== 'question') return
    const everyone = [...this.players.keys()].every((id) => this.answers.has(id))
    if (everyone) this.setTimer(() => this.reveal(), 600)
  }

  private reveal() {
    if (this.phase !== 'question') return
    this.phase = 'reveal'
    const q = this.pack[this.index]
    const timeLimitMs = this.settings.timeLimit * 1000
    const results: Record<string, PlayerResult> = {}
    for (const id of this.players.keys()) {
      const a = this.answers.get(id)
      let r: PlayerResult = { answer: null, score: 0 }
      if (a && q.key.type === 'click' && 'iso2' in a.answer) {
        const correct = a.answer.iso2 === q.key.iso2
        r = { answer: a.answer, score: scoreClick(correct, this.deadline - a.at, timeLimitMs), correct }
      } else if (a && q.key.type === 'pin' && 'lat' in a.answer) {
        const distanceKm = haversineKm(a.answer.lat, a.answer.lng, q.key.lat, q.key.lng)
        r = { answer: a.answer, score: scorePin(distanceKm), distanceKm }
      } else if (q.key.type === 'click') r.correct = false
      results[id] = r
      this.totals.set(id, (this.totals.get(id) ?? 0) + r.score)
    }
    this.emit({ t: 'reveal', questionId: q.public.id, key: q.key, results, totals: Object.fromEntries(this.totals) })
    this.setTimer(() => this.nextQuestion(), REVEAL_MS)
  }

  backToLobby() {
    if (this.phase !== 'finished') return
    this.clearTimer()
    this.phase = 'lobby'
    this.pack = []
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

function validAnswer(a: unknown, q: FullQuestion): a is Answer {
  if (!a || typeof a !== 'object') return false
  const o = a as Record<string, unknown>
  if (q.key.type === 'click') return typeof o.iso2 === 'string' && /^[A-Z]{2}$/.test(o.iso2)
  return typeof o.lat === 'number' && typeof o.lng === 'number' && Math.abs(o.lat) <= 90 && Math.abs(o.lng) <= 360
}
