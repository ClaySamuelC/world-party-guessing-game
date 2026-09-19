import { useState } from 'react'
import type { SourcesManifest } from '../data/types'
import { makeRoomCode, normalizeRoomCode } from '../net/room'
import { MAX_PLAYERS } from '../game/questions'

interface Props {
  initialName: string
  initialCode: string
  sources: SourcesManifest
  onHost: (name: string, code: string) => void
  onJoin: (name: string, code: string) => void
  onSolo: (name: string) => void
  onExplore: () => void
}

export function Home({ initialName, initialCode, sources, onHost, onJoin, onSolo, onExplore }: Props) {
  const [name, setName] = useState(initialName)
  const [code, setCode] = useState(initialCode)
  const [showSources, setShowSources] = useState(false)
  const cleanName = name.trim() || 'Player'
  const cleanCode = normalizeRoomCode(code)

  return (
    <div className="home">
      <div className="home-card">
        <h1>World Party Guessing Game</h1>
        <p className="tagline">Six mini-games on a shared world map: click countries, pin cities and history, read a language, bid on categories, and run a streak. Up to {MAX_PLAYERS} friends, peer-to-peer, no server.</p>

        <label className="field">
          <span>Your name</span>
          <input value={name} maxLength={24} placeholder="Player" onChange={(e) => setName(e.target.value)} />
        </label>

        <div className="home-actions">
          <button className="btn primary" onClick={() => onHost(cleanName, makeRoomCode())}>
            Host a party
          </button>
          <form
            className="join-row"
            onSubmit={(e) => {
              e.preventDefault()
              if (cleanCode.length >= 4) onJoin(cleanName, cleanCode)
            }}
          >
            <input
              value={code}
              placeholder="Room code"
              maxLength={8}
              autoCapitalize="characters"
              onChange={(e) => setCode(normalizeRoomCode(e.target.value))}
            />
            <button className="btn" type="submit" disabled={cleanCode.length < 4}>
              Join
            </button>
          </form>
          <div className="row gap">
            <button className="btn ghost" onClick={() => onSolo(cleanName)}>
              Practice solo
            </button>
            <button className="btn ghost" onClick={onExplore}>
              Explore the map
            </button>
          </div>
        </div>

        <p className="fineprint">
          Data: Natural Earth, Unicode CLDR, UN World Population Prospects, World Bank.{' '}
          <button className="link" onClick={() => setShowSources((s) => !s)}>
            {showSources ? 'Hide sources' : 'All sources'}
          </button>
        </p>
        {showSources && (
          <ul className="sources">
            {sources.sources.map((s) => (
              <li key={s.name}>
                <a href={s.url} target="_blank" rel="noreferrer">
                  {s.name}
                </a>{' '}
                <em>({s.license})</em> — {s.use}
              </li>
            ))}
            {sources.notes.map((n) => (
              <li key={n} className="note">
                {n}
              </li>
            ))}
            <li className="note">Snapshot generated {new Date(sources.generatedAt).toLocaleDateString()}.</li>
          </ul>
        )}
      </div>
    </div>
  )
}
