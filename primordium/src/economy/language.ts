// Their own tongue. Every line said round the fire is said in it: its own sounds (from the
// line's look and diet), its own grammar (word order, adjectives before or after, a plural, a
// past, how it says no and asks), and words made the first time something needs saying, so the
// vocabulary grows with what they talk about. Once a year the sounds shift a little (as every
// language's do); villages won lend it words. Nothing says what a word means: what's kept is
// how often each was heard and when (who said it, the fire, the season), for anyone who wants to
// work it out, and their own guesses. The scribes, when they come, write the meanings down.
// (Cheap: a line's worked out when it's said, a few times a minute; the sounds shift once a
// year of the island's, over a few hundred words.)

export type Pos = 'n' | 'v' | 'a' | 'p' | 'r' | 'x' | 'c' | 'q' | 'd' | 'b';

export interface Language {
  seed: number;
  /** Its sounds. */
  cons: string;
  vows: string;
  /** Grammar. */
  order: 'SVO' | 'SOV' | 'VSO';
  adjAfter: boolean;
  plural: string;
  past: string;
  neg: string;
  negAfter: boolean;
  ask: string;
  askFront: boolean;
  dropBe: boolean;
  /** Meaning (an English word) → their word. */
  words: Record<string, string>;
  /** How often each was heard, and in what situations (a few). */
  heard: Record<string, number>;
  ctx: Record<string, string[]>;
  /** Words they had before a shift (meaning → old forms). */
  was: Record<string, string[]>;
  /** Your guesses at what their words mean (by meaning, so they survive a shift). */
  guess: Record<string, string>;
  /** Where a word came from, when it was borrowed. */
  from: Record<string, string>;
  /** The scribes have written down what the words mean (it stays written, island to island). */
  scribed?: boolean;
  /** The sound shifts so far (in words), and the year of the last. */
  shifts: string[];
  shiftYear: number;
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
function hashStr(s: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 2654435761) >>> 0;
  return h;
}

/** The sounds a line's speech is made of, by its diet: soft and round for grazers, hard for
 * hunters, a bit of both between. */
const SOUNDS: Record<string, { cons: string[]; vows: string[] }> = {
  grazer: { cons: ['m', 'l', 'n', 'w', 'h', 'v', 'b', 'r', 's', 'y', 'f', 'p'], vows: ['a', 'o', 'u', 'e', 'i', 'oo', 'au'] },
  hunter: { cons: ['k', 'g', 'r', 't', 'z', 'd', 'kh', 'sh', 'x', 'q', 'v', 'n'], vows: ['a', 'u', 'i', 'o', 'e', 'aa'] },
  omnivore: { cons: ['t', 'm', 'k', 'l', 's', 'n', 'r', 'p', 'b', 'd', 'h', 'y'], vows: ['a', 'e', 'i', 'o', 'u', 'ei'] },
};

/** A new tongue, from a seed and a diet. */
export function newLanguage(seed: number, diet: string): Language {
  const r = rng(seed * 7 + 13);
  const set = SOUNDS[diet] ?? SOUNDS.omnivore;
  const pick = <T>(xs: T[], n: number) => [...xs].sort(() => r() - 0.5).slice(0, n);
  const cons = pick(set.cons, 7 + Math.floor(r() * 3)).join(',');
  const vows = pick(set.vows, 4 + Math.floor(r() * 2)).join(',');
  const lang: Language = {
    seed,
    cons,
    vows,
    order: (['SVO', 'SOV', 'VSO'] as const)[Math.floor(r() * 3)],
    adjAfter: r() < 0.55,
    plural: '',
    past: '',
    neg: '',
    negAfter: r() < 0.4,
    ask: '',
    askFront: r() < 0.5,
    dropBe: r() < 0.7,
    words: {},
    heard: {},
    ctx: {},
    was: {},
    guess: {},
    from: {},
    shifts: [],
    shiftYear: 0,
  };
  lang.plural = syllable(lang, r).slice(0, 2);
  lang.past = syllable(lang, r).slice(0, 2);
  lang.neg = syllable(lang, r);
  lang.ask = syllable(lang, r);
  return lang;
}

function syllable(lang: Language, r: () => number): string {
  const C = lang.cons.split(',');
  const V = lang.vows.split(',');
  const c = C[Math.floor(r() * C.length)];
  const v = V[Math.floor(r() * V.length)];
  const end = r() < 0.3 ? C[Math.floor(r() * C.length)] : '';
  return c + v + (end.length === 1 ? end : '');
}

/** Their word for something: made the first time it's needed (short for the little words). */
export function wordFor(lang: Language, meaning: string, pos: Pos): string {
  const have = lang.words[meaning];
  if (have) return have;
  const r = rng(hashStr(meaning, lang.seed));
  const small = pos === 'x' || pos === 'p' || pos === 'c' || pos === 'q' || pos === 'b';
  const n = small ? 1 : meaning.length > 6 ? 2 + Math.floor(r() * 2) : 1 + Math.floor(r() * 2);
  let w = '';
  for (let i = 0; i < n; i++) w += syllable(lang, r);
  // (Never the same as another word they have: a vowel's added till it isn't.)
  const taken = new Set(Object.values(lang.words));
  while (taken.has(w)) w += lang.vows.split(',')[Math.floor(r() * lang.vows.split(',').length)];
  lang.words[meaning] = w;
  return w;
}

// ---- English, as far as the talk at the fire needs it ----

const LEX: Record<string, Pos> = {};
const add = (pos: Pos, s: string) => s.split(' ').forEach((w) => (LEX[w] = pos));
add('x', 'i you we they he she it me us them him her my your our their its this that these those there here');
add('v', 'be have go come see eat sing sleep know hear tell say take give make find look sit walk swim dream want feed keep count remember watch fall burn grow learn write beat win love think wait smell need stay run race hum poke help mean forget lean move budge play cut pour bring buy dance sway stamp shout cook catch fish hunt gather plant build send meet follow stop start begin follow try do can will should would could must let get put call cry laugh bite fight hide carry open close lose leave rest pray believe hope fear');
add('n', 'fire food fish root roots water sky star stars spark sparks sun moon night day winter summer spring autumn leaf leaves hut huts village villages island fog smoke raft crossing child children critter critters elder elders chief mother father kin name bone tail fur coat toe toes foot feet eye eyes shape song story tellings telling mark marks scribe scribes blade blades bronze stone stones boat boats harbour council road roads hearth edge shore sea spear light thing things one ones hand hands head ground tree trees grass rain snow wind year years morning evening home bed beds way word words time place gift gifts dance smiths smith fog hills hill river lake law marks people stranger strangers party drums drum heroes hall');
add('a', 'big small little cold warm hot good bad old young new quiet loud nice green red bright many few more all same other slow long tired full sure dark wet dry far near strange lonely glad sad hungry soft hard white first last whole only every each some');
add('r', 'here there now then again always never too up down away back closer far yes no maybe still once soon tonight today tomorrow yesterday together alone very just even');
add('p', 'to from in on at by with of for into across past under behind about over through after before');
add('c', 'and but or so because if than');
add('q', 'what where who why how when which');
add('d', 'a an the');
add('b', 'is are am was were be been being');
const IRREGULAR: Record<string, [string, boolean]> = {
  was: ['be', true], were: ['be', true], did: ['do', true], saw: ['see', true], came: ['come', true], went: ['go', true], ate: ['eat', true], fell: ['fall', true], took: ['take', true], told: ['tell', true], said: ['say', true], found: ['find', true], made: ['make', true], got: ['get', true], thought: ['think', true], heard: ['hear', true], knew: ['know', true], gave: ['give', true], sat: ['sit', true], slept: ['sleep', true], sang: ['sing', true], swam: ['swim', true], kept: ['keep', true], left: ['leave', true], brought: ['bring', true], caught: ['catch', true], fought: ['fight', true], beat: ['beat', false], ran: ['run', true], grew: ['grow', true], wrote: ['write', true], began: ['begin', true], meant: ['mean', true], dreamed: ['dream', true],
  children: ['child', false], feet: ['foot', false], people: ['people', false], leaves: ['leaf', false],
};
const CONTRACT: Record<string, string> = {
  "it's": 'it is', "that's": 'that is', "there's": 'there is', "what's": 'what is', "he's": 'he is', "she's": 'she is', "i'm": 'i am', "you're": 'you are', "we're": 'we are', "they're": 'they are', "don't": 'do not', "doesn't": 'do not', "didn't": 'did not', "can't": 'can not', "won't": 'will not', "isn't": 'is not', "wasn't": 'was not', "aren't": 'are not', "couldn't": 'could not', "wouldn't": 'would not', "i'd": 'i would', "they'd": 'they would', "who'd": 'who would', "i've": 'i have', "you've": 'you have', "let's": 'let us', "i'll": 'i will', "you'll": 'you will',
};

/** A word of English, as the tongue sees it: what it means at bottom, what kind of word, and
 * whether it's many or past. */
function parse(raw: string): { lemma: string; pos: Pos; many: boolean; past: boolean } {
  const w = raw.toLowerCase();
  if (IRREGULAR[w]) {
    const [lemma, past] = IRREGULAR[w];
    return { lemma, pos: LEX[lemma] ?? (past ? 'v' : 'n'), many: !past && lemma !== w, past };
  }
  if (LEX[w]) return { lemma: w, pos: LEX[w], many: false, past: false };
  if (w.endsWith('ies') && LEX[w.slice(0, -3) + 'y']) return { lemma: w.slice(0, -3) + 'y', pos: 'n', many: true, past: false };
  if (w.endsWith('s') && LEX[w.slice(0, -1)] === 'n') return { lemma: w.slice(0, -1), pos: 'n', many: true, past: false };
  if (w.endsWith('s') && LEX[w.slice(0, -1)] === 'v') return { lemma: w.slice(0, -1), pos: 'v', many: false, past: false };
  if (w.endsWith('ed') && LEX[w.slice(0, -2)]) return { lemma: w.slice(0, -2), pos: 'v', many: false, past: true };
  if (w.endsWith('ed') && LEX[w.slice(0, -1)]) return { lemma: w.slice(0, -1), pos: 'v', many: false, past: true };
  if (w.endsWith('ing') && LEX[w.slice(0, -3)]) return { lemma: w.slice(0, -3), pos: 'v', many: false, past: false };
  if (w.endsWith('ing')) return { lemma: w.slice(0, -3), pos: 'v', many: false, past: false };
  if (w.endsWith('ed')) return { lemma: w.slice(0, -2), pos: 'v', many: false, past: true };
  if (w.endsWith('ly')) return { lemma: w, pos: 'r', many: false, past: false };
  // (A word it doesn't know ending in -s: taken as many of something.)
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return { lemma: w.slice(0, -1), pos: 'n', many: true, past: false };
  return { lemma: w, pos: 'n', many: false, past: false };
}

/** A word said: their word, and what it means (for the gloss; none for a name). */
export interface Said {
  word: string;
  meaning?: string;
}

/**
 * A line of English, said in their tongue: word by word, in their order (the verb moved to the
 * end, or the front), adjectives after their nouns if that's their way, "the" and "a" dropped,
 * "is" too if they do without it, a plural and a past put on, no and asking their way. Names are
 * kept as they are. The words it needs that it hasn't got, it makes.
 */
export function speak(lang: Language, english: string, names: Set<string>): { text: string; said: Said[] } {
  const all: Said[] = [];
  const out: string[] = [];
  const ask = english.trim().endsWith('?');
  // Clause by clause (the punctuation kept between).
  const parts = english.replace(/[“”"]/g, '').split(/([,.;:!?…]+)/);
  for (let k = 0; k < parts.length; k++) {
    const piece = parts[k];
    if (/^[,.;:!?…]+$/.test(piece)) {
      if (out.length) out[out.length - 1] += piece.replace(/\.\.\./g, '…');
      continue;
    }
    let raw = piece
      .split(/\s+/)
      .filter(Boolean)
      .flatMap((w) => (CONTRACT[w.toLowerCase()] ?? w).split(' '));
    raw = raw.map((w) => w.replace(/[^A-Za-z'0-9-]/g, '')).filter(Boolean);
    type Tok = Said & { pos: Pos };
    let toks: Tok[] = [];
    for (const r0 of raw) {
      const r = r0.replace(/'s$/, '');
      if (names.has(r) || names.has(r.replace(/s$/, ''))) {
        toks.push({ word: r, pos: 'n' });
        continue;
      }
      if (/^\d/.test(r)) {
        toks.push({ word: r, pos: 'n' });
        continue;
      }
      const p = parse(r);
      if (p.pos === 'd') continue;
      if (p.pos === 'b' && lang.dropBe) continue;
      if (p.lemma === 'not' || p.lemma === 'never') {
        toks.push({ word: lang.neg, meaning: 'not', pos: 'r' });
        continue;
      }
      let w = wordFor(lang, p.lemma, p.pos);
      if (p.many) w += lang.plural;
      if (p.past) w += lang.past;
      toks.push({ word: w, meaning: p.lemma + (p.many ? ' (many)' : '') + (p.past ? ' (past)' : ''), pos: p.pos });
    }
    // Adjectives after their nouns.
    if (lang.adjAfter) {
      for (let i = 0; i + 1 < toks.length; i++) {
        if (toks[i].pos === 'a' && toks[i + 1].pos === 'n') [toks[i], toks[i + 1]] = [toks[i + 1], toks[i]];
      }
    }
    // No: before the verb, or after it.
    const vi = toks.findIndex((t) => t.pos === 'v');
    const ni = toks.findIndex((t) => t.meaning === 'not');
    if (ni >= 0 && vi >= 0) {
      const [n] = toks.splice(ni, 1);
      const v2 = toks.findIndex((t) => t.pos === 'v');
      toks.splice(lang.negAfter ? v2 + 1 : v2, 0, n);
    }
    // The verb (with its no) at the end, or at the front.
    const v3 = toks.findIndex((t) => t.pos === 'v');
    if (v3 >= 0 && lang.order !== 'SVO') {
      let start = v3;
      let end = v3 + 1;
      if (toks[v3 - 1]?.meaning === 'not') start--;
      if (toks[v3 + 1]?.meaning === 'not') end++;
      const group = toks.splice(start, end - start);
      toks = lang.order === 'SOV' ? [...toks, ...group] : [...group, ...toks];
    }
    for (const t of toks) {
      out.push(t.word);
      all.push({ word: t.word, meaning: t.meaning });
    }
  }
  if (ask) {
    if (lang.askFront) {
      out.unshift(lang.ask);
      all.unshift({ word: lang.ask, meaning: '(asking)' });
    } else {
      const last = out.length - 1;
      out[last] = out[last].replace(/[?]+$/, '');
      out.push(lang.ask + '?');
      all.push({ word: lang.ask, meaning: '(asking)' });
    }
  }
  let text = out.join(' ').replace(/\s+([,.;:!?…])/g, '$1');
  text = text.charAt(0).toUpperCase() + text.slice(1);
  return { text, said: all };
}

/** Heard: each word's count goes up, and the situation's noted (a few kept). */
export function hear(lang: Language, said: Said[], situation: string): void {
  for (const s of said) {
    if (!s.meaning) continue;
    const m = s.meaning.replace(/ \((many|past)\)/g, '');
    lang.heard[m] = (lang.heard[m] ?? 0) + 1;
    const c = (lang.ctx[m] ??= []);
    if (!c.includes(situation)) {
      c.push(situation);
      if (c.length > 4) c.shift();
    }
  }
}

/** The year's sound shift: one change, over every word (the old forms kept). */
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
export function shiftSounds(lang: Language, year: number): string | null {
  if (year <= lang.shiftYear) return null;
  lang.shiftYear = year;
  const r = rng(lang.seed + year * 31);
  const rule = SHIFTS[Math.floor(r() * SHIFTS.length)];
  let changed = 0;
  for (const [m, w] of Object.entries(lang.words)) {
    const nw = w.replace(rule.re, rule.to);
    if (nw && nw !== w && nw.length >= 2) {
      (lang.was[m] ??= []).push(w);
      lang.words[m] = nw;
      changed++;
    }
  }
  for (const k of ['plural', 'past', 'neg', 'ask'] as const) {
    const nw = lang[k].replace(rule.re, rule.to);
    if (nw.length >= 1) lang[k] = nw;
  }
  if (!changed) return null;
  lang.shifts.push(rule.say);
  return rule.say;
}

/** A word taken from a village's tongue (for something they say a lot of there). */
export function borrow(lang: Language, from: string, fromSeed: number, diet: string, meanings: string[]): string[] {
  const theirs = newLanguage(fromSeed, diet);
  const took: string[] = [];
  for (const m of meanings) {
    const w = wordFor(theirs, m, 'n');
    if (lang.words[m] === w) continue;
    if (lang.words[m]) (lang.was[m] ??= []).push(lang.words[m]);
    lang.words[m] = w;
    lang.from[m] = from;
    took.push(w);
  }
  return took;
}

/** A word's syllables (for whistling it: one note a syllable). */
export function syllables(word: string): string[] {
  return word.toLowerCase().match(/[^aeiou]*[aeiou]+(?:[^aeiou](?![aeiou]))?/g) ?? [word];
}
