import { DEFAULT_SETTINGS, STREAK_SECONDS, type Answer, type MatchSettings, type PublicQuestion } from './questions'
import type { AuctionState, BidProgress, HostMessage, Player, StreakState } from './protocol'

export type Phase = 'connecting' | 'lobby' | 'question' | 'reveal' | 'finished' | 'rejected' | 'host-left'

/** Everything a player's screen needs. Built purely from host messages plus local actions. */
export interface RoomState {
  phase: Phase
  hostId: string | null
  players: Player[]
  settings: MatchSettings
  question: {
    index: number
    total: number
    q: PublicQuestion
    /** When the current timer started (question start, collect phase start, or streak turn start). */
    receivedAt: number
    timeLimitMs: number
  } | null
  answeredIds: string[]
  /** Locked single answer (click/pin/language/history) or the bid (bid phase). */
  myAnswer: Answer | null
  /** Bid and Guess: 'bid' until the host opens the collect phase. */
  bidPhase: 'bid' | 'collect' | null
  bidProgress: Record<string, BidProgress>
  /** Multiplayer Bid and Guess: live auction standings. */
  auction: AuctionState | null
  /** Bid and Guess collect phase: my clicks as confirmed by the host. */
  myPicks: { iso2: string; ok: boolean }[]
  /** Guessing Streak turn state. */
  streak: StreakState | null
  /** Elimination: countries knocked out this match. */
  eliminated: string[]
  reveal: Extract<HostMessage, { t: 'reveal' }> | null
  totals: Record<string, number>
  roundsPlayed: number
  rejectedReason: string | null
}

export const initialRoomState: RoomState = {
  phase: 'connecting',
  hostId: null,
  players: [],
  settings: DEFAULT_SETTINGS,
  question: null,
  answeredIds: [],
  myAnswer: null,
  bidPhase: null,
  bidProgress: {},
  auction: null,
  myPicks: [],
  streak: null,
  eliminated: [],
  reveal: null,
  totals: {},
  roundsPlayed: 0,
  rejectedReason: null,
}

export type ClientEvent =
  | { kind: 'host'; msg: HostMessage; from: string }
  | { kind: 'local-answer'; answer: Answer }
  | { kind: 'host-left' }
  | { kind: 'reset' }

/** Can this player send `answer` right now? Mirrors the host's acceptance rules. */
export function canAnswer(state: RoomState, selfId: string, answer: Answer): boolean {
  const q = state.question
  if (!q || state.phase !== 'question') return false
  switch (q.q.type) {
    case 'bid':
      if (state.players.length === 1 || state.bidPhase === 'collect') {
        const p = state.bidProgress[selfId]
        return 'iso2' in answer && !p?.done && !state.myPicks.some((x) => x.iso2 === answer.iso2)
      }
      if (state.auction?.passed.includes(selfId)) return false
      if ('pass' in answer) return true
      return 'bid' in answer && typeof answer.bid === 'number' && answer.bid > (state.auction?.highBid ?? 0)
    case 'streak':
      return 'iso2' in answer && state.streak?.activeId === selfId && !state.streak.claimed.some((c) => c.iso2 === answer.iso2) && !state.streak.missed.includes(answer.iso2)
    case 'draw':
      if (state.myAnswer && 'strokes' in state.myAnswer && state.myAnswer.done) return false
      return 'strokes' in answer
    default:
      return !state.myAnswer
  }
}

export function roomReducer(state: RoomState, ev: ClientEvent): RoomState {
  switch (ev.kind) {
    case 'reset':
      return initialRoomState
    case 'host-left':
      return state.phase === 'rejected' ? state : { ...state, phase: 'host-left' }
    case 'local-answer': {
      if (state.phase !== 'question' || !state.question) return state
      const type = state.question.q.type
      // Multi-pick games are confirmed by the host; auction bids can be raised again.
      if (type === 'streak' || (type === 'bid' && ('iso2' in ev.answer || state.bidPhase === 'collect'))) return state
      if (type === 'draw') {
        if (state.myAnswer && 'strokes' in state.myAnswer && state.myAnswer.done) return state
        return { ...state, myAnswer: ev.answer }
      }
      if (type === 'bid' && state.bidPhase === 'bid' && state.players.length > 1) return { ...state, myAnswer: ev.answer }
      return state.myAnswer ? state : { ...state, myAnswer: ev.answer }
    }
    case 'host': {
      const { msg, from } = ev
      // Once we know the host, ignore anything claiming to be host traffic from someone else.
      if (state.hostId && from !== state.hostId && msg.t !== 'rejected') return state
      switch (msg.t) {
        case 'rejected':
          return { ...state, phase: 'rejected', rejectedReason: msg.reason }
        case 'roster':
          return {
            ...state,
            phase: 'lobby',
            hostId: msg.hostId,
            players: msg.players,
            settings: msg.settings,
            question: null,
            answeredIds: [],
            myAnswer: null,
            bidPhase: null,
            bidProgress: {},
            auction: null,
            myPicks: [],
            streak: null,
            eliminated: [],
            reveal: null,
            totals: state.phase === 'finished' ? {} : state.totals,
            roundsPlayed: state.phase === 'finished' ? 0 : state.roundsPlayed,
          }
        case 'question':
          return {
            ...state,
            phase: 'question',
            question: { index: msg.index, total: msg.total, q: msg.q, receivedAt: Date.now(), timeLimitMs: msg.timeLimitMs },
            answeredIds: [],
            myAnswer: null,
            bidPhase: msg.q.type === 'bid' ? 'bid' : null,
            bidProgress: {},
            auction: msg.q.type === 'bid' && state.players.length > 1 ? { highBid: 0, highBidderId: null, passed: [], bids: {} } : null,
            myPicks: [],
            streak: null,
            eliminated: msg.q.eliminated ?? state.eliminated,
            reveal: null,
          }
        case 'answered':
          return state.question?.q.id === msg.questionId ? { ...state, answeredIds: msg.playerIds } : state
        case 'auction':
          if (state.question?.q.id !== msg.questionId) return state
          return {
            ...state,
            auction: msg.state,
            question: { ...state.question, receivedAt: Date.now(), timeLimitMs: msg.timeLimitMs },
          }
        case 'phase':
          if (state.question?.q.id !== msg.questionId) return state
          return {
            ...state,
            bidPhase: msg.phase,
            bidProgress: msg.progress,
            auction: null,
            answeredIds: [],
            question: { ...state.question, receivedAt: Date.now(), timeLimitMs: msg.timeLimitMs },
          }
        case 'pick':
          if (state.question?.q.id !== msg.questionId || state.myPicks.some((p) => p.iso2 === msg.iso2)) return state
          return { ...state, myPicks: [...state.myPicks, { iso2: msg.iso2, ok: msg.ok }] }
        case 'progress':
          return state.question?.q.id === msg.questionId ? { ...state, bidProgress: msg.progress } : state
        case 'streak': {
          if (state.question?.q.id !== msg.questionId) return state
          const turnChanged = !state.streak || state.streak.turn !== msg.state.turn
          return {
            ...state,
            streak: msg.state,
            question: turnChanged ? { ...state.question, receivedAt: Date.now(), timeLimitMs: STREAK_SECONDS * 1000 } : state.question,
          }
        }
        case 'reveal':
          return state.question?.q.id === msg.questionId
            ? { ...state, phase: 'reveal', reveal: msg, totals: msg.totals, eliminated: msg.eliminated ?? state.eliminated }
            : state
        case 'finished':
          return { ...state, phase: 'finished', totals: msg.totals, roundsPlayed: msg.rounds }
      }
    }
  }
  return state
}
