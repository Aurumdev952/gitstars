import { z } from 'zod'
import { Kind } from '#/lib/schema'
import { NO_FILTERS, type Filters } from '#/lib/filters'

const flag = z
  .union([z.boolean(), z.number(), z.string()])
  .optional()
  .transform((v) => v !== undefined && v !== false && v !== 0 && v !== 'false' && v !== '0')

// A hand-written link says `?lang=Rust`; the router itself writes `?lang=%5B%22Rust%22%5D`.
const list = <T extends z.ZodType>(item: T) =>
  z
    .preprocess((v) => (v !== null && typeof v !== 'object' ? [String(v)] : v), z.array(item))
    .optional()
    .catch(undefined)
const month = z.string().regex(/^\d{4}-\d{2}$/)
// Over-long text is cut rather than dropped, so a pasted paragraph still searches.
const text = z
  .string()
  .transform((s) => s.trim().slice(0, 200) || undefined)
  .optional()
  .catch(undefined)

// The URL owns navigation and every filter. Repo and cluster push history; the rest replace.
export const searchSchema = z.object({
  repo: z.string().optional().catch(undefined),
  cluster: z
    .string()
    .regex(/^g\d{2}(\.s\d{2})?$/)
    .optional()
    .catch(undefined),
  view: z.enum(['3d', 'flat', 'list']).default('3d').catch('3d'),
  q: text,
  lens: text,
  kind: list(Kind),
  lang: list(z.string()),
  tag: list(z.string()),
  stars: z
    .tuple([z.number().min(0), z.number().min(0)])
    .refine(([a, b]) => a <= b)
    .optional()
    .catch(undefined),
  pushed: z.enum(['any', '1y', '6m']).default('any').catch('any'),
  archived: z.enum(['include', 'exclude', 'only']).default('include').catch('include'),
  starred: z
    .tuple([month, month])
    .refine(([a, b]) => a <= b)
    .optional()
    .catch(undefined),
  // Present only while the timeline is open; its absence, not a default, means closed.
  t: z.coerce.number().min(0).max(1).optional().catch(undefined),
  data: z.string().optional().catch(undefined),
  debug: flag,
  freeze: flag,
  seed: z.coerce.number().optional().catch(undefined),
})

export type GalaxySearch = z.infer<typeof searchSchema>
export const searchDefaults = { view: '3d', pushed: 'any', archived: 'include', debug: false, freeze: false } as const

export function filtersFromSearch(s: GalaxySearch): Filters {
  return {
    kind: s.kind ?? NO_FILTERS.kind,
    lang: s.lang ?? NO_FILTERS.lang,
    tag: s.tag ?? NO_FILTERS.tag,
    stars: s.stars ?? null,
    pushed: s.pushed,
    archived: s.archived,
    starred: s.starred ?? null,
  }
}

/** The search patch that represents `f`; empty facets become undefined so the URL stays clean. */
export function searchFromFilters(f: Filters): Pick<GalaxySearch, 'kind' | 'lang' | 'tag' | 'stars' | 'pushed' | 'archived' | 'starred'> {
  const many = <T>(v: readonly T[]) => (v.length ? [...v] : undefined)
  return {
    kind: many(f.kind),
    lang: many(f.lang),
    tag: many(f.tag),
    stars: f.stars ? [f.stars[0], f.stars[1]] : undefined,
    pushed: f.pushed,
    archived: f.archived,
    starred: f.starred ? [f.starred[0], f.starred[1]] : undefined,
  }
}

type Navigate = (opts: { search: (prev: GalaxySearch) => GalaxySearch; replace?: boolean }) => void
let navigateImpl: Navigate | null = null

export function bindNavigate(fn: Navigate) {
  navigateImpl = fn
}

/** Push for repo and cluster so Back retraces visited stars; replace for everything else. */
export function navigateSearch(patch: Partial<GalaxySearch>, opts: { replace?: boolean } = {}) {
  navigateImpl?.({ search: (prev) => ({ ...prev, ...patch }), replace: opts.replace ?? false })
}
