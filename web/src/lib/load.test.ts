import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildGalaxyIndex, resolveDataSource, spatialNeighbors } from './load'
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
