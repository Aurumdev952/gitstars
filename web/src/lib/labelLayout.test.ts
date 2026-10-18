import { describe, expect, it } from 'vitest'
import { Occupancy, balancedSplit, densityPeak, hysteresis, insetSlots, place, rectAt, rectDistance, type LabelBox } from './labelLayout'

const box = (x: number, y: number, prev: number | null = null): LabelBox => ({ x, y, w: 120, h: 18, slots: insetSlots(120, 18), prev })
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
    expect(place(occ, box(400, 310))).toBe(6)
    expect(place(occ, box(400, 300))).toBeNull()
  })

  it('hides a label rather than placing it farther than maxDrift from its anchor', () => {
    const far: LabelBox = { x: 400, y: 300, w: 120, h: 18, slots: [[20, -9]], prev: null }
    expect(place(new Occupancy(800, 600), { ...far, maxDrift: 12 })).toBeNull()
    expect(place(new Occupancy(800, 600), { ...far, maxDrift: 24 })).toBe(0)
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

describe('insetSlots', () => {
  it('keeps every slot on or within a few pixels of the anchor', () => {
    for (const [w, h] of [[120, 18], [240, 36], [60, 14]] as const) {
      const b: LabelBox = { x: 0, y: 0, w, h, slots: insetSlots(w, h), prev: null }
      for (let s = 0; s < b.slots.length; s++) expect(rectDistance(rectAt(b, s), 0, 0)).toBeLessThanOrEqual(4)
      expect(rectDistance(rectAt(b, 0), 0, 0)).toBe(0)
    }
  })
})

describe('balancedSplit', () => {
  it('wraps a long name at the space nearest its middle', () => {
    expect(balancedSplit('CYBERSECURITY AND ENGINEERING EDUCATION', 20)).toBe('CYBERSECURITY AND\nENGINEERING EDUCATION')
    expect(balancedSplit('Full-stack Web Development Architectures', 20)).toBe('Full-stack Web\nDevelopment Architectures')
  })

  it('leaves short names and single words alone', () => {
    expect(balancedSplit('AI AGENTIC ECOSYSTEM', 20)).toBe('AI AGENTIC ECOSYSTEM')
    expect(balancedSplit('Supercalifragilisticexpialidocious', 20)).toBe('Supercalifragilisticexpialidocious')
  })
})

describe('densityPeak', () => {
  it('lands on the stars of a two-lobed cluster whose mean falls in the gap', () => {
    const pts: number[] = []
    for (let k = 0; k < 30; k++) pts.push(-10 + Math.cos(k) * 0.8, Math.sin(k) * 0.8, 0)
    for (let k = 0; k < 20; k++) pts.push(10 + Math.cos(k) * 0.8, Math.sin(k) * 0.8, 0)
    const members = Array.from({ length: 50 }, (_, k) => k)
    const mean: [number, number, number] = [-2, 0, 0]
    const nearest = (p: readonly number[]) => Math.min(...members.map((m) => Math.hypot(pts[m * 3]! - p[0]!, pts[m * 3 + 1]! - p[1]!, pts[m * 3 + 2]! - p[2]!)))
    expect(nearest(mean)).toBeGreaterThan(7)
    const peak = densityPeak(pts, members, mean, 4)
    expect(nearest(peak)).toBeLessThan(1)
    expect(peak[0]).toBeLessThan(0)
  })

  it('ignores a far outlier that drags the mean', () => {
    const pts = [0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0, 300, 0, 0]
    const peak = densityPeak(pts, [0, 1, 2, 3, 4], [60.4, 0.4, 0], 40)
    expect(Math.hypot(peak[0] - 0.5, peak[1] - 0.5)).toBeLessThan(0.5)
  })
})
