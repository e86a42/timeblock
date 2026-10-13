uniform vec3 uColor;
uniform float uFront;
uniform float uFade;
varying float vV;
void main() {
  if (vV > uFront || uFade < 0.002) discard;
  gl_FragColor = vec4(uColor, 0.85 * uFade);
}
