uniform float uFogNear;
uniform float uFogFar;
uniform vec3 uFogColor;

float gsFog(float viewDist) {
  return smoothstep(uFogNear, uFogFar, viewDist);
}
