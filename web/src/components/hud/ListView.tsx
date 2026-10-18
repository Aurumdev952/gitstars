import { useMemo, useRef, useState } from 'react'
import { NoMatches } from './NoMatches'
import { useVirtualizer } from '@tanstack/react-virtual'
import { motion } from 'motion/react'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { useGalaxyStore } from '#/state/store'
import type { GalaxyIndex } from '#/lib/load'
import { formatAgo, formatCompact, formatCount, formatMonthYear, splitFullName } from '#/lib/format'
import { cn } from '#/lib/utils'
import { ClusterDot } from './Legend'

type SortKey = 'relevance' | 'name' | 'kind' | 'language' | 'stars' | 'pushed' | 'starred' | 'galaxy'
type Sort = { key: SortKey; dir: 1 | -1 }

const ROW = 54

const COLUMNS: { key: SortKey; label: string; className: string; numeric?: boolean }[] = [
  { key: 'name', label: 'Repository', className: 'min-w-0 flex-1' },
  { key: 'kind', label: 'Kind', className: 'w-[92px] max-[900px]:hidden' },
  { key: 'language', label: 'Language', className: 'w-[112px] max-[760px]:hidden' },
  { key: 'stars', label: 'Stars', className: 'w-[72px] text-right', numeric: true },
  { key: 'pushed', label: 'Pushed', className: 'w-[84px] text-right max-[1040px]:hidden', numeric: true },
  { key: 'starred', label: 'Starred', className: 'w-[92px] text-right max-[1040px]:hidden', numeric: true },
  { key: 'galaxy', label: 'Galaxy', className: 'w-[248px] max-[1400px]:w-[180px] max-[1180px]:hidden' },
]

function comparator(g: GalaxyIndex, key: SortKey): (a: number, b: number) => number {
  const r = g.repos
  const time = (iso: string | null) => (iso ? Date.parse(iso) : 0)
  switch (key) {
    case 'name':
      return (a, b) => r[a]!.fullName.localeCompare(r[b]!.fullName)
    case 'kind':
      return (a, b) => r[a]!.kind.localeCompare(r[b]!.kind)
    case 'language':
      return (a, b) => (r[a]!.language ?? '~').localeCompare(r[b]!.language ?? '~')
    case 'stars':
      return (a, b) => r[a]!.stars - r[b]!.stars
    case 'pushed':
      return (a, b) => time(r[a]!.pushedAt) - time(r[b]!.pushedAt)
    case 'starred':
      return (a, b) => time(r[a]!.starredAt) - time(r[b]!.starredAt)
    case 'galaxy':
      return (a, b) => g.galaxies[g.galaxyOf[a]!]!.name.localeCompare(g.galaxies[g.galaxyOf[b]!]!.name)
    case 'relevance':
      return () => 0
  }
}

/** A sortable, virtualized table over the same filters, search and selection as the scene. */
export function ListView() {
  const g = useGalaxyStore((s) => s.galaxy)!
  const filtered = useGalaxyStore((s) => s.filtered)
  const hits = useGalaxyStore((s) => s.hits)
  const query = useGalaxyStore((s) => s.query)
  const selected = useGalaxyStore((s) => s.selected)
  const panelOpen = useGalaxyStore((s) => s.selected !== null)
  const { select } = useGalaxyStore((s) => s.actions)
  const [sort, setSort] = useState<Sort | null>(null)
  const scroller = useRef<HTMLDivElement>(null)

  const searching = query !== null && hits !== null && hits.query === query
  const effective: Sort = sort ?? (searching ? { key: 'relevance', dir: 1 } : { key: 'stars', dir: -1 })

  const rows = useMemo(() => {
    const visible = filtered?.visible
    const base = searching ? hits.idx.filter((i) => !visible || visible[i]) : [...g.repos.keys()].filter((i) => !visible || visible[i])
    if (effective.key === 'relevance') return base
    const cmp = comparator(g, effective.key)
    return base.sort((a, b) => cmp(a, b) * effective.dir || a - b)
  }, [g, filtered, hits, searching, effective.key, effective.dir])

  const v = useVirtualizer({ count: rows.length, getScrollElement: () => scroller.current, estimateSize: () => ROW, overscan: 12 })
  const now = Date.parse(g.data.meta.generatedAt)

  const toggleSort = (key: SortKey) => {
    const numeric = COLUMNS.find((c) => c.key === key)?.numeric
    setSort(effective.key === key ? { key, dir: effective.dir === 1 ? -1 : 1 } : { key, dir: numeric ? -1 : 1 })
  }

  return (
    <motion.section
      aria-label="Stars as a list"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        'glass fixed top-[128px] bottom-5 left-5 z-10 flex flex-col overflow-hidden rounded-[var(--radius-panel)] transition-[right] duration-300',
        panelOpen ? 'right-[452px] max-[900px]:right-5' : 'right-5',
      )}
    >
      <header className="flex items-baseline gap-3 px-5 pt-4 pb-3">
        <h2 className="text-[14px] font-medium text-ink">{searching ? `Results for “${query}”` : 'All stars'}</h2>
        <p className="tabular text-[12px] text-ink-faint">{formatCount(rows.length)} shown</p>
        {searching && sort && (
          <button type="button" onClick={() => setSort(null)} className="ml-auto text-[12px] text-ink-faint hover:text-ink">
            Sort by relevance
          </button>
        )}
      </header>
      <div className="flex items-center gap-4 overflow-hidden border-y border-glass-border px-5 py-2 text-[11.5px] text-ink-faint [scrollbar-gutter:stable]">
        {COLUMNS.map((c) => (
          <button
            key={c.key}
            type="button"
            aria-label={`Sort by ${c.label}${effective.key === c.key ? (effective.dir === 1 ? ', ascending' : ', descending') : ''}`}
            aria-pressed={effective.key === c.key}
            onClick={() => toggleSort(c.key)}
            className={cn('flex items-center gap-1 transition-colors hover:text-ink', c.className, c.numeric && 'justify-end', effective.key === c.key && 'text-ink-muted')}
          >
            {c.label}
            {effective.key === c.key && (effective.dir === 1 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
          </button>
        ))}
      </div>
      <div ref={scroller} className="scrollbar-thin min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
        {rows.length === 0 && <NoMatches inline />}
        <div className="relative w-full" style={{ height: v.getTotalSize() }}>
          {v.getVirtualItems().map((item) => {
            const i = rows[item.index]!
            const r = g.repos[i]!
            const [owner, name] = splitFullName(r.fullName)
            const sys = g.systems[g.systemOf[i]!]!
            const gal = g.galaxies[g.galaxyOf[i]!]!
            return (
              <button
                key={i}
                type="button"
                aria-pressed={selected === i}
                onClick={() => select(selected === i ? null : i)}
                className={cn(
                  'absolute top-0 left-0 flex w-full items-center gap-4 border-b border-white/[0.035] px-5 text-left transition-colors hover:bg-white/[0.035]',
                  selected === i && 'bg-starlight/[0.07] hover:bg-starlight/[0.09]',
                )}
                style={{ height: ROW, transform: `translateY(${item.start}px)` }}
              >
                <span className="flex min-w-0 flex-1 items-center gap-3">
                  <ClusterDot color={sys.color.css} className="size-1.5" />
                  <span className="min-w-0">
                    <span className="block truncate font-mono text-[12.5px]">
                      <span className="text-ink-faint">{owner}/</span>
                      <span className="text-ink">{name}</span>
                      {r.archived && <span className="ml-2 font-sans text-[10.5px] text-amber-100/60">archived</span>}
                    </span>
                    <span title={r.oneLiner} className="mt-0.5 block truncate text-[12px] text-ink-faint">{r.oneLiner}</span>
                  </span>
                </span>
                <span className="w-[92px] truncate text-[12px] text-ink-muted max-[900px]:hidden">{r.kind}</span>
                <span className="w-[112px] truncate text-[12px] text-ink-muted max-[760px]:hidden">{r.language ?? '—'}</span>
                <span className="tabular w-[72px] text-right font-mono text-[12px] text-ink">{formatCompact(r.stars)}</span>
                <span className="tabular w-[84px] text-right text-[12px] text-ink-faint max-[1040px]:hidden">{r.pushedAt ? formatAgo(r.pushedAt, now) : '—'}</span>
                <span className="tabular w-[92px] text-right text-[12px] text-ink-faint max-[1040px]:hidden">{formatMonthYear(r.starredAt)}</span>
                <span title={`${gal.name} › ${sys.name}`} className="flex w-[248px] min-w-0 items-center gap-1.5 text-[12px] text-ink-muted max-[1400px]:w-[180px] max-[1180px]:hidden">
                  <ClusterDot color={gal.color.css} className="size-1.5" />
                  <span className="truncate">{gal.name}</span>
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </motion.section>
  )
}
