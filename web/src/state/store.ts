import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import type { GalaxyIndex } from '#/lib/load'
import { NO_FILTERS, applyFilters, filterColumns, type Filters, type FilterResult } from '#/lib/filters'
import type { SearchHits } from '#/lib/search'
import type { Device } from '#/workers/embedder'
import type { QualitySetting, Tier } from '#/lib/quality'
import { navigateSearch, searchFromFilters } from './url'

export type View = '3d' | 'flat' | 'list'

/**
 * Where the opening choreography is: the spiral (HUD held back), settling (HUD and labels arriving),
 * the reduced-motion fade, or done. A deep link starts at done.
 */
export type IntroPhase = 'spiral' | 'settling' | 'fade' | 'done'

export type Settings = {
  quality: QualitySetting
  motion: 'full' | 'reduced'
  autorotate: boolean
  labels: 'auto' | 'more' | 'none'
  ghosts: boolean
}

export type PlaySpeed = 0.5 | 1 | 2

/** The cursor itself lives outside React, in `state/timeline.ts`, so scrubbing never re-renders the scene. */
export type TimelineState = { open: boolean; playing: boolean; speed: PlaySpeed }

/** At most one modal surface is open; Esc closes it before stepping out of the scene. */
export type Overlay = 'none' | 'palette' | 'filters' | 'settings' | 'shortcuts'

export type ModelStatus =
  | { state: 'idle' }
  | { state: 'loading'; progress: number; device: Device | null }
  | { state: 'ready'; device: Device }
  | { state: 'error'; message: string }

export type LensState =
  | { state: 'off' }
  | { state: 'pending'; query: string }
  | { state: 'ready'; query: string; weights: Float32Array }
  | { state: 'error'; query: string; message: string }

export type UrlMirror = {
  selected: number | null
  focusCluster: string | null
  view: View
  frozen: boolean
  query: string | null
  lensQuery: string | null
  filters: Filters
}

export type GalaxyStore = UrlMirror & {
  galaxy: GalaxyIndex | null
  // Derived from `filters`; null until a galaxy is loaded.
  filtered: FilterResult | null
  // Transient.
  hovered: number | null
  hoveredCluster: string | null
  cameraBusy: boolean
  dragging: boolean
  overlay: Overlay
  model: ModelStatus
  hits: SearchHits | null
  lens: LensState
  /** The star the Forgotten-star button last surfaced; the panel explains why. */
  discovered: number | null
  settings: Settings
  intro: IntroPhase
  /** The tier the frame-rate monitor settled on; used when `settings.quality` is auto. */
  autoTier: Tier
  timeline: TimelineState
  actions: {
    setGalaxy(g: GalaxyIndex): void
    mirrorUrl(m: UrlMirror): void
    hover(i: number | null): void
    hoverCluster(id: string | null): void
    select(i: number | null): void
    focus(id: string | null): void
    setView(v: View): void
    setQuery(q: string | null): void
    setLens(q: string | null): void
    setFilters(f: Filters): void
    setOverlay(o: Overlay): void
    setModel(m: ModelStatus): void
    setHits(h: SearchHits | null): void
    setLensState(l: LensState): void
    setDiscovered(i: number | null): void
    setSettings(p: Partial<Settings>): void
    setCameraBusy(b: boolean): void
    setDragging(b: boolean): void
    setIntro(p: IntroPhase): void
    setAutoTier(t: Tier): void
    setTimeline(p: Partial<TimelineState>): void
  }
}

const prefersReducedMotion = () =>
  typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

const sameFilters = (a: Filters, b: Filters) => JSON.stringify(a) === JSON.stringify(b)

export const useGalaxyStore = create<GalaxyStore>()(
  subscribeWithSelector((set, get) => ({
    galaxy: null,
    selected: null,
    focusCluster: null,
    view: '3d',
    frozen: false,
    query: null,
    lensQuery: null,
    filters: NO_FILTERS,
    filtered: null,
    hovered: null,
    hoveredCluster: null,
    cameraBusy: false,
    dragging: false,
    overlay: 'none',
    model: { state: 'idle' },
    hits: null,
    lens: { state: 'off' },
    discovered: null,
    intro: 'done',
    autoTier: 'high',
    settings: {
      quality: 'auto',
      motion: prefersReducedMotion() ? 'reduced' : 'full',
      autorotate: true,
      labels: 'auto',
      ghosts: true,
    },
    timeline: { open: false, playing: false, speed: 1 },
    actions: {
      setGalaxy: (galaxy) =>
        set({ galaxy, hovered: null, hits: null, discovered: null, filtered: applyFilters(filterColumns(galaxy), get().filters) }),
      mirrorUrl: (m) => {
        const s = get()
        const filtersChanged = !sameFilters(m.filters, s.filters)
        const filters = filtersChanged ? m.filters : s.filters
        const filtered = s.galaxy && (filtersChanged || !s.filtered) ? applyFilters(filterColumns(s.galaxy), filters) : s.filtered
        set({ ...m, filters, filtered })
      },
      hover: (hovered) => {
        if (get().hovered !== hovered) set({ hovered })
      },
      hoverCluster: (hoveredCluster) => {
        if (get().hoveredCluster !== hoveredCluster) set({ hoveredCluster })
      },
      select: (i) => {
        const g = get().galaxy
        navigateSearch({ repo: i === null || !g ? undefined : g.repos[i]!.fullName })
      },
      focus: (id) => navigateSearch({ cluster: id ?? undefined, repo: undefined }),
      setView: (view) => navigateSearch({ view }, { replace: true }),
      setQuery: (q) => navigateSearch({ q: q?.trim() || undefined }, { replace: true }),
      setLens: (q) => navigateSearch({ lens: q?.trim() || undefined }, { replace: true }),
      setFilters: (f) => navigateSearch(searchFromFilters(f), { replace: true }),
      setOverlay: (overlay) => set({ overlay }),
      setModel: (model) => set({ model }),
      setHits: (hits) => set({ hits }),
      setLensState: (lens) => set({ lens }),
      setDiscovered: (discovered) => set({ discovered }),
      setSettings: (p) => set({ settings: { ...get().settings, ...p } }),
      setCameraBusy: (cameraBusy) => set({ cameraBusy }),
      setDragging: (dragging) => set({ dragging }),
      setAutoTier: (autoTier) => {
        if (get().autoTier !== autoTier) set({ autoTier })
      },
      setIntro: (intro) => {
        if (get().intro !== intro) set({ intro })
      },
      setTimeline: (p) => set({ timeline: { ...get().timeline, ...p } }),
    },
  })),
)
