// Bottom bar: play/pause, scrubber over the output duration, time readout.
// Owns the preview playhead; main reads `t` every frame.
import { store } from '../state';

export class Timeline {
  t = 0;
  playing = true;
  private play: HTMLButtonElement;
  private scrub: HTMLInputElement;
  private time: HTMLElement;

  constructor(root: HTMLElement) {
    this.play = root.querySelector('#tl-play')!;
    this.scrub = root.querySelector('#tl-scrub')!;
    this.time = root.querySelector('#tl-time')!;
    this.play.addEventListener('click', () => this.toggle());
    this.scrub.addEventListener('input', () => {
      this.playing = false;
      this.t = (Number(this.scrub.value) / 1000) * this.duration;
      this.refresh();
    });
    window.addEventListener('keydown', (e) => {
      const tag = (e.target as HTMLElement).tagName;
      if (e.code === 'Space' && tag !== 'INPUT' && tag !== 'SELECT') {
        e.preventDefault();
        this.toggle();
      }
    });
    this.refresh();
  }

  get duration() {
    return store.p.export.duration;
  }

  /** Normalized playhead u ∈ [0, 1]. */
  get u() {
    return Math.min(1, this.t / this.duration);
  }

  toggle() {
    this.playing = !this.playing;
    this.refresh();
  }

  tick(dt: number) {
    if (this.playing) this.t = (this.t + dt) % this.duration;
    else this.t = Math.min(this.t, this.duration);
    this.refresh();
  }

  private refresh() {
    this.play.classList.toggle('playing', this.playing);
    this.play.setAttribute('aria-label', this.playing ? 'Pause' : 'Play');
    if (document.activeElement !== this.scrub) this.scrub.value = String(Math.round(this.u * 1000));
    this.time.textContent = `${this.t.toFixed(2)} / ${this.duration.toFixed(2)}`;
  }
}
