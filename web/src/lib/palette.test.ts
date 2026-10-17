import { describe, expect, it } from 'vitest'
import { assignGalaxyHues, hueDistance, oklchColor, systemColor } from './palette'

describe('assignGalaxyHues', () => {
  it('gives each galaxy a distinct golden-angle hue', () => {
    const hues = assignGalaxyHues([[0, 0, 0], [50, 0, 0], [0, 50, 0], [0, 0, 50]])
    expect(new Set(hues.map((h) => h.toFixed(3))).size).toBe(4)
  })

  it('pushes the closest pair of galaxies far apart in hue', () => {
    // Two tight pairs far from each other: within each pair the hues must contrast strongly.
    const centroids = [
      [0, 0, 0], [4, 0, 0],
      [100, 0, 0], [104, 0, 0],
      [0, 100, 0], [0, 104, 0],
    ] as const
    const hues = assignGalaxyHues(centroids)
    for (const [a, b] of [[0, 1], [2, 3], [4, 5]] as const) {
      expect(hueDistance(hues[a]!, hues[b]!)).toBeGreaterThan(90)
    }
  })
})

describe('colours', () => {
  it('stays inside sRGB and keeps linear channels in range', () => {
    for (let h = 0; h < 360; h += 15) {
      const c = oklchColor(0.78, 0.14, h)
      for (const v of c.linear) {
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThanOrEqual(1.0001)
      }
    }
  })

  it('fans systems within ±15° of the parent hue', () => {
    const hues = [0, 1, 2, 3].map((r) => systemColor(200, r, 4).hue)
    expect(Math.min(...hues)).toBeGreaterThanOrEqual(184)
    expect(Math.max(...hues)).toBeLessThanOrEqual(216)
    expect(new Set(hues.map((h) => h.toFixed(1))).size).toBe(4)
  })
})
