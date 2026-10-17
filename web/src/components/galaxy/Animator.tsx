import { useEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { useGalaxyStore } from '#/state/store'
import { writeDynTargets } from '#/lib/emphasis'
import { sceneBus } from './sceneBus'

const LAMBDA = 8
const EPS = 1e-3

/**
 * Damps aDyn toward targets derived from the store, uploading only while values still move.
 * Targets are rebuilt in the frame loop, so a store change that lands before Stars publishes new
 * buffers (a dataset swap) is applied once they exist.
 */
export function Animator() {
  const dirty = useRef(true)
  const moving = useRef(true)
  const version = useRef(-1)

  useEffect(
    () =>
      useGalaxyStore.subscribe(
        (s) => [s.galaxy, s.hovered, s.selected, s.hoveredCluster] as const,
        () => {
          dirty.current = true
          sceneBus.invalidate()
        },
        { equalityFn: (a, b) => a.every((x, k) => x === b[k]) },
      ),
    [],
  )

  useFrame((_, dt) => {
    const attr = sceneBus.dynAttr
    const s = useGalaxyStore.getState()
    if (!attr || !s.galaxy || sceneBus.dynTarget.length !== s.galaxy.n * 4) return
    if (dirty.current || version.current !== sceneBus.dynVersion) {
      writeDynTargets(s.galaxy, { hovered: s.hovered, selected: s.selected, hoveredCluster: s.hoveredCluster }, sceneBus.dynTarget)
      dirty.current = false
      version.current = sceneBus.dynVersion
      moving.current = true
    }
    if (!moving.current) return
    const { dyn, dynTarget } = sceneBus
    const k = s.frozen ? 1 : 1 - Math.exp(-LAMBDA * Math.min(dt, 0.1))
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
