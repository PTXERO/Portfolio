// Family trees: who came of whom. On New Shore, any villager, living or dead: their grandparents
// and parents above, their brothers and sisters and whoever they had children with beside them,
// their children below; tap anyone to stand in their place. The four who crossed lead back to the
// Creature's line: generation on generation, and the mate each one was bred with.

import { describe, PLAIN } from '../economy/genes';
import { dietOf } from '../economy/rates';
import { PARTS } from '../content/creature';
import { SEASON_DAYS, SEASON_NAMES, type ShorePerson, type ShoreState } from '../economy/shore';
import type { GameState, Genes } from '../economy/types';
import { creatureIcon, miniIcon, type CreatureLook } from '../scene/creatureLook';

const cap = (t: string) => t[0].toUpperCase() + t.slice(1);

/** A day since landfall, as the Chronicle has it: "Year 3, Autumn". */
function when(day: number): string {
  const year = Math.floor(day / (SEASON_DAYS * 4)) + 1;
  return `Year ${Math.max(1, year)}, ${SEASON_NAMES[Math.floor(((day / SEASON_DAYS) % 4 + 4) % 4)]}`;
}

/** Everyone, living and dead, by id. */
function folk(s: ShoreState): Map<number, ShorePerson> {
  const m = new Map<number, ShorePerson>();
  for (const p of s.dead ?? []) m.set(p.id, p);
  for (const p of s.people) m.set(p.id, p);
  return m;
}

/** How they look: their kind's body, in their own coat. */
function lookOf(s: ShoreState, p: ShorePerson): CreatureLook {
  const base = p.kind !== undefined ? s.villages.find((v) => v.id === p.kind)?.look ?? s.look : s.look;
  return p.genes ? { ...base, genes: p.genes } : base;
}

/** Their life in a line: "Year 2, Spring – Year 6, Winter (old age)" or "born Year 4, Summer". */
function life(p: ShorePerson): string {
  const b = p.founder ? 'crossed the sea' : p.joined !== undefined ? `joined ${when(p.joined)}` : `born ${when(p.born)}`;
  return p.died !== undefined ? `${b} · died ${when(p.died)}${p.cause ? `, ${p.cause}` : ''}` : b;
}

/** One person in the tree, to tap. */
function node(s: ShoreState, p: ShorePerson | undefined, extra = ''): string {
  if (!p) return `<div class="tree-node unknown"><span class="tree-icon">?</span><b>Unknown</b></div>`;
  const dead = p.died !== undefined;
  return `<button class="tree-node${dead ? ' dead' : ''}${extra}" data-tree="${p.id}">${miniIcon(lookOf(s, p), 2)}<b>${p.name}</b><span class="tiny dim">${dead ? 'died ' + when(p.died!).replace('Year ', 'Y') : p.id === s.chief ? 'chief' : p.founder ? 'one of the four' : ''}</span></button>`;
}

/** The tree round one villager. */
export function shoreTree(state: GameState, s: ShoreState, id: number): string {
  const all = folk(s);
  const me = all.get(id);
  if (!me) return '';
  const parentsOf = (p?: ShorePerson) => (p?.parents ?? []).map((i) => (i === undefined ? undefined : all.get(i)));
  const parents = parentsOf(me);
  const grand = parents.flatMap((p) => (p ? parentsOf(p) : []));
  const childrenOf = (p: ShorePerson) => [...all.values()].filter((c) => c.parents?.includes(p.id)).sort((a, b) => a.born - b.born);
  const kids = childrenOf(me);
  // Whoever they had children with.
  const partners = [...new Set(kids.flatMap((c) => c.parents ?? []).filter((i): i is number => i !== undefined && i !== me.id))].map((i) => all.get(i)).filter((p): p is ShorePerson => !!p);
  // Brothers and sisters: a parent in common.
  const sibs = me.parents ? [...all.values()].filter((o) => o.id !== me.id && o.parents?.some((i) => i !== undefined && me.parents!.includes(i))).sort((a, b) => a.born - b.born) : [];
  const kind = me.kind !== undefined ? s.villages.find((v) => v.id === me.kind)?.name : undefined;
  const role = me.id === s.chief ? 'Chief' : me.founder ? 'One of the four who crossed' : kind ? `Of ${kind}` : me.died !== undefined ? 'Remembered' : 'Born on New Shore';
  const row = (label: string, ps: (ShorePerson | undefined)[], empty?: string) =>
    ps.length || empty ? `<div class="tree-row"><span class="tree-label tiny dim">${label}</span><div class="tree-nodes">${ps.length ? ps.map((p) => node(s, p)).join('') : `<span class="tiny dim">${empty}</span>`}</div></div>` : '';
  // Up the tree: the four came of the Creature's line; those who joined, of their village.
  const above = me.founder
    ? `<div class="tree-row"><span class="tree-label tiny dim">Their line</span><div class="tree-nodes"><button class="tree-node line" data-treeline="1">${miniIcon(s.look, 2)}<b>The line</b><span class="tiny dim">${state.stages.creature.generation} generations</span></button></div></div>`
    : me.parents
      ? (parents.some((p) => p?.founder)
          ? `<div class="tree-row"><span class="tree-label tiny dim">Grandparents</span><div class="tree-nodes">${grand.length ? grand.map((p) => node(s, p)).join('') : ''}<button class="tree-node line" data-treeline="1">${miniIcon(s.look, 2)}<b>The line</b><span class="tiny dim">through the four</span></button></div></div>`
          : row('Grandparents', grand, 'Not known')) + row('Parents', parents)
      : `<div class="tree-row"><span class="tree-label tiny dim">Came from</span><div class="tree-nodes"><span class="tiny">${kind ? cap(kind) : 'Not recorded (born before the trees were kept)'}</span></div></div>`;
  return `<p class="label dim">Family tree</p>
    <div class="tree-me">${creatureIcon(lookOf(s, me), 3)}<div><h3>${me.name}</h3><p class="tiny">${role} · ${describe(me.genes)}</p><p class="tiny dim">${life(me)}</p></div></div>
    <div class="tree">
      ${above}
      ${row('Brothers & sisters', sibs)}
      ${row(partners.length > 1 ? 'Had children with' : 'Partner', partners)}
      ${row('Children', kids, me.died === undefined && !kids.length ? 'None yet' : 'None')}
    </div>
    <div class="choices"><button class="px-btn" data-treeback="1">‹ Back</button><button class="px-btn gold" data-act="dismiss">Close</button></div>`;
}

/** Where a generation's looks came from: the line, the mate, both, or nowhere (new). */
function whence(l: NonNullable<GameState['stages']['creature']['line']>[number]): string[] {
  const before = l.before ?? PLAIN;
  const mate = l.mateGenes ?? PLAIN;
  const g = l.genes;
  const out: string[] = [];
  const from = (line: boolean, them: boolean) => (line && them ? 'from both sides' : line ? 'kept from the line' : them ? `from ${l.mate}` : 'new: born with it');
  if (g.morph) out.push(`${cap(MORPH_WORD[g.morph])} colouring: ${from(before.morph === g.morph, mate.morph === g.morph)}`);
  else if (before.morph) out.push(`Lost the ${MORPH_WORD[before.morph]} colouring (${l.mate} didn't carry it)`);
  if (g.pattern) out.push(`${cap(PATTERN_WORD[g.pattern])}: ${from(before.pattern === g.pattern, mate.pattern === g.pattern)}`);
  else if (before.pattern) out.push(`Lost the ${PATTERN_WORD[before.pattern]}`);
  if (Math.abs(g.hue - before.hue) > 6 || Math.abs(g.light - before.light) > 0.04) out.push(`Coat shade: between the line's and ${l.mate}'s`);
  for (const id of l.parts ?? []) out.push(`${PARTS.find((p) => p.id === id)?.name ?? id}: from ${l.mate}`);
  return out.length ? out : ['Looks much as the line did'];
}

const PATTERN_WORD: Record<string, string> = { stripes: 'stripes', spots: 'spots', saddle: 'saddle markings', mask: 'face mask', socks: 'white feet' };
const MORPH_WORD: Record<string, string> = { albino: 'white', melanistic: 'black', piebald: 'piebald' };

/** The Creature's line: each generation (newest first), what it was bred with, and where each of
 * its looks came from, so a sudden change of look has its reason. */
export function lineTree(state: GameState): string {
  const c = state.stages.creature;
  const diet = state.stages.tribal.tribe?.look.diet ?? (dietOf(state, 'creature') ?? 'none');
  const base: CreatureLook = { parts: { ...c.equipped }, diet };
  const at = (g?: Genes, parts?: CreatureLook['parts']) => ({ ...base, parts: { ...base.parts, ...(parts ?? {}) }, genes: g });
  const line = c.line ?? [];
  const rows = [...line]
    .reverse()
    .map(
      (l) => `<div class="line-gen"><div class="line-head"><span class="tiny dim">Generation ${l.generation}</span></div>
        <div class="line-cross">${miniIcon(at(l.before), 2)}<span class="tiny dim">the line</span><span class="dim">×</span>${miniIcon(at(l.mateGenes, l.mateParts), 2)}<span class="tiny dim">${l.mate}</span><span class="dim">→</span>${miniIcon(at(l.genes), 2)}<span class="tiny">${describe(l.genes)}</span></div>
        <ul class="line-why">${whence(l).map((w) => `<li class="tiny">${w}</li>`).join('')}</ul></div>`,
    )
    .join('');
  const four = state.stages.tribal.tribe?.family ?? [];
  return `<p class="label dim">Family tree</p><h3>The line</h3>
    <p class="tiny dim">Each generation: the line, bred with a mate, and the young that became the line, with where each of their looks came from.${line.length < c.generation ? ` (The ${c.generation - line.length} oldest, from before looks were kept, are lost.)` : ''}</p>
    ${four.length ? `<div class="tree-row"><span class="tree-label tiny dim">The four who crossed</span><div class="tree-nodes">${four.map((f) => `<div class="tree-node">${miniIcon(at(f.genes), 2)}<b>${f.name}</b></div>`).join('')}</div></div>` : ''}
    <div class="line-list">${rows || `<p class="tiny dim">${c.generation ? 'Breed with a mate, and the next generation is written down here, with where its looks came from.' : 'No young bred yet: breed with a mate.'}</p>`}
      <div class="line-gen"><div class="line-cross">${miniIcon(at(undefined), 2)}<span class="tiny">Generation 0: came up out of the sea</span></div></div></div>
    <div class="choices"><button class="px-btn" data-treeback="1">‹ Back</button><button class="px-btn gold" data-act="dismiss">Close</button></div>`;
}
