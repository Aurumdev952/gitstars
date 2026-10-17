attribute vec3 aPos;
attribute vec3 aPos2;
attribute vec3 aColor;
attribute float aSize;
attribute float aBright;
attribute float aSeed;
attribute float aStarred;
attribute vec4 aMeta;   // archived, activity, quality, spikes
attribute float aDensity;
attribute vec4 aDyn;    // vis, highlight, focus, pulse

uniform float uTime;
uniform vec2 uViewport;      // drawing-buffer pixels
uniform float uPixelRatio;
uniform float uSizeScale;
uniform float uMinPx;        // CSS pixels
uniform float uMaxPx;
uniform float uFocusDist;
uniform float uBokeh;
uniform float uTwinkle;
uniform vec3 uCamVel;
uniform float uWarp;

#include <gs_layout>
#include <gs_fog>

varying vec2 vUv;
varying vec3 vColor;
varying float vPx;
varying float vSpikeScale;
varying float vHalo;
varying float vIntensity;
varying float vRing;
varying float vFog;
varying float vCoc;

void main() {
  vec3 p = gsLayout(aPos, aPos2, aSeed);
  float born = gsBorn(aStarred);
  float vis = aDyn.x;
  float hi = aDyn.y;
  float focus = aDyn.z;
  float pulse = aDyn.w;
  float archived = aMeta.x;
  float activity = aMeta.y;
  float spikes = aMeta.w * (1.0 - archived);

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float viewDist = max(0.001, -mv.z);

  // Mirrored by lib/layout.ts starPixelRadius().
  float worldSize = uSizeScale * mix(0.6, 2.4, aSize) * (1.0 + 0.6 * hi) * vis * born;
  float px = worldSize * projectionMatrix[1][1] * 0.5 * uViewport.y / viewDist;
  px = clamp(px, uMinPx * uPixelRatio * vis * born, uMaxPx * uPixelRatio);

  vCoc = clamp(uBokeh * abs(viewDist - uFocusDist) / max(uFocusDist, 1.0), 0.0, 1.0);
  px *= 1.0 + 1.5 * vCoc;

  vSpikeScale = 1.0 + 1.6 * spikes;
  float extent = px * vSpikeScale;

  vec4 clip = projectionMatrix * mv;
  clip.xy += position.xy * extent * 2.0 / uViewport * clip.w;
  gl_Position = clip;

  float flash = born * (1.0 - born) * 4.0;
  float twinkle = 1.0 + uTwinkle * activity * (1.0 - archived) * 0.22 * sin(uTime * (1.3 + 2.0 * aSeed) + 6.2831 * aSeed);
  float pulseTerm = 1.0 + 0.6 * pulse * (0.5 + 0.5 * sin(uTime * 6.0));

  vUv = position.xy;
  vPx = px;
  vFog = gsFog(viewDist);
  vColor = mix(aColor, uFogColor * 4.0, vFog * 0.55);
  vHalo = (1.0 - archived * 0.85) / sqrt(max(aDensity, 0.05));
  vIntensity = aBright * twinkle * pulseTerm * (1.0 + flash) * mix(0.25, 1.0, focus) * (1.0 - 0.4 * archived)
             * (1.0 - 0.7 * vFog) * (1.0 + 0.7 * hi) * step(0.001, vis * born);
  vRing = smoothstep(0.62, 0.85, hi);
}
