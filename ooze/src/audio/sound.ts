// Sound: the Soup's underwater hum (a seamless loop), a water drop for every tap in the Soup
// and the Cell (one of many, never the same twice running), and the rush of the whirlpool,
// as loud as it's strong (silent when there isn't one). The drops and the rush are heard as
// if from under the water: muffled, and ringing on in a long reverb. The Menu has a volume
// for the ambience and one for the effects.
//
// Browsers only let sound start from a tap, so nothing plays (or loads) until the first one.

import type { GameState } from '../economy/types';

export type Channel = 'master' | 'ambience' | 'effects';
export const CHANNELS: { id: Channel; label: string }[] = [
  { id: 'master', label: 'All sound' },
  { id: 'ambience', label: 'Ambience' },
  { id: 'effects', label: 'Effects' },
];

const KEY = 'ooze-to-orbit/sound';
const DEFAULTS: Record<Channel, number> = { master: 0.8, ambience: 0.6, effects: 0.7 };

/** The loops are padded either side (so the mp3's own gaps fall outside them): where each
 * loop starts in its file, and how long it runs. */
const LOOPS = {
  underwater: { pad: 0.25, len: 116.048 },
  river: { pad: 0.25, len: 41.0 },
};
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
    return { master: saved.master ?? DEFAULTS.master, ambience: saved.ambience ?? DEFAULTS.ambience, effects: saved.effects ?? DEFAULTS.effects };
  } catch {
    return { ...DEFAULTS };
  }
})();

let ctx: AudioContext | null = null;
let master: GainNode;
const bus = {} as Record<Exclude<Channel, 'master'>, GainNode>;
const buffers: Partial<Record<'underwater' | 'river' | 'drops', AudioBuffer>> = {};
/** The two loops, once running: their own gain (fading in and out) on top of the channel's. */
const loops: Partial<Record<'underwater' | 'river', GainNode>> = {};
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
  master.connect(ctx.destination);
  bus.ambience = ctx.createGain();
  bus.ambience.connect(master);
  bus.effects = ctx.createGain();
  underwater(ctx, bus.effects, master);
  applyVolumes();
  for (const name of ['drops', 'underwater', 'river'] as const) {
    fetch(`${import.meta.env.BASE_URL}sfx/${name}.mp3`)
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

/** Fades a loop toward a level (starting it the first time it's wanted). */
function loopTo(name: 'underwater' | 'river', level: number, out: GainNode, fade: number): void {
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
export function soundFrame(state: GameState): void {
  if (!ctx) return;
  const soup = state.current === 'soup';
  loopTo('underwater', soup ? 1 : 0, bus.ambience, 0.6);
  const swirl = soup && state.swirl > 0.02 ? Math.min(1, state.swirl) : 0;
  loopTo('river', swirl * 0.8, bus.effects, swirl > 0 ? 0.15 : 0.3);
}

/** Quiet while the game's hidden (phone locked, another tab). */
export function soundHidden(hidden: boolean): void {
  if (!ctx) return;
  if (hidden) void ctx.suspend();
  else void ctx.resume();
}
