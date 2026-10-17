import { useGalaxyStore } from '#/state/store'
import { cn } from '#/lib/utils'

export function ClusterDot({ color, className }: { color: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('inline-block size-2 shrink-0 rounded-full', className)}
      style={{ background: color, boxShadow: `0 0 8px 1px color-mix(in oklch, ${color} 55%, transparent)` }}
    />
  )
}

/** Galaxy key: hovering a row lights its stars, clicking frames it (`?cluster=`). */
export function Legend() {
  const g = useGalaxyStore((s) => s.galaxy)
  const focusCluster = useGalaxyStore((s) => s.focusCluster)
  const { hoverCluster, focus } = useGalaxyStore((s) => s.actions)
  if (!g) return null
  const focusedGalaxy = focusCluster?.slice(0, 3) ?? null
  return (
    <nav
      aria-label="Galaxies"
      className="glass fixed bottom-5 left-5 z-10 w-[248px] rounded-[var(--radius-panel)] px-2 py-2.5"
      onPointerLeave={() => hoverCluster(null)}
    >
      <h2 className="px-2.5 pb-1.5 text-[11.5px] font-medium text-ink-faint">Galaxies</h2>
      <ul className="scrollbar-thin max-h-[42vh] overflow-y-auto">
        {g.galaxies.map((c) => {
          const active = focusedGalaxy === c.id
          return (
            <li key={c.id}>
              <button
                type="button"
                aria-current={active ? 'true' : undefined}
                onPointerEnter={() => hoverCluster(c.id)}
                onFocus={() => hoverCluster(c.id)}
                onBlur={() => hoverCluster(null)}
                onClick={() => focus(active ? null : c.id)}
                className={cn(
                  'group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-[5px] text-left text-[13px] transition-colors',
                  'text-ink-muted hover:bg-white/[0.045] hover:text-ink',
                  active && 'bg-white/[0.06] text-ink',
                )}
              >
                <ClusterDot color={c.color.css} />
                <span className="min-w-0 flex-1 truncate">{c.name}</span>
                <span className="tabular font-mono text-[11px] text-ink-faint group-hover:text-ink-muted">
                  {c.members.length}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
