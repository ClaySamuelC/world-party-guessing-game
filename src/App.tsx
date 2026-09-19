import { useEffect, useState } from 'react'
import { loadDataset, type Dataset } from './data/load'
import type { SessionConfig } from './game/useSession'
import { normalizeRoomCode } from './net/room'
import { Explore } from './ui/Explore'
import { Home } from './ui/Home'
import { Session } from './ui/Session'

type View = { kind: 'home' } | { kind: 'explore' } | { kind: 'session'; config: SessionConfig }

const NAME_KEY = 'wpgg:name'

export default function App() {
  const [dataset, setDataset] = useState<Dataset | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<View>({ kind: 'home' })
  const codeFromUrl = normalizeRoomCode(new URLSearchParams(location.search).get('room') ?? '')

  useEffect(() => {
    loadDataset().then(setDataset, (e: Error) => setError(e.message))
  }, [])

  if (error) return <div className="home"><div className="home-card"><h1>Could not load map data</h1><p>{error}</p></div></div>
  if (!dataset) return <div className="home"><div className="home-card"><h1>World Party Guessing Game</h1><p className="muted">Loading the world…</p></div></div>

  const startSession = (config: SessionConfig) => {
    localStorage.setItem(NAME_KEY, config.name)
    setView({ kind: 'session', config })
  }
  const goHome = () => {
    history.replaceState(null, '', location.pathname)
    setView({ kind: 'home' })
  }

  switch (view.kind) {
    case 'home':
      return (
        <Home
          initialName={localStorage.getItem(NAME_KEY) ?? ''}
          initialCode={codeFromUrl}
          sources={dataset.sources}
          onHost={(name, code) => startSession({ role: 'host', code, name })}
          onJoin={(name, code) => startSession({ role: 'guest', code, name })}
          onSolo={(name) => startSession({ role: 'solo', code: null, name })}
          onExplore={() => setView({ kind: 'explore' })}
        />
      )
    case 'explore':
      return <Explore dataset={dataset} onBack={goHome} />
    case 'session':
      return <Session key={`${view.config.role}-${view.config.code}`} config={view.config} dataset={dataset} onLeave={goHome} />
  }
}
