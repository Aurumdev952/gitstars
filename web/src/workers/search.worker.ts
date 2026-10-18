import * as Comlink from 'comlink'
import MiniSearch from 'minisearch'
import { loadEmbedder, type Device, type Embedder, type ModelProgress } from './embedder'
import type { LexDoc } from '#/lib/search'
import { EMPTY_RANKED, cosineAll, overlapAt10, topK, type LexicalRanked, type Ranked } from './rank'

export type InitOptions = {
  vectorsUrl: string
  n: number
  dim: number
  model: string
  queryPrefix: string
  docs: LexDoc[]
  probes: { query: string; topIdx: number[] }[]
}

export type ProbeResult = { overlapAt10: number; perQuery: { query: string; overlap: number }[]; msPerQuery: number; device: Device }

const QUERY_CACHE = 64

let opts: InitOptions | null = null
let lexIndex: MiniSearch<LexDoc> | null = null
let vectors: Float32Array | null = null
let embedder: Promise<Embedder> | null = null
let ready: Embedder | null = null
const queryCache = new Map<string, Float32Array>()

/** Splits identifiers so "react-three-fiber" and "ReactThreeFiber" both match "three". */
function tokenize(text: string): string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^\p{L}\p{N}+#]+/u)
    .filter(Boolean)
}

async function decodeVectors(url: string, n: number, dim: number): Promise<Float32Array> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url} returned ${res.status}`)
  const buf = await res.arrayBuffer()
  if (buf.byteLength !== n * dim * 2) throw new Error(`${url} has ${buf.byteLength} bytes, expected ${n * dim * 2}`)
  const F16 = (globalThis as { Float16Array?: new (b: ArrayBuffer) => ArrayLike<number> }).Float16Array
  if (F16) return Float32Array.from(new F16(buf))
  const u16 = new Uint16Array(buf)
  const out = new Float32Array(u16.length)
  for (let i = 0; i < u16.length; i++) out[i] = halfToFloat(u16[i]!)
  return out
}

function halfToFloat(h: number): number {
  const s = h & 0x8000 ? -1 : 1
  const e = (h >> 10) & 0x1f
  const f = h & 0x3ff
  if (e === 0) return s * 2 ** -14 * (f / 1024)
  if (e === 31) return f ? NaN : s * Infinity
  return s * 2 ** (e - 15) * (1 + f / 1024)
}

function loadedModel(): Promise<Embedder> {
  if (ready) return Promise.resolve(ready)
  return embedder ?? Promise.reject(new Error('model not loaded'))
}

async function embedQuery(text: string): Promise<Float32Array> {
  const e = await loadedModel()
  // Keyed on the exact text: the model is case-sensitive, so "React" and "react" embed differently.
  const key = text.trim()
  const hit = queryCache.get(key)
  if (hit) {
    queryCache.delete(key)
    queryCache.set(key, hit)
    return hit
  }
  const v = await e.embed([opts!.queryPrefix + text.trim()])
  queryCache.set(key, v)
  if (queryCache.size > QUERY_CACHE) queryCache.delete(queryCache.keys().next().value!)
  return v
}

const api = {
  /** Builds the keyword index; keyword search works from here on, whatever happens to the vectors. */
  init(o: InitOptions): void {
    opts = o
    const index = new MiniSearch<LexDoc>({
      fields: ['fullName', 'name', 'owner', 'text', 'tags', 'meta'],
      tokenize,
      searchOptions: {
        boost: { name: 4, fullName: 3, tags: 2, text: 1.2, owner: 1.5, meta: 0.8 },
        prefix: true,
        fuzzy: (term) => (term.length > 4 ? 0.2 : false),
        combineWith: 'AND',
      },
    })
    index.addAll(o.docs)
    lexIndex = index
  },

  /** Fetches the embedding matrix; safe to call again after a failure. */
  async loadVectors(): Promise<void> {
    if (!opts) throw new Error('search worker used before init')
    vectors ??= await decodeVectors(opts.vectorsUrl, opts.n, opts.dim)
  },

  /** Idempotent: a second call joins the first load. */
  warm(onProgress: (p: ModelProgress) => void): Promise<{ device: Device }> {
    if (!opts) return Promise.reject(new Error('search worker used before init'))
    embedder ??= loadEmbedder(opts.model, opts.dim, onProgress).then((e) => {
      ready = e
      return e
    })
    embedder.catch(() => (embedder = null))
    return embedder.then((e) => ({ device: e.device }))
  },

  lexical(text: string, k: number): LexicalRanked {
    if (!lexIndex || !text.trim()) return { ...EMPTY_RANKED, partial: false }
    let hits = lexIndex.search(text)
    const partial = hits.length === 0
    if (partial) hits = lexIndex.search(text, { combineWith: 'OR' })
    hits = hits.slice(0, k)
    return { idx: Int32Array.from(hits, (h) => h.id as number), score: Float32Array.from(hits, (h) => h.score), partial }
  },

  async semantic(text: string, k: number): Promise<Ranked> {
    if (!vectors || !opts || !text.trim()) return EMPTY_RANKED
    const q = await embedQuery(text)
    const r = topK(cosineAll(vectors, opts.dim, q), k)
    return Comlink.transfer(r, [r.idx.buffer, r.score.buffer])
  },

  similarTo(i: number, k: number): Ranked {
    if (!vectors || !opts) return EMPTY_RANKED
    const q = vectors.subarray(i * opts.dim, (i + 1) * opts.dim)
    return topK(cosineAll(vectors, opts.dim, q), k, i)
  },

  /** Cosine of every star against the query; the caller normalizes for display. */
  async lens(text: string): Promise<Float32Array> {
    if (!vectors || !opts) return new Float32Array(0)
    const scores = cosineAll(vectors, opts.dim, await embedQuery(text))
    return Comlink.transfer(scores, [scores.buffer])
  },

  /** Ranks the export's golden queries with the browser model and compares against the pipeline's top 10. */
  async probe(): Promise<ProbeResult> {
    if (!vectors || !opts) throw new Error('search worker used before init')
    await api.warm(() => {})
    const e = await loadedModel()
    const t0 = performance.now()
    const actual: Int32Array[] = []
    for (const p of opts.probes) {
      const v = await e.embed([opts.queryPrefix + p.query])
      actual.push(topK(cosineAll(vectors, opts.dim, v), 10).idx)
    }
    const msPerQuery = (performance.now() - t0) / Math.max(1, opts.probes.length)
    const expected = opts.probes.map((p) => p.topIdx)
    return {
      overlapAt10: overlapAt10(expected, actual),
      perQuery: opts.probes.map((p, q) => ({ query: p.query, overlap: overlapAt10([p.topIdx], [actual[q]!]) })),
      msPerQuery,
      device: e.device,
    }
  },
}

export type SearchApi = typeof api

Comlink.expose(api)
