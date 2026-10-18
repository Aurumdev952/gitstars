import { useRef } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { X } from 'lucide-react'
import { useGalaxyStore } from '#/state/store'
import { commands } from '#/state/commands'
import { lensRampCss } from '#/lib/lens'
import { useOccluder } from './useOccluder'

/** The concept-lens key: what the heat means, and its state while the model warms. */
export function LensLegend() {
  const lens = useGalaxyStore((s) => s.lens)
  const model = useGalaxyStore((s) => s.model)
  const hidden = useGalaxyStore((s) => s.view === 'list')
  const ref = useRef<HTMLDivElement>(null)
  useOccluder(ref)
  const status =
    lens.state === 'pending'
      ? model.state === 'loading'
        ? `Waiting for the model… ${Math.round(model.progress * 100)}%`
        : 'Measuring every star…'
      : lens.state === 'error'
        ? `Lens unavailable: ${lens.message}`
        : null
  return (
    <AnimatePresence>
      {lens.state !== 'off' && !hidden && (
        <motion.div
          ref={ref}
          key="lens"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 12 }}
          className="glass fixed bottom-[calc(1.25rem+var(--timeline-h,0px))] left-1/2 z-10 w-[min(380px,calc(100vw-2rem))] -translate-x-1/2 rounded-[var(--radius-panel)] px-4 pt-3 pb-3.5"
        >
          <div className="flex items-center gap-2 text-[12.5px]">
            <span className="text-ink-faint">Lens</span>
            <span className="min-w-0 flex-1 truncate font-medium text-ink">{lens.query}</span>
            <button type="button" aria-label="Turn off the lens" onClick={commands.clearLens} className="-mr-1.5 rounded-md p-1 text-ink-faint hover:bg-white/5 hover:text-ink">
              <X className="size-3.5" />
            </button>
          </div>
          <div aria-hidden className="mt-2.5 h-1.5 rounded-full" style={{ background: lensRampCss(), opacity: lens.state === 'ready' ? 1 : 0.35 }} />
          <div className="mt-1.5 flex justify-between text-[11px] text-ink-faint">
            <span>unrelated</span>
            {status ? <span className="animate-pulse text-ink-muted">{status}</span> : <span>closest in meaning</span>}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
