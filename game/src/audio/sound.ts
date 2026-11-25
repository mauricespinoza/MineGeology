// Sound, all synthesised with Web Audio, so nothing is downloaded: music, the wind,
// the blows of the hammer, the running water of streams and now and then a bird. Off until the student starts playing,
// as browsers require; the choice of sound on or off, and of the music, is kept in this browser.
//
// The student chooses the music (see MUSIC_STYLES): lo-fi beats to study by, the calm drifting notes, an Andean
// tune of quena and charango, or none at all, only the wind and the birds. Every tune is generated as it plays,
// from fixed chords and a little chance, so it never repeats exactly. Notes are scheduled a fraction of a second
// ahead on the audio clock, so the beat keeps time even when the page is busy.
//
// Phones stop the sound on their own: a call, the lock screen, another app or a long time in the background
// suspend the audio, and Safari sometimes leaves it "interrupted", or running but silent. So every tap or key
// wakes the sound up again, and a context that will not come back is replaced by a new one.

const KEY = "geomapper:sound";
const MUSIC_KEY = "geomapper:music";
// D major pentatonic over two octaves: no note clashes with another.
const SCALE = [146.83, 164.81, 185.0, 220.0, 246.94, 293.66, 329.63, 369.99, 440.0, 493.88];

export type MusicStyle = "lofi" | "calma" | "andina" | "naturaleza";
/** The choices offered to the student, in the order shown. */
export const MUSIC_STYLES: { id: MusicStyle; name: string; hint: string }[] = [
  { id: "lofi", name: "Lo-fi", hint: "ritmo suave para concentrarse, con piano eléctrico y crujido de vinilo" },
  { id: "calma", name: "Calma", hint: "notas lentas y un fondo tranquilo" },
  { id: "andina", name: "Andina", hint: "quena, charango y bombo en 6/8" },
  { id: "naturaleza", name: "Solo naturaleza", hint: "sin música: el viento y los pájaros" },
];

const midi = (m: number) => 440 * 2 ** ((m - 69) / 12);
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)]!;

// Lo-fi: two four-bar progressions of seventh and ninth chords, each a bass note and a voicing for the keys.
const LOFI_CHORDS: { bass: number; keys: number[] }[][] = [
  [
    { bass: 50, keys: [53, 57, 60, 64] }, // Dm9
    { bass: 43, keys: [53, 59, 64] }, // G13
    { bass: 48, keys: [52, 55, 59, 62] }, // Cmaj9
    { bass: 45, keys: [55, 60, 64, 71] }, // Am9
  ],
  [
    { bass: 41, keys: [57, 60, 64, 67] }, // Fmaj9
    { bass: 40, keys: [55, 59, 62, 64] }, // Em7
    { bass: 38, keys: [53, 57, 60, 64] }, // Dm7
    { bass: 43, keys: [53, 57, 59, 62] }, // G9sus
  ],
];
const LOFI_MELODY = [72, 74, 76, 79, 81, 84];
// Andean: A minor, its relative C major and the dominant E, as a charango strums them; the quena plays
// the A minor pentatonic.
const ANDEAN_CHORDS: number[][][] = [
  [[69, 72, 76, 81], [67, 71, 74, 79], [67, 72, 76, 79], [68, 71, 76, 80]], // Am G C E
  [[69, 72, 76, 81], [69, 74, 77, 81], [68, 71, 76, 80], [69, 72, 76, 81]], // Am Dm E Am
];
const ANDEAN_BASS = [[45, 43, 48, 40], [45, 50, 40, 45]];
const QUENA = [69, 72, 74, 76, 79, 81, 84];

export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private music: GainNode | null = null;
  /** This style's own gain under the music bus, faded out when the student picks another. */
  private styleBus: GainNode | null = null;
  /** Counts the music started; a scheduler from an older one stops by itself. */
  private musicGen = 0;
  private effects: GainNode | null = null;
  private reverb: ConvolverNode | null = null;
  /** How much of the music goes to the hall: a lot for the calm notes, little for the beat. */
  private wet: GainNode | null = null;
  private timers: number[] = [];
  private noise: AudioBuffer | null = null;
  /** When the page was last hidden, to rebuild the sound after a long time in the background. */
  private hiddenAt = 0;
  /** The running water: its gain follows how close the student is to a stream (see setWater). */
  private water: GainNode | null = null;
  private waterLevel = 0;
  private wading = false;
  private wadingWalk = false;
  private lastSplash = 0;
  private waking = false;
  enabled: boolean;
  style: MusicStyle = "calma";

  constructor() {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(KEY);
      const style = localStorage.getItem(MUSIC_KEY);
      if (MUSIC_STYLES.some((m) => m.id === style)) this.style = style as MusicStyle;
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

  /** Changes the music: the old tune fades out over a second and a half while the new one begins. */
  setMusic(style: MusicStyle): void {
    if (style === this.style) return;
    this.style = style;
    try {
      localStorage.setItem(MUSIC_KEY, style);
    } catch {
      // Not kept in a private window.
    }
    if (!this.enabled || !this.ctx || this.ctx.state === "closed") return;
    this.fadeOutStyle();
    this.startMusic();
  }

  private fadeOutStyle(): void {
    const old = this.styleBus, ctx = this.ctx;
    this.styleBus = null;
    this.musicGen++;
    if (!old || !ctx) return;
    const t = ctx.currentTime;
    old.gain.cancelScheduledValues(t);
    old.gain.setValueAtTime(old.gain.value, t);
    old.gain.linearRampToValueAtTime(0, t + 1.5);
    setTimeout(() => old.disconnect(), 2500);
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
    this.music.gain.value = 0.16;
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
    const wet = (this.wet = ctx.createGain());
    wet.gain.value = 0.55;
    this.music.connect(this.reverb).connect(wet).connect(this.master);
    this.music.connect(this.master);
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const n = this.noise.getChannelData(0);
    for (let i = 0; i < n.length; i++) n[i] = Math.random() * 2 - 1;
    this.wind();
    this.stream();
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

  /** The music of the chosen style and the birds, each on its own clock. */
  private schedule(): void {
    const bird = () => {
      if (Math.random() < 0.35) this.caw();
      else this.chirps();
      // With no music the birds are heard more often.
      this.later(this.style === "naturaleza" ? 9000 + Math.random() * 16000 : 18000 + Math.random() * 35000, bird);
    };
    this.startMusic();
    this.later(6000 + Math.random() * 8000, bird);
  }

  /** Starts the chosen style on a fresh bus of its own. */
  private startMusic(): void {
    const ctx = this.ctx!;
    if (this.styleBus?.context === ctx) this.fadeOutStyle(); // music left over from before the sound was turned off
    const gen = ++this.musicGen;
    const bus = (this.styleBus = ctx.createGain());
    const wet = { lofi: 0.12, calma: 0.55, andina: 0.3, naturaleza: 0.3 }[this.style];
    this.wet!.gain.setTargetAtTime(wet, ctx.currentTime, 0.4);
    bus.gain.setValueAtTime(0, ctx.currentTime);
    bus.gain.linearRampToValueAtTime(1, ctx.currentTime + 1.2);
    bus.connect(this.music!);
    if (this.style === "calma") this.calm(gen, bus);
    else if (this.style === "lofi") this.lofi(gen, bus);
    else if (this.style === "andina") this.andean(gen, bus);
  }

  /**
   * Calls `step` for each step of a steady beat, `ahead` seconds before it sounds, until another style starts.
   * After the sound was suspended the beat picks up from now rather than playing the missed steps at once.
   */
  private beat(gen: number, stepSeconds: number, step: (n: number, t: number) => void): void {
    let n = 0, next = this.ctx!.currentTime + 0.15;
    const tick = () => {
      if (gen !== this.musicGen || !this.ctx) return;
      const now = this.ctx.currentTime;
      if (next < now) next = now + 0.05;
      while (next < now + 0.3) {
        step(n++, next);
        next += stepSeconds;
      }
      this.later(90, tick);
    };
    tick();
  }

  /** Calma: slow, soft notes of the scale over a quiet drone. */
  private calm(gen: number, bus: GainNode): void {
    const note = () => {
      if (gen !== this.musicGen) return;
      this.pad(SCALE[Math.floor(Math.random() * SCALE.length)]!, 4 + Math.random() * 3, bus);
      if (Math.random() < 0.35) this.pad(SCALE[Math.floor(Math.random() * 5)]! / 2, 7, bus);
      this.later(2200 + Math.random() * 3200, note);
    };
    note();
  }

  /**
   * Lo-fi: a lazy, swung beat at 76 per minute, electric-piano chords, a round bass, a few notes of melody,
   * all through a dull filter, with the crackle and hiss of an old record.
   */
  private lofi(gen: number, bus: GainNode): void {
    const ctx = this.ctx!;
    const tone = ctx.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = 2300;
    tone.Q.value = 0.4;
    const level = ctx.createGain();
    level.gain.value = 1.5;
    tone.connect(level).connect(bus);
    // A slow wobble of pitch, as on a worn tape.
    const wow = ctx.createOscillator(), wowDepth = ctx.createGain();
    wow.frequency.value = 0.45;
    wowDepth.gain.value = 9;
    wow.connect(wowDepth);
    wow.start();
    this.vinyl(gen, bus);
    const sixteenth = 60 / 76 / 4, swing = sixteenth * 0.32;
    let progression = 0;
    this.beat(gen, sixteenth, (n, t0) => {
      const s = n % 16, bar = Math.floor(n / 16) % 4;
      if (s === 0 && bar === 0 && n > 0 && Math.floor(n / 64) % 2 === 0) progression = 1 - progression;
      const t = t0 + (s % 2 ? swing : 0);
      const chord = LOFI_CHORDS[progression]![bar]!;
      // Drums: kick on 1 and the "and" of 3 (and now and then before 3), snare on 2 and 4, soft swung hats.
      if (s === 0 || s === 10 || (s === 7 && Math.random() < 0.3)) this.kick(t, tone);
      if (s === 4 || s === 12) this.snare(t, tone, 1);
      else if ((s === 15 || s === 9) && Math.random() < 0.18) this.snare(t, tone, 0.3);
      if (s % 2 === 0 && Math.random() > 0.08) this.hat(t, tone, s % 4 === 0 ? 1 : 0.6);
      // Keys: the chord on the bar, sometimes pushed ahead to the "and" of 4 of the bar before.
      if (s === 0) this.keys(chord.keys, t, sixteenth * 14, 0.5, tone, wowDepth);
      if (s === 6 && Math.random() < 0.35) this.keys(chord.keys.slice(1), t, sixteenth * 4, 0.3, tone, wowDepth);
      // Bass: the root on 1 and a short note before 3.
      if (s === 0) this.bass(midi(chord.bass), t, sixteenth * 6, tone);
      if (s === 8 && Math.random() < 0.6) this.bass(midi(chord.bass + (Math.random() < 0.5 ? 7 : 12)), t, sixteenth * 3, tone);
      // A few notes of melody, high and quiet.
      if (s % 4 === 2 && Math.random() < 0.16) this.keys([pick(LOFI_MELODY)], t, sixteenth * 3, 0.32, tone, wowDepth);
    });
  }

  /** Andina: a charango strumming in 6/8, a bombo on the beats and a quena with phrases of its own. */
  private andean(gen: number, styleBus: GainNode): void {
    const bus = this.ctx!.createGain();
    bus.gain.value = 2.6; // as loud as the other styles
    bus.connect(styleBus);
    const eighth = 60 / 72 / 3;
    let line = 0;
    let phraseUntil = -1;
    this.beat(gen, eighth, (n, t) => {
      const s = n % 6, bar = Math.floor(n / 6) % 4, round = Math.floor(n / 24);
      if (s === 0 && bar === 0) line = round % 2;
      const chord = ANDEAN_CHORDS[line]![bar]!;
      // Bombo: a deep beat on 1, a lighter one on 4.
      if (s === 0) this.bombo(t, 1, bus);
      if (s === 3) this.bombo(t, 0.5, bus);
      // Charango: down, down-up, down-up strums.
      if (s === 0 || s === 2 || s === 3 || s === 5) this.strum(chord, t, s === 0 || s === 3, bus);
      // Bass of a guitar under it.
      if (s === 0) this.pluck(midi(ANDEAN_BASS[line]![bar]!), t, 0.9, 0.22, 900, bus);
      // The quena starts a phrase now and then, at the beginning of a bar.
      if (s === 0 && n >= phraseUntil && Math.random() < 0.55) phraseUntil = n + this.quenaPhrase(t, eighth, chord, bus);
    });
  }

  /** A phrase of the quena from `t`; returns its length in eighths. */
  private quenaPhrase(t: number, eighth: number, chord: number[], bus: GainNode): number {
    let at = t, used = 0, i = QUENA.indexOf(69) + Math.floor(Math.random() * 4);
    const notes = 4 + Math.floor(Math.random() * 4);
    for (let k = 0; k < notes; k++) {
      const last = k === notes - 1;
      // Mostly steps, now and then a leap; the last note rests on a note of the chord.
      i = Math.min(Math.max(i + pick([-1, -1, 1, 1, 2, -2, 0]), 0), QUENA.length - 1);
      let m = QUENA[i]!;
      if (last) m = chord.reduce((a, b) => (Math.abs(b + 12 - m) < Math.abs(a - m) ? b + 12 : a), chord[0]! + 12);
      const length = last ? 4 + Math.floor(Math.random() * 3) : pick([1, 1, 2, 2, 3]);
      this.quena(midi(m), at, length * eighth * 0.95, bus);
      at += length * eighth;
      used += length;
    }
    return used + 2;
  }

  private pad(freq: number, seconds: number, out: AudioNode = this.music!): void {
    const ctx = this.ctx!, t = ctx.currentTime;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.5, t + seconds * 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 1400;
    for (const [type, detune] of [["triangle", -6], ["sine", 5]] as const) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      o.detune.value = detune;
      o.connect(filter);
      o.start(t);
      o.stop(t + seconds + 0.1);
    }
    filter.connect(g).connect(out);
  }

  /** An electric piano: a sine whose bright attack (a little frequency modulation) dies away. */
  private keys(notes: number[], t: number, seconds: number, level: number, out: AudioNode, wow: AudioNode): void {
    const ctx = this.ctx!;
    notes.forEach((m, k) => {
      const at = t + k * 0.012 * Math.random(), f = midi(m);
      const car = ctx.createOscillator(), mod = ctx.createOscillator(), index = ctx.createGain(), g = ctx.createGain();
      car.frequency.value = f;
      car.detune.value = (Math.random() - 0.5) * 10;
      wow.connect(car.detune);
      mod.frequency.value = f;
      index.gain.setValueAtTime(f * 1.4, at);
      index.gain.exponentialRampToValueAtTime(f * 0.08, at + 0.5);
      mod.connect(index).connect(car.frequency);
      const peak = (level / Math.sqrt(notes.length)) * (0.85 + 0.3 * Math.random());
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(peak, at + 0.008);
      g.gain.exponentialRampToValueAtTime(peak * 0.35, at + 1.2);
      g.gain.setValueAtTime(peak * 0.35, at + Math.max(seconds - 0.15, 0.05));
      g.gain.exponentialRampToValueAtTime(0.0005, at + seconds + 0.25);
      car.connect(g).connect(out);
      for (const o of [car, mod]) {
        o.start(at);
        o.stop(at + seconds + 0.3);
      }
      car.onended = () => wow.disconnect(car.detune);
    });
  }

  private bass(f: number, t: number, seconds: number, out: AudioNode): void {
    const ctx = this.ctx!, o = ctx.createOscillator(), g = ctx.createGain(), lp = ctx.createBiquadFilter();
    o.type = "triangle";
    o.frequency.value = f;
    lp.type = "lowpass";
    lp.frequency.value = 420;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.55, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.25, t + seconds * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0005, t + seconds);
    o.connect(lp).connect(g).connect(out);
    o.start(t);
    o.stop(t + seconds + 0.05);
  }

  /** A soft, round kick: a sine falling in pitch. */
  private kick(t: number, out: AudioNode): void {
    const ctx = this.ctx!, o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
    g.gain.setValueAtTime(0.7, t);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 0.38);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + 0.4);
  }

  /** A dusty snare: a burst of band-passed noise over a short low tone. */
  private snare(t: number, out: AudioNode, level: number): void {
    const ctx = this.ctx!, src = ctx.createBufferSource(), band = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = this.noise;
    band.type = "bandpass";
    band.frequency.value = 1700;
    band.Q.value = 0.8;
    g.gain.setValueAtTime(0.32 * level, t);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 0.2);
    src.connect(band).connect(g).connect(out);
    src.start(t, Math.random(), 0.22);
    const o = ctx.createOscillator(), og = ctx.createGain();
    o.frequency.value = 185;
    og.gain.setValueAtTime(0.18 * level, t);
    og.gain.exponentialRampToValueAtTime(0.0005, t + 0.09);
    o.connect(og).connect(out);
    o.start(t);
    o.stop(t + 0.1);
  }

  private hat(t: number, out: AudioNode, level: number): void {
    const ctx = this.ctx!, src = ctx.createBufferSource(), hp = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = this.noise;
    hp.type = "highpass";
    hp.frequency.value = 6500;
    g.gain.setValueAtTime(0.09 * level * (0.7 + 0.5 * Math.random()), t);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 0.05);
    src.connect(hp).connect(g).connect(out);
    src.start(t, Math.random(), 0.06);
  }

  /** The crackle and hiss of an old record, while lo-fi plays. */
  private vinyl(gen: number, out: AudioNode): void {
    const ctx = this.ctx!, rate = ctx.sampleRate;
    const buffer = ctx.createBuffer(1, rate * 4, rate), d = buffer.getChannelData(0);
    for (let i = 0; i < d.length; i++) {
      d[i] = (Math.random() * 2 - 1) * 0.04; // hiss
      if (Math.random() < 0.00035) d[i] = (Math.random() < 0.5 ? -1 : 1) * (0.3 + 0.7 * Math.random()); // a crackle
    }
    const src = ctx.createBufferSource(), band = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = buffer;
    src.loop = true;
    band.type = "bandpass";
    band.frequency.value = 3200;
    band.Q.value = 0.5;
    g.gain.value = 0.22;
    src.connect(band).connect(g).connect(out);
    src.start();
    const watch = () => (gen === this.musicGen ? this.later(1000, watch) : setTimeout(() => src.stop(), 2000));
    watch();
  }

  /** A plucked string: a bright tone that dulls and dies away quickly. */
  private pluck(f: number, t: number, seconds: number, level: number, bright: number, out: AudioNode): void {
    const ctx = this.ctx!, g = ctx.createGain(), lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(bright * 2.5, t);
    lp.frequency.exponentialRampToValueAtTime(bright * 0.5, t + seconds * 0.6);
    g.gain.setValueAtTime(level, t);
    g.gain.exponentialRampToValueAtTime(0.0005, t + seconds);
    for (const [type, detune] of [["sawtooth", -4], ["triangle", 5]] as const) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      o.detune.value = detune;
      o.connect(lp);
      o.start(t);
      o.stop(t + seconds + 0.05);
    }
    lp.connect(g).connect(out);
  }

  /** The charango: its strings struck one after another, downward or upward. */
  private strum(chord: number[], t: number, down: boolean, out: AudioNode): void {
    const notes = down ? chord : [...chord].reverse();
    notes.forEach((m, k) => this.pluck(midi(m), t + k * 0.014, down ? 0.45 : 0.3, (down ? 0.07 : 0.045) * (0.8 + 0.4 * Math.random()), 1800, out));
  }

  private bombo(t: number, level: number, out: AudioNode): void {
    const ctx = this.ctx!, o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(85, t);
    o.frequency.exponentialRampToValueAtTime(48, t + 0.2);
    g.gain.setValueAtTime(0.55 * level, t);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 0.45);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + 0.5);
    // The beater on the skin.
    const src = ctx.createBufferSource(), lp = ctx.createBiquadFilter(), ng = ctx.createGain();
    src.buffer = this.noise;
    lp.type = "lowpass";
    lp.frequency.value = 900;
    ng.gain.setValueAtTime(0.18 * level, t);
    ng.gain.exponentialRampToValueAtTime(0.0005, t + 0.06);
    src.connect(lp).connect(ng).connect(out);
    src.start(t, Math.random(), 0.08);
  }

  /** The quena: a breathy flute that scoops up to the note and then takes a vibrato. */
  private quena(f: number, t: number, seconds: number, out: AudioNode): void {
    const ctx = this.ctx!, g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.16, t + 0.06);
    g.gain.setValueAtTime(0.14, t + Math.max(seconds - 0.1, 0.07));
    g.gain.linearRampToValueAtTime(0, t + seconds + 0.08);
    g.connect(out);
    const vib = ctx.createOscillator(), depth = ctx.createGain();
    vib.frequency.value = 5.3;
    depth.gain.setValueAtTime(0, t);
    depth.gain.linearRampToValueAtTime(14, t + Math.min(0.35, seconds));
    vib.connect(depth);
    for (const [mult, level] of [[1, 1], [2, 0.12], [3, 0.04]] as const) {
      const o = ctx.createOscillator(), og = ctx.createGain();
      o.frequency.value = f * mult;
      o.detune.setValueAtTime(-35, t);
      o.detune.linearRampToValueAtTime(0, t + 0.07);
      depth.connect(o.detune);
      og.gain.value = level;
      o.connect(og).connect(g);
      o.start(t);
      o.stop(t + seconds + 0.12);
    }
    vib.start(t);
    vib.stop(t + seconds + 0.12);
    // The breath through the notch.
    const src = ctx.createBufferSource(), band = ctx.createBiquadFilter(), bg = ctx.createGain();
    src.buffer = this.noise;
    band.type = "bandpass";
    band.frequency.value = f * 2;
    band.Q.value = 3;
    bg.gain.setValueAtTime(0.0, t);
    bg.gain.linearRampToValueAtTime(0.5, t + 0.04);
    bg.gain.linearRampToValueAtTime(0.2, t + 0.2);
    bg.gain.linearRampToValueAtTime(0, t + seconds + 0.08);
    src.connect(band).connect(bg).connect(g);
    src.start(t, Math.random(), seconds + 0.12);
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

  /**
   * A stream: the hiss of water over stones, a low rush under it, and bubbles and gurgles now and then. Silent
   * until the student comes near the water.
   */
  private stream(): void {
    const ctx = this.ctx!;
    const bus = (this.water = ctx.createGain());
    bus.gain.value = 0;
    bus.connect(this.master!);
    const layer = (type: BiquadFilterType, freq: number, q: number, level: number, wobble: number, rate: number) => {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      src.playbackRate.value = 0.9 + Math.random() * 0.2;
      const filter = ctx.createBiquadFilter();
      filter.type = type;
      filter.frequency.value = freq;
      filter.Q.value = q;
      const lfo = ctx.createOscillator(), depth = ctx.createGain();
      lfo.frequency.value = rate;
      depth.gain.value = wobble;
      lfo.connect(depth).connect(filter.frequency);
      const g = ctx.createGain();
      g.gain.value = level;
      src.connect(filter).connect(g).connect(bus);
      src.start(0, Math.random() * 2);
      lfo.start();
    };
    layer("bandpass", 1100, 0.7, 0.55, 500, 0.9); // the hiss over the stones
    layer("bandpass", 2600, 1.2, 0.18, 900, 2.3); // the bright splashing
    layer("lowpass", 320, 0.5, 0.7, 80, 0.3); // the low rush of the current
    this.bubbles(bus);
  }

  /** Bubbles in the current: short rising whistles, many and quick, as a brook gurgles. */
  private bubbles(bus: GainNode): void {
    const tick = () => {
      if (this.water !== bus || !this.ctx) return;
      if (this.waterLevel > 0.05 && this.ctx.state === "running") {
        const ctx = this.ctx;
        const n = 1 + Math.floor(Math.random() * 3);
        for (let k = 0; k < n; k++) {
          const t = ctx.currentTime + Math.random() * 0.12;
          const f = 380 + Math.random() * 900;
          const o = ctx.createOscillator(), g = ctx.createGain(), pan = ctx.createStereoPanner();
          pan.pan.value = Math.random() * 1.2 - 0.6;
          o.frequency.setValueAtTime(f, t);
          o.frequency.exponentialRampToValueAtTime(f * (1.6 + Math.random()), t + 0.05);
          g.gain.setValueAtTime(0, t);
          g.gain.linearRampToValueAtTime(0.05 + Math.random() * 0.05, t + 0.008);
          g.gain.exponentialRampToValueAtTime(0.0005, t + 0.06);
          o.connect(g).connect(pan).connect(bus);
          o.start(t);
          o.stop(t + 0.07);
        }
        if (this.wadingWalk && performance.now() - this.lastSplash > 420) {
          this.lastSplash = performance.now();
          this.splash();
        }
      }
      window.setTimeout(tick, 60 + Math.random() * 160);
    };
    tick();
  }

  /** A foot in the water: a splash of noise and a low slosh. */
  private splash(): void {
    const ctx = this.ctx!, t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.setValueAtTime(2200, t);
    band.frequency.exponentialRampToValueAtTime(700, t + 0.2);
    band.Q.value = 0.9;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.5, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    src.connect(band).connect(g).connect(this.effects!);
    src.start(t, Math.random(), 0.3);
  }

  /**
   * How near the running water is: `level` from 0 (none within earshot) to 1 (standing in it); `wading` while
   * the student is in the stream, and `walking` while they move, for the splashes of the feet.
   */
  setWater(level: number, wading: boolean, walking: boolean): void {
    this.waterLevel = level;
    this.wading = wading;
    this.wadingWalk = wading && walking;
    const ctx = this.ctx, bus = this.water;
    if (!ctx || !bus || !this.enabled) return;
    const t = ctx.currentTime;
    bus.gain.cancelScheduledValues(t);
    bus.gain.setValueAtTime(bus.gain.value, t);
    bus.gain.linearRampToValueAtTime(0.32 * level, t + 0.4);
  }

  /** Whether the student is standing in a stream; for tests. */
  get inWater(): boolean {
    return this.wading;
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
