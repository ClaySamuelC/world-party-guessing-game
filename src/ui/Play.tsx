import { useEffect, useMemo, useState } from 'react'
import type { Dataset } from '../data/load'
import type { RoomState } from '../game/client'
import type { Answer } from '../game/questions'
import { formatKm } from '../game/scoring'
import { WorldMap, type CountryRole, type MapPin } from '../map/WorldMap'
import { CountryPanel } from './CountryPanel'
import { CountrySearch } from './CountrySearch'
import { SvgImage } from './Flag'
import { Scoreboard } from './Scoreboard'

interface Props {
  dataset: Dataset
  state: RoomState
  selfId: string
  submitAnswer: (a: Answer) => void
  onLeave: () => void
}

const PLAYER_COLORS = ['#fbbf24', '#60a5fa', '#f472b6', '#a78bfa', '#34d399', '#fb923c', '#22d3ee', '#e879f9']

export function Play({ dataset, state, selfId, submitAnswer, onLeave }: Props) {
  const q = state.question!
  const reveal = state.phase === 'reveal' ? state.reveal : null
  const answered = !!state.myAnswer
  const [now, setNow] = useState(q.receivedAt)

  useEffect(() => {
    if (state.phase !== 'question') return
    const id = setInterval(() => setNow(Date.now()), 100)
    return () => clearInterval(id)
  }, [state.phase, q.q.id])

  const msLeft = Math.max(0, q.receivedAt + q.timeLimitMs - now)
  const secondsLeft = Math.ceil(msLeft / 1000)

  // Country roles: my pick while answering; correct/wrong after the reveal.
  const roles = useMemo(() => {
    const r: Record<string, CountryRole> = {}
    if (q.q.type !== 'click') return r
    if (reveal?.key.type === 'click') {
      for (const res of Object.values(reveal.results)) if (res.answer && 'iso2' in res.answer && res.answer.iso2 !== reveal.key.iso2) r[res.answer.iso2] = 'wrong'
      r[reveal.key.iso2] = 'correct'
    } else if (state.myAnswer && 'iso2' in state.myAnswer) r[state.myAnswer.iso2] = 'selected'
    return r
  }, [q.q.type, reveal, state.myAnswer])

  // Pins: mine while answering; everyone's plus the target after the reveal.
  const { pins, lines } = useMemo(() => {
    const pins: MapPin[] = []
    const lines: { from: [number, number]; to: [number, number]; color?: string }[] = []
    if (q.q.type !== 'pin') return { pins, lines }
    const colorOf = (id: string) => PLAYER_COLORS[Math.max(0, state.players.findIndex((p) => p.id === id)) % PLAYER_COLORS.length]
    if (reveal?.key.type === 'pin') {
      for (const [id, res] of Object.entries(reveal.results)) {
        if (!res.answer || !('lat' in res.answer)) continue
        const name = state.players.find((p) => p.id === id)?.name ?? '?'
        pins.push({ id, lat: res.answer.lat, lng: res.answer.lng, label: `${name} · ${formatKm(res.distanceKm ?? 0)}`, kind: id === selfId ? 'mine' : 'other', color: colorOf(id) })
        if (id === selfId) lines.push({ from: [res.answer.lat, res.answer.lng], to: [reveal.key.lat, reveal.key.lng], color: colorOf(id) })
      }
      pins.push({ id: 'target', lat: reveal.key.lat, lng: reveal.key.lng, label: reveal.key.name, kind: 'target' })
    } else if (state.myAnswer && 'lat' in state.myAnswer) {
      pins.push({ id: 'mine', lat: state.myAnswer.lat, lng: state.myAnswer.lng, label: 'Your pin', kind: 'mine' })
    }
    return { pins, lines }
  }, [q.q.type, reveal, state.myAnswer, state.players, selfId])

  const interaction = reveal || answered ? 'none' : q.q.type === 'click' ? 'country' : 'pin'
  const myResult = reveal?.results[selfId]
  const deltas = reveal ? Object.fromEntries(Object.entries(reveal.results).map(([id, r]) => [id, r.score])) : undefined
  const revealCountry = reveal?.key.type === 'click' ? dataset.countries[reveal.key.iso2] : reveal?.key.iso2 ? dataset.countries[reveal.key.iso2] : null

  return (
    <div className="screen">
      <WorldMap
        geojson={dataset.geojson}
        interaction={interaction}
        roles={roles}
        pins={pins}
        lines={lines}
        onCountryClick={(iso2) => submitAnswer({ iso2 })}
        onMapClick={(lat, lng) => submitAnswer({ lat, lng })}
      />

      <div className="overlay top-center prompt">
        <div className="prompt-meta">
          <span>
            Question {q.index + 1} / {q.total}
          </span>
          <span className={`timer ${!reveal && secondsLeft <= 5 ? 'urgent' : ''}`}>{reveal ? 'Reveal' : `${secondsLeft}s`}</span>
        </div>
        <div className="prompt-text">{q.q.text}</div>
        {q.q.hint && <div className="prompt-hint">{q.q.hint}</div>}
        {q.q.flagSvg && <SvgImage svg={q.q.flagSvg} alt="Flag" className="prompt-flag" />}
        {!reveal && (
          <div className="prompt-status">
            {answered ? 'Locked in. Waiting for others…' : q.q.type === 'click' ? 'Click the country on the map, or search below.' : 'Click anywhere on the map to drop your pin.'}
          </div>
        )}
        {!reveal && !answered && q.q.type === 'click' && (
          <CountrySearch countries={dataset.countryList} onSelect={(c) => submitAnswer({ iso2: c.iso2 })} placeholder="Too small to click? Search it here" />
        )}
      </div>

      <div className="overlay top-right">
        <button className="btn ghost small" onClick={onLeave}>
          Leave
        </button>
        <div className="panel">
          <Scoreboard players={state.players} totals={state.totals} selfId={selfId} answeredIds={reveal ? undefined : state.answeredIds} deltas={deltas} />
        </div>
      </div>

      {reveal && (
        <div className="overlay bottom-left reveal">
          <div className="panel result-banner">
            {reveal.key.type === 'click' ? (
              myResult?.correct ? (
                <strong className="good">Correct! +{myResult.score}</strong>
              ) : myResult?.answer ? (
                <strong className="bad">Not quite. That was {dataset.countries[(myResult.answer as { iso2: string }).iso2]?.exonymEn ?? 'somewhere else'}.</strong>
              ) : (
                <strong className="bad">No answer.</strong>
              )
            ) : myResult?.answer ? (
              <strong className={myResult.score >= 500 ? 'good' : ''}>
                {formatKm(myResult.distanceKm ?? 0)} from {reveal.key.name}. +{myResult.score}
              </strong>
            ) : (
              <strong className="bad">No pin placed.</strong>
            )}
          </div>
          {revealCountry && <CountryPanel country={revealCountry} />}
        </div>
      )}
    </div>
  )
}
