import { describe, expect, it } from 'vitest'
import { Occupancy, clusterSlots, hysteresis, place, rectAt, type LabelBox } from './labelLayout'

const box = (x: number, y: number, prev: number | null = null): LabelBox => ({ x, y, w: 120, h: 18, slots: clusterSlots(120, 18), prev })
const overlap = (a: ReturnType<typeof rectAt>, b: ReturnType<typeof rectAt>) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1

describe('place', () => {
  it('never lets two placed labels overlap, however crowded', () => {
    const occ = new Occupancy(800, 600)
    const placed: ReturnType<typeof rectAt>[] = []
    for (let k = 0; k < 40; k++) {
      const b = box(380 + (k % 5) * 9, 280 + Math.floor(k / 5) * 7)
      const s = place(occ, b)
      if (s !== null) placed.push(rectAt(b, s))
    }
    expect(placed.length).toBeGreaterThan(2)
    for (let a = 0; a < placed.length; a++) for (let b = a + 1; b < placed.length; b++) expect(overlap(placed[a]!, placed[b]!)).toBe(false)
  })

  it('moves a label to another slot before giving up', () => {
    const occ = new Occupancy(800, 600)
    expect(place(occ, box(400, 300))).toBe(0)
    expect(place(occ, box(400, 300))).toBe(1)
  })

  it('keeps the previous slot when it is still free', () => {
    const occ = new Occupancy(800, 600)
    expect(place(occ, box(400, 300, 3))).toBe(3)
  })

  it('rejects labels that would be cut by the viewport edge', () => {
    const occ = new Occupancy(800, 600)
    expect(place(occ, { x: 2, y: 2, w: 900, h: 18, slots: [[0, 0]], prev: null })).toBeNull()
  })

  it('respects rects claimed by HUD panels', () => {
    const occ = new Occupancy(800, 600)
    occ.add({ x0: 0, y0: 0, x1: 800, y1: 600 })
    expect(place(occ, box(400, 300))).toBeNull()
  })
})

describe('hysteresis', () => {
  it('needs the higher threshold to appear and the lower one to vanish', () => {
    expect(hysteresis(false, 55, 60, 45)).toBe(false)
    expect(hysteresis(true, 55, 60, 45)).toBe(true)
    expect(hysteresis(true, 40, 60, 45)).toBe(false)
    expect(hysteresis(false, 61, 60, 45)).toBe(true)
  })
})
