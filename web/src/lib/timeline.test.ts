import { describe, expect, it } from 'vitest'
import { fixtureGalaxy } from '#/test/fixture'
import { bornAt, RESTING_LAYOUT, type LayoutAttributes } from './layout'
import {
  BIRTH_WINDOW,
  birthIndex,
  bornCount,
  brightestNewborn,
  cursorMonthLabel,
  cursorToFraction,
  cursorToIso,
  cursorToMonth,
  cursorToUniform,
  dateToCursor,
  fractionToCursor,
  monthAtFraction,
  starredHistogram,
  stepCursorByMonths,
  toStarredRange,
} from './timeline'

const w = BIRTH_WINDOW
const range = toStarredRange(['2020-01-01T00:00:00Z', '2024-01-01T00:00:00Z'])
const at = (starred: number[]): LayoutAttributes => ({
  pos: new Float32Array(starred.length * 3),
  pos2: new Float32Array(starred.length * 3),
  seed: new Float32Array(starred.length),
  starred: Float32Array.from(starred),
})
const born = (a: LayoutAttributes, i: number, c: number) =>
  bornAt(a, i, { ...RESTING_LAYOUT, timelineOn: true, timeline: cursorToUniform(c), birthWindow: w })

describe('cursor and uniform', () => {
  it('runs the uniform past 1 + birthWindow at c = 1, so the newest star is fully born', () => {
    expect(cursorToUniform(1)).toBeGreaterThanOrEqual(1 + w)
    expect(born(at([1]), 0, 1)).toBe(1)
  })

  it('shows nothing at c = 0, not even a star starred at the range start', () => {
    expect(born(at([0]), 0, 0)).toBe(0)
    expect(bornCount(birthIndex(Float32Array.from([0, 0, 0.5])), 0)).toBe(0)
  })

  it('looks identical to the closed timeline at c = 1', () => {
    const a = at([0, 0.25, 0.999, 1])
    for (let i = 0; i < 4; i++) expect(born(a, i, 1)).toBe(bornAt(a, i, RESTING_LAYOUT))
  })

  it('dates the cursor at the moment a star is half born', () => {
    const a = at([0.4])
    expect(born(a, 0, fractionToCursor(0.4))).toBeCloseTo(0.5, 6)
    expect(cursorToFraction(fractionToCursor(0.4))).toBeCloseTo(0.4, 12)
  })

  it('maps the ends of the date axis to the ends of the cursor', () => {
    expect(fractionToCursor(0)).toBe(0)
    expect(fractionToCursor(1)).toBe(1)
    expect(cursorToFraction(0)).toBe(0)
    expect(cursorToFraction(1)).toBe(1)
  })
})

describe('dates', () => {
  it('round-trips a date through the cursor', () => {
    for (const iso of ['2020-01-01T00:00:00.000Z', '2021-03-14T12:00:00.000Z', '2023-07-31T23:59:00.000Z', '2024-01-01T00:00:00.000Z']) {
      expect(Date.parse(cursorToIso(dateToCursor(iso, range), range))).toBeCloseTo(Date.parse(iso), -3)
    }
  })

  it('round-trips an interior cursor through its date', () => {
    for (const c of [0.05, 0.3, 0.71, 0.95]) expect(dateToCursor(cursorToIso(c, range), range)).toBeCloseTo(c, 9)
  })

  it('names the month and its label', () => {
    const c = dateToCursor('2021-03-14T12:00:00Z', range)
    expect(cursorToMonth(c, range)).toBe('2021-03')
    expect(cursorMonthLabel(c, range)).toBe('Mar 2021')
    expect(cursorToMonth(0, range)).toBe('2020-01')
    expect(cursorToMonth(1, range)).toBe('2024-01')
  })

  it('steps by calendar months and clamps at the ends', () => {
    const c = dateToCursor('2021-01-31T00:00:00Z', range)
    expect(cursorToIso(stepCursorByMonths(c, 1, range), range).slice(0, 10)).toBe('2021-02-28')
    expect(cursorToIso(stepCursorByMonths(c, -12, range), range).slice(0, 10)).toBe('2020-01-31')
    expect(stepCursorByMonths(c, 100, range)).toBe(1)
    expect(stepCursorByMonths(c, -100, range)).toBe(0)
    expect(cursorToMonth(stepCursorByMonths(0, 1, range), range)).toBe('2020-02')
  })
})

describe('born counts', () => {
  // Unsorted on purpose; stars 1 and 4 share a moment.
  const starred = Float32Array.from([0.5, 0.1, 0.9, 0, 0.1, 1])
  const stars = [50, 10, 900, 1, 300, 7]
  const ix = birthIndex(starred)

  it('counts the stars at least half born at known cursors', () => {
    expect(bornCount(ix, 0)).toBe(0)
    expect(bornCount(ix, fractionToCursor(0.05))).toBe(1)
    expect(bornCount(ix, fractionToCursor(0.1))).toBe(3)
    expect(bornCount(ix, fractionToCursor(0.6))).toBe(4)
    expect(bornCount(ix, fractionToCursor(0.95))).toBe(5)
    expect(bornCount(ix, 1)).toBe(6)
  })

  it('agrees with the shader: a counted star is at least half born, an uncounted one less', () => {
    const a = at(Array.from(starred))
    for (const c of [0.02, 0.1, 0.37, 0.52, 0.9, 0.99]) {
      const half = Array.from(starred, (_, i) => born(a, i, c) >= 0.5 - 1e-6).filter(Boolean).length
      expect(bornCount(ix, c)).toBe(half)
    }
  })

  it('counts only the included stars', () => {
    const only = birthIndex(starred, Uint8Array.from([1, 0, 1, 0, 0, 1]))
    expect(bornCount(only, fractionToCursor(0.6))).toBe(1)
    expect(bornCount(only, 1)).toBe(3)
  })

  it('names the most-starred star born within the last birth window', () => {
    expect(brightestNewborn(ix, stars, fractionToCursor(0.1))).toBe(4)
    expect(brightestNewborn(ix, stars, fractionToCursor(0.1 + w * 0.99))).toBe(4)
    expect(brightestNewborn(ix, stars, fractionToCursor(0.1 + w * 1.01))).toBeNull()
    expect(brightestNewborn(ix, stars, 1)).toBe(5)
    expect(brightestNewborn(ix, stars, 0)).toBeNull()
  })
})

describe('starred histogram', () => {
  it('bins by calendar month across the starred range, stacked by galaxy', () => {
    const h = starredHistogram(
      ['2020-01-05T00:00:00Z', '2020-01-20T00:00:00Z', '2020-03-01T00:00:00Z', '2020-03-31T00:00:00Z'],
      [0, 1, 1, 1],
      2,
      ['2020-01-05T00:00:00Z', '2020-03-31T00:00:00Z'],
    )
    expect(h.months).toEqual(['2020-01', '2020-02', '2020-03'])
    expect(Array.from(h.counts)).toEqual([1, 1, 0, 0, 0, 2])
    expect(Array.from(h.totals)).toEqual([2, 0, 2])
    expect(h.max).toBe(2)
    expect(h.edges[0]).toBe(0)
    expect(h.edges[3]).toBe(1)
    expect(monthAtFraction(h, 0)).toBe(0)
    expect(monthAtFraction(h, (h.edges[1]! + h.edges[2]!) / 2)).toBe(1)
    expect(monthAtFraction(h, 1)).toBe(2)
  })

  it('totals n on the fixture, in galaxy order', () => {
    const g = fixtureGalaxy
    const h = starredHistogram(
      g.repos.map((r) => r.starredAt),
      g.galaxyOf,
      g.galaxies.length,
      g.data.meta.starredRange,
    )
    expect(Array.from(h.totals).reduce((a, b) => a + b, 0)).toBe(g.n)
    expect(Array.from(h.counts).reduce((a, b) => a + b, 0)).toBe(g.n)
    for (const gal of g.galaxies) {
      let sum = 0
      for (let m = 0; m < h.months.length; m++) sum += h.counts[m * h.galaxies + gal.index]!
      expect(sum).toBe(gal.members.length)
    }
  })
})
