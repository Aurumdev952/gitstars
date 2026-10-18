import type { ClusterNode, GalaxyIndex } from './load'
import { rrf } from '#/workers/rank'

/** One searchable repo for the worker's lexical index. */
export type LexDoc = {
  id: number
  fullName: string
  name: string
  owner: string
  text: string
  tags: string
  meta: string
}

export type SearchHits = {
  query: string
  /** Star indices, best first. */
  idx: number[]
  score: number[]
  /** True until semantic results have been fused in. */
  lexicalOnly: boolean
  /** The leading hits worth framing together. */
  frame: number[]
}

const SEMANTIC_DEPTH = 24
export const MAX_HITS = 40
const FRAME_RATIO = 0.9
const FRAME_MAX = 12

/**
 * Hybrid ranking: lexical and semantic lists fused by RRF, with an exact `owner/name` match, then
 * exact repo-name matches, pinned on top.
 */
/** A keyword list that matched only some of the query's words counts for this much of a full one. */
const PARTIAL_LEXICAL_WEIGHT = 0.4

export function fuseHits(
  g: GalaxyIndex,
  query: string,
  lexical: ArrayLike<number>,
  semantic: ArrayLike<number> | null,
  opts: { partialLexical?: boolean } = {},
): SearchHits {
  const q = query.trim().toLowerCase()
  const pinned: number[] = []
  const exact = g.byFullName.get(q)
  if (exact !== undefined) pinned.push(exact)
  if (!q.includes('/')) {
    for (let r = 0; r < lexical.length; r++) {
      const i = lexical[r]!
      if (g.repos[i]!.fullName.toLowerCase().endsWith(`/${q}`)) pinned.push(i)
    }
  }
  const lists = semantic ? [lexical, Array.from(semantic).slice(0, SEMANTIC_DEPTH)] : [lexical]
  // A long natural-language query rarely matches every word; its OR fallback ("tools", "run") is
  // noise next to the semantic list, so it votes with less weight.
  const weights = [opts.partialLexical && semantic ? PARTIAL_LEXICAL_WEIGHT : 1, 1]
  const fused = rrf(lists, { pinned, limit: MAX_HITS, weights })
  const best = fused.score[0] ?? 0
  const frame: number[] = []
  for (let r = 0; r < fused.idx.length && frame.length < FRAME_MAX; r++) {
    if (fused.score[r]! < best * FRAME_RATIO) break
    frame.push(fused.idx[r]!)
  }
  return { query, idx: fused.idx, score: fused.score, lexicalOnly: semantic === null, frame }
}

/** Galaxies and systems whose name or keywords start with every query word. */
export function matchClusters(g: GalaxyIndex, query: string, limit = 5): ClusterNode[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return []
  const scored: [ClusterNode, number][] = []
  for (const c of [...g.galaxies, ...g.systems]) {
    const nameWords = c.name.toLowerCase().split(/[^\p{L}\p{N}]+/u)
    const keywords = c.keywords.map((k) => k.toLowerCase())
    let score = 0
    for (const w of words) {
      if (nameWords.some((n) => n.startsWith(w))) score += 2
      else if (keywords.some((k) => k.startsWith(w))) score += 1
      else {
        score = 0
        break
      }
    }
    if (score > 0) scored.push([c, score + (c.level === 0 ? 0.5 : 0)])
  }
  return scored
    .sort((a, b) => b[1] - a[1] || b[0].members.length - a[0].members.length)
    .slice(0, limit)
    .map(([c]) => c)
}

export function buildLexDocs(g: GalaxyIndex): LexDoc[] {
  return g.repos.map((r, id) => {
    const at = r.fullName.indexOf('/')
    const system = g.systems[g.systemOf[id]!]!
    const galaxy = g.galaxies[g.galaxyOf[id]!]!
    return {
      id,
      fullName: r.fullName,
      owner: r.fullName.slice(0, at),
      name: r.fullName.slice(at + 1),
      text: [r.oneLiner, r.description !== r.oneLiner ? r.description : null].filter(Boolean).join(' '),
      tags: [...r.tags, ...r.stack].join(' '),
      meta: [r.language, r.kind, r.domain, system.name, galaxy.name].filter(Boolean).join(' '),
    }
  })
}
