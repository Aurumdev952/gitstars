uniform float uTime;

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

const vec3 STARLIGHT = vec3(0.74, 0.58, 0.29);

void main() {
  if (vIntensity <= 0.0) discard;
  vec2 uv = vUv * vSpikeScale;   // star space: r = 1 at the halo edge
  // Distance to the streak segment (a point when not warping), so a trail is a capsule.
  float trail = vTrail * vSpikeScale;
  float r = length(vec2(max(abs(uv.x) - trail, 0.0), uv.y));

  float spikes = 0.0;
  if (vSpikeScale > 1.001) {
    vec2 a = abs(vUv);
    float along = pow(max(0.0, 1.0 - a.x), 40.0) * pow(max(0.0, 1.0 - a.y), 4.0)
                + pow(max(0.0, 1.0 - a.y), 40.0) * pow(max(0.0, 1.0 - a.x), 4.0);
    spikes = along * 0.9 * smoothstep(1.0, 0.0, length(vUv)) * (1.0 - vCoc);
  }
  if (r > 1.0 && spikes < 0.002) discard;

  // The core stays between ~1 and ~2.4 px wide: far stars stay crisp points instead of vanishing,
  // and close ones stay pinpoints in a halo instead of growing into white discs.
  float sigma = clamp(0.085 * vPx, 0.9, 2.4) / vPx * (1.0 + 4.0 * vCoc);
  float core = exp(-(r * r) / (sigma * sigma)) * 3.0 / (1.0 + 10.0 * vCoc * vCoc);
  float halo = 0.12 / (r * r * 40.0 + 1.0) * smoothstep(1.0, 0.7, r) * vHalo * (1.0 - 0.7 * vCoc);
  // Bokeh: the core's energy spreads into a disc with a slightly brighter rim, as a real lens draws it.
  float edge = smoothstep(1.0, 0.92, r);
  float disc = vCoc * (0.045 + 0.05 * smoothstep(0.62, 0.92, r)) * edge;

  float ring = 0.0;
  if (vRing > 0.0) {
    float rr = 0.62 + 0.03 * sin(uTime * 3.0);
    ring = smoothstep(0.045, 0.0, abs(r - rr)) * vRing * 0.9;
  }
  // Dead stars keep a dim core inside a faint husk.
  float husk = vDead * smoothstep(0.06, 0.0, abs(r - 0.4)) * 0.22;
  core *= 1.0 - 0.45 * vDead;

  // Streaks brighten toward the head, which sits at the star's current position.
  float head = trail > 0.0 ? mix(0.25, 1.0, clamp((uv.x + trail) / (2.0 * trail), 0.0, 1.0)) : 1.0;

  float glow = 0.022 * exp(-r * r * 9.0) * vHalo;
  vec3 coreColor = mix(vColor, vec3(1.0), vWhiten);
  vec3 col = coreColor * core + vColor * (halo * 3.6 + glow * 3.0 + disc + spikes + husk) + STARLIGHT * ring;
  gl_FragColor = vec4(col * vIntensity * head, 1.0);
}
