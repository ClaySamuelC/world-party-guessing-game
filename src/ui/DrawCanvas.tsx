import { useEffect, useRef, useState } from 'react'
import { fitPoints, type OutlinePath } from '../game/shapes'

export type Stroke = [number, number][]

type View = { scale: number; ox: number; oy: number }

const MIN_ZOOM = 0.4
const MAX_ZOOM = 10
const START: View = { scale: 1, ox: 0, oy: 0 }

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n))
}

/** One length for both axes so a circle on a wide canvas stays a circle after submit. */
function canvasUnit(w: number, h: number) {
  return Math.max(w, h, 1)
}

function fitStrokes(strokes: Stroke[], w: number, h: number, pad: number): Stroke[] {
  const all = strokes.flat()
  if (all.length < 2) return strokes
  const size = Math.max(40, Math.min(w, h) - pad * 2)
  const fitted = fitPoints(all, size, 0)
  let i = 0
  const ox = (w - size) / 2
  const oy = (h - size) / 2
  return strokes.map((s) =>
    s.map(() => {
      const p = fitted[i++]
      return [ox + p[0], oy + p[1]] as [number, number]
    }),
  )
}

export type DrawScorePhase = 'ready' | 'missed' | 'extra' | 'match' | 'done'

export interface DrawScoreTick {
  score: number
  phase: DrawScorePhase
}

type Masks = {
  missed: HTMLCanvasElement
  extra: HTMLCanvasElement
  match: HTMLCanvasElement
  inter: number
  fn: number
  fp: number
}

function rasterOfficial(official: OutlinePath, w: number, h: number, pad: number): Uint8Array {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')
  const mask = new Uint8Array(w * h)
  if (!ctx) return mask
  const parts = official.viewBox.split(/\s+/).map(Number)
  const [vx, vy, vw, vh] = parts
  if (!(vw > 0 && vh > 0)) return mask
  const scale = Math.min((w - pad * 2) / vw, (h - pad * 2) / vh)
  ctx.translate(pad + (w - pad * 2 - vw * scale) / 2, pad + (h - pad * 2 - vh * scale) / 2)
  ctx.scale(scale, scale)
  ctx.translate(-vx, -vy)
  ctx.fillStyle = '#fff'
  ctx.fill(new Path2D(official.path), 'evenodd')
  const data = ctx.getImageData(0, 0, w, h).data
  for (let i = 0; i < mask.length; i++) mask[i] = data[i * 4 + 3] > 24 ? 1 : 0
  return mask
}

function rasterDrawing(strokes: Stroke[], w: number, h: number, pad: number): Uint8Array {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')
  const mask = new Uint8Array(w * h)
  if (!ctx) return mask
  ctx.fillStyle = '#fff'
  for (const s of fitStrokes(strokes, w, h, pad)) {
    if (s.length < 3) continue
    ctx.beginPath()
    ctx.moveTo(s[0][0], s[0][1])
    for (let i = 1; i < s.length; i++) ctx.lineTo(s[i][0], s[i][1])
    ctx.closePath()
    ctx.fill()
  }
  const data = ctx.getImageData(0, 0, w, h).data
  for (let i = 0; i < mask.length; i++) mask[i] = data[i * 4 + 3] > 24 ? 1 : 0
  return mask
}

function tintLayer(mask: Uint8Array, w: number, h: number, kind: 1 | 2 | 3, r: number, g: number, b: number, a: number) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')
  if (!ctx) return c
  const img = ctx.createImageData(w, h)
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] !== kind) continue
    const o = i * 4
    img.data[o] = r
    img.data[o + 1] = g
    img.data[o + 2] = b
    img.data[o + 3] = a
  }
  ctx.putImageData(img, 0, 0)
  return c
}

function buildMasks(strokes: Stroke[], official: OutlinePath, w: number, h: number): Masks {
  const pad = 28
  const country = rasterOfficial(official, w, h, pad)
  const drawing = rasterDrawing(strokes, w, h, pad)
  const kind = new Uint8Array(country.length)
  let inter = 0
  let fn = 0
  let fp = 0
  for (let i = 0; i < kind.length; i++) {
    const c = country[i]
    const d = drawing[i]
    if (c && d) {
      kind[i] = 1
      inter++
    } else if (c) {
      kind[i] = 2
      fn++
    } else if (d) {
      kind[i] = 3
      fp++
    }
  }
  return {
    missed: tintLayer(kind, w, h, 2, 251, 113, 133, 165),
    extra: tintLayer(kind, w, h, 3, 251, 146, 60, 165),
    match: tintLayer(kind, w, h, 1, 74, 222, 128, 175),
    inter,
    fn,
    fp,
  }
}

function withOfficial(
  ctx: CanvasRenderingContext2D,
  official: OutlinePath,
  w: number,
  h: number,
  pad: number,
  paintPath: (path: Path2D, scale: number) => void,
) {
  const parts = official.viewBox.split(/\s+/).map(Number)
  const [vx, vy, vw, vh] = parts
  if (!(vw > 0 && vh > 0)) return
  const scale = Math.min((w - pad * 2) / vw, (h - pad * 2) / vh)
  ctx.save()
  ctx.translate(pad + (w - pad * 2 - vw * scale) / 2, pad + (h - pad * 2 - vh * scale) / 2)
  ctx.scale(scale, scale)
  ctx.translate(-vx, -vy)
  paintPath(new Path2D(official.path), scale)
  ctx.restore()
}

function paint(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  strokes: Stroke[],
  official: OutlinePath | null | undefined,
  view: View,
  overlay?: { masks: Masks; show: { missed: number; extra: number; match: number } },
) {
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
  const dpr = ctx.canvas.width / w
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.fillStyle = '#071225'
  ctx.fillRect(0, 0, w, h)
  ctx.save()
  ctx.translate(view.ox, view.oy)
  ctx.scale(view.scale, view.scale)
  const pad = 28
  if (official) {
    withOfficial(ctx, official, w, h, pad, (path, scale) => {
      ctx.fillStyle = overlay ? 'rgba(148, 163, 184, 0.1)' : 'rgba(74, 222, 128, 0.18)'
      ctx.fill(path, 'evenodd')
      if (!overlay) {
        ctx.strokeStyle = 'rgba(167, 243, 208, 0.95)'
        ctx.lineJoin = 'round'
        ctx.lineCap = 'round'
        ctx.lineWidth = 0.7 / (scale * view.scale)
        ctx.stroke(path)
      }
    })
  }
  if (overlay) {
    const wipe = (layer: HTMLCanvasElement, amount: number) => {
      if (amount <= 0) return
      ctx.save()
      ctx.beginPath()
      ctx.rect(0, 0, w, h * Math.min(1, amount))
      ctx.clip()
      ctx.drawImage(layer, 0, 0, w, h)
      ctx.restore()
    }
    wipe(overlay.masks.missed, overlay.show.missed)
    wipe(overlay.masks.extra, overlay.show.extra)
    wipe(overlay.masks.match, overlay.show.match)
  }
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.strokeStyle = official ? 'rgba(253, 230, 138, 0.95)' : '#fbbf24'
  ctx.lineWidth = 3 / view.scale
  const drawn = official ? fitStrokes(strokes, w, h, pad) : strokes
  for (const s of drawn) {
    if (s.length < 2) continue
    ctx.beginPath()
    if (official) {
      ctx.moveTo(s[0][0], s[0][1])
      for (let i = 1; i < s.length; i++) ctx.lineTo(s[i][0], s[i][1])
    } else {
      const unit = canvasUnit(w, h)
      ctx.moveTo(s[0][0] * unit, s[0][1] * unit)
      for (let i = 1; i < s.length; i++) ctx.lineTo(s[i][0] * unit, s[i][1] * unit)
    }
    ctx.stroke()
  }
  if (official && overlay) {
    withOfficial(ctx, official, w, h, pad, (path, scale) => {
      const px = 1 / (scale * view.scale)
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'
      ctx.strokeStyle = 'rgba(8, 15, 30, 0.92)'
      ctx.lineWidth = 3.6 * px
      ctx.stroke(path)
      ctx.strokeStyle = '#f8fafc'
      ctx.lineWidth = 1.8 * px
      ctx.stroke(path)
    })
  }
  ctx.restore()
}

function easeOut(t: number) {
  return 1 - (1 - t) * (1 - t)
}

export function DrawCanvas({
  strokes,
  onChange,
  disabled,
  official,
  targetScore,
  onScoreTick,
}: {
  strokes: Stroke[]
  onChange: (strokes: Stroke[]) => void
  disabled?: boolean
  official?: OutlinePath | null
  targetScore?: number
  onScoreTick?: (tick: DrawScoreTick | null) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const strokesRef = useRef(strokes)
  strokesRef.current = strokes
  const viewRef = useRef<View>({ ...START })
  const drawing = useRef<Stroke | null>(null)
  const pan = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null)
  const space = useRef(false)
  const [scale, setScale] = useState(1)
  const officialRef = useRef(official)
  officialRef.current = official
  const overlayRef = useRef<{ masks: Masks; show: { missed: number; extra: number; match: number } } | null>(null)
  const masksRef = useRef<Masks | null>(null)
  const tickRef = useRef(onScoreTick)
  tickRef.current = onScoreTick
  const targetRef = useRef(targetScore)
  targetRef.current = targetScore

  const redraw = () => {
    const el = canvasRef.current
    const ctx = el?.getContext('2d')
    if (!el || !ctx) return
    const r = el.getBoundingClientRect()
    paint(
      ctx,
      r.width,
      r.height,
      drawing.current ? [...strokesRef.current, drawing.current] : strokesRef.current,
      officialRef.current,
      viewRef.current,
      overlayRef.current ?? undefined,
    )
  }

  const setView = (next: View) => {
    viewRef.current = next
    setScale(next.scale)
    redraw()
  }

  const zoomAt = (mx: number, my: number, factor: number) => {
    const v = viewRef.current
    const next = clamp(v.scale * factor, MIN_ZOOM, MAX_ZOOM)
    const k = next / v.scale
    setView({ scale: next, ox: mx - (mx - v.ox) * k, oy: my - (my - v.oy) * k })
  }

  const zoomBy = (factor: number) => {
    const el = canvasRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    zoomAt(r.width / 2, r.height / 2, factor)
  }

  useEffect(() => {
    const c = canvasRef.current
    if (!c) return
    const resize = () => {
      const r = c.getBoundingClientRect()
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      c.width = Math.max(1, Math.round(r.width * dpr))
      c.height = Math.max(1, Math.round(r.height * dpr))
      if (officialRef.current && overlayRef.current) {
        const masks = buildMasks(strokesRef.current, officialRef.current, Math.round(r.width), Math.round(r.height))
        masksRef.current = masks
        overlayRef.current = { ...overlayRef.current, masks }
      }
      redraw()
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(c)
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = c.getBoundingClientRect()
      const factor = Math.exp(-e.deltaY * 0.0025)
      zoomAt(e.clientX - r.left, e.clientY - r.top, factor)
    }
    c.addEventListener('wheel', onWheel, { passive: false })
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat && !['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement | null)?.tagName ?? '')) {
        e.preventDefault()
        space.current = true
      }
    }
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') space.current = false
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      ro.disconnect()
      c.removeEventListener('wheel', onWheel)
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

  useEffect(() => {
    redraw()
  }, [strokes, official])

  useEffect(() => {
    if (official) setView({ ...START })
  }, [official])

  useEffect(() => {
    if (!official) {
      overlayRef.current = null
      masksRef.current = null
      tickRef.current?.(null)
      redraw()
      return
    }
    const el = canvasRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const w = Math.max(1, Math.round(r.width))
    const h = Math.max(1, Math.round(r.height))
    const masks = buildMasks(strokesRef.current, official, w, h)
    masksRef.current = masks
    const canvasFinal = masks.inter + masks.fn + masks.fp ? (1000 * masks.inter) / (masks.inter + masks.fn + masks.fp) : 0
    const final = targetRef.current ?? canvasFinal
    const deduct = 1000 - final
    const missShare = masks.fn + masks.fp ? masks.fn / (masks.fn + masks.fp) : 0
    const afterMissed = 1000 - deduct * missShare
    const steps: { phase: DrawScorePhase; from: number; to: number; key: 'missed' | 'extra' | 'match'; dur: number }[] = []
    if (masks.fn) steps.push({ phase: 'missed', from: 1000, to: afterMissed, key: 'missed', dur: 950 })
    if (masks.fp) steps.push({ phase: 'extra', from: steps.length ? afterMissed : 1000, to: final, key: 'extra', dur: 950 })
    if (masks.inter) steps.push({ phase: 'match', from: final, to: final, key: 'match', dur: 850 })
    overlayRef.current = { masks, show: { missed: 0, extra: 0, match: 0 } }
    if (!steps.length) {
      overlayRef.current = { masks, show: { missed: 1, extra: 1, match: 1 } }
      tickRef.current?.({ score: final, phase: 'done' })
      redraw()
      return
    }
    tickRef.current?.({ score: 1000, phase: 'ready' })
    let raf = 0
    let start = 0
    const tick = (now: number) => {
      if (!start) start = now
      const t = now - start
      let acc = 180
      const show = { missed: 0, extra: 0, match: 0 }
      let score = 1000
      let phase: DrawScorePhase = 'ready'
      let done = false
      for (const step of steps) {
        if (t < acc) break
        const local = (t - acc) / step.dur
        if (local >= 1) {
          show[step.key] = 1
          score = step.to
          phase = step.phase
          acc += step.dur
          continue
        }
        const p = easeOut(local)
        show[step.key] = p
        score = step.from + (step.to - step.from) * p
        phase = step.phase
        acc += step.dur
        break
      }
      if (t >= acc) {
        for (const step of steps) show[step.key] = 1
        score = final
        phase = 'done'
        done = true
      }
      overlayRef.current = { masks, show }
      tickRef.current?.({ score, phase })
      redraw()
      if (!done) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
    }
  }, [official])

  const toNorm = (e: React.PointerEvent, el: HTMLCanvasElement): [number, number] => {
    const r = el.getBoundingClientRect()
    const v = viewRef.current
    const unit = canvasUnit(r.width, r.height) * v.scale
    return [(e.clientX - r.left - v.ox) / unit, (e.clientY - r.top - v.oy) / unit]
  }

  const startPan = (e: React.PointerEvent) => {
    const v = viewRef.current
    pan.current = { x: e.clientX, y: e.clientY, ox: v.ox, oy: v.oy }
    canvasRef.current?.setPointerCapture(e.pointerId)
  }

  return (
    <div className="draw-board">
      <canvas
        ref={canvasRef}
        className="draw-canvas"
        onContextMenu={(e) => e.preventDefault()}
        onPointerDown={(e) => {
          if (e.button === 1 || e.button === 2 || e.altKey || space.current) {
            e.preventDefault()
            startPan(e)
            return
          }
          if (disabled || e.button !== 0) return
          const el = canvasRef.current
          if (!el) return
          el.setPointerCapture(e.pointerId)
          drawing.current = [toNorm(e, el)]
        }}
        onPointerMove={(e) => {
          if (pan.current) {
            setView({
              scale: viewRef.current.scale,
              ox: pan.current.ox + (e.clientX - pan.current.x),
              oy: pan.current.oy + (e.clientY - pan.current.y),
            })
            return
          }
          if (!drawing.current) return
          const el = canvasRef.current
          if (!el) return
          const p = toNorm(e, el)
          const last = drawing.current[drawing.current.length - 1]
          if (last && Math.hypot(p[0] - last[0], p[1] - last[1]) < 0.003 / viewRef.current.scale) return
          drawing.current.push(p)
          redraw()
        }}
        onPointerUp={() => {
          if (pan.current) {
            pan.current = null
            return
          }
          if (!drawing.current) return
          const next = drawing.current.length >= 2 ? [...strokesRef.current, drawing.current] : strokesRef.current
          drawing.current = null
          onChange(next)
        }}
        onPointerCancel={() => {
          pan.current = null
          drawing.current = null
        }}
      />
      <div className="draw-zoom">
        <button type="button" className="btn" onClick={() => zoomBy(1 / 1.25)} aria-label="Zoom out">
          −
        </button>
        <button type="button" className="btn" onClick={() => setView({ ...START })} aria-label="Reset zoom">
          {Math.round(scale * 100)}%
        </button>
        <button type="button" className="btn" onClick={() => zoomBy(1.25)} aria-label="Zoom in">
          +
        </button>
      </div>
    </div>
  )
}
