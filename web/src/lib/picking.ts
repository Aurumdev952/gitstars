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
  // Clip = P·V·p. For a perspective camera clip.w is the view distance, which sizes the sprite.
  const m = multiply(projector.proj, projector.view)
  const atRest = layout.flat === 0 && layout.intro >= 1 && !layout.timelineOn
  const maxReach = Math.max(8, 0.6 * sizes.maxPx)
  const maxReach2 = maxReach * maxReach
  const { pos } = attrs
  const { width, height } = projector
  let best = -1
  let bestScore = Infinity
  for (let i = 0; i < n; i++) {
    const vis = dyn[i * 4]!
    if (vis < 0.5) continue
    const born = atRest ? 1 : bornAt(attrs, i, layout)
    if (born < 0.5) continue
    let px: number, py: number, pz: number
    if (atRest) {
      px = pos[i * 3]!
      py = pos[i * 3 + 1]!
      pz = pos[i * 3 + 2]!
    } else {
      ;[px, py, pz] = positionAt(attrs, i, layout, scratch)
    }
    const cw = m[3]! * px + m[7]! * py + m[11]! * pz + m[15]!
    if (cw <= 1e-3) continue
    const sx = ((m[0]! * px + m[4]! * py + m[8]! * pz + m[12]!) / cw * 0.5 + 0.5) * width
    const sy = (0.5 - (m[1]! * px + m[5]! * py + m[9]! * pz + m[13]!) / cw * 0.5) * height
    const dx = sx - x
    const dy = sy - y
    const d2 = dx * dx + dy * dy
    if (d2 > maxReach2) continue
    const r = starPixelRadius(attrs.size[i]!, dyn[i * 4 + 1]!, vis, born, cw, projector.proj[5]!, height, sizes)
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

function multiply(a: ArrayLike<number>, b: ArrayLike<number>): Float64Array {
  const out = new Float64Array(16)
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) {
      let s = 0
      for (let k = 0; k < 4; k++) s += a[k * 4 + r]! * b[c * 4 + k]!
      out[c * 4 + r] = s
    }
  return out
}
