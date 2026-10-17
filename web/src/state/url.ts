import { z } from 'zod'

const flag = z
  .union([z.boolean(), z.number(), z.string()])
  .optional()
  .transform((v) => v !== undefined && v !== false && v !== 0 && v !== 'false' && v !== '0')

// The URL owns navigation. Filters, q, lens and t join this schema in later phases.
export const searchSchema = z.object({
  repo: z.string().optional().catch(undefined),
  cluster: z
    .string()
    .regex(/^g\d{2}(\.s\d{2})?$/)
    .optional()
    .catch(undefined),
  view: z.enum(['3d', 'flat', 'list']).default('3d').catch('3d'),
  data: z.string().optional().catch(undefined),
  debug: flag,
  freeze: flag,
  seed: z.coerce.number().optional().catch(undefined),
})

export type GalaxySearch = z.infer<typeof searchSchema>
export const searchDefaults = { view: '3d', debug: false, freeze: false } as const

type Navigate = (opts: { search: (prev: GalaxySearch) => GalaxySearch; replace?: boolean }) => void
let navigateImpl: Navigate | null = null

export function bindNavigate(fn: Navigate) {
  navigateImpl = fn
}

/** Push for repo and cluster so Back retraces visited stars; replace for everything else. */
export function navigateSearch(patch: Partial<GalaxySearch>, opts: { replace?: boolean } = {}) {
  navigateImpl?.({ search: (prev) => ({ ...prev, ...patch }), replace: opts.replace ?? false })
}
