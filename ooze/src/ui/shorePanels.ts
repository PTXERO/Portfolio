// New Shore's panels: the Village (stores, who's working at what, the people), Build (by sort:
// homes, stores, work, exploring) and the Island (the villages found out there, and the scouts).

import { BUILD_CATS, BUILDS, buildName, POI_SORT, RELICS, RES_NAME, type Res, type BuildCat, type BuildDef, type BuildId, type Find } from '../content/shore';
import { buildCost, canPay, elderThink, ELDERS_OFF, buildLeftSec, builders, buildsOpen, burnPerDay, canWin, forestShare, RES_CAP, RES_OF, sourcesOf, roomLeft, vassalDay, learned, poiDef, poiHere, poiName, poisOf, type Poi, RAFT_WOOD, chiefNear, count, foodCap, giftCost, shoreSeason, isAdult, relation, room, shoreOf, woodCap, workPlan, type Lean, type ShoreState, type Village } from '../economy/shore';
import { genesKey, miniIcon } from '../scene/creatureLook';
import { DAY_SEC, type ShorePerson } from '../economy/shore';
import { FORKS, forkOptions, IDEAS, LANES, LANES_FOR_WORK, laneShare, lanesDone, nextIdea, workReady, type ForkId } from '../economy/culture';
import { canStepIn, fighters, hasWalls, holders, hostile, odds, ourStrength, payCost, raidable, theirStrength, type Battle, type Fight } from '../economy/war';
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
let villageView: 'village' | 'people' | 'elders' = 'village';
export function setVillageView(v: string): void {
  villageView = v === 'people' || v === 'elders' ? v : 'village';
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
  if (tab === 'culture') {
    const c = s.culture;
    return JSON.stringify(['culture', c?.age, c?.done, c?.focus, c?.forks, c?.asking?.fork, LANES.map((l) => Math.floor((c ? laneShare(c, l.id) : 0) * 20)), s.building?.id === 'greathearth', count(s, 'greathearth')]);
  }
  if (tab === 'build') return JSON.stringify([Object.values(s.res ?? {}).map((v) => Math.floor((v ?? 0) / 5)), s.building?.id, s.learned, buildCat, s.raftTaken, s.built.length, buildsOpen(s).map((b) => [b.id, canPay(s, b.id)])]);
  const war = JSON.stringify([s.raid?.seen !== undefined && [s.raid.from, s.raid.rallied, Math.ceil(((s.raid.arrives ?? 0) - s.day - s.clock / DAY_SEC) * 4)], s.warband && [s.warband.to, Math.ceil((s.warband.arrives - s.day - s.clock / DAY_SEC) * 4)], fighters(s)]);
  if (tab === 'island') return war + JSON.stringify([Object.values(s.res ?? {}).map((v) => Math.floor(v ?? 0)), s.relics, poisOf(s).map((p) => (p.found && p.known ? p.done : -1)), poiHere(s)?.id, count(s, 'scout'), s.villages.filter((v) => v.found).map((v) => [v.id, v.joined, v.gone, v.asking, v.waiting !== undefined && roomLeft(s), v.vassal && [v.vassal.tax, Math.floor(v.vassal.loyalty / 5), Math.floor(v.pop)], Math.floor((v.trust ?? 0) / 5), s.food >= giftCost(v)]), s.chief]);
  const plan = workPlan(s);
  if (villageView === 'elders' && count(s, 'council')) return JSON.stringify(['elders', s.steward, (s.steward?.on ? elderThink(s) : ELDERS_OFF).text, s.elders?.length, s.elders?.[s.elders.length - 1]?.text, s.building?.id]);
  if (villageView === 'people') return JSON.stringify(['people', s.people.length, s.chief, Math.floor(s.day / 2), s.hungry]);
  return war + JSON.stringify([s.cold, Math.round(forestShare(s) * 20), Math.round(burnPerDay(s) * 2), s.steward, s.hungry, shoreSeason(s).si, s.people.length, s.built.length, s.lean, plan.food, plan.wood, s.chief, s.people.filter((p) => isAdult(s, p)).length, s.people.filter((p) => p.founder).length]);
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
    put('build-left', `${Math.ceil(buildLeftSec(s))}s`);
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
  if (tab === 'culture') return cultureLayout(s);
  if (tab === 'island') return islandLayout(s);
  const council = count(s, 'council') > 0;
  const view = villageView === 'elders' && !council ? 'village' : villageView;
  const views = `<div class="seg build-cats"><button class="px-btn${view === 'village' ? ' on' : ''}" data-villageview="village">The village</button><button class="px-btn${view === 'people' ? ' on' : ''}" data-villageview="people">People · ${s.people.length}</button>${council ? `<button class="px-btn${view === 'elders' ? ' on' : ''}" data-villageview="elders">Elders</button>` : ''}<span class="seg-gap"></span><button class="px-btn" data-camera="home">Home</button><button class="px-btn" data-camera="chief">Chief</button></div>`;
  if (view === 'people') return views + peopleLayout(s);
  if (view === 'elders') return views + eldersLayout(s);
  return views + warCard(s) + storesCard(s) + workCard(s) + peopleCard(s);
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
      ${cell('wood', 'Wood', s.wood, woodCap(s), `${plan.woodRate - burnPerDay(s) >= 0 ? '+' : ''}${n0(plan.woodRate - burnPerDay(s))} a day`)}
      <div class="store"><span class="label dim">People</span><b class="num">${s.people.length}<span class="dim">/${room(s)}</span></b><span class="dim">room</span></div>
      <div class="sub diet">${s.cold ? `<b class="starving">Freezing: no wood for the fires. ${s.cold >= 2 ? 'The young and the old are dying.' : 'Soon they will start to die.'}</b> ` : ''}${s.hungry ? `<b class="starving">Starving: not enough food for everyone. ${s.hungry >= 2 ? 'People are dying.' : 'Soon people will die.'}</b> ` : ''}${seasonLine(s)}<span data-t="shore-birth">${birthLine(s)}</span></div>
    </div>`;
}

const LEANS: { id: Lean; name: string }[] = [
  { id: 'food', name: 'Food' },
  { id: 'balanced', name: 'Balanced' },
  { id: 'wood', name: 'Wood' },
];

function workCard(s: ShoreState): string {
  const plan = workPlan(s);
  const b = builders(s);
  const kids = s.people.length - plan.food - plan.wood - b;
  if (!count(s, 'hearth')) {
    return `<div class="card px-box"><div class="info"><div class="name">No village yet</div>
      <div class="sub">They sit by the raft, living on what the crossing left them. Nothing's gathered until there's a hearth: break up the raft for its wood, and build one.</div></div></div>`;
  }
  return `<div class="card px-box lean"><div class="info"><div class="name">What they work at</div>
    <div class="sub">${plan.food} gathering food, ${plan.wood} cutting wood${b ? `, ${b} building` : ''}${kids > 0 ? `, ${kids} too young` : ''}. They work it out for themselves; you set what they lean toward.</div>
    <div class="sub dim">Firewood: ${burnPerDay(s).toFixed(1)} a day${shoreSeason(s).si === 3 ? ' (winter: twice as much)' : ''}. The woods round about: ${Math.round(forestShare(s) * 100)}%${forestShare(s) < 0.5 ? ', thinning (a forester would plant more)' : ''}.</div>
    <div class="sub${plan.food > plan.land ? ' starving' : ' dim'}">The land round the village feeds ${plan.land} gatherers${plan.food > plan.land ? `: ${plan.food - plan.land} more than it can, and they find little` : ''}. Gathering camps and weirs let it feed more.</div></div>
    <div class="seg">${LEANS.map((l) => `<button class="px-btn${s.lean === l.id ? ' gold' : ''}" data-lean="${l.id}">${l.name}</button>`).join('')}</div></div>`;
}

function buildLayout(s: ShoreState): string {
  const open = buildsOpen(s);
  const cats = BUILD_CATS.filter((c) => catShown(s, c.id));
  if (!cats.some((c) => c.id === buildCat)) buildCat = cats[0]?.id ?? 'homes';
  // A dot on a sort with something in it you can build now.
  const can = (c: BuildCat) => !s.building && open.some((b) => b.cat === c && canPay(s, b.id));
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
      <div class="sub"><span data-t="build-left">${Math.ceil(buildLeftSec(s))}s</span> to go, with ${builders(s)} at it (not gathering meanwhile). Further from the hearth takes longer.</div></div></div>`
    : '';
  return `<div class="panel-head"><h2>Build</h2><span class="dim"><span data-t="shore-wood">${n0(s.wood)}</span> wood</span></div>${going}${raft}${tabs}${rows}${locked ? `<p class="dim tiny">More to build once there's a ${count(s, 'hearth') ? 'hut' : 'hearth'}.</p>` : ''}`;
}

/** One kind of building: how many there are, what the next costs (or that it's all built). */
function buildRow(s: ShoreState, b: BuildDef, open: boolean): string {
  const have = count(s, b.id);
  const name = `${buildName(b.id, s.look.diet)}${have && b.max !== 1 ? ` <span class="dim">×${have}</span>` : ''}`;
  if (!open) return `<div class="card px-box build done"><div class="info"><div class="name">${name}</div><div class="sub">${b.does}</div></div><span class="tag">Built</span></div>`;
  const cost = buildCost(s, b.id);
  const poor = !canPay(s, b.id) || !!s.building;
  // What else it takes: how much there is, or (with none of it to be had) where it's found.
  const needs = (Object.keys(b.needs ?? {}) as Res[]).map((r) => {
    const want = b.needs![r]!;
    const have = Math.floor(s.res?.[r] ?? 0);
    if (have >= want) return `<span class="fx">${want} ${RES_NAME[r].toLowerCase()}</span>`;
    if (sourcesOf(s, r).length) return `${want} ${RES_NAME[r].toLowerCase()} (${have} so far)`;
    return `<span class="starving">Needs ${RES_NAME[r].toLowerCase()}: you have no village ${whereRes(r)} yet.</span>`;
  });
  return `<div class="card px-box build"><div class="info"><div class="name">${name}</div><div class="sub">${b.does}</div>${needs.length ? `<div class="sub">${needs.join(' · ')}</div>` : ''}</div>
    <button class="px-btn buy${poor ? '' : ' gold'}" data-build="${b.id}"${poor ? ' disabled' : ''}><span class="num">${cost}</span> wood</button></div>`;
}

/** Where a resource is to be had, in words: "by a river or in the marsh". */
const PLACE: Record<string, string> = { river: 'by a river', lake: 'by a lake', marsh: 'in the marsh', desert: 'in the desert', scrub: 'in the dry scrub', forest: 'in the woods', meadow: 'on the open grass', mountain: 'in the hills', coast: 'on the coast' };
function whereRes(r: Res): string {
  const places = (Object.keys(RES_OF) as (keyof typeof RES_OF)[]).filter((h) => RES_OF[h].includes(r)).map((h) => PLACE[h]);
  return places.length > 1 ? `${places.slice(0, -1).join(', ')} or ${places[places.length - 1]}` : places[0];
}

/** Everything the island's land gives: how much is kept, and from whom (or where to look). */
function resourcesCard(s: ShoreState): string {
  const rows = (Object.keys(RES_NAME) as Res[]).map((r) => {
    const from = sourcesOf(s, r);
    const have = r === 'fish' ? '' : `<b class="num">${Math.floor(s.res?.[r] ?? 0)}</b><span class="dim">/${RES_CAP}</span> `;
    const line = from.length ? `${have}from ${from.map((v) => cap(v.name)).join(', ')}${r === 'fish' ? ' (into the food)' : ''}` : `<span class="dim">None yet: found ${whereRes(r)}.</span>`;
    return `<div class="relic"><b>${RES_NAME[r]}</b> ${line}</div>`;
  });
  return `<div class="panel-head"><h2>Resources</h2><span class="dim">from the villages you hold</span></div><div class="card px-box"><div class="info">${rows.join('')}</div></div>`;
}


function islandLayout(s: ShoreState): string {
  return villagesCard(s) + resourcesCard(s) + landmarksCard(s) + relicsCard(s) + scoutsCard(s);
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
  // (Each in their own coat.)
  const iconOf = (p: ShorePerson) => {
    const key = `${p.kind ?? 'ours'}|${genesKey(p.genes)}`;
    if (!icons.has(key)) {
      const base = p.kind === undefined ? s.look : s.villages.find((v) => v.id === p.kind)?.look ?? s.look;
      icons.set(key, miniIcon(p.genes ? { ...base, genes: p.genes } : base, 2));
    }
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
    <p class="tiny dim">Tap anyone for their family tree.</p>
    <div class="card px-box people-list"><div class="info">${list
      .map((p) => `<button class="person" data-tree="${p.id}">${iconOf(p)}<b>${p.name}</b><span class="dim">${p.id === s.chief ? 'chief' : p.founder ? 'one of the four' : age(p)}</span></button>`)
      .join('')}</div></div>`;
}

function scoutsCard(s: ShoreState): string {
  const scouts = count(s, 'scout');
  const out = `<div class="card px-box"><div class="info"><div class="name">Out in the fog</div>
    <div class="sub">${scouts ? `${scouts} scout${scouts > 1 ? 's are' : ' is'} out exploring for you.` : 'No scouts yet (build a Scout\'s hut to send one out).'} Tap the land to send ${s.people.find((p) => p.id === s.chief)?.name ?? 'the chief'} walking.</div></div></div>`;
  return out;
}

const PLANS: { id: string; name: string; does: string }[] = [
  { id: 'balanced', name: 'Balanced', does: 'room when it\'s short, food when the land is, stores when they\'re full' },
  { id: 'homes', name: 'Homes', does: 'room first, always a little ahead' },
  { id: 'food', name: 'Food', does: 'camps and weirs before the land runs short' },
  { id: 'stores', name: 'Stores', does: 'racks and granaries, and woodpiles for the big builds' },
];

/** The elders' council: building while you're away, by what you've said matters most. */
function councilCard(s: ShoreState): string {
  if (!count(s, 'council')) return '';
  const st = s.steward ?? { on: true, plan: 'balanced' };
  const plan = PLANS.find((p) => p.id === st.plan) ?? PLANS[0];
  return `<div class="card px-box lean"><div class="info"><div class="name">The elders build</div>
    <div class="sub">${st.on ? `Whenever nothing's going up, they choose what's next: ${plan.does}.` : 'They leave the building to you.'}</div></div>
    <div class="seg"><button class="px-btn${st.on ? ' on' : ''}" data-steward="${st.on ? 'off' : 'on'}">${st.on ? 'On' : 'Off'}</button>${PLANS.map((p) => `<button class="px-btn${st.plan === p.id ? ' gold' : ''}" data-stewardplan="${p.id}"${st.on ? '' : ' disabled'}>${p.name}</button>`).join('')}</div></div>`;
}

/** The elders: what they're set to, what they're thinking now, and what they've thought. */
function eldersLayout(s: ShoreState): string {
  const now = s.steward?.on ? elderThink(s) : ELDERS_OFF;
  const said = (s.elders ?? []).slice().reverse().filter((e, i) => i > 0 || e.text !== now.text);
  return `${councilCard(s)}
    <div class="card px-box"><div class="info"><div class="name">Round the council fire</div><div class="sub">${now.text}</div>${s.raid?.seen !== undefined || s.warband ? '<div class="sub dim">"War is not ours to speak of. The chief decides."</div>' : ''}</div></div>
    ${said.length ? `<div class="panel-head"><h2>What they've said</h2></div><div class="card px-box"><div class="info">${said.map((e) => `<div class="sub"><span class="dim">${e.when}.</span> ${e.text}</div>`).join('')}</div></div>` : ''}`;
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
    <div class="col">${win ? `<button class="px-btn${s.food >= giftCost(v) ? ' gold' : ''}" data-gift="${v.id}"${s.food >= giftCost(v) ? '' : ' disabled'}>Gift ${giftCost(v)}</button>` : ''}${raidable(s, v) ? `<button class="px-btn" data-raid="${v.id}"${s.warband ? ' disabled' : ''}>Raid</button>` : ''}<button class="px-btn" data-seevillage="${v.id}">Look</button></div></div>`;
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
export function deck(cards: { act: string; title: string; line: string; good: string[]; bad: string[]; off?: string }[], attr = 'join'): string {
  return `<div class="deck" data-i="0" data-n="${cards.length}">
    <div class="deck-cards"><div class="deck-track">${cards
      .map(
        (c, i) => `<div class="deck-card px-box" data-card="${i}">
          <div class="deck-num">${i + 1} / ${cards.length}</div>
          <h4>${c.title}</h4>
          <p>${c.line}</p>
          <ul>${c.good.map((g) => `<li class="good">${g}</li>`).join('')}${c.bad.map((b) => `<li class="bad">${b}</li>`).join('')}</ul>
          ${c.off ? `<p class="dim tiny">${c.off}</p>` : `<button class="px-btn gold deck-pick" data-${attr}="${c.act}"><i class="check"></i>Choose this</button>`}
        </div>`,
      )
      .join('')}</div></div>
    <div class="deck-nav"><button class="px-btn" data-deck="-1" aria-label="Previous">‹</button><span class="deck-dots">${cards.map((_, i) => `<i${i ? '' : ' class="on"'}></i>`).join('')}</span><button class="px-btn" data-deck="1" aria-label="Next">›</button></div>
  </div>`;
}

function trustBar(v: Village): string {
  const t = Math.floor(v.trust ?? 0);
  return `<div class="trust"><span class="tiny dim">Trust</span><div class="making-bar on"><i style="width: ${t}%"></i></div></div>`;
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
    : raidable(s, v)
      ? `${raidChoices(s, v)}`
      : `<p class="dim tiny">${v.joined ? 'They live by your hearth now; a few stay on at their old village, working its land for you.' : v.vassal ? 'Yours: they pay tribute (set what you take on the Island tab).' : hostile(s, v) ? `They'll come raiding, when they think you're worth it.${v.beaten ? ` Driven off ${v.beaten} time${v.beaten > 1 ? 's' : ''} so far.` : ''}` : (v.beaten ?? 0) >= 3 ? 'Driven off too many times: they leave you be now.' : ''}</p><button class="px-btn gold" data-act="dismiss">OK</button>`;
  return `<p class="label dim">${REL_NAME[rel]}</p><div class="village-head"><span class="kind">${miniIcon(v.look, 3)}</span><h3>${cap(v.name)}</h3></div>
    <p>${v.pop} of them, ${v.cannibal ? 'eaters of their own kind' : `${(DIET_NAME[v.diet] ?? v.diet).toLowerCase()}`}, another kind altogether.${v.habitat ? ` ${WHERE[v.habitat]}` : ''}</p>
    <p class="dim">${REL_LINE[rel]}</p>
    ${v.habitat ? `<p class="fx">Their land gives: ${RES_OF[v.habitat].map((r) => RES_NAME[r].toLowerCase()).join(', ')}.</p>` : ''}
    ${actions}`;
}

const cap = (t: string) => t[0].toUpperCase() + t.slice(1);

/** How long till then, in words (days of the island's own). */
function soon(days: number): string {
  return days <= 0.3 ? 'any moment now' : days <= 1 ? 'before the day is out' : days <= 2 ? 'tomorrow' : `in ${Math.ceil(days)} days`;
}

/** Raiders coming, or the war band out: at the top of the Village tab. */
function warCard(s: ShoreState): string {
  const now = s.day + s.clock / DAY_SEC;
  let out = '';
  const r = s.raid;
  const v = r && s.villages.find((x) => x.id === r.from);
  if (r?.seen !== undefined && v) {
    const us = ourStrength(s, fighters(s), true, r.rallied ? 0.2 : 0);
    const them = theirStrength(v, r.fighters);
    out += `<div class="card px-box raid"><span class="kind">${miniIcon(v.look, 2)}</span><div class="info"><div class="name">Raiders!</div>
      <div class="sub">${cap(v.name)} are coming, about ${r.fighters} of them: here ${soon((r.arrives ?? now) - now)}. ${r.stance === 'pay' ? `They'll be paid ${payCost(v, r.fighters).food} food and ${payCost(v, r.fighters).wood} wood to go away.` : `${r.stance === 'walls' ? 'Behind the palisade, all' : 'All'} ${fighters(s)} grown will fight. ${odds(us, them)}`}</div>
      ${r.rallied && r.stance !== 'pay' ? '<div class="sub dim">Rallied: spears out, the young behind the fire.</div>' : ''}</div>
      <div class="col">${r.rallied || r.stance === 'pay' ? '' : '<button class="px-btn gold" data-rally="1">Rally them</button>'}<button class="px-btn" data-stancecard="1">${r.stance === 'pay' ? 'Pay' : r.stance === 'walls' ? 'Walls' : 'Fight'} ›</button></div></div>`;
  }
  const w = s.warband;
  const to = w && s.villages.find((x) => x.id === w.to);
  if (w && to) {
    const led = Math.hypot(s.chiefAt.x - to.x, s.chiefAt.y - to.y) < 14;
    out += `<div class="card px-box raid"><span class="kind">${miniIcon(s.look, 2)}</span><div class="info"><div class="name">The war band</div>
      <div class="sub">${w.fighters} out against ${to.name}, there ${soon(w.arrives - now)}. ${led ? 'The chief is there to lead them.' : 'Walk the chief there to lead them: they fight harder for it.'}</div></div>
      <div class="col">${led ? '' : `<button class="px-btn" data-visit="${to.id}">Go</button>`}</div></div>`;
  }
  return out;
}

/** The Long Road: the Age, its lanes (what each has come to, and how near the next), the forks
 * taken (and the roads not taken, greyed), and the Age's Great Work. */
function cultureLayout(s: ShoreState): string {
  const c = s.culture;
  if (!c) return '';
  const ageName = c.age === 1 ? 'The Hearth Age' : 'Beyond the Hearth';
  const done = lanesDone(c);
  const lanes = LANES.map((l) => {
    const ideas = IDEAS.filter((i) => i.lane === l.id && i.age === 1);
    const next = nextIdea(c, l.id);
    const share = laneShare(c, l.id);
    const steps = ideas
      .map((i) => (c.done.includes(i.id) ? `<span class="road-idea done" title="${i.does}">${i.name}</span>` : i === next ? `<span class="road-idea next">???<i class="road-bar" style="width:${Math.round(share * 100)}%"></i></span>` : '<span class="road-idea fog">???</span>'))
      .join('<span class="road-step">›</span>');
    return `<div class="card px-box road-lane${c.focus === l.id ? ' focused' : ''}"><div class="info"><div class="name">${l.name}${next ? '' : ' <span class="tiny dim">· done for this Age</span>'}</div>
      <div class="road-steps">${steps}</div><div class="sub tiny dim">From ${l.from}.</div></div>
      <div class="col">${next ? `<button class="px-btn${c.focus === l.id ? ' on' : ''}" data-focus="${c.focus === l.id ? '' : l.id}">${c.focus === l.id ? 'Focused' : 'Focus'}</button>` : ''}</div></div>`;
  }).join('');
  const forks = Object.entries(c.forks).map(([f, o]) => {
    const def = FORKS[f as ForkId];
    return `<div class="sub">${def.name}: ${forkOptions(s, f as ForkId).map((x) => (x.id === o ? `<b>${x.name}</b>` : `<span class="road-not">${x.name}</span>`)).join(' · ')}</div>`;
  }).join('');
  const asking = c.asking ? `<div class="card px-box raid"><div class="info"><div class="name">${FORKS[c.asking.fork].name}</div><div class="sub">${FORKS[c.asking.fork].ask} Left too long, the elders will choose.</div></div><div class="col"><button class="px-btn gold" data-forkcard="${c.asking.fork}">Decide</button></div></div>` : '';
  const work =
    c.age > 1
      ? '<div class="card px-box"><div class="info"><div class="name">The Great Hearth stands</div><div class="sub">The Hearth Age is over. The road goes on in a future update.</div></div></div>'
      : `<div class="card px-box"><div class="info"><div class="name">The Age's Great Work</div><div class="sub">${workReady(s) ? (s.building?.id === 'greathearth' ? 'The Great Hearth is going up.' : count(s, 'greathearth') ? '' : 'The Great Hearth can be built now (Build, Homes).') : `Once ${LANES_FOR_WORK} lanes have this Age's ideas (${done} so far), the Great Hearth can be built.`}</div></div></div>`;
  return `<div class="panel-head"><h2>The Long Road</h2><span class="dim">${ageName}</span></div>
    <p class="tiny dim">Ideas come by themselves, from what the village does. Focus a lane to hurry it.</p>
    ${asking}${work}${lanes}${forks ? `<div class="panel-head"><h2>Chosen</h2></div><div class="card px-box"><div class="info">${forks}</div></div>` : ''}`;
}

/** A fork, as cards to choose between. */
export function forkCard(s: ShoreState, fork: ForkId): string {
  const def = FORKS[fork];
  return `<p class="label dim">A choice for your people</p><h3>${def.name}</h3><p>${def.ask}</p><p class="dim tiny">Once chosen, it's for good. The road not taken stays on the Long Road, greyed.</p>
    ${deck(forkOptions(s, fork).map((o) => ({ act: `${fork}:${o.id}`, title: o.name, line: o.line, good: [o.lane ? `${LANES.find((l) => l.id === o.lane)!.name} ideas come a quarter faster` : o.fx?.food ? 'Food comes in 5% faster' : ''].filter(Boolean), bad: [] })), 'fork')}`;
}

/** Raiders seen coming: how the chief means to meet them (a card each, like the join choices). */
export function stanceCard(s: ShoreState): string {
  const r = s.raid;
  const v = r && s.villages.find((x) => x.id === r.from);
  if (!r || !v) return '';
  const now = s.day + s.clock / DAY_SEC;
  const n = fighters(s);
  const pay = payCost(v, r.fighters);
  const canPay = s.food >= pay.food && s.wood >= pay.wood;
  const chief = s.people.find((p) => p.id === s.chief)?.name ?? 'The chief';
  return `<p class="label dim">Raiders</p><div class="village-head"><span class="kind">${miniIcon(v.look, 3)}</span><h3>${cap(v.name)} are coming</h3></div>
    <p>About ${r.fighters} of them, armed, here ${soon((r.arrives ?? now) - now)}. How will ${chief} meet them?</p>
    ${deck(
      [
        { act: 'fight', title: 'Stand and fight', line: `All ${n} grown meet them outside the village.`, good: [odds(ourStrength(s, n, true, r.rallied ? 0.2 : 0), theirStrength(v, r.fighters)), `${chief} can step into the line while it's fought`], bad: ['Beaten, they take a quarter of the stores', 'A third of those who fall die'] },
        { act: 'walls', title: 'Behind the palisade', line: 'Everyone in, and hold the walls.', good: ['They fight half again as hard', 'Fewer of those who fall die'], bad: ['The fields outside are stripped: a tenth of the food'], off: hasWalls(s) ? undefined : 'There\'s no palisade to hold behind (build one under Defence).' },
        { act: 'pay', title: 'Pay them off', line: `Food and wood, left out for them: ${pay.food} food and ${pay.wood} wood.`, good: ['No one fights; no one dies'], bad: ['They learn that you pay: back the sooner, and asking more'], off: canPay ? undefined : `There isn't ${pay.food} food and ${pay.wood} wood to give.` },
      ],
      'stance',
    )}`;
}

/** The fight going on now, live: the lines thinning as the rounds are fought, and the chief's
 * one move in it. */
export function fightCard(s: ShoreState, f: Fight): string {
  const v = s.villages.find((x) => x.id === f.village);
  if (!v) return '';
  const head = f.attack === 'them' ? `${cap(v.name)} fall on the village` : `The war band falls on ${v.name}`;
  const chief = s.people.find((p) => p.id === s.chief)?.name ?? 'The chief';
  return `<p class="label dim">${f.walls ? 'Behind the palisade' : f.attack === 'them' ? 'Raid' : 'War band'}</p><h3>${head}</h3>
    <div class="battle live" data-fight="${f.id}">${line(s.look, f.ours, 'us')}<span class="vs">vs</span>${line(v.look, f.theirs, 'them')}</div>
    <p class="dim tiny fight-note"></p>
    <div class="choices"><button class="px-btn gold" data-stepin="1">${chief} steps into the line</button><button class="px-btn" data-act="dismiss">Leave them to it</button></div>`;
}

/** A line of fighters, up to ten shown, with their bar and count. */
function line(look: ShoreState['look'], n: number, side: string): string {
  return `<div class="side ${side}"><div class="line">${Array.from({ length: Math.min(10, Math.max(1, n)) }, () => miniIcon(look, 2)).join('')}</div><div class="making-bar on"><i style="width: 100%"></i></div><span class="tiny num">${n}</span></div>`;
}

/** What the live fight's note says now (who's in it, whether the chief can step in). */
export function fightNote(s: ShoreState, f: Fight): string {
  const chief = s.people.find((p) => p.id === s.chief)?.name ?? 'The chief';
  if (f.chief !== undefined) return f.chief >= f.rounds.length ? `${chief} pushes to the front…` : f.hurt ? `${chief} fought in the front line, and was hurt.` : `${chief} fought in the front line.`;
  if (canStepIn(s)) return `Once a fight, ${chief} can lead one round from the front: it hits far harder, but ${chief} may be hurt.`;
  return f.attack === 'them' ? `${chief} is too far from the village to join the fight.` : `${chief} isn't with the war band.`;
}

/** Raiding a village (the chief's call): how many to send, and how the odds look. */
export function raidChoices(s: ShoreState, v: Village): string {
  const n = fighters(s);
  const def = holders(v);
  if (s.warband) return `<p class="dim tiny">The war band is already out.</p><button class="px-btn gold" data-act="dismiss">OK</button>`;
  const opts = [
    { n: Math.floor(n / 2), name: 'Half' },
    { n: Math.floor(n * 0.75), name: 'Most' },
  ].filter((o, i, a) => o.n >= 2 && a.findIndex((x) => x.n === o.n) === i);
  if (!opts.length) return `<p class="dim tiny">Too few grown to spare for a war band.</p><button class="px-btn gold" data-act="dismiss">OK</button>`;
  const chief = s.people.find((p) => p.id === s.chief)?.name ?? 'The chief';
  return `<p class="dim tiny">About ${def} of them would hold their village. ${chief} can walk out and lead the band (they fight a quarter harder). Win, and the village is yours, paying tribute. Those who go don't work while they're away.</p>
    <div class="choices">${opts.map((o) => `<button class="px-btn" data-band="${v.id}:${o.n}">${o.name}: send ${o.n}<span class="tiny dim"> · ${odds(ourStrength(s, o.n, false), theirStrength(v, def))}</span></button>`).join('')}
    <button class="px-btn" data-act="dismiss">Not now</button></div>`;
}

/** A battle, to watch: two lines trading blows, round by round (played by main). */
export function battleCard(s: ShoreState, b: Battle): string {
  const v = s.villages.find((x) => x.id === b.village);
  if (!v) return '';
  const head = b.attack === 'them' ? `${cap(v.name)} fall on the village` : `The war band falls on ${v.name}`;
  const result =
    b.attack === 'them'
      ? b.won
        ? `Driven off!${b.dead ? ` ${b.dead} of ours died.` : ' None of ours died.'}`
        : `They broke through${b.took?.food || b.took?.wood ? `, and carried off ${b.took.food} food and ${b.took.wood} wood` : ', but found nothing to carry off'}.${b.dead ? ` ${b.dead} of ours died.` : ''}`
      : b.won
        ? `They're beaten.${v.vassal ? ' Their village is yours.' : ' What\'s left of them flee.'} ${b.took ? `The band brings back ${b.took.food} food and ${b.took.wood} wood.` : ''}${b.dead ? ` ${b.dead} of ours died.` : ''}`
        : `Beaten back.${b.dead ? ` ${b.dead} of ours died.` : ''}`;
  return `<p class="label dim">${b.when}</p><h3>${head}</h3>${b.led ? '<p class="dim tiny">The chief leads them.</p>' : ''}${b.rallied ? '<p class="dim tiny">Rallied.</p>' : ''}${b.walls ? '<p class="dim tiny">Behind the palisade.</p>' : ''}${b.chief !== undefined ? `<p class="dim tiny">The chief fought in the front line${b.hurt ? ', and was hurt' : ''}.</p>` : ''}
    <div class="battle" data-rounds='${JSON.stringify(b.rounds)}' data-ours="${b.ours}" data-theirs="${b.theirs}">${line(s.look, b.ours, 'us')}<span class="vs">vs</span>${line(v.look, b.theirs, 'them')}</div>
    <p class="battle-result" hidden>${result}</p>
    <button class="px-btn gold" data-act="dismiss">${b.won ? 'Good' : 'So be it'}</button>`;
}

export type { BuildId };
