import { describe, expect, it } from 'vitest'
import { NO_FILTERS, type Filters } from '#/lib/filters'
import { filtersFromSearch, searchDefaults, searchFromFilters, searchSchema } from './url'

const parse = (raw: Record<string, unknown>) => searchSchema.parse(raw)

describe('search params', () => {
  it('round-trips every filter facet through the URL patch', () => {
    const f: Filters = {
      kind: ['cli', 'library'],
      lang: ['Rust'],
      tag: ['wasm', 'gpu'],
      stars: [100, 50_000],
      pushed: '6m',
      archived: 'exclude',
      starred: ['2020-03', '2024-11'],
    }
    const s = parse({ ...searchFromFilters(f), q: 'vector db', lens: 'shaders' })
    expect(filtersFromSearch(s)).toEqual(f)
    expect(s.q).toBe('vector db')
    expect(s.lens).toBe('shaders')
  })

  it('maps no filters to an empty patch that the defaults strip', () => {
    const patch = searchFromFilters(NO_FILTERS)
    expect(patch.kind).toBeUndefined()
    expect(patch.stars).toBeUndefined()
    expect(patch.pushed).toBe(searchDefaults.pushed)
    expect(patch.archived).toBe(searchDefaults.archived)
    expect(filtersFromSearch(parse({}))).toEqual(NO_FILTERS)
  })

  it('drops malformed values instead of failing the route', () => {
    const s = parse({ kind: ['nope'], stars: [10, 1], starred: ['2020', '2021-01'], view: 'cube', q: '   ', cluster: 'x' })
    expect(s.kind).toBeUndefined()
    expect(s.stars).toBeUndefined()
    expect(s.starred).toBeUndefined()
    expect(s.view).toBe('3d')
    expect(s.q).toBeUndefined()
    expect(s.cluster).toBeUndefined()
  })
})
