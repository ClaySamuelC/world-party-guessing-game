import { useState } from 'react'
import type { RoomState } from '../game/client'
import type { HostActions } from '../game/useSession'
import { ELIMINATE_SCOPES, MAX_PLAYERS, PARTY_GAMES, type MatchMode, type MiniGameId } from '../game/questions'
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

        <h3>Game mode</h3>
        <div className="mode-picks">
          {(
            [
              { id: 'party' as MatchMode, name: 'Party pack', blurb: 'The main mix: click, pin, language, exports, history, bid, streak, name, and draw.' },
              { id: 'eliminate' as MatchMode, name: 'Elimination', blurb: 'Only this: click the named country to knock it out. Misses stay in the pool.' },
            ] as const
          ).map((mode) => (
            <button
              key={mode.id}
              type="button"
              className={`mode-pick ${s.matchMode === mode.id ? 'on' : ''}`}
              disabled={!isHost}
              onClick={() => hostActions?.updateSettings({ matchMode: mode.id })}
            >
              <strong>{mode.name}</strong>
              <small>{mode.blurb}</small>
            </button>
          ))}
        </div>

        {s.matchMode === 'party' && (
          <>
            <h3>Mini-games</h3>
            <p className="muted">Questions rotate through the checked games. Leave them all on for the full party pack.</p>
            <ul className="game-picks">
              {PARTY_GAMES.map((g) => {
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
          </>
        )}

        {s.matchMode === 'eliminate' && (
          <p className="muted">Elimination is the whole match. Pick a continent (or the world) below, then start.</p>
        )}

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
          {s.matchMode === 'party' && (s.types.includes('bid') || s.types.includes('streak')) && (
            <p className="muted">Bid and guess: in a party, 30 s auction clock that resets on every raise, until nobody outbids. Winner must then click that many (plus 2 s each). Solo: 30 seconds to click as many as you can — wrong clicks lose points. Guessing streak: 45 s per turn, any order, three strikes then the next player picks up (or the question ends in solo).</p>
          )}
          {s.matchMode === 'eliminate' && (
            <label>
              <span>Elimination pool</span>
              <select
                disabled={!isHost}
                value={s.eliminateScope}
                onChange={(e) => hostActions?.updateSettings({ eliminateScope: e.target.value as typeof s.eliminateScope })}
              >
                {ELIMINATE_SCOPES.map((scope) => (
                  <option key={scope.id} value={scope.id}>
                    {scope.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {s.matchMode === 'party' && (s.types.includes('pin') || s.types.includes('history')) && (
            <label className="check">
              <input
                type="checkbox"
                disabled={!isHost}
                checked={s.pinCircle}
                onChange={(e) => hostActions?.updateSettings({ pinCircle: e.target.checked })}
              />
              <span>Pin with a circle: click and hold, drag to grow. Smaller circles that cover the spot score more; a miss is zero.</span>
            </label>
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
