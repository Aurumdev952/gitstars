import { describe, expect, it } from 'vitest'
import { fixtureGalaxy as g } from '#/test/fixture'
import { NO_FILTERS, activeFacets, applyFilters, filterColumns, starBin, toggleValue, type Filters } from './filters'

const cols = filterColumns(g)
const now = Date.parse(g.data.meta.generatedAt)
const DAY = 86_400_000

/** Brute-force oracle written from the facet definitions, independent of applyFilters. */
function passes(i: number, f: Filters, skip?: keyof Filters): boolean {
  const r = g.repos[i]!
  const lang = r.language ?? 'None'
  const pushedDays = r.pushedAt ? (now - Date.parse(r.pushedAt)) / DAY : Infinity
  const month = r.starredAt.slice(0, 7)
  return (
    (skip === 'kind' || f.kind.length === 0 || f.kind.includes(r.kind)) &&
    (skip === 'lang' || f.lang.length === 0 || f.lang.includes(lang)) &&
    (skip === 'tag' || f.tag.length === 0 || r.tags.some((t) => f.tag.includes(t))) &&
    (skip === 'stars' || !f.stars || (r.stars >= f.stars[0] && r.stars <= f.stars[1])) &&
    (skip === 'pushed' || f.pushed === 'any' || pushedDays <= (f.pushed === '1y' ? 365 : 182)) &&
    (skip === 'archived' || f.archived === 'include' || r.archived === (f.archived === 'only')) &&
    (skip === 'starred' || !f.starred || (month >= f.starred[0] && month <= f.starred[1]))
  )
}

const busy: Filters = {
  kind: ['library', 'cli', 'framework'],
  lang: ['Rust', 'TypeScript', 'Python', 'Go'],
  tag: [],
  stars: [200, 80_000],
  pushed: '1y',
  archived: 'exclude',
  starred: ['2021-01', '2025-12'],
}

describe('applyFilters', () => {
  it('shows everything with no filters', () => {
    const r = applyFilters(cols, NO_FILTERS)
    expect(r.count).toBe(g.n)
    expect(r.visible.every((v) => v === 1)).toBe(true)
  })

  it('keeps exactly the stars that pass every active facet', () => {
    const r = applyFilters(cols, busy)
    const expected = g.repos.map((_, i) => (passes(i, busy) ? 1 : 0))
    expect(Array.from(r.visible)).toEqual(expected)
    expect(r.count).toBe(expected.filter(Boolean).length)
    expect(r.count).toBeGreaterThan(0)
    expect(r.count).toBeLessThan(g.n)
  })

  it('counts each facet under every other facet but not its own', () => {
    const { facets } = applyFilters(cols, busy)
    const kindCounts = new Map<string, number>()
    const langCounts = new Map<string, number>()
    let archived = 0
    g.repos.forEach((r, i) => {
      if (passes(i, busy, 'kind')) kindCounts.set(r.kind, (kindCounts.get(r.kind) ?? 0) + 1)
      if (passes(i, busy, 'lang')) langCounts.set(r.language ?? 'None', (langCounts.get(r.language ?? 'None') ?? 0) + 1)
      if (passes(i, busy, 'archived') && r.archived) archived++
    })
    expect(facets.kind).toEqual(kindCounts)
    expect(facets.lang).toEqual(langCounts)
    expect(facets.archived.archived).toBe(archived)
    // A kind that is not selected still reports how many stars selecting it would add.
    expect([...facets.kind.keys()].some((k) => !busy.kind.includes(k as never))).toBe(true)
  })

  it('bins star counts and starred months for the histograms', () => {
    const { facets } = applyFilters(cols, NO_FILTERS)
    expect(facets.stars.reduce((a, b) => a + b, 0)).toBe(g.n)
    expect(facets.starred.reduce((a, b) => a + b, 0)).toBe(g.n)
    expect(cols.months[0]! <= cols.months[cols.months.length - 1]!).toBe(true)
    expect(starBin(1)).toBe(0)
    expect(starBin(100)).toBe(4)
    expect(starBin(1000)).toBe(6)
  })

  it('treats tag values as alternatives', () => {
    const tagged = g.repos.find((r) => r.tags.length >= 2)!
    const [a, b] = tagged.tags as [string, string]
    const either = applyFilters(cols, { ...NO_FILTERS, tag: [a, b] })
    const onlyA = applyFilters(cols, { ...NO_FILTERS, tag: [a] })
    expect(either.count).toBeGreaterThanOrEqual(onlyA.count)
    expect(either.count).toBe(g.repos.filter((r) => r.tags.includes(a) || r.tags.includes(b)).length)
  })
})

describe('filter edits', () => {
  it('toggles a value in and out of a facet', () => {
    const on = toggleValue(NO_FILTERS, 'kind', 'cli')
    expect(on.kind).toEqual(['cli'])
    expect(toggleValue(on, 'kind', 'cli').kind).toEqual([])
  })

  it('lists only the facets that constrain something', () => {
    expect(activeFacets(NO_FILTERS)).toEqual([])
    expect(activeFacets(busy)).toEqual(['kind', 'lang', 'stars', 'pushed', 'archived', 'starred'])
  })
})
