// Serve wasm runtimes locally instead of from a CDN:
//   MediaPipe vision → public/mediapipe/wasm, Draco (compressed GLB) → public/draco
import { cpSync, existsSync } from 'node:fs';

const copies = [
  ['node_modules/@mediapipe/tasks-vision/wasm', 'public/mediapipe/wasm'],
  ['node_modules/three/examples/jsm/libs/draco/gltf', 'public/draco'],
];
for (const [from, to] of copies) if (existsSync(from)) cpSync(from, to, { recursive: true });
