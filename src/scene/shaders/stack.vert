// Every frame is one instance of a unit plane; aIndex picks its layer and its z slot.
attribute float aIndex;

uniform vec2 uSize;      // plane size: (frame aspect, 1)
uniform float uCount;
uniform float uSpacing;  // world units between frames

varying vec2 vUv;
varying float vIndex;

void main() {
  vUv = uv;
  vIndex = aIndex;
  vec3 p = vec3(position.xy * uSize, (aIndex - (uCount - 1.0) * 0.5) * uSpacing);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
