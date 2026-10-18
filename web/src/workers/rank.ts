export type Ranked = { idx: Int32Array; score: Float32Array }

export const EMPTY_RANKED: Ranked = { idx: new Int32Array(0), score: new Float32Array(0) }

/** Indices of the k largest scores, best first. Ties keep the lower index first. */
export function topK(scores: ArrayLike<number>, k: number, exclude = -1): Ranked {
  const want = Math.min(k, scores.length - (exclude >= 0 && exclude < scores.length ? 1 : 0))
  if (want <= 0) return EMPTY_RANKED
  const idx = new Int32Array(want).fill(-1)
  const score = new Float32Array(want).fill(-Infinity)
  for (let i = 0; i < scores.length; i++) {
    if (i === exclude) continue
    const s = scores[i]!
    if (s <= score[want - 1]!) continue
    let p = want - 1
    while (p > 0 && score[p - 1]! < s) {
      score[p] = score[p - 1]!
      idx[p] = idx[p - 1]!
      p--
    }
    score[p] = s
    idx[p] = i
  }
  return { idx, score }
}

/** Dot product of a query against every row of a row-major matrix of unit vectors (cosine). */
export function cosineAll(matrix: Float32Array, dim: number, query: Float32Array, out = new Float32Array(matrix.length / dim)) {
  const n = out.length
  for (let i = 0; i < n; i++) {
    let s = 0
    const o = i * dim
    for (let k = 0; k < dim; k++) s += matrix[o + k]! * query[k]!
    out[i] = s
  }
  return out
}

export const RRF_K = 60

export type Fused = { idx: number[]; score: number[] }

/**
 * Reciprocal rank fusion: each list contributes 1/(k + rank) per item, rank starting at 1.
 * `pinned` items go first in the order given, regardless of score.
 */
export function rrf(lists: readonly ArrayLike<number>[], opts: { k?: number; pinned?: readonly number[]; limit?: number } = {}): Fused {
  const k = opts.k ?? RRF_K
  const fused = new Map<number, number>()
  for (const list of lists) {
    for (let r = 0; r < list.length; r++) {
      const i = list[r]!
      fused.set(i, (fused.get(i) ?? 0) + 1 / (k + r + 1))
    }
  }
  const pinned = [...new Set(opts.pinned ?? [])]
  const pinnedSet = new Set(pinned)
  const rest = [...fused.entries()].filter(([i]) => !pinnedSet.has(i)).sort((a, b) => b[1] - a[1] || a[0] - b[0])
  const top = pinned.length > 0 ? Math.max(rest[0]?.[1] ?? 0, ...pinned.map((i) => fused.get(i) ?? 0)) : 0
  const ordered: [number, number][] = [...pinned.map((i): [number, number] => [i, top]), ...rest]
  const limited = ordered.slice(0, opts.limit ?? ordered.length)
  return { idx: limited.map(([i]) => i), score: limited.map(([, s]) => s) }
}

/** Mean fraction of each probe's expected top 10 found in the actual top 10. */
export function overlapAt10(expected: readonly (readonly number[])[], actual: readonly ArrayLike<number>[]): number {
  if (expected.length === 0) return 0
  let sum = 0
  expected.forEach((want, q) => {
    const got = new Set(Array.from(actual[q] ?? []).slice(0, 10))
    const top = want.slice(0, 10)
    if (top.length === 0) return
    sum += top.filter((i) => got.has(i)).length / top.length
  })
  return sum / expected.length
}
