import type { Repo } from './schema'
import type { ClusterNode } from './load'

/**
 * A cluster's members as the panel lists them: the core brightest first, then the loosely placed
 * ones (outliers), also brightest first. `visible` drops members the filters hide.
 */
export function memberGroups(c: Pick<ClusterNode, 'members' | 'core'>, repos: readonly Pick<Repo, 'stars'>[], visible: ArrayLike<number> | null) {
  const inCore = new Set(c.core)
  const byStars = (a: number, b: number) => repos[b]!.stars - repos[a]!.stars || a - b
  const shown = visible ? c.members.filter((i) => visible[i]) : [...c.members]
  return {
    core: shown.filter((i) => inCore.has(i)).sort(byStars),
    loose: shown.filter((i) => !inCore.has(i)).sort(byStars),
  }
}
