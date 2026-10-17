import { bornAt, positionAt, starPixelRadius, type LayoutAttributes, type LayoutUniforms, type StarSizeUniforms } from './layout'

export type Projector = {
  /** Column-major view matrix (camera.matrixWorldInverse.elements). */
  view: ArrayLike<number>
  /** Column-major projection matrix, including any view offset. */
  proj: ArrayLike<number>
  width: number
  height: number
}

export type ScreenPoint = { x: number; y: number; viewDist: number }

const scratch: [number, number, number] = [0, 0, 0]

/** CSS-pixel position of a world point, or null when it is behind the camera. */
export function projectPoint(m: Projector, x: number, y: number, z: number): ScreenPoint | null {
  const v = m.view
  const vx = v[0]! * x + v[4]! * y + v[8]! * z + v[12]!
  const vy = v[1]! * x + v[5]! * y + v[9]! * z + v[13]!
  const vz = v[2]! * x + v[6]! * y + v[10]! * z + v[14]!
  if (vz >= -1e-3) return null
  const p = m.proj
  const cx = p[0]! * vx + p[4]! * vy + p[8]! * vz + p[12]!
  const cy = p[1]! * vx + p[5]! * vy + p[9]! * vz + p[13]!
  const cw = p[3]! * vx + p[7]! * vy + p[11]! * vz + p[15]!
  return { x: (cx / cw * 0.5 + 0.5) * m.width, y: (0.5 - cy / cw * 0.5) * m.height, viewDist: -vz }
}

export type PickInput = {
  attrs: LayoutAttributes & { size: Float32Array }
  n: number
  /** aDyn: (vis, highlight, focus, pulse) per star. */
  dyn: Float32Array
  layout: LayoutUniforms
  sizes: StarSizeUniforms
  projector: Projector
  x: number
  y: number
}

/**
 * Screen-space nearest star under the pointer, mirroring the shader's positions and sizes.
 * Stars that are filtered out (vis < 0.5) or not yet born are skipped.
 */
export function pickStar(input: PickInput): number | null {
  const { attrs, n, dyn, layout, sizes, projector, x, y } = input
  let best = -1
  let bestScore = Infinity
  for (let i = 0; i < n; i++) {
    const vis = dyn[i * 4]!
    if (vis < 0.5) continue
    const born = bornAt(attrs, i, layout)
    if (born < 0.5) continue
    const [px, py, pz] = positionAt(attrs, i, layout, scratch)
    const s = projectPoint(projector, px, py, pz)
    if (!s) continue
    const dx = s.x - x
    const dy = s.y - y
    const d2 = dx * dx + dy * dy
    const r = starPixelRadius(attrs.size[i]!, dyn[i * 4 + 1]!, vis, born, s.viewDist, projector.proj[5]!, projector.height, sizes)
    const reach = Math.max(8, 0.6 * r)
    if (d2 > reach * reach) continue
    const score = d2 / (1 + 0.5 * attrs.size[i]!)
    if (score < bestScore) {
      bestScore = score
      best = i
    }
  }
  return best < 0 ? null : best
}
