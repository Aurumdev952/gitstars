import { useEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { useGalaxyStore, type GalaxyStore } from '#/state/store'
import { writeDynTargets, type Emphasis } from '#/lib/emphasis'
import { sceneBus } from './sceneBus'

const LAMBDA = 8
const EPS = 1e-3
/** Filter transitions start per star after up to this long, so stars ripple out instead of popping. */
const STAGGER_S = 0.18
const PULSED_HITS = 12

export function emphasisOf(s: GalaxyStore): Emphasis {
  return {
    hovered: s.hovered,
    selected: s.selected,
    hoveredCluster: s.hoveredCluster,
    focusCluster: s.focusCluster,
    visible: s.filtered && s.filtered.count < s.filtered.visible.length ? s.filtered.visible : null,
    ghosts: s.settings.ghosts,
    hits: s.hits && s.hits.idx.length > 0 ? s.hits.idx.slice(0, PULSED_HITS) : null,
  }
}

/**
 * Damps aDyn toward targets derived from the store, uploading only while values still move.
 * Targets are rebuilt in the frame loop, so a store change that lands before Stars publishes new
 * buffers (a dataset swap) is applied once they exist.
 */
export function Animator() {
  const dirty = useRef(true)
  const moving = useRef(true)
  const version = useRef(-1)
  const visChangedAt = useRef(-Infinity)
  const clock = useRef(0)

  useEffect(
    () =>
      useGalaxyStore.subscribe(
        (s) => [s.galaxy, s.hovered, s.selected, s.hoveredCluster, s.focusCluster, s.filtered, s.settings.ghosts, s.hits] as const,
        (next, prev) => {
          dirty.current = true
          if (next[5] !== prev[5] || next[6] !== prev[6]) visChangedAt.current = clock.current
          sceneBus.invalidate()
        },
        { equalityFn: (a, b) => a.every((x, k) => x === b[k]) },
      ),
    [],
  )

  useFrame((_, dt) => {
    clock.current += dt
    const attr = sceneBus.dynAttr
    const s = useGalaxyStore.getState()
    const g = s.galaxy
    if (!attr || !g || sceneBus.dynTarget.length !== g.n * 4) return
    if (dirty.current || version.current !== sceneBus.dynVersion) {
      writeDynTargets(g, emphasisOf(s), sceneBus.dynTarget)
      dirty.current = false
      version.current = sceneBus.dynVersion
      moving.current = true
    }
    if (!moving.current) return
    const { dyn, dynTarget } = sceneBus
    const k = s.frozen ? 1 : 1 - Math.exp(-LAMBDA * Math.min(dt, 0.1))
    const stagger = !s.frozen && s.settings.motion === 'full'
    const sinceVis = clock.current - visChangedAt.current
    const seed = g.attrs.seed
    let maxDelta = 0
    for (let j = 0; j < dyn.length; j++) {
      const d = dynTarget[j]! - dyn[j]!
      if (d === 0) continue
      const a = Math.abs(d)
      if (a > maxDelta) maxDelta = a
      if (stagger && j % 4 === 0 && sinceVis < seed[j >> 2]! * STAGGER_S) continue
      if (a < EPS) dyn[j] = dynTarget[j]!
      else dyn[j] = dyn[j]! + d * k
    }
    attr.clearUpdateRanges()
    attr.addUpdateRange(0, dyn.length)
    attr.needsUpdate = true
    moving.current = maxDelta > 0
    if (moving.current) sceneBus.invalidate()
  })

  return null
}
