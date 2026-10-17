// CPU mirror of shaders/chunks/layout.glsl. Picking, labels and the Director read positions from
// here, so any change to the shader's position math must land in both places (layout.test.ts).

export type LayoutUniforms = {
  flat: number
  intro: number
  introOrigin: readonly [number, number, number]
  timeline: number
  timelineOn: boolean
  birthWindow: number
}

export const RESTING_LAYOUT: LayoutUniforms = {
  flat: 0,
  intro: 1,
  introOrigin: [0, 0, 0],
  timeline: 1,
  timelineOn: false,
  birthWindow: 0.02,
}

export type LayoutAttributes = {
  pos: Float32Array
  pos2: Float32Array
  seed: Float32Array
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

  const t = clamp01((u.intro - a.seed[i]! * 0.45) / 0.55)
  const e = 1 - (1 - t) ** 3
  if (e < 1) {
    const [ox, oy, oz] = u.introOrigin
    const ang = (1 - e) * 2.4
    const c = Math.cos(ang)
    const s = Math.sin(ang)
    const dx = x - ox
    const dz = z - oz
    x = ox + (dx * c + dz * s) * e
    y = oy + (y - oy) * e
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

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

export function smoothstep(e0: number, e1: number, x: number) {
  const t = clamp01((x - e0) / (e1 - e0))
  return t * t * (3 - 2 * t)
}
