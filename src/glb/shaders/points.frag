uniform vec3 uInk;
varying float vShade;
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  float a = vAlpha * smoothstep(0.5, 0.3, d) * (0.35 + 0.65 * vShade);
  if (a < 0.01) discard;
  gl_FragColor = vec4(uInk, a);
}
