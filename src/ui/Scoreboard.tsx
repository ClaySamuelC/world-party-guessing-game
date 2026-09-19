import type { Player } from '../game/protocol'

interface Props {
  players: Player[]
  totals: Record<string, number>
  selfId: string
  answeredIds?: string[]
  /** Per-player delta shown after a reveal. */
  deltas?: Record<string, number>
}

export function Scoreboard({ players, totals, selfId, answeredIds, deltas }: Props) {
  const ranked = players.slice().sort((a, b) => (totals[b.id] ?? 0) - (totals[a.id] ?? 0))
  return (
    <ol className="scoreboard">
      {ranked.map((p, i) => (
        <li key={p.id} className={p.id === selfId ? 'me' : ''}>
          <span className="rank">{i + 1}</span>
          <span className="name">
            {p.name}
            {answeredIds?.includes(p.id) && <span className="check">✓</span>}
          </span>
          {deltas && deltas[p.id] != null && <span className={`delta ${deltas[p.id] > 0 ? 'pos' : ''}`}>+{deltas[p.id]}</span>}
          <span className="total">{totals[p.id] ?? 0}</span>
        </li>
      ))}
    </ol>
  )
}
