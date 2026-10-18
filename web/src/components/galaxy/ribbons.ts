import {
  AdditiveBlending,
  BufferAttribute,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  ShaderMaterial,
} from 'three'
import { shaders } from '#/shaders'
import { sceneBus } from './sceneBus'

const QUAD = new Float32Array([0, -1, 0, 1, -1, 0, 1, 1, 0, 0, 1, 0])
const QUAD_INDEX = [0, 1, 2, 0, 2, 3]

type V3 = ArrayLike<number>

/** One ribbon segment. Mutated and written in place, so building a buffer allocates nothing per segment. */
export type Segment = {
  a: V3
  /** Flat-map position of A; set equal to `a` for curves already built in the current layout. */
  a2: V3
  b: V3
  b2: V3
  delayA: number
  delayB: number
  starredA: number
  starredB: number
  /** Curve parameter at A and B, for draw-on and the travelling pulse. */
  t0: number
  t1: number
  colorA: V3
  colorB: V3
  widthPx: number
  alpha: number
  /** Seconds after the draw clock starts before this segment draws on. */
  drawDelay: number
  galaxy: number
  /** Camera distances past a few multiples of this fade the segment out; 0 never fades. */
  fadeRadius: number
  phase: number
  /** System index for hover emphasis; −1 for none. */
  system: number
}

export const blankSegment = (): Segment => ({
  a: [0, 0, 0],
  a2: [0, 0, 0],
  b: [0, 0, 0],
  b2: [0, 0, 0],
  delayA: 0,
  delayB: 0,
  starredA: 0,
  starredB: 0,
  t0: 0,
  t1: 1,
  colorA: [1, 1, 1],
  colorB: [1, 1, 1],
  widthPx: 1,
  alpha: 1,
  drawDelay: 0,
  galaxy: -1,
  fadeRadius: 0,
  phase: 0,
  system: -1,
})

const LAYOUT = { aA: 3, aA2: 3, aB: 3, aB2: 3, aDelay: 2, aStarred: 2, aT: 2, aColorA: 3, aColorB: 3, aStyle: 4, aFade: 3 } as const
type Name = keyof typeof LAYOUT

/** Instanced ribbon segments: constellations, kNN arcs and the flat hull outline all draw through this. */
export class RibbonBuffer {
  readonly geometry = new InstancedBufferGeometry()
  private arrays = {} as Record<Name, Float32Array>
  private attrs = {} as Record<Name, InstancedBufferAttribute>

  constructor(readonly capacity: number, dynamic = false) {
    this.geometry.setAttribute('position', new BufferAttribute(QUAD, 3))
    this.geometry.setIndex(QUAD_INDEX)
    for (const name of Object.keys(LAYOUT) as Name[]) {
      const arr = new Float32Array(Math.max(1, capacity) * LAYOUT[name])
      const attr = new InstancedBufferAttribute(arr, LAYOUT[name])
      if (dynamic) attr.setUsage(DynamicDrawUsage)
      this.arrays[name] = arr
      this.attrs[name] = attr
      this.geometry.setAttribute(name, attr)
    }
    this.geometry.instanceCount = 0
  }

  write(k: number, s: Segment) {
    const w = this.arrays
    const v3 = (arr: Float32Array, v: V3) => {
      arr[k * 3] = v[0]!
      arr[k * 3 + 1] = v[1]!
      arr[k * 3 + 2] = v[2]!
    }
    v3(w.aA, s.a)
    v3(w.aA2, s.a2)
    v3(w.aB, s.b)
    v3(w.aB2, s.b2)
    v3(w.aColorA, s.colorA)
    v3(w.aColorB, s.colorB)
    w.aDelay[k * 2] = s.delayA
    w.aDelay[k * 2 + 1] = s.delayB
    w.aStarred[k * 2] = s.starredA
    w.aStarred[k * 2 + 1] = s.starredB
    w.aT[k * 2] = s.t0
    w.aT[k * 2 + 1] = s.t1
    w.aStyle[k * 4] = s.widthPx
    w.aStyle[k * 4 + 1] = s.alpha
    w.aStyle[k * 4 + 2] = s.drawDelay
    w.aStyle[k * 4 + 3] = s.galaxy
    w.aFade[k * 3] = s.fadeRadius
    w.aFade[k * 3 + 1] = s.phase
    w.aFade[k * 3 + 2] = s.system
  }

  /** Per-segment alpha, for cheap updates (filter masks) without rewriting the rest. */
  setAlpha(k: number, alpha: number) {
    this.arrays.aStyle[k * 4 + 1] = alpha
  }

  /** Uploads the first `count` segments and draws exactly those. */
  commit(count: number, only?: Name[]) {
    this.geometry.instanceCount = count
    for (const name of only ?? (Object.keys(LAYOUT) as Name[])) {
      const attr = this.attrs[name]
      attr.clearUpdateRanges()
      attr.addUpdateRange(0, count * LAYOUT[name])
      attr.needsUpdate = true
    }
  }

  dispose() {
    this.geometry.dispose()
  }
}

export type RibbonUniforms = {
  uDrawClock: { value: number }
  uDrawSeconds: { value: number }
  uFlow: { value: number }
  uPulseSpeed: { value: number }
  uPulseGain: { value: number }
  uOpacity: { value: number }
  /** Alpha for segments outside the hot system and focused galaxy; 1 disables the emphasis. */
  uRest: { value: number }
  uHotSystem: { value: number }
}

/** The shared ribbon shader with its own draw-on clock and pulse settings. */
export function ribbonMaterial(o: Partial<{ drawSeconds: number; pulseSpeed: number; pulseGain: number; opacity: number; rest: number }> = {}) {
  const own: RibbonUniforms = {
    uDrawClock: { value: 1e6 },
    uDrawSeconds: { value: o.drawSeconds ?? 0.35 },
    uFlow: { value: 1 },
    uPulseSpeed: { value: o.pulseSpeed ?? 0.5 },
    uPulseGain: { value: o.pulseGain ?? 1.5 },
    uOpacity: { value: o.opacity ?? 1 },
    uRest: { value: o.rest ?? 1 },
    uHotSystem: { value: -1 },
  }
  const material = new ShaderMaterial({
    ...shaders.line,
    uniforms: { ...sceneBus.uniforms, ...own },
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: AdditiveBlending,
    toneMapped: false,
  })
  return { material, uniforms: own }
}
