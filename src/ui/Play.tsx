import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import type { Dataset } from '../data/load'
import type { Country } from '../data/types'
import type { RoomState } from '../game/client'
import type { BidProgress, PlayerResult } from '../game/protocol'
import { MINI_GAMES, type Answer, type PublicQuestion } from '../game/questions'
import { formatArea, formatNumber } from '../data/load'
import { formatKm, scoreBid } from '../game/scoring'
import type { HostActions } from '../game/useSession'
import { WorldMap, type CountryRole, type MapPin } from '../map/WorldMap'
import { CountryOutline } from './CountryOutline'
import { CountryPanel } from './CountryPanel'
import { CountrySearch } from './CountrySearch'
import { DrawCanvas, type DrawScoreTick } from './DrawCanvas'
import { SvgImage } from './Flag'
import { NameGuess } from './NameGuess'
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

/** Longitude of `to` closest to `from` (short path across the dateline). */
function nearestLng(from: number, to: number) {
  let best = to
  let bestD = Math.abs(to - from)
  for (const shift of [-360, 360]) {
    const n = to + shift
    const d = Math.abs(n - from)
    if (d < bestD) {
      bestD = d
      best = n
    }
  }
  return best
}

/**
 * Union of country bboxes that may sit on both sides of ±180 (Oceania). Naive min/max
 * longitude would span the long way around and look like the whole world.
 */
function unionBoxesShort(boxes: Box[]): Box | null {
  if (!boxes.length) return null
  const mids = boxes.map((b) => (b[0] + b[2]) / 2).sort((a, b) => a - b)
  const ref = mids[Math.floor(mids.length / 2)]
  let w = Infinity
  let s = Infinity
  let e = -Infinity
  let n = -Infinity
  for (const [bw, bs, be, bn] of boxes) {
    const shift = nearestLng(ref, (bw + be) / 2) - (bw + be) / 2
    w = Math.min(w, bw + shift)
    e = Math.max(e, be + shift)
    s = Math.min(s, bs)
    n = Math.max(n, bn)
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

function BidForm({ onBid, min = 0, max }: { onBid: (n: number) => void; min?: number; max: number }) {
  const [value, setValue] = useState(min > 0 ? String(min) : '')
  useEffect(() => {
    setValue((v) => {
      const n = Number(v)
      if (v === '' || !Number.isInteger(n) || n < min) return min > 0 ? String(min) : ''
      return v
    })
  }, [min])
  const n = Number(value)
  const ok = value !== '' && Number.isInteger(n) && n >= min && n <= max
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
        min={min}
        max={max}
        step={1}
        autoFocus
        placeholder={String(min)}
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
  const drawTickSink = useRef<(tick: DrawScoreTick | null) => void>(() => {})
  const onDrawScoreTick = useRef((tick: DrawScoreTick | null) => drawTickSink.current(tick)).current
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
    for (const iso2 of state.eliminated) r[iso2] = 'eliminated'
    if (type === 'pin' || type === 'history') return r
    if (reveal) {
      const k = reveal.key
      if (k.type === 'click') {
        for (const res of Object.values(reveal.results)) if (res.answer && 'iso2' in res.answer && res.answer.iso2 !== k.iso2) r[res.answer.iso2] = 'wrong'
        r[k.iso2] = 'correct'
      } else if (k.type === 'set' && (type === 'language' || type === 'export')) {
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
    if (q.q.region) {
      for (const iso2 of q.q.region.iso2s) r[iso2] = 'region'
    }
    if (type === 'bid') {
      for (const p of state.myPicks) r[p.iso2] = p.ok ? 'correct' : 'wrong'
    } else if (type === 'streak' && streak) {
      for (const c of streak.claimed) r[c.iso2] = 'correct'
      if (streak.lastMiss) r[streak.lastMiss.iso2] = 'wrong'
    } else if (myIso2) r[myIso2] = 'selected'
    return r
  }, [type, reveal, myIso2, myResult, state.myPicks, streak, q.q.region, state.eliminated])

  const pinCircle = state.settings.pinCircle
  // Pins: mine while answering; everyone's plus the target after the reveal.
  const { pins, lines, circles } = useMemo(() => {
    const pins: MapPin[] = []
    const lines: { from: [number, number]; to: [number, number]; color?: string }[] = []
    const circles: { lat: number; lng: number; radiusKm: number; color?: string }[] = []
    if (type !== 'pin' && type !== 'history') return { pins, lines, circles }
    const colorOf = (id: string) => PLAYER_COLORS[Math.max(0, state.players.findIndex((p) => p.id === id)) % PLAYER_COLORS.length]
    if (reveal?.key.type === 'pin') {
      for (const [id, res] of Object.entries(reveal.results)) {
        if (!res.answer || !('lat' in res.answer)) continue
        const name = state.players.find((p) => p.id === id)?.name ?? '?'
        pins.push({ id, lat: res.answer.lat, lng: res.answer.lng, label: `${name} · ${formatKm(res.distanceKm ?? 0)}`, kind: id === selfId ? 'mine' : 'other', color: colorOf(id) })
        if (id === selfId) lines.push({ from: [res.answer.lat, res.answer.lng], to: [reveal.key.lat, reveal.key.lng], color: colorOf(id) })
        if (res.radiusKm) circles.push({ lat: res.answer.lat, lng: res.answer.lng, radiusKm: res.radiusKm, color: colorOf(id) })
      }
      pins.push({ id: 'target', lat: reveal.key.lat, lng: reveal.key.lng, label: reveal.key.name, kind: 'target' })
    } else if (state.myAnswer && 'lat' in state.myAnswer) {
      pins.push({ id: 'mine', lat: state.myAnswer.lat, lng: state.myAnswer.lng, label: 'Your pin', kind: 'mine' })
      if (state.myAnswer.radiusKm) circles.push({ lat: state.myAnswer.lat, lng: state.myAnswer.lng, radiusKm: state.myAnswer.radiusKm })
    }
    return { pins, lines, circles }
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
    } else if (k.type === 'set' && (type === 'language' || type === 'export')) {
      // Highlight every official-language / top-export country; zoom to the whole set when it fits.
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

  // Question-scoped regions (East Africa, the Caribbean, …) are the search space — always
  // frame them when the question arrives, independent of the "zoom to answers" toggle.
  useEffect(() => {
    if (reveal) return
    const region = q.q.region
    if (!region?.iso2s.length) return
    const boxes = region.iso2s.map((iso2) => dataset.countries[iso2]?.bbox).filter((b): b is Box => !!b)
    const box = unionBoxesShort(boxes)
    if (!box) return
    const t = window.setTimeout(() => setFlyTo({ nonce: Date.now(), bbox: box }), 60)
    return () => clearTimeout(t)
  }, [q.q.id, q.q.region, reveal, dataset.countries])

  useEffect(() => {
    if (!reveal || !autoFrame || !frameBox) return
    if (framedForRef.current === q.q.id) return
    framedForRef.current = q.q.id
    framedRef.current = true
    setFlyTo({ nonce: Date.now(), bbox: frameBox, save: true })
  }, [reveal, autoFrame, frameBox, q.q.id])

  let interaction: 'country' | 'pin' | 'circle' | 'none' = 'none'
  if (!reveal) {
    if (type === 'click' || type === 'language' || type === 'export' || type === 'eliminate') interaction = answered ? 'none' : 'country'
    else if (type === 'pin' || type === 'history') interaction = answered ? 'none' : pinCircle ? 'circle' : 'pin'
    else if (type === 'bid') {
      const collecting = state.bidPhase === 'collect' || state.players.length === 1
      interaction = collecting && !myProgress?.done ? 'country' : 'none'
    }
    else if (type === 'streak') interaction = myTurn ? 'country' : 'none'
  }
  const canPickCountry = interaction === 'country'
  const showMap = type !== 'name' && type !== 'draw'
  const drawLocked = !!(state.myAnswer && 'strokes' in state.myAnswer && state.myAnswer.done)
  const myStrokes = state.myAnswer && 'strokes' in state.myAnswer ? state.myAnswer.strokes : []

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
      case 'eliminate':
        return answered
          ? solo
            ? 'Locked in.'
            : 'Locked in. Waiting for others…'
          : `Click it to knock it out${state.eliminated.length ? ` · ${state.eliminated.length} already gone` : ''}. A miss leaves it in the pool.`
      case 'name':
        return answered ? (solo ? 'Locked in.' : 'Locked in. Waiting for others…') : 'Type the name. Suggestions appear as you type.'
      case 'draw':
        return drawLocked
          ? solo
            ? 'Locked in.'
            : 'Locked in. Waiting for others…'
          : 'Sketch the shape — scale does not matter. Scroll to zoom, right-drag or Alt-drag to pan. Hit Done when you are finished.'
      case 'language':
        return answered ? (solo ? 'Locked in.' : 'Locked in. Waiting for others…') : 'Any country where it is an official language counts.'
      case 'export':
        return answered ? (solo ? 'Locked in.' : 'Locked in. Waiting for others…') : 'Any of the top 3 exporters counts.'
      case 'pin':
      case 'history':
        return answered
          ? solo
            ? 'Locked in.'
            : 'Locked in. Waiting for others…'
          : pinCircle
            ? 'Click and hold, then drag to grow the circle. Smaller circles that still cover the spot score more.'
            : 'Click anywhere on the map to drop your pin.'
      case 'bid':
        if (solo || myProgress?.rush) {
          if (myProgress?.done) return 'Found them all!'
          const hits = myProgress?.hits ?? 0
          const misses = myProgress?.misses ?? 0
          return `Found ${hits}${misses ? ` · ${misses} wrong` : ''}. Wrong clicks lose points.`
        }
        if (state.bidPhase === 'bid') {
          const a = state.auction
          if (!a || a.highBid === 0) return 'Open auction. Bid how many you can click, or pass. 30 seconds on the clock — it resets whenever someone raises.'
          if (a.passed.includes(selfId)) return 'You passed. Waiting for the auction to close.'
          if (a.highBidderId === selfId) return `You lead at ${a.highBid}. Waiting for someone to raise, or everyone else to pass.`
          const leader = state.players.find((p) => p.id === a.highBidderId)
          return `${leader?.name ?? 'Someone'} leads at ${a.highBid}. Raise above that or pass.`
        }
        if (!myProgress || myProgress.bid == null || myProgress.bid === 0) return 'You are watching. The auction winner is collecting.'
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
    <div className={`screen ${showMap ? '' : 'map-off'} ${type === 'draw' ? 'draw-mode' : ''}`}>
      <WorldMap
        geojson={dataset.geojson}
        lakes={dataset.lakes}
        states={dataset.states}
        interaction={showMap ? interaction : 'none'}
        roles={roles}
        highlightKey={`${q.q.id}:${state.phase}`}
        pins={pins}
        lines={lines}
        circles={circles}
        flyTo={showMap ? flyTo : null}
        onCountryClick={(iso2) => submitAnswer({ iso2 })}
        onMapClick={(lat, lng) => submitAnswer({ lat, lng })}
        onCircle={(lat, lng, radiusKm) => submitAnswer({ lat, lng, radiusKm })}
      />
      {!showMap && (
        <div className="blank-stage">
          {type === 'name' && q.q.outline && <CountryOutline outline={q.q.outline} className="country-silhouette" />}
          {type === 'draw' && (
            <DrawCanvas
              strokes={myStrokes}
              onChange={(strokes) => submitAnswer({ strokes, done: false })}
              disabled={drawLocked || !!reveal}
              official={reveal?.key.type === 'draw' ? reveal.key.outline : null}
              targetScore={reveal?.key.type === 'draw' ? reveal.results[selfId]?.score : undefined}
              onScoreTick={onDrawScoreTick}
            />
          )}
        </div>
      )}

      <div className={`overlay ${type === 'draw' ? 'top-left' : 'top-center'}`}>
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
          {q.q.region && !reveal && <div className="prompt-hint">The map is framed on {q.q.region.label}.</div>}
          {q.q.stats && (
            <ul className="draw-stats">
              <li>Population {formatNumber(q.q.stats.population)}</li>
              <li>{formatArea(q.q.stats.areaKm2)}</li>
              <li>Capital {q.q.stats.capital}</li>
              <li>{q.q.stats.region}</li>
            </ul>
          )}
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
                  {streak.lastMiss.outside
                    ? `${streak.lastMiss.name} is not ${streak.lastMiss.metric}.`
                    : `${streak.lastMiss.name} ranks #${streak.lastMiss.rank} of ${streak.lastMiss.total} ${streak.lastMiss.metric} (${streak.lastMiss.value}).`}
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

          {!reveal && type === 'bid' && state.bidPhase === 'bid' && !solo && state.auction && (
            <div className="auction-panel">
              <div className="bid-others">
                {state.players.map((p) => {
                  const a = state.auction!
                  const leading = a.highBidderId === p.id
                  const folded = a.passed.includes(p.id)
                  const last = a.bids[p.id]
                  const text = folded ? 'passed' : leading ? `leading ${a.highBid}` : last != null ? `bid ${last}` : '…'
                  return (
                    <span key={p.id} className={`chip ${folded ? 'bad' : leading ? 'lead' : ''}`}>
                      {p.id === selfId ? 'You' : p.name}: {text}
                    </span>
                  )
                })}
              </div>
              {!state.auction.passed.includes(selfId) && (
                <div className="bid-actions">
                  {state.auction.highBidderId !== selfId && (
                    <BidForm onBid={(n) => submitAnswer({ bid: n })} min={state.auction.highBid + 1} max={60} />
                  )}
                  <button type="button" className="btn" onClick={() => submitAnswer({ pass: true })}>
                    {state.auction.highBidderId === selfId ? 'Drop out' : 'Pass'}
                  </button>
                </div>
              )}
            </div>
          )}

          {!reveal && type === 'bid' && state.bidPhase === 'collect' && !solo && (
            <div className="bid-others">
              {state.players.map((p) => {
                const pr = state.bidProgress[p.id]
                if (!pr) return null
                const text = pr.bid == null || pr.bid === 0 ? 'watching' : pr.overbid ? `bid ${pr.bid} · overbid` : `${pr.hits}/${pr.bid}${pr.done ? ' ✓' : ''}`
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

          {!reveal && type === 'name' && !answered && (
            <NameGuess countries={dataset.countryList} onGuess={(iso2) => submitAnswer({ iso2 })} />
          )}

          {!reveal && type === 'draw' && !drawLocked && (
            <div className="draw-actions">
              <button type="button" className="btn" disabled={!myStrokes.length} onClick={() => submitAnswer({ strokes: myStrokes.slice(0, -1), done: false })}>
                Undo
              </button>
              <button type="button" className="btn" disabled={!myStrokes.length} onClick={() => submitAnswer({ strokes: [], done: false })}>
                Clear
              </button>
              <button type="button" className="btn primary" disabled={!myStrokes.length} onClick={() => submitAnswer({ strokes: myStrokes, done: true })}>
                Done
              </button>
            </div>
          )}

          {reveal && (
            <div className="reveal-block">
              <div className="result-banner">
                <RevealBanner type={type} reveal={reveal} myResult={myResult} myIso2={myIso2} countries={dataset.countries} bidBonus={bidBonus} drawTickSink={drawTickSink} />
              </div>
              {reveal.key.type === 'set' && (
                <p className="reveal-list">
                  {type === 'language'
                    ? `${reveal.key.title} is official in ${reveal.key.iso2s.length === 1 ? 'one country' : `${reveal.key.iso2s.length} countries`}: `
                    : type === 'export'
                      ? `${reveal.key.title}: `
                      : `${reveal.key.title} (${reveal.key.iso2s.length}): `}
                  {type === 'export'
                    ? reveal.key.iso2s.map((iso2, i) => `${i + 1}. ${dataset.countries[iso2]?.exonymEn ?? iso2}`).join(' · ')
                    : names(reveal.key.iso2s, dataset.countries, type === 'language' ? 10 : 14)}
                </p>
              )}
              {(reveal.key.type === 'pin' || reveal.key.type === 'set') && <SourceLink url={reveal.key.sourceUrl} label={reveal.key.sourceLabel} />}
              {revealCountry && (type === 'click' || type === 'pin' || type === 'eliminate' || type === 'name') && <CountryPanel country={revealCountry} compact />}
              {reveal?.key.type === 'draw' && dataset.countries[reveal.key.iso2] && <CountryPanel country={dataset.countries[reveal.key.iso2]} compact />}
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

function DrawRevealScore({
  sink,
  name,
  overlap,
  fallbackScore,
}: {
  sink: MutableRefObject<(tick: DrawScoreTick | null) => void>
  name: string
  overlap: number
  fallbackScore: number
}) {
  const [tick, setTick] = useState<DrawScoreTick | null>({ score: 1000, phase: 'ready' })
  sink.current = setTick
  useEffect(() => {
    return () => {
      sink.current = () => {}
    }
  }, [sink])
  const live = tick?.score ?? fallbackScore
  const phase = tick?.phase
  const label =
    phase === 'missed'
      ? 'Country outside your border'
      : phase === 'extra'
        ? 'Empty space inside your border'
        : phase === 'match'
          ? 'Country inside your border'
          : phase === 'ready'
            ? 'Scoring your drawing…'
            : `That was ${name}`
  const tallyTone =
    phase === 'missed' || phase === 'extra'
      ? phase
      : phase === 'match' || (phase === 'done' && live >= 500)
        ? 'good'
        : phase === 'done' && live <= 0
          ? 'bad'
          : ''
  return (
    <div className="draw-reveal-score">
      <div className={`draw-phase-label ${phase ?? 'done'}`}>{label}</div>
      <strong className={`draw-tally ${tallyTone}`}>{signed(Math.round(live))}</strong>
      {(phase === 'done' || !tick) && <span className="draw-tally-note">Shape match {Math.round(overlap * 100)}%</span>}
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
  drawTickSink,
}: {
  type: PublicQuestion['type']
  reveal: NonNullable<RoomState['reveal']>
  myResult: PlayerResult | undefined
  myIso2: string | null
  countries: Record<string, Country>
  bidBonus: number
  drawTickSink: MutableRefObject<(tick: DrawScoreTick | null) => void>
}) {
  const k = reveal.key
  if (k.type === 'click') {
    if (type === 'eliminate') {
      if (myResult?.correct) return <strong className="good">Eliminated! +{myResult.score}</strong>
      if (myResult?.answer) return <strong className="bad">Miss. It stays in the pool. That was {countries[k.iso2]?.exonymEn ?? k.iso2}.</strong>
      return <strong className="bad">No click. {countries[k.iso2]?.exonymEn ?? k.iso2} stays in the pool.</strong>
    }
    if (type === 'name') {
      if (myResult?.correct) return <strong className="good">Correct! That was {countries[k.iso2]?.exonymEn ?? k.iso2}. +{myResult.score}</strong>
      if (myResult?.answer && 'iso2' in myResult.answer)
        return <strong className="bad">Not quite. That was {countries[k.iso2]?.exonymEn ?? k.iso2}, not {countries[myResult.answer.iso2]?.exonymEn ?? myResult.answer.iso2}.</strong>
      return <strong className="bad">No answer. That was {countries[k.iso2]?.exonymEn ?? k.iso2}.</strong>
    }
    if (myResult?.correct) return <strong className="good">Correct! +{myResult.score}</strong>
    if (myResult?.answer) return <strong className="bad">Not quite. That was {countries[(myResult.answer as { iso2: string }).iso2]?.exonymEn ?? 'somewhere else'}.</strong>
    return <strong className="bad">No answer.</strong>
  }
  if (k.type === 'draw') {
    return (
      <DrawRevealScore
        sink={drawTickSink}
        name={k.name}
        overlap={myResult?.overlap ?? 0}
        fallbackScore={myResult?.score ?? 0}
      />
    )
  }
  if (k.type === 'pin') {
    if (myResult?.answer && myResult.radiusKm != null) {
      const hit = (myResult.distanceKm ?? Infinity) <= myResult.radiusKm
      return (
        <strong className={hit && myResult.score > 0 ? 'good' : 'bad'}>
          {hit ? `Covered ${k.name} with a ${formatKm(myResult.radiusKm)} circle.` : `${formatKm(myResult.distanceKm ?? 0)} from ${k.name} — outside your ${formatKm(myResult.radiusKm)} circle.`}{' '}
          {signed(myResult.score)}
        </strong>
      )
    }
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
  if (k.type === 'set' && type === 'export') {
    if (myResult?.correct) return <strong className="good">Correct! +{myResult.score}</strong>
    if (myIso2) return <strong className="bad">Not a top-3 exporter. {countries[myIso2]?.exonymEn ?? myIso2} is not on the list.</strong>
    return <strong className="bad">No answer.</strong>
  }
  if (k.type === 'set') {
    if (myResult?.rush) {
      const hits = myResult.hits?.length ?? 0
      const misses = myResult.misses?.length ?? 0
      const cls = myResult.score > 0 ? 'good' : myResult.score < 0 ? 'bad' : ''
      return (
        <strong className={cls}>
          Found {hits}
          {misses ? `, ${misses} wrong` : ''}. {signed(myResult.score)}
        </strong>
      )
    }
    if (!myResult || myResult.bid == null) return <strong>{Object.keys(reveal.results).length > 1 ? 'You did not win the auction.' : 'You sat this one out.'}</strong>
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
