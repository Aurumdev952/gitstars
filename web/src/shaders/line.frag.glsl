uniform float uTime;
uniform float uFlow;
uniform float uPulseSpeed;
uniform float uPulseGain;

varying vec3 vColor;
varying float vSide;
varying float vHalfW;
varying float vT;
varying float vDraw;
varying float vAlpha;
varying float vPhase;

void main() {
  if (vAlpha <= 0.001 || vT > vDraw) discard;
  // Coverage of a ribbon of half-width vHalfW at this pixel; sub-pixel ribbons fade instead of thinning.
  float w = max(vHalfW, 0.5);
  float cover = clamp(w + 0.5 - abs(vSide), 0.0, 1.0) * min(1.0, vHalfW * 2.0);
  // A bright head leads the stroke while it draws on.
  float head = vDraw < 1.0 ? exp(-pow((vDraw - vT) * 28.0, 2.0)) : 0.0;
  // A travelling pulse runs from A to B, once per 1 / uPulseSpeed seconds.
  float s = fract(uTime * uPulseSpeed + vPhase) * 1.4 - 0.2;
  float pulse = uFlow * exp(-pow((vT - s) * 9.0, 2.0));
  vec3 col = vColor * (1.0 + uPulseGain * pulse + 2.5 * head);
  gl_FragColor = vec4(col * vAlpha * cover, 1.0);
}
