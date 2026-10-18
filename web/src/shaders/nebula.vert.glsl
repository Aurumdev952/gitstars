attribute vec3 aPos;
attribute vec3 aPos2;
attribute float aSeed;
attribute float aScale;
attribute vec3 aColor;
attribute float aCluster;

uniform float uFocusCluster;
uniform float uFocusAmt;
uniform float uNebula;
uniform float uLens;
uniform float uGalaxyVis[32];

#include <gs_layout>

varying vec2 vUv;
varying vec3 vColor;
varying float vSeed;
varying float vAlpha;

void main() {
  vec3 p = gsLayout(aPos, aPos2, aSeed);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float c = cos(aSeed * 6.2831);
  float s = sin(aSeed * 6.2831);
  vec2 q = mat2(c, -s, s, c) * position.xy;
  mv.xy += q * aScale;
  gl_Position = projectionMatrix * mv;

  float depth = -mv.z;
  // Fade sprites that would fill the screen once the camera flies into a cloud.
  float near = smoothstep(aScale * 0.6, aScale * 0.6 + 30.0, depth);
  float focused = abs(aCluster - uFocusCluster) < 0.5 ? 1.0 : 1.0 - 0.75 * uFocusAmt;
  vUv = position.xy;
  vColor = aColor;
  vSeed = aSeed;
  float members = uGalaxyVis[int(clamp(aCluster, 0.0, 31.0))];
  vAlpha = near * focused * uNebula * members * (1.0 - 0.75 * uLens);
}
