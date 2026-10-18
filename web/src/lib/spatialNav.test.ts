import { describe, expect, it } from 'vitest'
import { spatialNeighbor, type ScreenStar } from './spatialNav'

const from = { i: 0, x: 100, y: 100 }
const stars: ScreenStar[] = [
  from,
  { i: 1, x: 160, y: 100 }, // right, on axis
  { i: 2, x: 140, y: 130 }, // diagonal, between right and down
  { i: 3, x: 40, y: 98 }, // left
  { i: 4, x: 102, y: 20 }, // up
  { i: 5, x: 100, y: 300 }, // far down
  { i: 6, x: 120, y: 160 }, // down, a little right
]

describe('spatialNeighbor', () => {
  it('moves to the nearest star in each arrow direction', () => {
    expect(spatialNeighbor(stars, from, 'right')).toBe(1)
    expect(spatialNeighbor(stars, from, 'left')).toBe(3)
    expect(spatialNeighbor(stars, from, 'up')).toBe(4)
    expect(spatialNeighbor(stars, from, 'down')).toBe(6)
  })

  it('prefers a star on the axis over a closer one far off it', () => {
    const s: ScreenStar[] = [from, { i: 7, x: 125, y: 140 }, { i: 8, x: 190, y: 104 }]
    expect(spatialNeighbor(s, from, 'right')).toBe(8)
  })

  it('returns null when nothing lies in that direction', () => {
    expect(spatialNeighbor([from, { i: 9, x: 50, y: 100 }], from, 'right')).toBeNull()
    expect(spatialNeighbor([from], from, 'up')).toBeNull()
  })
})
