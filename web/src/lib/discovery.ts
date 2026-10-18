import type { Repo } from './schema'

const YEAR = 365.25 * 86_400_000
const POOL = 50

const sat = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)

/** Recently pushed repos are worth rediscovering; untouched ones fade but never reach zero. */
export function activityBoost(pushedAt: string | null, now: number): number {
  if (!pushedAt) return 0.35
  const years = Math.max(0, (now - Date.parse(pushedAt)) / YEAR)
  return 0.35 + 0.65 * Math.exp(-years / 0.75)
}

/**
 * How much a star deserves a second look: good, starred long ago, still alive, not yet shown this
 * session. Repos without a quality score count as average.
 */
export function discoveryScore(r: Repo, now: number, seen: boolean): number {
  if (seen) return 0
  const years = (now - Date.parse(r.starredAt)) / YEAR
  return (r.quality ?? 0.5) * sat(years / 3) * (r.archived ? 0.2 : 1) * activityBoost(r.pushedAt, now)
}

/**
 * Samples one of the top-scoring stars, weighted by score, among `eligible` (the filter mask).
 * Returns null when nothing scores above zero.
 */
export function pickForgotten(
  repos: readonly Repo[],
  now: number,
  seen: ReadonlySet<number>,
  rand: () => number,
  eligible?: Uint8Array,
): number | null {
  const scored: [number, number][] = []
  repos.forEach((r, i) => {
    if (eligible && !eligible[i]) return
    const s = discoveryScore(r, now, seen.has(i))
    if (s > 0) scored.push([i, s])
  })
  if (scored.length === 0) return null
  const pool = scored.sort((a, b) => b[1] - a[1]).slice(0, POOL)
  const total = pool.reduce((t, [, s]) => t + s, 0)
  let x = rand() * total
  for (const [i, s] of pool) {
    x -= s
    if (x <= 0) return i
  }
  return pool[pool.length - 1]![0]
}

/** For example "You starred this 3 years ago — still actively maintained." */
export function forgottenReason(r: Repo, now: number): string {
  const years = Math.round((now - Date.parse(r.starredAt)) / YEAR)
  const when = years >= 2 ? `${years} years ago` : years === 1 ? 'a year ago' : 'a while ago'
  const pushedYears = r.pushedAt ? (now - Date.parse(r.pushedAt)) / YEAR : Infinity
  const state = r.archived
    ? 'it has since been archived'
    : pushedYears < 0.25
      ? 'still actively maintained'
      : pushedYears < 1
        ? 'still maintained'
        : 'quiet since then'
  return `You starred this ${when} — ${state}.`
}
