import * as Comlink from 'comlink'
import type { GalaxyIndex } from '#/lib/load'
import { buildLexDocs, fuseHits, MAX_HITS } from '#/lib/search'
import { lensWeights } from '#/lib/lens'
import { useGalaxyStore } from '#/state/store'
import type { ProbeResult, SearchApi } from './search.worker'
import type { ModelProgress } from './embedder'

type Session = { galaxy: GalaxyIndex; worker: Worker; api: Comlink.Remote<SearchApi>; ready: Promise<void> }

let session: Session | null = null
let querySeq = 0
let lensSeq = 0

function open(g: GalaxyIndex): Session {
  if (session?.galaxy === g) return session
  session?.worker.terminate()
  const worker = new Worker(new URL('./search.worker.ts', import.meta.url), { type: 'module', name: 'search' })
  const api = Comlink.wrap<SearchApi>(worker)
  const { embedding, searchProbes } = g.data.meta
  const ready = api.init({
    vectorsUrl: g.vectorsUrl,
    n: g.n,
    dim: embedding.dims,
    model: embedding.browserModel,
    queryPrefix: embedding.queryPrefix,
    docs: buildLexDocs(g),
    probes: searchProbes,
  })
  session = { galaxy: g, worker, api, ready }
  const { setModel } = useGalaxyStore.getState().actions
  setModel({ state: 'idle' })
  ready.catch((err: unknown) => setModel({ state: 'error', message: `vectors failed to load: ${message(err)}` }))
  return session
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err))

/** Starts the model download once; later calls are no-ops while it loads or after it is ready. */
export function warmModel() {
  const s = useGalaxyStore.getState()
  if (!s.galaxy || s.model.state === 'loading' || s.model.state === 'ready') return
  const sess = open(s.galaxy)
  const { setModel } = s.actions
  setModel({ state: 'loading', progress: 0, device: null })
  const onProgress = Comlink.proxy((p: ModelProgress) => {
    if (session !== sess) return
    setModel({ state: 'loading', progress: p.total > 0 ? p.loaded / p.total : 0, device: p.device })
  })
  void sess.ready
    .then(() => sess.api.warm(onProgress))
    .then(({ device }) => session === sess && setModel({ state: 'ready', device }))
    .catch((err: unknown) => session === sess && setModel({ state: 'error', message: message(err) }))
}

async function runQuery(g: GalaxyIndex, query: string | null, modelReady: boolean) {
  const seq = ++querySeq
  const { setHits } = useGalaxyStore.getState().actions
  if (!query) return setHits(null)
  const sess = open(g)
  await sess.ready
  const lexical = await sess.api.lexical(query, MAX_HITS)
  if (seq !== querySeq) return
  setHits(fuseHits(g, query, lexical.idx, null))
  if (!modelReady) return
  const semantic = await sess.api.semantic(query, MAX_HITS)
  if (seq !== querySeq) return
  setHits(fuseHits(g, query, lexical.idx, semantic.idx))
}

async function runLens(g: GalaxyIndex, query: string | null) {
  const seq = ++lensSeq
  const { setLensState } = useGalaxyStore.getState().actions
  if (!query) return setLensState({ state: 'off' })
  const model = useGalaxyStore.getState().model
  if (model.state === 'error') return setLensState({ state: 'error', query, message: model.message })
  setLensState({ state: 'pending', query })
  if (model.state !== 'ready') return warmModel()
  try {
    const sess = open(g)
    await sess.ready
    const scores = await sess.api.lens(query)
    if (seq === lensSeq) setLensState({ state: 'ready', query, weights: lensWeights(scores) })
  } catch (err) {
    if (seq === lensSeq) setLensState({ state: 'error', query, message: message(err) })
  }
}

/**
 * Keeps hits and the lens in step with the URL-mirrored query and lens, re-running both once the
 * model becomes ready so lexical-only results upgrade in place.
 */
export function startSearchRunner(): () => void {
  const store = useGalaxyStore
  const offQuery = store.subscribe(
    (s) => [s.galaxy, s.query, s.model.state === 'ready'] as const,
    ([g, q, ready]) => g && void runQuery(g, q, ready),
    { equalityFn: (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2], fireImmediately: true },
  )
  const offLens = store.subscribe(
    (s) => [s.galaxy, s.lensQuery, s.model.state] as const,
    ([g, q]) => g && void runLens(g, q),
    { equalityFn: (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2], fireImmediately: true },
  )
  return () => {
    offQuery()
    offLens()
  }
}

export async function similarTo(i: number, k = 12) {
  const g = useGalaxyStore.getState().galaxy
  if (!g) return null
  const sess = open(g)
  await sess.ready
  return sess.api.similarTo(i, k)
}

export async function probeSearch(): Promise<ProbeResult | null> {
  const g = useGalaxyStore.getState().galaxy
  if (!g) return null
  warmModel()
  const sess = open(g)
  await sess.ready
  return sess.api.probe()
}

/** Wall-clock cost of one hybrid query, for the debug hooks. Repeat queries hit the embedding cache. */
export async function timeQuery(query: string) {
  const g = useGalaxyStore.getState().galaxy
  if (!g) return null
  const sess = open(g)
  await sess.ready
  const t0 = performance.now()
  const lexical = await sess.api.lexical(query, MAX_HITS)
  const t1 = performance.now()
  const ready = useGalaxyStore.getState().model.state === 'ready'
  const semantic = ready ? await sess.api.semantic(query, MAX_HITS) : null
  const t2 = performance.now()
  return { lexicalMs: t1 - t0, semanticMs: semantic ? t2 - t1 : null, hits: fuseHits(g, query, lexical.idx, semantic?.idx ?? null).idx.slice(0, 10) }
}
