export type Tier = 'low' | 'med' | 'high'
/** What the settings menu stores: a fixed tier, or let the frame-rate monitor choose. */
export type QualitySetting = 'auto' | Tier

export type TierSpec = {
  /** Device-pixel-ratio range handed to the canvas. */
  dpr: [number, number]
  bloomLevels: number
  chromaticAberration: boolean
  noise: boolean
  bokeh: boolean
}

/**
 * The post chain dominates frame time (about 10 ms of it at 1600×900 on an integrated GPU), so the
 * first step down trims bloom mip levels and the aberration pass; only the last one drops pixels.
 */
export const TIERS: Record<Tier, TierSpec> = {
  high: { dpr: [1, 2], bloomLevels: 7, chromaticAberration: true, noise: true, bokeh: true },
  med: { dpr: [1, 2], bloomLevels: 4, chromaticAberration: false, noise: true, bokeh: true },
  low: { dpr: [1, 1], bloomLevels: 3, chromaticAberration: false, noise: false, bokeh: false },
}

const ORDER: Tier[] = ['low', 'med', 'high']

/** One tier up or down, clamped at the ends. */
export function stepTier(t: Tier, dir: 'up' | 'down'): Tier {
  const k = ORDER.indexOf(t) + (dir === 'up' ? 1 : -1)
  return ORDER[Math.min(ORDER.length - 1, Math.max(0, k))]!
}

/** A fixed setting wins; `auto` follows the monitor. */
export const effectiveTier = (setting: QualitySetting, auto: Tier): Tier => (setting === 'auto' ? auto : setting)
