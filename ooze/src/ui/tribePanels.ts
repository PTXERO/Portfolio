// The Extinction's panels: the Survivors (food, rations, who does what, and who's left) and
// the Ideas the spear can teach.

import { STORY } from '../content/tribal';
import { count, dayYield, eatsMeat, eatsPlants, hungerWord, ideaCost, JOBS, jobOpen, TRAITS, type Diet, type ExtinctionState } from '../economy/extinction';
import { BRANCHES, MIND_NODE, MIND_TREE, reachable } from '../economy/mindTree';
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
  return JSON.stringify([ex.day, ex.people.map((p) => [p.id, p.job, Math.round(p.hunger * 4)]), Math.floor(ex.plants), Math.floor(ex.meat), Math.floor(ex.insight), ex.ration, ex.ideas, ex.diet, ex.over, picked]);
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
  return [storesCard(ex), rationCard(ex), jobsCard(ex), peopleCard(ex)].join('');
}

function storesCard(ex: ExtinctionState): string {
  const plants = eatsPlants(ex.diet);
  const meat = eatsMeat(ex.diet);
  const y = dayYield(ex);
  const cell = (name: string, have: number, gain: number, eats: boolean, note: string) =>
    `<div class="store${eats ? '' : ' off'}"><span class="label dim">${name}</span><b class="num">${n0(have)}</b><span class="dim">+${n0(gain)} today${eats ? '' : ' · inedible'}</span><span class="tiny dim">${note}</span></div>`;
  return `<div class="panel-head"><h2>Survivors</h2><span class="dim">${ex.people.length} alive · ${ex.deaths} dead</span></div>
    <div class="card px-box ex-stores">
      ${cell('Plants', ex.plants, y.forage + y.dig, plants, 'keeps')}
      ${cell('Meat', ex.meat, y.scavenge + y.fish, meat, ex.ideas.includes('racks') ? 'dried, keeps' : 'rots overnight')}
      ${cell('Insight', ex.insight, y.listen, true, 'for ideas')}
      <div class="sub diet">${DIET_LINE[ex.diet]} Each eats ${ex.ration === 1 ? 'a full meal' : ex.ration === 0.5 ? 'half a meal' : 'a quarter meal'} at night: ${n0(ex.people.length * ex.ration)} wanted.</div>
    </div>`;
}

function rationCard(ex: ExtinctionState): string {
  const opt = (v: number, label: string) => `<button class="px-btn${ex.ration === v ? ' on' : ''}" data-ration="${v}">${label}</button>`;
  return `<div class="card px-box opts"><div class="info"><div class="name">Rations</div>
    <div class="sub">Less food a night stretches it further, but hunger still builds, and the hungry work worse.</div>
    <div class="policy">${opt(1, 'Full')}${opt(0.5, 'Half')}${opt(0.25, 'Quarter')}</div></div></div>`;
}

function jobsCard(ex: ExtinctionState): string {
  const y = dayYield(ex);
  const unit: Record<string, string> = { forage: 'plants', dig: 'plants', scavenge: 'meat', fish: 'meat', listen: 'insight' };
  const rows = JOBS.filter((j) => j.id !== 'rest' && jobOpen(ex, j.id))
    .map((j) => {
      const c = count(ex, j.id);
      const left = j.id === 'forage' ? ` · ${n0(ex.ash)} left` : j.id === 'scavenge' ? ` · ${n0(ex.carrion)} left` : '';
      return `<div class="job"><div class="info"><div class="name">${j.name}</div><div class="sub">${j.does}</div>
        <div class="sub gain">${c ? `+${n0(y[j.id])} ${unit[j.id]} a day` : unit[j.id]}${left}</div></div>
        <div class="seg"><button class="px-btn" data-job="${j.id}" data-d="-5">−5</button><button class="px-btn" data-job="${j.id}" data-d="-1">−</button><b class="num">${c}</b><button class="px-btn" data-job="${j.id}" data-d="1">+</button><button class="px-btn" data-job="${j.id}" data-d="5">+5</button></div></div>`;
    })
    .join('');
  return `<div class="card px-box ex-jobs"><div class="info"><div class="name">Work</div>
    <div class="sub">${count(ex, 'rest')} resting (hunger comes on a little slower).</div></div>${rows}</div>`;
}

function peopleCard(ex: ExtinctionState): string {
  const rows = [...ex.people]
    .sort((a, b) => b.hunger - a.hunger)
    .map((p) => {
      const w = hungerWord(ex, p);
      return `<div class="person ${w.toLowerCase()}"><b>${p.name}</b><span class="dim">${TRAITS[p.trait].name}</span><span class="dim">${JOBS.find((j) => j.id === p.job)!.name.split(' ')[0]}</span><span class="hunger">${w}</span></div>`;
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
  for (const n of MIND_TREE) {
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
  const n = MIND_NODE[picked];
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
