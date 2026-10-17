import type { GalaxyIndex } from './load'

/** Everything that decides a star's aDyn target. Filters, cluster focus and search hits join here. */
export type Emphasis = {
  hovered: number | null
  selected: number | null
  hoveredCluster: string | null
}

export const HIGHLIGHT = { selected: 1, hovered: 0.85, neighbor: 0.6, cluster: 0.35 } as const

/** Writes (vis, highlight, focus, pulse) targets for every star into `out` (length 4n). */
export function writeDynTargets(g: GalaxyIndex, e: Emphasis, out: Float32Array) {
  for (let i = 0; i < g.n; i++) out.set([1, 0, 1, 0], i * 4)
  const raise = (i: number, h: number) => {
    if (out[i * 4 + 1]! < h) out[i * 4 + 1] = h
  }
  if (e.hoveredCluster) {
    for (const i of g.clusterById.get(e.hoveredCluster)?.members ?? []) raise(i, HIGHLIGHT.cluster)
  }
  const anchor = e.hovered ?? e.selected
  if (anchor !== null) for (const [j] of g.repos[anchor]!.neighbors) raise(j, HIGHLIGHT.neighbor)
  if (e.hovered !== null) raise(e.hovered, HIGHLIGHT.hovered)
  if (e.selected !== null) raise(e.selected, HIGHLIGHT.selected)
}
