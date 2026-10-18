import { describe, expect, it } from 'vitest'
import { fixtureData } from '#/test/fixture'
import { mulberry32 } from './random'
import { discoveryScore, forgottenReason, pickForgotten } from './discovery'
import type { Repo } from './schema'

const now = Date.parse('2026-06-01T00:00:00Z')
const base: Repo = { ...fixtureData.repos[0]!, quality: 0.8, archived: false, starredAt: '2020-06-01T00:00:00Z', pushedAt: '2026-05-20T00:00:00Z' }

describe('discoveryScore', () => {
  it('rewards quality, age of the star and recent pushes', () => {
    const s = discoveryScore(base, now, false)
    expect(discoveryScore({ ...base, quality: 0.4 }, now, false)).toBeCloseTo(s / 2)
    expect(discoveryScore({ ...base, starredAt: '2025-12-01T00:00:00Z' }, now, false)).toBeLessThan(s)
    expect(discoveryScore({ ...base, pushedAt: '2019-01-01T00:00:00Z' }, now, false)).toBeLessThan(s)
  })

  it('saturates the age term at three years', () => {
    expect(discoveryScore({ ...base, starredAt: '2015-01-01T00:00:00Z' }, now, false)).toBeCloseTo(discoveryScore(base, now, false))
  })

  it('penalises archived repos fivefold and zeroes ones already shown', () => {
    expect(discoveryScore({ ...base, archived: true }, now, false)).toBeCloseTo(discoveryScore(base, now, false) * 0.2)
    expect(discoveryScore(base, now, true)).toBe(0)
  })

  it('scores a star from this week as nothing to rediscover', () => {
    expect(discoveryScore({ ...base, starredAt: '2026-05-30T00:00:00Z' }, now, false)).toBeLessThan(0.01)
  })
})

describe('pickForgotten', () => {
  const repos = fixtureData.repos
  const fixtureNow = Date.parse(fixtureData.meta.generatedAt)

  it('draws from the 50 best and never repeats a seen star', () => {
    const scores = repos.map((r) => discoveryScore(r, fixtureNow, false))
    const rand = mulberry32(7)
    const seen = new Set<number>()
    for (let k = 0; k < 30; k++) {
      const unseen = scores.filter((_, j) => !seen.has(j)).sort((a, b) => b - a)
      const i = pickForgotten(repos, fixtureNow, seen, rand)!
      expect(seen.has(i)).toBe(false)
      expect(scores[i]!).toBeGreaterThanOrEqual(unseen[49]!)
      seen.add(i)
    }
  })

  it('respects the filter mask and returns null when nothing qualifies', () => {
    const only = new Uint8Array(repos.length)
    only[3] = 1
    const pick = pickForgotten(repos, fixtureNow, new Set(), mulberry32(1), only)
    expect(pick === 3 || pick === null).toBe(true)
    expect(pickForgotten(repos, fixtureNow, new Set(), mulberry32(1), new Uint8Array(repos.length))).toBeNull()
  })
})

describe('forgottenReason', () => {
  it('says how long ago and whether it is still alive', () => {
    expect(forgottenReason(base, now)).toBe('You starred this 6 years ago — still actively maintained.')
    expect(forgottenReason({ ...base, archived: true }, now)).toContain('archived')
  })
})
