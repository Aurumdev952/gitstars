import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type PointerEvent } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ChevronDown, ChevronUp, Pause, Play, X } from 'lucide-react'
import { useGalaxyStore, type PlaySpeed } from '#/state/store'
import { timeline, timelineCursor } from '#/state/timeline'
import type { GalaxyIndex } from '#/lib/load'
import { formatCount, formatMonthYear } from '#/lib/format'
import {
  birthIndex,
  bornCount,
  brightestNewborn,
  cursorMonthLabel,
  cursorToFraction,
  fractionToCursor,
  starredHistogram,
  stepCursorByMonths,
  toStarredRange,
} from '#/lib/timeline'
import { cn } from '#/lib/utils'
import { TimelineHistogram } from './TimelineHistogram'
import { useOccluder } from './useOccluder'

const SPEEDS: PlaySpeed[] = [0.5, 1, 2]
const monthLabel = (m: string) => formatMonthYear(`${m}-01T00:00:00Z`)
/** Each newborn name stays up at least this long, so fast playback stays readable. */
const NAME_HOLD_MS = 700
const MIN_HINT_WIDTH_PX = 420
/** Year labels closer than this thin out to every other year. */
const MIN_YEAR_GAP_PX = 34

export function Timeline() {
  const open = useGalaxyStore((s) => s.timeline.open)
  const g = useGalaxyStore((s) => s.galaxy)
  return <AnimatePresence>{open && g && <TimelinePanel key="timeline" g={g} />}</AnimatePresence>
}

function TimelinePanel({ g }: { g: GalaxyIndex }) {
  const ref = useRef<HTMLDivElement>(null)
  useOccluder(ref)
  const plot = useRef<HTMLDivElement>(null)
  const width = useWidth(plot)
  const [collapsed, setCollapsed] = useState(false)
  const [readout, setReadout] = useState<string | null>(null)
  const sidePanel = useGalaxyStore((s) => s.selected !== null || s.focusCluster !== null)
  const reduced = useGalaxyStore((s) => s.settings.motion === 'reduced' || s.frozen)
  const { playing, speed } = useGalaxyStore((s) => s.timeline)
  const filters = useGalaxyStore((s) => s.filters)
  const visible = useGalaxyStore((s) => (s.filtered && s.filtered.count < g.n ? s.filtered.visible : null))
  const { setFilters } = useGalaxyStore((s) => s.actions)

  const range = useMemo(() => toStarredRange(g.data.meta.starredRange), [g])
  const hist = useMemo(
    () => starredHistogram(g.repos.map((r) => r.starredAt), g.galaxyOf, g.galaxies.length, g.data.meta.starredRange),
    [g],
  )
  const births = useMemo(() => birthIndex(g.attrs.starred, visible), [g, visible])
  const stars = useMemo(() => Float64Array.from(g.repos, (r) => r.stars), [g])

  const c = useSyncExternalStore(timelineCursor.subscribe, timelineCursor.get)
  const fraction = cursorToFraction(c)
  const date = cursorMonthLabel(c, range)
  const count = bornCount(births, c)
  const newborn = useHeld(brightestNewborn(births, stars, c), NAME_HOLD_MS)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const root = document.documentElement
    const ro = new ResizeObserver(() => root.style.setProperty('--timeline-h', `${el.offsetHeight + 12}px`))
    ro.observe(el)
    return () => {
      ro.disconnect()
      root.style.removeProperty('--timeline-h')
    }
  }, [])

  const ticker = `${date} · ${formatCount(count)} ${count === 1 ? 'star' : 'stars'}`

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 16 }}
      transition={{ duration: reduced ? 0 : 0.28, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        'fixed bottom-5 z-10 flex flex-col items-stretch',
        sidePanel ? 'right-[456px] left-[288px] mx-auto max-w-[560px]' : 'left-1/2 w-[min(560px,calc(100vw-620px))] -translate-x-1/2',
      )}
    >
      {!collapsed && (
        <div aria-hidden className="pointer-events-none mb-2.5 text-center select-none [text-shadow:0_1px_14px_rgb(0_0_0/0.85)]">
          <p className="tabular text-[30px] leading-none font-extralight tracking-[-0.02em] text-ink">
            {date}
            <span className="text-ink-faint"> · </span>
            <span className="text-ink-muted">{formatCount(count)}</span>
            <span className="text-[20px] text-ink-faint"> {count === 1 ? 'star' : 'stars'}</span>
          </p>
          <div className="mt-1.5 h-4 text-[12.5px] text-ink-muted">
            <AnimatePresence mode="wait" initial={false}>
              {newborn !== null && (
                <motion.span
                  key={newborn}
                  className="inline-block"
                  initial={{ opacity: 0, y: 3 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, transition: { duration: reduced ? 0 : 0.12 } }}
                  transition={{ duration: reduced ? 0 : 0.3 }}
                >
                  {g.repos[newborn]!.fullName}
                </motion.span>
              )}
            </AnimatePresence>
          </div>
        </div>
      )}
      <section aria-label="Timeline" className="glass rounded-[var(--radius-panel)] px-4 pt-2.5 pb-2">
        <header className="flex h-8 items-center gap-2">
          <button
            type="button"
            aria-label={playing ? 'Pause' : 'Play'}
            onClick={timeline.playPause}
            className="flex size-7 shrink-0 items-center justify-center rounded-full bg-starlight/[0.14] text-starlight shadow-[inset_0_0_0_1px_oklch(0.86_0.12_85/0.28)] transition-colors hover:bg-starlight/[0.22]"
          >
            {playing ? <Pause className="size-3.5" fill="currentColor" /> : <Play className="ml-px size-3.5" fill="currentColor" />}
          </button>
          <div role="radiogroup" aria-label="Playback speed" className="flex rounded-full border border-glass-border bg-white/[0.02] p-0.5">
            {SPEEDS.map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={speed === s}
                onClick={() => timeline.setSpeed(s)}
                className={cn(
                  'tabular rounded-full px-2 py-[3px] text-[11.5px] transition-colors',
                  speed === s ? 'bg-white/[0.09] text-ink' : 'text-ink-faint hover:text-ink-muted',
                )}
              >
                {s}×
              </button>
            ))}
          </div>
          <span aria-live="off" className={cn('tabular min-w-0 flex-1 truncate pl-1 text-[12px]', collapsed || readout ? 'text-ink-muted' : 'text-ink-faint')}>
            {collapsed ? ticker : (readout ?? (width >= MIN_HINT_WIDTH_PX ? 'Drag across the bars to filter by month' : null))}
          </span>
          {filters.starred && (
            <span className="flex h-6 min-w-0 items-center rounded-full border border-starlight/30 bg-starlight/[0.08] pl-2.5 text-[11.5px] text-ink">
              <span className="truncate">
                {monthLabel(filters.starred[0])} – {monthLabel(filters.starred[1])}
              </span>
              <button
                type="button"
                aria-label="Clear the starred range"
                onClick={() => setFilters({ ...filters, starred: null })}
                className="ml-0.5 rounded-full p-1 text-ink-faint transition-colors hover:bg-white/10 hover:text-ink"
              >
                <X className="size-3" />
              </button>
            </span>
          )}
          <button
            type="button"
            aria-label={collapsed ? 'Show the histogram' : 'Hide the histogram'}
            aria-expanded={!collapsed}
            onClick={() => setCollapsed(!collapsed)}
            className="rounded-md p-1 text-ink-faint transition-colors hover:bg-white/5 hover:text-ink"
          >
            {collapsed ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
          </button>
          <button
            type="button"
            aria-label="Close the timeline"
            title="Close (t)"
            onClick={timeline.close}
            className="-mr-1 rounded-md p-1 text-ink-faint transition-colors hover:bg-white/5 hover:text-ink"
          >
            <X className="size-4" />
          </button>
        </header>
        <div ref={plot} className={cn(collapsed ? 'mt-1' : 'mt-2.5')}>
          {width > 0 && (
            <>
              {!collapsed && (
                <TimelineHistogram
                  hist={hist}
                  galaxies={g.galaxies}
                  width={width}
                  fraction={fraction}
                  starred={filters.starred}
                  onBrush={(starred) => setFilters({ ...filters, starred })}
                  onSeekFraction={(f) => timeline.seek(fractionToCursor(f))}
                  onReadout={setReadout}
                />
              )}
              <Scrubber width={width} c={c} fraction={fraction} label={ticker} onStep={(k) => timeline.seek(stepCursorByMonths(c, k, range))} />
              {!collapsed && <YearTicks months={hist.months} edges={hist.edges} width={width} />}
            </>
          )}
        </div>
      </section>
    </motion.div>
  )
}

function Scrubber({ width, c, fraction, label, onStep }: { width: number; c: number; fraction: number; label: string; onStep(months: number): void }) {
  const dragging = useRef(false)
  const seekAt = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    timeline.seek(fractionToCursor((e.clientX - r.left) / r.width))
  }
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1, PageDown: -12, PageUp: 12 }[e.key]
    if (step !== undefined) onStep(step)
    else if (e.key === 'Home') timeline.seek(0)
    else if (e.key === 'End') timeline.seek(1)
    else return
    // Also keeps the global keymap from orbiting the camera on arrows.
    e.preventDefault()
  }
  const x = fraction * width
  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label="Timeline position"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(c * 100)}
      aria-valuetext={label}
      onKeyDown={onKey}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        dragging.current = true
        e.currentTarget.setPointerCapture(e.pointerId)
        seekAt(e)
      }}
      onPointerMove={(e) => dragging.current && seekAt(e)}
      onPointerUp={() => (dragging.current = false)}
      onPointerCancel={() => (dragging.current = false)}
      className="group relative h-5 cursor-pointer touch-none rounded-full outline-offset-0"
      style={{ width }}
    >
      <div className="absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-white/[0.1]" />
      <div className="absolute top-1/2 left-0 h-[3px] -translate-y-1/2 rounded-full bg-starlight/60" style={{ width: x }} />
      <div
        className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-starlight shadow-[0_0_0_3px_oklch(0.86_0.12_85/0.18),0_0_12px_2px_oklch(0.86_0.12_85/0.55)] transition-transform group-hover:scale-110"
        style={{ left: x }}
      />
    </div>
  )
}

function YearTicks({ months, edges, width }: { months: string[]; edges: Float64Array; width: number }) {
  const years = months.flatMap((m, k) => (m.endsWith('-01') ? [{ year: m.slice(0, 4), x: edges[k]! * width }] : []))
  const gap = years.length > 1 ? years[1]!.x - years[0]!.x : Infinity
  const every = gap < MIN_YEAR_GAP_PX ? 2 : 1
  return (
    <div aria-hidden className="relative h-4 text-[10.5px] text-ink-faint" style={{ width }}>
      {years.map((y, k) => (
        <span key={y.year} className="absolute top-0 flex flex-col items-center" style={{ left: y.x, transform: 'translateX(-50%)' }}>
          <span className="h-1 w-px bg-white/20" />
          {k % every === 0 && <span className="tabular mt-px font-mono leading-none">{y.year}</span>}
        </span>
      ))}
    </div>
  )
}

/** `value`, switching to a new one only after the current one has shown for `ms`. */
function useHeld<T>(value: T, ms: number): T {
  const [shown, setShown] = useState(value)
  const since = useRef(0)
  useEffect(() => {
    if (Object.is(value, shown)) return
    const wait = since.current + ms - performance.now()
    const swap = () => {
      since.current = performance.now()
      setShown(value)
    }
    if (wait <= 0) return swap()
    const id = setTimeout(swap, wait)
    return () => clearTimeout(id)
  }, [value, shown, ms])
  return shown
}

function useWidth(ref: React.RefObject<HTMLElement | null>) {
  const [w, setW] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setW(Math.floor(el.clientWidth)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return w
}
