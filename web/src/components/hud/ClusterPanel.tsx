import { useEffect, useMemo, useRef } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { X } from 'lucide-react'
import { useGalaxyStore } from '#/state/store'
import type { ClusterNode, GalaxyIndex } from '#/lib/load'
import { formatCompact, formatCount, splitFullName } from '#/lib/format'
import { toggleValue, type Filters } from '#/lib/filters'
import { memberGroups } from '#/lib/members'
import { cn } from '#/lib/utils'
import { ClusterDot } from './Legend'
import { useOccluder } from './useOccluder'

const MEMBERS_SHOWN = 80
const LOOSE_SHOWN = 40

export function ClusterPanel() {
  const id = useGalaxyStore((s) => (s.selected === null && s.view !== 'list' ? s.focusCluster : null))
  const g = useGalaxyStore((s) => s.galaxy)
  const frozen = useGalaxyStore((s) => s.frozen)
  const panel = useRef<HTMLElement>(null)
  useOccluder(panel)
  const node = id && g ? g.clusterById.get(id) : undefined
  return (
    <AnimatePresence>
      {g && node && (
        <motion.aside
          key="cluster-panel"
          ref={panel}
          aria-label={`${node.level === 0 ? 'Galaxy' : 'System'} details`}
          initial={frozen ? false : { opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0, transition: { delay: 0.12, duration: 0.32, ease: [0.22, 1, 0.36, 1] } }}
          exit={{ opacity: 0, x: 24, transition: { duration: 0.16 } }}
          className="glass fixed top-4 right-4 bottom-4 z-20 flex w-[min(420px,calc(100vw-2rem))] flex-col overflow-hidden rounded-[var(--radius-panel)]"
        >
          <ClusterDetails g={g} c={node} />
        </motion.aside>
      )}
    </AnimatePresence>
  )
}

function mix(members: readonly number[], key: (i: number) => string | null) {
  const counts = new Map<string, number>()
  for (const i of members) {
    const k = key(i)
    if (k) counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}

function ClusterDetails({ g, c }: { g: GalaxyIndex; c: ClusterNode }) {
  const { focus, select, hover, hoverCluster, setFilters } = useGalaxyStore((s) => s.actions)
  const filters = useGalaxyStore((s) => s.filters)
  const hovered = useGalaxyStore((s) => s.hovered)
  const visible = useGalaxyStore((s) => s.filtered?.visible ?? null)
  const parent = c.parentId ? g.clusterById.get(c.parentId) : undefined
  const children = c.level === 0 ? g.systems.filter((s) => s.parentId === c.id) : []
  // System bars compare systems with each other; against the galaxy total the largest is a sliver.
  const largest = Math.max(1, ...children.map((s) => s.members.length))
  const heading = useRef<HTMLHeadingElement>(null)
  const list = useRef<HTMLDivElement>(null)

  useEffect(() => heading.current?.focus({ preventScroll: true }), [c.id])

  const { kinds, languages, core, loose, shownCount } = useMemo(() => {
    const groups = memberGroups(c, g.repos, visible)
    return {
      kinds: mix(c.members, (i) => g.repos[i]!.kind),
      languages: mix(c.members, (i) => g.repos[i]!.language),
      ...groups,
      shownCount: groups.core.length + groups.loose.length,
    }
  }, [g, c, visible])
  const row = (i: number, loosely: boolean) => {
    const r = g.repos[i]!
    const [o, nm] = splitFullName(r.fullName)
    return (
      <li key={i}>
        <button
          type="button"
          data-star={i}
          onPointerEnter={() => hover(i)}
          onFocus={() => hover(i)}
          onClick={() => select(i)}
          className={cn(
            'group flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-white/[0.045]',
            hovered === i && 'bg-white/[0.06]',
          )}
        >
          {loosely ? (
            <span aria-hidden className="inline-block size-1.5 shrink-0 rounded-full border" style={{ borderColor: g.systems[g.systemOf[i]!]!.color.css }} />
          ) : (
            <ClusterDot color={g.systems[g.systemOf[i]!]!.color.css} className="size-1.5" />
          )}
          <span className="min-w-0 flex-1 truncate font-mono text-[12px]">
            <span className="text-ink-faint">{o}/</span>
            <span className={cn('group-hover:text-ink', hovered === i ? 'text-ink' : loosely ? 'text-ink-faint' : 'text-ink-muted')}>{nm}</span>
          </span>
          <span className="tabular font-mono text-[10.5px] text-ink-faint">★ {formatCompact(r.stars)}</span>
        </button>
      </li>
    )
  }

  // Scene hover lights the matching row, so list and galaxy read as one.
  useEffect(() => {
    if (hovered === null) return
    list.current?.querySelector(`[data-star="${hovered}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [hovered])

  const total = c.members.length
  return (
    <>
      <div aria-hidden className="h-px w-full shrink-0" style={{ background: `linear-gradient(90deg, transparent, ${c.color.css} 40%, transparent)` }} />
      <div className="flex shrink-0 items-start gap-3 px-6 pt-5">
        <nav aria-label="Location" className="flex min-w-0 flex-1 items-center gap-1.5 text-[12px] text-ink-faint">
          <ClusterDot color={(parent ?? c).color.css} className="size-1.5" />
          {parent ? (
            <>
              <button type="button" className="truncate hover:text-ink" onClick={() => focus(parent.id)}>
                {parent.name}
              </button>
              <span aria-hidden>›</span>
              <span className="truncate text-ink-muted">system</span>
            </>
          ) : (
            <span>galaxy</span>
          )}
        </nav>
        <button
          type="button"
          aria-label="Close"
          onClick={() => focus(parent ? parent.id : null)}
          className="-mt-1 -mr-2 rounded-md p-1.5 text-ink-faint transition-colors hover:bg-white/5 hover:text-ink"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-6 pb-6">
        <h2 ref={heading} tabIndex={-1} className="mt-3 flex items-center gap-2.5 text-[23px] leading-tight font-semibold tracking-[-0.02em] text-ink outline-none">
          <ClusterDot color={c.color.css} className="size-2.5" />
          {c.name}
        </h2>
        <p className="tabular mt-1.5 text-[12.5px] text-ink-faint">
          {formatCount(total)} stars
          {children.length > 0 && ` · ${children.length} systems`}
          {shownCount < total && <span className="text-starlight/90"> · {formatCount(shownCount)} match filters</span>}
        </p>

        {c.blurb && <p className="mt-4 text-[14.5px] leading-relaxed text-ink">{c.blurb}</p>}
        {c.keywords.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5 text-[11.5px]">
            {c.keywords.map((k) => (
              <span key={k} className="rounded-full border border-glass-border bg-white/[0.03] px-2.5 py-[3px] text-ink-muted">
                {k}
              </span>
            ))}
          </div>
        )}

        <div className="mt-5 grid grid-cols-2 gap-5 border-t border-glass-border pt-4">
          <MixBars title="Kinds" rows={kinds} total={total} color={c.color.css} active={filters.kind} onToggle={(k) => setFilters(toggleValue(filters, 'kind', k as Filters['kind'][number]))} />
          <MixBars title="Languages" rows={languages} total={total} color={c.color.css} active={filters.lang} onToggle={(k) => setFilters(toggleValue(filters, 'lang', k))} />
        </div>

        {children.length > 0 && (
          <section className="mt-6">
            <h3 className="text-[12px] font-medium text-ink-faint">Systems</h3>
            <ul className="mt-2 -mx-2" onPointerLeave={() => hoverCluster(null)}>
              {children.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onPointerEnter={() => hoverCluster(s.id)}
                    onFocus={() => hoverCluster(s.id)}
                    onBlur={() => hoverCluster(null)}
                    onClick={() => focus(s.id)}
                    className="group flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[13px] text-ink-muted transition-colors hover:bg-white/[0.045] hover:text-ink"
                  >
                    <ClusterDot color={s.color.css} className="size-1.5" />
                    <span className="min-w-0 flex-1 truncate">{s.name}</span>
                    <span className="h-[3px] w-14 overflow-hidden rounded-full bg-white/[0.07]">
                      <span className="block h-full rounded-full" style={{ width: `${(s.members.length / largest) * 100}%`, background: s.color.css }} />
                    </span>
                    <span className="tabular w-8 text-right font-mono text-[11px] text-ink-faint">{s.members.length}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <div ref={list} onPointerLeave={() => hover(null)}>
          {core.length > 0 && (
            <section className="mt-6">
              <h3 className="text-[12px] font-medium text-ink-faint">Brightest members</h3>
              <ul className="mt-2 -mx-2">{core.slice(0, MEMBERS_SHOWN).map((i) => row(i, false))}</ul>
              {core.length > MEMBERS_SHOWN && (
                <p className="mt-2 text-[11.5px] text-ink-faint">and {formatCount(core.length - MEMBERS_SHOWN)} more in the list view</p>
              )}
            </section>
          )}
          {loose.length > 0 && (
            <section className="mt-6">
              <h3 className="text-[12px] font-medium text-ink-faint">
                Loosely related <span className="tabular font-normal">· {formatCount(loose.length)}</span>
              </h3>
              <p className="mt-1 text-[11.5px] leading-snug text-ink-faint">
                Placed here, but their nearest stars are spread across several systems.
              </p>
              <ul className="mt-2 -mx-2">{loose.slice(0, LOOSE_SHOWN).map((i) => row(i, true))}</ul>
              {loose.length > LOOSE_SHOWN && (
                <p className="mt-2 text-[11.5px] text-ink-faint">and {formatCount(loose.length - LOOSE_SHOWN)} more in the list view</p>
              )}
            </section>
          )}
        </div>
      </div>
    </>
  )
}

function MixBars({
  title,
  rows,
  total,
  color,
  active,
  onToggle,
}: {
  title: string
  rows: [string, number][]
  total: number
  color: string
  active: readonly string[]
  onToggle: (key: string) => void
}) {
  const top = rows.slice(0, 5)
  const rest = rows.slice(5).reduce((n, [, c]) => n + c, 0)
  return (
    <div className="min-w-0">
      <h3 className="text-[11.5px] text-ink-faint">{title}</h3>
      <ul className="mt-2 space-y-1.5">
        {top.map(([k, n]) => {
          const on = active.includes(k)
          return (
            <li key={k} className="text-[12px]">
              <button
                type="button"
                aria-pressed={on}
                title={on ? `Stop showing only ${k}` : `Show only ${k} stars`}
                onClick={() => onToggle(k)}
                className="group -mx-1.5 block w-[calc(100%+0.75rem)] rounded-md px-1.5 py-0.5 text-left transition-colors hover:bg-white/[0.04]"
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className={cn('truncate', on ? 'text-starlight' : 'text-ink-muted group-hover:text-ink')}>{k}</span>
                  <span className="tabular font-mono text-[10.5px] text-ink-faint">{Math.round((n / total) * 100)}%</span>
                </span>
                <span className="mt-1 block h-[3px] overflow-hidden rounded-full bg-white/[0.06]">
                  <span className="block h-full rounded-full opacity-80" style={{ width: `${(n / total) * 100}%`, background: color }} />
                </span>
              </button>
            </li>
          )
        })}
        {rest > 0 && <li className="text-[11px] text-ink-faint">+{rows.length - 5} more · {Math.round((rest / total) * 100)}%</li>}
      </ul>
    </div>
  )
}
