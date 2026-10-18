import { describe, expect, it } from 'vitest'
import { convexHull2d, coreMembers, inflate, type Point2 } from './hull'

describe('convexHull2d', () => {
  it('keeps only the corners, counter-clockwise', () => {
    const pts: Point2[] = [[0, 0], [2, 0], [2, 2], [0, 2], [1, 1], [1, 0], [0.5, 1.5]]
    expect(convexHull2d(pts)).toEqual([[0, 0], [2, 0], [2, 2], [0, 2]])
  })

  it('passes tiny inputs through', () => {
    expect(convexHull2d([[1, 1]])).toEqual([[1, 1]])
    expect(convexHull2d([])).toEqual([])
  })
})

describe('coreMembers', () => {
  it('drops the stray star so the hull hugs the cluster', () => {
    const pts = [...Array.from({ length: 20 }, (_, i) => [Math.cos(i), Math.sin(i), 0]), [50, 0, 0]]
    const core = coreMembers(pts, 0.92)
    expect(core).not.toContain(20)
    expect(core.length).toBeGreaterThanOrEqual(18)
  })
})

describe('inflate', () => {
  it('pads every point outward from the centroid', () => {
    const out = inflate([[1, 0], [-1, 0], [0, 1], [0, -1]], 1.06, 0.5)
    expect(out[0]![0]).toBeCloseTo(1.56)
    expect(out[3]![1]).toBeCloseTo(-1.56)
  })
})
