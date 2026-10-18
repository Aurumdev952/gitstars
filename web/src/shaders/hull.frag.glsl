uniform vec3 uColor;
uniform float uReveal;
uniform float uOpacity;
uniform vec2 uHeightRange;

varying vec3 vNormal;
varying vec3 vView;
varying float vHeight;

void main() {
  float h = (vHeight - uHeightRange.x) / max(uHeightRange.y - uHeightRange.x, 1e-3);
  // The hull is revealed by a plane sweeping up through it, led by a bright scan line.
  float front = uReveal * 1.25 - 0.1;
  if (h > front || uOpacity <= 0.0) discard;
  float rim = pow(1.0 - abs(dot(normalize(vNormal), normalize(vView))), 5.0);
  float scan = uReveal < 1.0 ? exp(-pow((front - h) * 24.0, 2.0)) : 0.0;
  vec3 col = uColor * (0.16 * rim + 0.6 * scan);
  gl_FragColor = vec4(col * uOpacity, 1.0);
}
