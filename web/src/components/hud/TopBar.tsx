import { useRef, useState, type CSSProperties } from 'react'
import { motion } from 'motion/react'
import { Box, List, Map as MapIcon, Search, Settings2, Sparkles, X } from 'lucide-react'
import { useGalaxyStore, type Settings, type View } from '#/state/store'
import { commands } from '#/state/commands'
import { activeFacets, clearFacet, type FacetKey, type Filters } from '#/lib/filters'
import { formatCompact, formatCount, formatMonthYear } from '#/lib/format'
import { lensRampCss } from '#/lib/lens'
import { cn } from '#/lib/utils'
import { Kbd } from '#/components/ui/kbd'
import { Popover, PopoverContent, PopoverTrigger } from '#/components/ui/popover'
import { FilterButton } from './FilterPopover'
import { useOccluder } from './useOccluder'

export function StarMark({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className}>
      <path d="M12 1.5 L13 11 L22.5 12 L13 13 L12 22.5 L11 13 L1.5 12 L11 11 Z" fill="currentColor" />
      <circle cx="12" cy="12" r="2.2" fill="white" />
    </svg>
  )
}

export function TopBar({ dataName }: { dataName: string }) {
  return (
    <>
      <Wordmark dataName={dataName} />
      <SearchCluster />
      <TopRight />
    </>
  )
}

function Wordmark({ dataName }: { dataName: string }) {
  const g = useGalaxyStore((s) => s.galaxy)
  const shown = useGalaxyStore((s) => s.filtered?.count ?? null)
  const ref = useRef<HTMLElement>(null)
  // The wordmark letter-spaces in as the intro opens; on a deep link it is simply there.
  const [entering] = useState(() => useGalaxyStore.getState().intro === 'spiral')
  useOccluder(ref)
  if (!g) return null
  const { counts } = g.data.meta
  const filtered = shown !== null && shown < g.n
  return (
    <header ref={ref} className="pointer-events-none fixed top-0 left-0 z-10 px-6 pt-5 pb-3 select-none before:absolute before:-inset-x-10 before:-inset-y-8 before:-z-10 before:bg-[radial-gradient(closest-side,rgb(3_3_10/0.6),transparent)]">
      <h1 className="flex items-center gap-2.5 text-[19px] font-medium tracking-[-0.01em] text-ink [text-shadow:0_1px_12px_rgb(0_0_0/0.8)]">
        <StarMark className="size-[18px] text-starlight drop-shadow-[0_0_6px_oklch(0.86_0.12_85/0.7)]" />
        <motion.span
          initial={entering ? { letterSpacing: '0.6em', opacity: 0, filter: 'blur(6px)' } : false}
          animate={{ letterSpacing: '-0.01em', opacity: 1, filter: 'blur(0px)' }}
          transition={{ duration: 1.2, ease: [0.16, 0.8, 0.24, 1] }}
        >
          gitstars
        </motion.span>
        {dataName !== 'galaxy' && (
          <span className="rounded-full border border-glass-border px-2 py-0.5 font-mono text-[10.5px] font-normal tracking-normal text-ink-faint">
            {dataName}
          </span>
        )}
      </h1>
      <p className="mt-1.5 flex gap-3.5 pl-[28px] text-[12.5px] text-ink-faint [text-shadow:0_1px_8px_rgb(0_0_0/0.9)]">
        <span>
          {filtered && (
            <>
              <span className="tabular font-medium text-starlight">{formatCount(shown)}</span> of{' '}
            </>
          )}
          <span className="tabular font-medium text-ink-muted">{formatCount(counts.repos)}</span> stars
        </span>
        <span>
          <span className="tabular font-medium text-ink-muted">{formatCount(counts.galaxies)}</span> galaxies
        </span>
        <span>
          <span className="tabular font-medium text-ink-muted">{formatCount(counts.systems)}</span> systems
        </span>
      </p>
      <p className="mt-0.5 pl-[28px] text-[11.5px] text-ink-faint max-[1100px]:hidden [text-shadow:0_1px_8px_rgb(0_0_0/0.9)]">
        starred by <span className="text-ink-faint">{g.data.meta.viewer}</span>
      </p>
    </header>
  )
}

function SearchCluster() {
  const query = useGalaxyStore((s) => s.query)
  const hits = useGalaxyStore((s) => s.hits)
  const lensQuery = useGalaxyStore((s) => s.lensQuery)
  const filters = useGalaxyStore((s) => s.filters)
  const view = useGalaxyStore((s) => s.view)
  // The 420 px detail panel covers the right of a narrow window; the pill then centres in what is left.
  const sidePanel = useGalaxyStore((s) => s.selected !== null || s.focusCluster !== null)
  const ref = useRef<HTMLDivElement>(null)
  useOccluder(ref)
  const facets = activeFacets(filters)
  return (
    <div
      ref={ref}
      style={{ '--hud-i': 0 } as CSSProperties}
      className={cn(
        'hud-enter fixed top-4 left-1/2 z-20 flex w-[min(440px,calc(100vw-2rem))] -translate-x-1/2 flex-col items-center gap-2 max-[1100px]:top-[76px]',
        sidePanel && 'max-[1100px]:left-[calc((100vw-436px)/2)] max-[1100px]:w-[min(440px,calc(100vw-468px))]',
      )}
    >
      <div className="glass flex h-10 w-full items-center rounded-full text-[13.5px] text-ink-faint">
        <button
          type="button"
          onClick={commands.openPalette}
          className="flex h-full min-w-0 flex-1 items-center gap-2.5 rounded-full pr-2 pl-4 text-left transition-colors hover:text-ink-muted"
        >
          <Search className="size-4 shrink-0" aria-hidden />
          {query ? (
            <span className="min-w-0 flex-1 truncate text-ink">
              {query}
              {hits && hits.query === query && (
                <span className="ml-2 text-ink-faint">
                  {hits.idx.length} {hits.idx.length === 1 ? 'hit' : 'hits'}
                </span>
              )}
            </span>
          ) : (
            <span className="flex-1">{view === 'list' ? 'Search the list…' : 'Search your stars…'}</span>
          )}
          {!query && (
            <span className="flex items-center gap-1">
              <Kbd>⌘</Kbd>
              <Kbd>K</Kbd>
            </span>
          )}
        </button>
        {query && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={commands.clearQuery}
            className="mr-1.5 rounded-full p-1.5 text-ink-faint transition-colors hover:bg-white/10 hover:text-ink"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>
      {(lensQuery || facets.length > 0) && (
        <ul aria-label="Active filters" className="flex max-w-[min(720px,calc(100vw-2rem))] flex-wrap justify-center gap-1.5">
          {lensQuery && (
            <Chip key="lens" onOpen={commands.openPalette} onClear={commands.clearLens} label={`Lens “${lensQuery}”`}>
              <span aria-hidden className="h-2 w-5 rounded-full" style={{ background: lensRampCss() }} />
              <span className="text-ink-faint">Lens</span>
              <span className="truncate">{lensQuery}</span>
            </Chip>
          )}
          {facets.map((k) => (
            <Chip
              key={k}
              onOpen={commands.openFilters}
              onClear={() => useGalaxyStore.getState().actions.setFilters(clearFacet(filters, k))}
              label={facetChip(k, filters)}
            >
              <span className="truncate">{facetChip(k, filters)}</span>
            </Chip>
          ))}
        </ul>
      )}
    </div>
  )
}

function facetChip(k: FacetKey, f: Filters): string {
  const list = (v: readonly string[]) => (v.length <= 2 ? v.join(', ') : `${v.slice(0, 2).join(', ')} +${v.length - 2}`)
  switch (k) {
    case 'kind':
      return list(f.kind)
    case 'lang':
      return list(f.lang)
    case 'tag':
      return list(f.tag.map((t) => `#${t}`))
    case 'stars':
      return `★ ${formatCompact(f.stars![0])}–${formatCompact(f.stars![1])}`
    case 'starred': {
      const m = (s: string) => formatMonthYear(`${s}-01T00:00:00Z`)
      return `Starred ${m(f.starred![0])} – ${m(f.starred![1])}`
    }
    case 'pushed':
      return f.pushed === '1y' ? 'Pushed within a year' : 'Pushed within 6 months'
    case 'archived':
      return f.archived === 'exclude' ? 'No archived' : 'Only archived'
  }
}

function Chip({ children, onOpen, onClear, label }: { children: React.ReactNode; onOpen: () => void; onClear: () => void; label: string }) {
  return (
    <motion.li
      layout
      initial={{ opacity: 0, scale: 0.92 }}
      animate={{ opacity: 1, scale: 1 }}
      className="glass flex h-7 max-w-[260px] items-center rounded-full text-[12px] text-ink"
    >
      <button type="button" onClick={onOpen} className="flex min-w-0 items-center gap-1.5 py-1 pr-1 pl-3">
        {children}
      </button>
      <button
        type="button"
        aria-label={`Remove ${label}`}
        onClick={onClear}
        className="mr-1 rounded-full p-1 text-ink-faint transition-colors hover:bg-white/10 hover:text-ink"
      >
        <X className="size-3" />
      </button>
    </motion.li>
  )
}

const TIER_LABEL = { low: 'low', med: 'medium', high: 'high' } as const

const VIEWS: { id: View; label: string; icon: typeof Box; key: string }[] = [
  { id: '3d', label: '3D', icon: Box, key: 'f' },
  { id: 'flat', label: 'Flat', icon: MapIcon, key: 'f' },
  { id: 'list', label: 'List', icon: List, key: 'l' },
]

function TopRight() {
  const view = useGalaxyStore((s) => s.view)
  const { setView } = useGalaxyStore((s) => s.actions)
  const ref = useRef<HTMLDivElement>(null)
  useOccluder(ref)
  return (
    <div ref={ref} style={{ '--hud-i': 1 } as CSSProperties} className="hud-enter fixed top-4 right-4 z-20 flex items-center gap-2">
      <div role="radiogroup" aria-label="View" className="glass flex h-9 items-center rounded-full p-1">
        {VIEWS.map(({ id, label, icon: Icon, key }) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={view === id}
            title={`${label} (${key})`}
            onClick={() => setView(id)}
            className={cn(
              'relative flex h-7 items-center gap-1.5 rounded-full px-3 text-[12.5px] transition-colors',
              view === id ? 'text-ink' : 'text-ink-faint hover:text-ink-muted',
            )}
          >
            {view === id && (
              <motion.span
                layoutId="view-pill"
                className="absolute inset-0 rounded-full bg-white/[0.09] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.07)]"
                transition={{ type: 'spring', stiffness: 500, damping: 38 }}
              />
            )}
            <Icon className="relative size-3.5" aria-hidden />
            <span className="relative">{label}</span>
          </button>
        ))}
      </div>
      <FilterButton />
      <SettingsButton />
    </div>
  )
}

function SettingsButton() {
  const settings = useGalaxyStore((s) => s.settings)
  const autoTier = useGalaxyStore((s) => s.autoTier)
  const open = useGalaxyStore((s) => s.overlay === 'settings')
  const { setSettings, setOverlay } = useGalaxyStore((s) => s.actions)
  const row = <K extends keyof Settings>(key: K, label: string, options: [Settings[K], string][]) => (
    <div className="flex items-center justify-between gap-4">
      <span className="text-[12.5px] text-ink-muted">{label}</span>
      <div className="flex rounded-full border border-glass-border bg-white/[0.02] p-0.5">
        {options.map(([v, text]) => (
          <button
            key={String(v)}
            type="button"
            aria-pressed={settings[key] === v}
            onClick={() => setSettings({ [key]: v } as Partial<Settings>)}
            className={cn(
              'rounded-full px-2.5 py-1 text-[11.5px] transition-colors',
              settings[key] === v ? 'bg-white/[0.09] text-ink' : 'text-ink-faint hover:text-ink-muted',
            )}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  )
  return (
    <Popover open={open} onOpenChange={(o) => setOverlay(o ? 'settings' : 'none')}>
      <PopoverTrigger asChild>
        <button type="button" aria-label="Settings" className="glass flex size-9 items-center justify-center rounded-full text-ink-muted transition-colors hover:text-ink">
          <Settings2 className="size-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[300px] space-y-3 p-4">
        <h2 className="flex items-center gap-2 text-[13px] font-medium text-ink">
          <Sparkles className="size-3.5 text-starlight" aria-hidden /> Display
        </h2>
        {row('motion', 'Motion', [
          ['full', 'Full'],
          ['reduced', 'Reduced'],
        ])}
        {row('autorotate', 'Drift when idle', [
          [true, 'On'],
          [false, 'Off'],
        ])}
        {row('ghosts', 'Filtered-out stars', [
          [true, 'Ghosts'],
          [false, 'Hidden'],
        ])}
        {row('labels', 'Labels', [
          ['auto', 'Auto'],
          ['more', 'More'],
          ['none', 'Off'],
        ])}
        <div className="border-t border-glass-border pt-3">
          {row('quality', 'Quality', [
            ['auto', 'Auto'],
            ['low', 'Low'],
            ['med', 'Med'],
            ['high', 'High'],
          ])}
          <p className="mt-1.5 text-[11.5px] leading-snug text-ink-faint">
            {settings.quality === 'auto' ? (
              <>
                Adapts to your frame rate; now <span className="text-ink-muted">{TIER_LABEL[autoTier]}</span>.
              </>
            ) : (
              'High adds lens aberration; Low drops bloom detail, grain and depth of field.'
            )}
          </p>
        </div>
      </PopoverContent>
    </Popover>
  )
}
