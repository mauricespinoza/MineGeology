// Sound, all synthesised with Web Audio, so nothing is downloaded: calm music that never stops and keeps
// changing (composer.ts writes it as it plays), the wind,
// the blows of the hammer and now and then a bird. Off until the student starts playing,
// as browsers require; the choice of sound on or off is kept in this browser.
//
// Phones stop the sound on their own: a call, the lock screen, another app or a long time in the background
// suspend the audio, and Safari sometimes leaves it "interrupted", or running but silent. So every tap or key
// wakes the sound up again, and a context that will not come back is replaced by a new one.

import { type Section, chordNotes, midiToHz, newSection, phrase, restAfter } from "./composer";

const KEY = "geomapper:sound";

/** Seconds by which each chord's swell overlaps the end of the chord before it. */
const CROSSFADE_S = 2.5;

export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private music: GainNode | null = null;
  private effects: GainNode | null = null;
  private reverb: ConvolverNode | null = null;
  private timers: number[] = [];
  private noise: AudioBuffer | null = null;
  /** The section of the music now playing, when it began (ms), and where in its progression it is. */
  private section: Section | null = null;
  private sectionStart = 0;
  private chordStep = 0;
  private lastNote: number | undefined;
  /** When the page was last hidden, to rebuild the sound after a long time in the background. */
  private hiddenAt = 0;
  private waking = false;
  enabled: boolean;

  constructor() {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(KEY);
    } catch {
      // A private window: sound stays on for this visit.
    }
    this.enabled = saved !== "off";
    // iOS: play through the silent switch, like a game, rather than as a ringtone-like "ambient" sound.
    try {
      const session = (navigator as unknown as { audioSession?: { type: string } }).audioSession;
      if (session) session.type = "playback";
    } catch {
      // Not supported: nothing to do.
    }
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        this.hiddenAt = performance.now();
        if (this.ctx?.state === "running") void this.ctx.suspend().catch(() => {});
      } else this.wake();
    });
    window.addEventListener("pageshow", () => this.wake());
    window.addEventListener("focus", () => this.wake());
    // Any tap, click or key may resume the sound: browsers only let it start inside such a gesture.
    for (const type of ["pointerdown", "touchend", "keydown"]) document.addEventListener(type, () => this.wake(), { capture: true, passive: true });
  }

  /** Whether the sound is on and actually playing; for tests and debugging. */
  get playing(): boolean {
    return this.enabled && this.ctx?.state === "running";
  }

  /** Call from a tap or a click: starts the music and the birds if sound is on. */
  start(): void {
    if (!this.enabled) return;
    if (!this.ctx || this.ctx.state === "closed") this.build();
    this.unlock();
    void this.ctx!.resume().catch(() => {});
    if (!this.timers.length) this.schedule();
  }

  /**
   * Brings the sound back if it has stopped: resumes a suspended or interrupted context and, if it does not come
   * back (or came back after a long time hidden, when Safari may leave it silent), replaces it with a new one.
   */
  wake(): void {
    if (!this.enabled || !this.ctx || document.visibilityState === "hidden" || this.waking) return;
    const ctx = this.ctx;
    const longAway = this.hiddenAt > 0 && performance.now() - this.hiddenAt > 60_000;
    this.hiddenAt = 0;
    if (ctx.state === "running" && !longAway) return;
    this.waking = true;
    this.unlock();
    const check = () => {
      this.waking = false;
      if (this.ctx !== ctx || !this.enabled) return;
      if (ctx.state !== "running" || longAway) this.rebuild();
      else if (!this.timers.length) this.schedule();
    };
    ctx.resume().then(() => setTimeout(check, 250), () => setTimeout(check, 0));
  }

  /** Throws the old context away and starts a fresh one. */
  private rebuild(): void {
    const old = this.ctx;
    this.ctx = null;
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    void old?.close().catch(() => {});
    this.start();
  }

  /** Plays one silent sample: older iOS only lets a context make sound after something was started in a gesture. */
  private unlock(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    try {
      const src = ctx.createBufferSource();
      src.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
      src.connect(ctx.destination);
      src.start(0);
    } catch {
      // A closed context: the next start builds a new one.
    }
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    try {
      localStorage.setItem(KEY, on ? "on" : "off");
    } catch {
      // Not kept in a private window.
    }
    if (on) this.start();
    else {
      for (const t of this.timers) clearTimeout(t);
      this.timers = [];
      void this.ctx?.suspend().catch(() => {});
    }
  }

  private build(): void {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = (this.ctx = new AC({ latencyHint: "playback" }));
    // A context the system interrupts (a call, Siri, another app) is woken by the next tap.
    ctx.onstatechange = () => {
      if (this.ctx === ctx && ctx.state !== "running" && ctx.state !== "closed" && document.visibilityState === "visible" && this.enabled) void ctx.resume().catch(() => {});
    };
    this.master = ctx.createGain();
    this.master.gain.value = 0.8;
    this.master.connect(ctx.destination);
    this.music = ctx.createGain();
    this.music.gain.value = 0.18;
    this.effects = ctx.createGain();
    this.effects.gain.value = 0.55;
    this.effects.connect(this.master);
    // A soft hall: decaying noise as the impulse response.
    this.reverb = ctx.createConvolver();
    // Short enough for a phone to convolve in real time without dropping out.
    const len = Math.floor(ctx.sampleRate * 2), ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2.6;
    }
    this.reverb.buffer = ir;
    const wet = ctx.createGain();
    wet.gain.value = 0.55;
    this.music.connect(this.reverb).connect(wet).connect(this.master);
    this.music.connect(this.master);
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const n = this.noise.getChannelData(0);
    for (let i = 0; i < n.length; i++) n[i] = Math.random() * 2 - 1;
    this.wind();
  }

  private later(ms: number, f: () => void): void {
    const id = window.setTimeout(() => {
      this.timers = this.timers.filter((t) => t !== id);
      if (!this.enabled) return;
      // While the sound is suspended its clock stands still: notes made now would all sound at once on waking.
      if (this.ctx?.state === "running") f();
      else this.later(ms, f);
    }, ms);
    this.timers.push(id);
  }

  /**
   * The music, which never stops: a bed of chords, each fading into the next, a soft bass, and phrases of melody
   * over them; every two or three minutes a new section changes key, progression, pace and instrument (see
   * composer.ts). The birds keep their own clock.
   */
  private schedule(): void {
    const chord = () => {
      const now = performance.now();
      if (!this.section || now - this.sectionStart > this.section.seconds * 1000) {
        this.section = newSection(Math.random, this.section ?? undefined);
        this.sectionStart = now;
        this.chordStep = 0;
      }
      const s = this.section;
      const degree = s.progression[this.chordStep++ % s.progression.length]!;
      this.chord(s, degree);
      // The next chord swells in while this one still holds, so the bed never dips between chords.
      this.later((s.chordSeconds - CROSSFADE_S) * 1000, chord);
    };
    const melody = () => {
      const s = this.section;
      if (!s) return this.later(1000, melody);
      const p = phrase(s, Math.random, this.lastNote);
      this.lastNote = p.last;
      const t0 = this.ctx!.currentTime + 0.05;
      for (const n of p.notes) this.voice(s.instrument, midiToHz(n.midi), t0 + n.at, n.length, n.velocity);
      this.later((p.seconds + restAfter(s, Math.random)) * 1000, melody);
    };
    const bird = () => {
      if (Math.random() < 0.35) this.caw();
      else this.chirps();
      this.later(18000 + Math.random() * 35000, bird);
    };
    chord();
    this.later(2500, melody);
    this.later(6000 + Math.random() * 8000, bird);
  }

  /**
   * One chord of the bed: it swells for a few seconds, holds, and fades out over the next chord's swell, so the bed
   * is continuous. Two slightly detuned voices per note through a slowly opening filter; a sine bass below.
   */
  private chord(section: Section, degree: number): void {
    const ctx = this.ctx!, t = ctx.currentTime + 0.05;
    const hold = section.chordSeconds, fade = 9, swell = 3.5;
    const { bass, tones } = chordNotes(section, degree, Math.random);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.32, t + swell);
    // A gentle release (time constant 1.8 s) that is inaudible well before the oscillators stop.
    g.gain.setValueAtTime(0.32, t + hold);
    g.gain.setTargetAtTime(0, t + hold, 1.8);
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.Q.value = 0.7;
    filter.frequency.setValueAtTime(section.brightness * 0.6, t);
    filter.frequency.linearRampToValueAtTime(section.brightness, t + hold * 0.6);
    filter.frequency.linearRampToValueAtTime(section.brightness * 0.7, t + hold + fade);
    filter.connect(g).connect(this.music!);
    const end = t + hold + fade + 0.1;
    const level = 1 / (tones.length * 2 + 1);
    const add = (freq: number, type: OscillatorType, detune: number, gain: number) => {
      const o = ctx.createOscillator(), og = ctx.createGain();
      o.type = type;
      o.frequency.value = freq;
      o.detune.value = detune;
      og.gain.value = gain;
      o.connect(og).connect(filter);
      o.start(t);
      o.stop(end);
    };
    for (const m of tones) {
      add(midiToHz(m), "triangle", -7, level);
      add(midiToHz(m), "sine", 6, level);
    }
    add(midiToHz(bass), "sine", 0, level * 2.2);
  }

  /** One note of the melody, at audio time `t`, in the section's instrument. */
  private voice(instrument: Section["instrument"], freq: number, t: number, length: number, velocity: number): void {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    const peak = 0.42 * velocity;
    const parts: [OscillatorType, number, number][] =
      instrument === "bell" ? [["sine", 1, 1], ["sine", 2.01, 0.35], ["sine", 3.0, 0.12]]
      : instrument === "flute" ? [["sine", 1, 1], ["triangle", 1, 0.3]]
      : [["triangle", 1, 1], ["sine", 2, 0.2]];
    const attack = instrument === "flute" ? 0.09 : 0.012;
    const decay = instrument === "flute" ? length : instrument === "bell" ? length * 2.2 : length * 1.4;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    if (instrument === "flute") g.gain.setValueAtTime(peak * 0.85, t + Math.max(attack, length - 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    g.connect(this.music!);
    for (const [type, ratio, level] of parts) {
      const o = ctx.createOscillator(), og = ctx.createGain();
      o.type = type;
      o.frequency.value = freq * ratio;
      og.gain.value = level;
      // A flute breathes: a slow, light vibrato.
      if (instrument === "flute") {
        const lfo = ctx.createOscillator(), depth = ctx.createGain();
        lfo.frequency.value = 4.8;
        depth.gain.value = freq * 0.004;
        lfo.connect(depth).connect(o.frequency);
        lfo.start(t);
        lfo.stop(t + attack + decay + 0.1);
      }
      o.connect(og).connect(g);
      o.start(t);
      o.stop(t + attack + decay + 0.1);
    }
  }

  /** A low, slowly changing wind, very quiet. */
  private wind(): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 420;
    filter.Q.value = 0.6;
    const lfo = ctx.createOscillator(), depth = ctx.createGain();
    lfo.frequency.value = 0.07;
    depth.gain.value = 220;
    lfo.connect(depth).connect(filter.frequency);
    const g = ctx.createGain();
    g.gain.value = 0.05;
    src.connect(filter).connect(g).connect(this.master!);
    src.start();
    lfo.start();
  }

  /** Three blows of the hammer on rock, timed with the swing in the view (0.3 s apart, the first at 0.18 s). */
  hammer(): void {
    if (!this.enabled) return;
    this.start();
    const ctx = this.ctx!;
    for (let k = 0; k < 3; k++) {
      const t = ctx.currentTime + 0.18 + k * 0.3;
      // The crack of steel on stone: a burst of filtered noise...
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      const band = ctx.createBiquadFilter();
      band.type = "bandpass";
      band.frequency.value = 2200 + Math.random() * 600;
      band.Q.value = 1.4;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.9, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
      src.connect(band).connect(g).connect(this.effects!);
      src.start(t, Math.random(), 0.12);
      // ...a short ring of the steel head, and the thud of the blow.
      for (const [f, level, decay] of [[2900, 0.12, 0.18], [4300, 0.06, 0.12], [140, 0.5, 0.08]] as const) {
        const o = ctx.createOscillator(), og = ctx.createGain();
        o.frequency.value = f * (0.97 + Math.random() * 0.06);
        og.gain.setValueAtTime(level, t);
        og.gain.exponentialRampToValueAtTime(0.0005, t + decay);
        o.connect(og).connect(this.effects!);
        o.start(t);
        o.stop(t + decay + 0.02);
      }
    }
  }

  /** A small bird: a few quick rising whistles, from one side. */
  private chirps(): void {
    const ctx = this.ctx!, pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 1.6 - 0.8;
    pan.connect(this.effects!);
    const n = 3 + Math.floor(Math.random() * 4), base = 2600 + Math.random() * 1400;
    for (let k = 0; k < n; k++) {
      const t = ctx.currentTime + k * (0.11 + Math.random() * 0.05);
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "sine";
      o.frequency.setValueAtTime(base, t);
      o.frequency.exponentialRampToValueAtTime(base * 1.5, t + 0.07);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.09, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0005, t + 0.09);
      o.connect(g).connect(pan);
      o.start(t);
      o.stop(t + 0.1);
    }
  }

  /** A raptor's harsh call, like a tiuque (chimango) far off: two or three falling screeches. */
  private caw(): void {
    const ctx = this.ctx!, pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 1.4 - 0.7;
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 1500;
    band.Q.value = 2.5;
    band.connect(pan).connect(this.effects!);
    const n = 2 + Math.floor(Math.random() * 2);
    for (let k = 0; k < n; k++) {
      const t = ctx.currentTime + k * 0.42;
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "sawtooth";
      o.frequency.setValueAtTime(1150, t);
      o.frequency.exponentialRampToValueAtTime(650, t + 0.3);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.06, t + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0005, t + 0.32);
      o.connect(g).connect(band);
      o.start(t);
      o.stop(t + 0.34);
    }
  }
}
