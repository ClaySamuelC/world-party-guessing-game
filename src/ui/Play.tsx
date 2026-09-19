import { useEffect, useMemo, useRef, useState } from 'react'
import type { Dataset } from '../data/load'
import type { Country } from '../data/types'
import type { RoomState } from '../game/client'
import type { BidProgress, PlayerResult } from '../game/protocol'
import { MINI_GAMES, type Answer, type PublicQuestion } from '../game/questions'
import { formatKm, scoreBid } from '../game/scoring'
import type { HostActions } from '../game/useSession'
import { WorldMap, type CountryRole, type MapPin } from '../map/WorldMap'
import { CountryPanel } from './CountryPanel'
import { CountrySearch } from './CountrySearch'
import { SvgImage } from './Flag'
import { getFrameAnswers, setFrameAnswers } from './prefs'
import { Scoreboard } from './Scoreboard'

interface Props {
  dataset: Dataset
  state: RoomState
  selfId: string
  submitAnswer: (a: Answer) => void
  hostActions: HostActions | null
  onLeave: () => void
}

const PLAYER_COLORS = ['#fbbf24', '#60a5fa', '#f472b6', '#a78bfa', '#34d399', '#fb923c', '#22d3ee', '#e879f9']
const GAME_NAME = Object.fromEntries(MINI_GAMES.map((g) => [g.id, g.name])) as Record<PublicQuestion['type'], string>

type Box = [number, number, number, number]

function unionBoxes(boxes: Box[]): Box | null {
  if (!boxes.length) return null
  let [w, s, e, n] = boxes[0]
  for (let i = 1; i < boxes.length; i++) {
    const b = boxes[i]
    w = Math.min(w, b[0])
    s = Math.min(s, b[1])
    e = Math.max(e, b[2])
    n = Math.max(n, b[3])
  }
  return [w, s, e, n]
}

function pointBox(lat: number, lng: number): Box {
  return [lng - 1.6, lat - 1.2, lng + 1.6, lat + 1.2]
}

function signed(n: number) {
  return n > 0 ? `+${n}` : String(n)
}

/**
 * Self-driving countdown. Runs its own animation frame loop and writes straight to the DOM so the
 * rest of the screen (and the map) does not re-render 20 times a second.
 */
function TimerClock({ startAt, durationMs, frozen }: { startAt: number; durationMs: number; frozen: boolean }) {
  const pieRef = useRef<HTMLDivElement>(null)
  const secsRef = useRef<HTMLSpanElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let raf = 0
    let lastSecs = -1
    let lastDeg = -1
    const paint = () => {
      const remaining = frozen ? 0 : Math.max(0, Math.min(1, (startAt + durationMs - Date.now()) / durationMs))
      const deg = Math.round((1 - remaining) * 360)
      const secs = frozen ? 0 : Math.ceil((remaining * durationMs) / 1000)
      if (deg !== lastDeg && pieRef.current) {
        lastDeg = deg
        pieRef.current.style.background = `conic-gradient(from -90deg, transparent 0deg ${deg}deg, var(--pie) ${deg}deg 360deg)`
      }
      if (secs !== lastSecs) {
        lastSecs = secs
        if (secsRef.current) secsRef.current.textContent = String(secs)
        rootRef.current?.classList.toggle('urgent', !frozen && remaining <= 0.25)
      }
      if (!frozen && remaining > 0) raf = requestAnimationFrame(paint)
    }
    paint()
    return () => cancelAnimationFrame(raf)
  }, [startAt, durationMs, frozen])
  return (
    <div ref={rootRef} className="timer-clock" aria-label="Time left">
      <div ref={pieRef} className="timer-pie" />
      <span ref={secsRef} className="timer-secs" />
    </div>
  )
}

function BidForm({ onBid, max }: { onBid: (n: number) => void; max: number }) {
  const [value, setValue] = useState('')
  const n = Number(value)
  const ok = value !== '' && Number.isInteger(n) && n >= 0 && n <= max
  return (
    <form
      className="bid-form"
      onSubmit={(e) => {
        e.preventDefault()
        if (ok) onBid(n)
      }}
    >
      <input
        className="bid-input"
        type="number"
        inputMode="numeric"
        min={0}
        max={max}
        step={1}
        autoFocus
        placeholder="0"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        aria-label="Your bid"
      />
      <button type="submit" className="btn primary" disabled={!ok}>
        Bid
      </button>
    </form>
  )
}

function SourceLink({ url, label }: { url?: string; label?: string }) {
  if (!url) return null
  return (
    <a className="source-link" href={url} target="_blank" rel="noreferrer">
      {label ?? 'Source'} ↗
    </a>
  )
}

function names(iso2s: string[], countries: Record<string, Country>, limit = 8) {
  const list = iso2s.map((i) => countries[i]?.exonymEn ?? i)
  if (list.length <= limit) return list.join(', ')
  return `${list.slice(0, limit).join(', ')} and ${list.length - limit} more`
}

export function Play({ dataset, state, selfId, submitAnswer, hostActions, onLeave }: Props) {
  const q = state.question!
  const type = q.q.type
  const reveal = state.phase === 'reveal' ? state.reveal : null
  const answered = !!state.myAnswer
  const [autoFrame, setAutoFrame] = useState(getFrameAnswers)
  const [flyTo, setFlyTo] = useState<{
    nonce: number
    bbox?: Box
    center?: [number, number]
    zoom?: number
    save?: boolean
    restore?: boolean
    instant?: boolean
  } | null>(null)
  const framedRef = useRef(false)
  const framedForRef = useRef<string | null>(null)

  const continueMatch = () => {
    if (framedRef.current) {
      framedRef.current = false
      setFlyTo({ nonce: Date.now(), restore: true, instant: true })
    }
    hostActions?.advance()
  }
  const continueRef = useRef(continueMatch)
  continueRef.current = continueMatch

  useEffect(() => {
    if (state.phase !== 'reveal' || !hostActions) return
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return
      if (e.code === 'Space' || e.key === ' ') {
        e.preventDefault()
        continueRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [state.phase, hostActions])

  const myProgress: BidProgress | undefined = state.bidProgress[selfId]
  const streak = state.streak
  const myTurn = type === 'streak' && streak?.activeId === selfId
  const activePlayer = streak?.activeId ? state.players.find((p) => p.id === streak.activeId) : null
  const myResult: PlayerResult | undefined = reveal?.results[selfId]
  const myIso2 = state.myAnswer && 'iso2' in state.myAnswer ? state.myAnswer.iso2 : null

  // Country roles: my pick while answering; correct/wrong/valid after the reveal.
  const roles = useMemo(() => {
    const r: Record<string, CountryRole> = {}
    if (type === 'pin' || type === 'history') return r
    if (reveal) {
      const k = reveal.key
      if (k.type === 'click') {
        for (const res of Object.values(reveal.results)) if (res.answer && 'iso2' in res.answer && res.answer.iso2 !== k.iso2) r[res.answer.iso2] = 'wrong'
        r[k.iso2] = 'correct'
      } else if (k.type === 'set' && type === 'language') {
        for (const iso2 of k.iso2s) r[iso2] = 'correct'
        if (myIso2 && !k.iso2s.includes(myIso2)) r[myIso2] = 'wrong'
      } else if (k.type === 'set') {
        for (const iso2 of k.iso2s) r[iso2] = 'valid'
        for (const iso2 of myResult?.hits ?? []) r[iso2] = 'correct'
        for (const iso2 of myResult?.misses ?? []) r[iso2] = 'wrong'
      } else if (k.type === 'ranked') {
        for (const iso2 of k.iso2s) r[iso2] = 'valid'
        for (const c of streak?.claimed ?? []) r[c.iso2] = 'correct'
        if (myResult?.answer && 'iso2s' in myResult.answer) {
          for (const iso2 of myResult.answer.iso2s) r[iso2] = 'correct'
        }
      }
      return r
    }
    if (type === 'bid') {
      for (const p of state.myPicks) r[p.iso2] = p.ok ? 'correct' : 'wrong'
    } else if (type === 'streak' && streak) {
      for (const c of streak.claimed) r[c.iso2] = 'correct'
      if (streak.lastMiss) r[streak.lastMiss.iso2] = 'wrong'
    } else if (myIso2) r[myIso2] = 'selected'
    return r
  }, [type, reveal, myIso2, myResult, state.myPicks, streak])

  // Pins: mine while answering; everyone's plus the target after the reveal.
  const { pins, lines } = useMemo(() => {
    const pins: MapPin[] = []
    const lines: { from: [number, number]; to: [number, number]; color?: string }[] = []
    if (type !== 'pin' && type !== 'history') return { pins, lines }
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
  }, [type, reveal, state.myAnswer, state.players, selfId])

  // What to frame after the reveal. Set-wide games (bid, streak) usually span the globe, so skip them.
  const frameBox = useMemo((): Box | null => {
    if (!reveal) return null
    const k = reveal.key
    const boxes: Box[] = []
    if (k.type === 'click') {
      const correct = dataset.countries[k.iso2]
      if (correct) boxes.push(correct.bbox)
      const guess = myIso2 ? dataset.countries[myIso2] : null
      if (guess) boxes.push(guess.bbox)
    } else if (k.type === 'pin') {
      boxes.push(pointBox(k.lat, k.lng))
      if (state.myAnswer && 'lat' in state.myAnswer) boxes.push(pointBox(state.myAnswer.lat, state.myAnswer.lng))
    } else if (k.type === 'set' && type === 'language') {
      // Highlight every official-language country; zoom to the whole set when it fits.
      for (const iso2 of k.iso2s) {
        const c = dataset.countries[iso2]
        if (c) boxes.push(c.bbox)
      }
      if (myIso2 && !k.iso2s.includes(myIso2)) {
        const guess = dataset.countries[myIso2]
        if (guess) boxes.push(guess.bbox)
      }
    } else return null
    const box = unionBoxes(boxes)
    // Skip auto-zoom when the set spans most of the world (e.g. Spanish).
    return box && box[2] - box[0] < 160 && box[3] - box[1] < 120 ? box : null
  }, [reveal, dataset.countries, myIso2, state.myAnswer, type])

  useEffect(() => {
    framedRef.current = false
    framedForRef.current = null
  }, [q.q.id])

  useEffect(() => {
    if (!reveal || !autoFrame || !frameBox) return
    if (framedForRef.current === q.q.id) return
    framedForRef.current = q.q.id
    framedRef.current = true
    setFlyTo({ nonce: Date.now(), bbox: frameBox, save: true })
  }, [reveal, autoFrame, frameBox, q.q.id])

  let interaction: 'country' | 'pin' | 'none' = 'none'
  if (!reveal) {
    if (type === 'click' || type === 'language') interaction = answered ? 'none' : 'country'
    else if (type === 'pin' || type === 'history') interaction = answered ? 'none' : 'pin'
    else if (type === 'bid') interaction = state.bidPhase === 'collect' && myProgress && !myProgress.done ? 'country' : 'none'
    else if (type === 'streak') interaction = myTurn ? 'country' : 'none'
  }
  const canPickCountry = interaction === 'country'

  const deltas = reveal ? Object.fromEntries(Object.entries(reveal.results).map(([id, r]) => [id, r.score])) : undefined
  const revealCountry =
    reveal?.key.type === 'click' ? dataset.countries[reveal.key.iso2] : reveal?.key.type === 'pin' && reveal.key.iso2 ? dataset.countries[reveal.key.iso2] : null
  const solo = state.players.length === 1
  const endless = state.settings.endless || q.total === 0
  const answeredIds = reveal
    ? undefined
    : type === 'bid' && state.bidPhase === 'collect'
      ? Object.entries(state.bidProgress)
          .filter(([, p]) => p.done)
          .map(([id]) => id)
      : state.answeredIds

  const toggleFrame = (on: boolean) => {
    setAutoFrame(on)
    setFrameAnswers(on)
  }

  const status = (() => {
    if (reveal) return null
    switch (type) {
      case 'click':
        return answered ? (solo ? 'Locked in.' : 'Locked in. Waiting for others…') : 'Click the country on the map, or search below.'
      case 'language':
        return answered ? (solo ? 'Locked in.' : 'Locked in. Waiting for others…') : 'Any country where it is an official language counts.'
      case 'pin':
      case 'history':
        return answered ? (solo ? 'Locked in.' : 'Locked in. Waiting for others…') : 'Click anywhere on the map to drop your pin.'
      case 'bid':
        if (state.bidPhase === 'bid') {
          if (state.myAnswer && 'bid' in state.myAnswer) return solo ? `You bid ${state.myAnswer.bid}.` : `You bid ${state.myAnswer.bid}. Waiting for other bids…`
          return solo ? 'Bid how many you can click. Deliver for points, fall short and lose some. Bid more than exist and you fail instantly.' : 'Everyone bids in secret. Highest delivered bid earns a bonus.'
        }
        if (!myProgress || myProgress.bid == null || myProgress.bid === 0) return 'You sat this one out. Watch the others collect.'
        if (myProgress.overbid) return `Overbid! There are not ${myProgress.bid} countries in this category.`
        if (myProgress.done) return `Delivered ${myProgress.hits}/${myProgress.bid}! Waiting for the others…`
        return `Found ${myProgress.hits} of ${myProgress.bid}${myProgress.misses ? ` · ${myProgress.misses} wrong` : ''}. Wrong clicks do not count against you.`
      case 'streak':
        if (!streak) return ''
        if (streak.activeId === null) return 'Streak over.'
        if (myTurn) {
          const left = streak.total - streak.found
          return `Your turn — ${left} left · ${streak.strikes}/${streak.maxStrikes} strikes`
        }
        return `${activePlayer?.name ?? 'Someone'}'s turn · ${streak.found}/${streak.total} found · ${streak.strikes}/${streak.maxStrikes} strikes`
    }
  })()

  const bidBase = myResult?.bid != null ? scoreBid(myResult.bid, myResult.hits?.length ?? 0, !!myResult.overbid) : 0
  const bidBonus = myResult && myResult.bid != null ? myResult.score - bidBase : 0

  return (
    <div className="screen">
      <WorldMap
        geojson={dataset.geojson}
        lakes={dataset.lakes}
        states={dataset.states}
        interaction={interaction}
        roles={roles}
        highlightKey={`${q.q.id}:${state.phase}`}
        pins={pins}
        lines={lines}
        flyTo={flyTo}
        onCountryClick={(iso2) => submitAnswer({ iso2 })}
        onMapClick={(lat, lng) => submitAnswer({ lat, lng })}
        onUserMove={() => {
          if (!framedRef.current) return
          framedRef.current = false
          setFlyTo({ nonce: Date.now(), restore: true })
        }}
      />

      <div className="overlay top-center">
        <div className={`prompt ${myTurn ? 'my-turn' : ''}`}>
          <div className="prompt-meta">
            <span>
              {endless ? `Question ${q.index + 1} · Endless` : `Question ${q.index + 1} / ${q.total}`}
              <span className="game-tag">{GAME_NAME[type]}</span>
            </span>
            <TimerClock startAt={q.receivedAt} durationMs={q.timeLimitMs} frozen={!!reveal || (type === 'streak' && streak?.activeId === null)} />
          </div>
          <div className="prompt-text">{q.q.text}</div>
          {q.q.localNames && q.q.localNames.length > 0 && <div className="prompt-local">{q.q.localNames.join(' · ')}</div>}
          {q.q.hint && <div className="prompt-hint">{q.q.hint}</div>}
          {q.q.flagSvg && <SvgImage svg={q.q.flagSvg} alt="Flag" className="prompt-flag" />}
          {q.q.sample && (
            <blockquote className="prompt-sample" dir={q.q.sample.dir} lang="und">
              {q.q.sample.text}
            </blockquote>
          )}

          {type === 'streak' && streak && (
            <>
              {!reveal && (
                <div className="strike-row" aria-label={`${streak.strikes} of ${streak.maxStrikes} strikes`}>
                  {Array.from({ length: streak.maxStrikes }, (_, i) => (
                    <span key={i} className={`strike ${i < streak.strikes ? 'on' : ''}`}>
                      ●
                    </span>
                  ))}
                </div>
              )}
              {streak.lastMiss && !reveal && (
                <p className="miss-fact">
                  {streak.lastMiss.name} ranks #{streak.lastMiss.rank} of {streak.lastMiss.total} {streak.lastMiss.metric} ({streak.lastMiss.value}).
                </p>
              )}
              <ol className="streak-list">
                {(() => {
                  const revealed = reveal?.key.type === 'ranked' ? reveal.key : null
                  const claimerOf = (iso2: string) => {
                    const fromState = streak.claimed.find((x) => x.iso2 === iso2)
                    if (fromState) return fromState.playerId
                    if (!reveal) return null
                    for (const [id, r] of Object.entries(reveal.results)) {
                      if (r.answer && 'iso2s' in r.answer && r.answer.iso2s.includes(iso2)) return id
                    }
                    return null
                  }
                  if (revealed) {
                    return revealed.iso2s.map((iso2, i) => {
                      const whoId = claimerOf(iso2)
                      const who = whoId ? state.players.find((p) => p.id === whoId) : null
                      return (
                        <li key={iso2} className={who ? 'claimed' : ''}>
                          <span className="rank">{i + 1}</span>
                          <span className="name">{dataset.countries[iso2]?.exonymEn ?? iso2}</span>
                          <span className="value">{revealed.values[i]}</span>
                          {who && <span className="owner">{who.id === selfId ? 'you' : who.name}</span>}
                        </li>
                      )
                    })
                  }
                  return Array.from({ length: streak.total }, (_, i) => {
                    const c = streak.claimed[i]
                    const owner = c ? state.players.find((p) => p.id === c.playerId) : null
                    return (
                      <li key={i} className={c ? 'claimed' : i === streak.found ? 'next' : ''}>
                        <span className="rank">{i + 1}</span>
                        <span className="name">{c ? dataset.countries[c.iso2]?.exonymEn ?? c.iso2 : '?'}</span>
                        {owner && <span className="owner">{owner.id === selfId ? 'you' : owner.name}</span>}
                      </li>
                    )
                  })
                })()}
              </ol>
            </>
          )}

          {status && <div className={`prompt-status ${myTurn ? 'good' : ''}`}>{status}</div>}

          {!reveal && type === 'bid' && state.bidPhase === 'bid' && !answered && <BidForm onBid={(n) => submitAnswer({ bid: n })} max={60} />}

          {!reveal && type === 'bid' && state.bidPhase === 'collect' && !solo && (
            <div className="bid-others">
              {state.players.map((p) => {
                const pr = state.bidProgress[p.id]
                if (!pr) return null
                const text = pr.bid == null || pr.bid === 0 ? 'sat out' : pr.overbid ? `bid ${pr.bid} · overbid` : `${pr.hits}/${pr.bid}${pr.done ? ' ✓' : ''}`
                return (
                  <span key={p.id} className={`chip ${pr.overbid ? 'bad' : pr.done && pr.bid ? 'good' : ''}`}>
                    {p.id === selfId ? 'You' : p.name}: {text}
                  </span>
                )
              })}
            </div>
          )}

          {canPickCountry && (
            <CountrySearch countries={dataset.countryList} onSelect={(c) => submitAnswer({ iso2: c.iso2 })} placeholder="Too small to click? Search it here" />
          )}

          {reveal && (
            <div className="reveal-block">
              <div className="result-banner">
                <RevealBanner type={type} reveal={reveal} myResult={myResult} myIso2={myIso2} countries={dataset.countries} bidBonus={bidBonus} />
              </div>
              {reveal.key.type === 'set' && (
                <p className="reveal-list">
                  {type === 'language' ? `${reveal.key.title} is official in ${reveal.key.iso2s.length === 1 ? 'one country' : `${reveal.key.iso2s.length} countries`}: ` : `${reveal.key.title} (${reveal.key.iso2s.length}): `}
                  {names(reveal.key.iso2s, dataset.countries, type === 'language' ? 10 : 14)}
                </p>
              )}
              {(reveal.key.type === 'pin' || reveal.key.type === 'set') && <SourceLink url={reveal.key.sourceUrl} label={reveal.key.sourceLabel} />}
              {revealCountry && (type === 'click' || type === 'pin') && <CountryPanel country={revealCountry} compact />}
              {hostActions ? (
                <button className="btn primary" onClick={continueMatch}>
                  Next question
                  <span className="key-hint">Space</span>
                </button>
              ) : (
                <p className="muted">Waiting for the next question…</p>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="overlay top-right">
        <div className="row gap">
          {endless && hostActions && (
            <button className="btn ghost small" onClick={hostActions.endMatch}>
              End match
            </button>
          )}
          <button className="btn ghost small" onClick={onLeave}>
            Leave
          </button>
        </div>
        <label className="opt-toggle">
          <input type="checkbox" checked={autoFrame} onChange={(e) => toggleFrame(e.target.checked)} />
          <span>Zoom to answers</span>
        </label>
        <div className="panel">
          <Scoreboard players={state.players} totals={state.totals} selfId={selfId} answeredIds={answeredIds} deltas={deltas} activeId={!reveal ? streak?.activeId ?? undefined : undefined} />
        </div>
      </div>
    </div>
  )
}

function RevealBanner({
  type,
  reveal,
  myResult,
  myIso2,
  countries,
  bidBonus,
}: {
  type: PublicQuestion['type']
  reveal: NonNullable<RoomState['reveal']>
  myResult: PlayerResult | undefined
  myIso2: string | null
  countries: Record<string, Country>
  bidBonus: number
}) {
  const k = reveal.key
  if (k.type === 'click') {
    if (myResult?.correct) return <strong className="good">Correct! +{myResult.score}</strong>
    if (myResult?.answer) return <strong className="bad">Not quite. That was {countries[(myResult.answer as { iso2: string }).iso2]?.exonymEn ?? 'somewhere else'}.</strong>
    return <strong className="bad">No answer.</strong>
  }
  if (k.type === 'pin') {
    if (myResult?.answer)
      return (
        <strong className={myResult.score >= 500 ? 'good' : ''}>
          {formatKm(myResult.distanceKm ?? 0)} from {k.name}. +{myResult.score}
        </strong>
      )
    return <strong className="bad">No pin placed{type === 'history' ? `. It was ${k.name}.` : '.'}</strong>
  }
  if (k.type === 'set' && type === 'language') {
    if (myResult?.correct) return <strong className="good">Correct! That was {k.title}. +{myResult.score}</strong>
    if (myIso2) return <strong className="bad">Not quite. That was {k.title}, not spoken officially in {countries[myIso2]?.exonymEn ?? myIso2}.</strong>
    return <strong className="bad">No answer. That was {k.title}.</strong>
  }
  if (k.type === 'set') {
    if (!myResult || myResult.bid == null) return <strong>You sat this one out.</strong>
    const hits = myResult.hits?.length ?? 0
    if (myResult.overbid) return <strong className="bad">Overbid! You bid {myResult.bid} but only {k.iso2s.length} exist. {signed(myResult.score)}</strong>
    if (myResult.bid === 0) return <strong>You bid 0. No points either way.</strong>
    if (hits >= myResult.bid)
      return (
        <strong className="good">
          Delivered {hits}/{myResult.bid}! {signed(myResult.score)}
          {bidBonus > 0 ? ` (includes +${bidBonus} top-bid bonus)` : ''}
        </strong>
      )
    return <strong className="bad">Found {hits} of your {myResult.bid}. {signed(myResult.score)}</strong>
  }
  if (k.type === 'ranked') {
    const n = myResult?.streak ?? 0
    if (n === 0) return <strong className="bad">You claimed none this time.</strong>
    return (
      <strong className="good">
        You claimed {n} of {k.iso2s.length}. +{myResult?.score ?? 0}
      </strong>
    )
  }
  return null
}
