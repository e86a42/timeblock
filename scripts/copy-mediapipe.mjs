// Serve the MediaPipe wasm runtime locally (public/mediapipe/wasm) instead of from a CDN.
import { cpSync, existsSync } from 'node:fs';

const from = 'node_modules/@mediapipe/tasks-vision/wasm';
const to = 'public/mediapipe/wasm';
if (existsSync(from)) cpSync(from, to, { recursive: true });
