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
