#!/usr/bin/env bun
// Synthetic galaxy export for building the UI without the pipeline.
// bun scripts/make-fixture.ts [--n 300] [--seed 7] [--out public/data/fixture]
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import type { GalaxyData, Kind, Repo, Cluster } from '../src/lib/schema'

const DIM = 256
const NEIGHBORS = 8

const { values } = parseArgs({
  options: {
    n: { type: 'string', default: '300' },
    seed: { type: 'string', default: '7' },
    out: { type: 'string' },
  },
})
const N = Number(values.n)
const out = values.out ?? (N === 300 ? 'public/data/fixture' : `public/data/fixture-${N}`)

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rand = mulberry32(Number(values.seed))
const gauss = () => {
  const u = 1 - rand()
  const v = rand()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!
const weighted = <T>(xs: readonly (readonly [T, number])[]): T => {
  const total = xs.reduce((s, [, w]) => s + w, 0)
  let r = rand() * total
  for (const [x, w] of xs) if ((r -= w) <= 0) return x
  return xs[xs.length - 1]![0]
}

type Theme = {
  name: string
  blurb: string
  keywords: string[]
  systems: { name: string; blurb: string; words: string[]; tags: string[] }[]
  langs: [string, number][]
  kinds: [Kind, number][]
}

const THEMES: Theme[] = [
  {
    name: 'Web Frameworks',
    blurb: 'Rendering, routing and the runtime glue of the modern web.',
    keywords: ['react', 'ssr', 'routing', 'components'],
    systems: [
      { name: 'React Ecosystem', blurb: 'Hooks, state and component kits.', words: ['hook', 'state', 'react', 'store', 'atom'], tags: ['react', 'state-management', 'hooks'] },
      { name: 'Meta Frameworks', blurb: 'Full-stack frameworks with SSR and file routing.', words: ['start', 'next', 'remix', 'astro', 'route'], tags: ['ssr', 'routing', 'full-stack'] },
      { name: 'CSS Tooling', blurb: 'Utility CSS, design tokens and styling engines.', words: ['tail', 'style', 'token', 'css', 'theme'], tags: ['css', 'design-tokens', 'styling'] },
      { name: 'Build Tools', blurb: 'Bundlers, dev servers and compilers for the web.', words: ['vite', 'pack', 'bundle', 'swc', 'turbo'], tags: ['bundler', 'build', 'compiler'] },
    ],
    langs: [['TypeScript', 7], ['JavaScript', 2], ['Rust', 1]],
    kinds: [['library', 5], ['framework', 3], ['tool', 2], ['template', 1]],
  },
  {
    name: 'Machine Learning',
    blurb: 'Training, serving and poking at models.',
    keywords: ['llm', 'inference', 'embeddings', 'training'],
    systems: [
      { name: 'LLM Inference', blurb: 'Fast local and server-side model serving.', words: ['llama', 'serve', 'infer', 'quant', 'gguf'], tags: ['llm', 'inference', 'gpu'] },
      { name: 'Agents & Tools', blurb: 'Tool-using agents and orchestration.', words: ['agent', 'chain', 'tool', 'flow', 'crew'], tags: ['agents', 'llm', 'orchestration'] },
      { name: 'Vector Search', blurb: 'Embeddings, ANN indexes and retrieval.', words: ['vec', 'embed', 'faiss', 'ann', 'rag'], tags: ['embeddings', 'vector-database', 'retrieval'] },
      { name: 'Training Recipes', blurb: 'Fine-tuning, datasets and eval harnesses.', words: ['tune', 'lora', 'train', 'eval', 'bench'], tags: ['fine-tuning', 'datasets', 'evaluation'] },
    ],
    langs: [['Python', 8], ['C++', 1], ['Rust', 1], ['Jupyter Notebook', 1]],
    kinds: [['library', 4], ['model', 2], ['tool', 2], ['dataset', 1], ['tutorial', 1]],
  },
  {
    name: 'Developer Tools',
    blurb: 'Terminals, editors and the things that make shells pleasant.',
    keywords: ['cli', 'terminal', 'editor', 'git'],
    systems: [
      { name: 'Terminal Apps', blurb: 'TUIs and shell replacements.', words: ['tui', 'term', 'shell', 'prompt', 'tmux'], tags: ['terminal', 'tui', 'shell'] },
      { name: 'Git Tooling', blurb: 'Diffs, history and review workflows.', words: ['git', 'diff', 'lazy', 'blame', 'merge'], tags: ['git', 'version-control', 'diff'] },
      { name: 'Editors', blurb: 'Neovim plugins and editor cores.', words: ['vim', 'nvim', 'edit', 'lsp', 'tree'], tags: ['neovim', 'editor', 'lsp'] },
      { name: 'Dotfiles & Setup', blurb: 'Configs, bootstrap scripts and themes.', words: ['dot', 'conf', 'nix', 'boot', 'rice'], tags: ['dotfiles', 'nix', 'configuration'] },
    ],
    langs: [['Rust', 4], ['Go', 3], ['Lua', 2], ['Shell', 2], ['Nix', 1]],
    kinds: [['cli', 6], ['tool', 3], ['app', 1], ['template', 1]],
  },
  {
    name: 'Data & Databases',
    blurb: 'Storage engines, query layers and pipelines.',
    keywords: ['sql', 'storage', 'olap', 'streaming'],
    systems: [
      { name: 'Embedded Databases', blurb: 'SQLite-shaped engines and key-value stores.', words: ['lite', 'kv', 'db', 'store', 'lsm'], tags: ['database', 'sqlite', 'storage'] },
      { name: 'Analytics Engines', blurb: 'Columnar query engines and dataframes.', words: ['duck', 'polar', 'frame', 'olap', 'arrow'], tags: ['olap', 'dataframe', 'analytics'] },
      { name: 'Streaming', blurb: 'Logs, queues and change data capture.', words: ['stream', 'log', 'queue', 'cdc', 'kafka'], tags: ['streaming', 'queues', 'cdc'] },
      { name: 'ORMs & Query', blurb: 'Type-safe query builders and migrations.', words: ['orm', 'query', 'drizzle', 'kysely', 'migrate'], tags: ['orm', 'sql', 'migrations'] },
    ],
    langs: [['Rust', 3], ['Go', 2], ['C++', 2], ['TypeScript', 2], ['Python', 1]],
    kinds: [['library', 4], ['service', 3], ['tool', 2]],
  },
  {
    name: 'Graphics & Creative',
    blurb: 'Shaders, 3D engines and generative art.',
    keywords: ['webgl', 'shaders', '3d', 'creative-coding'],
    systems: [
      { name: '3D on the Web', blurb: 'Three.js, WebGPU and scene graphs.', words: ['three', 'gpu', 'scene', 'mesh', 'fiber'], tags: ['webgl', 'webgpu', '3d'] },
      { name: 'Shader Art', blurb: 'Fragment shaders, raymarching and noise.', words: ['shader', 'glsl', 'march', 'noise', 'frag'], tags: ['shaders', 'glsl', 'generative-art'] },
      { name: 'Game Engines', blurb: 'ECS engines and game frameworks.', words: ['engine', 'ecs', 'bevy', 'game', 'sprite'], tags: ['game-engine', 'ecs', 'gamedev'] },
      { name: 'Data Viz', blurb: 'Charting grammars and plotting libraries.', words: ['plot', 'chart', 'viz', 'graph', 'map'], tags: ['visualization', 'charts', 'd3'] },
    ],
    langs: [['TypeScript', 3], ['Rust', 2], ['C++', 2], ['GLSL', 2], ['JavaScript', 1]],
    kinds: [['library', 4], ['framework', 2], ['app', 2], ['awesome-list', 1]],
  },
  {
    name: 'Infra & Ops',
    blurb: 'Containers, observability and self-hosting.',
    keywords: ['kubernetes', 'observability', 'self-hosted', 'networking'],
    systems: [
      { name: 'Self-Hosted', blurb: 'Apps you run on your own box.', words: ['host', 'home', 'cloud', 'box', 'nas'], tags: ['self-hosted', 'homelab', 'docker'] },
      { name: 'Observability', blurb: 'Metrics, traces and log search.', words: ['trace', 'metric', 'otel', 'log', 'prom'], tags: ['observability', 'tracing', 'metrics'] },
      { name: 'Kubernetes', blurb: 'Operators, controllers and cluster tooling.', words: ['kube', 'helm', 'pod', 'ctl', 'mesh'], tags: ['kubernetes', 'operators', 'helm'] },
      { name: 'Networking', blurb: 'Proxies, tunnels and VPNs.', words: ['proxy', 'tunnel', 'wire', 'dns', 'edge'], tags: ['networking', 'proxy', 'vpn'] },
    ],
    langs: [['Go', 6], ['Rust', 2], ['Python', 1], ['Shell', 1]],
    kinds: [['service', 4], ['tool', 3], ['cli', 2], ['app', 1]],
  },
]

const OWNERS = ['astral', 'nebula-labs', 'orbitdev', 'kelvin', 'driftwood', 'halcyon', 'quasar-io', 'mira', 'lumen', 'tidepool', 'perihelion', 'vanta', 'cobalt', 'fernweh', 'zenith', 'oort', 'sable', 'aurora-hq', 'basalt', 'pollux']
const SUFFIXES = ['', '-rs', '-js', '-kit', '.nvim', '-core', '-cli', 'ify', '-ui', 'x', '-lab', '-go', '-db', '-viz']
const VERBS = ['Blazing-fast', 'Tiny', 'Type-safe', 'Minimal', 'Composable', 'Zero-config', 'Declarative', 'Batteries-included', 'Local-first', 'Ergonomic']

const galaxyCount = N <= 600 ? 6 : 14
const systemsPerGalaxy = N <= 600 ? 4 : 7
const now = Date.parse('2026-10-01T00:00:00Z')
const SIX_YEARS = 6 * 365 * 86_400_000
const start = now - SIX_YEARS

const normalize = (v: Float32Array) => {
  let s = 0
  for (let i = 0; i < v.length; i++) s += v[i]! * v[i]!
  const k = 1 / Math.sqrt(s)
  for (let i = 0; i < v.length; i++) v[i]! *= k
  return v
}
const randVec = (scale = 1) => {
  const v = new Float32Array(DIM)
  for (let i = 0; i < DIM; i++) v[i] = gauss() * scale
  return v
}
const mix = (a: Float32Array, b: Float32Array, k: number) => {
  const v = new Float32Array(DIM)
  for (let i = 0; i < DIM; i++) v[i] = a[i]! + b[i]! * k
  return normalize(v)
}

type Sys = { gi: number; si: number; name: string; blurb: string; words: string[]; tags: string[]; vec: Float32Array; center: number[]; spread: number[] }
type Gal = { theme: Theme; label: string; vec: Float32Array; center: number[]; peak: number }

const galaxies: Gal[] = []
for (let g = 0; g < galaxyCount; g++) {
  const theme = THEMES[g % THEMES.length]!
  const label = g < THEMES.length ? theme.name : `${theme.name} ${['II', 'III', 'IV'][Math.floor(g / THEMES.length) - 1]}`
  // Fibonacci sphere, flattened, so blobs are well separated like a UMAP layout.
  const t = (g + 0.5) / galaxyCount
  const phi = Math.acos(1 - 2 * t)
  const theta = Math.PI * (1 + Math.sqrt(5)) * g
  const r = 62 + gauss() * 6
  galaxies.push({
    theme,
    label,
    vec: normalize(randVec()),
    center: [r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi) * 0.55, r * Math.sin(phi) * Math.sin(theta)],
    peak: start + rand() * SIX_YEARS,
  })
}

const systems: Sys[] = []
for (const [gi, gal] of galaxies.entries()) {
  for (let s = 0; s < systemsPerGalaxy; s++) {
    const base = gal.theme.systems[s % gal.theme.systems.length]!
    const name = s < gal.theme.systems.length ? base.name : `${base.name} ${s}`
    const dir = [gauss(), gauss(), gauss()]
    const len = Math.hypot(...dir)
    const off = 14 + rand() * 8
    systems.push({
      gi,
      si: s,
      name,
      blurb: base.blurb,
      words: base.words,
      tags: base.tags,
      vec: mix(gal.vec, randVec(1 / Math.sqrt(DIM)), 0.9),
      center: gal.center.map((c, k) => c + (dir[k]! / len) * off),
      spread: [4 + rand() * 3, 3 + rand() * 3, 4 + rand() * 3],
    })
  }
}

const sysWeights = systems.map(() => 0.5 + rand())
const sysOf = (): number => {
  const total = sysWeights.reduce((a, b) => a + b, 0)
  let r = rand() * total
  for (let i = 0; i < sysWeights.length; i++) if ((r -= sysWeights[i]!) <= 0) return i
  return sysWeights.length - 1
}

const iso = (ms: number) => new Date(ms).toISOString()
const titleCase = (s: string) => s[0]!.toUpperCase() + s.slice(1)
const used = new Set<string>()

type Draft = Omit<Repo, 'neighbors' | 'pos'> & { pos: [number, number, number]; sys: number; vec: Float32Array }
const drafts: Draft[] = []
for (let i = 0; i < N; i++) {
  const sIdx = sysOf()
  const sys = systems[sIdx]!
  const gal = galaxies[sys.gi]!
  let fullName = ''
  do {
    const a = pick(sys.words)
    const b = rand() < 0.5 ? pick(['', 'o', 'er', 'ly', 'ex', 'io']) : pick(gal.theme.systems.flatMap((x) => x.words))
    fullName = `${pick(OWNERS)}/${a}${b === a ? '' : b}${pick(SUFFIXES)}`
  } while (used.has(fullName))
  used.add(fullName)
  const name = fullName.split('/')[1]!
  const kind = weighted(gal.theme.kinds)
  const language = rand() < 0.04 ? null : weighted(gal.theme.langs)
  const stars = Math.max(0, Math.round(Math.exp(5.2 + gauss() * 1.9)))
  const outlier = rand() < 0.05
  const k = outlier ? 2.2 : 1
  const pos: [number, number, number] = [
    sys.center[0]! + gauss() * sys.spread[0]! * k,
    sys.center[1]! + gauss() * sys.spread[1]! * k,
    sys.center[2]! + gauss() * sys.spread[2]! * k,
  ]
  const starred = Math.min(now - 86_400_000, Math.max(start, rand() < 0.6 ? gal.peak + gauss() * 120 * 86_400_000 : start + rand() * SIX_YEARS))
  const archived = rand() < 0.06
  const pushedAgo = archived ? 400 + rand() * 1500 : Math.exp(rand() * Math.log(900))
  const summarized = rand() < 0.9
  const tags = [...new Set([pick(sys.tags), pick(sys.tags), pick(gal.theme.keywords)])]
  const stack = [...new Set([language ?? 'Markdown', pick(gal.theme.langs)[0]])].slice(0, rand() < 0.5 ? 1 : 2)
  const oneLiner = `${pick(VERBS)} ${sys.tags[0]!.replace(/-/g, ' ')} ${kind === 'cli' ? 'CLI' : kind.replace('-', ' ')} for ${pick(gal.theme.keywords)} work.`
  drafts.push({
    fullName,
    url: `https://github.com/${fullName}`,
    homepage: rand() < 0.35 ? `https://${name.replace(/\./g, '-')}.dev` : null,
    description: rand() < 0.92 ? `${titleCase(name)}: ${oneLiner.toLowerCase()}` : null,
    oneLiner,
    summary: summarized
      ? `${titleCase(name)} is a ${kind.replace('-', ' ')} in the ${sys.name.toLowerCase()} space. It focuses on ${tags.join(', ')} and is written mostly in ${language ?? 'prose'}. People reach for it when they want ${pick(gal.theme.keywords)} without the ceremony.`
      : null,
    kind,
    domain: gal.theme.keywords[0]!,
    tags,
    stack,
    language,
    stars,
    pushedAt: rand() < 0.03 ? null : iso(now - pushedAgo * 86_400_000),
    starredAt: iso(starred),
    archived,
    pos,
    pos2: [0, 0],
    galaxyId: `g${String(sys.gi).padStart(2, '0')}`,
    systemId: `g${String(sys.gi).padStart(2, '0')}.s${String(sys.si).padStart(2, '0')}`,
    outlier,
    quality: summarized ? Math.round((0.35 + rand() * 0.65) * 100) / 100 : null,
    summarized,
    sys: sIdx,
    vec: mix(sys.vec, randVec(1 / Math.sqrt(DIM)), outlier ? 1.6 : 0.75),
  })
}

// Percentile-normalize to ±100 like the pipeline, then derive pos2 from a fixed oblique projection.
function percentileScale(values: number[]) {
  const s = [...values].sort((a, b) => a - b)
  const lo = s[Math.floor(s.length * 0.01)]!
  const hi = s[Math.floor(s.length * 0.99)]!
  const mid = (lo + hi) / 2
  const half = (hi - lo) / 2 || 1
  return (v: number) => ((v - mid) / half) * 100
}
for (let axis = 0; axis < 3; axis++) {
  const f = percentileScale(drafts.map((d) => d.pos[axis]!))
  for (const d of drafts) d.pos[axis] = round(f(d.pos[axis]!))
}
const yaw = 0.6
for (const d of drafts) {
  const [x, y, z] = d.pos
  d.pos2 = [round(x * Math.cos(yaw) + z * Math.sin(yaw)), round(y * 0.6 + (z * Math.cos(yaw) - x * Math.sin(yaw)) * 0.5)]
}
function round(v: number) {
  return Math.round(v * 1000) / 1000
}

const vectors = new Float32Array(N * DIM)
drafts.forEach((d, i) => vectors.set(d.vec, i * DIM))

const ALL = Array.from({ length: N }, (_, i) => i)
// Exact kNN is O(N²·DIM); past a few thousand repos, search only the repo's own galaxy, where the
// synthetic vectors put every true neighbour anyway.
const byGalaxy = new Map<number, number[]>()
drafts.forEach((d, i) => {
  const g = systems[d.sys]!.gi
  byGalaxy.set(g, [...(byGalaxy.get(g) ?? []), i])
})

function topK(query: Float32Array, k: number, skip = -1, candidates = ALL): [number, number][] {
  const best: [number, number][] = []
  for (const j of candidates) {
    if (j === skip) continue
    let dot = 0
    const o = j * DIM
    for (let d = 0; d < DIM; d++) dot += query[d]! * vectors[o + d]!
    if (best.length < k || dot > best[best.length - 1]![1]) {
      best.push([j, dot])
      best.sort((a, b) => b[1] - a[1])
      if (best.length > k) best.pop()
    }
  }
  return best.map(([j, c]) => [j, Math.round(c * 10000) / 10000])
}

const repos: Repo[] = drafts.map(({ sys, vec, ...r }, i) => ({
  ...r,
  neighbors: topK(vec, NEIGHBORS, i, N > 2000 ? byGalaxy.get(systems[sys]!.gi) : ALL),
}))

const centroidOf = (members: number[]) => {
  const c = [0, 0, 0]
  for (const m of members) for (let k = 0; k < 3; k++) c[k]! += repos[m]!.pos[k]! / members.length
  return c as [number, number, number]
}
const radiusOf = (members: number[], c: number[]) => {
  const d = members.map((m) => Math.hypot(...repos[m]!.pos.map((p, k) => p - c[k]!))).sort((a, b) => a - b)
  return round(d[Math.floor((d.length - 1) * 0.9)] ?? 0)
}

const clusters: Cluster[] = []
for (const [gi, gal] of galaxies.entries()) {
  const id = `g${String(gi).padStart(2, '0')}`
  const members = repos.flatMap((r, i) => (r.galaxyId === id ? [i] : []))
  const c = centroidOf(members)
  clusters.push({ id, level: 0, parentId: null, name: gal.label, blurb: gal.theme.blurb, keywords: gal.theme.keywords, centroid: c.map(round) as [number, number, number], radius: radiusOf(members, c), members })
}
for (const sys of systems) {
  const id = `g${String(sys.gi).padStart(2, '0')}.s${String(sys.si).padStart(2, '0')}`
  const members = repos.flatMap((r, i) => (r.systemId === id ? [i] : []))
  if (members.length === 0) continue
  const c = centroidOf(members)
  clusters.push({ id, level: 1, parentId: id.slice(0, 3), name: sys.name, blurb: sys.blurb, keywords: sys.tags, centroid: c.map(round) as [number, number, number], radius: radiusOf(members, c), members })
}

const min = [0, 1, 2].map((k) => Math.min(...repos.map((r) => r.pos[k]!))) as [number, number, number]
const max = [0, 1, 2].map((k) => Math.max(...repos.map((r) => r.pos[k]!))) as [number, number, number]
const starredTimes = repos.map((r) => Date.parse(r.starredAt))

const data: GalaxyData = {
  schemaVersion: 1,
  meta: {
    generatedAt: iso(now),
    viewer: 'fixture',
    counts: {
      repos: N,
      galaxies: clusters.filter((c) => c.level === 0).length,
      systems: clusters.filter((c) => c.level === 1).length,
      summarized: repos.filter((r) => r.summarized).length,
    },
    bounds: { min, max },
    starredRange: [iso(Math.min(...starredTimes)), iso(Math.max(...starredTimes))],
    embedding: {
      model: 'fixture/synthetic',
      browserModel: 'onnx-community/embeddinggemma-2-ONNX',
      dims: 256,
      dtype: 'float16',
      normalized: true,
      queryPrefix: 'task: search result | query: ',
      docPrefix: 'title: {title} | text: {text}',
    },
    searchProbes: systems.slice(0, 10).map((s) => ({ query: s.name.toLowerCase(), topIdx: topK(s.vec, 10).map(([j]) => j) })),
  },
  clusters,
  repos,
}

mkdirSync(out, { recursive: true })
writeFileSync(join(out, 'galaxy.json'), JSON.stringify(data))
const f16 = new Float16Array(vectors)
writeFileSync(join(out, 'vectors.f16.bin'), new Uint8Array(f16.buffer, f16.byteOffset, f16.byteLength))
console.log(`wrote ${N} repos, ${data.meta.counts.galaxies} galaxies, ${data.meta.counts.systems} systems to ${out}`)
