import { describe, expect, it } from 'vitest'
import { fixtureGalaxy as g } from '#/test/fixture'
import { buildLexDocs, fuseHits, matchClusters } from './search'
import { lensWeights } from './lens'

describe('fuseHits', () => {
  it('pins an exact owner/name match above everything else', () => {
    const target = g.repos[123]!.fullName
    const hits = fuseHits(g, target.toUpperCase(), [5, 6, 7], [8, 9, 123])
    expect(hits.idx[0]).toBe(123)
    expect(hits.frame).toContain(123)
  })

  it('upgrades from lexical-only once semantic results arrive', () => {
    const lexOnly = fuseHits(g, 'olap', [1, 2, 3], null)
    expect(lexOnly.lexicalOnly).toBe(true)
    expect(lexOnly.idx).toEqual([1, 2, 3])
    const both = fuseHits(g, 'olap', [1, 2, 3], [3, 4])
    expect(both.lexicalOnly).toBe(false)
    expect(both.idx[0]).toBe(3)
    expect(both.idx).toContain(4)
  })

  it('frames only the hits close to the best score, at most 12', () => {
    const many = Array.from({ length: 30 }, (_, i) => i)
    const hits = fuseHits(g, 'zzz', many, many)
    expect(hits.frame.length).toBeGreaterThan(0)
    expect(hits.frame.length).toBeLessThanOrEqual(12)
    const cut = hits.score[hits.frame.length]
    if (cut !== undefined) expect(cut).toBeLessThan(hits.score[0]! * 0.9)
  })
})

describe('matchClusters', () => {
  it('finds galaxies and systems by name prefix', () => {
    const c = g.galaxies[0]!
    const word = c.name.split(' ')[0]!.slice(0, 4)
    expect(matchClusters(g, word).map((m) => m.id)).toContain(c.id)
  })

  it('requires every word to match', () => {
    expect(matchClusters(g, 'qqqq')).toEqual([])
  })
})

describe('buildLexDocs', () => {
  it('splits owner and name and carries the cluster names for lexical recall', () => {
    const d = buildLexDocs(g)[0]!
    const r = g.repos[0]!
    expect(`${d.owner}/${d.name}`).toBe(r.fullName)
    expect(d.meta).toContain(g.systems[g.systemOf[0]!]!.name)
  })
})

describe('lensWeights', () => {
  it('maps the median to 0 and the top to 1, preserving order', () => {
    const scores = Float32Array.from({ length: 1000 }, (_, i) => i / 1000)
    const w = lensWeights(scores)
    expect(w[0]).toBe(0)
    expect(w[499]).toBe(0)
    expect(w[999]).toBe(1)
    expect(w[700]!).toBeGreaterThan(0)
    expect(w[700]!).toBeLessThan(w[900]!)
  })
})
