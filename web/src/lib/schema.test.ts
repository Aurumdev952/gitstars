import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import Ajv2020 from 'ajv/dist/2020'
import addFormats from 'ajv-formats'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { GalaxyData } from './schema'

const at = (p: string) => fileURLToPath(new URL(p, import.meta.url))
const contract = JSON.parse(readFileSync(at('../../../contract/galaxy.schema.json'), 'utf8'))
const ajv = new Ajv2020({ allErrors: true, strict: true })
addFormats(ajv)
const validateContract = ajv.compile(contract)

const exports = [
  { name: 'fixture', path: at('../../public/data/fixture/galaxy.json') },
  { name: 'real export', path: at('../../public/data/galaxy.json') },
]

describe.each(exports)('$name galaxy.json', ({ path }) => {
  const present = existsSync(path)
  it.runIf(present)('passes the JSON Schema contract and the zod schema', () => {
    const data = JSON.parse(readFileSync(path, 'utf8'))
    const ok = validateContract(data)
    expect(ok ? [] : validateContract.errors?.slice(0, 5)).toEqual([])
    const parsed = GalaxyData.safeParse(data)
    expect(parsed.success ? [] : parsed.error.issues.slice(0, 5)).toEqual([])
  })
})

describe('zod schema and JSON Schema contract', () => {
  const fixture = JSON.parse(readFileSync(exports[0]!.path, 'utf8'))
  const mutations: [string, (d: any) => void][] = [
    ['extra repo field', (d) => (d.repos[0].clusterId = 'g00.s00')],
    ['missing repo field', (d) => delete d.repos[0].outlier],
    ['neighbor as object', (d) => (d.repos[0].neighbors[0] = { idx: 1, cos: 0.9 })],
    ['bad cluster id', (d) => (d.clusters[0].id = 'galaxy-0')],
    ['wrong dims', (d) => (d.meta.embedding.dims = 768)],
    ['quality above 1', (d) => (d.repos[0].quality = 1.2)],
    ['non-iso starredAt', (d) => (d.repos[0].starredAt = 'yesterday')],
    ['missing meta.bounds', (d) => delete d.meta.bounds],
  ]

  it.each(mutations)('both reject %s', (_name, mutate) => {
    const d = structuredClone(fixture)
    mutate(d)
    expect(validateContract(d)).toBe(false)
    expect(GalaxyData.safeParse(d).success).toBe(false)
  })

  it('declare the same properties and required keys on every object', () => {
    const fromZod = z.toJSONSchema(GalaxyData, { target: 'draft-2020-12' }) as any
    const shape = (s: any, defs: any): any => {
      if (s?.$ref) return shape(defs[s.$ref.split('/').pop()], defs)
      if (s?.type === 'object' || s?.properties) {
        return {
          required: [...(s.required ?? [])].sort(),
          props: Object.fromEntries(Object.entries(s.properties ?? {}).map(([k, v]) => [k, shape(v, defs)])),
        }
      }
      if (s?.type === 'array' && s.items && !s.prefixItems) {
        const items = shape(s.items, defs)
        return items && { items }
      }
      return null
    }
    expect(shape(fromZod, fromZod.$defs ?? {})).toEqual(shape(contract, contract.$defs))
  })
})
