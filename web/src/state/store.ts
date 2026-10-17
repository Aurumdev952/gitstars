import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import type { GalaxyIndex } from '#/lib/load'
import { navigateSearch } from './url'

export type View = '3d' | 'flat' | 'list'

export type Settings = {
  quality: 'low' | 'med' | 'high'
  motion: 'full' | 'reduced'
  autorotate: boolean
  labels: 'auto' | 'more' | 'none'
  bloom: boolean
}

export type GalaxyStore = {
  galaxy: GalaxyIndex | null
  // Mirrored one way from the URL by routes/index.tsx. Never set these directly from UI code.
  selected: number | null
  focusCluster: string | null
  view: View
  // Transient.
  hovered: number | null
  hoveredCluster: string | null
  cameraBusy: boolean
  dragging: boolean
  frozen: boolean
  settings: Settings
  actions: {
    setGalaxy(g: GalaxyIndex): void
    mirrorUrl(m: { selected: number | null; focusCluster: string | null; view: View; frozen: boolean }): void
    hover(i: number | null): void
    hoverCluster(id: string | null): void
    select(i: number | null): void
    focus(id: string | null): void
    setCameraBusy(b: boolean): void
    setDragging(b: boolean): void
  }
}

const prefersReducedMotion = () =>
  typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

export const useGalaxyStore = create<GalaxyStore>()(
  subscribeWithSelector((set, get) => ({
    galaxy: null,
    selected: null,
    focusCluster: null,
    view: '3d',
    hovered: null,
    hoveredCluster: null,
    cameraBusy: false,
    dragging: false,
    frozen: false,
    settings: {
      quality: 'high',
      motion: prefersReducedMotion() ? 'reduced' : 'full',
      autorotate: true,
      labels: 'auto',
      bloom: true,
    },
    actions: {
      setGalaxy: (galaxy) => set({ galaxy, hovered: null }),
      mirrorUrl: (m) => set(m),
      hover: (hovered) => {
        if (get().hovered !== hovered) set({ hovered })
      },
      hoverCluster: (hoveredCluster) => set({ hoveredCluster }),
      select: (i) => {
        const g = get().galaxy
        navigateSearch({ repo: i === null || !g ? undefined : g.repos[i]!.fullName })
      },
      focus: (id) => navigateSearch({ cluster: id ?? undefined, repo: undefined }),
      setCameraBusy: (cameraBusy) => set({ cameraBusy }),
      setDragging: (dragging) => set({ dragging }),
    },
  })),
)
