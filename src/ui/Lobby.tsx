import { useState } from 'react'
import type { RoomState } from '../game/client'
import type { HostActions } from '../game/useSession'
import { MAX_PLAYERS, type GameMode } from '../game/questions'

interface Props {
  state: RoomState
  code: string | null
  selfId: string
  hostActions: HostActions | null
  onLeave: () => void
}

export function Lobby({ state, code, selfId, hostActions, onLeave }: Props) {
  const [copied, setCopied] = useState(false)
  const isHost = !!hostActions
  const link = code ? `${location.origin}${location.pathname}?room=${code}` : null
  const s = state.settings

  const copy = async () => {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard unavailable; the link is visible anyway */
    }
  }

  return (
    <div className="home">
      <div className="home-card lobby">
        <div className="row space">
          <h1>{code ? 'Lobby' : 'Solo practice'}</h1>
          <button className="btn ghost" onClick={onLeave}>
            Leave
          </button>
        </div>

        {code && (
          <div className="room-code-box">
            <div>
              <div className="label">Room code</div>
              <div className="room-code">{code}</div>
            </div>
            <button className="btn" onClick={copy}>
              {copied ? 'Copied!' : 'Copy invite link'}
            </button>
          </div>
        )}

        <h3>
          Players ({state.players.length}/{MAX_PLAYERS})
        </h3>
        <ul className="players">
          {state.players.map((p) => (
            <li key={p.id}>
              {p.name}
              {p.id === state.hostId && <span className="tag">host</span>}
              {p.id === selfId && <span className="tag you">you</span>}
            </li>
          ))}
        </ul>
        {code && state.players.length < 2 && <p className="muted">Share the code or link. Friends appear here as they connect.</p>}

        <h3>Settings</h3>
        <div className="settings">
          <label>
            <span>Questions</span>
            <select disabled={!isHost} value={s.mode} onChange={(e) => hostActions?.updateSettings({ mode: e.target.value as GameMode })}>
              <option value="both">Country click + pin the location</option>
              <option value="click">Country click only</option>
              <option value="pin">Pin the location only</option>
            </select>
          </label>
          <label>
            <span>Rounds</span>
            <select disabled={!isHost} value={s.rounds} onChange={(e) => hostActions?.updateSettings({ rounds: Number(e.target.value) })}>
              {[5, 10, 15, 20, 30].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Seconds per question</span>
            <select disabled={!isHost} value={s.timeLimit} onChange={(e) => hostActions?.updateSettings({ timeLimit: Number(e.target.value) })}>
              {[10, 15, 20, 30, 45].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        </div>

        {isHost ? (
          <button className="btn primary big" onClick={hostActions.start}>
            Start match
          </button>
        ) : (
          <p className="muted">Waiting for the host to start…</p>
        )}
      </div>
    </div>
  )
}
