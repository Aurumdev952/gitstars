import { useEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { useGalaxyStore } from '#/state/store'
import { MAX_GALAXIES } from '#/shaders/uniforms'
import { bornAt } from '#/lib/layout'
import type { GalaxyIndex } from '#/lib/load'
import { currentLayout } from './sceneBus'
import { sceneBus } from './sceneBus'

const LAMBDA = 6
const FLAT_SECONDS = 1.2

const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)

/**
 * Scene-wide uniform transitions: the concept lens, nebula focus and filter thinning, and the
 * 3D-to-flat layout tween. Each damps or eases toward a target read from the store.
 */
export function SceneTweens() {
  const flat = useRef({ from: 0, to: 0, t: 1 })
  const galaxyVis = useRef(new Float32Array(MAX_GALAXIES).fill(1))
  const hasWeights = useRef(false)
  const bornKey = useRef<{ g: GalaxyIndex | null; t: number }>({ g: null, t: NaN })

  useEffect(() => {
    const store = useGalaxyStore
    const offLens = store.subscribe(
      (s) => s.lens,
      (lens) => {
        const attr = sceneBus.lensAttr
        if (lens.state === 'ready' && attr && attr.array.length === lens.weights.length) {
          ;(attr.array as Float32Array).set(lens.weights)
          attr.needsUpdate = true
        }
        sceneBus.invalidate()
      },
      { fireImmediately: true },
    )
    const offFilter = store.subscribe(
      (s) => [s.galaxy, s.filtered] as const,
      ([g, f]) => {
        galaxyVis.current.fill(1)
        if (g && f) {
          for (const gal of g.galaxies) {
            if (gal.index >= MAX_GALAXIES || gal.members.length === 0) continue
            let shown = 0
            for (const i of gal.members) shown += f.visible[i]!
            galaxyVis.current[gal.index] = 0.15 + 0.85 * (shown / gal.members.length)
          }
        }
        sceneBus.invalidate()
      },
      { fireImmediately: true, equalityFn: (a, b) => a[0] === b[0] && a[1] === b[1] },
    )
    let first = true
    const offView = store.subscribe(
      (s) => s.view,
      (view) => {
        const deepLink = first
        first = false
        if (view === 'list') return
        const to = view === 'flat' ? 1 : 0
        const now = sceneBus.uniforms.uFlat.value
        if (deepLink) sceneBus.uniforms.uFlat.value = to
        flat.current = { from: now, to, t: deepLink || now === to ? 1 : 0 }
        sceneBus.invalidate()
      },
      { fireImmediately: true },
    )
    return () => {
      offLens()
      offFilter()
      offView()
    }
  }, [])

  // Before the default-priority frame hooks, so labels and picking see this frame's layout.
  useFrame((_, dt) => {
    const s = useGalaxyStore.getState()
    const u = sceneBus.uniforms
    const k = s.frozen ? 1 : 1 - Math.exp(-LAMBDA * Math.min(dt, 0.1))
    let moving = false
    const damp = (cur: number, target: number) => {
      const next = Math.abs(target - cur) < 1e-3 ? target : cur + (target - cur) * k
      if (next !== target) moving = true
      return next
    }

    // Between two lens queries the previous heat map holds until the new weights land.
    if (s.lens.state === 'off' || s.lens.state === 'error') hasWeights.current = false
    else if (s.lens.state === 'ready') hasWeights.current = true
    u.uLens.value = damp(u.uLens.value, hasWeights.current ? 1 : 0)

    const g = s.galaxy
    const focus = s.focusCluster && g ? g.clusterById.get(s.focusCluster) : null
    const galaxyIndex = focus ? (focus.level === 0 ? focus.index : g!.clusterById.get(focus.parentId!)!.index) : -1
    if (galaxyIndex >= 0) u.uFocusCluster.value = galaxyIndex
    u.uFocusAmt.value = damp(u.uFocusAmt.value, galaxyIndex >= 0 ? 1 : 0)

    const vis = u.uGalaxyVis.value
    for (let i = 0; i < vis.length; i++) vis[i] = damp(vis[i]!, galaxyVis.current[i]!)

    // Births per cluster, recomputed only when the timeline cursor moves.
    const key = u.uTimelineOn.value > 0.5 ? u.uTimeline.value : -1
    if (g && (bornKey.current.g !== g || bornKey.current.t !== key)) {
      bornKey.current = { g, t: key }
      writeBornShares(g, key >= 0, u.uGalaxyBorn.value)
    }

    const f = flat.current
    if (f.t < 1) {
      const instant = s.frozen || s.settings.motion === 'reduced'
      f.t = instant ? 1 : Math.min(1, f.t + dt / FLAT_SECONDS)
      u.uFlat.value = f.from + (f.to - f.from) * easeInOutCubic(f.t)
      moving = true
    }
    if (moving) sceneBus.invalidate()
  }, -0.75)

  return null
}

const sums = { g: new Float32Array(0), s: new Float32Array(0) }

function writeBornShares(g: GalaxyIndex, on: boolean, galaxy: Float32Array) {
  const sys = sceneBus.systemBorn.length === g.systems.length ? sceneBus.systemBorn : new Float32Array(g.systems.length)
  galaxy.fill(1)
  sys.fill(1)
  if (on) {
    const layout = currentLayout()
    if (sums.g.length !== g.galaxies.length) sums.g = new Float32Array(g.galaxies.length)
    if (sums.s.length !== g.systems.length) sums.s = new Float32Array(g.systems.length)
    const gSum = sums.g.fill(0)
    const sSum = sums.s.fill(0)
    for (let i = 0; i < g.n; i++) {
      const b = bornAt(g.attrs, i, layout)
      gSum[g.galaxyOf[i]!]! += b
      sSum[g.systemOf[i]!]! += b
    }
    for (const c of g.galaxies) if (c.index < galaxy.length) galaxy[c.index] = gSum[c.index]! / Math.max(1, c.members.length)
    for (const c of g.systems) sys[c.index] = sSum[c.index]! / Math.max(1, c.members.length)
  }
  sceneBus.systemBorn = sys
}
