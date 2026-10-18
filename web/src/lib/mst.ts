/** Union-find over 0..n-1 with path halving. */
class DisjointSet {
  private parent: Int32Array
  constructor(n: number) {
    this.parent = Int32Array.from({ length: n }, (_, i) => i)
  }
  find(i: number): number {
    const p = this.parent
    while (p[i] !== i) {
      p[i] = p[p[i]!]!
      i = p[i]!
    }
    return i
  }
  union(a: number, b: number): boolean {
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra === rb) return false
    this.parent[ra] = rb
    return true
  }
}

export type Neighbors = readonly (readonly [number, number])[]

/**
 * The constellation of one system: the minimum spanning tree of its kNN graph restricted to its
 * members (Kruskal on 1 − cosine), as pairs of global star indices. kNN graphs of a cluster are
 * often disconnected, so the remaining components are joined by their nearest pair of stars in 3D,
 * again cheapest first, which keeps the drawing a single tree of short, plausible strokes.
 */
export function systemMst(members: readonly number[], neighborsOf: (i: number) => Neighbors, pos: ArrayLike<number>): [number, number][] {
  const m = members.length
  if (m < 2) return []
  const local = new Map(members.map((g, k) => [g, k]))
  const edges: { a: number; b: number; w: number }[] = []
  members.forEach((g, a) => {
    for (const [j, cos] of neighborsOf(g)) {
      const b = local.get(j)
      // Each undirected edge once; kNN lists are not symmetric, so keep whichever side lists it.
      if (b === undefined || b === a) continue
      edges.push({ a: Math.min(a, b), b: Math.max(a, b), w: 1 - cos })
    }
  })
  edges.sort((x, y) => x.w - y.w || x.a - y.a || x.b - y.b)
  const set = new DisjointSet(m)
  const out: [number, number][] = []
  for (const e of edges) if (set.union(e.a, e.b)) out.push([members[e.a]!, members[e.b]!])
  if (out.length === m - 1) return out

  // Bridge components: the closest pair of stars between every two components, then Kruskal again.
  const comp = new Map<number, number>()
  const compOf = members.map((_, k) => {
    const r = set.find(k)
    if (!comp.has(r)) comp.set(r, comp.size)
    return comp.get(r)!
  })
  const c = comp.size
  const best = new Map<number, { a: number; b: number; d: number }>()
  const d2 = (a: number, b: number) => {
    const ga = members[a]! * 3
    const gb = members[b]! * 3
    return (pos[ga]! - pos[gb]!) ** 2 + (pos[ga + 1]! - pos[gb + 1]!) ** 2 + (pos[ga + 2]! - pos[gb + 2]!) ** 2
  }
  for (let a = 0; a < m; a++)
    for (let b = a + 1; b < m; b++) {
      const ca = compOf[a]!
      const cb = compOf[b]!
      if (ca === cb) continue
      const key = Math.min(ca, cb) * c + Math.max(ca, cb)
      const d = d2(a, b)
      const cur = best.get(key)
      if (!cur || d < cur.d) best.set(key, { a, b, d })
    }
  const bridges = [...best.values()].sort((x, y) => x.d - y.d)
  for (const e of bridges) if (set.union(e.a, e.b)) out.push([members[e.a]!, members[e.b]!])
  return out
}
