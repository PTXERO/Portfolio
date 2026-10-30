// New Shore's panels: the Village (stores, who's working at what, the people), Build (by sort:
// homes, stores, work, exploring) and the Island (the villages found out there, and the scouts).

import { BUILD_CATS, BUILDS, buildName, POI_SORT, RELICS, type BuildCat, type BuildDef, type BuildId, type Find } from '../content/shore';
import { buildCost, buildsOpen, canWin, roomLeft, vassalDay, learned, poiDef, poiHere, poiName, poisOf, type Poi, RAFT_WOOD, chiefNear, count, foodCap, giftCost, shoreSeason, isAdult, relation, room, shoreOf, woodCap, workPlan, type Lean, type ShoreState, type Village } from '../economy/shore';
import { miniIcon } from '../scene/creatureLook';
import { DAY_SEC, type ShorePerson } from '../economy/shore';
import type { GameState } from '../economy/types';

const n0 = (v: number) => String(Math.floor(v + 1e-6));

const REL_LINE = {
  kin: 'Your own diet: they could be won over.',
  prey: 'They eat what you hunt, or are what you hunt: yours to raid.',
  predator: 'They hunt your kind. Expect them to come.',
  enemy: 'Enemies. Nothing will ever change that.',
} as const;
const REL_NAME = { kin: 'Kin', prey: 'Prey', predator: 'Predators', enemy: 'Enemies' } as const;
const WHERE: Record<string, string> = {
  river: 'They live along the river, in huts up on stilts.',
  lake: 'They live by the lake, their huts up on stilts at the water.',
  desert: 'They live out in the desert, in low tents of hide.',
  scrub: 'They live in the dry scrub country.',
  forest: 'They live deep in the woods, in domes of bark and leaves.',
  meadow: 'They live out on the open grass.',
  mountain: 'They live up in the hills, in huts of stone.',
  coast: 'They live on the shore, in shelters of driftwood.',
  marsh: 'They live in the marsh, among the reeds.',
};
const DIET_NAME: Record<string, string> = { grazer: 'Grazers', hunter: 'Hunters', omnivore: 'Omnivores' };

/** The Village tab: the village itself, or everyone in it. */
let villageView: 'village' | 'people' = 'village';
export function setVillageView(v: string): void {
  villageView = v === 'people' ? 'people' : 'village';
}

/** The Build tab's sort on show (kept while you're in the stage). */
let buildCat: BuildCat = 'homes';
export function setBuildCat(c: string): void {
  if (BUILD_CATS.some((x) => x.id === c)) buildCat = c as BuildCat;
}

/** When a tab's panel must be rebuilt (its numbers are written in place by shoreUpdate). */
export function shoreKey(state: GameState, tab: string): string {
  const s = shoreOf(state);
  if (!s) return '';
  if (tab === 'build') return JSON.stringify([s.building?.id, s.learned, buildCat, s.raftTaken, s.built.length, buildsOpen(s).map((b) => [b.id, s.wood >= buildCost(s, b.id)])]);
  if (tab === 'island') return JSON.stringify([s.relics, poisOf(s).map((p) => (p.found && p.known ? p.done : -1)), poiHere(s)?.id, count(s, 'scout'), s.villages.filter((v) => v.found).map((v) => [v.id, v.joined, v.gone, v.asking, v.waiting !== undefined && roomLeft(s), v.vassal && [v.vassal.tax, Math.floor(v.vassal.loyalty / 5), Math.floor(v.pop)], Math.floor((v.trust ?? 0) / 5), s.food >= giftCost(v)]), s.chief]);
  const plan = workPlan(s);
  if (villageView === 'people') return JSON.stringify(['people', s.people.length, s.chief, Math.floor(s.day / 2), s.hungry]);
  return JSON.stringify([s.hungry, shoreSeason(s).si, s.people.length, s.built.length, s.lean, plan.food, plan.wood, s.chief, s.people.filter((p) => isAdult(s, p)).length, s.people.filter((p) => p.founder).length]);
}

export function shoreUpdate(root: HTMLElement, state: GameState): void {
  const s = shoreOf(state);
  if (!s) return;
  const put = (k: string, v: string) => {
    const el = root.querySelector<HTMLElement>(`[data-t="${k}"]`);
    if (el && el.textContent !== v) el.textContent = v;
  };
  put('shore-food', n0(s.food));
  if (s.building) {
    put('build-left', `${Math.ceil(s.building.left)}s`);
    const bar = root.querySelector<HTMLElement>('[data-bar="building"] > i');
    if (bar) bar.style.width = `${Math.round((1 - s.building.left / s.building.total) * 100)}%`;
  }
  put('shore-wood', n0(s.wood));
  const birth = birthLine(s);
  put('shore-birth', birth);
}

const SEASONS = ['Spring', 'Summer', 'Autumn', 'Winter'];
function seasonLine(s: ShoreState): string {
  const { si } = shoreSeason(s);
  if (si === 3) return '<b class="winter">Winter: food comes in slower.</b> ';
  if (si === 2) return '<b class="green">Autumn: a good harvest.</b> ';
  return `${SEASONS[si]}. `;
}

function birthLine(s: ShoreState): string {
  if (!count(s, 'hearth')) return 'No children are born without a hearth.';
  if (s.people.length >= room(s)) return 'No room for children: build a hut.';
  if (s.food < 8) return 'Not enough food to spare for a child.';
  if (s.people.filter((p) => isAdult(s, p)).length < 2) return 'Waiting for the children to grow up.';
  return 'A child is on the way.';
}

export function shoreLayout(state: GameState, tab: string): string {
  const s = shoreOf(state);
  if (!s) return '';
  if (tab === 'build') return buildLayout(s);
  if (tab === 'island') return islandLayout(s);
  const views = `<div class="seg build-cats"><button class="px-btn${villageView === 'village' ? ' on' : ''}" data-villageview="village">The village</button><button class="px-btn${villageView === 'people' ? ' on' : ''}" data-villageview="people">People · ${s.people.length}</button></div>`;
  if (villageView === 'people') return views + peopleLayout(s);
  return views + storesCard(s) + workCard(s) + peopleCard(s);
}

/** Whether a sort of building has anything in it yet (built, or to build). */
function catShown(s: ShoreState, c: BuildCat): boolean {
  return BUILDS.some((b) => b.cat === c && (count(s, b.id) > 0 || buildsOpen(s).includes(b) || teaser(s, b)));
}

/** A building still to be learned out on the island, shown so there's a reason to go and look
 * (once what it follows is built). */
function teaser(s: ShoreState, b: BuildDef): boolean {
  return !!b.learn && !learned(s, b.id) && (!b.after || count(s, b.after) > 0);
}

function storesCard(s: ShoreState): string {
  const plan = workPlan(s);
  const net = plan.foodRate - plan.eat;
  const cell = (key: string, name: string, have: number, cap: number, gain: string) => `<div class="store"><span class="label dim">${name}</span><b class="num"><span data-t="shore-${key}">${n0(have)}</span><span class="dim">/${cap}</span></b><span class="dim">${gain}</span></div>`;
  return `<div class="panel-head"><h2>The Village</h2><span class="dim">${s.people.length} people</span></div>
    <div class="card px-box ex-stores shore-stores">
      ${cell('food', 'Food', s.food, foodCap(s), `${net >= 0 ? '+' : ''}${n0(net)} a day`)}
      ${cell('wood', 'Wood', s.wood, woodCap(s), `+${n0(plan.woodRate)} a day`)}
      <div class="store"><span class="label dim">People</span><b class="num">${s.people.length}<span class="dim">/${room(s)}</span></b><span class="dim">room</span></div>
      <div class="sub diet">${s.hungry ? `<b class="starving">Starving: not enough food for everyone. ${s.hungry >= 2 ? 'People are dying.' : 'Soon people will die.'}</b> ` : ''}${seasonLine(s)}<span data-t="shore-birth">${birthLine(s)}</span></div>
    </div>`;
}

const LEANS: { id: Lean; name: string }[] = [
  { id: 'food', name: 'Food' },
  { id: 'balanced', name: 'Balanced' },
  { id: 'wood', name: 'Wood' },
];

function workCard(s: ShoreState): string {
  const plan = workPlan(s);
  const kids = s.people.length - plan.food - plan.wood;
  if (!count(s, 'hearth')) {
    return `<div class="card px-box"><div class="info"><div class="name">No village yet</div>
      <div class="sub">They sit by the raft, living on what the crossing left them. Nothing's gathered until there's a hearth: break up the raft for its wood, and build one.</div></div></div>`;
  }
  return `<div class="card px-box lean"><div class="info"><div class="name">What they work at</div>
    <div class="sub">${plan.food} gathering food, ${plan.wood} cutting wood${kids > 0 ? `, ${kids} too young` : ''}. They work it out for themselves; you set what they lean toward.</div>
    <div class="sub${plan.food > plan.land ? ' starving' : ' dim'}">The land round the village feeds ${plan.land} gatherers${plan.food > plan.land ? `: ${plan.food - plan.land} more than it can, and they find little` : ''}. Gathering camps and weirs let it feed more.</div></div>
    <div class="seg">${LEANS.map((l) => `<button class="px-btn${s.lean === l.id ? ' gold' : ''}" data-lean="${l.id}">${l.name}</button>`).join('')}</div></div>`;
}

function buildLayout(s: ShoreState): string {
  const open = buildsOpen(s);
  const cats = BUILD_CATS.filter((c) => catShown(s, c.id));
  if (!cats.some((c) => c.id === buildCat)) buildCat = cats[0]?.id ?? 'homes';
  // A dot on a sort with something in it you can build now.
  const can = (c: BuildCat) => !s.building && open.some((b) => b.cat === c && s.wood >= buildCost(s, b.id));
  const tabs = cats.length > 1 ? `<div class="seg build-cats">${cats.map((c) => `<button class="px-btn${c.id === buildCat ? ' on' : ''}" data-buildcat="${c.id}">${c.name}${can(c.id) && c.id !== buildCat ? '<i class="dot"></i>' : ''}</button>`).join('')}</div>` : '';
  const rows = BUILDS.filter((b) => b.cat === buildCat && (open.includes(b) || count(s, b.id) > 0))
    .map((b) => buildRow(s, b, open.includes(b)))
    .join('') +
    BUILDS.filter((b) => b.cat === buildCat && teaser(s, b))
      .map(() => `<div class="card px-box build locked"><div class="info"><div class="name">???</div><div class="sub">Not known yet.</div></div></div>`)
      .join('');
  const locked = BUILDS.filter((b) => !open.includes(b) && !count(s, b.id) && !b.learn).length;
  const raft = s.raftTaken
    ? ''
    : `<div class="card px-box build"><div class="info"><div class="name">The raft</div><div class="sub">Pulled up on the beach where it landed. Its logs would make good wood.</div></div>
      <button class="px-btn buy gold" data-act="take-raft">Break it up<br><span class="tiny">+${RAFT_WOOD} wood</span></button></div>`;
  const going = s.building
    ? `<div class="card px-box build going"><div class="info"><div class="name">Building: ${buildName(s.building.id, s.look.diet)}</div>
      <div class="making-bar on" data-bar="building"><i style="width: ${Math.round((1 - s.building.left / s.building.total) * 100)}%"></i></div>
      <div class="sub">One thing at a time: <span data-t="build-left">${Math.ceil(s.building.left)}s</span> to go. More grown hands build faster.</div></div></div>`
    : '';
  return `<div class="panel-head"><h2>Build</h2><span class="dim"><span data-t="shore-wood">${n0(s.wood)}</span> wood</span></div>${going}${raft}${tabs}${rows}${locked ? `<p class="dim tiny">More to build once there's a ${count(s, 'hearth') ? 'hut' : 'hearth'}.</p>` : ''}`;
}

/** One kind of building: how many there are, what the next costs (or that it's all built). */
function buildRow(s: ShoreState, b: BuildDef, open: boolean): string {
  const have = count(s, b.id);
  const name = `${buildName(b.id, s.look.diet)}${have && b.max !== 1 ? ` <span class="dim">×${have}</span>` : ''}`;
  if (!open) return `<div class="card px-box build done"><div class="info"><div class="name">${name}</div><div class="sub">${b.does}</div></div><span class="tag">Built</span></div>`;
  const cost = buildCost(s, b.id);
  const poor = s.wood < cost || !!s.building;
  return `<div class="card px-box build"><div class="info"><div class="name">${name}</div><div class="sub">${b.does}</div></div>
    <button class="px-btn buy${poor ? '' : ' gold'}" data-build="${b.id}"${poor ? ' disabled' : ''}><span class="num">${cost}</span> wood</button></div>`;
}


function islandLayout(s: ShoreState): string {
  return villagesCard(s) + landmarksCard(s) + relicsCard(s) + scoutsCard(s);
}

function landmarksCard(s: ShoreState): string {
  const found = poisOf(s).filter((p) => p.found && p.known);
  const head = `<div class="panel-head"><h2>Landmarks</h2><span class="dim">${found.length} known</span></div>`;
  if (!found.length) return `${head}<div class="card px-box"><div class="info"><div class="sub">None yet. Keep your eyes open out there.</div></div></div>`;
  const here = poiHere(s);
  // The ones with something still to find first, nearest the chief first.
  const d = (p: Poi) => Math.hypot(p.x - s.chiefAt.x, p.y - s.chiefAt.y);
  const left = (p: Poi) => poiDef(p).layers.length - p.done;
  found.sort((a, b) => Number(left(b) > 0) - Number(left(a) > 0) || d(a) - d(b));
  return head + found.map((p) => poiRow(s, p, p === here)).join('');
}

function poiRow(s: ShoreState, p: Poi, here: boolean): string {
  const def = poiDef(p);
  const left = def.layers.length - p.done;
  const chief = s.people.find((q) => q.id === s.chief)?.name ?? 'The chief';
  const status = here
    ? `<b class="green">${chief} is exploring it…</b>`
    : left
      ? `${p.done ? 'There\'s more to find here.' : 'Not explored yet.'} ${Math.round(Math.hypot(p.x - s.chiefAt.x, p.y - s.chiefAt.y))} steps away.`
      : 'Explored.';
  return `<div class="card px-box poi${left ? '' : ' done'}"><div class="info"><div class="name">${def.name} <span class="tag">${POI_SORT[def.sort]}</span></div>
    <div class="sub">${status}</div></div>
    <div class="col">${left && !here ? `<button class="px-btn gold" data-gopoi="${p.id}">Go</button>` : ''}<button class="px-btn" data-seepoi="${p.id}">Look</button></div></div>`;
}

function relicsCard(s: ShoreState): string {
  const have = s.relics ?? [];
  if (!have.length) return '';
  return `<div class="panel-head"><h2>Relics</h2><span class="dim">${have.length} of ${RELICS.length}</span></div>
    <div class="card px-box"><div class="info">${have.map((id) => {
      const r = RELICS.find((x) => x.id === id)!;
      return `<div class="relic"><b>${r.name}</b> <span class="dim">${r.does}</span></div>`;
    }).join('')}</div></div>`;
}

/** A landmark's card (tapped on the map). */
export function poiCard(s: ShoreState, p: Poi): string {
  const def = poiDef(p);
  const left = def.layers.length - p.done;
  const chief = s.people.find((q) => q.id === s.chief)?.name ?? 'The chief';
  const here = poiHere(s) === p;
  return `<p class="label dim">${POI_SORT[def.sort]}</p><h3>${def.name}</h3><p>${def.seen}</p>
    <p class="dim">${left ? (here ? `${chief} is exploring it. Stay a while.` : `${p.done ? 'There\'s more to find here.' : 'No one\'s explored it yet.'} Only ${chief} can: go there and stay a while.`) : 'Explored: there\'s nothing more to find.'}</p>
    <div class="choices">${left && !here ? `<button class="px-btn gold" data-gopoi="${p.id}">${chief} goes there</button>` : ''}<button class="px-btn" data-act="dismiss">OK</button></div>`;
}

/** What exploring turned up (a card). */
export function findCard(p: Poi, f: Find, dup: boolean): string {
  const relic = f.relic ? RELICS.find((r) => r.id === f.relic) : undefined;
  const build = f.learn ? BUILDS.find((b) => b.id === f.learn) : undefined;
  const got = dup
    ? `<p class="dim">They have one like it already: what was there is taken as wood (+30).</p>`
    : `${relic ? `<p class="fx">Relic: <b>${relic.name}</b>. ${relic.does}</p>` : ''}${build ? `<p class="fx">Learned: <b>${build.name}</b> (in Build). ${build.does}</p>` : ''}${f.wood ? `<p class="fx">+${f.wood} wood</p>` : ''}${f.food ? `<p class="fx">+${f.food} food</p>` : ''}`;
  const more = p.done < poiDef(p).layers.length;
  return `<p class="label dim">${poiName(p)}</p><h3>${relic && !dup ? relic.name : build && !dup ? 'Something learned' : 'Found'}</h3><p>${f.text}</p>${got}
    ${more ? '<p class="dim tiny">There\'s more to find here.</p>' : ''}<button class="px-btn gold" data-act="dismiss">OK</button>`;
}

/** Everyone, by name: the chief and the four first, then the grown, then the children; each
 * with their kind, and how old (in words). */
function peopleLayout(s: ShoreState): string {
  const today = s.day + s.clock / DAY_SEC;
  const icons = new Map<string, string>();
  const iconOf = (k: number | undefined) => {
    const key = String(k ?? 'ours');
    if (!icons.has(key)) icons.set(key, miniIcon(k === undefined ? s.look : s.villages.find((v) => v.id === k)?.look ?? s.look, 2));
    return icons.get(key)!;
  };
  const age = (p: ShorePerson) => {
    if (!isAdult(s, p)) return 'a child';
    if (p.dies !== undefined && p.dies - today < 12) return 'old';
    return today - p.born < 20 ? 'young' : 'grown';
  };
  const rank = (p: ShorePerson) => (p.id === s.chief ? 0 : p.founder ? 1 : isAdult(s, p) ? 2 : 3);
  const list = [...s.people].sort((a, b) => rank(a) - rank(b) || a.born - b.born);
  const kinds = new Map<string, number>();
  for (const p of s.people) {
    const name = p.kind === undefined ? 'your own kind' : cap(s.villages.find((v) => v.id === p.kind)?.name ?? 'others');
    kinds.set(name, (kinds.get(name) ?? 0) + 1);
  }
  const plan = workPlan(s);
  const fed = plan.foodRate >= plan.eat || s.food > 0.5;
  return `<div class="panel-head"><h2>The People</h2><span class="dim">${s.people.length}</span></div>
    <div class="card px-box"><div class="info"><div class="sub">${[...kinds].map(([k, n]) => `${n} ${k}`).join(' · ')}</div>
    <div class="sub">${fed ? `Fed: ${n0(plan.foodRate)} food a day comes in, ${n0(plan.eat)} is eaten.` : `<b class="starving">Hungry: ${n0(plan.eat)} food a day is needed, only ${n0(plan.foodRate)} comes in.</b>`}</div></div></div>
    <div class="card px-box people-list"><div class="info">${list
      .map((p) => `<div class="person">${iconOf(p.kind)}<b>${p.name}</b><span class="dim">${p.id === s.chief ? 'chief' : p.founder ? 'one of the four' : age(p)}</span></div>`)
      .join('')}</div></div>`;
}

function scoutsCard(s: ShoreState): string {
  const scouts = count(s, 'scout');
  const out = `<div class="card px-box"><div class="info"><div class="name">Out in the fog</div>
    <div class="sub">${scouts ? `${scouts} scout${scouts > 1 ? 's are' : ' is'} out exploring for you.` : 'No scouts yet (build a Scout\'s hut to send one out).'} Tap the land to send ${s.people.find((p) => p.id === s.chief)?.name ?? 'the chief'} walking.</div></div></div>`;
  return out;
}

function peopleCard(s: ShoreState): string {
  const four = s.people.filter((p) => p.founder);
  const chief = s.people.find((p) => p.id === s.chief);
  const grown = s.people.filter((p) => !p.founder && isAdult(s, p)).length;
  const young = s.people.filter((p) => !isAdult(s, p)).length;
  return `<div class="card px-box"><div class="info"><div class="name">${chief ? `${chief.name} leads` : 'The people'}</div>
    <div class="sub">${four.length ? `Of the four who crossed: ${four.map((p) => p.name).join(', ')}.` : 'The four who crossed are all gone.'} ${grown ? `${grown} born here and grown. ` : ''}${young ? `${young} children.` : ''}</div>
    <div class="sub dim">${s.births} born · ${s.deaths} dead.</div></div></div>`;
}

function villagesCard(s: ShoreState): string {
  const found = s.villages.filter((v) => v.found);
  if (!found.length) return `<div class="panel-head"><h2>The island</h2></div><div class="card px-box"><div class="info"><div class="sub">There's smoke inland. Someone else is here. Walk out and find them.</div></div></div>`;
  return `<div class="panel-head"><h2>The island</h2><span class="dim">${found.length} of ${s.villages.length}${found.length < s.villages.length ? '+' : ''} found</span></div>${found.map((v) => villageRow(s, v)).join('')}`;
}

function villageRow(s: ShoreState, v: Village): string {
  const rel = relation(s, v);
  if (v.joined) {
    return `<div class="card px-box village"><span class="kind">${miniIcon(v.look, 2)}</span><div class="info"><div class="name">${cap(v.name)} <span class="rel rel-kin">Joined</span></div>
      <div class="sub">They live by your hearth now.</div></div></div>`;
  }
  if (v.gone) return '';
  const icon = `<span class="kind">${miniIcon(v.look, 2)}</span>`;
  if (v.vassal) return vassalRow(v);
  if (v.asking !== undefined) {
    return `<div class="card px-box village">${icon}<div class="info"><div class="name">${cap(v.name)} <span class="rel rel-kin">Won over</span></div>
      <div class="sub">They'd join you, but there's no room for all ${Math.round(v.pop)} of them.</div></div>
      <div class="col"><button class="px-btn gold" data-askjoin="${v.id}">Decide</button></div></div>`;
  }
  if (v.waiting !== undefined) {
    return `<div class="card px-box village">${icon}<div class="info"><div class="name">${cap(v.name)} <span class="rel rel-kin">Waiting</span></div>
      <div class="sub">Waiting for room: ${Math.round(v.pop)} of them, ${Math.max(0, roomLeft(s))} beds free. They won't wait for ever.</div></div>
      <div class="col"><button class="px-btn" data-seevillage="${v.id}">Look</button></div></div>`;
  }
  const win = canWin(s, v);
  return `<div class="card px-box village">${icon}<div class="info"><div class="name">${cap(v.name)} <span class="rel rel-${rel}">${REL_NAME[rel]}</span></div>
    <div class="sub">${v.pop} ${v.cannibal ? 'eaters of their own' : DIET_NAME[v.diet] ?? v.diet}. ${win ? '' : REL_LINE[rel]}</div>${win ? trustBar(v) : ''}</div>
    <div class="col">${win ? `<button class="px-btn${s.food >= giftCost(v) ? ' gold' : ''}" data-gift="${v.id}"${s.food >= giftCost(v) ? '' : ' disabled'}>Gift ${giftCost(v)}</button>` : ''}<button class="px-btn" data-seevillage="${v.id}">Look</button></div></div>`;
}

const TAXES = [0, 0.1, 0.25, 0.4, 0.6];

function vassalRow(v: Village): string {
  const d = vassalDay(v);
  const loy = Math.round(v.vassal!.loyalty);
  const mood = loy > 70 ? 'content' : loy > 40 ? 'grumbling' : loy > 15 ? 'restless' : 'on the edge of revolt';
  return `<div class="card px-box village vassal"><span class="kind">${miniIcon(v.look, 2)}</span><div class="info"><div class="name">${cap(v.name)} <span class="rel rel-vassal">Yours</span></div>
    <div class="sub">${Math.floor(v.pop)} of them, ${mood}. They send ${n0(d.food)} food and ${n0(d.wood)} wood a day${d.growth > 0.05 ? ', and are growing' : d.growth < -0.05 ? ', and are dwindling' : ''}.</div>
    <div class="trust"><span class="tiny dim">Loyal</span><div class="making-bar on loyal"><i style="width: ${loy}%"></i></div><span class="tiny num">${loy}</span></div>
    <div class="seg tax"><span class="tiny dim">Take</span>${TAXES.map((t) => `<button class="px-btn${Math.abs(v.vassal!.tax - t) < 0.01 ? ' on' : ''}" data-tax="${v.id}:${t}">${Math.round(t * 100)}%</button>`).join('')}</div></div>
    <div class="col"><button class="px-btn" data-seevillage="${v.id}">Look</button></div></div>`;
}

/** Won over, but there's no room: what's to be done with them? */
export function joinCard(s: ShoreState, v: Village): string {
  const free = Math.max(0, roomLeft(s));
  const n = Math.round(v.pop);
  return `<p class="label dim">Won over</p><div class="village-head"><span class="kind">${miniIcon(v.look, 3)}</span><h3>${cap(v.name)}</h3></div>
    <p>They would join you: all ${n} of them. But there's room by your hearth for only ${free} more.</p>
    ${deck([
      { act: `${v.id}:crowd`, title: 'Take them in', line: `All ${n} come to live by your hearth now.`, good: [`${n} more people, today`], bad: ['Crowded: no children till there\'s room', 'Many more mouths to feed'] },
      { act: `${v.id}:vassal`, title: 'Keep their village, as yours', line: 'They stay where they are, and answer to your hearth.', good: ['Food and wood sent to you every day', 'They grow on their own'], bad: ['Take too much and they grow restless, then revolt'] },
      { act: `${v.id}:wait`, title: 'Ask them to wait', line: 'They\'ll come once there\'s room for them.', good: ['They join by themselves, when there\'s room'], bad: ['Ten days, then they give up on you'] },
      { act: `${v.id}:away`, title: 'Turn them away', line: 'They leave their village, and go.', good: ['No more mouths to feed'], bad: ['Where they\'ll go, no one says'] },
    ])}`;
}

/** A deck of choices to flip through (swipe, or the arrows), each a card with what it gives and
 * what it costs, and a check to choose it. */
export function deck(cards: { act: string; title: string; line: string; good: string[]; bad: string[] }[]): string {
  return `<div class="deck">
    <div class="deck-cards">${cards
      .map(
        (c, i) => `<div class="deck-card px-box" data-card="${i}">
          <div class="deck-num">${i + 1} / ${cards.length}</div>
          <h4>${c.title}</h4>
          <p>${c.line}</p>
          <ul>${c.good.map((g) => `<li class="good">${g}</li>`).join('')}${c.bad.map((b) => `<li class="bad">${b}</li>`).join('')}</ul>
          <button class="px-btn gold deck-pick" data-join="${c.act}"><i class="check"></i>Choose this</button>
        </div>`,
      )
      .join('')}</div>
    <div class="deck-nav"><button class="px-btn" data-deck="-1" aria-label="Previous">‹</button><span class="deck-dots">${cards.map((_, i) => `<i${i ? '' : ' class="on"'}></i>`).join('')}</span><button class="px-btn" data-deck="1" aria-label="Next">›</button></div>
  </div>`;
}

function trustBar(v: Village): string {
  const t = Math.floor(v.trust ?? 0);
  return `<div class="trust"><span class="tiny dim">Trust</span><div class="making-bar on"><i style="width: ${t}%"></i></div><span class="tiny num" data-t="trust-${v.id}">${t}</span></div>`;
}

export function villageCard(s: ShoreState, v: Village): string {
  const rel = relation(s, v);
  const win = canWin(s, v);
  const near = chiefNear(s, v);
  const chief = s.people.find((p) => p.id === s.chief)?.name ?? 'The chief';
  const actions = win
    ? `${trustBar(v)}
      <p class="dim tiny">${near ? `${chief} is with them: gifts count twice, and every day there they trust you more.` : `Gifts count twice brought by ${chief} in person, and the longer ${chief} stays, the more they trust you.`} At full trust they join you.</p>
      <div class="choices">
        <button class="px-btn${s.food >= giftCost(v) ? ' gold' : ''}" data-gift="${v.id}"${s.food >= giftCost(v) ? '' : ' disabled'}>Send a gift · ${giftCost(v)} food${near ? ' (×2)' : ''}</button>
        ${near ? '' : `<button class="px-btn" data-visit="${v.id}">${chief} visits them</button>`}
        <button class="px-btn" data-act="dismiss">Later</button>
      </div>`
    : `<p class="dim tiny">(Raiding and defending come next.)</p><button class="px-btn gold" data-act="dismiss">OK</button>`;
  return `<p class="label dim">${REL_NAME[rel]}</p><div class="village-head"><span class="kind">${miniIcon(v.look, 3)}</span><h3>${cap(v.name)}</h3></div>
    <p>${v.pop} of them, ${v.cannibal ? 'eaters of their own kind' : `${(DIET_NAME[v.diet] ?? v.diet).toLowerCase()}`}, another kind altogether.${v.habitat ? ` ${WHERE[v.habitat]}` : ''}</p>
    <p class="dim">${REL_LINE[rel]}</p>
    ${actions}`;
}

const cap = (t: string) => t[0].toUpperCase() + t.slice(1);

export type { BuildId };
