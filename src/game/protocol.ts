import type { Answer, AnswerKey, MatchSettings, PublicQuestion } from './questions'

export interface Player {
  id: string
  name: string
}

export interface PlayerResult {
  answer: Answer | null
  score: number
  /** Click questions only. */
  correct?: boolean
  /** Pin questions only. */
  distanceKm?: number
}

/** Host -> everyone (host applies them locally too). */
export type HostMessage =
  | { t: 'roster'; hostId: string; players: Player[]; settings: MatchSettings }
  | { t: 'rejected'; reason: string }
  | { t: 'question'; index: number; total: number; q: PublicQuestion; timeLimitMs: number }
  | { t: 'answered'; questionId: string; playerIds: string[] }
  | { t: 'reveal'; questionId: string; key: AnswerKey; results: Record<string, PlayerResult>; totals: Record<string, number> }
  | { t: 'finished'; totals: Record<string, number> }

/** Guest -> host. */
export type GuestMessage = { t: 'hello'; name: string } | { t: 'answer'; questionId: string; answer: Answer }

export type Message = HostMessage | GuestMessage

export const HOST_MESSAGE_TYPES = new Set<Message['t']>(['roster', 'rejected', 'question', 'answered', 'reveal', 'finished'])
