import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildGalaxyIndex, GalaxyLoadError, resolveDataSource, spatialNeighbors } from './load'
import type { GalaxyData } from './schema'

const fixture: GalaxyData = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../public/data/fixture/galaxy.json', import.meta.url)), 'utf8'),
)

describe('buildGalaxyIndex', () => {
  const g = buildGalaxyIndex(fixture)

  it('indexes every repo by lower-cased full name', () => {
    const r = fixture.repos[42]!
    expect(g.byFullName.get(r.fullName.toLowerCase())).toBe(42)
  })

  it('pins every galaxy label on its own stars, in 3D and on the flat map', () => {
    const near = (c: (typeof g.galaxies)[number], p: readonly number[], pos: (r: GalaxyData['repos'][number]) => readonly number[]) =>
      Math.min(...c.members.map((m) => Math.hypot(...pos(fixture.repos[m]!).map((v, k) => v - (p[k] ?? 0)))))
    for (const c of g.galaxies) {
      expect(near(c, c.anchor, (r) => r.pos)).toBeLessThan(0.25 * c.extent)
      expect(near(c, c.anchor2, (r) => [r.pos2[0], r.pos2[1], 0])).toBeLessThan(0.25 * c.extent)
    }
  })

  it('maps each repo to its galaxy and system nodes', () => {
    fixture.repos.forEach((r, i) => {
      expect(g.galaxies[g.galaxyOf[i]!]!.id).toBe(r.galaxyId)
      expect(g.systems[g.systemOf[i]!]!.id).toBe(r.systemId)
    })
  })

  it('packs the layout and star attributes into typed arrays', () => {
    const i = 7
    expect(Array.from(g.attrs.pos.subarray(i * 3, i * 3 + 3))).toEqual(fixture.repos[i]!.pos.map(Math.fround))
    expect(g.attrs.pos2[i * 3 + 2]).toBe(0)
    for (const arr of [g.attrs.size, g.attrs.bright, g.attrs.seed, g.attrs.starred]) {
      expect(Math.min(...arr)).toBeGreaterThanOrEqual(0)
      expect(Math.max(...arr)).toBeLessThanOrEqual(1)
    }
    expect(Math.min(...g.attrs.bright)).toBeGreaterThanOrEqual(0.55)
  })

  it('marks archived repos as dead stars with no activity', () => {
    const i = fixture.repos.findIndex((r) => r.archived)
    expect(g.attrs.meta[i * 4]).toBe(1)
    expect(g.attrs.meta[i * 4 + 1]).toBe(0)
  })

  it('gives the densest stars the highest density', () => {
    const order = [...g.attrs.density.keys()].sort((a, b) => g.attrs.density[b]! - g.attrs.density[a]!)
    expect(g.d8[order[0]!]!).toBeLessThan(g.d8[order[order.length - 1]!]!)
  })
})

describe('assertIntegrity', () => {
  const broken: [string, (d: GalaxyData) => void][] = [
    ['an unknown system id', (d) => (d.repos[3]!.systemId = 'g09.s09')],
    ['a galaxy id used as a system id', (d) => (d.repos[3]!.systemId = d.repos[3]!.galaxyId)],
    ['a neighbour index past the end', (d) => (d.repos[3]!.neighbors[0] = [d.repos.length, 0.9])],
    ['a cluster member past the end', (d) => d.clusters[0]!.members.push(d.repos.length)],
  ]
  it.each(broken)('rejects %s', (_name, mutate) => {
    const d = structuredClone(fixture)
    mutate(d)
    expect(() => buildGalaxyIndex(d)).toThrow(GalaxyLoadError)
  })
})

describe('spatialNeighbors', () => {
  it('matches brute force', () => {
    const n = 400
    const pos = new Float32Array(n * 3).map((_, i) => Math.sin(i * 12.9898) * 43758.5453 % 50)
    const { d8 } = spatialNeighbors(pos, n, 8)
    for (const i of [0, 17, 199, 399]) {
      const d = []
      for (let j = 0; j < n; j++) {
        if (j !== i) d.push(Math.hypot(pos[i * 3]! - pos[j * 3]!, pos[i * 3 + 1]! - pos[j * 3 + 1]!, pos[i * 3 + 2]! - pos[j * 3 + 2]!))
      }
      d.sort((a, b) => a - b)
      expect(d8[i]).toBeCloseTo(d[7]!, 3)
    }
  })
})

describe('resolveDataSource', () => {
  it('defaults to the real export and accepts named fixtures only', () => {
    expect(resolveDataSource(undefined).galaxyUrl).toBe('/data/galaxy.json')
    expect(resolveDataSource('fixture').galaxyUrl).toBe('/data/fixture/galaxy.json')
    expect(resolveDataSource('../secrets').galaxyUrl).toBe('/data/galaxy.json')
  })
})
