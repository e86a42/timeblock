precision highp sampler2DArray;

uniform sampler2DArray uFrames;
uniform sampler2DArray uMasks;  // subject masks (M4); 1×1 white placeholder until computed
uniform float uUseMask;         // 0 = Source background On, 1 = Off
uniform float uCount;
uniform float uCurrent;         // playhead as a fractional frame index
uniform float uBuildUp;         // 1 = only frames up to the playhead exist
uniform float uOpacity;
uniform float uFalloff;
uniform float uHero;            // 1 = this draw is the highlighted current frame
uniform float uSkip;            // ghost layer hidden under the hero (-1 = none)
uniform float uTint;
uniform vec3 uTintStart;
uniform vec3 uTintEnd;

varying vec2 vUv;
varying float vIndex;

void main() {
  float idx = floor(vIndex + 0.5);
  if (uBuildUp > 0.5 && idx > uCurrent + 0.001) discard;
  if (uHero < 0.5 && abs(idx - uSkip) < 0.5) discard;

  vec2 st = vec2(vUv.x, 1.0 - vUv.y); // texture rows are stored top-first
  vec3 col = texture(uFrames, vec3(st, idx)).rgb;
  float mask = mix(1.0, texture(uMasks, vec3(st, idx)).r, uUseMask);

  float a;
  if (uHero > 0.5) {
    a = mask;
    if (a < 0.5) discard; // hero writes depth, so keep it binary
  } else {
    float latest = uBuildUp > 0.5 ? floor(uCurrent) : uCount - 1.0;
    float age = clamp((latest - idx) / max(latest, 1.0), 0.0, 1.0);
    a = uOpacity * (1.0 - uFalloff * age) * mask;
    if (a < 0.002) discard;
    if (uTint > 0.5) {
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      vec3 tint = mix(uTintStart, uTintEnd, idx / max(uCount - 1.0, 1.0));
      col = clamp(l * tint * 1.6, 0.0, 1.0);
    }
  }
  gl_FragColor = vec4(col, a);
}
