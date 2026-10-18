import { describe, expect, it } from 'vitest'
import { defaultParseSearch, defaultStringifySearch } from '@tanstack/react-router'
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

  it('survives the router\'s own query-string encoding', () => {
    const f: Filters = { ...NO_FILTERS, kind: ['cli'], tag: ['c++', 'a b'], stars: [10, 2_000], starred: ['2021-01', '2021-06'] }
    const qs = defaultStringifySearch({ ...searchFromFilters(f), q: 'vector & db?', lens: '#rust' })
    const back = parse(defaultParseSearch(qs))
    expect(filtersFromSearch(back)).toEqual(f)
    expect(back.q).toBe('vector & db?')
    expect(back.lens).toBe('#rust')
  })

  it('cuts an over-long query instead of dropping it', () => {
    expect(parse({ q: 'x'.repeat(500) }).q).toHaveLength(200)
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
