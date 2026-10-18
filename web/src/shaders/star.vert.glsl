attribute vec3 aPos;
attribute vec3 aPos2;
attribute vec3 aColor;
attribute float aSize;
attribute float aBright;
attribute float aSeed;
attribute float aDelay;
attribute float aStarred;
attribute vec4 aMeta;   // archived, activity, quality, spikes
attribute float aDensity;
attribute vec4 aDyn;    // vis, highlight, focus, pulse
attribute float aLens;  // concept-lens weight, 0..1

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
uniform float uBirthPop;
uniform float uLens;
uniform vec3 uLensRamp[5];

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
varying float vWhiten;
varying float vTrail;
varying float vDead;

vec3 lensRamp(float t) {
  float x = clamp(t, 0.0, 1.0) * 4.0;
  int k = int(min(floor(x), 3.0));
  return mix(uLensRamp[k], uLensRamp[k + 1], x - float(k));
}

void main() {
  vec3 p = gsLayout(aPos, aPos2, aDelay);
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

  // Births scale 0 → ~1.2 → 1 and flash; reduced motion keeps the plain ramp.
  float grown = born + uBirthPop * 2.5 * born * (1.0 - born);
  float flash = uBirthPop * born * (1.0 - born) * 4.0;

  // Mirrored by lib/layout.ts starPixelRadius() (without the birth overshoot).
  float worldSize = uSizeScale * mix(0.6, 2.4, aSize) * (1.0 + 0.6 * hi) * vis * grown;
  float px = worldSize * projectionMatrix[1][1] * 0.5 * uViewport.y / viewDist;
  px = clamp(px, uMinPx * uPixelRatio * vis * grown, uMaxPx * uPixelRatio);

  // Circle of confusion around the focus distance: out-of-focus stars open into bokeh discs.
  vCoc = clamp(uBokeh * abs(viewDist - uFocusDist) / max(uFocusDist, 1.0), 0.0, 0.8);
  px *= 1.0 + 0.9 * vCoc;

  vSpikeScale = 1.0 + 1.6 * spikes * (1.0 - uWarp);
  float extent = px * vSpikeScale;

  vec4 clip = projectionMatrix * mv;

  // Warp: stretch the sprite along its own screen motion over the last few frames of a long
  // flight, so stars streak radially past a forward dolly and sideways past a pan.
  vec2 streak = vec2(0.0);
  if (uWarp > 0.001) {
    vec3 before = mv.xyz + mat3(viewMatrix) * uCamVel * 0.1;
    vec4 pc = projectionMatrix * vec4(before, 1.0);
    if (pc.w > 0.001) streak = (clip.xy / clip.w - pc.xy / pc.w) * 0.5 * uViewport * uWarp;
    float len = length(streak);
    if (len > 260.0) streak *= 260.0 / len;
  }
  float trailPx = length(streak);
  vec2 along = trailPx > 0.5 ? streak / trailPx : vec2(1.0, 0.0);
  vec2 across = vec2(-along.y, along.x);
  // Half the trail in sprite units; the quad grows by it on both ends and slides back by it.
  vTrail = 0.5 * trailPx / max(extent, 1e-3);
  vec2 offset = (along * position.x * (1.0 + vTrail) + across * position.y) * extent - 0.5 * streak;
  clip.xy += offset * 2.0 / uViewport * clip.w;
  gl_Position = clip;

  float twinkle = 1.0 + uTwinkle * activity * (1.0 - archived) * 0.22 * sin(uTime * (1.3 + 2.0 * aSeed) + 6.2831 * aSeed);
  float pulseTerm = 1.0 + 0.6 * pulse * (0.5 + 0.5 * sin(uTime * 6.0));

  vUv = vec2(position.x * (1.0 + vTrail), position.y);
  vDead = archived;
  vPx = px;
  vFog = gsFog(viewDist);
  // Lensed stars take the ramp colour; the cold end recedes so the hot end reads as a heat map.
  vec3 base = mix(aColor, lensRamp(aLens) * (0.6 + 0.8 * aLens), uLens);
  // Dead stars (archived) burn down to a cool ember grey.
  float grey = dot(base, vec3(0.2126, 0.7152, 0.0722));
  base = mix(base, grey * vec3(1.05, 0.86, 0.78), archived * 0.8);
  vColor = mix(base, uFogColor * 4.0, vFog * 0.55);
  // Ghosts (filtered out, vis ~0.3) keep about a tenth of their light.
  float ghost = mix(0.1, 1.0, smoothstep(0.3, 0.95, vis));
  float lensLight = mix(1.0, 0.07 + 1.6 * aLens, uLens);
  // Under the lens the core keeps its ramp colour instead of burning white, so heat reads as hue.
  vWhiten = mix(0.5, 0.12 + 0.3 * aLens, uLens);
  vHalo = (1.0 - archived * 0.85) / sqrt(max(aDensity, 0.05));
  // A streak spreads the same light over a longer sprite.
  float spread = 1.0 / sqrt(1.0 + vTrail);
  // Stars still waiting to launch all sit on the intro origin; dimmed, so the pile reads as a hot
  // core instead of bloom washing over the whole frame.
  float launched = 0.15 + 0.85 * smoothstep(0.0, 0.25, gsIntroT(aDelay));
  vIntensity = aBright * twinkle * pulseTerm * (1.0 + 2.0 * flash) * spread * launched * mix(0.25, 1.0, focus) * (1.0 - 0.4 * archived)
             * (1.0 - 0.7 * vFog) * (1.0 + 0.7 * hi) * ghost * lensLight * step(0.001, vis * born);
  vRing = smoothstep(0.62, 0.85, hi);
}
