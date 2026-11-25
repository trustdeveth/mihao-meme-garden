// Small synthesized sound effects and a gentle generative garden tune (WebAudio, no audio files).
const KEY = 'mg-audio';

export class Audio {
  constructor() {
    const saved = (() => { try { return JSON.parse(localStorage.getItem(KEY) ?? '{}'); } catch { return {}; } })();
    this.sfxVol = saved.sfx ?? 0.6;
    this.musicVol = saved.music ?? 0.35;
    this.ctx = null;
    this.musicTimer = 0;
    // browsers only allow audio after a user gesture
    const start = () => { this.unlock(); removeEventListener('pointerdown', start); removeEventListener('keydown', start); };
    addEventListener('pointerdown', start);
    addEventListener('keydown', start);
  }
  save() { try { localStorage.setItem(KEY, JSON.stringify({ sfx: this.sfxVol, music: this.musicVol })); } catch { /* private mode */ } }
  unlock() {
    if (this.ctx) return;
    try { this.ctx = new AudioContext(); } catch { return; }
    this.sfxBus = this.ctx.createGain(); this.sfxBus.gain.value = this.sfxVol; this.sfxBus.connect(this.ctx.destination);
    this.musicBus = this.ctx.createGain(); this.musicBus.gain.value = this.musicVol; this.musicBus.connect(this.ctx.destination);
    this.startMusic();
  }
  setSfx(v) { this.sfxVol = v; if (this.sfxBus) this.sfxBus.gain.value = v; this.save(); }
  setMusic(v) { this.musicVol = v; if (this.musicBus) this.musicBus.gain.value = v; this.save(); }

  tone(freq, dur, { type = 'sine', vol = 0.25, at = 0, slide = 0, bus = this.sfxBus } = {}) {
    if (!this.ctx || !bus) return;
    const t = this.ctx.currentTime + at;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(bus);
    o.start(t); o.stop(t + dur + 0.02);
  }
  thunder(close) { const v = close ? 1 : 0.45; const at = close ? 0.08 : 0.5; this.noise(0.16, { vol: 0.35 * v, freq: 900, at }); this.noise(1.3, { vol: 0.55 * v, freq: 130, at: at + 0.06 }); this.tone(70, 1.1, { type: 'triangle', vol: 0.18 * v, at, slide: 0.5 }); }
  noise(dur, { vol = 0.15, freq = 1800, at = 0 } = {}) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + at;
    const buf = this.ctx.createBuffer(1, Math.floor(this.ctx.sampleRate * dur), this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const s = this.ctx.createBufferSource(), f = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
    s.buffer = buf; f.type = 'bandpass'; f.frequency.value = freq; g.gain.value = vol;
    s.connect(f); f.connect(g); g.connect(this.sfxBus);
    s.start(t);
  }

  play(name) {
    switch (name) {
      case 'click': return this.tone(880, 0.06, { type: 'triangle', vol: 0.12 });
      case 'plant': this.noise(0.12, { freq: 600, vol: 0.2 }); return this.tone(320, 0.14, { type: 'sine', vol: 0.18, slide: 1.8, at: 0.05 });
      case 'water': return this.noise(0.5, { freq: 2600, vol: 0.12 });
      case 'harvest': this.tone(660, 0.12, { type: 'triangle', vol: 0.2 }); return this.tone(990, 0.18, { type: 'triangle', vol: 0.18, at: 0.08 });
      case 'coin': this.tone(1320, 0.08, { type: 'square', vol: 0.08 }); return this.tone(1760, 0.16, { type: 'square', vol: 0.08, at: 0.07 });
      case 'bad': return this.tone(180, 0.18, { type: 'sawtooth', vol: 0.08, slide: 0.7 });
      case 'rare': return [523, 659, 784, 1046, 1318].forEach((f, i) => this.tone(f, 0.25, { type: 'triangle', vol: 0.15, at: i * 0.07 }));
      case 'levelup': return [392, 523, 659, 784].forEach((f, i) => this.tone(f, 0.3, { type: 'triangle', vol: 0.18, at: i * 0.1 }));
      case 'hatch': this.noise(0.15, { freq: 900, vol: 0.2 }); return [784, 988, 1175].forEach((f, i) => this.tone(f, 0.2, { vol: 0.15, at: 0.1 + i * 0.08 }));
      case 'thunder': return this.noise(1.4, { freq: 120, vol: 0.5 });
      case 'pop': return this.tone(500, 0.08, { vol: 0.2, slide: 2 });
      default: return undefined;
    }
  }

  /** A slow, cheerful generative tune: pentatonic notes over soft chords. */
  startMusic() {
    const scale = [261.6, 293.7, 329.6, 392, 440, 523.3, 587.3];
    const chords = [[261.6, 329.6, 392], [220, 261.6, 329.6], [174.6, 220, 261.6], [196, 246.9, 293.7]];
    let bar = 0;
    const step = () => {
      if (!this.ctx) return;
      const ch = chords[bar % chords.length];
      ch.forEach((f) => this.tone(f / 2, 3.6, { type: 'sine', vol: 0.05, bus: this.musicBus }));
      for (let i = 0; i < 4; i++) if (Math.random() < 0.7) this.tone(scale[Math.floor(Math.random() * scale.length)], 0.6, { type: 'triangle', vol: 0.045, at: i * 0.9, bus: this.musicBus });
      bar++;
      this.musicTimer = setTimeout(step, 3600);
    };
    step();
  }
}
