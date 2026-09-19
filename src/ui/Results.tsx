import type { RoomState } from '../game/client'
import type { HostActions } from '../game/useSession'
import { Scoreboard } from './Scoreboard'

interface Props {
  state: RoomState
  selfId: string
  hostActions: HostActions | null
  onLeave: () => void
}

export function Results({ state, selfId, hostActions, onLeave }: Props) {
  const ranked = state.players.slice().sort((a, b) => (state.totals[b.id] ?? 0) - (state.totals[a.id] ?? 0))
  const winner = ranked[0]
  return (
    <div className="home">
      <div className="home-card">
        <h1>Final scores</h1>
        {winner && (
          <p className="tagline">
            {state.settings.endless
              ? `${state.roundsPlayed} question${state.roundsPlayed === 1 ? '' : 's'} · ${state.totals[selfId] ?? 0} points`
              : `${winner.id === selfId ? 'You win!' : `${winner.name} wins!`} ${state.totals[winner.id] ?? 0} points.`}
          </p>
        )}
        <div className="panel">
          <Scoreboard players={state.players} totals={state.totals} selfId={selfId} />
        </div>
        <div className="row gap">
          {hostActions ? (
            <button className="btn primary" onClick={hostActions.backToLobby}>
              Play again
            </button>
          ) : (
            <p className="muted">The host can start another round from the lobby.</p>
          )}
          <button className="btn ghost" onClick={onLeave}>
            Leave
          </button>
        </div>
      </div>
    </div>
  )
}
