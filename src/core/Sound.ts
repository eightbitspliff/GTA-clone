// ---------------------------------------------------------------------------
// Tiny synthesized sound effects via WebAudio – no audio assets required.
// ---------------------------------------------------------------------------

export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private sirenOsc: OscillatorNode | null = null;
  private sirenGain: GainNode | null = null;
  muted = false;

  unlock() {
    if (this.ctx) {
      this.ctx.resume().catch(() => {});
      return;
    }
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.35;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 1;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

      // Continuous siren, volume controlled by distance to nearest police car
      this.sirenOsc = this.ctx.createOscillator();
      this.sirenOsc.type = 'sawtooth';
      this.sirenGain = this.ctx.createGain();
      this.sirenGain.gain.value = 0;
      const lfo = this.ctx.createOscillator();
      lfo.frequency.value = 1.6;
      const lfoGain = this.ctx.createGain();
      lfoGain.gain.value = 220;
      lfo.connect(lfoGain).connect(this.sirenOsc.frequency);
      this.sirenOsc.frequency.value = 760;
      const filt = this.ctx.createBiquadFilter();
      filt.type = 'lowpass';
      filt.frequency.value = 1800;
      this.sirenOsc.connect(filt).connect(this.sirenGain).connect(this.master);
      this.sirenOsc.start();
      lfo.start();
    } catch {
      this.ctx = null;
    }
  }

  private burst(dur: number, freq: number, vol: number, type: BiquadFilterType = 'lowpass') {
    if (!this.ctx || !this.noise || !this.master || this.muted) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur);
  }

  private tone(freq: number, dur: number, vol: number, type: OscillatorType = 'square', slide = 0) {
    if (!this.ctx || !this.master || this.muted) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur);
  }

  shot(kind: string, vol = 1) {
    if (kind === 'shotgun') this.burst(0.25, 1400, 0.9 * vol);
    else if (kind === 'smg') this.burst(0.07, 3200, 0.45 * vol);
    else if (kind === 'emp') this.tone(180, 0.35, 0.4 * vol, 'sine', 900);
    else this.burst(0.12, 2600, 0.6 * vol);
  }
  explosion(vol = 1) {
    this.burst(1.1, 500, 1.2 * vol);
    this.tone(70, 0.8, 0.6 * vol, 'sine', -40);
  }
  hit() {
    this.burst(0.05, 900, 0.25);
  }
  crash(vol: number) {
    this.burst(0.25, 700, Math.min(0.9, vol));
  }
  punch() {
    this.burst(0.06, 500, 0.4);
  }
  pickup() {
    this.tone(660, 0.08, 0.25);
    setTimeout(() => this.tone(990, 0.1, 0.25), 70);
  }
  horn() {
    this.tone(410, 0.25, 0.12, 'square');
  }
  mission() {
    [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.tone(f, 0.15, 0.2), i * 110));
  }
  fail() {
    [400, 300, 200].forEach((f, i) => setTimeout(() => this.tone(f, 0.2, 0.2, 'sawtooth'), i * 140));
  }
  nitro() {
    this.burst(0.4, 300, 0.35, 'bandpass');
  }

  setSiren(volume: number) {
    if (!this.ctx || !this.sirenGain) return;
    this.sirenGain.gain.setTargetAtTime(this.muted ? 0 : volume * 0.12, this.ctx.currentTime, 0.1);
  }
}
