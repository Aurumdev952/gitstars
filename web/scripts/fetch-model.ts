#!/usr/bin/env bun
// Vendors the browser embedding model and ORT's wasm into public/models/ so search runs offline.
// bun scripts/fetch-model.ts [model-id]
import { copyFileSync, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { once } from 'node:events'
import { AutoConfig, ModelRegistry } from '@huggingface/transformers'
import { DTYPE, ORT_RUNTIMES, VENDORED, textOnly, type Device } from '../src/workers/embedder'

const model = process.argv[2] ?? 'onnx-community/embeddinggemma-2-ONNX'
const publicDir = join(import.meta.dirname, '..', 'public')
const modelDir = join(publicDir, VENDORED.models, model)
const ortDir = join(publicDir, VENDORED.ort)

const mb = (bytes: number) => (bytes < 2 ** 20 ? `${(bytes / 2 ** 10).toFixed(1).padStart(8)} KB` : `${(bytes / 2 ** 20).toFixed(1).padStart(8)} MB`)
const sizeOf = (path: string) => (existsSync(path) ? statSync(path).size : -1)
const report: { file: string; bytes: number; how: string }[] = []

function hfCacheSnapshot(id: string): string | null {
  const hub = process.env.HF_HUB_CACHE ?? join(process.env.HF_HOME ?? join(homedir(), '.cache', 'huggingface'), 'hub')
  const repo = join(hub, `models--${id.replaceAll('/', '--')}`)
  const ref = join(repo, 'refs', 'main')
  return existsSync(ref) ? join(repo, 'snapshots', readFileSync(ref, 'utf8').trim()) : null
}

async function remoteSizes(id: string): Promise<Map<string, number>> {
  const res = await fetch(`https://huggingface.co/api/models/${id}/tree/main?recursive=true`)
  if (!res.ok) throw new Error(`listing ${id} returned ${res.status}`)
  const entries = (await res.json()) as { type: string; path: string; size: number }[]
  return new Map(entries.filter((e) => e.type === 'file').map((e) => [e.path, e.size]))
}

async function download(url: string, dest: string, size: number) {
  const part = `${dest}.part`
  if (sizeOf(part) > size) rmSync(part)
  let have = Math.max(0, sizeOf(part))
  if (have < size) {
    const res = await fetch(url, { headers: have > 0 ? { Range: `bytes=${have}-` } : {} })
    if (!res.ok || !res.body) throw new Error(`${url} returned ${res.status}`)
    // A server that ignores Range answers 200 with the whole file, so start the part file over.
    if (res.status !== 206) have = 0
    else console.log(`  resuming ${basename(dest)} at ${mb(have)}`)
    const out = createWriteStream(part, { flags: have > 0 ? 'a' : 'w' })
    let shown = have
    for await (const chunk of res.body) {
      if (!out.write(chunk)) await once(out, 'drain')
      have += chunk.byteLength
      if (have - shown > 64 * 2 ** 20 || have === size) {
        shown = have
        process.stdout.write(`\r  ${basename(dest)} ${mb(have)} / ${mb(size)}`)
      }
    }
    out.end()
    await once(out, 'close')
    process.stdout.write('\n')
  }
  if (sizeOf(part) !== size) throw new Error(`${basename(dest)} is ${sizeOf(part)} bytes, expected ${size}; rerun to resume`)
  renameSync(part, dest)
}

async function vendor(file: string, sizes: Map<string, number>, snapshot: string | null) {
  const size = sizes.get(file)
  if (size === undefined) throw new Error(`${model} has no ${file}`)
  const dest = join(modelDir, file)
  mkdirSync(dirname(dest), { recursive: true })
  if (sizeOf(dest) === size) return report.push({ file, bytes: size, how: 'present' })
  const cached = snapshot && join(snapshot, file)
  if (cached && sizeOf(cached) === size) {
    copyFileSync(cached, dest)
    return report.push({ file, bytes: size, how: 'copied from HF cache' })
  }
  await download(`https://huggingface.co/${model}/resolve/main/${file}`, dest, size)
  report.push({ file, bytes: size, how: 'downloaded' })
}

mkdirSync(ortDir, { recursive: true })
const transformersRequire = createRequire(createRequire(import.meta.url).resolve('@huggingface/transformers'))
for (const runtime of ORT_RUNTIMES) {
  for (const ext of ['mjs', 'wasm']) {
    const name = `${runtime}.${ext}`
    const src = transformersRequire.resolve(`onnxruntime-web/${name}`)
    const dest = join(ortDir, name)
    const fresh = existsSync(dest) && readFileSync(dest).equals(readFileSync(src))
    if (!fresh) copyFileSync(src, dest)
    report.push({ file: `ort/${name}`, bytes: sizeOf(dest), how: fresh ? 'present' : 'copied from onnxruntime-web' })
  }
}

// The same file resolution transformers.js runs in the worker, for the same text-only config.
const config = textOnly(await AutoConfig.from_pretrained(model))
const files = new Set<string>()
for (const device of Object.keys(DTYPE) as Device[]) {
  for (const f of await ModelRegistry.get_files(model, { config, device, dtype: DTYPE[device], include_processor: false })) files.add(f)
}

const sizes = await remoteSizes(model)
const snapshot = hfCacheSnapshot(model)
// The worker treats a readable config.json as "every file is here", so it lands last.
const ordered = [...files].filter((f) => f !== 'config.json').concat('config.json')
if (ordered.some((f) => sizeOf(join(modelDir, f)) !== sizes.get(f))) rmSync(join(modelDir, 'config.json'), { force: true })
for (const file of ordered) await vendor(file, sizes, snapshot)

for (const r of report) console.log(`${mb(r.bytes)}  ${r.file}  (${r.how})`)
console.log(`${mb(report.reduce((s, r) => s + r.bytes, 0))}  total in ${join(publicDir, VENDORED.models)}`)
