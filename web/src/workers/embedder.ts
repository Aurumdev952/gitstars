export type Device = 'webgpu' | 'wasm'

export type ModelProgress = { loaded: number; total: number; device: Device }

// ORT-web's WASM backend has no GatherBlockQuantized kernel, which the q8 and q4 exports use for
// their embedding table, so the WASM fallback runs fp16 (cosine 0.9998 vs fp32 per the model card).
export const DTYPE = { webgpu: 'q8', wasm: 'fp16' } as const

/** Where `bun run models:fetch` puts the model and ORT's wasm, relative to `public/` and the base URL. */
export const VENDORED = { models: 'models/', ort: 'models/ort/' } as const

/** The file-name suffix transformers.js gives each dtype's ONNX export. */
const DTYPE_SUFFIX = { q8: '_quantized', fp16: '_fp16' } as const satisfies Record<(typeof DTYPE)[Device], string>

/**
 * The files `bun run models:fetch` resolves for the text tower, without the `*.onnx_data` external
 * data each ONNX file names, which the downloader adds from the Hub listing.
 */
export function modelFiles(): string[] {
  const onnx = [...new Set(Object.values(DTYPE))].map((d) => `onnx/model${DTYPE_SUFFIX[d]}.onnx`)
  return ['config.json', 'tokenizer.json', 'tokenizer_config.json', ...onnx]
}

/** The two ORT-web builds transformers.js picks between: asyncify, or plain on Safari < 26 without WebGPU. */
export const ORT_RUNTIMES = ['ort-wasm-simd-threaded.asyncify', 'ort-wasm-simd-threaded'] as const

/** Drops the vision and audio towers, so transformers.js resolves and loads only the text model. */
export function textOnly<C>(config: C): C {
  const c = config as Record<string, unknown>
  c.vision_config = null
  c.audio_config = null
  return config
}

export type Embedder = {
  device: Device
  /** Unit vectors of length `dim`, one per text, row-major. */
  embed(texts: string[]): Promise<Float32Array>
}

/**
 * Loads only the text tower of the browser model and returns MRL-truncated, renormalized
 * embeddings. The feature-extraction pipeline would also download the vision and audio encoders
 * (about 535 MB at q8) that text search never uses, so this goes through AutoModel with those
 * configs removed and reads its pooled `sentence_embedding` output.
 */
export async function loadEmbedder(
  model: string,
  dim: number,
  assetBase: string,
  onProgress: (p: ModelProgress) => void,
): Promise<Embedder> {
  const tf = await import('@huggingface/transformers')
  await preferVendored(tf, model, assetBase)
  const gpu = (globalThis.navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu
  const adapter = gpu ? await gpu.requestAdapter().catch(() => null) : null
  const devices: Device[] = adapter ? ['webgpu', 'wasm'] : ['wasm']

  let lastError: unknown
  for (const device of devices) {
    try {
      const files = new Map<string, { loaded: number; total: number }>()
      const progress_callback = (e: { status: string; file?: string; loaded?: number; total?: number }) => {
        if (e.status !== 'progress' || !e.file) return
        files.set(e.file, { loaded: e.loaded ?? 0, total: e.total ?? 0 })
        let loaded = 0
        let total = 0
        for (const f of files.values()) {
          loaded += f.loaded
          total += f.total
        }
        onProgress({ loaded, total, device })
      }
      const config = textOnly(await tf.AutoConfig.from_pretrained(model))
      const [tokenizer, net] = await Promise.all([
        tf.AutoTokenizer.from_pretrained(model),
        tf.AutoModel.from_pretrained(model, { config, device, dtype: DTYPE[device], progress_callback }),
      ])
      const embed = async (texts: string[]) => {
        const inputs = await tokenizer(texts, { padding: true, truncation: true })
        const out = (await net(inputs)) as { sentence_embedding: { data: Float32Array; dims: number[] } }
        return truncateNormalize(out.sentence_embedding.data, out.sentence_embedding.dims[1]!, dim)
      }
      // Compiles the WebGPU kernels now, so a backend that loads but cannot run falls back here.
      await embed(['warmup'])
      return { device, embed }
    } catch (err) {
      lastError = err
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

const STAND_IN = 'https://vendored.invalid/'

/**
 * Points transformers.js and ORT at `models/` under `assetBase` (`public/` on the web, the app data
 * dir on the desktop) when the model is vendored there, so nothing goes to the Hub or the jsDelivr
 * CDN; otherwise leaves the remote defaults alone.
 */
async function preferVendored(tf: typeof import('@huggingface/transformers'), model: string, assetBase: string): Promise<void> {
  const base = new URL(assetBase, globalThis.location.href)
  // fetch-model.ts writes config.json last, so a readable one means every file is complete. Parsing
  // it rules out an SPA fallback that answers any path with index.html.
  const res = await fetch(new URL(`${VENDORED.models}${model}/config.json`, base)).catch(() => null)
  const vendored = res?.ok && (await res.json().then(() => true, () => false))
  if (!vendored) return
  // The vendored files stand in for the Hub instead of going through localModelPath. For local
  // files transformers.js reads sizes with a full GET whose body it never drains, which holds
  // Chrome's HTTP cache lock on the weights and stalls the real download until the lock times out
  // (about 20 s). The remote path reads sizes with a one-byte Range request.
  tf.env.allowLocalModels = false
  tf.env.allowRemoteModels = true
  tf.env.remoteHost = new URL(VENDORED.models, base).href
  tf.env.remotePathTemplate = '{model}/'
  // transformers.js treats only http(s) hosts as remote: on the desktop app's gs:// it skips the
  // size probes and decides there is no tokenizer. It sees a stand-in https origin instead, and
  // its fetch maps that back. The files are already on disk, so they skip the browser cache too.
  if (!/^https?:$/.test(base.protocol)) {
    const fetchVia = tf.env.fetch
    tf.env.useBrowserCache = false
    tf.env.remoteHost = new URL(VENDORED.models, STAND_IN).href
    tf.env.fetch = (input, init) => fetchVia(String(input).replace(STAND_IN, base.href), init)
  }
  const paths = tf.env.backends.onnx.wasm?.wasmPaths
  // transformers.js has already chosen its build and set CDN URLs; keep the file names, swap the host.
  if (paths && typeof paths === 'object') {
    for (const k of ['mjs', 'wasm'] as const) {
      const name = paths[k]?.toString().split('/').pop()
      if (name) paths[k] = new URL(`${VENDORED.ort}${name}`, base).href
    }
  }
}

/** Keeps the leading `dim` of each `width`-wide row and L2-normalizes it (Matryoshka truncation). */
export function truncateNormalize(data: ArrayLike<number>, width: number, dim: number): Float32Array {
  const rows = Math.floor(data.length / width)
  const out = new Float32Array(rows * dim)
  for (let r = 0; r < rows; r++) {
    let norm = 0
    for (let k = 0; k < dim; k++) {
      const x = data[r * width + k]!
      out[r * dim + k] = x
      norm += x * x
    }
    const inv = norm > 0 ? 1 / Math.sqrt(norm) : 0
    for (let k = 0; k < dim; k++) out[r * dim + k] = out[r * dim + k]! * inv
  }
  return out
}
