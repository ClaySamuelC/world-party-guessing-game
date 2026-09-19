import { useState } from 'react'
import type { RoomState } from '../game/client'
import type { HostActions } from '../game/useSession'
import { MAX_PLAYERS, MINI_GAMES, type MiniGameId } from '../game/questions'
import { getFrameAnswers, setFrameAnswers } from './prefs'

interface Props {
  state: RoomState
  code: string | null
  selfId: string
  hostActions: HostActions | null
  onLeave: () => void
}

export function Lobby({ state, code, selfId, hostActions, onLeave }: Props) {
  const [copied, setCopied] = useState(false)
  const [autoFrame, setAutoFrame] = useState(getFrameAnswers)
  const isHost = !!hostActions
  const link = code ? `${location.origin}${location.pathname}?room=${code}` : null
  const s = state.settings

  const toggleType = (id: MiniGameId, on: boolean) => {
    const types = on ? [...s.types, id] : s.types.filter((t) => t !== id)
    if (!types.length) return
    hostActions?.updateSettings({ types })
  }

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

        <h3>Mini-games</h3>
        <p className="muted">Questions rotate through the checked games. Leave them all on for the full party pack.</p>
        <ul className="game-picks">
          {MINI_GAMES.map((g) => {
            const on = s.types.includes(g.id)
            return (
              <li key={g.id} className={on ? 'on' : ''}>
                <label className="check">
                  <input type="checkbox" disabled={!isHost || (on && s.types.length === 1)} checked={on} onChange={(e) => toggleType(g.id, e.target.checked)} />
                  <span>
                    <strong>{g.name}</strong>
                    <small>{g.blurb}</small>
                  </span>
                </label>
              </li>
            )
          })}
        </ul>

        <h3>Settings</h3>
        <div className="settings">
          <label>
            <span>Rounds</span>
            <select
              disabled={!isHost}
              value={s.endless ? 'endless' : String(s.rounds)}
              onChange={(e) => {
                if (e.target.value === 'endless') hostActions?.updateSettings({ endless: true })
                else hostActions?.updateSettings({ endless: false, rounds: Number(e.target.value) })
              }}
            >
              <option value="endless">Endless</option>
              {[5, 10, 15, 20, 30].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          {s.endless && <p className="muted">Questions keep coming until you end the match.</p>}
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
          {(s.types.includes('bid') || s.types.includes('streak')) && (
            <p className="muted">Bid and guess adds 2 s of collecting time per country bid. Guessing streak: any order, three strikes then the next player picks up (or the question ends in solo).</p>
          )}
          <label className="check">
            <input
              type="checkbox"
              checked={autoFrame}
              onChange={(e) => {
                setAutoFrame(e.target.checked)
                setFrameAnswers(e.target.checked)
              }}
            />
            <span>Zoom the map to my guess and the answer after each question</span>
          </label>
          <p className="muted">Only on your screen. Turn this off if you want to keep the camera where you left it.</p>
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
