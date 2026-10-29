// The Extinction's panels: the Survivors (food, rations, who does what, and who's left) and
// the Ideas the spear can teach.

import { STORY } from '../content/tribal';
import { count, dayYield, eatsMeat, eatsPlants, FAMILY, hungerWord, ideaCost, jobFood, jobInfo, JOBS, jobOpen, launchBlockers, provisions, RAFT, raftDone, raftPart, seasonOf, TRAITS, VOYAGE_FOOD, WINTER, type Diet, type ExtinctionState } from '../economy/extinction';
import { BRANCHES, MIND_NODE, MIND_TREE, nodeFor, reachable } from '../economy/mindTree';
import { DREAD_COWER, DREAD_FLEE, ORDAIN_AFTER, PRAYER_MAX, spellsFor, type Gesture } from '../economy/miracles';
import { tribeOf } from '../economy/tribal';
import type { GameState } from '../economy/types';

const DIET_LINE: Record<Diet, string> = {
  herbivore: 'Your kind eat only plants.',
  carnivore: 'Your kind eat only meat.',
  omnivore: 'Your kind eat plants and meat.',
  cannibal: 'Your kind eat meat. And their dead.',
};

const n0 = (v: number) => String(Math.floor(v + 1e-6));

/** Changes whenever what the panels show changes (rounded, so it isn't every frame). */
export function tribeKey(state: GameState): string {
  const t = tribeOf(state);
  const ex = t?.ex;
  if (!ex) return JSON.stringify([t?.awake]);
  return JSON.stringify([ex.day, ex.people.map((p) => [p.id, p.job, Math.round(p.hunger * 4)]), Math.floor(ex.plants), Math.floor(ex.meat), Math.floor(ex.insight), ex.ration, ex.ideas, ex.diet, ex.over, picked, Math.floor(ex.wood ?? 0), ex.raft, ex.family, ex.escaped, ex.people.map((p) => p.sick), ex.auto, ex.focus, Math.floor(ex.prayer ?? 0), Math.floor(ex.dread ?? 0), ex.powers, ex.casts, ex.ordained, ex.log?.length]);
}

export function tribeLayout(state: GameState): string {
  const t = tribeOf(state);
  if (!t) return '';
  const ex = t.ex;
  if (!ex) {
    return `<div class="panel-head"><h2>Survivors</h2></div>
      <div class="card px-box"><div class="info"><div class="name">${t.survivors} of the herd lived</div>
      <div class="sub">${t.awake ? STORY.wakeSub : STORY.approach}</div></div></div>`;
  }
  return [storesCard(ex), chronicleCard(ex), workCard(ex), raftCard(ex), peopleCard(ex)].join('');
}

function storesCard(ex: ExtinctionState): string {
  const plants = eatsPlants(ex.diet);
  const meat = eatsMeat(ex.diet);
  const y = dayYield(ex);
  const gain = (f: 'plants' | 'meat') => (['forage', 'scavenge', 'dig', 'fish'] as const).reduce((a, j) => a + (jobFood(ex.diet, j) === f ? y[j] : 0), 0);
  const cell = (name: string, have: number, gain: number, eats: boolean, note: string) =>
    `<div class="store${eats ? '' : ' off'}"><span class="label dim">${name}</span><b class="num">${n0(have)}</b><span class="dim">+${n0(gain)} today${eats ? '' : ' · inedible'}</span><span class="tiny dim">${note}</span></div>`;
  return `<div class="panel-head"><h2>Survivors</h2><span class="dim">${ex.people.length} alive · ${ex.deaths} dead</span></div>
    <div class="card px-box ex-stores">
      ${cell('Plants', ex.plants, gain('plants'), plants, 'keeps')}
      ${cell('Meat', ex.meat, gain('meat'), meat, ex.ideas.includes('racks') && meat ? 'dried, keeps' : 'rots overnight')}
      ${cell('Wood', ex.wood ?? 0, y.wood, true, ex.ideas.includes('fire') ? 'fire burns 2 a night' : 'for the raft')}
      ${cell('Insight', ex.insight, y.listen, true, 'for ideas')}
      <div class="sub diet">${seasonLine(ex)}${DIET_LINE[ex.diet]} Each eats ${ex.ration === 1 ? 'a full meal' : ex.ration === 0.5 ? 'half a meal' : 'a quarter meal'} at night: ${n0(ex.people.length * ex.ration)} wanted.</div>
    </div>`;
}

function seasonLine(ex: ExtinctionState): string {
  const s = seasonOf(ex);
  if (s === 'winter') return `<b class="winter">The ash winter: gathering is poor, and nights are cold without a fire (until day ${WINTER[1] + 1}).</b> `;
  if (s === 'green') return '<b class="green">The first green: the ash grows back a little each day.</b> ';
  return '';
}

/** What they're doing today (their own choice): read only. */
function workCard(ex: ExtinctionState): string {
  const y = dayYield(ex);
  const unit = (id: (typeof JOBS)[number]['id']) => jobFood(ex.diet, id) ?? (id === 'wood' ? 'wood' : id === 'build' ? 'work on the raft' : 'insight');
  const rows = JOBS.filter((j) => j.id !== 'rest' && jobOpen(ex, j.id))
    .map((plain) => {
      const j = jobInfo(ex.diet, plain.id);
      const c = count(ex, j.id);
      if (!c) return '';
      const left = j.id === 'forage' ? ` · ${n0(ex.ash)} left` : j.id === 'scavenge' ? ` · ${n0(ex.carrion)} left` : j.id === 'wood' ? ` · ${n0(ex.trees ?? 0)} left` : j.id === 'build' ? ` · ${raftPart(ex)?.name ?? ''}` : '';
      return `<div class="job auto"><div class="info"><div class="name">${j.name}</div><div class="sub gain">+${n0(y[j.id])} ${unit(j.id)} a day${left}</div></div><b class="num">${c}</b></div>`;
    })
    .join('');
  const rest = count(ex, 'rest');
  return `<div class="card px-box ex-jobs"><div class="info"><div class="name">What they're doing</div>
    <div class="sub">They decide for themselves: food first, then ${ex.focus === 'raft' ? 'the raft' : ex.focus === 'wood' ? 'wood' : 'listening to the spear'}.${rest ? ` ${rest} resting.` : ''}</div></div>${rows}</div>`;
}

/** The Chronicle: what they did, and why, newest first. */
function chronicleCard(ex: ExtinctionState): string {
  const lines = [...(ex.log ?? [])].reverse().slice(0, 10).map((l, i) => `<p class="${i ? '' : 'now'}"><span class="dim">Day ${l.day}.</span> ${l.text}</p>`).join('');
  return `<div class="card px-box chronicle"><div class="info"><div class="name">The Chronicle</div>${lines}</div></div>`;
}

/** The raft: each part's progress, then (once it's done) the four who go, and the food. */
function raftCard(ex: ExtinctionState): string {
  const parts = RAFT.map((p) => {
    const done = Math.min(p.work, ex.raft?.[p.id] ?? 0);
    const blocked = p.needs && !ex.ideas.includes(p.needs) && done < p.work;
    return `<div class="raft-part"><span>${p.name}</span><div class="meter"><i style="width:${(done / p.work) * 100}%"></i></div><span class="dim tiny">${done >= p.work ? 'done' : blocked ? 'needs Rope (an idea)' : `${n0(done)}/${p.work} · ${p.wood} wood`}</span></div>`;
  }).join('');
  const ready = raftDone(ex);
  const blockers = launchBlockers(ex);
  const tail = ready
    ? `<div class="sub">It carries ${FAMILY}. They'll choose who goes and set off once there's ${VOYAGE_FOOD} food for the crossing (${n0(provisions(ex))} now).</div>
       ${blockers.length ? `<div class="sub warn">${blockers.filter((b) => !b.startsWith('Choose')).join(' ')}</div>` : ''}`
    : '<div class="sub">The way off this island. They\'ll build it when they can spare the hands; it takes wood.</div>';
  return `<div class="card px-box ex-raft"><div class="info"><div class="name">The raft</div>${tail}</div>${parts}</div>`;
}

function peopleCard(ex: ExtinctionState): string {
  const fam = ex.family ?? [];
  const rows = [...ex.people]
    .sort((a, b) => b.hunger - a.hunger)
    .map((p) => {
      const w = hungerWord(ex, p);
      const chosen = fam.includes(p.id);
      const inner = `<b>${chosen ? '» ' : ''}${p.name}</b><span class="dim">${TRAITS[p.trait].name}</span><span class="dim">${jobInfo(ex.diet, p.job).name.split(' ')[0]}</span><span class="hunger">${w}</span>`;
      return `<div class="person ${w.toLowerCase()}">${inner}</div>`;
    })
    .join('');
  return `<div class="card px-box ex-people"><div class="info"><div class="name">Who's left</div><div class="sub">Hungriest first. They eat in that order too.</div></div>${rows}</div>`;
}

/** The idea picked in the web (shown in the card under it). */
let picked = '';
export function pickIdea(id: string): void {
  picked = picked === id ? '' : id;
}

const KIND_NAME = { start: 'Where it began', minor: 'Idea', notable: 'Great idea', keystone: 'Keystone' };

/** The web's art grid: G pixels across, drawn as crisp squares (the game's pixel look). */
const G = 128;
const gx = (x: number) => Math.round(((x + 112) / 224) * (G - 1));
const at = (v: number) => `${((v + 0.5) / G) * 100}%`;

/** Node sprites, '#' border, 'o' fill (lit when known), centred on the node. */
const SPRITE: Record<string, string[]> = {
  minor: ['.###.', '#ooo#', '#ooo#', '#ooo#', '.###.'],
  notable: ['..###..', '.##o##.', '##ooo##', '#ooooo#', '##ooo##', '.##o##.', '..###..'],
  keystone: ['....#....', '...#o#...', '..#ooo#..', '.#ooooo#.', '#ooooooo#', '.#ooooo#.', '..#ooo#..', '...#o#...', '....#....'],
  start: ['#...#...#', '.#..#..#.', '..#ooo#..', '..ooooo..', '##ooooo##', '..ooooo..', '..#ooo#..', '.#..#..#.', '#...#...#'],
};
const COL = { dim: '#3a4460', near: '#7fe0b0', lit: '#f5c45e', litHi: '#ffe39a', hole: '#141a28', open: '#7fe0b0', afford: '#c4f7dd', locked: '#4a5470', picked: '#f2ead7' };

export function ideasLayout(state: GameState): string {
  const ex = tribeOf(state)?.ex;
  if (!ex) return '';
  const known = (id: string) => id === 'mind0' || ex.ideas.includes(id);
  // Pixels by colour, each colour one path (a pixel is "M x y h1v1h-1z").
  const px = new Map<string, Map<number, true>>();
  const put = (col: string, x: number, y: number, cls = '') => {
    if (x < 0 || y < 0 || x >= G || y >= G) return;
    const k = `${col}|${cls}`;
    if (!px.has(k)) px.set(k, new Map());
    px.get(k)!.set(y * G + x, true);
  };
  // The links: stepped pixel lines, lit between known ideas, broken toward ones in reach.
  const seen = new Set<string>();
  for (const n of MIND_TREE) {
    for (const l of n.links) {
      if (seen.has(`${l}|${n.id}`)) continue;
      seen.add(`${n.id}|${l}`);
      const o = MIND_NODE[l];
      const kind = known(n.id) && known(o.id) ? 'lit' : known(n.id) || known(o.id) ? 'near' : 'dim';
      const x0 = gx(n.x), y0 = gx(n.y), x1 = gx(o.x), y1 = gx(o.y);
      const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
      for (let i = 0; i <= steps; i++) {
        if (kind === 'near' && i % 3 === 2) continue;
        put(COL[kind], Math.round(x0 + ((x1 - x0) * i) / steps), Math.round(y0 + ((y1 - y0) * i) / steps));
      }
    }
  }
  // The ideas, drawn over their links.
  const buttons: string[] = [];
  for (const plain of MIND_TREE) {
    const n = nodeFor(plain.id, ex.diet);
    const k = known(n.id);
    const open = !k && reachable(ex.ideas, n.id);
    const afford = open && ex.insight >= ideaCost(state, n.id);
    const sp = SPRITE[n.kind];
    const h = Math.floor(sp.length / 2);
    const cx = gx(n.x), cy = gx(n.y);
    const edge = k ? COL.litHi : afford ? COL.afford : open ? COL.open : COL.locked;
    const fill = k ? COL.lit : COL.hole;
    sp.forEach((row, ry) => {
      for (let rx = 0; rx < row.length; rx++) {
        const c = row[rx];
        if (c === '.') continue;
        put(c === '#' ? edge : fill, cx - h + rx, cy - h + ry, c === '#' && afford ? 'blink' : '');
      }
    });
    // The picked idea: four pixel corners round it.
    if (picked === n.id) {
      const r = h + 2;
      for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        put(COL.picked, cx + sx * r, cy + sy * r);
        put(COL.picked, cx + sx * (r - 1), cy + sy * r);
        put(COL.picked, cx + sx * r, cy + sy * (r - 1));
      }
    }
    const size = ((sp.length + 4) / G) * 100;
    buttons.push(`<button class="tn" style="left:${at(cx)};top:${at(cy)};width:${size}%;height:${size}%" data-node="${n.id}" aria-label="${n.name}"></button>`);
    // Great ideas named below, keystones above (so neighbours' names don't run together).
    if (n.kind === 'notable') buttons.push(`<span class="tl${k ? ' known' : ''}" style="left:${at(cx)};top:${at(cy + h + 1)}">${n.name}</span>`);
    if (n.kind === 'keystone') buttons.push(`<span class="tl up${k ? ' known' : ''}" style="left:${at(cx)};top:${at(cy - h - 1)}">${n.name}</span>`);
  }
  const paths = [...px.entries()]
    .map(([key, cells]) => {
      const [col, cls] = key.split('|');
      const d = [...cells.keys()].map((i) => `M${i % G} ${Math.floor(i / G)}h1v1h-1z`).join('');
      return `<path fill="${col}"${cls ? ` class="${cls}"` : ''} d="${d}"/>`;
    })
    .join('');
  const names = BRANCHES.map((b) => {
    const x = gx(Math.cos((b.angle * Math.PI) / 180) * 106);
    const y = gx(Math.sin((b.angle * Math.PI) / 180) * 106);
    return `<span class="tb" style="left:${at(x)};top:${at(y)}">${b.name}</span>`;
  }).join('');
  return `<div class="panel-head"><h2>Ideas</h2><span class="dim">${n0(ex.insight)} insight</span></div>
    <div class="mind-tree"><svg viewBox="0 0 ${G} ${G}" shape-rendering="crispEdges" aria-hidden="true">${paths}</svg>${names}${buttons.join('')}</div>
    ${pickedCard(state, ex)}`;
}

function pickedCard(state: GameState, ex: ExtinctionState): string {
  const n = MIND_NODE[picked] && nodeFor(picked, ex.diet);
  if (!n) return '<p class="note">Tap an idea in the web. Ideas are learned outward from the middle, each next to one already known. There are far more than one life can learn.</p>';
  const known = n.id === 'mind0' || ex.ideas.includes(n.id);
  const open = reachable(ex.ideas, n.id);
  const cost = ideaCost(state, n.id);
  const remembered = (tribeOf(state)?.remembered ?? []).includes(n.id);
  const btn = known
    ? '<span class="label dim">Known</span>'
    : open
      ? `<button class="px-btn${ex.insight >= cost ? ' gold' : ''}" data-learn="${n.id}"${ex.insight >= cost ? '' : ' disabled'}>Learn · ${cost} insight</button>`
      : '<span class="label dim">Out of reach</span>';
  return `<div class="card px-box idea-card ${n.kind}"><div class="info"><div class="label dim">${KIND_NAME[n.kind]}${n.branch ? ` · ${BRANCHES.find((b) => b.id === n.branch)!.name}` : ''}</div>
    <div class="name">${n.name}</div><div class="sub">${n.does}</div>
    ${remembered && !known ? '<div class="sub tiny gold">The spear remembers: half the insight.</div>' : ''}</div>${btn}</div>`;
}

/** A miracle's shape, drawn in pixels (how to draw it). */
export function glyph(g: Gesture, scale = 3): string {
  const M: Record<Gesture, string[]> = {
    zigzag: ['#.......', '##......', '.##..#..', '..####..', '..#..##.', '.....##.', '......##', '.......#'],
    spiral: ['.#####..', '#.....#.', '#.###.#.', '#.#.#.#.', '#.#...#.', '#..###..', '#.......', '.######.'],
    circle: ['..####..', '.#....#.', '#......#', '#......#', '#......#', '#......#', '.#....#.', '..####..'],
    line: ['........', '........', '......#.', '.......#', '########', '.......#', '......#.', '........'],
  };
  const rects = M[g].flatMap((row, y) => [...row].map((c, x) => (c === '#' ? `<rect x="${x}" y="${y}" width="1" height="1"/>` : ''))).join('');
  return `<svg class="glyph" viewBox="0 0 8 8" width="${8 * scale}" height="${8 * scale}" shape-rendering="crispEdges" fill="currentColor">${rects}</svg>`;
}

export function spellsLayout(state: GameState): string {
  const ex = tribeOf(state)?.ex;
  if (!ex) return '';
  const prayer = ex.prayer ?? 0;
  const dread = ex.dread ?? 0;
  const known = ex.powers ?? [];
  const cards = spellsFor(ex.diet)
    .map((sp) => {
      if (!known.includes(sp.id)) return `<div class="card px-box spell unknown"><div class="glyph-box">?</div><div class="info"><div class="name">???</div><div class="sub">${sp.hint}</div></div></div>`;
      const casts = ex.casts?.[sp.id] ?? 0;
      const ordained = (ex.ordained ?? []).includes(sp.id);
      const ord = casts >= ORDAIN_AFTER
        ? `<button class="px-btn small${ordained ? ' on' : ''}" data-ordain="${sp.id}">${ordained ? 'Ordained' : 'Ordain'}</button>`
        : `<span class="tiny dim">Ordain after ${ORDAIN_AFTER} casts (${casts})</span>`;
      return `<div class="card px-box spell${ordained ? ' ordained' : ''}"><div class="glyph-box">${glyph(sp.gesture)}</div><div class="info"><div class="name">${sp.name}</div>
        <div class="sub">${sp.does}</div><div class="sub tiny gold">${sp.how}</div>
        <div class="spell-row">${ord}</div></div>
        <button class="px-btn${prayer >= sp.cost ? ' gold' : ''}" data-cast="${sp.id}"${prayer >= sp.cost ? '' : ' disabled'}>Cast · ${sp.cost}</button></div>`;
    })
    .join('');
  return `<div class="panel-head"><h2>Miracles</h2><span class="dim">${n0(prayer)} / ${PRAYER_MAX} prayer</span></div>
    <div class="card px-box dread"><div class="info"><div class="name">Dread <span class="dim">${n0(dread)}</span></div>
    <div class="meter"><i style="width:${dread}%"></i><b style="left:${DREAD_COWER}%"></b><b style="left:${DREAD_FLEE}%"></b></div>
    <div class="sub">Every miracle frightens them. Past ${DREAD_COWER} they cower from the spear and work less; past ${DREAD_FLEE}, some walk into the sea to get away from it. It fades a little each night.</div></div></div>
    ${cards}
    <p class="note">Ordained miracles the spear works by itself, when they're needed, for half again the prayer.</p>`;
}
