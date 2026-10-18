import { GalaxyData, type Cluster, type Repo } from './schema'
import { assignGalaxyHues, galaxyColor, systemColor, type ClusterColor } from './palette'
import type { LayoutAttributes } from './layout'
import { introDelay } from './intro'
import { toStarredRange } from './timeline'

export type ClusterNode = Cluster & {
  /** Position in `galaxies` or `systems`. */
  index: number
  color: ClusterColor
  /** Mean of the members' flat-map positions (z = 0), where the label sits in flat view. */
  centroid2: [number, number, number]
}

export type StarAttributes = LayoutAttributes & {
  seed: Float32Array
  color: Float32Array
  size: Float32Array
  bright: Float32Array
  /** (archived, activity, quality, spikes) */
  meta: Float32Array
  density: Float32Array
}

export type GalaxyIndex = {
  data: GalaxyData
  n: number
  repos: Repo[]
  galaxies: ClusterNode[]
  systems: ClusterNode[]
  clusterById: Map<string, ClusterNode>
  byFullName: Map<string, number>
  galaxyOf: Uint16Array
  systemOf: Uint16Array
  attrs: StarAttributes
  /** Layout distance to the 8th nearest star; sizes the fly-to framing sphere. */
  d8: Float32Array
  center: [number, number, number]
  radius: number
  vectorsUrl: string
}

export type DataSource = { name: string; galaxyUrl: string; vectorsUrl: string }

export function resolveDataSource(name: string | undefined): DataSource {
  if (name && /^[a-z0-9-]+$/i.test(name)) {
    return { name, galaxyUrl: `/data/${name}/galaxy.json`, vectorsUrl: `/data/${name}/vectors.f16.bin` }
  }
  return { name: 'galaxy', galaxyUrl: '/data/galaxy.json', vectorsUrl: '/data/vectors.f16.bin' }
}

export class GalaxyLoadError extends Error {}

export async function loadGalaxy(source: DataSource): Promise<GalaxyIndex> {
  const res = await fetch(source.galaxyUrl)
  if (!res.ok) throw new GalaxyLoadError(`${source.galaxyUrl} returned ${res.status}`)
  const json: unknown = await res.json()
  let data: GalaxyData
  if (import.meta.env.DEV) {
    const parsed = GalaxyData.safeParse(json)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      throw new GalaxyLoadError(`${source.galaxyUrl} does not match the schema at ${issue?.path.join('.')}: ${issue?.message}`)
    }
    data = parsed.data
  } else {
    data = json as GalaxyData
    if (data?.schemaVersion !== 1) throw new GalaxyLoadError(`${source.galaxyUrl} is not schemaVersion 1`)
  }
  return buildGalaxyIndex(data, source.vectorsUrl)
}

const DAY = 86_400_000

/**
 * Cross-references the schema cannot express. Everything downstream indexes typed arrays by these,
 * so a dangling id or index is rejected here rather than guarded at every use.
 */
export function assertIntegrity(data: GalaxyData) {
  const n = data.repos.length
  const level = new Map(data.clusters.map((c) => [c.id, c.level]))
  const fail = (msg: string) => {
    throw new GalaxyLoadError(`galaxy export is inconsistent: ${msg}`)
  }
  for (const c of data.clusters) {
    if (c.level === 1 && level.get(c.parentId ?? '') !== 0) fail(`system ${c.id} has no parent galaxy ${c.parentId}`)
    for (const m of c.members) if (m >= n) fail(`cluster ${c.id} lists member ${m} of ${n}`)
  }
  data.repos.forEach((r, i) => {
    if (level.get(r.galaxyId) !== 0) fail(`${r.fullName} points at unknown galaxy ${r.galaxyId}`)
    if (level.get(r.systemId) !== 1) fail(`${r.fullName} points at unknown system ${r.systemId}`)
    for (const [j] of r.neighbors) if (j >= n || j === i) fail(`${r.fullName} has neighbour index ${j}`)
  })
}

export function buildGalaxyIndex(data: GalaxyData, vectorsUrl = ''): GalaxyIndex {
  assertIntegrity(data)
  const { repos } = data
  const n = repos.length
  const galaxyClusters = data.clusters.filter((c) => c.level === 0).sort((a, b) => a.id.localeCompare(b.id))
  const hues = assignGalaxyHues(galaxyClusters.map((c) => c.centroid))
  const centroid2 = (c: Cluster): [number, number, number] => {
    let x = 0
    let y = 0
    for (const m of c.members) {
      x += repos[m]!.pos2[0]
      y += repos[m]!.pos2[1]
    }
    const k = Math.max(1, c.members.length)
    return [x / k, y / k, 0]
  }
  const galaxies: ClusterNode[] = galaxyClusters.map((c, index) => ({ ...c, index, color: galaxyColor(hues[index]!), centroid2: centroid2(c) }))
  const galaxyById = new Map(galaxies.map((g) => [g.id, g]))

  const systemClusters = data.clusters.filter((c) => c.level === 1).sort((a, b) => a.id.localeCompare(b.id))
  const siblingsOf = new Map<string, Cluster[]>()
  for (const s of systemClusters) siblingsOf.set(s.parentId ?? '', [...(siblingsOf.get(s.parentId ?? '') ?? []), s])
  const systems: ClusterNode[] = systemClusters.map((c, index) => {
    const siblings = siblingsOf.get(c.parentId ?? '')!
    const parent = galaxyById.get(c.parentId ?? '')!
    return { ...c, index, color: systemColor(parent.color.hue, siblings.indexOf(c), siblings.length), centroid2: centroid2(c) }
  })
  const clusterById = new Map<string, ClusterNode>([...galaxies, ...systems].map((c) => [c.id, c]))

  const galaxyOf = new Uint16Array(n)
  const systemOf = new Uint16Array(n)
  const byFullName = new Map<string, number>()

  const pos = new Float32Array(n * 3)
  const pos2 = new Float32Array(n * 3)
  const color = new Float32Array(n * 3)
  const size = new Float32Array(n)
  const bright = new Float32Array(n)
  const seed = new Float32Array(n)
  const delay = new Float32Array(n)
  const hueRank = new Map([...galaxies].sort((a, b) => a.color.hue - b.color.hue).map((c, k) => [c.index, k]))
  const starred = new Float32Array(n)
  const meta = new Float32Array(n * 4)

  const { t0, span } = toStarredRange(data.meta.starredRange)
  const now = Date.parse(data.meta.generatedAt)
  const maxLogStars = Math.log10(1 + Math.max(1, ...repos.map((r) => r.stars)))
  const spikeThreshold = Math.max(5_000, quantile(repos.map((r) => r.stars), 0.98))

  repos.forEach((r, i) => {
    byFullName.set(r.fullName.toLowerCase(), i)
    galaxyOf[i] = galaxyById.get(r.galaxyId)!.index
    const sys = clusterById.get(r.systemId)!
    systemOf[i] = sys.index
    const c = sys.color.star

    pos.set(r.pos, i * 3)
    pos2.set([r.pos2[0], r.pos2[1], 0], i * 3)
    color.set(r.archived ? desaturate(c, 0.75) : c, i * 3)
    size[i] = Math.log10(1 + r.stars) / maxLogStars
    const s = (Date.parse(r.starredAt) - t0) / span
    starred[i] = clamp01(s)
    bright[i] = 0.55 + 0.45 * clamp01(s) ** 0.8
    seed[i] = hash01(r.fullName)
    delay[i] = introDelay(hueRank.get(galaxyOf[i]!)!, galaxies.length, seed[i]!)
    const pushedDays = r.pushedAt ? (now - Date.parse(r.pushedAt)) / DAY : Infinity
    const activity = r.archived ? 0 : Math.exp(-Math.max(0, pushedDays) / 180)
    meta.set([r.archived ? 1 : 0, activity, r.quality ?? 0.5, r.stars >= spikeThreshold ? 1 : 0], i * 4)
  })

  const { meanDist, d8 } = spatialNeighbors(pos, n, 8)
  const typical = quantile(Array.from(meanDist), 0.5) || 1
  const density = new Float32Array(n)
  for (let i = 0; i < n; i++) density[i] = Math.min(8, Math.max(0.25, (typical / Math.max(1e-3, meanDist[i]!)) ** 1.5))

  const { min, max } = data.meta.bounds
  const center: [number, number, number] = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2]
  const radius = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2

  return {
    data,
    n,
    repos,
    galaxies,
    systems,
    clusterById,
    byFullName,
    galaxyOf,
    systemOf,
    attrs: { pos, pos2, color, size, bright, seed, delay, starred, meta, density },
    d8,
    center,
    radius,
    vectorsUrl,
  }
}

/** k nearest by layout distance, via a uniform grid so 10k stars stay well under 100 ms. */
export function spatialNeighbors(pos: Float32Array, n: number, k: number) {
  const meanDist = new Float32Array(n)
  const d8 = new Float32Array(n)
  if (n < 2) return { meanDist, d8 }
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
  for (let i = 0; i < n; i++) {
    const x = pos[i * 3]!, y = pos[i * 3 + 1]!, z = pos[i * 3 + 2]!
    minX = Math.min(minX, x); maxX = Math.max(maxX, x)
    minY = Math.min(minY, y); maxY = Math.max(maxY, y)
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z)
  }
  const extent = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 1e-3)
  const cells = Math.max(1, Math.round(Math.cbrt(n / 4)))
  const cell = extent / cells + 1e-6
  const key = (cx: number, cy: number, cz: number) => (cx * 1024 + cy) * 1024 + cz
  const grid = new Map<number, number[]>()
  const cellOf = (i: number) => [
    Math.floor((pos[i * 3]! - minX) / cell),
    Math.floor((pos[i * 3 + 1]! - minY) / cell),
    Math.floor((pos[i * 3 + 2]! - minZ) / cell),
  ] as const
  for (let i = 0; i < n; i++) {
    const [cx, cy, cz] = cellOf(i)
    const kk = key(cx, cy, cz)
    const bucket = grid.get(kk)
    if (bucket) bucket.push(i)
    else grid.set(kk, [i])
  }
  const want = Math.min(k, n - 1)
  const best = new Float32Array(want)
  for (let i = 0; i < n; i++) {
    const [cx, cy, cz] = cellOf(i)
    const x = pos[i * 3]!, y = pos[i * 3 + 1]!, z = pos[i * 3 + 2]!
    for (let ring = 1; ; ring++) {
      best.fill(Infinity)
      for (let ax = cx - ring; ax <= cx + ring; ax++)
        for (let ay = cy - ring; ay <= cy + ring; ay++)
          for (let az = cz - ring; az <= cz + ring; az++) {
            const bucket = grid.get(key(ax, ay, az))
            if (!bucket) continue
            for (const j of bucket) {
              if (j === i) continue
              const d = (pos[j * 3]! - x) ** 2 + (pos[j * 3 + 1]! - y) ** 2 + (pos[j * 3 + 2]! - z) ** 2
              if (d < best[want - 1]!) {
                let p = want - 1
                while (p > 0 && best[p - 1]! > d) {
                  best[p] = best[p - 1]!
                  p--
                }
                best[p] = d
              }
            }
          }
      // Neighbours inside `ring` cells are exact once the kth distance fits inside the searched cube.
      if (Math.sqrt(best[want - 1]!) <= ring * cell || ring > cells) break
    }
    let sum = 0
    for (let q = 0; q < want; q++) sum += Math.sqrt(best[q]!)
    meanDist[i] = sum / want
    d8[i] = Math.sqrt(best[want - 1]!)
  }
  return { meanDist, d8 }
}

export function hash01(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 100_000) / 100_000
}

function quantile(xs: number[], q: number) {
  if (xs.length === 0) return 0
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor(q * s.length))]!
}

function desaturate([r, g, b]: readonly number[], amount: number): [number, number, number] {
  const l = 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
  return [r! + (l - r!) * amount, g! + (l - g!) * amount, b! + (l - b!) * amount]
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
