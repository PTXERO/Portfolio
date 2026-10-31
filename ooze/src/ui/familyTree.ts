// Family trees: who came of whom. On New Shore, any villager, living or dead: their grandparents
// and parents above, their brothers and sisters and whoever they had children with beside them,
// their children below; tap anyone to stand in their place. The four who crossed lead back to the
// Creature's line: generation on generation, and the mate each one was bred with.

import { describe, PLAIN } from '../economy/genes';
import { dietOf } from '../economy/rates';
import { PARTS } from '../content/creature';
import { SEASON_DAYS, SEASON_NAMES, type ShorePerson, type ShoreState } from '../economy/shore';
import type { GameState, Genes } from '../economy/types';
import { miniIcon, type CreatureLook } from '../scene/creatureLook';

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
  if (p.moved) return `${b} · went to live with ${p.moved}${p.movedOn !== undefined ? ` (${when(p.movedOn)})` : ''}`;
  return p.died !== undefined ? `${b} · died ${when(p.died)}${p.cause ? `, ${p.cause}` : ''}` : b;
}

/** The chart's sizes (px): a person's box, the gap between partners and between brothers and
 * sisters, and a generation's height. */
const NW = 60;
const NH = 58;
const CG = 10;
const SG = 12;
const ROW = 96;

type Box = { x: number; y: number; html: string };
type Line = [number, number, number, number, string, boolean];
/** Each partnership its own colour (its line, its ring, and the lines down to its children). */
const PAIR_COLS = ['#e8c050', '#7fc8e0', '#e68ab8', '#9fd08a', '#f2906c'];
const PLAIN_COL = '#c8bfa8';

/**
 * The tree round one villager, drawn as a chart: grandparents (as couples) over the parents,
 * the parents over their children (this one, highlighted, with brothers and sisters), this
 * one's partner beside them and their children below. Direct lines only: no aunts, uncles or
 * cousins. The dead are ghosts. Tap anyone to stand in their place.
 * (`back`: there's a tree to go back to, having come here from it.)
 */
export function shoreTree(state: GameState, s: ShoreState, id: number, back = false): string {
  const all = folk(s);
  const me = all.get(id);
  if (!me) return '';
  const get = (i?: number) => (i === undefined ? undefined : all.get(i));
  const parentsOf = (p?: ShorePerson) => (p?.parents ?? []).map((i) => get(i)).filter((x): x is ShorePerson => !!x);
  const childrenOf = (p: ShorePerson) => [...all.values()].filter((c) => c.parents?.includes(p.id)).sort((a, b) => a.born - b.born);
  const parents = parentsOf(me);
  const kids = childrenOf(me);
  const partners = [...new Set(kids.flatMap((c) => c.parents ?? []).filter((i): i is number => i !== undefined && i !== me.id))].map((i) => all.get(i)).filter((p): p is ShorePerson => !!p);
  const sibs = me.parents ? [...all.values()].filter((o) => o.id !== me.id && o.parents?.some((i) => i !== undefined && me.parents!.includes(i))) : [];
  const kind = me.kind !== undefined ? s.villages.find((v) => v.id === me.kind)?.name : undefined;

  const boxes: Box[] = [];
  const lines: Line[] = [];
  const rings: [number, number, string][] = [];
  // The pen lines are drawn with: a colour, and dashed (half brothers and sisters).
  let pen = { col: PLAIN_COL, dash: false };
  const line = (...ls: [number, number, number, number][]) => {
    for (const l of ls) lines.push([...l, pen.col, pen.dash]);
  };
  // Half brothers and sisters: only one parent in common.
  const half = new Set(me.parents?.length === 2 ? sibs.filter((o) => !me.parents!.every((i) => o.parents?.includes(i!))).map((o) => o.id) : []);
  const person = (p: ShorePerson, x: number, y: number) => {
    const dead = p.died !== undefined;
    const sub = dead ? `† ${when(p.died!).replace('Year ', 'Y').replace(', ', ' ')}` : p.moved ? `→ ${p.moved.replace(/^the /, '')}` : half.has(p.id) ? 'half' : p.id === s.chief ? 'chief' : p.founder ? 'crossed' : '';
    boxes.push({ x, y, html: `<button class="chart-node${dead ? ' ghost' : p.moved ? ' away' : ''}${p.id === me.id ? ' me' : ''}" data-tree="${p.id}" style="left:${x}px;top:${y}px">${miniIcon(lookOf(s, p), 2)}<b>${p.name}</b><i>${sub}</i></button>` });
  };
  const other = (html: string, x: number, y: number, attr = '') => boxes.push({ x, y, html: `<${attr ? 'button' : 'div'} class="chart-node other" ${attr} style="left:${x}px;top:${y}px">${html}</${attr ? 'button' : 'div'}>` });
  const couple = (x1: number, x2: number, y: number) => {
    line([x1 + NW, y + NH / 2, x2, y + NH / 2]);
    rings.push([(x1 + NW + x2) / 2, y + NH / 2, pen.col]);
  };
  // From a couple (or one parent) down to their children's tops.
  const descend = (fromX: number, fromY: number, childXs: number[], childY: number, barUp = 0) => {
    if (!childXs.length) return;
    const bar = childY - 16 - barUp;
    const cx = childXs.map((x) => x + NW / 2);
    line([fromX, fromY, fromX, bar]);
    line([Math.min(fromX, ...cx), bar, Math.max(fromX, ...cx), bar]);
    for (const x of cx) line([x, bar, x, childY]);
  };

  // Rows: grandparents (0), parents (1), this one's generation (2), their children (3).
  const gy = 0;
  const py = ROW;
  const sy = ROW * 2;
  const ky = ROW * 3;
  // This one's generation: brothers and sisters by age, then this one, partners beside them.
  const byAge = (a: ShorePerson, b: ShorePerson) => a.born - b.born || a.id - b.id;
  const halfOf = (i: number) => sibs.filter((o) => me.parents?.length === 2 && o.parents?.includes(me.parents[i]!) && !o.parents?.includes(me.parents[1 - i]!)).sort(byAge);
  const fullSibs = sibs.filter((o) => !halfOf(0).includes(o) && !halfOf(1).includes(o)).sort(byAge);
  // (Half brothers and sisters on the side of the parent they share; this one last of the full.)
  const gen = [...halfOf(0), ...fullSibs, me, ...halfOf(1)];
  const xs = new Map<number, number>();
  let x = 0;
  for (const p of gen) {
    xs.set(p.id, x);
    x += NW + SG;
    if (p === me && partners.length === 1)
      for (const q of partners) {
        xs.set(q.id, x - SG + CG);
        x += NW + CG;
      }
  }
  for (const p of gen) person(p, xs.get(p.id)!, sy);
  const meX = xs.get(me.id)!;
  if (partners.length <= 1) {
    // One partner (or none): beside them, joined, their children hanging from the couple.
    const q = partners[0];
    let jx = meX + NW / 2;
    let jy = sy + NH;
    if (q) {
      person(q, xs.get(q.id)!, sy);
      couple(meX, xs.get(q.id)!, sy);
      jx = (meX + NW + xs.get(q.id)!) / 2;
      jy = sy + NH / 2;
    }
    const kx0 = jx - (kids.length * (NW + SG) - SG) / 2;
    kids.forEach((c, i) => person(c, kx0 + i * (NW + SG), ky));
    descend(jx, jy, kids.map((_, i) => kx0 + i * (NW + SG)), ky);
  } else {
    // Several partners: each couple a row of its own below them, the partner first and the
    // children they had beside, in that couple's colour; a line down from this one to each, so
    // none crosses another.
    const groups: { q?: ShorePerson; kids: ShorePerson[] }[] = partners.map((q) => ({ q, kids: kids.filter((c) => c.parents?.includes(q.id)) }));
    const loose = kids.filter((c) => !partners.some((q) => c.parents?.includes(q.id)));
    if (loose.length) groups.push({ kids: loose });
    const trunk = meX + NW / 2;
    const x0 = trunk + 16;
    let lastY = sy + NH;
    groups.forEach((g, k) => {
      const y = ky + k * ROW;
      pen = { col: g.q ? PAIR_COLS[k % PAIR_COLS.length] : PLAIN_COL, dash: false };
      if (g.q) person(g.q, x0, y);
      const cx0 = g.q ? x0 + NW + SG + 10 : x0;
      g.kids.forEach((c, i) => person(c, cx0 + i * (NW + SG), y));
      // From the trunk to the partner (a ring where they join), and on from the partner to
      // their children.
      line([trunk, lastY, trunk, y + NH / 2], [trunk, y + NH / 2, x0, y + NH / 2]);
      rings.push([trunk, y + NH / 2, pen.col]);
      if (g.kids.length) {
        const from = g.q ? x0 + NW : trunk;
        line([from, y + NH / 2, cx0 + (g.kids.length - 1) * (NW + SG), y + NH / 2]);
      }
      lastY = y + NH / 2;
    });
  }
  pen = { col: PLAIN_COL, dash: false };
  // The parents, centred over their children (wide apart if both have parents of their own).
  const genXs = gen.map((p) => xs.get(p.id)!);
  // (Over the full brothers and sisters: the half ones hang off to the side, from the parent
  // they share, so no line crosses another.)
  const fullXs = gen.filter((p) => !half.has(p.id)).map((p) => xs.get(p.id)!);
  const genMid = (Math.min(...fullXs) + Math.max(...fullXs) + NW) / 2;
  const upper = !!parents.length;
  if (parents.length) {
    const wide = parents.length === 2 && parents.every((p) => parentsOf(p).length || p.founder);
    const gap = wide ? NW + CG + SG + 4 : CG;
    const px = parents.length === 2 ? [genMid - gap / 2 - NW, genMid + gap / 2] : [genMid - NW / 2];
    parents.forEach((p, i) => person(p, px[i], py));
    if (parents.length === 2) couple(px[0], px[1], py);
    // Full brothers and sisters from the couple; half ones, dashed, from the parent they share.
    const full = gen.filter((p) => !half.has(p.id));
    descend(genMid, parents.length === 2 ? py + NH / 2 : py + NH, full.map((p) => xs.get(p.id)!), sy);
    parents.forEach((par, i) => {
      const hs = gen.filter((p) => half.has(p.id) && p.parents?.includes(par.id));
      if (!hs.length) return;
      pen = { col: PLAIN_COL, dash: true };
      descend(px[i] + NW / 2, py + NH, hs.map((p) => xs.get(p.id)!), sy, 7 + i * 5);
      pen = { col: PLAIN_COL, dash: false };
    });
    // Grandparents: each parent's couple over them (or, for the four, the line: once, over
    // both if both crossed).
    const bothCrossed = parents.length === 2 && parents.every((p) => p.founder);
    if (bothCrossed) {
      other(`${miniIcon(s.look, 2)}<b>The line</b><i>${state.stages.creature.generation} gens</i>`, genMid - NW / 2, gy, 'data-treeline="1"');
      line([genMid, gy + NH, genMid, py + NH / 2]);
    }
    parents.forEach((p, i) => {
      if (bothCrossed) return;
      const gp = parentsOf(p);
      const over = px[i] + NW / 2;
      if (gp.length) {
        const gx = gp.length === 2 ? [over - CG / 2 - NW, over + CG / 2] : [over - NW / 2];
        gp.forEach((g, j) => person(g, gx[j], gy));
        if (gp.length === 2) couple(gx[0], gx[1], gy);
        descend(over, gp.length === 2 ? gy + NH / 2 : gy + NH, [px[i]], py);
      } else if (p.founder) {
        other(`${miniIcon(s.look, 2)}<b>The line</b><i>${state.stages.creature.generation} gens</i>`, over - NW / 2, gy, 'data-treeline="1"');
        descend(over, gy + NH, [px[i]], py);
      }
    });
  } else {
    // No parents here: the four came of the line; those who joined, of their clan.
    const label = me.founder ? `${miniIcon(s.look, 2)}<b>The line</b><i>${state.stages.creature.generation} gens</i>` : `<b>${kind ? cap(kind) : 'Not recorded'}</b><i>${kind ? 'their clan' : 'before trees'}</i>`;
    other(label, genMid - NW / 2, py, me.founder ? 'data-treeline="1"' : '');
    descend(genMid, py + NH, genXs, sy);
  }
  // Fitted to its boxes: rows with nothing in them taken out from the top.
  const top = upper && boxes.some((b) => b.y === gy) ? gy : py;
  const minX = Math.min(...boxes.map((b) => b.x)) - 6;
  const maxX = Math.max(...boxes.map((b) => b.x)) + NW + 6;
  const maxY = Math.max(...boxes.map((b) => b.y)) + NH + 4;
  const w = maxX - minX;
  const h = maxY - top;
  const shift = (html: string, b: Box) => html.replace(`left:${b.x}px;top:${b.y}px`, `left:${b.x - minX}px;top:${b.y - top}px`);
  const svg = `<svg class="chart-lines" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${lines.map(([a, b2, c, d, col, dash]) => `<line x1="${a - minX}" y1="${b2 - top}" x2="${c - minX}" y2="${d - top}" style="stroke:${col}"${dash ? ' stroke-dasharray="4 3"' : ''}/>`).join('')}${rings.map(([cx, cy, col]) => `<circle cx="${cx - minX}" cy="${cy - top}" r="3.5" style="stroke:${col === PLAIN_COL ? '#e8c050' : col}"/>`).join('')}</svg>`;
  const role = me.id === s.chief ? 'Chief' : me.moved ? `Lives with ${me.moved} now` : me.founder ? 'One of the four who crossed' : kind ? `Of ${kind}` : me.died !== undefined ? 'Remembered' : 'Born on New Shore';
  return `<p class="label dim">Family tree</p>
    <div class="tree-me">${miniIcon(lookOf(s, me), 5)}<div><h3>${me.name}</h3><p class="tiny">${role} · ${describe(me.genes)}</p><p class="tiny dim">${life(me)}</p></div></div>
    <div class="chart-wrap"><div class="chart" style="width:${w}px;height:${h}px">${svg}${boxes.map((b) => shift(b.html, b)).join('')}</div></div>
    ${partners.length > 1 || half.size ? `<p class="tiny dim">${partners.length > 1 ? 'Each colour is one couple and the children they had. ' : ''}${half.size ? 'Dashed: half brothers and sisters (one parent in common).' : ''}</p>` : ''}
    <p class="tiny dim">Tap anyone to see their tree. ${kids.length ? '' : me.died === undefined ? 'No children yet.' : ''}</p>
    <div class="choices">${back ? '<button class="px-btn" data-treeback="1">‹ Back</button>' : ''}<button class="px-btn gold" data-act="dismiss">Close</button></div>`;
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
export function lineTree(state: GameState, back = false): string {
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
    <div class="choices">${back ? '<button class="px-btn" data-treeback="1">‹ Back</button>' : ''}<button class="px-btn gold" data-act="dismiss">Close</button></div>`;
}
