// The line's looks, passed down: a coat's shade, its markings, and now and then a rare colouring.
// None of it touches the stats; all of it is inherited. Bred in the Creature (from mates), carried
// by the four through the Extinction, and on down the generations on New Shore (from both parents).

import type { Genes, Morph, Pattern } from './types';

export const PATTERNS: Pattern[] = ['stripes', 'spots', 'saddle', 'mask', 'socks'];
export const MORPHS: Morph[] = ['albino', 'melanistic', 'piebald'];

/** How often a rare colouring turns up out of nowhere (a birth in fifty). */
const MUTATE = 0.02;

/** As the line came out of the sea: its diet's own colours, unmarked. */
export const PLAIN: Genes = { hue: 0, light: 0 };

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
/** Rounded (and never -0, which doesn't survive a save). */
const round = (v: number, k = 1) => Math.round(v * k) / k || 0;

/** A stranger's looks (a mate met on the island): a shade of their own, maybe markings, rarely a
 * rare colouring. */
export function randomGenes(rand: () => number): Genes {
  const g: Genes = { hue: round((rand() - 0.5) * 70), light: round((rand() - 0.5) * 0.24, 100) };
  if (rand() < 0.4) g.pattern = PATTERNS[Math.floor(rand() * PATTERNS.length)];
  if (rand() < 0.04) g.morph = MORPHS[Math.floor(rand() * MORPHS.length)];
  return g;
}

/**
 * A child of two: the shade between theirs (nearer the first), drifting a little; markings from
 * one or the other (a parent's markings more often than not show); a rare colouring shows when
 * both carry it, often when one does, and now and then from nowhere.
 */
export function inherit(a: Genes = PLAIN, b: Genes = PLAIN, rand: () => number, lean = 0.5): Genes {
  const g: Genes = {
    hue: round(a.hue * lean + b.hue * (1 - lean) + (rand() - 0.5) * 8),
    light: round(clamp(a.light * lean + b.light * (1 - lean) + (rand() - 0.5) * 0.04, -0.2, 0.2), 100),
  };
  const marks = [a.pattern, b.pattern].filter((p): p is Pattern => !!p);
  if (marks.length && rand() < (marks.length === 2 ? 0.95 : 0.6)) g.pattern = marks[Math.floor(rand() * marks.length)];
  const rare = [a.morph, b.morph].filter((m): m is Morph => !!m);
  if (rare.length === 2 && a.morph === b.morph) g.morph = a.morph;
  else if (rare.length && rand() < 0.35) g.morph = rare[Math.floor(rand() * rare.length)];
  else if (rand() < MUTATE) g.morph = MORPHS[Math.floor(rand() * MORPHS.length)];
  return g;
}

/** One of a kind, within its line: the same markings and colouring, the shade a touch its own. */
export function vary(g: Genes = PLAIN, rand: () => number): Genes {
  return { ...g, hue: round(g.hue + (rand() - 0.5) * 14), light: round(clamp(g.light + (rand() - 0.5) * 0.08, -0.2, 0.2), 100) };
}

/** One animal's own look within the line, the same each time for the same one (by its id). */
export function personal(g: Genes = PLAIN, seed: number): Genes {
  let r = (Math.floor(Math.abs(seed) * 7919 + 13) % 2147483646) + 1;
  return vary(g, () => ((r = (r * 16807) % 2147483647) / 2147483647));
}

const PATTERN_NAME: Record<Pattern, string> = { stripes: 'striped', spots: 'spotted', saddle: 'saddle-backed', mask: 'masked', socks: 'white-footed' };
const MORPH_NAME: Record<Morph, string> = { albino: 'white', melanistic: 'black', piebald: 'piebald' };

/** In a word or two: "striped", "white, spotted", "a darker coat". */
export function describe(g?: Genes): string {
  if (!g) return 'plain-coated';
  const bits: string[] = [];
  if (g.morph) bits.push(MORPH_NAME[g.morph]);
  if (g.pattern) bits.push(PATTERN_NAME[g.pattern]);
  if (!g.morph) {
    if (g.light > 0.08) bits.push('pale');
    else if (g.light < -0.08) bits.push('dark');
    if (Math.abs(g.hue) > 22) bits.push(g.hue > 0 ? 'warm-hued' : 'cool-hued');
  }
  return bits.length ? bits.join(', ') : 'plain-coated';
}

/** What's new in a child next to its parent line: worth saying when the young are hatched. */
export function whatsNew(before: Genes = PLAIN, after: Genes): string | undefined {
  if (after.morph && after.morph !== before.morph) return after.morph === 'albino' ? 'A white one! The young came out pale as bone, pink-eyed.' : after.morph === 'melanistic' ? 'The young came out black, all over.' : 'The young came out piebald, patched with white.';
  if (!after.morph && before.morph) return `The ${MORPH_NAME[before.morph]} colouring is gone from the line, for now.`;
  if (after.pattern && after.pattern !== before.pattern) return `The young are ${PATTERN_NAME[after.pattern]}.`;
  if (!after.pattern && before.pattern) return `The young came out without the ${before.pattern === 'socks' ? 'white feet' : before.pattern}.`;
  if (Math.abs(after.hue - before.hue) > 10 || Math.abs(after.light - before.light) > 0.06) return 'The young have a coat a shade different.';
  return undefined;
}
