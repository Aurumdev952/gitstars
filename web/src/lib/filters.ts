import type { GalaxyIndex } from './load'
import type { Kind } from './schema'

export type PushedWithin = 'any' | '1y' | '6m'
export type ArchivedMode = 'include' | 'exclude' | 'only'

/** Within a facet, values are alternatives (OR); across facets, every active facet must pass (AND). */
export type Filters = {
  kind: readonly Kind[]
  lang: readonly string[]
  tag: readonly string[]
  /** Inclusive star-count range. */
  stars: readonly [number, number] | null
  pushed: PushedWithin
  archived: ArchivedMode
  /** Inclusive range of starred months, as `YYYY-MM`. */
  starred: readonly [string, string] | null
}

export const NO_FILTERS: Filters = {
  kind: [],
  lang: [],
  tag: [],
  stars: null,
  pushed: 'any',
  archived: 'include',
  starred: null,
}

export const FACETS = ['kind', 'lang', 'tag', 'stars', 'pushed', 'archived', 'starred'] as const
export type FacetKey = (typeof FACETS)[number]

/** Per-star columns the predicates read; built once per galaxy. */
export type FilterColumns = {
  n: number
  kind: string[]
  lang: string[]
  tags: string[][]
  stars: Float64Array
  pushedDays: Float64Array
  archived: Uint8Array
  starredMonth: string[]
  months: string[]
}

export const NO_LANGUAGE = 'None'
const DAY = 86_400_000
const PUSHED_DAYS: Record<PushedWithin, number> = { any: Infinity, '1y': 365, '6m': 182 }

const columnCache = new WeakMap<GalaxyIndex, FilterColumns>()

export function filterColumns(g: GalaxyIndex): FilterColumns {
  const hit = columnCache.get(g)
  if (hit) return hit
  const now = Date.parse(g.data.meta.generatedAt)
  const starredMonth = g.repos.map((r) => r.starredAt.slice(0, 7))
  const cols: FilterColumns = {
    n: g.n,
    kind: g.repos.map((r) => r.kind),
    lang: g.repos.map((r) => r.language ?? NO_LANGUAGE),
    tags: g.repos.map((r) => r.tags),
    stars: Float64Array.from(g.repos, (r) => r.stars),
    pushedDays: Float64Array.from(g.repos, (r) => (r.pushedAt ? (now - Date.parse(r.pushedAt)) / DAY : Infinity)),
    archived: Uint8Array.from(g.repos, (r) => (r.archived ? 1 : 0)),
    starredMonth,
    months: monthRange(starredMonth),
  }
  columnCache.set(g, cols)
  return cols
}

/** Every month from the earliest to the latest present, so histograms have no holes. */
function monthRange(months: string[]): string[] {
  if (months.length === 0) return []
  const sorted = [...months].sort()
  const out: string[] = []
  let [y, m] = sorted[0]!.split('-').map(Number) as [number, number]
  const last = sorted[sorted.length - 1]!
  for (let guard = 0; guard < 1200; guard++) {
    const key = `${y}-${String(m).padStart(2, '0')}`
    out.push(key)
    if (key >= last) break
    m++
    if (m > 12) {
      m = 1
      y++
    }
  }
  return out
}

type Predicate = (i: number) => boolean

/** One entry per facet: whether it constrains anything, and its test. Adding a facet is one row. */
const PREDICATES: { [K in FacetKey]: (f: Filters, c: FilterColumns) => Predicate | null } = {
  kind: (f, c) => (f.kind.length ? setTest(f.kind, (i) => c.kind[i]!) : null),
  lang: (f, c) => (f.lang.length ? setTest(f.lang, (i) => c.lang[i]!) : null),
  tag: (f, c) => {
    if (!f.tag.length) return null
    const want = new Set(f.tag)
    return (i) => c.tags[i]!.some((t) => want.has(t))
  },
  stars: (f, c) => {
    if (!f.stars) return null
    const [lo, hi] = f.stars
    return (i) => c.stars[i]! >= lo && c.stars[i]! <= hi
  },
  pushed: (f, c) => {
    if (f.pushed === 'any') return null
    const max = PUSHED_DAYS[f.pushed]
    return (i) => c.pushedDays[i]! <= max
  },
  archived: (f, c) => {
    if (f.archived === 'include') return null
    const want = f.archived === 'only' ? 1 : 0
    return (i) => c.archived[i] === want
  },
  starred: (f, c) => {
    if (!f.starred) return null
    const [lo, hi] = f.starred
    return (i) => c.starredMonth[i]! >= lo && c.starredMonth[i]! <= hi
  },
}

function setTest(values: readonly string[], read: (i: number) => string): Predicate {
  const want = new Set(values)
  return (i) => want.has(read(i))
}

export function activeFacets(f: Filters): FacetKey[] {
  return FACETS.filter((k) => {
    switch (k) {
      case 'kind':
      case 'lang':
      case 'tag':
        return f[k].length > 0
      case 'stars':
      case 'starred':
        return f[k] !== null
      case 'pushed':
        return f.pushed !== 'any'
      case 'archived':
        return f.archived !== 'include'
    }
  })
}

export type FacetCounts = {
  kind: Map<string, number>
  lang: Map<string, number>
  tag: Map<string, number>
  /** Star counts per log10 bin (bin b holds 10^(b/2) up to 10^((b+1)/2)). */
  stars: number[]
  pushed: Record<PushedWithin, number>
  archived: { active: number; archived: number }
  /** Counts per month of `columns.months`. */
  starred: number[]
}

export type FilterResult = {
  /** 1 where the star passes every active facet. */
  visible: Uint8Array
  count: number
  /** Each facet counted under every *other* active facet, so its own options stay reachable. */
  facets: FacetCounts
}

export const STAR_BINS_PER_DECADE = 2

export function starBin(stars: number): number {
  return Math.max(0, Math.floor(Math.log10(Math.max(1, stars)) * STAR_BINS_PER_DECADE))
}

export function starBinCount(c: FilterColumns): number {
  let max = 0
  for (let i = 0; i < c.n; i++) max = Math.max(max, starBin(c.stars[i]!))
  return max + 1
}

export function applyFilters(c: FilterColumns, f: Filters): FilterResult {
  const tests = FACETS.map((k) => [k, PREDICATES[k](f, c)] as const).filter((e): e is readonly [FacetKey, Predicate] => e[1] !== null)
  const visible = new Uint8Array(c.n)
  // A star counts toward facet F when it fails nothing, or fails only F.
  const failedOnly: (FacetKey | null)[] = new Array(c.n)
  const failCount = new Uint8Array(c.n)
  let count = 0
  for (let i = 0; i < c.n; i++) {
    let fails = 0
    let which: FacetKey | null = null
    for (const [k, test] of tests) {
      if (!test(i)) {
        fails++
        which = k
        if (fails > 1) break
      }
    }
    failCount[i] = fails
    failedOnly[i] = which
    if (fails === 0) {
      visible[i] = 1
      count++
    }
  }
  const counts: FacetCounts = {
    kind: new Map(),
    lang: new Map(),
    tag: new Map(),
    stars: new Array(starBinCount(c)).fill(0),
    pushed: { any: 0, '1y': 0, '6m': 0 },
    archived: { active: 0, archived: 0 },
    starred: new Array(c.months.length).fill(0),
  }
  const monthIndex = new Map(c.months.map((m, k) => [m, k]))
  const bump = (m: Map<string, number>, key: string) => m.set(key, (m.get(key) ?? 0) + 1)
  const countsFor = (i: number, k: FacetKey) => failCount[i] === 0 || (failCount[i] === 1 && failedOnly[i] === k)
  for (let i = 0; i < c.n; i++) {
    if (failCount[i]! > 1) continue
    if (countsFor(i, 'kind')) bump(counts.kind, c.kind[i]!)
    if (countsFor(i, 'lang')) bump(counts.lang, c.lang[i]!)
    if (countsFor(i, 'tag')) for (const t of c.tags[i]!) bump(counts.tag, t)
    if (countsFor(i, 'stars')) counts.stars[starBin(c.stars[i]!)]!++
    if (countsFor(i, 'pushed')) {
      counts.pushed.any++
      if (c.pushedDays[i]! <= PUSHED_DAYS['1y']) counts.pushed['1y']++
      if (c.pushedDays[i]! <= PUSHED_DAYS['6m']) counts.pushed['6m']++
    }
    if (countsFor(i, 'archived')) counts.archived[c.archived[i] ? 'archived' : 'active']++
    if (countsFor(i, 'starred')) counts.starred[monthIndex.get(c.starredMonth[i]!)!]!++
  }
  return { visible, count, facets: counts }
}

/** Returns `f` with `value` toggled in a multi-value facet. */
export function toggleValue<K extends 'kind' | 'lang' | 'tag'>(f: Filters, key: K, value: Filters[K][number]): Filters {
  const list = f[key] as readonly string[]
  const next = list.includes(value) ? list.filter((v) => v !== value) : [...list, value]
  return { ...f, [key]: next }
}

export function clearFacet(f: Filters, key: FacetKey): Filters {
  return { ...f, [key]: NO_FILTERS[key] }
}
