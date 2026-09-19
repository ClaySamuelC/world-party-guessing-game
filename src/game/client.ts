import { DEFAULT_SETTINGS, type Answer, type MatchSettings, type PublicQuestion } from './questions'
import type { HostMessage, Player } from './protocol'

export type Phase = 'connecting' | 'lobby' | 'question' | 'reveal' | 'finished' | 'rejected' | 'host-left'

/** Everything a player's screen needs. Built purely from host messages plus local actions. */
export interface RoomState {
  phase: Phase
  hostId: string | null
  players: Player[]
  settings: MatchSettings
  question: { index: number; total: number; q: PublicQuestion; receivedAt: number; timeLimitMs: number } | null
  answeredIds: string[]
  myAnswer: Answer | null
  reveal: Extract<HostMessage, { t: 'reveal' }> | null
  totals: Record<string, number>
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
  reveal: null,
  totals: {},
  rejectedReason: null,
}

export type ClientEvent =
  | { kind: 'host'; msg: HostMessage; from: string }
  | { kind: 'local-answer'; answer: Answer }
  | { kind: 'host-left' }
  | { kind: 'reset' }

export function roomReducer(state: RoomState, ev: ClientEvent): RoomState {
  switch (ev.kind) {
    case 'reset':
      return initialRoomState
    case 'host-left':
      return state.phase === 'rejected' ? state : { ...state, phase: 'host-left' }
    case 'local-answer':
      return state.phase === 'question' && !state.myAnswer ? { ...state, myAnswer: ev.answer } : state
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
            reveal: null,
            totals: state.phase === 'finished' ? {} : state.totals,
          }
        case 'question':
          return {
            ...state,
            phase: 'question',
            question: { index: msg.index, total: msg.total, q: msg.q, receivedAt: Date.now(), timeLimitMs: msg.timeLimitMs },
            answeredIds: [],
            myAnswer: null,
            reveal: null,
          }
        case 'answered':
          return state.question?.q.id === msg.questionId ? { ...state, answeredIds: msg.playerIds } : state
        case 'reveal':
          return state.question?.q.id === msg.questionId
            ? { ...state, phase: 'reveal', reveal: msg, totals: msg.totals }
            : state
        case 'finished':
          return { ...state, phase: 'finished', totals: msg.totals }
      }
    }
  }
  return state
}
