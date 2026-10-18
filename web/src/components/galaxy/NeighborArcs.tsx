import { useEffect, useMemo, useRef, useState } from 'react'
import { Line } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { Vector3 } from 'three'
import type { Line2 } from 'three-stdlib'
import type { GalaxyIndex } from '#/lib/load'
import { positionAt } from '#/lib/layout'
import { useGalaxyStore } from '#/state/store'
import { currentLayout, sceneBus } from './sceneBus'

const SEGMENTS = 20
const FADE_S = 0.15
const STAGGER_S = 0.04
const FLOW_SPEED = 0.5
// Above 1 so arcs cross the bloom threshold and glow like the stars they join. Baked into the
// vertex colours: drei's Line forces its colour to white whenever vertexColors is set.
const ARC_GAIN = 1.4
const FLOW_GAIN = 2.4

type RGB = [number, number, number]
type Arc = { j: number; cos: number; rank: number; points: Vector3[]; colors: RGB[]; flowColors: RGB[] }

/** Quadratic arc bowed toward the viewer: control = mid + normalize(view × (b − a)) · |b − a| · 0.25. */
export function arcPoints(a: Vector3, b: Vector3, viewDir: Vector3, segments = SEGMENTS): Vector3[] {
  const ab = b.clone().sub(a)
  const len = ab.length()
  const side = new Vector3().crossVectors(viewDir, ab)
  if (side.lengthSq() < 1e-8) side.set(0, 1, 0)
  const ctrl = a.clone().add(b).multiplyScalar(0.5).add(side.normalize().multiplyScalar(len * 0.25))
  const pts: Vector3[] = []
  for (let k = 0; k <= segments; k++) {
    const t = k / segments
    const u = 1 - t
    pts.push(new Vector3(u * u * a.x + 2 * u * t * ctrl.x + t * t * b.x, u * u * a.y + 2 * u * t * ctrl.y + t * t * b.y, u * u * a.z + 2 * u * t * ctrl.z + t * t * b.z))
  }
  return pts
}

function buildArcs(g: GalaxyIndex, i: number, flat: number): Arc[] {
  const layout = { ...currentLayout(), flat }
  const a = new Vector3(...positionAt(g.attrs, i, layout, [0, 0, 0]))
  const cam = sceneBus.camera
  const viewDir = cam ? a.clone().sub(cam.position).normalize() : new Vector3(0, 0, -1)
  const src = g.attrs.color.subarray(i * 3, i * 3 + 3)
  return g.repos[i]!.neighbors.map(([j, cos], rank) => {
    const b = new Vector3(...positionAt(g.attrs, j, layout, [0, 0, 0]))
    const dst = g.attrs.color.subarray(j * 3, j * 3 + 3)
    const points = arcPoints(a, b, viewDir)
    const colors = points.map((_, k): [number, number, number] => {
      const t = k / SEGMENTS
      // Whiter at the source so the arcs read as leaving the hovered star.
      const w = 0.55 * (1 - t)
      return [0, 1, 2].map((c) => (src[c]! * (1 - t) + dst[c]! * t) * (1 - w) + w) as [number, number, number]
    })
    const gain = (k: number) => colors.map((c) => c.map((v) => v * k) as RGB)
    return { j, cos, rank, points, colors: gain(ARC_GAIN), flowColors: gain(FLOW_GAIN) }
  })
}

/** kNN arcs from the hovered (else selected) star to its neighbours, weighted by cosine. */
export function NeighborArcs({ galaxy }: { galaxy: GalaxyIndex }) {
  const [anchor, setAnchor] = useState<number | null>(null)
  const [flat, setFlat] = useState(0)
  const born = useRef(0)
  const lines = useRef<(Line2 | null)[]>([])
  const flows = useRef<(Line2 | null)[]>([])

  useEffect(
    () =>
      useGalaxyStore.subscribe(
        (s) => (s.view === 'list' ? null : (s.hovered ?? s.selected)),
        (a) => {
          setAnchor(a)
          born.current = performance.now()
          sceneBus.invalidate()
        },
        { fireImmediately: true },
      ),
    [],
  )

  const arcs = useMemo(() => (anchor === null || anchor >= galaxy.n ? [] : buildArcs(galaxy, anchor, flat)), [galaxy, anchor, flat])

  useFrame((_, dt) => {
    const u = sceneBus.uniforms.uFlat.value
    // Rebuild while the flat tween runs, in steps, so arcs stay attached to their stars.
    if (anchor !== null && Math.abs(u - flat) > 0.02) setFlat(u)
    const s = useGalaxyStore.getState()
    const still = s.frozen || s.settings.motion === 'reduced'
    const age = (performance.now() - born.current) / 1000
    let animating = false
    arcs.forEach((arc, k) => {
      const t = still ? 1 : Math.min(1, Math.max(0, (age - arc.rank * STAGGER_S) / FADE_S))
      if (t < 1) animating = true
      const weight = Math.max(0, (arc.cos - 0.35) / 0.65)
      const line = lines.current[k]
      if (line) line.material.opacity = t * (0.22 + 0.5 * weight)
      const flow = flows.current[k]
      if (flow) {
        flow.visible = !still
        flow.material.opacity = t * (0.35 + 0.55 * weight)
        flow.material.dashOffset -= dt * FLOW_SPEED
      }
    })
    if (animating || (!still && arcs.length > 0)) sceneBus.invalidate()
  })

  return (
    <group renderOrder={8}>
      {arcs.map((arc, k) => {
        const width = 1.1 + 2.2 * Math.max(0, (arc.cos - 0.35) / 0.65)
        return (
          <group key={`${anchor}-${arc.j}`}>
            <Line
              ref={(l) => void (lines.current[k] = l as unknown as Line2 | null)}
              points={arc.points}
              vertexColors={arc.colors}
              lineWidth={width}
              transparent
              opacity={0}
              depthWrite={false}
              toneMapped={false}
            />
            <Line
              ref={(l) => void (flows.current[k] = l as unknown as Line2 | null)}
              points={arc.points}
              vertexColors={arc.flowColors}
              lineWidth={width * 1.6}
              dashed
              dashSize={0.06}
              gapSize={0.94}
              dashScale={1 / Math.max(1e-3, arc.points[0]!.distanceTo(arc.points[SEGMENTS]!))}
              transparent
              opacity={0}
              depthWrite={false}
              toneMapped={false}
            />
          </group>
        )
      })}
    </group>
  )
}
