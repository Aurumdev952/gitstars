import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { MousePointer2, Move3d, ZoomIn } from 'lucide-react'
import { useGalaxyStore } from '#/state/store'
import { Kbd } from '#/components/ui/kbd'
import { useOccluder } from './useOccluder'

const KEY = 'gitstars:first-run-hint'

function seen(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

function remember() {
  try {
    localStorage.setItem(KEY, '1')
  } catch {
    // Private windows and blocked storage just show the hint again next visit.
  }
}

/**
 * How to move around, shown once on a first visit after the intro, and gone at the first input.
 * Inputs before it is on screen (the one that skips the intro) do not count.
 */
export function FirstRunHint() {
  const [dismissed, setDismissed] = useState(seen)
  const shown = useGalaxyStore(
    (s) =>
      !dismissed &&
      s.intro === 'done' &&
      s.view !== 'list' &&
      s.overlay === 'none' &&
      s.selected === null &&
      s.focusCluster === null &&
      !s.timeline.open,
  )
  const ref = useRef<HTMLDivElement>(null)
  useOccluder(ref)

  useEffect(() => {
    if (!shown) return
    const dismiss = () => {
      remember()
      setDismissed(true)
    }
    const opts = { capture: true, passive: true } as const
    window.addEventListener('pointerdown', dismiss, opts)
    window.addEventListener('wheel', dismiss, opts)
    window.addEventListener('keydown', dismiss, opts)
    return () => {
      window.removeEventListener('pointerdown', dismiss, opts)
      window.removeEventListener('wheel', dismiss, opts)
      window.removeEventListener('keydown', dismiss, opts)
    }
  }, [shown])

  return (
    <AnimatePresence>
      {shown && (
        <motion.div
          ref={ref}
          role="note"
          aria-label="How to explore"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0, transition: { delay: 0.5, duration: 0.6, ease: [0.2, 0.7, 0.2, 1] } }}
          exit={{ opacity: 0, y: 6, transition: { duration: 0.25 } }}
          style={{ '--hud-i': 5 } as CSSProperties}
          className="glass pointer-events-none fixed bottom-5 left-1/2 z-10 flex h-10 -translate-x-1/2 items-center gap-4 rounded-full px-4 text-[12.5px] whitespace-nowrap text-ink-muted max-[1180px]:gap-3 max-[1180px]:text-[12px]"
        >
          <Step icon={<Move3d className="size-3.5" />}>Drag to orbit</Step>
          <Dot />
          <Step icon={<ZoomIn className="size-3.5" />}>Scroll to zoom</Step>
          <Dot />
          <Step icon={<MousePointer2 className="size-3.5" />}>Click a star</Step>
          <Dot />
          <span className="flex items-center gap-1.5">
            <Kbd>⌘</Kbd>
            <Kbd>K</Kbd>
            <span>search</span>
          </span>
          <span className="flex items-center gap-1.5 max-[1180px]:hidden">
            <Kbd>?</Kbd>
            <span>keys</span>
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function Step({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1.5">
      <span aria-hidden className="text-starlight/90">
        {icon}
      </span>
      {children}
    </span>
  )
}

const Dot = () => <span aria-hidden className="size-[3px] rounded-full bg-ink-faint/60" />
