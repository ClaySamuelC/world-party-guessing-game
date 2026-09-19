import { useEffect, useState } from 'react'
import type { Dataset } from '../data/load'
import { useSession, type SessionConfig } from '../game/useSession'
import { Lobby } from './Lobby'
import { Play } from './Play'
import { Results } from './Results'

/** Renders whichever screen the room phase calls for. */
export function Session({ config, dataset, onLeave }: { config: SessionConfig; dataset: Dataset; onLeave: () => void }) {
  const { state, selfId, submitAnswer, hostActions } = useSession(config, dataset)
  const [slow, setSlow] = useState(false)

  useEffect(() => {
    if (state.phase !== 'connecting') return
    const id = setTimeout(() => setSlow(true), 15000)
    return () => clearTimeout(id)
  }, [state.phase])

  switch (state.phase) {
    case 'connecting':
      return (
        <Notice title={`Joining room ${config.code}…`} onLeave={onLeave}>
          <p className="muted">Looking for the host over the peer network. This usually takes a few seconds.</p>
          {slow && (
            <p className="muted">
              Still connecting. Check the code, make sure the host still has the lobby open, and note that some school or office networks block
              WebRTC.
            </p>
          )}
        </Notice>
      )
    case 'lobby':
      return <Lobby state={state} code={config.code} selfId={selfId} hostActions={hostActions} onLeave={onLeave} />
    case 'question':
    case 'reveal':
      return <Play dataset={dataset} state={state} selfId={selfId} submitAnswer={submitAnswer} onLeave={onLeave} />
    case 'finished':
      return <Results state={state} selfId={selfId} hostActions={hostActions} onLeave={onLeave} />
    case 'rejected':
      return (
        <Notice title="Could not join" onLeave={onLeave}>
          <p>{state.rejectedReason}</p>
        </Notice>
      )
    case 'host-left':
      return (
        <Notice title="The host left" onLeave={onLeave}>
          <p className="muted">The host's browser disconnected, so this match is over. Someone can host a new room from the home screen.</p>
        </Notice>
      )
  }
}

function Notice({ title, children, onLeave }: { title: string; children: React.ReactNode; onLeave: () => void }) {
  return (
    <div className="home">
      <div className="home-card">
        <h1>{title}</h1>
        {children}
        <button className="btn ghost" onClick={onLeave}>
          Back to home
        </button>
      </div>
    </div>
  )
}
