import { useRef, type CSSProperties } from 'react'
import { useGalaxyStore } from '#/state/store'
import { commands } from '#/state/commands'
import { Kbd } from '#/components/ui/kbd'
import { StarMark } from './TopBar'
import { useOccluder } from './useOccluder'

export function DiscoverButton() {
  const hidden = useGalaxyStore((s) => s.selected !== null || s.focusCluster !== null || s.view === 'list')
  const ref = useRef<HTMLButtonElement>(null)
  useOccluder(ref)
  if (hidden) return null
  return (
    <button
      ref={ref}
      type="button"
      onClick={commands.forgottenStar}
      className="glass group hud-enter fixed right-5 bottom-5 z-10 flex h-10 items-center gap-2.5 rounded-full pr-2.5 pl-4 text-[13px] text-ink-muted hover:text-ink"
      style={{ '--hud-i': 4 } as CSSProperties}
    >
      <StarMark className="size-3.5 text-starlight transition-transform duration-500 group-hover:rotate-45 motion-reduce:transition-none" />
      Forgotten star
      <Kbd>r</Kbd>
    </button>
  )
}
