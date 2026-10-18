import { AnimatePresence, motion } from 'motion/react'
import { FilterX } from 'lucide-react'
import { useGalaxyStore } from '#/state/store'
import { commands } from '#/state/commands'
import { activeFacets } from '#/lib/filters'

/** The scene's empty state: every star is filtered out, so say so and offer the way back. */
export function NoMatches({ inline = false }: { inline?: boolean }) {
  const empty = useGalaxyStore((s) => s.filtered !== null && s.filtered.count === 0)
  const facets = useGalaxyStore((s) => activeFacets(s.filters).length)
  const body = (
    <>
      <span aria-hidden className="grid size-9 place-items-center rounded-full bg-white/[0.05] text-ink-muted">
        <FilterX className="size-4" />
      </span>
      <div className="min-w-0">
        <p className="text-[13.5px] font-medium text-ink">No stars match these filters</p>
        <p className="mt-0.5 text-[12.5px] text-ink-muted">
          {facets > 1 ? `${facets} filters are narrowing it down together.` : 'Try a wider range.'}
        </p>
      </div>
      <div className="ml-auto flex shrink-0 gap-1.5">
        <button type="button" onClick={commands.openFilters} className="rounded-full px-3 py-1.5 text-[12.5px] text-ink-muted hover:bg-white/[0.06] hover:text-ink">
          Adjust
        </button>
        <button type="button" onClick={commands.clearFilters} className="rounded-full bg-starlight px-3 py-1.5 text-[12.5px] font-medium text-[oklch(0.2_0.03_85)] hover:brightness-110">
          Clear filters
        </button>
      </div>
    </>
  )
  if (inline) return empty ? <div className="mx-auto my-10 flex w-[min(460px,100%)] items-center gap-3 px-5">{body}</div> : null
  return (
    <AnimatePresence>
      {empty && (
        <motion.div
          role="status"
          initial={{ opacity: 0, y: 8, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 4 }}
          className="glass-strong fixed top-1/2 left-1/2 z-10 flex w-[min(460px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 items-center gap-3 rounded-[var(--radius-panel)] p-4"
        >
          {body}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
