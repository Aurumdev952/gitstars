import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildGalaxyIndex } from './load'
import { memberGroups } from './members'
import type { GalaxyData } from './schema'

const fixture: GalaxyData = JSON.parse(readFileSync(fileURLToPath(new URL('../../public/data/fixture/galaxy.json', import.meta.url)), 'utf8'))
const g = buildGalaxyIndex(fixture)
const outlier = (i: number) => fixture.repos[i]!.outlier

describe('memberGroups', () => {
  const withOutliers = g.systems.filter((s) => s.members.some(outlier) && !s.members.every(outlier))

  it('has systems with both kinds of member to test against', () => {
    expect(withOutliers.length).toBeGreaterThan(0)
  })

  it('keeps outliers out of the brightest-members sample and lists them as loosely related', () => {
    for (const s of withOutliers) {
      const { core, loose } = memberGroups(s, g.repos, null)
      expect(core.some(outlier)).toBe(false)
      expect(loose.length).toBeGreaterThan(0)
      expect(loose.every(outlier)).toBe(true)
      expect([...core, ...loose].sort((a, b) => a - b)).toEqual([...s.members].sort((a, b) => a - b))
    }
  })

  it('orders each group brightest first and drops filtered-out members', () => {
    const s = withOutliers[0]!
    const visible = new Uint8Array(g.n).fill(1)
    const hidden = s.core[0]!
    visible[hidden] = 0
    const { core, loose } = memberGroups(s, g.repos, visible)
    expect(core).not.toContain(hidden)
    for (const list of [core, loose]) for (let k = 1; k < list.length; k++) expect(g.repos[list[k - 1]!]!.stars).toBeGreaterThanOrEqual(g.repos[list[k]!]!.stars)
  })

  it('keeps outliers out of system label anchoring', () => {
    for (const s of withOutliers) expect(s.core.some(outlier)).toBe(false)
  })
})
