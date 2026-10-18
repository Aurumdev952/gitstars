import type { GalaxyIndex } from './load'

/** Everything that decides a star's aDyn target. */
export type Emphasis = {
  hovered: number | null
  selected: number | null
  hoveredCluster: string | null
  focusCluster: string | null
  /** The filter mask; null shows everything. */
  visible: Uint8Array | null
  /** Filtered-out stars stay as small dim ghosts instead of vanishing. */
  ghosts: boolean
  /** Search hits to pulse; everything else dims while a search is active. */
  hits: readonly number[] | null
}

export const HIGHLIGHT = { selected: 1, hovered: 0.85, neighbor: 0.6, cluster: 0.35, hit: 0.3 } as const
/** Ghost vis: below picking's 0.5 cut-off, and the shader fades vis < 1 toward ~10% brightness. */
export const GHOST_VIS = 0.3

/** Writes (vis, highlight, focus, pulse) targets for every star into `out` (length 4n). */
export function writeDynTargets(g: GalaxyIndex, e: Emphasis, out: Float32Array) {
  const hidden = e.ghosts ? GHOST_VIS : 0
  const baseFocus = e.focusCluster || e.hits ? 0 : 1
  for (let i = 0; i < g.n; i++) {
    const vis = e.visible && !e.visible[i] ? hidden : 1
    out[i * 4] = vis
    out[i * 4 + 1] = 0
    out[i * 4 + 2] = baseFocus
    out[i * 4 + 3] = 0
  }
  const raise = (i: number, h: number) => {
    if (out[i * 4 + 1]! < h) out[i * 4 + 1] = h
  }
  const lit = (i: number) => (out[i * 4 + 2] = 1)

  const members = e.focusCluster ? g.clusterById.get(e.focusCluster)?.members ?? [] : null
  if (e.hits) {
    // Inside a focused cluster only its hits stay lit; elsewhere every hit does.
    const inFocus = members ? new Set(members) : null
    for (const i of e.hits) {
      if (!inFocus || inFocus.has(i)) lit(i)
      out[i * 4 + 3] = 1
      raise(i, HIGHLIGHT.hit)
    }
  } else if (members) {
    for (const i of members) lit(i)
  }
  if (e.hoveredCluster) {
    for (const i of g.clusterById.get(e.hoveredCluster)?.members ?? []) raise(i, HIGHLIGHT.cluster)
  }
  const anchor = e.hovered ?? e.selected
  if (anchor !== null) {
    for (const [j] of g.repos[anchor]!.neighbors) {
      raise(j, HIGHLIGHT.neighbor)
      lit(j)
    }
  }
  for (const i of [e.hovered, e.selected]) {
    if (i === null) continue
    lit(i)
    if (out[i * 4]! < 1) out[i * 4] = 1
  }
  if (e.hovered !== null) raise(e.hovered, HIGHLIGHT.hovered)
  if (e.selected !== null) raise(e.selected, HIGHLIGHT.selected)
}
