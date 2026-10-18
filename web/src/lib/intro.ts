// The opening choreography (ui-design §4) as pure functions of time, so the scene, the HUD and
// the tests agree on what any moment of it looks like.

/** What is left of the intro: the full spiral, a reduced-motion fade, or nothing. */
export type IntroMode = 'full' | 'fade' | 'done'

export type IntroContext = {
  /** The URL lands somewhere specific: a repo, cluster, query, lens, timeline cursor or another view. */
  deepLink: boolean
  reducedMotion: boolean
  /** `?freeze`: deterministic screenshots start settled. */
  frozen: boolean
}

export function introMode(c: IntroContext): IntroMode {
  if (c.frozen || c.deepLink) return 'done'
  return c.reducedMotion ? 'fade' : 'full'
}

type DeepLinkSearch = { repo?: string; cluster?: string; q?: string; lens?: string; t?: number; view?: string }

export const isDeepLink = (s: DeepLinkSearch) =>
  Boolean(s.repo || s.cluster || s.q || s.lens || s.t !== undefined || (s.view && s.view !== '3d'))

export const INTRO = {
  /** Backdrop and dust fade in. */
  fade: [0, 0.6],
  /** uIntro runs 0 → 1: stars burst from a point and spiral out. */
  stars: [0.5, 3.2],
  /** Labels start appearing, one galaxy every 60 ms; HUD panels slide up. */
  labelsAt: 3.2,
  labelStagger: 0.06,
  labelFade: 0.45,
  /** The camera's start, relative to home: closer in, turned 30° back. */
  startDistance: 0.2,
  startAzimuth: -Math.PI / 6,
  end: 4.2,
  /** The reduced-motion replacement. */
  fadeOnly: 0.3,
} as const

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
const span = (t: number, [a, b]: readonly [number, number]) => clamp01((t - a) / (b - a))
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)
const easeOutQuart = (t: number) => 1 - (1 - t) ** 4

export type IntroFrame = {
  /** Canvas opacity. */
  fade: number
  /** The uIntro uniform. */
  intro: number
  /** Camera distance progress from the start pose (0) to home (1). */
  dolly: number
  /** Camera azimuth progress from the start pose (0) to home (1). */
  orbit: number
  /** Seconds since labels began appearing (negative before). */
  labelClock: number
  /** HUD panels are on screen. */
  hud: boolean
  done: boolean
}

export function introFrame(mode: IntroMode, t: number): IntroFrame {
  if (mode === 'done') return { fade: 1, intro: 1, dolly: 1, orbit: 1, labelClock: Infinity, hud: true, done: true }
  if (mode === 'fade') {
    const fade = span(t, [0, INTRO.fadeOnly])
    return { fade, intro: 1, dolly: 1, orbit: 1, labelClock: Infinity, hud: true, done: fade >= 1 }
  }
  const intro = span(t, INTRO.stars)
  return {
    fade: span(t, INTRO.fade),
    intro,
    // The camera backs off as fast as the earliest stars fly out (layout chunk: e of delay 0), so
    // the burst stays framed instead of swallowing the camera; the late stars land inside it.
    dolly: 1 - (1 - clamp01(intro / 0.55)) ** 3,
    // The 30° turn runs the whole spiral and eases out as the stars settle.
    orbit: easeInOutCubic(span(t, [INTRO.stars[0], INTRO.stars[1] + 0.4])),
    labelClock: t - INTRO.labelsAt,
    hud: t >= INTRO.labelsAt,
    done: t >= INTRO.end,
  }
}

/** A label's opacity factor: the `order`-th label fades in `order × stagger` after the first. */
export function labelReveal(clock: number, order: number): number {
  return easeOutQuart(clamp01((clock - order * INTRO.labelStagger) / INTRO.labelFade))
}

/** The camera pose along the intro, as a blend between the start pose and home. */
export function introCamera(f: Pick<IntroFrame, 'dolly' | 'orbit'>, home: { azimuth: number; distance: number }) {
  const startD = home.distance * INTRO.startDistance
  return {
    azimuth: home.azimuth + INTRO.startAzimuth * (1 - f.orbit),
    distance: startD + (home.distance - startD) * f.dolly,
  }
}

/**
 * Per-star launch delay in uIntro units. Galaxies leave in hue order, so the burst sweeps around
 * the colour wheel, and stars within a galaxy scatter by their seed. The total stays within the
 * 0.45 the layout chunk reserves (t = (uIntro − delay) / 0.55).
 */
export function introDelay(galaxyRank: number, galaxies: number, seed: number): number {
  const g = galaxies > 1 ? galaxyRank / (galaxies - 1) : 0
  return 0.27 * g + 0.18 * seed
}
