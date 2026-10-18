import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { AdditiveBlending, BufferGeometry, Color, DoubleSide, LinearSRGBColorSpace, Mesh, ShaderMaterial, Vector3 } from 'three'
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js'
import type { ClusterNode, GalaxyIndex } from '#/lib/load'
import { convexHull2d, coreMembers, inflate, type Point2 } from '#/lib/hull'
import { useGalaxyStore } from '#/state/store'
import { shaders } from '#/shaders'
import { RibbonBuffer, blankSegment, ribbonMaterial } from './ribbons'
import { sceneBus } from './sceneBus'

const REVEAL_S = 0.9
const MAX_OUTLINE = 256
const PAD = { scale: 1.06, world: 2.5 }

function hullGeometry(g: GalaxyIndex, c: ClusterNode): { geo: BufferGeometry; range: [number, number] } | null {
  const pts = c.members.map((i) => [g.attrs.pos[i * 3]!, g.attrs.pos[i * 3 + 1]!, g.attrs.pos[i * 3 + 2]!])
  const core = inflate(coreMembers(pts).map((k) => pts[k]!), PAD.scale, PAD.world)
  if (core.length < 4) return null
  try {
    // Faceted on purpose: smoothed normals on a hull of a few dozen large faces turn edge-on across
    // most of the surface, so the fresnel lit the whole volume instead of its silhouette.
    const geo = new ConvexGeometry(core.map(([x, y, z]) => new Vector3(x, y, z)))
    geo.computeBoundingBox()
    const box = geo.boundingBox!
    return { geo, range: [box.min.y, box.max.y] }
  } catch {
    // Coplanar or degenerate members have no 3D hull; the flat outline still draws.
    return null
  }
}

const seg = blankSegment()

/** The cluster outline for the flat map: a padded 2D hull of the members' pos2, as ribbon segments. */
function writeOutline(buf: RibbonBuffer, g: GalaxyIndex, c: ClusterNode): number {
  const pts: Point2[] = c.members.map((i) => [g.attrs.pos2[i * 3]!, g.attrs.pos2[i * 3 + 1]!])
  const ring = convexHull2d(inflate(coreMembers(pts).map((k) => pts[k]!), PAD.scale, PAD.world)).slice(0, MAX_OUTLINE)
  if (ring.length < 3) return 0
  const lin = c.color.linear
  const col = [lin[0] * 1.1, lin[1] * 1.1, lin[2] * 1.1]
  let perimeter = 0
  ring.forEach((p, k) => (perimeter += Math.hypot(ring[(k + 1) % ring.length]![0] - p[0], ring[(k + 1) % ring.length]![1] - p[1])))
  let along = 0
  ring.forEach((p, k) => {
    const q = ring[(k + 1) % ring.length]!
    const len = Math.hypot(q[0] - p[0], q[1] - p[1])
    seg.a = seg.a2 = [p[0], p[1], 0]
    seg.b = seg.b2 = [q[0], q[1], 0]
    seg.t0 = along / perimeter
    along += len
    seg.t1 = along / perimeter
    seg.colorA = seg.colorB = col
    seg.widthPx = 1.6
    seg.alpha = 0.7
    seg.galaxy = -1
    buf.write(k, seg)
  })
  return ring.length
}

/** A fresnel hull around the focused cluster in 3D, and its outline on the flat map. */
export function ClusterHull({ galaxy }: { galaxy: GalaxyIndex }) {
  const material = useMemo(
    () =>
      new ShaderMaterial({
        ...shaders.hull,
        uniforms: { uColor: { value: new Color() }, uReveal: { value: 0 }, uOpacity: { value: 0 }, uHeightRange: { value: [0, 1] } },
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: DoubleSide,
        toneMapped: false,
      }),
    [],
  )
  const outline = useMemo(() => new RibbonBuffer(MAX_OUTLINE, true), [])
  const outlineMat = useMemo(() => ribbonMaterial({ drawSeconds: REVEAL_S, pulseSpeed: 0.18, pulseGain: 1.8 }), [])
  const mesh = useRef<Mesh>(null)
  const state = useRef({ id: null as string | null, reveal: 0, clock: 0 })

  useEffect(() => {
    const apply = (id: string | null) => {
      const st = state.current
      if (id === st.id) return
      st.id = id
      const node = id ? galaxy.clusterById.get(id) : undefined
      const m = mesh.current
      // Leaving a cluster keeps its hull and lets the reveal run back down.
      if (!m || !node) return
      st.reveal = 0
      st.clock = 0
      const built = hullGeometry(galaxy, node)
      m.geometry.dispose()
      m.geometry = built?.geo ?? new BufferGeometry()
      material.uniforms.uHeightRange!.value = built?.range ?? [0, 1]
      ;(material.uniforms.uColor!.value as Color).setRGB(...node.color.linear, LinearSRGBColorSpace)
      outline.commit(writeOutline(outline, galaxy, node))
      sceneBus.invalidate()
    }
    apply(useGalaxyStore.getState().focusCluster)
    return useGalaxyStore.subscribe((s) => s.focusCluster, apply)
  }, [galaxy, material, outline])

  useEffect(
    () => () => {
      mesh.current?.geometry.dispose()
      material.dispose()
      outline.dispose()
      outlineMat.material.dispose()
    },
    [material, outline, outlineMat],
  )

  useFrame((_, dt) => {
    const s = useGalaxyStore.getState()
    const st = state.current
    const instant = s.frozen || s.settings.motion === 'reduced'
    const on = st.id !== null && s.view !== 'list'
    const target = on ? 1 : 0
    st.reveal = instant ? target : Math.max(0, Math.min(1, st.reveal + (on ? dt : -2 * dt) / REVEAL_S))
    st.clock += dt
    const flat = sceneBus.uniforms.uFlat.value
    const u = material.uniforms
    u.uReveal!.value = st.reveal
    u.uOpacity!.value = (1 - flat) * (on ? 1 : st.reveal)
    const ou = outlineMat.uniforms
    ou.uOpacity.value = flat * st.reveal
    ou.uDrawClock.value = instant ? 1e6 : st.clock
    ou.uFlow.value = instant ? 0 : 1
    if (mesh.current) mesh.current.visible = u.uOpacity!.value > 0.001
    if (st.reveal !== target || (on && !instant)) sceneBus.invalidate()
  })

  return (
    <>
      <mesh ref={mesh} material={material} frustumCulled={false} raycast={() => null} renderOrder={5} />
      <mesh geometry={outline.geometry} material={outlineMat.material} frustumCulled={false} raycast={() => null} renderOrder={7} />
    </>
  )
}
