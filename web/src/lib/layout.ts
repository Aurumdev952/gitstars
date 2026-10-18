// CPU mirror of shaders/chunks/layout.glsl. Picking, labels and the Director read positions from
// here, so any change to the shader's position math must land in both places. layout.test.ts pins
// this side's formula; nothing runs the GLSL, so keeping the two in step is a review duty.

export type LayoutUniforms = {
  flat: number
  intro: number
  introOrigin: readonly [number, number, number]
  /** Spiral arms wind by distance over this radius. */
  introRadius: number
  timeline: number
  timelineOn: boolean
  birthWindow: number
}

export const RESTING_LAYOUT: LayoutUniforms = {
  flat: 0,
  intro: 1,
  introOrigin: [0, 0, 0],
  introRadius: 100,
  timeline: 1,
  timelineOn: false,
  birthWindow: 0.02,
}

export type LayoutAttributes = {
  pos: Float32Array
  pos2: Float32Array
  /** Intro launch delay in uIntro units (lib/intro.ts introDelay). */
  delay: Float32Array
  starred: Float32Array
}

export function positionAt(
  a: LayoutAttributes,
  i: number,
  u: LayoutUniforms,
  out: [number, number, number] = [0, 0, 0],
): [number, number, number] {
  const o = i * 3
  let x = a.pos[o]! + (a.pos2[o]! - a.pos[o]!) * u.flat
  let y = a.pos[o + 1]! + (a.pos2[o + 1]! - a.pos[o + 1]!) * u.flat
  let z = a.pos[o + 2]! + (a.pos2[o + 2]! - a.pos[o + 2]!) * u.flat

  const t = clamp01((u.intro - a.delay[i]!) / 0.55)
  const e = 1 - (1 - t) ** 3
  if (e < 1) {
    const [ox, oy, oz] = u.introOrigin
    const dx = x - ox
    const dy = y - oy
    const dz = z - oz
    const ang = (1 - e) * (1.4 + (2.6 * Math.hypot(dx, dy, dz)) / Math.max(u.introRadius, 1))
    const c = Math.cos(ang)
    const s = Math.sin(ang)
    x = ox + (dx * c + dz * s) * e
    y = oy + dy * e * e
    z = oz + (-dx * s + dz * c) * e
  }
  out[0] = x
  out[1] = y
  out[2] = z
  return out
}

export function bornAt(a: LayoutAttributes, i: number, u: LayoutUniforms): number {
  if (!u.timelineOn) return 1
  return smoothstep(a.starred[i]!, a.starred[i]! + u.birthWindow, u.timeline)
}

export type StarSizeUniforms = { sizeScale: number; minPx: number; maxPx: number }

/** Sprite radius in CSS pixels; mirrors the pixel-size block of star.vert.glsl. */
export function starPixelRadius(
  size: number,
  highlight: number,
  vis: number,
  born: number,
  viewDist: number,
  projYY: number,
  viewportHeightCss: number,
  s: StarSizeUniforms,
): number {
  const world = s.sizeScale * (0.6 + 1.8 * size) * (1 + 0.6 * highlight) * vis * born
  const px = (world * projYY * 0.5 * viewportHeightCss) / Math.max(0.001, viewDist)
  return Math.min(s.maxPx, Math.max(s.minPx * vis * born, px))
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

export function smoothstep(e0: number, e1: number, x: number) {
  const t = clamp01((x - e0) / (e1 - e0))
  return t * t * (3 - 2 * t)
}
