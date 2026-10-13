// Full-screen quad: ignores the camera.
void main() {
  gl_Position = vec4(position.xy * 2.0, 0.0, 1.0);
}
