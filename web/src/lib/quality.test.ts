import { describe, expect, it } from 'vitest'
import { TIERS, effectiveTier, stepTier } from './quality'

describe('stepTier', () => {
  it('steps down and up one tier, clamped at both ends', () => {
    expect(stepTier('high', 'down')).toBe('med')
    expect(stepTier('med', 'down')).toBe('low')
    expect(stepTier('low', 'down')).toBe('low')
    expect(stepTier('low', 'up')).toBe('med')
    expect(stepTier('high', 'up')).toBe('high')
  })
})

describe('effectiveTier', () => {
  it('follows the monitor only on auto', () => {
    expect(effectiveTier('auto', 'med')).toBe('med')
    expect(effectiveTier('high', 'low')).toBe('high')
    expect(effectiveTier('low', 'high')).toBe('low')
  })
})

describe('TIERS', () => {
  it('cuts bloom levels before resolution, and keeps aberration for high only', () => {
    expect(TIERS.med.bloomLevels).toBeLessThan(TIERS.high.bloomLevels)
    expect(TIERS.med.dpr).toEqual(TIERS.high.dpr)
    expect(TIERS.low.dpr[1]).toBeLessThan(TIERS.med.dpr[1])
    expect([TIERS.low, TIERS.med, TIERS.high].map((t) => t.chromaticAberration)).toEqual([false, false, true])
  })
})
