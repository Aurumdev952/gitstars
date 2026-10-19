#!/usr/bin/env bun
// Downloads the pinned uv release into src-tauri/binaries/uv-<target-triple>, the desktop app's
// sidecar for installing and running the pipeline. Checks the release's sha256 file.
// bun scripts/fetch-uv.ts [target-triple]
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const UV_VERSION = '0.12.5'

const triple = process.argv[2] ?? process.env.TAURI_ENV_TARGET_TRIPLE ?? hostTriple()
const windows = triple.includes('windows')
const binDir = join(import.meta.dirname, '..', 'src-tauri', 'binaries')
const dest = join(binDir, `uv-${triple}${windows ? '.exe' : ''}`)
const stamp = `${dest}.version`

function hostTriple(): string {
  const out = execFileSync('rustc', ['-vV'], { encoding: 'utf8' })
  const host = /^host: (\S+)$/m.exec(out)?.[1]
  if (!host) throw new Error('rustc -vV printed no host triple')
  return host
}

function find(dir: string, name: string): string | null {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) {
      const hit = find(p, name)
      if (hit) return hit
    } else if (entry === name) return p
  }
  return null
}

if (existsSync(dest) && existsSync(stamp) && readFileSync(stamp, 'utf8').trim() === UV_VERSION) {
  console.log(`uv ${UV_VERSION} already at ${dest}`)
  process.exit(0)
}

const asset = `uv-${triple}.${windows ? 'zip' : 'tar.gz'}`
const base = `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/${asset}`
const [archive, sums] = await Promise.all([fetch(base), fetch(`${base}.sha256`)])
if (!archive.ok) throw new Error(`${base} returned ${archive.status}`)
if (!sums.ok) throw new Error(`${base}.sha256 returned ${sums.status}`)
const bytes = Buffer.from(await archive.arrayBuffer())
const expected = (await sums.text()).trim().split(/\s+/)[0]
const actual = createHash('sha256').update(bytes).digest('hex')
if (actual !== expected) throw new Error(`${asset} has sha256 ${actual}, expected ${expected}`)

const work = mkdtempSync(join(tmpdir(), 'gitstars-uv-'))
try {
  const file = join(work, asset)
  writeFileSync(file, bytes)
  const out = join(work, 'out')
  mkdirSync(out)
  // bsdtar (macOS, Windows 10+) reads zip as well as tar.gz.
  execFileSync('tar', ['-xf', file, '-C', out])
  const uv = find(out, windows ? 'uv.exe' : 'uv')
  if (!uv) throw new Error(`${asset} has no uv binary`)
  mkdirSync(binDir, { recursive: true })
  copyFileSync(uv, dest)
  if (!windows) chmodSync(dest, 0o755)
  writeFileSync(stamp, `${UV_VERSION}\n`)
} finally {
  rmSync(work, { recursive: true, force: true })
}
console.log(`uv ${UV_VERSION} → ${dest}`)
