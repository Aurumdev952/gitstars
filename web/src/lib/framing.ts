export type Vec3 = [number, number, number]

/** Camera axes for an orbit at (azimuth, polar) around a y-up target, as camera-controls defines them. */
export function orbitBasis(azimuth: number, polar: number) {
  const back: Vec3 = [Math.sin(polar) * Math.sin(azimuth), Math.cos(polar), Math.sin(polar) * Math.cos(azimuth)]
  // right = normalize(worldUp × back), up = back × right
  const rl = Math.hypot(back[2], back[0]) || 1
  const right: Vec3 = [back[2] / rl, 0, -back[0] / rl]
  const up: Vec3 = [back[1] * right[2] - back[2] * right[1], back[2] * right[0] - back[0] * right[2], back[0] * right[1] - back[1] * right[0]]
  return { right, up, back }
}

export type FitOptions = {
  azimuth: number
  polar: number
  /** tan(vertical fov / 2). */
  tanHalfFov: number
  aspect: number
  /** Share of the viewport the cloud may fill, per axis (HUD chrome takes the rest). */
  fill: { x: number; y: number }
  /** Share of points that must fit; the rest are outliers allowed off screen. */
  quantile: number
}

export type Framing = { target: Vec3; distance: number }

function quantileOf(xs: Float64Array, q: number) {
  const s = Float64Array.from(xs).sort()
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * (s.length - 1))))]!
}

/**
 * The target and orbit distance at which `quantile` of the points fill the viewport as seen from
 * (azimuth, polar). A bounding sphere frames the worst direction and leaves the overview a small
 * cloud in the middle; this fits the projected extent per screen axis instead, and centres on
 * the robust middle of that extent rather than on the mean, which outlying galaxies drag aside.
 */
export function fitPoints(pos: ArrayLike<number>, n: number, o: FitOptions): Framing {
  const { right, up, back } = orbitBasis(o.azimuth, o.polar)
  const r = new Float64Array(n)
  const u = new Float64Array(n)
  const f = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const x = pos[i * 3]!, y = pos[i * 3 + 1]!, z = pos[i * 3 + 2]!
    r[i] = x * right[0] + y * right[1] + z * right[2]
    u[i] = x * up[0] + y * up[1] + z * up[2]
    f[i] = x * back[0] + y * back[1] + z * back[2]
  }
  const tail = (1 - o.quantile) / 2
  const rc = (quantileOf(r, tail) + quantileOf(r, 1 - tail)) / 2
  const uc = (quantileOf(u, tail) + quantileOf(u, 1 - tail)) / 2
  const fc = quantileOf(f, 0.5)
  const tanV = o.tanHalfFov * o.fill.y
  const tanH = o.tanHalfFov * o.aspect * o.fill.x
  // A point at depth offset df toward the camera fits when |dr| / (D - df) <= tanH, so D >= df + |dr| / tanH.
  const need = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const df = f[i]! - fc
    need[i] = df + Math.max(Math.abs(r[i]! - rc) / tanH, Math.abs(u[i]! - uc) / tanV)
  }
  const distance = Math.max(1, quantileOf(need, o.quantile))
  const target: Vec3 = [
    rc * right[0] + uc * up[0] + fc * back[0],
    rc * right[1] + uc * up[1] + fc * back[1],
    rc * right[2] + uc * up[2] + fc * back[2],
  ]
  return { target, distance }
}
