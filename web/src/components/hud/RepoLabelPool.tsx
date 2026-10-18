import { useEffect, useRef } from 'react'
import { useGalaxyStore } from '#/state/store'
import { sceneBus } from '#/components/galaxy/sceneBus'

export const REPO_LABEL_POOL = 40

/**
 * A fixed pool of DOM repo labels. The canvas label pass (galaxy/labels/Labels.tsx) assigns stars
 * to slots, writes their text and transforms, and fades them; React only mounts the elements.
 */
export function RepoLabelPool() {
  const root = useRef<HTMLDivElement>(null)
  const enabled = useGalaxyStore((s) => s.settings.labels !== 'none')

  useEffect(() => {
    const el = root.current
    if (!el || !enabled) return
    sceneBus.repoLabelSlots = Array.from(el.children) as HTMLElement[]
    sceneBus.invalidate()
    return () => {
      sceneBus.repoLabelSlots = []
    }
  }, [enabled])

  if (!enabled) return null
  return (
    <div ref={root} aria-hidden className="pointer-events-none fixed inset-0 z-[4] overflow-hidden">
      {Array.from({ length: REPO_LABEL_POOL }, (_, k) => (
        <div
          key={k}
          className="absolute top-0 left-0 font-mono text-[11px] leading-[16px] whitespace-nowrap opacity-0 [text-shadow:0_0_6px_rgb(3_3_10),0_0_2px_rgb(3_3_10)] will-change-transform"
        >
          <span className="text-ink-faint" />
          <span className="text-ink/90" />
        </div>
      ))}
    </div>
  )
}
