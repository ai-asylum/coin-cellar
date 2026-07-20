// Procedural SFX (tiny synth helpers) + streamed music tracks. Sound effects
// are still 100% synthesized; music now plays real looped tracks from
// public/music (shop / dungeon / town / boss) with a short crossfade between
// moods. Tracks are decoded into AudioBuffers and looped with buffer sources
// (gapless — unlike an <audio loop> which hiccups on the mp3 seam). Everything
// hangs off one AudioContext created on first tap.
export class AudioBus {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.musicGain = null;
    this.muted = localStorage.getItem("ss_mute") === "1";
    this._musicMood = null; // base mood ("shop" | "dungeon" | ...)
    this._track = null;     // resolved track incl. daypart ("shop-night" | ...)
    this._buffers = {}; // track -> decoded AudioBuffer
    this._loading = {}; // track -> Promise<AudioBuffer>
    this._gains = {};   // track -> persistent GainNode
    this._sources = {}; // track -> currently playing AudioBufferSourceNode
    const boot = () => {
      this._boot();
      window.removeEventListener("pointerdown", boot);
      window.removeEventListener("keydown", boot);
    };
    window.addEventListener("pointerdown", boot);
    window.addEventListener("keydown", boot);
  }

  _boot() {
    if (this.ctx) return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.5;
    this.master.connect(this.ctx.destination);
    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0.5; // per-track gains handle the crossfade
    this.musicGain.connect(this.master);
    this._applyMood(1.5);
  }

  toggleMute() {
    this.muted = !this.muted;
    localStorage.setItem("ss_mute", this.muted ? "1" : "0");
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.5;
    return this.muted;
  }

  _tone({ f = 440, f1, dur = 0.15, type = "square", vol = 0.2, at = 0, slide = false }) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime + at;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (f1) o.frequency[slide ? "linearRampToValueAtTime" : "exponentialRampToValueAtTime"](Math.max(f1, 1), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  _noise({ dur = 0.2, vol = 0.2, f = 1200, q = 1, at = 0 }) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime + at;
    const n = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const flt = this.ctx.createBiquadFilter();
    flt.type = "bandpass";
    flt.frequency.value = f;
    flt.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.value = vol;
    src.connect(flt).connect(g).connect(this.master);
    src.start(t);
  }

  // ------------------------------------------------- named game sounds
  coin(i = 0) { this._tone({ f: 1320, f1: 1980, dur: 0.09, type: "square", vol: 0.12, at: i * 0.05 }); }
  sale() {
    [660, 880, 1100, 1320].forEach((f, i) => this._tone({ f, dur: 0.12, type: "triangle", vol: 0.22, at: i * 0.07 }));
    this.coin(4); this.coin(5);
  }
  perfect() {
    [660, 990, 1320, 1760, 2200].forEach((f, i) => this._tone({ f, dur: 0.16, type: "triangle", vol: 0.24, at: i * 0.06 }));
  }
  deny() { this._tone({ f: 220, f1: 150, dur: 0.25, type: "sawtooth", vol: 0.15 }); }
  haggle() { this._tone({ f: 520, f1: 640, dur: 0.08, type: "square", vol: 0.1 }); }
  doorbell() { this._tone({ f: 1560, dur: 0.3, type: "sine", vol: 0.2 }); this._tone({ f: 1960, dur: 0.4, type: "sine", vol: 0.15, at: 0.12 }); }
  swing() { this._noise({ dur: 0.12, vol: 0.25, f: 2400, q: 0.8 }); }
  // combo swings climb in pitch: 1st -> 2nd -> finisher gets a meatier whoosh
  swingCombo(step = 0) {
    const f = [2200, 2800, 1500][step] ?? 2200;
    this._noise({ dur: 0.11 + step * 0.02, vol: 0.24, f, q: 0.8 });
    if (step === 2) this._tone({ f: 320, f1: 90, dur: 0.14, type: "sawtooth", vol: 0.14 });
  }
  hit() { this._noise({ dur: 0.08, vol: 0.4, f: 500, q: 1.5 }); this._tone({ f: 180, f1: 60, dur: 0.1, type: "square", vol: 0.25 }); }
  crit() {
    this._noise({ dur: 0.09, vol: 0.42, f: 900, q: 1.2 });
    this._tone({ f: 260, f1: 70, dur: 0.14, type: "square", vol: 0.3 });
    this._tone({ f: 1400, f1: 2100, dur: 0.12, type: "square", vol: 0.14, at: 0.02 });
  }
  finisher() {
    this._noise({ dur: 0.16, vol: 0.45, f: 400, q: 1.3 });
    this._tone({ f: 150, f1: 45, dur: 0.22, type: "sawtooth", vol: 0.32 });
    this._tone({ f: 90, f1: 40, dur: 0.28, type: "sine", vol: 0.28, at: 0.01 });
  }
  kill() { this._tone({ f: 300, f1: 40, dur: 0.35, type: "sawtooth", vol: 0.22 }); this._noise({ dur: 0.25, vol: 0.3, f: 800 }); }
  hurt() { this._tone({ f: 240, f1: 110, dur: 0.3, type: "square", vol: 0.3 }); }
  dodge() { this._noise({ dur: 0.22, vol: 0.16, f: 1100, q: 0.5 }); this._tone({ f: 620, f1: 900, dur: 0.16, type: "sine", vol: 0.08, slide: true }); }
  // rising warble that warns the player an enemy is about to strike
  telegraph() { this._tone({ f: 420, f1: 720, dur: 0.28, type: "triangle", vol: 0.1, slide: true }); }
  shoot() { this._tone({ f: 900, f1: 300, dur: 0.18, type: "sawtooth", vol: 0.13 }); this._noise({ dur: 0.08, vol: 0.1, f: 1800, q: 0.7 }); }
  projHit() { this._noise({ dur: 0.1, vol: 0.28, f: 700, q: 1.2 }); this._tone({ f: 220, f1: 80, dur: 0.12, type: "square", vol: 0.18 }); }
  // striking something that doesn't give (a pillar): a bright metallic tink
  clank() { this._noise({ dur: 0.05, vol: 0.3, f: 3200, q: 3 }); this._tone({ f: 1250, f1: 720, dur: 0.09, type: "triangle", vol: 0.14 }); }
  step() { this._noise({ dur: 0.05, vol: 0.05, f: 700, q: 2 }); }
  hop() { this._tone({ f: 300, f1: 500, dur: 0.12, type: "sine", vol: 0.08 }); }
  // plunging down a cellar mouth: a falling whoosh that drops in pitch
  dive() { this._tone({ f: 700, f1: 90, dur: 0.5, type: "sine", vol: 0.16, slide: true }); this._noise({ dur: 0.4, vol: 0.12, f: 500, q: 0.5 }); }
  // the builder's mallet on timber: a short woody knock
  hammer() { this._noise({ dur: 0.05, vol: 0.2, f: 950, q: 1.6 }); this._tone({ f: 170, f1: 90, dur: 0.09, type: "square", vol: 0.16 }); }
  chest() { [440, 550, 660, 880].forEach((f, i) => this._tone({ f, dur: 0.14, type: "square", vol: 0.16, at: i * 0.09 })); }
  pickup() { this._tone({ f: 880, f1: 1320, dur: 0.1, type: "square", vol: 0.14 }); }
  heal() { [523, 659, 784, 1046].forEach((f, i) => this._tone({ f, dur: 0.16, type: "sine", vol: 0.16, at: i * 0.06 })); }
  stairs() { [500, 400, 320, 250].forEach((f, i) => this._tone({ f, dur: 0.15, type: "triangle", vol: 0.18, at: i * 0.1 })); }
  gameover() { [392, 370, 349, 220].forEach((f, i) => this._tone({ f, dur: 0.5, type: "sawtooth", vol: 0.2, at: i * 0.3 })); }
  victory() { [523, 659, 784, 1046, 784, 1046].forEach((f, i) => this._tone({ f, dur: 0.25, type: "triangle", vol: 0.25, at: i * 0.13 })); }

  // ------------------------------------------------- music (looped tracks)
  // Real tracks in public/music, decoded once and looped gaplessly, routed
  // through musicGain with a short crossfade. menu/shop/town also vary by the
  // player's local time of day (morning / day / night).
  setMood(mood) {
    const track = this._trackFor(mood);
    this._musicMood = mood; // "menu" | "shop" | "dungeon" | "town" | "boss" | null
    if (track === this._track) return;
    this._track = track;
    if (this.ctx) this._applyMood();
  }

  // Which part of the day it is, from the player's local clock.
  _daypart() {
    const h = new Date().getHours();
    if (h >= 5 && h < 11) return "morning";
    if (h >= 11 && h < 18) return "day";
    return "night";
  }

  // Resolve a mood to an actual track file name. menu/shop/town get a
  // time-of-day suffix (the plain name is the "day" version); everything else
  // maps straight through.
  _trackFor(mood) {
    if (!mood) return null;
    if (mood === "menu" || mood === "shop" || mood === "town") {
      const dp = this._daypart();
      return dp === "day" ? mood : `${mood}-${dp}`;
    }
    return mood;
  }

  _loadBuffer(mood) {
    if (this._buffers[mood]) return Promise.resolve(this._buffers[mood]);
    if (!this._loading[mood]) {
      this._loading[mood] = fetch(`${import.meta.env.BASE_URL}music/${mood}.mp3`)
        .then((r) => r.arrayBuffer())
        .then((a) => this.ctx.decodeAudioData(a))
        .then((buf) => (this._buffers[mood] = buf))
        .catch((e) => { this._loading[mood] = null; throw e; });
    }
    return this._loading[mood];
  }

  _gainFor(mood) {
    let g = this._gains[mood];
    if (!g) {
      g = this._gains[mood] = this.ctx.createGain();
      g.gain.value = 0;
      g.connect(this.musicGain);
    }
    return g;
  }

  _stopMood(mood, fade) {
    const src = this._sources[mood];
    if (!src) return;
    const t = this.ctx.currentTime;
    const g = this._gains[mood].gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(Math.max(g.value, 0.0001), t);
    g.linearRampToValueAtTime(0.0001, t + fade);
    try { src.stop(t + fade + 0.05); } catch {}
    this._sources[mood] = null;
  }

  async _applyMood(fade = 3.0) {
    if (!this.ctx) return;
    const target = this._track;
    // fade out (and stop) every track that isn't the target
    for (const track of Object.keys(this._sources)) {
      if (track !== target) this._stopMood(track, fade);
    }
    if (!target) return;

    // already playing? just make sure it's faded up
    if (this._sources[target]) {
      const t = this.ctx.currentTime;
      const g = this._gains[target].gain;
      g.cancelScheduledValues(t);
      g.setValueAtTime(Math.max(g.value, 0.0001), t);
      g.linearRampToValueAtTime(1, t + fade);
      return;
    }

    let buffer;
    try { buffer = await this._loadBuffer(target); }
    catch { return; }
    // track may have changed (or a source started) while decoding
    if (this._track !== target || this._sources[target]) return;

    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    const gain = this._gainFor(target);
    src.connect(gain);
    const t = this.ctx.currentTime;
    gain.gain.cancelScheduledValues(t);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(1, t + fade);
    src.start();
    this._sources[target] = src;
  }
}
