uniform sampler2D uNoise;
uniform float uTime;

varying vec2 vUv;
varying vec3 vColor;
varying float vSeed;
varying float vAlpha;

void main() {
  float r2 = dot(vUv, vUv);
  if (r2 > 1.0 || vAlpha <= 0.0) discard;
  float falloff = (1.0 - r2) * (1.0 - r2);
  vec2 drift = vec2(uTime * 0.002, -uTime * 0.0013);
  vec2 base = vUv * (0.32 + 0.18 * vSeed) + vec2(vSeed * 7.31, vSeed * 3.17);
  float n = texture2D(uNoise, base + drift).r;
  float detail = texture2D(uNoise, base * 2.7 - drift * 1.6 + 0.37).r;
  float cloud = smoothstep(0.38, 0.92, n * 0.72 + detail * 0.38);
  vec3 col = vColor * cloud * falloff * 0.055 * vAlpha;
  gl_FragColor = vec4(col, 1.0);
}
