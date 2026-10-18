import { describe, expect, it } from 'vitest'
import { bornAt, positionAt, RESTING_LAYOUT, type LayoutAttributes } from './layout'

const attrs: LayoutAttributes = {
  pos: new Float32Array([10, 20, 30, -4, 0, 8]),
  pos2: new Float32Array([2, 4, 0, 6, -2, 0]),
  delay: new Float32Array([0, 0.5]),
  starred: new Float32Array([0.3, 0.9]),
}

describe('positionAt', () => {
  it('returns the 3D layout position at rest', () => {
    expect(positionAt(attrs, 0, RESTING_LAYOUT)).toEqual([10, 20, 30])
  })

  it('interpolates toward pos2 with uFlat', () => {
    const [x, y, z] = positionAt(attrs, 0, { ...RESTING_LAYOUT, flat: 0.25 })
    expect([x, y, z]).toEqual([8, 16, 22.5])
  })

  it('collapses every star onto the intro origin at uIntro = 0', () => {
    const origin = [1, 2, 3] as const
    expect(positionAt(attrs, 0, { ...RESTING_LAYOUT, intro: 0, introOrigin: origin })).toEqual([1, 2, 3])
    expect(positionAt(attrs, 1, { ...RESTING_LAYOUT, intro: 0, introOrigin: origin })).toEqual([1, 2, 3])
  })

  it('spirals out by the shader formula mid-intro', () => {
    // delay 0, uIntro 0.275: t = 0.5, e = 0.875; the twist grows with distance from the origin.
    const u = { ...RESTING_LAYOUT, intro: 0.275, introRadius: 50 }
    const p = positionAt(attrs, 0, u)
    const ang = 0.125 * (1.4 + (2.6 * Math.hypot(10, 20, 30)) / 50)
    const c = Math.cos(ang), s = Math.sin(ang)
    expect(p[0]).toBeCloseTo((10 * c + 30 * s) * 0.875, 5)
    expect(p[1]).toBeCloseTo(20 * 0.875 * 0.875, 5)
    expect(p[2]).toBeCloseTo((-10 * s + 30 * c) * 0.875, 5)
  })

  it('winds outer stars further than inner ones, which draws the spiral arms', () => {
    const two: LayoutAttributes = { pos: new Float32Array([10, 0, 0, 80, 0, 0]), pos2: new Float32Array(6), delay: new Float32Array(2), starred: new Float32Array(2) }
    const u = { ...RESTING_LAYOUT, intro: 0.2, introRadius: 80 }
    const angle = (i: number) => {
      const [x, , z] = positionAt(two, i, u)
      return Math.atan2(-z, x)
    }
    expect(angle(1)).toBeGreaterThan(angle(0) + 0.5)
  })

  it('delays late stars, so they are still at the origin when early ones have landed', () => {
    const u = { ...RESTING_LAYOUT, intro: 0.45 }
    expect(positionAt(attrs, 1, u)).toEqual([0, 0, 0])
    expect(positionAt(attrs, 0, { ...RESTING_LAYOUT, intro: 0.55 })).toEqual([10, 20, 30])
  })
})

describe('bornAt', () => {
  it('is 1 with the timeline off and ramps across the birth window when on', () => {
    expect(bornAt(attrs, 0, RESTING_LAYOUT)).toBe(1)
    const on = { ...RESTING_LAYOUT, timelineOn: true, birthWindow: 0.1 }
    expect(bornAt(attrs, 0, { ...on, timeline: 0.29 })).toBe(0)
    expect(bornAt(attrs, 0, { ...on, timeline: 0.35 })).toBeCloseTo(0.5, 5)
    expect(bornAt(attrs, 0, { ...on, timeline: 0.5 })).toBe(1)
  })
})
