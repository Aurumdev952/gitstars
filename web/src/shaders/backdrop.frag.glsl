uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uBand;
uniform vec3 uBandWarm;
uniform vec3 uBandNormal;
uniform float uOpacity;

#include <gs_noise>

varying vec3 vDir;

// Sparse hash stars on a sphere grid, fixed to the sky so they read as infinitely far.
float farStars(vec3 dir, float scale, float threshold) {
  vec3 p = dir * scale;
  vec3 cell = floor(p);
  vec3 f = fract(p) - 0.5;
  float h = gsHash13(cell);
  if (h < threshold) return 0.0;
  vec3 jitter = vec3(gsHash13(cell + 1.7), gsHash13(cell + 3.1), gsHash13(cell + 5.3)) - 0.5;
  float d = length(f - jitter * 0.7);
  float b = (h - threshold) / (1.0 - threshold);
  return smoothstep(0.08, 0.0, d) * b;
}

void main() {
  vec3 dir = normalize(vDir);
  float up = dir.y * 0.5 + 0.5;
  vec3 col = mix(uHorizon, uZenith, smoothstep(0.0, 1.0, up));

  float across = dot(dir, uBandNormal);
  float band = exp(-across * across * 16.0);
  float clouds = smoothstep(0.25, 0.9, gsFbm(dir * 2.6) * 0.5 + 0.5);
  float lanes = smoothstep(0.4, 0.7, gsFbm(dir * 7.0 + 4.0) * 0.5 + 0.5);
  float glow = band * clouds * (1.0 - 0.7 * lanes);
  float warm = smoothstep(0.55, 0.95, gsFbm(dir * 1.7 + 9.0) * 0.5 + 0.5);
  col += mix(uBand, uBandWarm, warm) * glow * 0.75;
  col += uBand * exp(-across * across * 140.0) * 0.3 * clouds;

  float stars = farStars(dir, 180.0, 0.965) * (0.25 + 0.75 * band) + farStars(dir, 420.0, 0.985) * 0.6;
  col += vec3(0.62, 0.66, 0.85) * stars * 0.22;

  gl_FragColor = vec4(col * uOpacity, 1.0);
}
