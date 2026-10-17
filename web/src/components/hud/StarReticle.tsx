import { useEffect, useRef } from 'react'
import { useGalaxyStore, type GalaxyStore } from '#/state/store'
import { onFrame, sceneBus, starScreenPosition } from '#/components/galaxy/sceneBus'
import { cn } from '#/lib/utils'

const VARIANTS = {
  // Ticks mark the selection; hover is a quieter ring, so the two never read alike.
  selected: { size: 44, ring: 14, ticks: true, className: 'text-starlight drop-shadow-[0_0_4px_oklch(0.86_0.12_85/0.6)]' },
  hovered: { size: 28, ring: 9, ticks: false, className: 'text-ink/60' },
} as const

const pickTarget = {
  selected: (s: GalaxyStore) => s.selected,
  hovered: (s: GalaxyStore) => (s.hovered === s.selected ? null : s.hovered),
}

/** A DOM ring pinned to a star, so hover and selection read at any zoom level. */
export function StarReticle({ variant }: { variant: keyof typeof VARIANTS }) {
  const target = useGalaxyStore(pickTarget[variant])
  const g = useGalaxyStore((s) => s.galaxy)
  const el = useRef<SVGSVGElement>(null)
  const v = VARIANTS[variant]

  useEffect(() => {
    if (target === null || !g) return
    sceneBus.invalidate()
    return onFrame(() => {
      const node = el.current
      if (!node) return
      const p = starScreenPosition(g, target)
      if (!p) {
        node.style.opacity = '0'
        return
      }
      node.style.transform = `translate3d(${p.x - v.size / 2}px, ${p.y - v.size / 2}px, 0)`
      node.style.opacity = '1'
    })
  }, [target, g, v.size])

  if (target === null) return null
  const c = v.size / 2
  return (
    <svg
      ref={el}
      aria-hidden
      width={v.size}
      height={v.size}
      viewBox={`0 0 ${v.size} ${v.size}`}
      className={cn('pointer-events-none fixed top-0 left-0 z-[5] opacity-0 transition-opacity duration-200', v.className)}
    >
      <circle cx={c} cy={c} r={v.ring} fill="none" stroke="currentColor" strokeWidth={1} strokeOpacity={0.85} />
      {v.ticks &&
        [0, 90, 180, 270].map((a) => (
          <line
            key={a}
            x1={c}
            y1={1}
            x2={c}
            y2={6}
            stroke="currentColor"
            strokeWidth={1.25}
            strokeLinecap="round"
            transform={`rotate(${a} ${c} ${c})`}
          />
        ))}
    </svg>
  )
}
