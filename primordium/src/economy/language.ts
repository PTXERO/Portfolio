// Their own tongue, made by them. Nothing here is a word of theirs: only the things there are to
// talk about (the fire, food, a child, the rain, the light in the sky, eating, singing, big, cold,
// yes, no...). The words are theirs: made up by whoever first needs one (from the sounds their
// kind makes), passed on in talk, and fought over: every time a word's used it gains, its rivals
// lose, so a few words for a thing become one, the young now and then say it differently and the
// old keep the old ways. The order words go in is the same: each speaker's habit at first, then
// whatever the most say. Things that are new are named out of words they have ("fire-hard" for
// bronze). What they say comes from what's going on round them, and who's saying it.
// Cheap: a sentence is a handful of lookups; a dozen talks a day go on unheard, so it grows while
// no one's listening; the sounds shift once a year.

export type Role = 'thing' | 'act' | 'quality' | 'who' | 'mark';

/** What there is to talk about: a meaning, what kind of word it wants, and (for something new)
 * what it's named out of. The label is only for the gloss: they never see it. */
export const MEANINGS: Record<string, { role: Role; of?: [string, string] }> = {
  fire: { role: 'thing' }, food: { role: 'thing' }, fish: { role: 'thing' }, root: { role: 'thing' }, water: { role: 'thing' },
  sun: { role: 'thing' }, night: { role: 'thing' }, rain: { role: 'thing' }, star: { role: 'thing' }, light: { role: 'thing' },
  child: { role: 'thing' }, elder: { role: 'thing' }, village: { role: 'thing' }, hut: { role: 'thing' }, fog: { role: 'thing' },
  song: { role: 'thing' }, stone: { role: 'thing' }, wood: { role: 'thing' },
  bronze: { role: 'thing', of: ['fire', 'hard'] }, boat: { role: 'thing', of: ['water', 'hut'] }, iron: { role: 'thing', of: ['stone', 'fire'] },
  mark: { role: 'thing', of: ['stone', 'song'] }, harbour: { role: 'thing', of: ['boat', 'hut'] },
  eat: { role: 'act' }, sing: { role: 'act' }, sleep: { role: 'act' }, see: { role: 'act' }, go: { role: 'act' }, come: { role: 'act' },
  feed: { role: 'act' }, know: { role: 'act' }, dance: { role: 'act' }, cross: { role: 'act' }, burn: { role: 'act' },
  big: { role: 'quality' }, small: { role: 'quality' }, warm: { role: 'quality' }, cold: { role: 'quality' }, good: { role: 'quality' },
  bad: { role: 'quality' }, far: { role: 'quality' }, many: { role: 'quality' }, hard: { role: 'quality' }, old: { role: 'quality' }, new: { role: 'quality' },
  i: { role: 'who' }, you: { role: 'who' }, we: { role: 'who' }, they: { role: 'who' },
  yes: { role: 'mark' }, no: { role: 'mark' }, what: { role: 'mark' },
};

/** A word for something, how strong its hold is, and the day it was made. */
export interface Variant {
  f: string;
  s: number;
  born: number;
}

export interface Language {
  seed: number;
  cons: string;
  vows: string;
  /** Meaning → the words they have for it, the strongest first (more than one while they fight). */
  lex: Record<string, Variant[]>;
  /** The order of who, what and does: how often each has been used lately. */
  orders: Record<string, number>;
  /** Describing words after the thing (above 0) or before; no and asking at the front (above 0)
   * or the end. Pulled each way by use. */
  qAfter: number;
  negFront: number;
  askFront: number;
  heard: Record<string, number>;
  ctx: Record<string, string[]>;
  guess: Record<string, string>;
  from: Record<string, string>;
  shifts: string[];
  shiftYear: number;
  scribed?: boolean;
  /** Talks had (heard or not), and the day the unheard ones were last had. */
  talks: number;
  day: number;
  /** How often a talk no one heard wanted a word they didn't have yet (made unheard only once
   * they've gone wanting a good while: mostly, words are made where you can see it). */
  need?: Record<string, number>;
  /** Each word that's been the word for something, and the day it was (oldest first). */
  past?: Record<string, { f: string; day: number }[]>;
  /** Who made the word, where, and when (made in front of you). */
  named?: Record<string, { by: string; where: string; day: number }>;
  /** The first thing you heard them say (and when), to set beside how they'd say it now. */
  first?: { fr: Frame; text: string; day: number };
  /** Places they've named (out of words they have), and what they're named out of. */
  places?: Record<string, { f: string; of: [string, string]; day: number }>;
}

export interface Speaker {
  age: 'little' | 'youngster' | 'grown' | 'elder';
  temper: string;
}

function rng(seed: number): () => number {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SOUNDS: Record<string, { cons: string[]; vows: string[] }> = {
  grazer: { cons: ['m', 'l', 'n', 'w', 'h', 'v', 'b', 'r', 's', 'y', 'f', 'p'], vows: ['a', 'o', 'u', 'e', 'i', 'oo', 'au'] },
  hunter: { cons: ['k', 'g', 'r', 't', 'z', 'd', 'kh', 'sh', 'x', 'q', 'v', 'n'], vows: ['a', 'u', 'i', 'o', 'e', 'aa'] },
  omnivore: { cons: ['t', 'm', 'k', 'l', 's', 'n', 'r', 'p', 'b', 'd', 'h', 'y'], vows: ['a', 'e', 'i', 'o', 'u', 'ei'] },
};
const ORDERS = ['AVT', 'ATV', 'VAT', 'VTA', 'TAV', 'TVA'];

/** A tongue not yet spoken: only its sounds (no words at all yet, and no order). */
export function newLanguage(seed: number, diet: string): Language {
  const r = rng(seed * 7 + 13);
  const set = SOUNDS[diet] ?? SOUNDS.omnivore;
  const pick = <T>(xs: T[], n: number) => [...xs].sort(() => r() - 0.5).slice(0, n);
  return {
    seed,
    cons: pick(set.cons, 7 + Math.floor(r() * 3)).join(','),
    vows: pick(set.vows, 4 + Math.floor(r() * 2)).join(','),
    lex: {},
    orders: Object.fromEntries(ORDERS.map((o) => [o, 0])),
    qAfter: 0,
    negFront: 0,
    askFront: 0,
    heard: {},
    ctx: {},
    guess: {},
    from: {},
    shifts: [],
    shiftYear: 0,
    talks: 0,
    day: 0,
  };
}

function syllable(lang: Language, r: () => number): string {
  const C = lang.cons.split(',');
  const V = lang.vows.split(',');
  const end = r() < 0.3 ? C[Math.floor(r() * C.length)] : '';
  return C[Math.floor(r() * C.length)] + V[Math.floor(r() * V.length)] + (end.length === 1 ? end : '');
}

/** The word most of them use for something now (none yet: undefined). */
export function wordOf(lang: Language, m: string): string | undefined {
  return lang.lex[m]?.[0]?.f;
}

/** Someone needs a word for something: the one they'd use (the strongest, mostly; an elder holds
 * to the oldest; a little one now and then says it their own way); none yet, one's made up (or,
 * for something new, put together out of words they have). */
function choose(lang: Language, m: string, who: Speaker, r: () => number, day: number, made?: string[]): string {
  let vs = lang.lex[m];
  if (!vs?.length) {
    const def = MEANINGS[m];
    let f: string;
    if (def?.of && def.of.every((x) => wordOf(lang, x))) {
      // Something new, named out of two words they have (the first sounds of each).
      const [a, b] = def.of.map((x) => syllables(wordOf(lang, x)!)[0]);
      f = a + b;
    } else {
      const small = def?.role === 'mark' || def?.role === 'who';
      // (Made up, and not a word they already use for something else.)
      const taken = new Set(Object.values(lang.lex).flatMap((v) => v.map((x) => x.f)));
      f = '';
      for (let tries = 0; tries < 8 && (!f || taken.has(f)); tries++) {
        const n = small ? 1 + (tries > 3 ? 1 : 0) : 1 + Math.floor(r() * 2);
        f = '';
        for (let i = 0; i < n; i++) f += syllable(lang, r);
      }
    }
    vs = lang.lex[m] = [{ f, s: 1, born: day }];
    remember(lang, m, f, day);
    made?.push(m);
    return f;
  }
  if (who.age === 'little' && r() < 0.05) {
    // A little one's way of saying it: a sound changed.
    const sy = syllables(vs[0].f);
    sy[Math.floor(r() * sy.length)] = syllable(lang, r);
    const f = sy.join('');
    if (!vs.some((v) => v.f === f)) vs.push({ f, s: 0.3, born: day });
    return f;
  }
  if (who.age === 'elder' && vs.length > 1) return [...vs].sort((a, b) => a.born - b.born)[0].f;
  // Mostly the strongest; now and then a weaker one, in proportion to its hold.
  const tot = vs.reduce((a, v) => a + v.s * v.s, 0);
  let x = r() * tot;
  for (const v of vs) if ((x -= v.s * v.s) <= 0) return v.f;
  return vs[0].f;
}

/** The word for something as a grown one of them would say it (for a song). */
export function wordFor(lang: Language, m: string, day: number): string {
  return choose(lang, m, { age: 'grown', temper: '' }, rng(lang.seed + lang.talks), day);
}

/** Heard, and taken up: the word used gains, its rivals lose (the losers are forgotten). */
function useWord(lang: Language, m: string, f: string, day: number): void {
  const vs = lang.lex[m];
  if (!vs) return;
  // (A word's hold has a ceiling: the young can always talk the old ways out, in time.)
  for (const v of vs) v.s = v.f === f ? Math.min(WORD_HOLD, v.s + 1) : Math.max(0, v.s - 0.35);
  lang.lex[m] = vs.filter((v) => v.s > 0.05 || v.f === f).sort((a, b) => b.s - a.s).slice(0, 5);
  // (A new word for it, once it's taken hold: the old one's history now.)
  if (lang.lex[m][0].s >= 3) remember(lang, m, lang.lex[m][0].f, day);
}

/** The word for something now, put down in its history if it's new there. */
function remember(lang: Language, m: string, f: string, day: number): void {
  const h = ((lang.past ??= {})[m] ??= []);
  if (h.at(-1)?.f === f) return;
  // (Back to an old word: only the latest comes again; a long history keeps its first and last.)
  h.push({ f, day });
  if (h.length > 6) h.splice(1, 1);
}

const WORD_HOLD = 25;

/** The order someone puts who, what and does in: their own habit at first, the most used as the
 * tongue settles (the more it's been used, the more surely). */
function chooseOrder(lang: Language, r: () => number): string {
  const sharp = 0.4 + Math.min(4, lang.talks / 150);
  const w = ORDERS.map((o) => Math.exp((lang.orders[o] ?? 0) * sharp * 10));
  let x = r() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < ORDERS.length; i++) if ((x -= w[i]) <= 0) return ORDERS[i];
  return ORDERS[0];
}
const lean = (v: number, r: () => number, talks: number) => r() < 1 / (1 + Math.exp(-v * 10 * (0.4 + Math.min(4, talks / 150))));

/** What someone means: who, does what, to what, of what kind; no; asking; yes. */
export interface Frame {
  who?: string;
  act?: string;
  thing?: string;
  quality?: string;
  no?: boolean;
  ask?: boolean;
  yes?: boolean;
  /** Said to someone (their name first). */
  to?: string;
}

export interface Said {
  word: string;
  meaning?: string;
}

/** Something said: in their words and their order (as it stands), and taken up by the rest. */
export function say(lang: Language, fr: Frame, who: Speaker, day: number, seed: number): { text: string; said: Said[]; made: string[] } {
  const r = rng(seed);
  const made: string[] = [];
  const w = (m: string): Said => ({ word: choose(lang, m, who, r, day, made), meaning: m });
  const order = chooseOrder(lang, r);
  const qa = lean(lang.qAfter, r, lang.talks);
  const nf = lean(lang.negFront, r, lang.talks);
  const af = lean(lang.askFront, r, lang.talks);
  const { out, text, parts } = arrange(fr, w, order, qa, nf, af);
  // Taken up: the words used gain, and so does the way they were put.
  for (const s of out) if (s.meaning) useWord(lang, s.meaning, s.word, day);
  if (parts > 1) for (const o of ORDERS) lang.orders[o] = (lang.orders[o] ?? 0) * 0.99 + (o === order ? 0.01 : 0);
  if (fr.quality) lang.qAfter = lang.qAfter * 0.99 + (qa ? 0.01 : -0.01);
  if (fr.no) lang.negFront = lang.negFront * 0.99 + (nf ? 0.01 : -0.01);
  if (fr.ask) lang.askFront = lang.askFront * 0.99 + (af ? 0.01 : -0.01);
  lang.talks++;
  return { text, said: out, made };
}

/** How they'd say it now, the way most of them would (nothing's taken up by it; a word they
 * don't have yet shows as a dash). */
export function sayNow(lang: Language, fr: Frame): string {
  const g = grammarOf(lang);
  return arrange(fr, (m) => ({ word: wordOf(lang, m) ?? '–', meaning: m }), g.order, g.qAfter, g.negFront, g.askFront).text;
}

/** A thing meant, put in words in an order. */
function arrange(fr: Frame, w: (m: string) => Said, order: string, qa: boolean, nf: boolean, af: boolean): { out: Said[]; text: string; parts: number } {
  const slots: Record<string, Said[]> = { A: [], V: [], T: [] };
  if (fr.who) slots.A.push(w(fr.who));
  if (fr.act) slots.V.push(w(fr.act));
  if (fr.thing) slots.T.push(w(fr.thing));
  // A describing word goes with the thing (or, with none, with whoever it is).
  if (fr.quality) {
    const q = w(fr.quality);
    const home = fr.thing ? slots.T : fr.who ? slots.A : slots.T;
    if (qa) home.push(q);
    else home.unshift(q);
  }
  if (fr.no) {
    const n = w('no');
    const at = slots.V.length ? slots.V : slots.T.length ? slots.T : slots.A;
    if (nf) at.unshift(n);
    else at.push(n);
  }
  let out: Said[] = [];
  for (const k of order) out.push(...slots[k]);
  if (fr.yes) out.unshift(w('yes'));
  if (fr.ask) {
    const q = w('what');
    if (af) out.unshift(q);
    else out.push(q);
  }
  if (fr.to) out = [{ word: fr.to }, ...out];
  let text = out.map((x) => x.word).join(' ');
  if (fr.to) text = text.replace(fr.to + ' ', fr.to + ', ');
  text = text.charAt(0).toUpperCase() + text.slice(1) + (fr.ask ? '?' : '.');
  return { out, text, parts: slots.A.length + slots.V.length + slots.T.length };
}

/** What's going on round them, for what they'll talk about. */
export interface Situation {
  heat: number;
  season: number;
  night: boolean;
  rain: boolean;
  plenty: boolean;
  /** A little one about (their name). */
  little?: string;
  /** The culture's Age, villages won, a light just crossed the sky, they've crossed the sea. */
  age: number;
  won: number;
  streak: boolean;
  crossed: boolean;
  /** What the speaker can see round them (meanings: water, wood, stone, hut, fire, fog, village,
   * child...). */
  near?: string[];
  /** What's happened lately (born, rain, bolt, won, visitor). */
  recent?: string[];
}

export type Turn = Frame & { by: 0 | 1 };

/** A talk between two of them, about whatever's going on, the way they are: a little one asks, a
 * grumpy one says no, an elder remembers the crossing. A few turns. */
export function talk(sit: Situation, a: Speaker & { name: string }, b: Speaker & { name: string }, r: () => number): Turn[] {
  const kid = (s: Speaker) => s.age === 'little' || s.age === 'youngster';
  const nay = (s: Speaker) => s.temper === 'grumpy' || s.temper === 'stubborn';
  const glad = (s: Speaker) => s.temper === 'cheerful' || s.temper === 'gentle' || s.temper === 'dreamy';
  const reply = (fr: Frame): Frame => (nay(b) ? { ...fr, no: true } : glad(b) ? { ...fr, yes: true } : kid(b) ? { ...fr, ask: true } : fr);
  const opts: { w: number; turns: Turn[] }[] = [];
  const fireQ = sit.heat > 0.6 ? 'big' : sit.heat < 0.15 ? 'small' : 'warm';
  opts.push({ w: 3, turns: [{ by: 0, thing: 'fire', quality: fireQ }, { by: 1, ...reply({ thing: 'fire', quality: fireQ }) }] });
  if (sit.heat < 0.3) opts.push({ w: 3, turns: [{ by: 0, who: kid(a) ? 'i' : 'we', act: 'feed', thing: 'fire', ask: kid(a) }, { by: 1, ...reply({ who: 'you', act: 'feed', thing: 'fire' }) }] });
  if (kid(a)) opts.push({ w: 3, turns: [{ by: 0, thing: 'fire', ask: true }, { by: 1, thing: 'fire', quality: 'warm' }, { by: 0, who: 'i', act: 'feed', thing: 'fire', ask: true }, { by: 1, no: true, who: 'you', quality: 'small' }] });
  opts.push({ w: sit.plenty ? 3 : 1, turns: [{ by: 0, who: 'we', act: 'eat', thing: r() < 0.5 ? 'fish' : 'root', quality: sit.plenty ? 'many' : undefined }, { by: 1, ...reply({ who: 'i', act: 'eat' }) }] });
  if (a.temper === 'greedy') opts.push({ w: 3, turns: [{ by: 0, thing: 'food', ask: true }, { by: 1, who: 'you', act: 'eat', quality: 'many' }] });
  if (sit.season === 3) opts.push({ w: 3, turns: [{ by: 0, quality: 'cold' }, { by: 1, who: 'we', act: 'come', thing: 'fire' }] });
  if (sit.season === 1) opts.push({ w: 2, turns: [{ by: 0, thing: 'sun', quality: 'warm' }, { by: 1, ...reply({ thing: 'sun', quality: 'good' }) }] });
  if (sit.rain) opts.push({ w: 4, turns: [{ by: 0, thing: 'rain' }, { by: 1, ...reply({ thing: 'rain', quality: 'good' }) }, { by: 0, thing: 'child', quality: 'many' }] });
  if (sit.night) opts.push({ w: 2, turns: [{ by: 0, who: 'i', act: 'sleep' }, { by: 1, ...reply({ who: 'you', act: 'sleep' }) }] });
  if (sit.little) opts.push({ w: 2, turns: [{ by: 0, to: b.name || undefined, thing: 'child', quality: 'small' }, { by: 1, ...reply({ thing: 'child', quality: 'good' }) }] });
  if (sit.streak) opts.push({ w: 6, turns: [{ by: 0, who: 'i', act: 'see', thing: 'light' }, { by: 1, thing: 'light', ask: true }, { by: 0, thing: 'light', act: 'go', quality: 'far' }] });
  if (sit.won) opts.push({ w: 2, turns: [{ by: 0, who: 'they', act: 'come', thing: 'village' }, { by: 1, ...reply({ who: 'they', quality: 'good' }) }] });
  if (a.age === 'elder') opts.push({ w: 3, turns: [{ by: 0, who: 'we', act: 'cross', thing: 'water', quality: 'big' }, { by: 1, ...(kid(b) ? { thing: 'water', ask: true } : { yes: true, thing: 'water', quality: 'far' }) }] });
  if (sit.crossed && a.age === 'elder') opts.push({ w: 2, turns: [{ by: 0, thing: 'village', quality: 'old' }, { by: 1, thing: 'village', quality: 'far', ask: true }] });
  if (a.temper === 'cheerful' || a.temper === 'dreamy') opts.push({ w: 3, turns: [{ by: 0, who: 'we', act: 'sing' }, { by: 1, ...reply({ who: 'we', act: 'sing', thing: 'song' }) }] });
  if (a.temper === 'curious') opts.push({ w: 3, turns: [{ by: 0, thing: 'fog', ask: true }, { by: 1, who: 'i', act: 'know', no: true }] });
  if (sit.age >= 3) opts.push({ w: 2, turns: [{ by: 0, thing: 'bronze', quality: 'hard' }, { by: 1, ...reply({ thing: 'bronze', quality: 'good' }) }] });
  if (sit.age >= 3) opts.push({ w: 1, turns: [{ by: 0, thing: 'boat', act: 'come' }, { by: 1, thing: 'harbour', quality: 'big' }] });
  if (sit.age >= 4) opts.push({ w: 2, turns: [{ by: 0, thing: 'iron', quality: 'hard' }, { by: 1, ...reply({ thing: 'mark', quality: 'new' }) }] });
  // What's in front of them: named, remarked on, asked about (the strongest pull of all: words
  // for what they meet are the words they need most).
  const LOOK: Record<string, string> = { water: 'big', wood: 'many', stone: 'hard', hut: 'warm', fire: 'warm', village: 'far', child: 'small', fish: 'many', fog: 'far' };
  for (const n of sit.near ?? []) {
    const q = n === 'fire' ? fireQ : LOOK[n];
    opts.push({ w: 4, turns: [{ by: 0, who: 'i', act: 'see', thing: n }, { by: 1, ...(kid(b) ? { thing: n, ask: true } : reply({ thing: n, quality: q })) }] });
    if (n === 'fog') opts.push({ w: 3, turns: [{ by: 0, thing: 'fog', ask: true }, { by: 1, thing: 'fog', quality: 'far' }, { by: 0, who: 'we', act: 'go', thing: 'fog', ask: true }, { by: 1, ...reply({ who: 'we', act: 'go', no: true }) }] });
    if (n === 'water') opts.push({ w: 3, turns: [{ by: 0, who: 'we', act: 'eat', thing: 'fish' }, { by: 1, ...reply({ thing: 'fish', quality: 'many' }) }] });
    if (n === 'village') opts.push({ w: 2, turns: [{ by: 0, who: 'they', act: 'see', thing: 'we', ask: true }, { by: 1, ...reply({ who: 'they', quality: 'far' }) }] });
  }
  // What's just happened.
  for (const e of sit.recent ?? []) {
    if (e === 'born') opts.push({ w: 6, turns: [{ by: 0, thing: 'child', quality: 'new' }, { by: 1, ...reply({ thing: 'child', quality: 'small' }) }, { by: 0, who: 'we', quality: 'many' }] });
    if (e === 'bolt') opts.push({ w: 7, turns: [{ by: 0, thing: 'light', quality: 'big' }, { by: 1, thing: 'fire', act: 'burn', ask: true }, { by: 0, thing: 'fire', quality: 'big' }] });
    if (e === 'won') opts.push({ w: 6, turns: [{ by: 0, thing: 'village', quality: 'good' }, { by: 1, ...reply({ who: 'they', act: 'come' }) }] });
    if (e === 'visitor') opts.push({ w: 7, turns: [{ by: 0, who: 'they', act: 'come', thing: 'village' }, { by: 1, thing: 'village', quality: 'far', ask: true }, { by: 0, who: 'i', act: 'see', thing: 'they' }] });
  }
  const tot = opts.reduce((x, o) => x + o.w, 0);
  let x = r() * tot;
  for (const o of opts) if ((x -= o.w) <= 0) return o.turns;
  return opts[0].turns;
}

/** Talks no one hears: the tongue goes on growing while no one's listening (a dozen a day, a few
 * days' worth at most when they've been left a long while). */
export function talkUnheard(lang: Language, day: number, sit: Situation, speakers: Speaker[]): void {
  if (day <= lang.day || speakers.length < 2) {
    lang.day = Math.max(lang.day, day);
    return;
  }
  const days = Math.min(5, day - lang.day);
  lang.day = day;
  const r = rng(lang.seed + day * 977);
  for (let k = 0; k < 12 * days; k++) {
    const a = speakers[Math.floor(r() * speakers.length)];
    const b = speakers[Math.floor(r() * speakers.length)];
    for (const t of talk(sit, { ...a, name: '' }, { ...b, name: '' }, r)) {
      // (Wanting a word they don't have: made unheard only once they've wanted it a while.)
      // (Said without it, meanwhile: the rest of what they meant, if there's any left.)
      const need = (lang.need ??= {});
      const lacks = (m: string | undefined) => !!m && !wordOf(lang, m) && (need[m] = (need[m] ?? 0) + 1) < UNHEARD_MAKES;
      const fr: Frame = { ...t, to: undefined };
      if (lacks(fr.who)) fr.who = undefined;
      if (lacks(fr.act)) fr.act = undefined;
      if (lacks(fr.thing)) fr.thing = undefined;
      if (lacks(fr.quality)) fr.quality = undefined;
      if (fr.no && lacks('no')) fr.no = false;
      if (fr.ask && lacks('what')) fr.ask = false;
      if (fr.yes && lacks('yes')) fr.yes = false;
      if (!fr.who && !fr.act && !fr.thing && !fr.quality) continue;
      say(lang, fr, t.by ? b : a, day, Math.floor(r() * 1e9));
    }
  }
}

/** Talks wanting a word before one is made with no one listening (a day or two of wanting). */
export const UNHEARD_MAKES = 15;

/** Heard: each word's count goes up, and the situation's noted (a few kept). */
export function hear(lang: Language, said: Said[], situation: string): void {
  for (const s of said) {
    if (!s.meaning) continue;
    lang.heard[s.meaning] = (lang.heard[s.meaning] ?? 0) + 1;
    const c = (lang.ctx[s.meaning] ??= []);
    if (!c.includes(situation)) {
      c.push(situation);
      if (c.length > 4) c.shift();
    }
  }
}

/** The year's sound shift: one change, over every word they have. */
const SHIFTS: { say: string; re: RegExp; to: string }[] = [
  { say: 'k became ch before i and e', re: /k(?=[ie])/g, to: 'ch' },
  { say: 'p between vowels became f', re: /(?<=[aeiou])p(?=[aeiou])/g, to: 'f' },
  { say: 't between vowels became d', re: /(?<=[aeiou])t(?=[aeiou])/g, to: 'd' },
  { say: 'a long word lost its last vowel', re: /(?<=\w{4,})[aeiou]$/g, to: '' },
  { say: 's at the start became h', re: /^s/g, to: 'h' },
  { say: 'a became o after w', re: /(?<=w)a/g, to: 'o' },
  { say: 'doubled sounds became single', re: /([a-z])\1/g, to: '$1' },
  { say: 'g between vowels softened to y', re: /(?<=[aeiou])g(?=[aeiou])/g, to: 'y' },
  { say: 'u at the end became o', re: /u$/g, to: 'o' },
  { say: 'r after a vowel at the end fell away', re: /(?<=[aeiou])r$/g, to: '' },
];
export function shiftSounds(lang: Language, year: number, day = lang.day): string | null {
  if (year <= lang.shiftYear) return null;
  lang.shiftYear = year;
  const r = rng(lang.seed + year * 31);
  const rule = SHIFTS[Math.floor(r() * SHIFTS.length)];
  let changed = 0;
  for (const vs of Object.values(lang.lex)) {
    for (const v of vs) {
      const nf = v.f.replace(rule.re, rule.to);
      if (nf && nf !== v.f && nf.length >= 2) {
        v.f = nf;
        changed++;
      }
    }
  }
  if (!changed) return null;
  for (const [m, vs] of Object.entries(lang.lex)) if (vs[0]) remember(lang, m, vs[0].f, day);
  // (Place names shift with the rest: a name keeps its old words, worn down.)
  for (const p of Object.values(lang.places ?? {})) {
    const nf = p.f.replace(rule.re, rule.to);
    if (nf.length >= 2) p.f = nf;
  }
  lang.shifts.push(rule.say);
  return rule.say;
}

/** A village's word for something comes in alongside theirs (and they fight it out). */
export function borrow(lang: Language, from: string, fromSeed: number, diet: string, meanings: string[], day: number): string[] {
  const theirs = newLanguage(fromSeed, diet);
  const r = rng(fromSeed);
  const took: string[] = [];
  for (const m of meanings) {
    const f = choose(theirs, m, { age: 'grown', temper: '' }, r, day);
    const vs = (lang.lex[m] ??= []);
    if (vs.some((v) => v.f === f)) continue;
    vs.push({ f, s: Math.max(1, (vs[0]?.s ?? 1) * 0.8), born: day });
    lang.from[m] = from;
    took.push(f);
  }
  return took;
}

/** How the tongue puts things, as it stands: the order most used and how settled it is (0 to 1),
 * describing words after or before, no and asking at the front or the end. */
export function grammarOf(lang: Language): { order: string; orderSure: number; qAfter: boolean; negFront: boolean; askFront: boolean } {
  const best = ORDERS.reduce((a, o) => ((lang.orders[o] ?? 0) > (lang.orders[a] ?? 0) ? o : a), ORDERS[0]);
  const tot = ORDERS.reduce((a, o) => a + Math.max(0, lang.orders[o] ?? 0), 0);
  return { order: best, orderSure: tot ? (lang.orders[best] ?? 0) / tot : 0, qAfter: lang.qAfter > 0, negFront: lang.negFront > 0, askFront: lang.askFront > 0 };
}

/** A place named out of two words they have: the first whole, then the start of the second
 * ("water" and "village": mek + ra → Mekra). Once named, it keeps its name (it only wears down
 * with the sounds). None yet if they haven't the words. */
export function namePlace(lang: Language, key: string, of: [string, string], day: number): string | null {
  const had = lang.places?.[key];
  if (had) return null;
  const a = wordOf(lang, of[0]);
  const b = wordOf(lang, of[1]);
  if (!a || !b) return null;
  const f = a + syllables(b)[0];
  (lang.places ??= {})[key] = { f, of, day };
  return f;
}

/** A word's syllables (for whistling it: one note a syllable). */
export function syllables(word: string): string[] {
  return word.toLowerCase().match(/[^aeiou]*[aeiou]+(?:[^aeiou](?![aeiou]))?/g) ?? [word];
}
