export class AudioManager {
  constructor() {
    this.actx   = null;
    this.master = null;
    this.ok     = false;
  }

  init() {
    try {
      this.actx   = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.actx.createGain();
      this.master.gain.value = 0.35;
      this.master.connect(this.actx.destination);
      this.ok = true;
    } catch {
      this.ok = false;
    }
  }

  resume() {
    if (this.actx?.state === 'suspended') this.actx.resume();
  }

  /** Low-level: play a single oscillator note */
  tone(freq, dur, type = 'sine', vol = 0.3, delay = 0) {
    if (!this.ok) return;
    const t   = this.actx.currentTime + delay;
    const osc = this.actx.createOscillator();
    const env = this.actx.createGain();
    osc.connect(env);
    env.connect(this.master);
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    env.gain.setValueAtTime(vol, t);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.start(t);
    osc.stop(t + dur + 0.01);
  }

  playCountdown(n) {
    if (n === 0) {
      this.tone(880, 0.25, 'sine', 0.4);
      this.tone(1320, 0.35, 'sine', 0.25, 0.12);
    } else {
      this.tone(440, 0.12, 'sine', 0.3);
    }
  }

  playStart() {
    this.tone(330, 0.18, 'sine', 0.25);
  }

  playWallBump() {
    this.tone(90, 0.07, 'sawtooth', 0.18);
  }

  playWin() {
    const melody = [523, 659, 784, 1047, 1319];
    melody.forEach((f, i) => this.tone(f, 0.28, 'sine', 0.32, i * 0.11));
    this.tone(1319, 0.55, 'sine', 0.38, melody.length * 0.11);
  }
}
