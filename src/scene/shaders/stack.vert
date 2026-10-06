// Each instance is one slice of the volume. Slices sit uSub per sampled frame, so the slice
// at fractional frame position f interpolates between frames floor(f) and floor(f)+1.
attribute float aIndex;  // slice index (ghosts) or uSub × playhead (hero)

uniform vec2 uSize;      // plane size: (frame aspect, 1)
uniform float uCount;    // sampled frames
uniform float uSub;      // slices per frame
uniform float uSpacing;  // world units between sampled frames
uniform sampler2D uOffsets; // per-frame Anchor shift in plane units (.xy), width = uCount

varying vec2 vUv;
varying float vFrame;

vec2 offsetAt(float i) {
  return texelFetch(uOffsets, ivec2(int(i), 0), 0).xy;
}

void main() {
  float f = aIndex / uSub;
  float i0 = floor(f);
  float i1 = min(i0 + 1.0, uCount - 1.0);
  vec2 off = mix(offsetAt(i0), offsetAt(i1), f - i0);
  vUv = uv;
  vFrame = f;
  vec3 p = vec3(position.xy * uSize + off, (f - (uCount - 1.0) * 0.5) * uSpacing);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
