import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import type { GalaxyIndex } from '#/lib/load'
import { positionAt } from '#/lib/layout'
import { useGalaxyStore } from '#/state/store'
import { currentLayout, sceneBus } from './sceneBus'
import { RibbonBuffer, blankSegment, ribbonMaterial } from './ribbons'

const SEGMENTS = 20
const MAX_ARCS = 16
const STAGGER_S = 0.04
// HDR gains: the travelling pulse crosses the bloom threshold while the base arc stays under it.
const ARC_GAIN = 1.3
const BOW = 0.2

type V3 = [number, number, number]

/** Point `t` of the quadratic arc a → b bowed toward the viewer by |b − a| · 0.25. */
export function arcPoint(a: V3, ctrl: V3, b: V3, t: number, out: V3): V3 {
  const u = 1 - t
  for (let c = 0; c < 3; c++) out[c] = u * u * a[c]! + 2 * u * t * ctrl[c]! + t * t * b[c]!
  return out
}

/**
 * Control point: mid + side · normalize(viewDir × (b − a)) · |b − a| · BOW, so arcs always bow
 * visibly. With one side for every arc (the spec's formula) eight arcs all curl clockwise and read
 * as a whirlpool around the star, so callers alternate `side` by rank and the arcs fan out instead.
 */
export function arcControl(a: V3, b: V3, viewDir: V3, out: V3, side: 1 | -1 = 1): V3 {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
  const len = Math.hypot(ab[0]!, ab[1]!, ab[2]!)
  let sx = viewDir[1] * ab[2]! - viewDir[2] * ab[1]!
  let sy = viewDir[2] * ab[0]! - viewDir[0] * ab[2]!
  let sz = viewDir[0] * ab[1]! - viewDir[1] * ab[0]!
  const sl = Math.hypot(sx, sy, sz)
  if (sl < 1e-6) [sx, sy, sz] = [0, 1, 0]
  else [sx, sy, sz] = [sx / sl, sy / sl, sz / sl]
  out[0] = (a[0] + b[0]) / 2 + side * sx * len * BOW
  out[1] = (a[1] + b[1]) / 2 + side * sy * len * BOW
  out[2] = (a[2] + b[2]) / 2 + side * sz * len * BOW
  return out
}

const seg = blankSegment()
const pa: V3 = [0, 0, 0]
const pb: V3 = [0, 0, 0]
const ctrl: V3 = [0, 0, 0]
const p0: V3 = [0, 0, 0]
const p1: V3 = [0, 0, 0]
const view: V3 = [0, 0, 0]
const cA: V3 = [0, 0, 0]
const cB: V3 = [0, 0, 0]

/** Writes the anchor's kNN arcs, in the layout at `flat`, as ribbon segments; returns the count. */
function writeArcs(buf: RibbonBuffer, g: GalaxyIndex, i: number, flat: number): number {
  const layout = { ...currentLayout(), flat }
  positionAt(g.attrs, i, layout, pa)
  const cam = sceneBus.camera
  if (cam) {
    const dx = pa[0] - cam.position.x, dy = pa[1] - cam.position.y, dz = pa[2] - cam.position.z
    const l = Math.hypot(dx, dy, dz) || 1
    view[0] = dx / l
    view[1] = dy / l
    view[2] = dz / l
  } else [view[0], view[1], view[2]] = [0, 0, -1]
  const col = g.attrs.color
  let k = 0
  g.repos[i]!.neighbors.slice(0, MAX_ARCS).forEach(([j, cos], rank) => {
    positionAt(g.attrs, j, layout, pb)
    arcControl(pa, pb, view, ctrl, rank % 2 === 0 ? 1 : -1)
    const weight = Math.max(0, (cos - 0.35) / 0.65)
    seg.widthPx = 1.3 + 2.4 * weight
    seg.alpha = 0.3 + 0.6 * weight
    seg.drawDelay = rank * STAGGER_S
    seg.galaxy = -1
    seg.fadeRadius = 0
    seg.phase = rank * 0.137
    seg.delayA = seg.delayB = 0
    seg.starredA = g.attrs.starred[i]!
    seg.starredB = g.attrs.starred[j]!
    for (let s = 0; s < SEGMENTS; s++) {
      const t0 = s / SEGMENTS
      const t1 = (s + 1) / SEGMENTS
      arcPoint(pa, ctrl, pb, t0, p0)
      arcPoint(pa, ctrl, pb, t1, p1)
      seg.a = seg.a2 = p0
      seg.b = seg.b2 = p1
      seg.t0 = t0
      seg.t1 = t1
      // Whiter near the source so the arcs read as leaving the anchor, but faded right at it so the
      // eight starts do not pile into a blob over the star.
      for (let c = 0; c < 3; c++) {
        const tint = (t: number) => {
          const w = 0.35 * (1 - t)
          const lift = Math.min(1, t / 0.14)
          return ((col[i * 3 + c]! * (1 - t) + col[j * 3 + c]! * t) * (1 - w) + w) * ARC_GAIN * lift
        }
        cA[c] = tint(t0)
        cB[c] = tint(t1)
      }
      seg.colorA = cA
      seg.colorB = cB
      buf.write(k++, seg)
    }
  })
  return k
}

/** kNN arcs from the hovered (else selected) star to its neighbours: one instanced ribbon draw. */
export function NeighborArcs({ galaxy }: { galaxy: GalaxyIndex }) {
  const buffer = useMemo(() => new RibbonBuffer(MAX_ARCS * SEGMENTS, true), [])
  const { material, uniforms } = useMemo(() => ribbonMaterial({ drawSeconds: 0.32, pulseSpeed: 0.55, pulseGain: 2.2 }), [])
  const state = useRef({ anchor: null as number | null, flat: -1, clock: 0 })

  useEffect(
    () =>
      useGalaxyStore.subscribe(
        (s) => (s.view === 'list' ? null : (s.hovered ?? s.selected)),
        (a) => {
          state.current.anchor = a
          state.current.flat = -1
          state.current.clock = 0
          sceneBus.invalidate()
        },
        { fireImmediately: true },
      ),
    [],
  )
  useEffect(
    () => () => {
      buffer.dispose()
      material.dispose()
    },
    [buffer, material],
  )

  useFrame((_, dt) => {
    const st = state.current
    const s = useGalaxyStore.getState()
    const still = s.frozen || s.settings.motion === 'reduced'
    const u = sceneBus.uniforms.uFlat.value
    if (st.anchor === null || st.anchor >= galaxy.n) {
      if (buffer.geometry.instanceCount !== 0) buffer.commit(0, [])
      return
    }
    // Rebuild while the flat tween runs, in steps, so arcs stay attached to their stars.
    if (st.flat < 0 || Math.abs(u - st.flat) > 0.02 || (u !== st.flat && (u === 0 || u === 1))) {
      st.flat = u
      buffer.commit(writeArcs(buffer, galaxy, st.anchor, u))
    }
    st.clock += dt
    uniforms.uDrawClock.value = still ? 1e6 : st.clock
    uniforms.uFlow.value = still ? 0 : 1
    if (!still) sceneBus.invalidate()
  })

  return <mesh geometry={buffer.geometry} material={material} frustumCulled={false} raycast={() => null} renderOrder={8} />
}
