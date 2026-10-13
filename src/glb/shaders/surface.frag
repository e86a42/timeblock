// Lofted surface: translucent fill plus ROM.VIZ-style rings (rows) and rulings (columns).
uniform vec3 uColor;
uniform vec3 uLine;
uniform float uOpacity;
uniform float uFront;  // rows with time ≤ front are formed
uniform float uFade;   // 1 → 0 while morphing into points
uniform vec2 uGrid;    // line count along (chain, time)

varying vec2 vUV;
varying vec3 vNormal;

float gridLine(float x, float n) {
  float g = x * n;
  return 1.0 - min(abs(fract(g - 0.5) - 0.5) / max(fwidth(g), 1e-4), 1.0);
}

void main() {
  float formed = 1.0 - smoothstep(uFront - 0.015, uFront, vUV.y);
  if (formed * uFade < 0.002) discard;
  float line = max(gridLine(vUV.x, uGrid.x), gridLine(vUV.y, uGrid.y));
  // The newest row glows like a cutting plane.
  float edge = 1.0 - smoothstep(0.0, 0.012, abs(vUV.y - uFront));
  float facing = abs(normalize(vNormal).z);
  vec3 fill = uColor * (0.55 + 0.45 * facing);
  vec3 col = mix(fill, uLine, max(line * 0.4, edge));
  float a = mix(uOpacity, 0.8, max(line * 0.3, edge)) * formed * uFade;
  gl_FragColor = vec4(col, a);
}
