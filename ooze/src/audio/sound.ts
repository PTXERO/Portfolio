// Sound: the underwater hum of the Soup and the Cell (a seamless loop; the Depths have faint music now and then), a water drop for every tap in the Soup
// and the Cell (one of many, never the same twice running), and the rush of the whirlpool,
// as loud as it's strong (silent when there isn't one). The drops and the rush are heard as
// if from under the water: muffled, and ringing on in a long reverb. The Menu has a volume
// for the ambience and one for the effects. Lightning, in any stage, brings thunder: one of
// four, at random (muffled too when it's heard from under the Soup). Buttons pop.
//
// Browsers only let sound start from a tap, so nothing plays (or loads) until the first one.

import type { GameState } from '../economy/types';

export type Channel = 'master' | 'music' | 'ambience' | 'effects';
export const CHANNELS: { id: Channel; label: string }[] = [
  { id: 'master', label: 'All sound' },
  { id: 'music', label: 'Music' },
  { id: 'ambience', label: 'Ambience' },
  { id: 'effects', label: 'Effects' },
];

const KEY = 'ooze-to-orbit/sound';
/** Bumped when a sound file changes, so phones don't keep the old one. */
const SFX_V = 6;
const DEFAULTS: Record<Channel, number> = { master: 0.8, music: 0.6, ambience: 0.6, effects: 0.7 };

/** The loops are padded either side (so the mp3's own gaps fall outside them): where each
 * loop starts in its file, and how long it runs. */
const LOOPS = {
  underwater: { pad: 0.25, len: 116.048 },
  river: { pad: 0.25, len: 41.0 },
  // Music, drowned in a long reverb (baked in, wrapping round so the seam rings over too).
  depths: { pad: 0.25, len: 132.6 },
};
type Loop = keyof typeof LOOPS;
/** The drops, laid end to end in one file: [start, length] seconds. */
const DROPS: [number, number][] = [
  [0.0, 0.0959], [0.1959, 0.2039], [0.4998, 0.1777], [0.7775, 0.3298], [1.2073, 0.1957], [1.503, 0.3252],
  [1.9282, 0.178], [2.2061, 0.2713], [2.5775, 0.2221], [2.8995, 0.284], [3.2835, 0.2123], [3.5958, 0.1353],
  [3.8311, 0.2114], [4.1425, 0.45], [4.6925, 0.2299], [5.0224, 0.3817], [5.5041, 0.204], [5.8081, 0.2213],
  [6.1293, 0.1509], [6.3802, 0.3136], [6.7938, 0.167],
];

export const volumes: Record<Channel, number> = (() => {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    // (Taps and the whirlpool had a slider each before they were one.)
    if (saved.effects === undefined && saved.clicks !== undefined) saved.effects = saved.clicks;
    return { master: saved.master ?? DEFAULTS.master, music: saved.music ?? DEFAULTS.music, ambience: saved.ambience ?? DEFAULTS.ambience, effects: saved.effects ?? DEFAULTS.effects };
  } catch {
    return { ...DEFAULTS };
  }
})();

let ctx: AudioContext | null = null;
let master: GainNode;
const bus = {} as Record<Exclude<Channel, 'master'>, GainNode>;
type Sound = Loop | 'drops' | 'pop' | 'thunder0' | 'thunder1' | 'thunder2' | 'thunder3' | Cue;
/** One-off sounds for moments: an organelle found, a rare microbe gulped down (three glugs),
 * one turning up, a new habitat opening, and the boom from the Soup into the Cell. */
export type Cue = 'shine' | 'glug0' | 'glug1' | 'glug2' | 'chime' | 'ascend' | 'boom';
const CUES: Cue[] = ['shine', 'glug0', 'glug1', 'glug2', 'chime', 'ascend', 'boom'];
const buffers: Partial<Record<Sound, AudioBuffer>> = {};
/** The thunders, evened out (they were recorded at very different loudness). */
const THUNDER_GAIN = [1, 1, 1.3, 1];
/** Effects heard in the open air (thunder above the water): no muffling, a little room. */
let sky: GainNode;
/** Thunder heard from under the Soup: only lightly muffled (the drops' muffling takes all of it). */
let shallow: BiquadFilterNode;
let lastThunder = -1;
let thunderAt = -99;
/** The two loops, once running: their own gain (fading in and out) on top of the channel's. */
const loops: Partial<Record<Loop, GainNode>> = {};
let lastDrop = -1;

export function setVolume(ch: Channel, v: number): void {
  volumes[ch] = Math.max(0, Math.min(1, v));
  try {
    localStorage.setItem(KEY, JSON.stringify(volumes));
  } catch {
    /* private mode: it's just not remembered */
  }
  applyVolumes();
}

function applyVolumes(): void {
  if (!ctx) return;
  const now = ctx.currentTime;
  master.gain.setTargetAtTime(volumes.master, now, 0.05);
  for (const k of Object.keys(bus) as (keyof typeof bus)[]) bus[k].gain.setTargetAtTime(volumes[k], now, 0.05);
  sky.gain.setTargetAtTime(volumes.effects, now, 0.05);
}

/** Called from the first taps: makes the sound (browsers only allow it from a tap). */
export function unlockSound(): void {
  if (ctx) {
    if (ctx.state === 'suspended' && !document.hidden) void ctx.resume();
    return;
  }
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!AC) return;
  // On iPhone, Web Audio follows the silent switch unless the page says it's playing sound.
  const session = (navigator as unknown as { audioSession?: { type: string } }).audioSession;
  if (session) session.type = 'playback';
  ctx = new AC();
  void ctx.resume();
  master = ctx.createGain();
  // A limiter last, so loud thunder over everything else doesn't crackle.
  const limit = ctx.createDynamicsCompressor();
  limit.threshold.value = -6;
  limit.knee.value = 4;
  limit.ratio.value = 12;
  limit.attack.value = 0.003;
  limit.release.value = 0.25;
  master.connect(limit).connect(ctx.destination);
  bus.ambience = ctx.createGain();
  bus.ambience.connect(master);
  bus.music = ctx.createGain();
  bus.music.connect(master);
  bus.effects = ctx.createGain();
  underwater(ctx, bus.effects, master);
  sky = ctx.createGain();
  sky.connect(master);
  shallow = ctx.createBiquadFilter();
  shallow.type = 'lowpass';
  shallow.frequency.value = 2200;
  shallow.connect(sky);
  applyVolumes();
  for (const name of ['pop', 'drops', ...CUES, 'thunder0', 'thunder1', 'thunder2', 'thunder3', 'underwater', 'depths', 'river'] as const) {
    fetch(`${import.meta.env.BASE_URL}sfx/${name}.mp3?v=${SFX_V}`)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
      .then((a) => new Promise<AudioBuffer>((ok, no) => ctx!.decodeAudioData(a, ok, no)))
      .then((b) => (buffers[name] = b))
      .catch(() => {
        /* no sound for this one */
      });
  }
}

/** Under the water: the high end gone, and a long murky reverb behind what's left. */
function underwater(ac: AudioContext, input: AudioNode, out: AudioNode): void {
  const muffle = ac.createBiquadFilter();
  muffle.type = 'lowpass';
  muffle.frequency.value = 900;
  muffle.Q.value = 0.9;
  input.connect(muffle);
  const dry = ac.createGain();
  dry.gain.value = 0.55;
  muffle.connect(dry).connect(out);
  const verb = ac.createConvolver();
  verb.buffer = murk(ac, 2.6);
  const wet = ac.createGain();
  wet.gain.value = 0.9;
  muffle.connect(verb).connect(wet).connect(out);
}

/** A reverb's echo: noise dying away, darker as it goes (smoothed a little more each moment),
 * different in each ear. */
function murk(ac: AudioContext, sec: number): AudioBuffer {
  const n = Math.floor(ac.sampleRate * sec);
  const buf = ac.createBuffer(2, n, ac.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const k = i / n;
      const smooth = 0.25 + 0.7 * k;
      lp += (Math.random() * 2 - 1 - lp) * (1 - smooth);
      // A short swell in before it dies, so it blooms rather than clicks.
      const swell = Math.min(1, i / (ac.sampleRate * 0.03));
      d[i] = lp * swell * Math.pow(1 - k, 2.4);
    }
  }
  return buf;
}

/** A water drop: a different one each time, a little higher or lower. */
export function tapSound(): void {
  const buf = buffers.drops;
  if (!ctx || !buf || ctx.state !== 'running') return;
  let i = Math.floor(Math.random() * DROPS.length);
  if (i === lastDrop) i = (i + 1 + Math.floor(Math.random() * (DROPS.length - 1))) % DROPS.length;
  lastDrop = i;
  const [at, len] = DROPS[i];
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = 0.85 + Math.random() * 0.35;
  const g = ctx.createGain();
  g.gain.value = 0.55 + Math.random() * 0.45;
  src.connect(g).connect(bus.effects);
  src.start(0, at, len);
}

/** A moment's sound, at a loudness (under the Effects volume). */
export function cue(name: Cue, level = 1): void {
  const buf = buffers[name];
  if (!ctx || !buf || ctx.state !== 'running') return;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const g = ctx.createGain();
  g.gain.value = level;
  src.connect(g).connect(sky);
  src.start();
}

/** A rare microbe gulped down: one of the three glugs, a touch higher or lower. */
let lastGlug = -1;
export function glug(): void {
  let i = Math.floor(Math.random() * 3);
  if (i === lastGlug) i = (i + 1) % 3;
  lastGlug = i;
  cue(`glug${i}` as Cue, 0.9);
}

/** A button pressed: a pop, a touch higher or lower each time. */
export function popSound(): void {
  const buf = buffers.pop;
  if (!ctx || !buf || ctx.state !== 'running') return;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = 0.94 + Math.random() * 0.12;
  const g = ctx.createGain();
  g.gain.value = 0.6;
  src.connect(g).connect(sky);
  src.start();
}

/** Thunder: one of the four (not the last one heard), at a loudness (1 a strike overhead, less
 * far off), after a delay (light comes before sound). Under the Soup it's heard through the
 * water. Small far-off ones don't pile up on top of a thunder still rolling. */
export function thunder(opts: { level?: number; under?: boolean; delay?: number } = {}): void {
  if (!ctx || ctx.state !== 'running') return;
  const level = opts.level ?? 1;
  const now = ctx.currentTime;
  if (level < 0.6 && now - thunderAt < 8) return; // (the Soup's small bolts)
  let i = Math.floor(Math.random() * 4);
  if (i === lastThunder) i = (i + 1 + Math.floor(Math.random() * 3)) % 4;
  const buf = buffers[`thunder${i}` as Sound];
  if (!buf) return;
  lastThunder = i;
  thunderAt = now;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = 0.9 + Math.random() * 0.15;
  const g = ctx.createGain();
  g.gain.value = 1.4 * level * THUNDER_GAIN[i];
  src.connect(g).connect(opts.under ? shallow : sky);
  src.start(now + (opts.delay ?? 0));
}

/** Fades a loop toward a level (starting it the first time it's wanted). */
function loopTo(name: Loop, level: number, out: GainNode, fade: number): void {
  if (!ctx) return;
  let g = loops[name];
  if (!g) {
    const buf = buffers[name];
    if (!buf || level <= 0) return;
    g = ctx.createGain();
    g.gain.value = 0;
    g.connect(out);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.loopStart = LOOPS[name].pad;
    src.loopEnd = LOOPS[name].pad + LOOPS[name].len;
    src.connect(g);
    // Somewhere in the loop, so it doesn't always open the same way.
    src.start(0, LOOPS[name].pad + Math.random() * LOOPS[name].len);
    loops[name] = g;
  }
  g.gain.setTargetAtTime(level, ctx.currentTime, fade);
}

/** Each frame: the hum in the Soup, the rush while a whirlpool turns. */
// ---- Music: now and then, not always ----
// Like Minecraft's: a while after you arrive somewhere with music, it fades in slowly, plays
// its piece through, and fades away; then there's quiet, for minutes, before it may come again.
// Each place has its piece (only the Cell's Depths, so far).

/** The music of where the game is now, or null. */
function musicFor(state: GameState): { track: Loop; level: number } | null {
  if (state.current === 'cell' && state.stages.cell.habitat === 'depths') return { track: 'depths', level: 0.08 };
  return null;
}
/** Seconds: before the first piece in a place, fading in, fading out, and the quiet between. */
const MUSIC_FIRST: [number, number] = [20, 70];
const MUSIC_IN = 12;
const MUSIC_OUT = 14;
const MUSIC_REST: [number, number] = [150, 420];
const between = ([a, b]: [number, number]) => a + Math.random() * (b - a);
let music: { track: Loop; src: AudioBufferSourceNode; gain: GainNode; ends: number } | null = null;
let musicNext = -1;
let musicWhere: Loop | null = null;

function fadeMusicOut(sec: number): void {
  if (!ctx || !music) return;
  const now = ctx.currentTime;
  music.gain.gain.cancelScheduledValues(now);
  music.gain.gain.setValueAtTime(music.gain.gain.value, now);
  music.gain.gain.linearRampToValueAtTime(0, now + sec);
  music.src.stop(now + sec + 0.1);
  music = null;
}

function musicFrame(state: GameState): void {
  if (!ctx) return;
  const now = ctx.currentTime;
  const want = musicFor(state);
  // Somewhere new (or somewhere without music): what's playing fades away, and a new place
  // waits a little before its first piece.
  if ((want?.track ?? null) !== musicWhere) {
    if (music) fadeMusicOut(3);
    musicWhere = want?.track ?? null;
    if (want) musicNext = Math.max(musicNext, now + between(MUSIC_FIRST));
  }
  if (!want) return;
  if (music && now >= music.ends) {
    fadeMusicOut(MUSIC_OUT);
    musicNext = now + MUSIC_OUT + between(MUSIC_REST);
  }
  const buf = buffers[want.track];
  if (!music && buf && now >= musicNext) {
    // From the top of the piece, rising out of nothing.
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(want.level, now + MUSIC_IN);
    gain.connect(bus.music);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(gain);
    src.start(now, LOOPS[want.track].pad);
    music = { track: want.track, src, gain, ends: now + LOOPS[want.track].len - MUSIC_OUT };
  }
}

export function soundFrame(state: GameState): void {
  if (!ctx) return;
  const soup = state.current === 'soup';
  // The hum under all the water; music now and then.
  loopTo('underwater', soup || state.current === 'cell' ? 1 : 0, bus.ambience, 0.8);
  musicFrame(state);
  const swirl = soup && state.swirl > 0.02 ? Math.min(1, state.swirl) : 0;
  loopTo('river', swirl * 0.8, bus.effects, swirl > 0 ? 0.15 : 0.3);
}

/** Quiet while the game's hidden (phone locked, another tab). */
export function soundHidden(hidden: boolean): void {
  if (!ctx) return;
  if (hidden) void ctx.suspend();
  else void ctx.resume();
}
