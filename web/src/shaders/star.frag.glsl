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

const vec3 STARLIGHT = vec3(0.74, 0.58, 0.29);

void main() {
  if (vIntensity <= 0.0) discard;
  vec2 uv = vUv * vSpikeScale;   // star space: r = 1 at the halo edge
  float r = length(uv);

  float spikes = 0.0;
  if (vSpikeScale > 1.0) {
    vec2 a = abs(vUv);
    float along = pow(max(0.0, 1.0 - a.x), 40.0) * pow(max(0.0, 1.0 - a.y), 4.0)
                + pow(max(0.0, 1.0 - a.y), 40.0) * pow(max(0.0, 1.0 - a.x), 4.0);
    spikes = along * 0.9 * smoothstep(1.0, 0.0, length(vUv));
  }
  if (r > 1.0 && spikes < 0.002) discard;

  // The core keeps at least ~1 px of width so distant stars stay crisp points instead of vanishing.
  float sigma = max(0.9 / vPx, 0.085) * (1.0 + 4.0 * vCoc);
  float core = exp(-(r * r) / (sigma * sigma)) * 3.0 / (1.0 + 10.0 * vCoc * vCoc);
  float halo = 0.12 / (r * r * 40.0 + 1.0) * smoothstep(1.0, 0.7, r) * vHalo;
  float disc = vCoc * 0.18 * smoothstep(1.0, 0.85, r);

  float ring = 0.0;
  if (vRing > 0.0) {
    float rr = 0.62 + 0.03 * sin(uTime * 3.0);
    ring = smoothstep(0.045, 0.0, abs(r - rr)) * vRing * 0.9;
  }

  float glow = 0.022 * exp(-r * r * 9.0) * vHalo;
  vec3 coreColor = mix(vColor, vec3(1.0), 0.55);
  vec3 col = coreColor * core + vColor * (halo * 3.6 + glow * 3.0 + disc + spikes) + STARLIGHT * ring;
  gl_FragColor = vec4(col * vIntensity, 1.0);
}
