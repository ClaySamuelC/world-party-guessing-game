import type { Answer, AnswerKey, MatchSettings, PublicQuestion } from './questions'

export interface Player {
  id: string
  name: string
}

export interface PlayerResult {
  answer: Answer | null
  /** Points earned this question (can be negative in Bid and Guess). */
  score: number
  /** Click / language questions only. */
  correct?: boolean
  /** Pin / history questions only. */
  distanceKm?: number
  /** Bid and Guess: the bid, what was found, what was clicked wrongly, and whether the bid overshot the set. */
  bid?: number
  hits?: string[]
  misses?: string[]
  overbid?: boolean
  /** Guessing streak: how many ranks this player claimed. */
  streak?: number
}

/** Bid and Guess: what everyone can see about each player's progress during the collect phase. */
export interface BidProgress {
  bid: number | null
  hits: number
  misses: number
  overbid: boolean
  done: boolean
}

/** Guessing Streak: shared turn state. */
export interface StreakState {
  /** Whose clicks count right now; null once the list is done or everyone is out. */
  activeId: string | null
  /** Bumps every time the turn passes, so clients can restart their timer. */
  turn: number
  /** How many of the target set have been claimed. */
  found: number
  /** Target set size. */
  total: number
  /** Wrong clicks by the active player so far this turn (out at STREAK_STRIKES). */
  strikes: number
  /** Max strikes before you are out. */
  maxStrikes: number
  /** Claimed countries, with who claimed them (any order). */
  claimed: { iso2: string; playerId: string }[]
  /** Latest wrong click, with rank context for the UI. */
  lastMiss: { playerId: string; iso2: string; name: string; rank: number; value: string; metric: string; total: number } | null
  /** Wrong iso2s already counted as a strike this turn (re-clicks do not cost another). */
  missed: string[]
  /** Players who already had their turn this question. */
  finished: string[]
}

/** Host -> everyone (host applies them locally too). */
export type HostMessage =
  | { t: 'roster'; hostId: string; players: Player[]; settings: MatchSettings }
  | { t: 'rejected'; reason: string }
  | { t: 'question'; index: number; total: number; q: PublicQuestion; timeLimitMs: number }
  | { t: 'answered'; questionId: string; playerIds: string[] }
  /** Bid and Guess moves from bidding to collecting; the timer restarts with a fresh limit. */
  | { t: 'phase'; questionId: string; phase: 'collect'; timeLimitMs: number; progress: Record<string, BidProgress> }
  /** Result of one of *your* clicks in the collect phase (sent only to that player). */
  | { t: 'pick'; questionId: string; iso2: string; ok: boolean }
  | { t: 'progress'; questionId: string; progress: Record<string, BidProgress> }
  | { t: 'streak'; questionId: string; state: StreakState }
  | { t: 'reveal'; questionId: string; key: AnswerKey; results: Record<string, PlayerResult>; totals: Record<string, number> }
  | { t: 'finished'; totals: Record<string, number>; rounds: number }

/** Guest -> host. */
export type GuestMessage = { t: 'hello'; name: string } | { t: 'answer'; questionId: string; answer: Answer }

export type Message = HostMessage | GuestMessage

export const HOST_MESSAGE_TYPES = new Set<Message['t']>(['roster', 'rejected', 'question', 'answered', 'phase', 'pick', 'progress', 'streak', 'reveal', 'finished'])
