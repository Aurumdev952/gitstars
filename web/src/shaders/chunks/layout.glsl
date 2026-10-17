// Mirrored by lib/layout.ts positionAt() and bornAt(). Change both together.
uniform float uFlat;
uniform float uIntro;
uniform vec3 uIntroOrigin;
uniform float uTimeline;
uniform float uTimelineOn;
uniform float uBirthWindow;

vec3 gsRotY(vec3 v, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec3(v.x * c + v.z * s, v.y, -v.x * s + v.z * c);
}

vec3 gsLayout(vec3 pos, vec3 pos2, float seed) {
  vec3 p = mix(pos, pos2, uFlat);
  float t = clamp((uIntro - seed * 0.45) / 0.55, 0.0, 1.0);
  float e = 1.0 - pow(1.0 - t, 3.0);
  return uIntroOrigin + gsRotY(p - uIntroOrigin, (1.0 - e) * 2.4) * e;
}

float gsBorn(float starred) {
  return uTimelineOn > 0.5 ? smoothstep(starred, starred + uBirthWindow, uTimeline) : 1.0;
}
