import { describe, expect, it } from 'vitest'
import { cosineAll, overlapAt10, rrf, topK } from './rank'

describe('topK', () => {
  it('returns the k best indices in descending score order', () => {
    const r = topK([0.1, 0.9, 0.3, 0.7, 0.5], 3)
    expect(Array.from(r.idx)).toEqual([1, 3, 4])
    expect(Array.from(r.score)).toEqual([0.9, 0.7, 0.5].map(Math.fround))
  })

  it('skips the excluded index and caps k at the population', () => {
    expect(Array.from(topK([1, 0.5, 0.2], 5, 0).idx)).toEqual([1, 2])
  })
})

describe('cosineAll', () => {
  it('dots the query with every row', () => {
    const m = new Float32Array([1, 0, 0, 1, 0.6, 0.8])
    expect(Array.from(cosineAll(m, 2, new Float32Array([0, 1])))).toEqual([0, 1, 0.8].map(Math.fround))
  })
})

describe('rrf', () => {
  it('sums 1/(k + rank) across lists', () => {
    const f = rrf([[5, 6], [6, 7]], { k: 60 })
    expect(f.idx).toEqual([6, 5, 7])
    expect(f.score[0]).toBeCloseTo(1 / 62 + 1 / 61)
    expect(f.score[1]).toBeCloseTo(1 / 61)
    expect(f.score[2]).toBeCloseTo(1 / 62)
  })

  it('ranks an item both lists agree on above one only a single list ranks first', () => {
    const f = rrf([[1, 2, 3], [9, 2, 8]])
    expect(f.idx[0]).toBe(2)
  })

  it('puts pinned items first even when the lists never mention them', () => {
    const f = rrf([[1, 2]], { pinned: [7, 2] })
    expect(f.idx).toEqual([7, 2, 1])
  })

  it('honours the limit', () => {
    expect(rrf([[1, 2, 3, 4]], { limit: 2 }).idx).toEqual([1, 2])
  })
})

describe('overlapAt10', () => {
  it('averages the shared fraction of each top 10', () => {
    const want = [Array.from({ length: 10 }, (_, i) => i), [1, 2]]
    const got = [Int32Array.from([0, 1, 2, 3, 4, 50, 51, 52, 53, 54]), Int32Array.from([2, 9])]
    expect(overlapAt10(want, got)).toBeCloseTo((0.5 + 0.5) / 2)
  })
})
