import { describe, expect, it } from 'vitest'
import { systemMst, type Neighbors } from './mst'

function connected(members: number[], edges: [number, number][]) {
  const adj = new Map(members.map((m) => [m, [] as number[]]))
  for (const [a, b] of edges) {
    adj.get(a)!.push(b)
    adj.get(b)!.push(a)
  }
  const seen = new Set([members[0]])
  const stack = [members[0]!]
  while (stack.length) for (const n of adj.get(stack.pop()!)!) if (!seen.has(n)) (seen.add(n), stack.push(n))
  return seen.size === members.length
}

const key = ([a, b]: [number, number]) => `${Math.min(a, b)}-${Math.max(a, b)}`

describe('systemMst', () => {
  it('is a spanning tree that keeps the most similar kNN edges', () => {
    // Members 10..13 in a square; the 10-13 diagonal is the weakest link and must be dropped.
    const nb: Record<number, Neighbors> = {
      10: [[11, 0.9], [13, 0.2]],
      11: [[12, 0.8], [10, 0.9]],
      12: [[13, 0.85]],
      13: [[10, 0.2]],
    }
    const pos = new Float32Array(14 * 3)
    const edges = systemMst([10, 11, 12, 13], (i) => nb[i] ?? [], pos)
    expect(edges).toHaveLength(3)
    expect(connected([10, 11, 12, 13], edges)).toBe(true)
    expect(new Set(edges.map(key))).toEqual(new Set(['10-11', '12-13', '11-12']))
  })

  it('ignores neighbours outside the system', () => {
    const edges = systemMst([0, 1], (i) => (i === 0 ? [[5, 0.99], [1, 0.4]] : [[6, 0.95]]), new Float32Array(21))
    expect(edges.map(key)).toEqual(['0-1'])
  })

  it('joins disconnected kNN components by their nearest stars in 3D', () => {
    // Two pairs linked internally only; the closest cross pair is 1-2 (x = 1 and x = 3).
    const pos = new Float32Array([0, 0, 0, 1, 0, 0, 3, 0, 0, 9, 0, 0])
    const nb: Record<number, Neighbors> = { 0: [[1, 0.9]], 2: [[3, 0.9]] }
    const edges = systemMst([0, 1, 2, 3], (i) => nb[i] ?? [], pos)
    expect(edges).toHaveLength(3)
    expect(edges.map(key)).toContain('1-2')
    expect(connected([0, 1, 2, 3], edges)).toBe(true)
  })

  it('handles systems with no kNN edges at all, and trivial systems', () => {
    const pos = new Float32Array([0, 0, 0, 5, 0, 0, 1, 0, 0])
    const edges = systemMst([0, 1, 2], () => [], pos)
    expect(new Set(edges.map(key))).toEqual(new Set(['0-2', '1-2']))
    expect(systemMst([4], () => [], pos)).toEqual([])
    expect(systemMst([], () => [], pos)).toEqual([])
  })
})
