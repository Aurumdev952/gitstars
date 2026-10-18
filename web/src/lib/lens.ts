/**
 * Maps raw cosines to display weights in [0, 1]. Embedding cosines bunch in a narrow band, so the
 * median maps to 0 and the 99.5th percentile to 1; the gamma keeps the hot end selective.
 */
export function lensWeights(scores: Float32Array, gamma = 1.4): Float32Array {
  const n = scores.length
  const out = new Float32Array(n)
  if (n === 0) return out
  const sorted = Float32Array.from(scores).sort()
  const lo = sorted[Math.floor(n * 0.5)]!
  const hi = Math.max(lo + 1e-4, sorted[Math.min(n - 1, Math.floor(n * 0.995))]!)
  for (let i = 0; i < n; i++) {
    const t = (scores[i]! - lo) / (hi - lo)
    out[i] = t <= 0 ? 0 : t >= 1 ? 1 : t ** gamma
  }
  return out
}

/** The lens ramp, cold to hot, as linear-RGB stops; star.frag.glsl and the legend share it. */
export const LENS_RAMP: readonly (readonly [number, number, number])[] = [
  [0.035, 0.045, 0.12],
  [0.2, 0.06, 0.42],
  [0.78, 0.13, 0.36],
  [1.0, 0.46, 0.09],
  [1.0, 0.9, 0.62],
]

export function lensRampCss(): string {
  const toSrgb = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)
  const stops = LENS_RAMP.map(
    (c, k) => `rgb(${c.map((v) => Math.round(toSrgb(v) * 255)).join(' ')}) ${Math.round((k / (LENS_RAMP.length - 1)) * 100)}%`,
  )
  return `linear-gradient(90deg, ${stops.join(', ')})`
}
