import { formatMonthYear } from './format'
import { RESTING_LAYOUT } from './layout'

/**
 * The timeline cursor c in [0, 1] is the user-facing position. The shader births a star over
 * [aStarred, aStarred + birthWindow] of uTimeline, so the cursor stretches over 1 + birthWindow:
 * c = 0 shows nothing and c = 1 shows every star fully born. The date a cursor shows is the
 * moment a star starred then is half born.
 */

export const BIRTH_WINDOW = RESTING_LAYOUT.birthWindow
/** A full play from c = 0 to c = 1 at 1x. */
export const PLAY_SECONDS = 20

const DAY = 86_400_000

/** `meta.starredRange` as the shader's aStarred normalisation reads it (see load.ts). */
export type StarredRange = { t0: number; span: number }

export function toStarredRange([from, to]: readonly [string, string]): StarredRange {
  const t0 = Date.parse(from)
  return { t0, span: Math.max(DAY, Date.parse(to) - t0) }
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

export const timeToFraction = (ms: number, r: StarredRange) => clamp01((ms - r.t0) / r.span)
export const fractionToTime = (f: number, r: StarredRange) => r.t0 + f * r.span

export const cursorToUniform = (c: number, w = BIRTH_WINDOW) => clamp01(c) * (1 + w)

/** The starred-range fraction whose stars are half born at cursor c. */
export const cursorToFraction = (c: number, w = BIRTH_WINDOW) => clamp01(cursorToUniform(c, w) - w / 2)

/** The ends map to the ends, so dragging to either edge reaches "nothing yet" and "everything". */
export function fractionToCursor(f: number, w = BIRTH_WINDOW): number {
  if (f <= 0) return 0
  if (f >= 1) return 1
  return (f + w / 2) / (1 + w)
}

export const cursorToTime = (c: number, r: StarredRange, w = BIRTH_WINDOW) => fractionToTime(cursorToFraction(c, w), r)
export const cursorToIso = (c: number, r: StarredRange, w = BIRTH_WINDOW) => new Date(cursorToTime(c, r, w)).toISOString()
export const cursorToMonth = (c: number, r: StarredRange, w = BIRTH_WINDOW) => cursorToIso(c, r, w).slice(0, 7)
export const cursorMonthLabel = (c: number, r: StarredRange, w = BIRTH_WINDOW) => formatMonthYear(cursorToIso(c, r, w))

export function dateToCursor(date: string | number, r: StarredRange, w = BIRTH_WINDOW): number {
  return fractionToCursor(timeToFraction(typeof date === 'number' ? date : Date.parse(date), r), w)
}

/** The cursor `k` calendar months from c's date, for slider arrow and page keys. */
export function stepCursorByMonths(c: number, k: number, r: StarredRange, w = BIRTH_WINDOW): number {
  const d = new Date(cursorToTime(c, r, w))
  const day = d.getUTCDate()
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() + k)
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
  d.setUTCDate(Math.min(day, last))
  return dateToCursor(d.getTime(), r, w)
}

/** The stars a timeline counts, ordered by aStarred so counts at a cursor are a binary search. */
export type BirthIndex = {
  /** aStarred of each counted star, ascending. */
  starred: Float32Array
  /** The star index of each entry in `starred`. */
  order: Uint32Array
}

/** `include`, when given, keeps only stars where it is 1 (the filter mask). */
export function birthIndex(starred: Float32Array, include?: Uint8Array | null): BirthIndex {
  const idx: number[] = []
  for (let i = 0; i < starred.length; i++) if (!include || include[i]) idx.push(i)
  idx.sort((a, b) => starred[a]! - starred[b]! || a - b)
  return { starred: Float32Array.from(idx, (i) => starred[i]!), order: Uint32Array.from(idx) }
}

/** Entries with value <= x, compared at the float32 precision the entries are stored in. */
function upperBound(a: Float32Array, x: number): number {
  x = Math.fround(x)
  let lo = 0
  let hi = a.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (a[mid]! <= x) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** Stars at least half born at cursor c: the count the ticker shows beside c's date. */
export function bornCount(ix: BirthIndex, c: number, w = BIRTH_WINDOW): number {
  return upperBound(ix.starred, cursorToUniform(c, w) - w / 2)
}

/** The most-starred repo whose half-born moment fell within the last birth window, if any. */
export function brightestNewborn(ix: BirthIndex, stars: ArrayLike<number>, c: number, w = BIRTH_WINDOW): number | null {
  const at = cursorToUniform(c, w) - w / 2
  const hi = upperBound(ix.starred, at)
  const lo = upperBound(ix.starred, at - w)
  let best: number | null = null
  for (let k = lo; k < hi; k++) {
    const i = ix.order[k]!
    if (best === null || stars[i]! > stars[best]!) best = i
  }
  return best
}

/** Starred counts per calendar month over `meta.starredRange`, stacked by galaxy. */
export type StarredHistogram = {
  /** `YYYY-MM`, the same keys as `filters.starred`. */
  months: string[]
  galaxies: number
  /** Stars starred in month m in galaxy k at `counts[m * galaxies + k]`. */
  counts: Uint32Array
  totals: Uint32Array
  max: number
  /** Where each month starts as a fraction of the starred range, then 1 (length months + 1). */
  edges: Float64Array
}

export function starredHistogram(
  starredAt: readonly string[],
  galaxyOf: ArrayLike<number>,
  galaxies: number,
  range: readonly [string, string],
): StarredHistogram {
  const r = toStarredRange(range)
  const months: string[] = []
  let y = Number(range[0].slice(0, 4))
  let m = Number(range[0].slice(5, 7)) - 1
  const last = range[1].slice(0, 7)
  for (let guard = 0; guard < 1200; guard++) {
    const key = `${y}-${String(m + 1).padStart(2, '0')}`
    months.push(key)
    if (key >= last) break
    if (++m === 12) {
      m = 0
      y++
    }
  }
  const edges = new Float64Array(months.length + 1)
  months.forEach((key, k) => (edges[k] = k === 0 ? 0 : timeToFraction(Date.parse(`${key}-01T00:00:00Z`), r)))
  edges[months.length] = 1

  const monthIndex = new Map(months.map((key, k) => [key, k]))
  const counts = new Uint32Array(months.length * galaxies)
  const totals = new Uint32Array(months.length)
  for (let i = 0; i < starredAt.length; i++) {
    const key = starredAt[i]!.slice(0, 7)
    // A starredAt outside the range still counts, in the nearest month, so totals equal n.
    const k = monthIndex.get(key) ?? (key < months[0]! ? 0 : months.length - 1)
    counts[k * galaxies + galaxyOf[i]!]!++
    totals[k]!++
  }
  let max = 0
  for (const t of totals) max = Math.max(max, t)
  return { months, galaxies, counts, totals, max, edges }
}

/** The month a starred-range fraction falls in. */
export function monthAtFraction(h: StarredHistogram, f: number): number {
  let lo = 0
  let hi = h.months.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (h.edges[mid]! <= f) lo = mid
    else hi = mid - 1
  }
  return lo
}
