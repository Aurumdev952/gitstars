// Mirrored by lib/layout.ts positionAt() and bornAt(). Change both together.
uniform float uFlat;
uniform float uIntro;
uniform vec3 uIntroOrigin;
uniform float uIntroRadius;
uniform float uTimeline;
uniform float uTimelineOn;
uniform float uBirthWindow;

vec3 gsRotY(vec3 v, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec3(v.x * c + v.z * s, v.y, -v.x * s + v.z * c);
}

float gsIntroT(float delay) {
  return clamp((uIntro - delay) / 0.55, 0.0, 1.0);
}

vec3 gsLayout(vec3 pos, vec3 pos2, float delay) {
  vec3 p = mix(pos, pos2, uFlat);
  float e = 1.0 - pow(1.0 - gsIntroT(delay), 3.0);
  vec3 d = p - uIntroOrigin;
  // Outer stars wind further than inner ones, so the burst unrolls as spiral arms; height grows
  // last, so it opens as a flat disc and then thickens into the 3D layout.
  float twist = (1.0 - e) * (1.4 + 2.6 * length(d) / max(uIntroRadius, 1.0));
  vec3 r = gsRotY(d, twist);
  return uIntroOrigin + vec3(r.x * e, r.y * e * e, r.z * e);
}

float gsBorn(float starred) {
  return uTimelineOn > 0.5 ? smoothstep(starred, starred + uBirthWindow, uTimeline) : 1.0;
}
