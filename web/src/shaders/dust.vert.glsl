attribute float aSeed;
attribute float aSize;
attribute vec3 aTint;

uniform float uTime;
uniform float uPixelRatio;
uniform float uTwinkle;

#include <gs_fog>

varying vec3 vTint;
varying float vAlpha;

void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float dist = -mv.z;
  // Near motes grow a little so parallax reads; far shells stay single pixels.
  gl_PointSize = clamp(aSize * uPixelRatio * (1.0 + 60.0 / max(dist, 1.0)), 1.0, 4.0 * uPixelRatio);
  float flicker = 1.0 + uTwinkle * 0.3 * sin(uTime * (0.6 + aSeed * 1.7) + aSeed * 40.0);
  vTint = aTint;
  vAlpha = flicker * smoothstep(4.0, 30.0, dist);
}
