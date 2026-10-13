// Baked ghost poses: each vertex knows its pose (aFrame); unfold along uAxis happens here so
// Axis/Length stay real-time, and Anchor offsets come from a per-pose texture.
attribute float aFrame;

uniform float uCount;
uniform vec3 uAxis;     // unit unfold direction (zero when Unfold = none)
uniform float uLen;     // unfold length, model units
uniform sampler2D uAnchor; // per-pose root-motion offset (.xyz), width = uCount

varying float vU;
varying vec3 vNormal;

void main() {
  float u = uCount > 1.0 ? aFrame / (uCount - 1.0) : 0.0;
  vec3 a = texelFetch(uAnchor, ivec2(int(aFrame + 0.5), 0), 0).xyz;
  vec3 p = position - a + uAxis * (u - 0.5) * uLen;
  vU = u;
  vNormal = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
