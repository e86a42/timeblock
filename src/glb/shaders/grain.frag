// Paper grain: fine per-pixel speckle plus soft blotches, resolution-independent and
// deterministic in uTime (so exports match the preview).
uniform float uGrain;
uniform float uTime;
uniform vec2 uRes;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
void main() {
  vec2 q = gl_FragCoord.xy / uRes.y * 1100.0;
  float speck = hash(floor(q) + floor(uTime * 24.0) * vec2(17.0, 31.0));
  float blotch = vnoise(q * 0.012);
  float a = uGrain * (0.14 * speck + 0.07 * blotch);
  gl_FragColor = vec4(vec3(0.0), a);
}
