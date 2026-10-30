// New Shore's panels: the Village (stores, who's working at what, the people), Build (by sort:
// homes, stores, work, exploring) and the Island (the villages found out there, and the scouts).

import { BUILD_CATS, BUILDS, buildName, type BuildCat, type BuildDef, type BuildId } from '../content/shore';
import { buildCost, buildsOpen, canWin, RAFT_WOOD, chiefNear, count, foodCap, giftCost, shoreSeason, isAdult, relation, room, shoreOf, woodCap, workPlan, type Lean, type ShoreState, type Village } from '../economy/shore';
import { miniIcon } from '../scene/creatureLook';
import type { GameState } from '../economy/types';

const n0 = (v: number) => String(Math.floor(v + 1e-6));

const REL_LINE = {
  kin: 'Your own diet: they could be won over.',
  prey: 'They eat what you hunt, or are what you hunt: yours to raid.',
  predator: 'They hunt your kind. Expect them to come.',
  enemy: 'Enemies. Nothing will ever change that.',
} as const;
const REL_NAME = { kin: 'Kin', prey: 'Prey', predator: 'Predators', enemy: 'Enemies' } as const;
const DIET_NAME: Record<string, string> = { grazer: 'Grazers', hunter: 'Hunters', omnivore: 'Omnivores' };

/** The Build tab's sort on show (kept while you're in the stage). */
let buildCat: BuildCat = 'homes';
export function setBuildCat(c: string): void {
  if (BUILD_CATS.some((x) => x.id === c)) buildCat = c as BuildCat;
}

/** When a tab's panel must be rebuilt (its numbers are written in place by shoreUpdate). */
export function shoreKey(state: GameState, tab: string): string {
  const s = shoreOf(state);
  if (!s) return '';
  if (tab === 'build') return JSON.stringify([buildCat, s.raftTaken, s.built.length, buildsOpen(s).map((b) => [b.id, s.wood >= buildCost(s, b.id)])]);
  if (tab === 'island') return JSON.stringify([count(s, 'scout'), s.villages.filter((v) => v.found).map((v) => [v.id, v.joined, Math.floor((v.trust ?? 0) / 5), s.food >= giftCost(v)]), s.chief]);
  const plan = workPlan(s);
  return JSON.stringify([shoreSeason(s).si, s.people.length, s.built.length, s.lean, plan.food, plan.wood, s.chief, s.people.filter((p) => isAdult(s, p)).length, s.people.filter((p) => p.founder).length]);
}

export function shoreUpdate(root: HTMLElement, state: GameState): void {
  const s = shoreOf(state);
  if (!s) return;
  const put = (k: string, v: string) => {
    const el = root.querySelector<HTMLElement>(`[data-t="${k}"]`);
    if (el && el.textContent !== v) el.textContent = v;
  };
  put('shore-food', n0(s.food));
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
  return [storesCard(s), workCard(s), peopleCard(s)].join('');
}

/** Whether a sort of building has anything in it yet (built, or to build). */
function catShown(s: ShoreState, c: BuildCat): boolean {
  return BUILDS.some((b) => b.cat === c && (count(s, b.id) > 0 || buildsOpen(s).includes(b)));
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
      <div class="sub diet">${seasonLine(s)}<span data-t="shore-birth">${birthLine(s)}</span></div>
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
  return `<div class="card px-box lean"><div class="info"><div class="name">What they work at</div>
    <div class="sub">${plan.food} gathering food, ${plan.wood} cutting wood${kids > 0 ? `, ${kids} too young` : ''}. They work it out for themselves; you set what they lean toward.</div></div>
    <div class="seg">${LEANS.map((l) => `<button class="px-btn${s.lean === l.id ? ' gold' : ''}" data-lean="${l.id}">${l.name}</button>`).join('')}</div></div>`;
}

function buildLayout(s: ShoreState): string {
  const open = buildsOpen(s);
  const cats = BUILD_CATS.filter((c) => catShown(s, c.id));
  if (!cats.some((c) => c.id === buildCat)) buildCat = cats[0]?.id ?? 'homes';
  // A dot on a sort with something in it you can build now.
  const can = (c: BuildCat) => open.some((b) => b.cat === c && s.wood >= buildCost(s, b.id));
  const tabs = cats.length > 1 ? `<div class="seg build-cats">${cats.map((c) => `<button class="px-btn${c.id === buildCat ? ' on' : ''}" data-buildcat="${c.id}">${c.name}${can(c.id) && c.id !== buildCat ? '<i class="dot"></i>' : ''}</button>`).join('')}</div>` : '';
  const rows = BUILDS.filter((b) => b.cat === buildCat && (open.includes(b) || count(s, b.id) > 0))
    .map((b) => buildRow(s, b, open.includes(b)))
    .join('');
  const locked = BUILDS.filter((b) => !open.includes(b) && !count(s, b.id)).length;
  const raft = s.raftTaken
    ? ''
    : `<div class="card px-box build"><div class="info"><div class="name">The raft</div><div class="sub">Pulled up on the beach where it landed. Its logs would make good wood.</div></div>
      <button class="px-btn buy gold" data-act="take-raft">Break it up<br><span class="tiny">+${RAFT_WOOD} wood</span></button></div>`;
  return `<div class="panel-head"><h2>Build</h2><span class="dim"><span data-t="shore-wood">${n0(s.wood)}</span> wood</span></div>${raft}${tabs}${rows}${locked ? `<p class="dim tiny">More to build once there's a ${count(s, 'hearth') ? 'hut' : 'hearth'}.</p>` : ''}`;
}

/** One kind of building: how many there are, what the next costs (or that it's all built). */
function buildRow(s: ShoreState, b: BuildDef, open: boolean): string {
  const have = count(s, b.id);
  const name = `${buildName(b.id, s.look.diet)}${have && b.max !== 1 ? ` <span class="dim">×${have}</span>` : ''}`;
  if (!open) return `<div class="card px-box build done"><div class="info"><div class="name">${name}</div><div class="sub">${b.does}</div></div><span class="tag">Built</span></div>`;
  const cost = buildCost(s, b.id);
  const poor = s.wood < cost;
  return `<div class="card px-box build"><div class="info"><div class="name">${name}</div><div class="sub">${b.does}</div></div>
    <button class="px-btn buy${poor ? '' : ' gold'}" data-build="${b.id}"${poor ? ' disabled' : ''}><span class="num">${cost}</span> wood</button></div>`;
}

function islandLayout(s: ShoreState): string {
  const scouts = count(s, 'scout');
  const out = `<div class="card px-box"><div class="info"><div class="name">Out in the fog</div>
    <div class="sub">${scouts ? `${scouts} scout${scouts > 1 ? 's are' : ' is'} out exploring for you.` : 'No scouts yet (build a Scout\'s hut to send one out).'} Tap the land to send ${s.people.find((p) => p.id === s.chief)?.name ?? 'the chief'} walking.</div></div></div>`;
  return villagesCard(s) + out;
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
  const win = canWin(s, v);
  return `<div class="card px-box village"><span class="kind">${miniIcon(v.look, 2)}</span><div class="info"><div class="name">${cap(v.name)} <span class="rel rel-${rel}">${REL_NAME[rel]}</span></div>
    <div class="sub">${v.pop} ${v.cannibal ? 'eaters of their own' : DIET_NAME[v.diet] ?? v.diet}. ${win ? '' : REL_LINE[rel]}</div>${win ? trustBar(v) : ''}</div>
    <div class="col">${win ? `<button class="px-btn${s.food >= giftCost(v) ? ' gold' : ''}" data-gift="${v.id}"${s.food >= giftCost(v) ? '' : ' disabled'}>Gift ${giftCost(v)}</button>` : ''}<button class="px-btn" data-seevillage="${v.id}">Look</button></div></div>`;
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
    <p>${v.pop} of them, ${v.cannibal ? 'eaters of their own kind' : `${(DIET_NAME[v.diet] ?? v.diet).toLowerCase()}`}, another kind altogether.</p>
    <p class="dim">${REL_LINE[rel]}</p>
    ${actions}`;
}

const cap = (t: string) => t[0].toUpperCase() + t.slice(1);

export type { BuildId };
