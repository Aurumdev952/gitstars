import { clampChroma, converter, formatCss } from 'culori'

export type ClusterColor = {
  hue: number
  /** OKLCH string for DOM use. */
  css: string
  /** Linear sRGB for the shaders. */
  linear: [number, number, number]
}

const GOLDEN_ANGLE = 137.508
const BASE = { l: 0.78, c: 0.14 }
const toLinear = converter('lrgb')

export function oklchColor(l: number, c: number, h: number): ClusterColor {
  const color = clampChroma({ mode: 'oklch' as const, l, c, h: ((h % 360) + 360) % 360 }, 'oklch')
  const lin = toLinear(color)
  return {
    hue: color.h ?? h,
    css: formatCss(color),
    linear: [Math.max(0, lin.r), Math.max(0, lin.g), Math.max(0, lin.b)],
  }
}

export const hueDistance = (a: number, b: number) => {
  const d = Math.abs((((a - b) % 360) + 360) % 360)
  return d > 180 ? 360 - d : d
}

type Vec3 = readonly [number, number, number]

/**
 * Golden-angle hues, then greedily handed out so galaxies that sit close in 3D get far-apart hues.
 * Returns one hue per centroid, in input order.
 */
export function assignGalaxyHues(centroids: readonly Vec3[], startHue = 250): number[] {
  const n = centroids.length
  const pool = Array.from({ length: n }, (_, i) => (startHue + i * GOLDEN_ANGLE) % 360)
  const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
  const spread = Math.max(1e-6, ...centroids.flatMap((a) => centroids.map((b) => dist(a, b)))) / 2

  // Most crowded galaxies choose first, while the pool is still wide.
  const crowding = centroids.map((a, i) =>
    centroids.reduce((s, b, j) => (i === j ? s : s + Math.exp(-dist(a, b) / spread)), 0),
  )
  const order = [...centroids.keys()].sort((a, b) => crowding[b]! - crowding[a]!)
  const hues = new Array<number>(n)
  const assigned: number[] = []
  for (const i of order) {
    let bestK = 0
    let bestCost = Infinity
    pool.forEach((h, k) => {
      const cost = assigned.reduce((s, j) => {
        const closeness = Math.exp(-dist(centroids[i]!, centroids[j]!) / spread)
        return s + closeness * (1 - hueDistance(h, hues[j]!) / 180) ** 2
      }, 0)
      if (cost < bestCost) {
        bestCost = cost
        bestK = k
      }
    })
    hues[i] = pool.splice(bestK, 1)[0]!
    assigned.push(i)
  }
  return hues
}

export function galaxyColor(hue: number): ClusterColor {
  return oklchColor(BASE.l, BASE.c, hue)
}

/** Siblings fan out ±15° and ±0.05 L around the parent hue. */
export function systemColor(parentHue: number, rank: number, siblings: number): ClusterColor {
  const t = siblings <= 1 ? 0 : rank / (siblings - 1) - 0.5
  const dl = siblings <= 1 ? 0 : rank % 2 === 0 ? 0.04 : -0.04
  return oklchColor(BASE.l + dl, BASE.c, parentHue + t * 30)
}
