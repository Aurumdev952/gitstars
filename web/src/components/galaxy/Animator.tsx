import { useEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { useGalaxyStore } from '#/state/store'
import { writeDynTargets } from '#/lib/emphasis'
import { sceneBus } from './sceneBus'

const LAMBDA = 8
const EPS = 1e-3

/** Damps aDyn toward targets derived from the store, uploading only while values still move. */
export function Animator() {
  const moving = useRef(true)

  useEffect(() => {
    const recompute = () => {
      const s = useGalaxyStore.getState()
      if (!s.galaxy || sceneBus.dynTarget.length !== s.galaxy.n * 4) return
      writeDynTargets(s.galaxy, { hovered: s.hovered, selected: s.selected, hoveredCluster: s.hoveredCluster }, sceneBus.dynTarget)
      moving.current = true
      sceneBus.invalidate()
    }
    recompute()
    return useGalaxyStore.subscribe(
      (s) => [s.galaxy, s.hovered, s.selected, s.hoveredCluster] as const,
      recompute,
      { equalityFn: (a, b) => a.every((x, k) => x === b[k]) },
    )
  }, [])

  useFrame((_, dt) => {
    const attr = sceneBus.dynAttr
    if (!moving.current || !attr) return
    const { dyn, dynTarget } = sceneBus
    const k = useGalaxyStore.getState().frozen ? 1 : 1 - Math.exp(-LAMBDA * Math.min(dt, 0.1))
    let maxDelta = 0
    for (let j = 0; j < dyn.length; j++) {
      const d = dynTarget[j]! - dyn[j]!
      if (d === 0) continue
      const a = Math.abs(d)
      if (a < EPS) dyn[j] = dynTarget[j]!
      else dyn[j] = dyn[j]! + d * k
      if (a > maxDelta) maxDelta = a
    }
    attr.clearUpdateRanges()
    attr.addUpdateRange(0, dyn.length)
    attr.needsUpdate = true
    moving.current = maxDelta > 0
    if (moving.current) sceneBus.invalidate()
  })

  return null
}
