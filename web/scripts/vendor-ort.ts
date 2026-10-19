#!/usr/bin/env bun
// Copies ORT-web's two wasm builds (and their loaders) out of the onnxruntime-web that
// transformers.js depends on. fetch-model.ts uses it for public/models/ort/; the desktop build
// bundles them from src-tauri/resources/models/ort/.
// bun scripts/vendor-ort.ts [dest-dir]
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { ORT_RUNTIMES } from '../src/workers/embedder'

export function vendorOrt(dir: string): { file: string; bytes: number; how: string }[] {
  mkdirSync(dir, { recursive: true })
  const transformersRequire = createRequire(createRequire(import.meta.url).resolve('@huggingface/transformers'))
  const report = []
  for (const runtime of ORT_RUNTIMES) {
    for (const ext of ['mjs', 'wasm']) {
      const name = `${runtime}.${ext}`
      const src = transformersRequire.resolve(`onnxruntime-web/${name}`)
      const dest = join(dir, name)
      const fresh = existsSync(dest) && readFileSync(dest).equals(readFileSync(src))
      if (!fresh) copyFileSync(src, dest)
      report.push({ file: `ort/${name}`, bytes: statSync(dest).size, how: fresh ? 'present' : 'copied from onnxruntime-web' })
    }
  }
  return report
}

if (import.meta.main) {
  const dir = resolve(process.argv[2] ?? join(import.meta.dirname, '..', 'src-tauri', 'resources', 'models', 'ort'))
  for (const r of vendorOrt(dir)) console.log(`${r.file}  (${r.how})`)
}
