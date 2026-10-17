import { useEffect, useRef } from 'react'
import { useGalaxyStore } from '#/state/store'
import { onFrame, sceneBus, starScreenPosition } from '#/components/galaxy/sceneBus'

const SIZE = 44

/** A thin starlight reticle pinned to the selected star, so selection reads at any zoom. */
export function SelectionReticle() {
  const selected = useGalaxyStore((s) => s.selected)
  const g = useGalaxyStore((s) => s.galaxy)
  const el = useRef<SVGSVGElement>(null)

  useEffect(() => {
    if (selected === null || !g) return
    sceneBus.invalidate()
    return onFrame(() => {
      const node = el.current
      if (!node) return
      const p = starScreenPosition(g, selected)
      if (!p) {
        node.style.opacity = '0'
        return
      }
      node.style.transform = `translate3d(${p.x - SIZE / 2}px, ${p.y - SIZE / 2}px, 0)`
      node.style.opacity = '1'
    })
  }, [selected, g])

  if (selected === null) return null
  const c = SIZE / 2
  return (
    <svg
      ref={el}
      aria-hidden
      width={SIZE}
      height={SIZE}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      className="pointer-events-none fixed top-0 left-0 z-[5] text-starlight opacity-0 drop-shadow-[0_0_4px_oklch(0.86_0.12_85/0.6)] transition-opacity duration-300"
    >
      <circle cx={c} cy={c} r={c - 8} fill="none" stroke="currentColor" strokeWidth={1} strokeOpacity={0.85} />
      {[0, 90, 180, 270].map((a) => (
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
