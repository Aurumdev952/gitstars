import { useEffect, useRef } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowUpRight, Compass, X } from 'lucide-react'
import { useGalaxyStore } from '#/state/store'
import type { GalaxyIndex } from '#/lib/load'
import { formatAgo, formatCompact, formatMonthYear, splitFullName } from '#/lib/format'
import { forgottenReason } from '#/lib/discovery'
import { toggleValue } from '#/lib/filters'
import { cn } from '#/lib/utils'
import { ClusterDot } from './Legend'
import { useOccluder } from './useOccluder'

export function RepoPanel() {
  const selected = useGalaxyStore((s) => s.selected)
  const g = useGalaxyStore((s) => s.galaxy)
  const frozen = useGalaxyStore((s) => s.frozen)
  const panel = useRef<HTMLElement>(null)
  useOccluder(panel)
  return (
    <AnimatePresence>
      {g && selected !== null && (
        <motion.aside
          key="repo-panel"
          ref={panel}
          aria-label="Repository details"
          initial={frozen ? false : { opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0, transition: { delay: 0.15, duration: 0.32, ease: [0.22, 1, 0.36, 1] } }}
          exit={{ opacity: 0, x: 24, transition: { duration: 0.18 } }}
          className="glass fixed top-4 right-4 bottom-4 z-20 flex w-[min(420px,calc(100vw-2rem))] flex-col overflow-hidden rounded-[var(--radius-panel)]"
        >
          <RepoDetails g={g} i={selected} />
        </motion.aside>
      )}
    </AnimatePresence>
  )
}

function RepoDetails({ g, i }: { g: GalaxyIndex; i: number }) {
  const { select, focus, hover, setFilters } = useGalaxyStore((s) => s.actions)
  const discovered = useGalaxyStore((s) => s.discovered === i)
  const filters = useGalaxyStore((s) => s.filters)
  const r = g.repos[i]!
  const galaxy = g.galaxies[g.galaxyOf[i]!]!
  const system = g.systems[g.systemOf[i]!]!
  const [owner, name] = splitFullName(r.fullName)
  // The stack often repeats the language chip and a tag ("Go", "#go"); show each word once.
  const shown = new Set([r.language ?? '', ...r.tags].map((t) => t.toLowerCase()))
  const stack = r.stack.filter((t) => !shown.has(t.toLowerCase()))
  const now = Date.parse(g.data.meta.generatedAt)
  const heading = useRef<HTMLHeadingElement>(null)
  const body = useRef<HTMLDivElement>(null)

  useEffect(() => {
    heading.current?.focus({ preventScroll: true })
    body.current?.scrollTo({ top: 0 })
  }, [i])

  return (
    <>
      <div
        aria-hidden
        className="h-px w-full shrink-0"
        style={{ background: `linear-gradient(90deg, transparent, ${system.color.css} 30%, ${galaxy.color.css} 70%, transparent)` }}
      />
      <div className="flex shrink-0 items-start gap-3 px-6 pt-5">
        <nav aria-label="Location" className="flex min-w-0 flex-1 items-center gap-1.5 text-[12px] text-ink-faint">
          <ClusterDot color={system.color.css} className="size-1.5" />
          <button type="button" className="truncate hover:text-ink" onClick={() => focus(galaxy.id)}>
            {galaxy.name}
          </button>
          <span aria-hidden>›</span>
          <button type="button" className="truncate hover:text-ink" onClick={() => focus(system.id)}>
            {system.name}
          </button>
        </nav>
        <button
          type="button"
          aria-label="Close details"
          onClick={() => select(null)}
          className="-mt-1 -mr-2 rounded-md p-1.5 text-ink-faint transition-colors hover:bg-white/5 hover:text-ink"
        >
          <X className="size-4" />
        </button>
      </div>

      <div ref={body} className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-6 pb-6">
        <h2 ref={heading} tabIndex={-1} className="mt-3 text-[23px] leading-tight font-semibold tracking-[-0.02em] outline-none">
          <span className="font-normal text-ink-faint">{owner}/</span>
          <wbr />
          <span className="text-ink">{name}</span>
        </h2>

        <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11.5px]">
          <FilterChip on={filters.kind.includes(r.kind)} what={`${r.kind} stars`} onToggle={() => setFilters(toggleValue(filters, 'kind', r.kind))}>
            {r.kind}
          </FilterChip>
          {r.language && (
            <FilterChip
              on={filters.lang.includes(r.language)}
              what={`${r.language} stars`}
              onToggle={() => setFilters(toggleValue(filters, 'lang', r.language!))}
            >
              <span aria-hidden className="mr-1.5 inline-block size-1.5 rounded-full bg-ink-muted" />
              {r.language}
            </FilterChip>
          )}
          {r.archived && <Chip className="border-amber-200/20 text-amber-100/80">archived</Chip>}
        </div>

        {r.outlier && (
          <p className="mt-3 flex items-baseline gap-2 text-[12px] leading-snug text-ink-faint">
            <span aria-hidden className="inline-block size-1.5 shrink-0 translate-y-[-1px] rounded-full border" style={{ borderColor: system.color.css }} />
            <span>
              Loosely placed in{' '}
              <button type="button" className="text-ink-muted underline decoration-white/15 underline-offset-2 hover:text-ink" onClick={() => focus(system.id)}>
                {system.name}
              </button>
              : its nearest stars are spread across several systems.
            </span>
          </p>
        )}

        {discovered && (
          <p className="mt-4 flex items-start gap-2 rounded-xl border border-starlight/20 bg-starlight/[0.06] px-3 py-2.5 text-[12.5px] leading-snug text-[oklch(0.9_0.07_85)]">
            <Compass className="mt-px size-3.5 shrink-0" aria-hidden />
            {forgottenReason(r, now)}
          </p>
        )}

        {r.oneLiner && <p className="mt-4 text-[15px] leading-relaxed text-ink">{r.oneLiner}</p>}
        {r.summary && r.summary !== r.oneLiner && <p className="mt-2.5 text-[13.5px] leading-[1.65] text-ink-muted">{r.summary}</p>}
        {!r.summary && r.description && r.description !== r.oneLiner && (
          <p className="mt-2.5 text-[13.5px] leading-[1.65] text-ink-muted">{r.description}</p>
        )}

        <dl className="mt-5 grid grid-cols-2 gap-x-5 gap-y-3.5 border-t border-glass-border pt-4 text-[12.5px]">
          <Fact label="Stars">
            <span className="tabular text-ink">★ {formatCompact(r.stars)}</span>
            <Meter value={g.attrs.size[i]!} />
          </Fact>
          <Fact label="Last push">
            {r.pushedAt ? <span className="text-ink">{r.archived ? 'archived, ' : 'active '}{formatAgo(r.pushedAt, now)}</span> : <span>unknown</span>}
          </Fact>
          <Fact label="You starred it">
            <span>
              <span className="text-ink">{formatMonthYear(r.starredAt)}</span>
              <span className="text-ink-faint"> · {formatAgo(r.starredAt, now)}</span>
            </span>
          </Fact>
          {r.quality !== null && (
            <Fact label="Summary quality">
              <span className="tabular text-ink" title="The judge model's score for this summary">
                {Math.round(r.quality * 100)}
                <span className="text-ink-faint"> / 100</span>
              </span>
              <Meter value={r.quality} tone="starlight" />
            </Fact>
          )}
        </dl>

        {(r.tags.length > 0 || stack.length > 0) && (
          <div className="mt-5 flex flex-wrap gap-1.5 text-[11.5px]">
            {r.tags.map((t) => (
              <FilterChip key={`t-${t}`} on={filters.tag.includes(t)} what={`stars tagged #${t}`} onToggle={() => setFilters(toggleValue(filters, 'tag', t))}>
                #{t}
              </FilterChip>
            ))}
            {stack.map((t) => (
              <Chip key={`s-${t}`} className="text-ink-faint">
                {t}
              </Chip>
            ))}
          </div>
        )}

        {r.neighbors.length > 0 && (
          <section className="mt-6" onPointerLeave={() => hover(null)}>
            <h3 className="text-[12px] font-medium text-ink-faint">Nearest in your stars</h3>
            <ul className="mt-2 -mx-2">
              {r.neighbors.map(([j, cos]) => {
                const n = g.repos[j]!
                const [o, nm] = splitFullName(n.fullName)
                const c = g.systems[g.systemOf[j]!]!.color.css
                return (
                  <li key={j}>
                    <button
                      type="button"
                      onPointerEnter={() => hover(j)}
                      onFocus={() => hover(j)}
                      onClick={() => select(j)}
                      className="group flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-white/[0.045]"
                    >
                      <ClusterDot color={c} className="size-1.5" />
                      <span className="min-w-0 flex-1 truncate font-mono text-[12px]">
                        <span className="text-ink-faint">{o}/</span>
                        <span className="text-ink-muted group-hover:text-ink">{nm}</span>
                      </span>
                      <span className="flex w-16 items-center gap-1.5">
                        <span className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/[0.07]">
                          <span className="block h-full rounded-full bg-ink-muted/70" style={{ width: `${Math.max(4, cos * 100)}%` }} />
                        </span>
                      </span>
                      <span className="tabular w-8 text-right font-mono text-[10.5px] text-ink-faint">{cos.toFixed(2)}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>
        )}
      </div>

      <div className="flex shrink-0 gap-2 border-t border-glass-border px-6 py-4">
        <LinkButton href={r.url} primary>
          Open on GitHub
        </LinkButton>
        {r.homepage && <LinkButton href={r.homepage}>Homepage</LinkButton>}
      </div>
    </>
  )
}

function Chip({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex items-center rounded-full border border-glass-border bg-white/[0.03] px-2.5 py-[3px] text-ink-muted', className)}>
      {children}
    </span>
  )
}

function FilterChip({ on, what, onToggle, children }: { on: boolean; what: string; onToggle: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      title={on ? `Stop showing only ${what}` : `Show only ${what}`}
      onClick={onToggle}
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-[3px] transition-colors',
        on ? 'border-starlight/50 bg-starlight/[0.12] text-ink' : 'border-glass-border bg-white/[0.03] text-ink-muted hover:border-white/15 hover:text-ink',
      )}
    >
      {children}
    </button>
  )
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11.5px] text-ink-faint">{label}</dt>
      <dd className="mt-1 flex flex-col gap-1.5 text-ink-muted">{children}</dd>
    </div>
  )
}

function Meter({ value, tone = 'ink' }: { value: number; tone?: 'ink' | 'starlight' }) {
  return (
    <span className="block h-[3px] w-full overflow-hidden rounded-full bg-white/[0.07]">
      <span
        className={cn('block h-full rounded-full', tone === 'starlight' ? 'bg-starlight/80' : 'bg-ink-muted/80')}
        style={{ width: `${Math.round(Math.max(0.03, Math.min(1, value)) * 100)}%` }}
      />
    </span>
  )
}

function LinkButton({ href, primary, children }: { href: string; primary?: boolean; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={cn(
        'inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-[13px] font-medium transition-colors',
        primary
          ? 'bg-starlight text-[oklch(0.2_0.03_85)] hover:bg-[oklch(0.9_0.11_85)]'
          : 'border border-glass-border text-ink-muted hover:bg-white/5 hover:text-ink',
      )}
    >
      {children}
      <ArrowUpRight className="size-3.5" />
    </a>
  )
}
