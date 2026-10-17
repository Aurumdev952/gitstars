import { useEffect, useRef, useState } from 'react'
import { useGalaxyStore } from '#/state/store'
import { onFrame, sceneBus, starScreenPosition } from '#/components/galaxy/sceneBus'
import { formatCompact, splitFullName } from '#/lib/format'
import { ClusterDot } from './Legend'

const DELAY_MS = 120
const GAP = 14

/** Anchored to the hovered star (not the cursor); its transform is written every frame. */
export function HoverTooltip() {
  // The detail panel already describes the selected star.
  const hovered = useGalaxyStore((s) => (s.hovered === s.selected ? null : s.hovered))
  const g = useGalaxyStore((s) => s.galaxy)
  const [shown, setShown] = useState<number | null>(null)
  const el = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (hovered === null) return setShown(null)
    const t = setTimeout(() => setShown(hovered), DELAY_MS)
    return () => clearTimeout(t)
  }, [hovered])

  useEffect(() => {
    if (shown === null || !g) return
    sceneBus.invalidate()
    return onFrame(() => {
      const node = el.current
      const p = starScreenPosition(g, shown)
      if (!node) return
      if (!p) {
        node.style.opacity = '0'
        return
      }
      const w = node.offsetWidth
      const h = node.offsetHeight
      const flip = p.x + GAP + w > window.innerWidth - 12
      const x = flip ? p.x - GAP - w : p.x + GAP
      const y = Math.min(window.innerHeight - h - 12, Math.max(12, p.y - h / 2))
      node.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`
      node.style.opacity = '1'
    })
  }, [shown, g])

  if (shown === null || !g) return null
  const r = g.repos[shown]!
  const sys = g.systems[g.systemOf[shown]!]!
  const [owner, name] = splitFullName(r.fullName)
  return (
    <div
      ref={el}
      role="tooltip"
      className="glass pointer-events-none fixed top-0 left-0 z-20 w-max max-w-[300px] rounded-xl px-3.5 py-2.5 opacity-0 transition-opacity duration-100"
    >
      <p className="truncate font-mono text-[12.5px]">
        <span className="text-ink-faint">{owner}/</span>
        <span className="text-ink">{name}</span>
      </p>
      <p className="mt-1 line-clamp-2 text-[12.5px] leading-snug text-ink-muted">{r.oneLiner}</p>
      <p className="mt-1.5 flex items-center gap-1.5 text-[11.5px] text-ink-faint">
        <span className="tabular text-ink-muted">★ {formatCompact(r.stars)}</span>
        {r.language && <span>· {r.language}</span>}
        <span>· {r.kind}</span>
      </p>
      <p className="mt-1 flex items-center gap-1.5 text-[11.5px] text-ink-faint">
        <ClusterDot color={sys.color.css} className="size-1.5" />
        {sys.name}
      </p>
    </div>
  )
}
