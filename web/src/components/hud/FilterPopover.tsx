import { useMemo, useState, type ReactNode } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import { useGalaxyStore } from '#/state/store'
import {
  NO_FILTERS,
  STAR_BINS_PER_DECADE,
  activeFacets,
  filterColumns,
  toggleValue,
  type ArchivedMode,
  type FacetCounts,
  type Filters,
  type PushedWithin,
} from '#/lib/filters'
import { formatCompact, formatCount, formatMonthYear } from '#/lib/format'
import { Kind } from '#/lib/schema'
import { cn } from '#/lib/utils'
import { Popover, PopoverContent, PopoverTrigger } from '#/components/ui/popover'
import { Slider } from '#/components/ui/slider'

const TOP_LANGUAGES = 10
const TOP_TAGS = 14

export function FilterButton() {
  const open = useGalaxyStore((s) => s.overlay === 'filters')
  const active = useGalaxyStore((s) => activeFacets(s.filters).length)
  const { setOverlay } = useGalaxyStore((s) => s.actions)
  return (
    <Popover open={open} onOpenChange={(o) => setOverlay(o ? 'filters' : 'none')}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'glass flex h-9 items-center gap-2 rounded-full px-3.5 text-[13px] text-ink-muted transition-colors hover:text-ink',
            (open || active > 0) && 'text-ink',
          )}
        >
          <SlidersHorizontal className="size-3.5" />
          Filters
          {active > 0 && (
            <span className="tabular flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-starlight px-1 text-[10.5px] font-semibold text-[oklch(0.2_0.03_85)]">
              {active}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(408px,calc(100vw-2rem))]" collisionPadding={16}>
        <FilterForm />
      </PopoverContent>
    </Popover>
  )
}

function FilterForm() {
  const g = useGalaxyStore((s) => s.galaxy)!
  const filters = useGalaxyStore((s) => s.filters)
  const filtered = useGalaxyStore((s) => s.filtered)!
  const { setFilters } = useGalaxyStore((s) => s.actions)
  const cols = filterColumns(g)
  const f = filtered.facets
  const set = (next: Filters) => setFilters(next)
  const any = activeFacets(filters).length > 0

  return (
    <div className="flex max-h-[min(78vh,720px)] flex-col">
      <header className="flex items-baseline gap-3 border-b border-glass-border px-5 pt-4 pb-3">
        <h2 className="text-[14px] font-medium text-ink">Filters</h2>
        <p className="tabular text-[12px] text-ink-faint">
          <span className="text-ink-muted">{formatCount(filtered.count)}</span> of {formatCount(g.n)} stars
        </p>
        <button
          type="button"
          disabled={!any}
          onClick={() => set(NO_FILTERS)}
          className="ml-auto text-[12px] text-ink-faint transition-colors hover:text-ink disabled:opacity-0"
        >
          Reset
        </button>
      </header>
      <div className="scrollbar-thin min-h-0 flex-1 space-y-5 overflow-y-auto px-5 pt-4 pb-5">
        <Section title="Kind">
          <ChipSet
            options={Kind.options.filter((k) => cols.kind.includes(k))}
            selected={filters.kind}
            counts={f.kind}
            onToggle={(k) => set(toggleValue(filters, 'kind', k as Kind))}
          />
        </Section>
        <LanguageSection filters={filters} counts={f} onChange={set} />
        <TagSection filters={filters} counts={f} onChange={set} />
        <Section title="Stars" value={starsLabel(filters.stars)}>
          <StarsRange filters={filters} counts={f.stars} maxStars={maxStars(cols.stars)} onChange={set} />
        </Section>
        <Section title="Starred" value={filters.starred ? `${monthLabel(filters.starred[0])} – ${monthLabel(filters.starred[1])}` : 'any time'}>
          <StarredRange filters={filters} counts={f.starred} months={cols.months} onChange={set} />
        </Section>
        <Section title="Last push">
          <Segmented<PushedWithin>
            value={filters.pushed}
            onChange={(pushed) => set({ ...filters, pushed })}
            options={[
              ['any', 'Any time', f.pushed.any],
              ['1y', 'Within a year', f.pushed['1y']],
              ['6m', 'Within 6 months', f.pushed['6m']],
            ]}
          />
        </Section>
        <Section title="Archived">
          <Segmented<ArchivedMode>
            value={filters.archived}
            onChange={(archived) => set({ ...filters, archived })}
            options={[
              ['include', 'Include', f.archived.active + f.archived.archived],
              ['exclude', 'Hide', f.archived.active],
              ['only', 'Only archived', f.archived.archived],
            ]}
          />
        </Section>
      </div>
    </div>
  )
}

function Section({ title, value, children }: { title: string; value?: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 flex items-baseline justify-between text-[11.5px] font-medium tracking-[0.02em] text-ink-faint">
        {title}
        {value && <span className="tabular font-normal text-ink-muted">{value}</span>}
      </h3>
      {children}
    </section>
  )
}

function ChipSet({
  options,
  selected,
  counts,
  onToggle,
}: {
  options: readonly string[]
  selected: readonly string[]
  counts: Map<string, number>
  onToggle: (v: string) => void
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = selected.includes(o)
        const n = counts.get(o) ?? 0
        return (
          <button
            key={o}
            type="button"
            aria-pressed={on}
            disabled={!on && n === 0}
            onClick={() => onToggle(o)}
            className={cn(
              'flex items-center gap-1.5 rounded-full border px-2.5 py-[3px] text-[12px] transition-colors',
              on
                ? 'border-starlight/50 bg-starlight/[0.12] text-ink'
                : 'border-glass-border bg-white/[0.025] text-ink-muted hover:border-white/15 hover:text-ink',
              'disabled:cursor-default disabled:opacity-35',
            )}
          >
            {o}
            <span className={cn('tabular text-[10.5px]', on ? 'text-starlight/90' : 'text-ink-faint')}>{formatCompact(n)}</span>
          </button>
        )
      })}
    </div>
  )
}

function topOf(counts: Map<string, number>, selected: readonly string[], limit: number): string[] {
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k]) => k)
  const head = ranked.slice(0, limit)
  return [...head, ...selected.filter((s) => !head.includes(s))]
}

function LanguageSection({ filters, counts, onChange }: { filters: Filters; counts: FacetCounts; onChange: (f: Filters) => void }) {
  const [all, setAll] = useState(false)
  const shown = all ? topOf(counts.lang, filters.lang, Infinity) : topOf(counts.lang, filters.lang, TOP_LANGUAGES)
  const more = counts.lang.size - TOP_LANGUAGES
  return (
    <Section title="Language">
      <ChipSet options={shown} selected={filters.lang} counts={counts.lang} onToggle={(l) => onChange(toggleValue(filters, 'lang', l))} />
      {more > 0 && (
        <button type="button" onClick={() => setAll(!all)} className="mt-2 text-[11.5px] text-ink-faint transition-colors hover:text-ink">
          {all ? 'Fewer languages' : `${more} more languages`}
        </button>
      )}
    </Section>
  )
}

function TagSection({ filters, counts, onChange }: { filters: Filters; counts: FacetCounts; onChange: (f: Filters) => void }) {
  const [find, setFind] = useState('')
  const needle = find.trim().toLowerCase()
  const shown = useMemo(() => {
    if (!needle) return topOf(counts.tag, filters.tag, TOP_TAGS)
    return [...counts.tag.entries()]
      .filter(([t]) => t.toLowerCase().includes(needle))
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOP_TAGS)
      .map(([t]) => t)
  }, [counts.tag, filters.tag, needle])
  if (counts.tag.size === 0 && filters.tag.length === 0) return null
  return (
    <Section title="Tags">
      <input
        value={find}
        onChange={(e) => setFind(e.target.value)}
        placeholder={`Find among ${formatCount(counts.tag.size)} tags…`}
        className="mb-2 h-8 w-full rounded-lg border border-glass-border bg-white/[0.03] px-2.5 text-[12.5px] text-ink outline-none placeholder:text-ink-faint focus:border-starlight/40"
      />
      <ChipSet options={shown} selected={filters.tag} counts={counts.tag} onToggle={(t) => onChange(toggleValue(filters, 'tag', t))} />
    </Section>
  )
}

function Histogram({ counts, lo, hi }: { counts: readonly number[]; lo: number; hi: number }) {
  const max = Math.max(1, ...counts)
  return (
    <div aria-hidden className="flex h-9 items-end gap-px px-[7px]">
      {counts.map((c, k) => (
        <span
          key={k}
          className={cn('flex-1 rounded-t-[2px] transition-colors', k >= lo && k <= hi ? 'bg-ink-muted/55' : 'bg-white/[0.07]')}
          style={{ height: `${c === 0 ? 0 : Math.max(6, (c / max) * 100)}%` }}
        />
      ))}
    </div>
  )
}

const starsAt = (bin: number) => Math.round(10 ** (bin / STAR_BINS_PER_DECADE))

function starsLabel(r: Filters['stars']) {
  if (!r) return 'any'
  return `${formatCompact(r[0])} – ${formatCompact(r[1])}`
}

const maxStars = (stars: Float64Array) => stars.reduce((m, s) => Math.max(m, s), 0)

function StarsRange({ filters, counts, maxStars, onChange }: { filters: Filters; counts: number[]; maxStars: number; onChange: (f: Filters) => void }) {
  const bins = counts.length
  const toBin = (stars: number, up: boolean) =>
    stars >= maxStars ? bins : Math.min(bins, Math.round(Math.log10(Math.max(1, stars + (up ? 1 : 0))) * STAR_BINS_PER_DECADE))
  const value: [number, number] = filters.stars ? [toBin(filters.stars[0], false), toBin(filters.stars[1], true)] : [0, bins]
  return (
    <>
      <Histogram counts={counts} lo={value[0]} hi={value[1] - 1} />
      <Slider
        min={0}
        max={bins}
        step={1}
        minStepsBetweenThumbs={1}
        value={value}
        thumbLabels={['Fewest stars', 'Most stars']}
        onValueChange={([a, b]) => {
          const full = a === 0 && b === bins
          onChange({ ...filters, stars: full ? null : [a === 0 ? 0 : starsAt(a!), b === bins ? maxStars : starsAt(b!) - 1] })
        }}
      />
    </>
  )
}

const monthLabel = (m: string) => formatMonthYear(`${m}-01T00:00:00Z`)

function StarredRange({ filters, counts, months, onChange }: { filters: Filters; counts: number[]; months: string[]; onChange: (f: Filters) => void }) {
  const last = months.length - 1
  if (last < 1) return null
  const value: [number, number] = filters.starred
    ? [Math.max(0, months.indexOf(filters.starred[0])), Math.max(0, months.indexOf(filters.starred[1]))]
    : [0, last]
  return (
    <>
      <Histogram counts={counts} lo={value[0]} hi={value[1]} />
      <Slider
        min={0}
        max={last}
        step={1}
        value={value}
        thumbLabels={['Starred from', 'Starred until']}
        onValueChange={([a, b]) => onChange({ ...filters, starred: a === 0 && b === last ? null : [months[a!]!, months[b!]!] })}
      />
    </>
  )
}

function Segmented<T extends string>({ value, options, onChange }: { value: T; options: [T, string, number][]; onChange: (v: T) => void }) {
  return (
    <div role="radiogroup" className="grid auto-cols-fr grid-flow-col gap-1 rounded-[11px] border border-glass-border bg-white/[0.02] p-1">
      {options.map(([v, label, n]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          onClick={() => onChange(v)}
          className={cn(
            'flex flex-col items-center rounded-[8px] px-2 py-1.5 text-[12px] transition-colors',
            value === v ? 'bg-white/[0.08] text-ink shadow-[inset_0_0_0_1px_rgb(255_255_255/0.06)]' : 'text-ink-muted hover:text-ink',
          )}
        >
          {label}
          <span className="tabular text-[10.5px] text-ink-faint">{formatCount(n)}</span>
        </button>
      ))}
    </div>
  )
}
