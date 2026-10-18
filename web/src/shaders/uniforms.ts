import { sceneTheme } from '#/lib/theme'
import { RESTING_LAYOUT } from '#/lib/layout'
import { LENS_RAMP } from '#/lib/lens'

// Plain {x, y, z} values and flat arrays rather than three's vectors: three uploads both, and
// keeping three out of this module keeps it out of the HUD's chunk (sceneBus imports it).

const vec3 = (x: number, y: number, z: number) => ({ x, y, z })
const u = <T>(value: T) => ({ value })

export const MAX_GALAXIES = 32

/** One shared uniform set: star, dust, nebula and later line materials read layout and time from it. */
export function createSceneUniforms() {
  const { fog, stars } = sceneTheme
  return {
    uTime: u(0),
    uViewport: u({ x: 1, y: 1 }),
    uPixelRatio: u(1),
    uSizeScale: u<number>(stars.sizeScale),
    uMinPx: u<number>(stars.minPx),
    uMaxPx: u<number>(stars.maxPx),
    uFlat: u(RESTING_LAYOUT.flat),
    uIntro: u(RESTING_LAYOUT.intro),
    uIntroOrigin: u(vec3(...RESTING_LAYOUT.introOrigin)),
    uTimeline: u(RESTING_LAYOUT.timeline),
    uTimelineOn: u(0),
    uBirthWindow: u(RESTING_LAYOUT.birthWindow),
    uFogNear: u<number>(fog.near),
    uFogFar: u<number>(fog.far),
    uFogColor: u(vec3(...fog.color)),
    uFocusDist: u(100),
    uBokeh: u(0),
    uTwinkle: u(1),
    uCamVel: u(vec3(0, 0, 0)),
    uWarp: u(0),
    uLens: u(0),
    uLensRamp: u(Float32Array.from(LENS_RAMP.flat())),
    /** Nebula focus: the galaxy index to keep, and how strongly the others fade. */
    uFocusCluster: u(-1),
    uFocusAmt: u(0),
    /** Per galaxy, the fraction of its members that pass the filters (nebulae thin out with it). */
    uGalaxyVis: u(new Float32Array(MAX_GALAXIES).fill(1)),
  }
}

export type SceneUniforms = ReturnType<typeof createSceneUniforms>
