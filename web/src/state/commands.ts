import { sceneBus, starScreenPosition } from '#/components/galaxy/sceneBus'
import { pickForgotten } from '#/lib/discovery'
import { NO_FILTERS } from '#/lib/filters'
import { mulberry32 } from '#/lib/random'
import { spatialNeighbor, type Direction, type ScreenStar } from '#/lib/spatialNav'
import { useGalaxyStore } from './store'
import { navigateSearch } from './url'
import { timeline } from './timeline'

// User-level actions shared by the keyboard map, the palette and the HUD buttons.

const get = () => useGalaxyStore.getState()

const seen = new Set<number>()
let rand: () => number = Math.random
let neighborCycle: { origin: number; k: number; landed: number } | null = null

/** `?seed` makes the Forgotten-star draw reproducible for screenshots and tests. */
export function seedDiscovery(seed: number | null) {
  rand = seed === null ? Math.random : mulberry32(seed)
  seen.clear()
}

/** The list `[` and `]` walk: search hits, else the focused cluster's members by stars. */
function currentList(): number[] {
  const s = get()
  if (s.hits && s.hits.idx.length > 0) return s.hits.idx
  if (s.focusCluster && s.galaxy) {
    const g = s.galaxy
    return [...(g.clusterById.get(s.focusCluster)?.members ?? [])].sort((a, b) => g.repos[b]!.stars - g.repos[a]!.stars)
  }
  return []
}

function visibleOnScreen(): ScreenStar[] {
  const s = get()
  const g = s.galaxy
  if (!g) return []
  const { width, height } = sceneBus.size
  const out: ScreenStar[] = []
  for (let i = 0; i < g.n; i++) {
    if (s.filtered && !s.filtered.visible[i]) continue
    const p = starScreenPosition(g, i)
    if (p && p.x >= 0 && p.y >= 0 && p.x <= width && p.y <= height) out.push({ i, x: p.x, y: p.y })
  }
  return out
}

export const commands = {
  openPalette: () => get().actions.setOverlay('palette'),
  openShortcuts: () => get().actions.setOverlay('shortcuts'),
  openFilters: () => get().actions.setOverlay('filters'),

  home() {
    const s = get()
    if (s.selected !== null || s.focusCluster !== null) navigateSearch({ repo: undefined, cluster: undefined })
    else void sceneBus.director?.home()
  },

  toggleFlat: () => get().actions.setView(get().view === 'flat' ? '3d' : 'flat'),
  toggleList: () => get().actions.setView(get().view === 'list' ? '3d' : 'list'),
  toggleTimeline() {
    if (get().view === 'list') get().actions.setView('3d')
    timeline.toggle()
  },
  playPause: () => timeline.playPause(),

  forgottenStar() {
    const s = get()
    const g = s.galaxy
    if (!g) return
    const now = Date.parse(g.data.meta.generatedAt)
    let i = pickForgotten(g.repos, now, seen, rand, s.filtered?.visible)
    if (i === null) {
      seen.clear()
      i = pickForgotten(g.repos, now, seen, rand, s.filtered?.visible)
    }
    if (i === null) return
    seen.add(i)
    s.actions.setDiscovered(i)
    s.actions.select(i)
  },

  lens: (q: string) => get().actions.setLens(q),
  clearLens: () => get().actions.setLens(null),
  clearQuery: () => get().actions.setQuery(null),
  clearFilters: () => get().actions.setFilters(NO_FILTERS),

  focusGalaxy(k: number) {
    const g = get().galaxy?.galaxies[k]
    if (g) get().actions.focus(g.id)
  },

  /** Esc: close an overlay, then deselect, then leave the cluster, then drop lens and search. */
  stepOut() {
    const s = get()
    if (s.overlay !== 'none') return s.actions.setOverlay('none')
    if (s.selected !== null) return s.actions.select(null)
    if (s.focusCluster !== null) return s.actions.focus(null)
    if (s.lensQuery) return s.actions.setLens(null)
    if (s.query) return s.actions.setQuery(null)
    if (s.view === 'list') return s.actions.setView('3d')
  },

  /** n / N: step through the selected star's neighbours, staying anchored on the first star. */
  cycleNeighbor(step: 1 | -1) {
    const s = get()
    const g = s.galaxy
    if (!g || s.selected === null) return
    if (!neighborCycle || neighborCycle.landed !== s.selected) neighborCycle = { origin: s.selected, k: step > 0 ? -1 : 0, landed: s.selected }
    const list = g.repos[neighborCycle.origin]!.neighbors
    if (list.length === 0) return
    neighborCycle.k = (neighborCycle.k + step + list.length) % list.length
    const next = list[neighborCycle.k]![0]
    neighborCycle.landed = next
    s.actions.select(next)
  },

  /** [ / ]: previous or next in the current hits or cluster members. */
  cycleList(step: 1 | -1) {
    const s = get()
    const list = currentList()
    if (list.length === 0) return
    const at = s.selected === null ? -1 : list.indexOf(s.selected)
    const k = at < 0 ? (step > 0 ? 0 : list.length - 1) : (at + step + list.length) % list.length
    s.actions.select(list[k]!)
  },

  /** Arrows with a star selected: the nearest visible star in that screen direction. */
  spatial(dir: Direction): boolean {
    const s = get()
    const g = s.galaxy
    if (!g || s.selected === null) return false
    const p = starScreenPosition(g, s.selected)
    if (!p) return false
    const next = spatialNeighbor(visibleOnScreen(), { i: s.selected, x: p.x, y: p.y }, dir)
    if (next !== null) s.actions.select(next)
    return true
  },

  /** Arrows with nothing selected orbit the camera. */
  orbit(dir: Direction) {
    const c = sceneBus.controls
    if (!c) return
    const step = 0.12
    if (dir === 'left') void c.rotate(-step, 0, true)
    else if (dir === 'right') void c.rotate(step, 0, true)
    else if (dir === 'up') void c.rotate(0, -step, true)
    else void c.rotate(0, step, true)
  },
}
