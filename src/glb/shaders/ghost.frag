uniform float uCur;      // playhead in pose space (0–1)
uniform float uBuildUp;
uniform float uOpacity;
uniform float uFalloff;
uniform float uCurve;
uniform float uSkip;     // 1 = hide the ghost under the hero
uniform float uStep;     // 1 / (count − 1)
uniform float uFront;    // sweep front: ghosts behind it dissolve (−1 = none)
uniform float uShade;
uniform float uTint;
uniform vec3 uBase;
uniform vec3 uTintStart;
uniform vec3 uTintEnd;

varying float vU;
varying vec3 vNormal;

void main() {
  if (uBuildUp > 0.5 && vU > uCur + 1e-4) discard;
  if (uSkip > 0.5 && abs(vU - uCur) < uStep * 0.5) discard;
  float latest = uBuildUp > 0.5 ? uCur : 1.0;
  float age = clamp((latest - vU) / max(latest, 1e-4), 0.0, 1.0);
  float a = clamp(uOpacity * (1.0 - uFalloff * pow(age, uCurve)), 0.0, 1.0);
  a *= smoothstep(uFront - 0.08, uFront, vU);
  if (a < 0.002) discard;
  vec3 col = uTint > 0.5 ? mix(uTintStart, uTintEnd, vU) : uBase;
  float facing = abs(normalize(vNormal).z); // headlight
  col *= mix(1.0, 0.35 + 0.75 * facing, uShade);
  gl_FragColor = vec4(col, a);
}
