export type Point2 = [number, number]

const cross = (o: Point2, a: Point2, b: Point2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

/** Convex hull of 2D points (Andrew's monotone chain), counter-clockwise, without collinear points. */
export function convexHull2d(points: readonly Point2[]): Point2[] {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  if (p.length < 3) return p
  const lower: Point2[] = []
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, q) <= 0) lower.pop()
    lower.push(q)
  }
  const upper: Point2[] = []
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i]!
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, q) <= 0) upper.pop()
    upper.push(q)
  }
  lower.pop()
  upper.pop()
  return lower.concat(upper)
}

/**
 * The members a hull should wrap: those within the `quantile` distance of the centroid, so one
 * stray star does not balloon the shape around empty space. Returns indices into `pts`.
 */
export function coreMembers(pts: readonly (readonly number[])[], quantile = 0.92): number[] {
  if (pts.length === 0) return []
  const dims = pts[0]!.length
  const c = new Array<number>(dims).fill(0)
  for (const p of pts) for (let k = 0; k < dims; k++) c[k]! += p[k]! / pts.length
  const d = pts.map((p) => Math.hypot(...p.map((v, k) => v - c[k]!)))
  const cut = [...d].sort((a, b) => a - b)[Math.min(d.length - 1, Math.floor(quantile * (d.length - 1)))]!
  return d.flatMap((v, i) => (v <= cut ? [i] : []))
}

/** Pushes each point away from the centroid by `scale` plus `pad` world units. */
export function inflate<T extends number[]>(pts: T[], scale: number, pad: number): T[] {
  if (pts.length === 0) return pts
  const dims = pts[0]!.length
  const c = new Array<number>(dims).fill(0)
  for (const p of pts) for (let k = 0; k < dims; k++) c[k]! += p[k]! / pts.length
  return pts.map((p) => {
    const len = Math.hypot(...p.map((v, k) => v - c[k]!)) || 1
    const f = scale + pad / len
    return p.map((v, k) => c[k]! + (v - c[k]!) * f) as T
  })
}
