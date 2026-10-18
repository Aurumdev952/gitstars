// One screen-space ribbon quad per segment. position.x runs 0 → 1 from A to B, position.y −1 → 1
// across the ribbon. Endpoints follow the shared layout (flat tween, intro) and the timeline.
attribute vec3 aA;
attribute vec3 aA2;
attribute vec3 aB;
attribute vec3 aB2;
attribute vec2 aDelay;   // intro delay of A, B
attribute vec2 aStarred; // timeline position of A, B
attribute vec2 aT;       // curve parameter at A, B
attribute vec3 aColorA;
attribute vec3 aColorB;
attribute vec4 aStyle;   // width px, alpha, draw-on delay s, galaxy index
attribute vec3 aFade;    // fade-out radius (0: never fades), pulse phase, system index

uniform vec2 uViewport;
uniform float uPixelRatio;
uniform float uDrawClock;
uniform float uDrawSeconds;
uniform float uFocusCluster;
uniform float uFocusAmt;
uniform float uLens;
uniform float uOpacity;
uniform float uRest;
uniform float uHotSystem;
uniform float uGalaxyVis[32];

#include <gs_layout>
#include <gs_fog>

varying vec3 vColor;
varying float vSide;
varying float vHalfW;
varying float vT;
varying float vDraw;
varying float vAlpha;
varying float vPhase;

void main() {
  vec3 a = gsLayout(aA, aA2, aDelay.x);
  vec3 b = gsLayout(aB, aB2, aDelay.y);
  float born = min(gsBorn(aStarred.x), gsBorn(aStarred.y));

  vec4 ca = projectionMatrix * modelViewMatrix * vec4(a, 1.0);
  vec4 cb = projectionMatrix * modelViewMatrix * vec4(b, 1.0);
  float front = step(0.001, ca.w) * step(0.001, cb.w);
  vec2 sa = ca.xy / max(ca.w, 0.001) * uViewport * 0.5;
  vec2 sb = cb.xy / max(cb.w, 0.001) * uViewport * 0.5;
  vec2 d = sb - sa;
  vec2 dir = length(d) > 1e-4 ? normalize(d) : vec2(1.0, 0.0);
  vec2 n = vec2(-dir.y, dir.x);

  float halfW = 0.5 * aStyle.x * uPixelRatio;
  // One extra pixel each side carries the antialiased edge.
  float reach = halfW + uPixelRatio;
  vec4 c = mix(ca, cb, position.x);
  c.xy += n * position.y * reach * 2.0 / uViewport * c.w;
  gl_Position = c;

  vSide = position.y * reach;
  vHalfW = halfW;
  vT = mix(aT.x, aT.y, position.x);
  vColor = mix(aColorA, aColorB, position.x);
  vDraw = clamp((uDrawClock - aStyle.z) / uDrawSeconds, 0.0, 1.0);
  vPhase = aFade.y;

  vec3 mid = mix(a, b, 0.5);
  float dist = distance(cameraPosition, mid);
  // System constellations only resolve once the camera is near; the overview keeps a faint trace.
  float near = aFade.x > 0.0 ? mix(0.07, 1.0, 1.0 - smoothstep(aFade.x * 3.5, aFade.x * 9.0, dist)) : 1.0;
  // Segments that belong to no galaxy (arcs, the hull outline) take no galaxy or focus dimming.
  bool owned = aStyle.w >= 0.0;
  int gi = int(clamp(aStyle.w, 0.0, 31.0));
  float galaxyVis = owned ? uGalaxyVis[gi] : 1.0;
  bool inFocus = owned && abs(aStyle.w - uFocusCluster) < 0.5;
  float focused = !owned ? 1.0 : inFocus ? 1.0 + 0.4 * uFocusAmt : 1.0 - 0.85 * uFocusAmt;
  // Strokes recede to uRest except in the hovered star's system and the focused galaxy.
  float hot = max(abs(aFade.z - uHotSystem) < 0.5 ? 1.0 : 0.0, inFocus ? uFocusAmt : 0.0);
  float emphasis = mix(uRest, 1.0, hot);
  float viewDist = -(modelViewMatrix * vec4(mid, 1.0)).z;
  vAlpha = aStyle.y * near * focused * emphasis * galaxyVis * born * front * uOpacity * (1.0 - 0.75 * uLens)
         * (1.0 - 0.7 * gsFog(viewDist));
}
