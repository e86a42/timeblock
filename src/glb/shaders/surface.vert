attribute vec2 aUV; // x: along the chain (0–1), y: along time (0–1)
varying vec2 vUV;
varying vec3 vNormal;
void main() {
  vUV = aUV;
  vNormal = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
