import { z } from 'zod'

// Mirrors contract/galaxy.schema.json, which is authoritative. schema.test.ts checks both agree.

const dateTime = z.iso.datetime({ offset: true })
const vec3 = z.tuple([z.number(), z.number(), z.number()])
const vec2 = z.tuple([z.number(), z.number()])
const index = z.int().min(0)

export const Kind = z.enum([
  'library',
  'framework',
  'app',
  'cli',
  'tool',
  'service',
  'model',
  'dataset',
  'awesome-list',
  'tutorial',
  'template',
  'other',
])
export type Kind = z.infer<typeof Kind>

export const Embedding = z.strictObject({
  model: z.string(),
  browserModel: z.string(),
  dims: z.literal(256),
  dtype: z.literal('float16'),
  normalized: z.literal(true),
  queryPrefix: z.string(),
  docPrefix: z.string(),
})

export const Meta = z.strictObject({
  generatedAt: dateTime,
  viewer: z.string(),
  counts: z.strictObject({
    repos: index,
    galaxies: index,
    systems: index,
    summarized: index,
  }),
  bounds: z.strictObject({ min: vec3, max: vec3 }),
  starredRange: z.tuple([dateTime, dateTime]),
  embedding: Embedding,
  searchProbes: z.array(
    z.strictObject({
      query: z.string(),
      topIdx: z.array(index).max(10),
    }),
  ),
})

export const Cluster = z.strictObject({
  id: z.string().regex(/^g\d{2}(\.s\d{2})?$/),
  level: z.union([z.literal(0), z.literal(1)]),
  parentId: z.string().nullable(),
  name: z.string().min(1),
  blurb: z.string(),
  keywords: z.array(z.string()),
  centroid: vec3,
  radius: z.number().min(0),
  members: z.array(index),
})
export type Cluster = z.infer<typeof Cluster>

export const Repo = z.strictObject({
  fullName: z.string().regex(/^[^/]+\/[^/]+$/),
  url: z.string(),
  homepage: z.string().nullable(),
  description: z.string().nullable(),
  oneLiner: z.string(),
  summary: z.string().nullable(),
  kind: Kind,
  domain: z.string().nullable(),
  tags: z.array(z.string()),
  stack: z.array(z.string()),
  language: z.string().nullable(),
  stars: index,
  pushedAt: dateTime.nullable(),
  starredAt: dateTime,
  archived: z.boolean(),
  pos: vec3,
  pos2: vec2,
  galaxyId: z.string(),
  systemId: z.string(),
  outlier: z.boolean(),
  neighbors: z.array(z.tuple([index, z.number()])).max(8),
  quality: z.number().min(0).max(1).nullable(),
  summarized: z.boolean(),
})
export type Repo = z.infer<typeof Repo>

export const GalaxyData = z.strictObject({
  schemaVersion: z.literal(1),
  meta: Meta,
  clusters: z.array(Cluster),
  repos: z.array(Repo),
})
export type GalaxyData = z.infer<typeof GalaxyData>
