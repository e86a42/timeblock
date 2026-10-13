// Point tube (reference look): every row breathes around its own centroid; bands of
// swelling and darkening travel along the time axis.
attribute vec3 aCenter;
attribute float aV;
attribute float aRand;

uniform float uTime;
uniform float uAmp;
uniform float uSpeed;
uniform float uFreq;
uniform float uSize;     // world units (figure height = 1 after content scale)
uniform float uFocal;    // px per world unit at distance 1 (perspective)
uniform float uOrthoPx;  // px per world unit (orthographic); 0 = perspective
uniform float uMorph;

varying float vShade;
varying float vAlpha;

void main() {
  float phase = aV * uFreq * 6.2831853 - uTime * uSpeed;
  float w = 0.5 + 0.5 * sin(phase + 0.6 * sin(aV * 17.0 + uTime * 0.37));
  vec3 p = aCenter + (position - aCenter) * (1.0 + uAmp * (w - 0.5) * 2.0);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float s = uSize * (0.55 + 0.9 * w) * (0.6 + 0.8 * aRand) * (0.4 + 0.6 * uMorph);
  gl_PointSize = max(1.0, s * (uOrthoPx > 0.0 ? uOrthoPx : uFocal / max(-mv.z, 1e-3)));
  vShade = w;
  vAlpha = uMorph * smoothstep(0.0, 0.25, uMorph + aRand * 0.2);
}
