import { useEffect, type RefObject } from 'react'
import { sceneBus } from '#/components/galaxy/sceneBus'

/** Registers a HUD element whose screen area 3D labels should keep clear of. */
export function useOccluder(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const read = () => ref.current?.getBoundingClientRect() ?? null
    sceneBus.occluders.add(read)
    sceneBus.invalidate()
    return () => {
      sceneBus.occluders.delete(read)
      sceneBus.invalidate()
    }
  }, [ref])
}
