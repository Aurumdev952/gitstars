import { memo, useEffect, useId, useRef, useState, type PointerEvent } from 'react'
import type { ClusterNode } from '#/lib/load'
import type { Filters } from '#/lib/filters'
import { formatCount, formatMonthYear } from '#/lib/format'
import { monthAtFraction, type StarredHistogram } from '#/lib/timeline'

const HEIGHT = 52
/** Pointer travel before a press on the histogram becomes a brush rather than a click-to-seek. */
const BRUSH_SLOP_PX = 4

const monthLabel = (m: string) => formatMonthYear(`${m}-01T00:00:00Z`)

/** Month indices of an inclusive `YYYY-MM` range, clamped to the histogram's months. */
function rangeIndices(h: StarredHistogram, r: readonly [string, string]): [number, number] {
  const at = (m: string) => {
    const k = h.months.indexOf(m)
    if (k >= 0) return k
    return m < h.months[0]! ? 0 : h.months.length - 1
  }
  return [at(r[0]), at(r[1])]
}

type Props = {
  hist: StarredHistogram
  galaxies: ClusterNode[]
  width: number
  /** The starred-range fraction the cursor shows; bars after it are not yet born. */
  fraction: number
  starred: Filters['starred']
  onBrush(range: [string, string] | null): void
  onSeekFraction(f: number): void
  /** What the pointer is over or brushing, for the panel header; null when idle. */
  onReadout(text: string | null): void
}

/**
 * Starred counts by month, stacked by galaxy. Dragging brushes a month range into
 * `filters.starred`; a click seeks the cursor there.
 */
export function TimelineHistogram({ hist, galaxies, width, fraction, starred, onBrush, onSeekFraction, onReadout }: Props) {
  const maskId = useId()
  const [hover, setHover] = useState<number | null>(null)
  const [brush, setBrush] = useState<[number, number] | null>(null)
  const press = useRef<{ x: number; month: number; brushing: boolean } | null>(null)

  const local = (e: PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const x = Math.min(r.width, Math.max(0, e.clientX - r.left))
    return { x, f: r.width > 0 ? x / r.width : 0 }
  }

  const onDown = (e: PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const { x, f } = local(e)
    press.current = { x, month: monthAtFraction(hist, f), brushing: false }
  }
  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const { x, f } = local(e)
    const month = monthAtFraction(hist, f)
    setHover(month)
    const p = press.current
    if (!p) return
    if (!p.brushing && Math.abs(x - p.x) >= BRUSH_SLOP_PX) p.brushing = true
    if (p.brushing) setBrush([Math.min(p.month, month), Math.max(p.month, month)])
  }
  const onUp = (e: PointerEvent<SVGSVGElement>) => {
    const p = press.current
    press.current = null
    if (!p) return
    if (!p.brushing) return onSeekFraction(local(e).f)
    const month = monthAtFraction(hist, local(e).f)
    const [a, b] = [Math.min(p.month, month), Math.max(p.month, month)]
    setBrush(null)
    const all = a === 0 && b === hist.months.length - 1
    onBrush(all ? null : [hist.months[a]!, hist.months[b]!])
  }

  const band = brush ?? (starred ? rangeIndices(hist, starred) : null)
  const bandX: [number, number] | null = band ? [hist.edges[band[0]]! * width, hist.edges[band[1] + 1]! * width] : null
  const cursorX = fraction * width

  // Born bars are bright, unborn ones faint; outside a brushed band both dim further.
  const cuts = [...new Set([0, cursorX, ...(bandX ?? []), width])].filter((x) => x >= 0 && x <= width).sort((a, b) => a - b)
  const shades = cuts.slice(0, -1).map((x0, k) => {
    const x1 = cuts[k + 1]!
    const mid = (x0 + x1) / 2
    const born = mid < cursorX
    const inBand = !bandX || (mid >= bandX[0] && mid <= bandX[1])
    const o = inBand ? (born ? 1 : 0.3) : born ? 0.34 : 0.12
    return { x0, x1, o }
  })

  useEffect(() => {
    if (brush) onReadout(`${monthLabel(hist.months[brush[0]]!)} – ${monthLabel(hist.months[brush[1]]!)}`)
    else if (hover !== null) onReadout(`${monthLabel(hist.months[hover]!)} · ${formatCount(hist.totals[hover]!)} starred`)
    else onReadout(null)
    return () => onReadout(null)
  }, [brush, hover, hist, onReadout])

  return (
    <svg
        width={width}
        height={HEIGHT}
        className="block cursor-crosshair touch-none"
        role="img"
        aria-label={`Stars starred per month, ${monthLabel(hist.months[0]!)} to ${monthLabel(hist.months[hist.months.length - 1]!)}`}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={() => {
          press.current = null
          setBrush(null)
        }}
        onPointerLeave={() => !press.current && setHover(null)}
      >
        <mask id={maskId} maskUnits="userSpaceOnUse" x={0} y={0} width={width} height={HEIGHT}>
          {shades.map((s) => (
            <rect key={s.x0} x={s.x0} y={0} width={s.x1 - s.x0} height={HEIGHT} fill={`rgb(${Math.round(s.o * 255)} ${Math.round(s.o * 255)} ${Math.round(s.o * 255)})`} />
          ))}
        </mask>
        {bandX && (
          <g>
            <rect x={bandX[0]} y={0} width={Math.max(1, bandX[1] - bandX[0])} height={HEIGHT} className="fill-starlight/[0.08]" />
            <line x1={bandX[0] + 0.5} x2={bandX[0] + 0.5} y1={0} y2={HEIGHT} className="stroke-starlight/50" />
            <line x1={bandX[1] - 0.5} x2={bandX[1] - 0.5} y1={0} y2={HEIGHT} className="stroke-starlight/50" />
          </g>
        )}
        {hover !== null && !brush && (
          <rect
            x={hist.edges[hover]! * width}
            y={0}
            width={(hist.edges[hover + 1]! - hist.edges[hover]!) * width}
            height={HEIGHT}
            className="fill-white/[0.1]"
          />
        )}
        <g mask={`url(#${maskId})`}>
          <Bars hist={hist} galaxies={galaxies} width={width} />
        </g>
        <line x1={cursorX} x2={cursorX} y1={0} y2={HEIGHT} className="stroke-starlight/70" strokeWidth={1} />
    </svg>
  )
}

/** The stacked bars; memoised so the cursor moving every frame never rebuilds them. */
const Bars = memo(function Bars({ hist, galaxies, width }: { hist: StarredHistogram; galaxies: ClusterNode[]; width: number }) {
  const scale = (HEIGHT - 2) / Math.max(1, hist.max)
  const rects = []
  for (let m = 0; m < hist.months.length; m++) {
    const x0 = hist.edges[m]! * width
    const x1 = hist.edges[m + 1]! * width
    const gap = x1 - x0 > 4 ? 1.5 : x1 - x0 > 2 ? 0.5 : 0
    let y = HEIGHT
    for (const gal of galaxies) {
      const n = hist.counts[m * hist.galaxies + gal.index]!
      if (n === 0) continue
      const h = n * scale
      rects.push(<rect key={`${m}-${gal.index}`} x={x0 + gap / 2} y={y - h} width={Math.max(0.5, x1 - x0 - gap)} height={h} fill={gal.color.css} />)
      y -= h
    }
  }
  return <>{rects}</>
})
