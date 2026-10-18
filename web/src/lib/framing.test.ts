import { describe, expect, it } from 'vitest'
import { mulberry32 } from './random'
import { fitPoints, orbitBasis, type FitOptions } from './framing'

const opts: FitOptions = { azimuth: 0.62, polar: 1.12, tanHalfFov: Math.tan((50 * Math.PI) / 360), aspect: 16 / 9, fill: { x: 0.85, y: 0.8 }, quantile: 0.98 }

function cloud(n: number, half: [number, number, number], offset: [number, number, number] = [0, 0, 0]) {
  const rand = mulberry32(7)
  const pos = new Float32Array(n * 3)
  for (let i = 0; i < n * 3; i++) pos[i] = offset[i % 3]! + (rand() * 2 - 1) * half[i % 3]!
  return pos
}

/** Share of points inside the fill box when viewed from the fitted camera. */
function fitted(pos: Float32Array, n: number, o: FitOptions, distanceScale = 1) {
  const { target, distance } = fitPoints(pos, n, o)
  const { right, up, back } = orbitBasis(o.azimuth, o.polar)
  const d = distance * distanceScale
  const cam = [0, 1, 2].map((k) => target[k]! + back[k]! * d)
  let inside = 0
  let maxX = 0
  let maxY = 0
  for (let i = 0; i < n; i++) {
    const v = [0, 1, 2].map((k) => pos[i * 3 + k]! - cam[k]!)
    const dot = (a: number[]) => v[0]! * a[0]! + v[1]! * a[1]! + v[2]! * a[2]!
    const depth = -dot(back)
    const x = dot(right) / depth / (o.tanHalfFov * o.aspect)
    const y = dot(up) / depth / o.tanHalfFov
    if (Math.abs(x) <= o.fill.x + 1e-9 && Math.abs(y) <= o.fill.y + 1e-9) inside++
    maxX = Math.max(maxX, Math.abs(x))
    maxY = Math.max(maxY, Math.abs(y))
  }
  return { inside: inside / n, maxX, maxY }
}

describe('fitPoints', () => {
  it('fits the requested share of points inside the fill box', () => {
    const n = 2000
    const pos = cloud(n, [200, 60, 80], [50, -10, 0])
    expect(fitted(pos, n, opts).inside).toBeGreaterThanOrEqual(0.98)
  })

  it('is tight: pulling in by a tenth pushes points out of frame', () => {
    const n = 2000
    const pos = cloud(n, [200, 60, 80])
    expect(fitted(pos, n, opts, 0.9).inside).toBeLessThan(0.98)
  })

  it('ignores a small far outlier group instead of shrinking the main cloud', () => {
    const n = 1000
    const main = cloud(n - 6, [100, 40, 40])
    const pos = new Float32Array(n * 3)
    pos.set(main)
    for (let i = n - 6; i < n; i++) pos.set([900, 0, 0], i * 3)
    const withOutliers = fitPoints(pos, n, opts)
    const alone = fitPoints(main, n - 6, opts)
    expect(withOutliers.distance).toBeLessThan(alone.distance * 1.15)
  })

  it('centres on the cloud, not the origin', () => {
    const n = 1500
    const pos = cloud(n, [50, 50, 50], [300, 20, -40])
    const { target } = fitPoints(pos, n, opts)
    expect(target[0]).toBeCloseTo(300, -1)
    expect(target[1]).toBeCloseTo(20, -1)
    expect(target[2]).toBeCloseTo(-40, -1)
  })
})
