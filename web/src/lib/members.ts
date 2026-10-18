import type { Repo } from './schema'
import type { ClusterNode } from './load'

/**
 * A cluster's members as the panel lists them: the core brightest first, then the loosely placed
 * ones (outliers), also brightest first. `visible` drops members the filters hide. This splits on
 * `outlier` itself rather than `ClusterNode.core`, which falls back to every member for geometry
 * when all of them are outliers.
 */
export function memberGroups(c: Pick<ClusterNode, 'members'>, repos: readonly Pick<Repo, 'stars' | 'outlier'>[], visible: ArrayLike<number> | null) {
  const byStars = (a: number, b: number) => repos[b]!.stars - repos[a]!.stars || a - b
  const shown = visible ? c.members.filter((i) => visible[i]) : [...c.members]
  return {
    core: shown.filter((i) => !repos[i]!.outlier).sort(byStars),
    loose: shown.filter((i) => repos[i]!.outlier).sort(byStars),
  }
}
