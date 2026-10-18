import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { buildGalaxyIndex } from '#/lib/load'
import type { GalaxyData } from '#/lib/schema'

export const fixtureData: GalaxyData = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../public/data/fixture/galaxy.json', import.meta.url)), 'utf8'),
)

export const fixtureGalaxy = buildGalaxyIndex(fixtureData)
