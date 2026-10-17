import { Vector2, Vector3 } from 'three'
import { sceneTheme } from '#/lib/theme'
import { RESTING_LAYOUT } from '#/lib/layout'
import layout from './chunks/layout.glsl?raw'
import fog from './chunks/fog.glsl?raw'
import noise from './chunks/noise.glsl?raw'
import starVert from './star.vert.glsl?raw'
import starFrag from './star.frag.glsl?raw'
import backdropFrag from './backdrop.frag.glsl?raw'
import dustVert from './dust.vert.glsl?raw'
import dustFrag from './dust.frag.glsl?raw'
import nebulaVert from './nebula.vert.glsl?raw'
import nebulaFrag from './nebula.frag.glsl?raw'

const chunks: Record<string, string> = { gs_layout: layout, gs_fog: fog, gs_noise: noise }

/** Resolves `#include <gs_x>` against our chunks; three's own `#include <...>` pass through. */
export function resolveIncludes(src: string): string {
  return src.replace(/^[ \t]*#include <(gs_\w+)>/gm, (_, name: string) => {
    const chunk = chunks[name]
    if (chunk === undefined) throw new Error(`unknown shader chunk ${name}`)
    return chunk
  })
}

export const shaders = {
  star: { vertexShader: resolveIncludes(starVert), fragmentShader: resolveIncludes(starFrag) },
  backdrop: {
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: resolveIncludes(backdropFrag),
  },
  dust: { vertexShader: resolveIncludes(dustVert), fragmentShader: resolveIncludes(dustFrag) },
  nebula: { vertexShader: resolveIncludes(nebulaVert), fragmentShader: resolveIncludes(nebulaFrag) },
}

const u = <T>(value: T) => ({ value })

/** One shared uniform set: star, dust, nebula and later line materials read layout and time from it. */
export function createSceneUniforms() {
  const { fog, stars } = sceneTheme
  return {
    uTime: u(0),
    uViewport: u(new Vector2(1, 1)),
    uPixelRatio: u(1),
    uSizeScale: u<number>(stars.sizeScale),
    uMinPx: u<number>(stars.minPx),
    uMaxPx: u<number>(stars.maxPx),
    uFlat: u(RESTING_LAYOUT.flat),
    uIntro: u(RESTING_LAYOUT.intro),
    uIntroOrigin: u(new Vector3(...RESTING_LAYOUT.introOrigin)),
    uTimeline: u(RESTING_LAYOUT.timeline),
    uTimelineOn: u(0),
    uBirthWindow: u(RESTING_LAYOUT.birthWindow),
    uFogNear: u<number>(fog.near),
    uFogFar: u<number>(fog.far),
    uFogColor: u(new Vector3(...fog.color)),
    uFocusDist: u(100),
    uBokeh: u(0),
    uTwinkle: u(1),
    uCamVel: u(new Vector3()),
    uWarp: u(0),
  }
}

export type SceneUniforms = ReturnType<typeof createSceneUniforms>
