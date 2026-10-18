import { describe, expect, it } from 'vitest'
import { MAX_AUTO_CHANGES, TIERS, applyVerdict, effectiveTier, stepTier, type AutoState } from './quality'

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

describe('applyVerdict', () => {
  it('stays at high however many smooth windows arrive', () => {
    let s: AutoState = { tier: 'high', changes: 0 }
    for (let k = 0; k < 20; k++) s = applyVerdict(s, 'up')
    expect(s).toEqual({ tier: 'high', changes: 0 })
  })

  it('steps down on a slow window and back up on a fast one', () => {
    const down = applyVerdict({ tier: 'high', changes: 0 }, 'down')
    expect(down).toEqual({ tier: 'med', changes: 1 })
    expect(applyVerdict(down, 'up')).toEqual({ tier: 'high', changes: 2 })
  })

  it('holds once it has changed tier the maximum number of times', () => {
    let s: AutoState = { tier: 'high', changes: 0 }
    for (const dir of ['down', 'up', 'down', 'up', 'down'] as const) s = applyVerdict(s, dir)
    expect(s.changes).toBe(MAX_AUTO_CHANGES)
    expect(s.tier).toBe('med')
  })
})
