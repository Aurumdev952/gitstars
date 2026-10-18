import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import type { GalaxyIndex } from '#/lib/load'
import { systemMst } from '#/lib/mst'
import { useGalaxyStore } from '#/state/store'
import { RibbonBuffer, blankSegment, ribbonMaterial } from './ribbons'
import { sceneBus } from './sceneBus'

const BASE_ALPHA = 0.5
const GHOST_ALPHA = 0.05
const GAIN = 0.8
/** Everything outside the hovered system and focused galaxy draws at this share. */
const REST = 0.18

type Constellation = { buffer: RibbonBuffer; ends: Uint32Array; alpha: Float32Array; count: number }

/** Every system's MST as one ribbon buffer, in layout coordinates so it follows flat and intro. */
function buildConstellations(g: GalaxyIndex): Constellation {
  const pairs: [number, number][] = []
  for (const sys of g.systems) for (const e of systemMst(sys.members, (i) => g.repos[i]!.neighbors, g.attrs.pos)) pairs.push(e)
  const buffer = new RibbonBuffer(pairs.length)
  const ends = new Uint32Array(pairs.length * 2)
  const alpha = new Float32Array(pairs.length)
  const seg = blankSegment()
  const at = (arr: Float32Array, i: number, w: number) => arr.subarray(i * w, i * w + w)
  pairs.forEach(([a, b], k) => {
    ends[k * 2] = a
    ends[k * 2 + 1] = b
    const sys = g.systems[g.systemOf[a]!]!
    seg.a = at(g.attrs.pos, a, 3)
    seg.a2 = at(g.attrs.pos2, a, 3)
    seg.b = at(g.attrs.pos, b, 3)
    seg.b2 = at(g.attrs.pos2, b, 3)
    seg.delayA = g.attrs.delay[a]!
    seg.delayB = g.attrs.delay[b]!
    seg.starredA = g.attrs.starred[a]!
    seg.starredB = g.attrs.starred[b]!
    seg.t0 = 0
    seg.t1 = 1
    const c = sys.color.star
    seg.colorA = seg.colorB = [c[0] * GAIN, c[1] * GAIN, c[2] * GAIN]
    seg.widthPx = 1.1
    seg.drawDelay = 0
    seg.galaxy = g.galaxyOf[a]!
    seg.fadeRadius = Math.max(8, sys.radius)
    seg.phase = g.attrs.seed[a]!
    seg.system = g.systemOf[a]!
    // Bridges between far components of a system are drawn fainter than its tight strokes.
    const len = Math.hypot(...[0, 1, 2].map((q) => g.attrs.pos[a * 3 + q]! - g.attrs.pos[b * 3 + q]!))
    seg.alpha = BASE_ALPHA * Math.min(1, (0.45 * sys.radius) / Math.max(1e-3, len))
    alpha[k] = seg.alpha
    buffer.write(k, seg)
  })
  buffer.commit(pairs.length)
  return { buffer, ends, alpha, count: pairs.length }
}

/** System constellations: straight MST strokes that resolve as the camera nears each system. */
export function Constellations({ galaxy }: { galaxy: GalaxyIndex }) {
  const c = useMemo(() => buildConstellations(galaxy), [galaxy])
  const { material, uniforms } = useMemo(() => ribbonMaterial({ drawSeconds: 0.9, pulseSpeed: 0.12, pulseGain: 1.4, rest: REST }), [])
  const clock = useRef(1e6)

  useEffect(() => {
    const store = useGalaxyStore
    const offFilter = store.subscribe(
      (s) => s.filtered,
      (f) => {
        const ghost = store.getState().settings.ghosts ? GHOST_ALPHA : 0
        for (let k = 0; k < c.count; k++) {
          const shown = !f || (f.visible[c.ends[k * 2]!]! && f.visible[c.ends[k * 2 + 1]!]!)
          c.buffer.setAlpha(k, shown ? c.alpha[k]! : ghost * (c.alpha[k]! / BASE_ALPHA))
        }
        c.buffer.commit(c.count, ['aStyle'])
        sceneBus.invalidate()
      },
      { fireImmediately: true },
    )
    // Focusing a cluster redraws the constellations from their first star outward.
    const offFocus = store.subscribe(
      (s) => s.focusCluster,
      (id) => {
        if (id) clock.current = 0
      },
    )
    return () => {
      offFilter()
      offFocus()
      c.buffer.dispose()
    }
  }, [c])
  useEffect(() => () => material.dispose(), [material])

  useFrame((_, dt) => {
    const s = useGalaxyStore.getState()
    const still = s.frozen || s.settings.motion === 'reduced'
    if (clock.current < 1e5) clock.current += dt
    uniforms.uDrawClock.value = still ? 1e6 : clock.current
    uniforms.uFlow.value = still ? 0 : 1
    const anchor = s.hovered ?? s.selected
    uniforms.uHotSystem.value = anchor === null ? -1 : galaxy.systemOf[anchor]!
    if (clock.current < 2) sceneBus.invalidate()
  })

  return <mesh geometry={c.buffer.geometry} material={material} frustumCulled={false} raycast={() => null} renderOrder={6} />
}
