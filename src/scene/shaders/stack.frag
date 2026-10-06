precision highp sampler2DArray;

uniform sampler2DArray uFrames;
uniform sampler2DArray uMasks;  // subject confidence, mipmapped so Feather can sample blurrier levels
uniform float uUseMask;         // 1 = Source background Off (and masks are ready)
uniform float uFeather;         // px at working resolution
uniform float uCount;
uniform float uSub;
uniform float uCurrent;         // playhead as a fractional frame index
uniform float uBuildUp;         // 1 = only slices up to the playhead exist
uniform float uOpacity;         // per sampled frame, before slicing
uniform float uFalloff;
uniform float uCurve;           // exponent on age
uniform float uHero;            // 1 = this draw is the highlighted current frame
uniform float uHeroOpacity;
uniform float uHeroFull;        // 1 = hero ignores the mask
uniform float uSkip;            // 1 = hide ghost slices under the hero
uniform float uTint;
uniform vec3 uTintStart;
uniform vec3 uTintEnd;

varying vec2 vUv;
varying float vFrame;

float maskAt(vec2 st, float i) {
  float m = textureLod(uMasks, vec3(st, i), log2(1.0 + uFeather)).r;
  float soft = mix(0.04, 0.5, clamp(uFeather / 20.0, 0.0, 1.0));
  return smoothstep(0.5 - soft, 0.5 + soft, m);
}

void main() {
  float f = vFrame;
  if (uHero < 0.5) {
    if (uBuildUp > 0.5 && f > uCurrent + 1e-4) discard;
    if (uSkip > 0.5 && abs(f - uCurrent) < 0.5 / uSub) discard;
  }

  float i0 = floor(f);
  float i1 = min(i0 + 1.0, uCount - 1.0);
  float w = f - i0;
  vec2 st = vec2(vUv.x, 1.0 - vUv.y); // texture rows are stored top-first
  vec3 col = mix(texture(uFrames, vec3(st, i0)).rgb, texture(uFrames, vec3(st, i1)).rgb, w);

  float mask = 1.0;
  if (uUseMask > 0.5 && !(uHero > 0.5 && uHeroFull > 0.5)) {
    mask = mix(maskAt(st, i0), maskAt(st, i1), w);
  }

  float a;
  if (uHero > 0.5) {
    if (mask < 0.15) discard; // hero may write depth; drop its faint fringe
    a = uHeroOpacity * mask;
  } else {
    float latest = uBuildUp > 0.5 ? uCurrent : uCount - 1.0;
    float age = clamp((latest - f) / max(latest, 1.0), 0.0, 1.0);
    float a0 = clamp(uOpacity * (1.0 - uFalloff * pow(age, uCurve)), 0.0, 0.999);
    // uSub slices together reach the per-frame opacity a0.
    a = (1.0 - pow(1.0 - a0, 1.0 / uSub)) * mask;
    if (a < 0.0005) discard;
    if (uTint > 0.5) {
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      vec3 tint = mix(uTintStart, uTintEnd, f / max(uCount - 1.0, 1.0));
      col = clamp(l * tint * 1.6, 0.0, 1.0);
    }
  }
  gl_FragColor = vec4(col, a);
}
