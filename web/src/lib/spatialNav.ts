export type Direction = 'left' | 'right' | 'up' | 'down'

export type ScreenStar = { i: number; x: number; y: number }

const AXIS: Record<Direction, [number, number]> = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] }
/** Off-axis distance costs this much more than on-axis, so the pick stays in the pressed direction. */
const PERP_WEIGHT = 2.5
const MIN_STEP_PX = 3
/** tan of the cone half-angle (about 60 degrees). */
const CONE = 1.7

/** The star an arrow key should move to: nearest in screen space inside a cone around `dir`. */
export function spatialNeighbor(stars: Iterable<ScreenStar>, from: { x: number; y: number; i: number }, dir: Direction): number | null {
  const [dx, dy] = AXIS[dir]
  let best: number | null = null
  let bestCost = Infinity
  for (const s of stars) {
    if (s.i === from.i) continue
    const ox = s.x - from.x
    const oy = s.y - from.y
    const along = ox * dx + oy * dy
    if (along < MIN_STEP_PX) continue
    const perp = Math.abs(ox * dy - oy * dx)
    if (perp > along * CONE) continue
    const cost = along + PERP_WEIGHT * perp
    if (cost < bestCost) {
      bestCost = cost
      best = s.i
    }
  }
  return best
}
