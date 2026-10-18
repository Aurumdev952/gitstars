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

  it('lists every member as loosely related when all of them are outliers', () => {
    const repos = [{ stars: 1, outlier: true }, { stars: 2, outlier: true }]
    expect(memberGroups({ members: [0, 1] }, repos, null)).toEqual({ core: [], loose: [1, 0] })
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

  it('keeps an outlier from moving its system label or extent, wherever it sits', () => {
    const s = g.systems.find((x) => x.core.length >= 5)!
    const moved: GalaxyData = structuredClone(fixture)
    const i = s.core[0]!
    const at = (dx: number) => {
      moved.repos[i] = { ...moved.repos[i]!, outlier: true, pos: [s.anchor[0] + dx, s.anchor[1], s.anchor[2]] }
      return buildGalaxyIndex(moved).systems[s.index]!
    }
    const left = at(-0.3 * s.extent)
    const right = at(0.3 * s.extent)
    expect(left.core).not.toContain(i)
    expect(right.anchor).toEqual(left.anchor)
    expect(right.extent).toBe(left.extent)
  })
})
