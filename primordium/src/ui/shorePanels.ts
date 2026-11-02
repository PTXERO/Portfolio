// New Shore's panels, the idle way, in four tabs: the Hearth (the fire: see hearthView), Build
// (everything food is spent on: what brings it in, the homes, the upgrades, the Great Work, and
// the villages to win), the Chronicle (everything to look at: the village, the critters and their
// family trees, the island's landmarks and relics, the culture, the story so far) and the Menu.

import { type Boosts, POI_SORT, RELICS, type Find } from '../content/shore';
import { GENS, PERKS, UPGRADES, type GenId } from '../content/idle';
import { allMult, buyPerkOk, can, canCross, embersFor, embersLeft, perk, perkCost, EMBER_BIRTHS, EMBER_MORE, canDance, canTake, canWin, centre, chiefNear, count, CRITTER_MORE, danceLeft, DAY_SEC, foodRate, genCost, genOpen, genRate, giftCost, has, hearthMost, isAdult, maxBuy, poiDef, poiHere, poiName, poisOf, relation, room, shoreOf, shoreSeason, takeCost, tapValue, totalCritters, upgradeOpen, WON_MORE, workOpen, type Poi, type ShorePerson, type ShoreState, type Village } from '../economy/shore';
import { genesKey, miniIcon } from '../scene/creatureLook';
import { AGES, ageHasIdeas, ageName, greatWork, FORKS, forkOptions, IDEAS, LANES, LANES_FOR_WORK, laneShare, lanesDone, nextIdea, workReady, type ForkId } from '../economy/culture';
import type { GameState } from '../economy/types';
import { D, format as formatD } from '../economy/num';
const format = (n: number) => formatD(D(n));
import { danceStyle } from './fireDance';

const n0 = (v: number) => format(Math.floor(v + 1e-6));

/** The Chronicle's pages: the village, everyone in it, the island, the culture, the story. */
type ChronView = 'village' | 'people' | 'island' | 'culture' | 'story';
let chronView: ChronView = 'village';
export function setVillageView(v: string): void {
  chronView = (['village', 'people', 'island', 'culture', 'story'] as const).find((x) => x === v) ?? 'village';
}
/** The Chronicle's island page: the landmarks, or the relics found. (The villages are won from Build.) */
let islandView: 'villages' | 'landmarks' | 'finds' = 'villages';
export function setIslandView(v: string): void {
  islandView = v === 'landmarks' || v === 'finds' ? v : 'villages';
}
/** Build's pages: what brings food in (and the homes), the upgrades, the villages to win. */
type BuildPage = 'gather' | 'ups' | 'villages' | 'embers';
let buildPage: BuildPage = 'gather';
export function setBuildCat(c: string): void {
  buildPage = c === 'ups' || c === 'villages' || c === 'embers' ? c : 'gather';
}
/** Upgrades out of reach shown at once (the rest wait their turn: the list stays short). */
const UPS_AHEAD = 3;
/** How many at a time the Build tab buys: one, ten, or as many as there's food for. */
let buyMany: 1 | 10 | 0 = 1;
export function setBuyMany(n: number): void {
  buyMany = n === 10 ? 10 : n === 0 ? 0 : 1;
}
export function buyAmount(): number {
  return buyMany;
}

/** When a tab's panel must be rebuilt (its numbers are written in place by shoreUpdate). */
export function shoreKey(state: GameState, tab: string): string {
  const s = shoreOf(state);
  if (!s) return '';
  if (tab === 'chronicle') {
    if (chronView === 'story') return JSON.stringify(['story', s.culture ? 1 : 0]);
    if (chronView === 'island') return JSON.stringify(['chron-island', islandView, s.relics, poisOf(s).map((p) => (p.found && p.known ? p.done : -1)), poiHere(s)?.id, has(s, 'scouts'), s.villages.filter((v) => v.found).map((v) => [v.id, v.won, v.gone, Math.round(v.pop)]), s.chief]);
    if (chronView === 'culture') tab = 'culture';
    else if (chronView === 'people') return JSON.stringify(['people', s.people.length, s.chief, Math.floor(s.day / 2), !!s.culture]);
    else return JSON.stringify(['village', s.people.length, room(s), s.chief, s.ups.length, Object.values(s.gens), shoreSeason(s).si, s.villages.filter((v) => v.won !== undefined).length, !!s.culture]);
  }
  if (tab === 'culture') {
    const c = s.culture;
    return JSON.stringify(['culture', c?.age, c?.done, c?.focus, c?.forks, c?.asking?.fork, LANES.map((l) => Math.floor((c ? laneShare(c, l.id) : 0) * 20)), greatWork(s), !!workOpen(s), s.food >= (workOpen(s)?.cost ?? Infinity)]);
  }
  if (tab === 'build') {
    // (Rebuilt when what can be afforded changes: each thing's button lights as the food comes.)
    return JSON.stringify(['build', buildPage, canCross(s), embersFor(s), embersLeft(s), s.perks, buyMany, s.auto, s.ups.length, GENS.map((g) => [genOpen(s, g.id), count(s, g.id), s.food >= genCost(s, g.id, buyMany || 1)]), UPGRADES.filter((u) => upgradeOpen(s, u.id)).map((u) => [u.id, s.food >= u.cost]), !!workOpen(s), s.food >= (workOpen(s)?.cost ?? Infinity),
      s.villages.filter((v) => v.found).map((v) => [v.id, v.won, v.gone, Math.floor((v.trust ?? 0) / 5), Math.round(v.pop), s.food >= (canWin(s, v) ? giftCost(s, v) : canTake(s, v) ? takeCost(s, v).food : Infinity), chiefNear(s, v), danceLeft(s, v) > 0.5]), s.chief]);
  }
  if (tab === 'island') return JSON.stringify(['island', islandView, s.relics, poisOf(s).map((p) => (p.found && p.known ? p.done : -1)), poiHere(s)?.id, has(s, 'scouts'), s.villages.filter((v) => v.found).map((v) => [v.id, v.won, v.gone, Math.floor((v.trust ?? 0) / 5), Math.round(v.pop), s.food >= (canWin(s, v) ? giftCost(s, v) : canTake(s, v) ? takeCost(s, v).food : Infinity), chiefNear(s, v)]), s.chief]);
  return JSON.stringify(['village', s.people.length, room(s), s.chief, s.ups.length, Object.values(s.gens), shoreSeason(s).si, s.villages.filter((v) => v.won !== undefined).length, !!workOpen(s)]);
}

/** Numbers written in place, every frame (the food, the rate, a boost running down). */
export function shoreUpdate(root: HTMLElement, state: GameState): void {
  const s = shoreOf(state);
  if (!s) return;
  const put = (k: string, v: string) => {
    for (const el of root.querySelectorAll<HTMLElement>(`[data-t="${k}"]`)) if (el.textContent !== v) el.textContent = v;
  };
  put('shore-food', n0(s.food));
  put('shore-rate', `${format(foodRate(s))} a second`);
  put('shore-tap', `+${format(tapValue(s))}`);
  const now = s.day * DAY_SEC + s.clock;
  put('shore-boost', s.boost && s.boost.until > now ? `×${s.boost.mult} for ${Math.ceil(s.boost.until - now)}s` : '');
  put('shore-birth', birthLine(s));
  for (const g of GENS) put(`gen-${g.id}`, `${format(genRate(s, g.id))}/s`);
}

function birthLine(s: ShoreState): string {
  if (!count(s, 'hearth')) return 'No hearth yet.';
  if (s.people.length >= hearthMost(s)) {
    const c = centre(s);
    return `Full (${c.now.most}).${c.next ? ` ${c.next.name}: ${c.next.most}.` : ''}`;
  }
  if (s.people.length >= room(s)) return 'Beds full: build huts.';
  if (s.people.filter((p) => isAdult(s, p)).length < 2) return 'Waiting for children to grow.';
  return 'A child is on the way.';
}

export function shoreLayout(state: GameState, tab: string, story?: () => string): string {
  const s = shoreOf(state);
  if (!s) return '';
  if (tab === 'build') return buildLayout(s);
  if (tab === 'culture') return cultureLayout(s);
  if (tab === 'island') return islandLayout(s);
  // The Chronicle: everything to look at, a page at a time.
  const page = (id: ChronView, name: string, dot = false) => `<button class="px-btn${chronView === id ? ' on' : ''}" data-villageview="${id}">${name}${dot ? ' <i class="dot"></i>' : ''}</button>`;
  if (chronView === 'culture' && !s.culture) chronView = 'village';
  const views = `<div class="seg build-cats chron-pages">${page('village', 'Village')}${page('people', `Critters · ${s.people.length}`)}${page('island', 'Island')}${s.culture ? page('culture', 'Culture', !!s.culture.asking) : ''}${page('story', 'Story')}</div>`;
  if (chronView === 'people') return views + peopleLayout(s);
  if (chronView === 'island') return views + islandLayout(s);
  if (chronView === 'culture') return views + cultureLayout(s);
  if (chronView === 'story') return views + (story?.() ?? '');
  return views + `<div class="seg build-cats"><button class="px-btn" data-camera="home">See the hearth</button><button class="px-btn" data-camera="chief">See the chief</button></div>` + hearthCard(s) + peopleCard(s);
}

/** The hearth: what comes in, the critters and their beds. */
function hearthCard(s: ShoreState): string {
  if (!count(s, 'hearth')) {
    return `<div class="card px-box"><div class="info"><div class="name">No village yet</div>
      <div class="sub">Light the hearth (the Hearth tab).</div></div></div>`;
  }
  const mult = allMult(s);
  return `<div class="panel-head"><h2>The Village</h2><span class="dim">${ageName(s.culture?.age ?? 0) || 'The first years'}</span></div>
    <div class="card px-box ex-stores shore-stores">
      <div class="store"><span class="label dim">Food</span><b class="num"><span data-t="shore-food">${n0(s.food)}</span></b><span class="dim" data-t="shore-rate">${format(foodRate(s))} a second</span></div>
      <div class="store"><span class="label dim">Critters</span><b class="num">${s.people.length}<span class="dim">/${Math.min(room(s), hearthMost(s))}</span></b><span class="dim">+${Math.round(CRITTER_MORE * 100)}% food each</span></div>
      <div class="sub">All food ×${mult.toFixed(2)}. <b class="green" data-t="shore-boost"></b></div>
      ${s.embers ? `<div class="sub">${s.embers} embers ever (food +${Math.round(s.embers * EMBER_MORE * 100)}%, births +${Math.round(s.embers * EMBER_BIRTHS * 100)}%) · ${embersLeft(s)} to spend · island ${(s.crossings ?? 0) + 1}</div>` : ''}
      <div class="sub dim"><span data-t="shore-birth">${birthLine(s)}</span></div>
    </div>`;
}

/** What brings food in, and what houses them: buy one, ten, or as many as there's food for; and
 * the upgrades, once they're on offer. */
function buildLayout(s: ShoreState): string {
  // (Before the hearth's lit, only the embers can be spent: just landed is when they're wanted.)
  if (!count(s, 'hearth')) {
    const note = `<div class="card px-box"><div class="info"><div class="sub">Light the hearth first (the Hearth tab).</div></div></div>`;
    if (!s.embers) return note;
    buildPage = 'embers';
  }
  const ups = UPGRADES.filter((u) => upgradeOpen(s, u.id)).sort((a, b) => a.cost - b.cost);
  const w = workOpen(s);
  // (How many on each page can be bought just now: a number on its button.)
  const canGen = GENS.filter((g) => genOpen(s, g.id) && s.food >= genCost(s, g.id, 1)).length;
  const canUp = ups.filter((u) => s.food >= u.cost).length;
  const found = s.villages.filter((v) => v.found && !v.gone && v.won === undefined);
  const canVil = found.filter((v) => s.food >= (canWin(s, v) ? giftCost(s, v) : canTake(s, v) ? takeCost(s, v).food : Infinity)).length + (canCross(s) ? 1 : 0);
  const page = (id: BuildPage, name: string, n: number) => `<button class="px-btn${buildPage === id ? ' on' : ''}" data-buildcat="${id}">${name}${n ? ` <span class="can">${n}</span>` : ''}</button>`;
  const canPerk = PERKS.filter((p) => buyPerkOk(s, p.id)).length;
  const pages = `<div class="seg build-cats">${page('gather', 'Gather', canGen)}${page('ups', 'Upgrades', canUp)}${page('villages', 'Villages', canVil)}${s.embers ? page('embers', 'Embers', canPerk) : ''}</div>`;
  const head = `<div class="panel-head"><h2>Build</h2><span class="dim"><span data-t="shore-food">${n0(s.food)}</span> food</span></div>`;
  // (The Great Work, when it's on offer, sits on top of every page: it closes the Age.)
  const work = w ? `<div class="card px-box build raid"><div class="info"><div class="name">${w.name}</div><div class="sub">${w.does}</div></div><button class="px-btn buy${s.food >= w.cost ? ' gold' : ''}" data-act="work"${s.food >= w.cost ? '' : ' disabled'}><span class="num">${format(w.cost)}</span></button></div>` : '';
  if (buildPage === 'villages') return pages + head + work + crossCard(s) + villagesCard(s);
  if (buildPage === 'embers' && s.embers) {
    if (!count(s, 'hearth')) return `<div class="card px-box"><div class="info"><div class="sub">Light the hearth first (the Hearth tab).</div></div></div>` + emberShop(s, '');
    return emberShop(s, pages);
  }
  return gatherPage(s, pages, head, work, ups);
}

/** What embers buy, for good (spending them never takes from their boost). */
function emberShop(s: ShoreState, pages: string): string {
  const all = s.embers ?? 0;
  {
    const row = (p: (typeof PERKS)[number]) => {
      const lv = perk(s, p.id);
      const cost = perkCost(s, p.id);
      const ok = buyPerkOk(s, p.id);
      return `<div class="card px-box build"><div class="info"><div class="name">${p.name} <span class="dim">${lv}/${p.most}</span></div><div class="sub">${p.does}</div></div>${cost === null ? '<span class="dim tiny">Done</span>' : `<button class="px-btn buy${ok ? ' gold' : ''}" data-perk="${p.id}"${ok ? '' : ' disabled'}><span class="num">${cost}</span> ✦</button>`}</div>`;
    };
    return `${pages}<div class="panel-head"><h2>Embers</h2><span class="dim">${embersLeft(s)} to spend</span></div>
      <p class="tiny dim">All ${all} ever: food +${Math.round(all * EMBER_MORE * 100)}%, births +${Math.round(all * EMBER_BIRTHS * 100)}%. Spending keeps that.</p>
      ${PERKS.map(row).join('')}`;
  }
}

function gatherPage(s: ShoreState, pages: string, head: string, work: string, ups: typeof UPGRADES): string {
  if (buildPage === 'ups') {
    // Everything that can be bought now, and the next few out of reach (the rest come later).
    const shown = [...ups.filter((u) => s.food >= u.cost), ...ups.filter((u) => s.food < u.cost).slice(0, UPS_AHEAD)];
    const more = ups.length - shown.length;
    const upRow = (u: (typeof UPGRADES)[number]) => `<div class="card px-box build"><div class="info"><div class="name">${u.name}</div><div class="sub">${u.does}</div></div><button class="px-btn buy${s.food >= u.cost ? ' gold' : ''}" data-upgrade="${u.id}"${s.food >= u.cost ? '' : ' disabled'}><span class="num">${format(u.cost)}</span></button></div>`;
    const isFire = (u: (typeof UPGRADES)[number]) => u.fx.kind.startsWith('fire') || u.fx.kind === 'tap' || u.fx.kind === 'tapRate';
    const fire = shown.filter(isFire);
    const rest = shown.filter((u) => !isFire(u));
    return `${pages}${head}${work}
      ${fire.length ? `<div class="panel-head"><h2>The fire</h2></div>${fire.map(upRow).join('')}` : ''}
      ${rest.length ? `<div class="panel-head"><h2>The village</h2></div>${rest.map(upRow).join('')}` : ''}
      ${more ? `<p class="tiny dim">${more} more to come, as there's the food for them.</p>` : ''}
      ${!shown.length ? '<p class="tiny dim">Nothing just now: more come as the village grows.</p>' : ''}`;
  }
  // (×10 and Max are learned: Tally sticks, Counting stones.)
  if ((buyMany === 10 && !can(s, 'buy10')) || (buyMany === 0 && !can(s, 'buymax'))) buyMany = 1;
  const amounts = ([1, 10, 0] as const).filter((n) => n === 1 || (n === 10 ? can(s, 'buy10') : can(s, 'buymax')));
  const many = `<div class="seg build-cats">${(amounts.length > 1 ? amounts : []).map((n) => `<button class="px-btn${buyMany === n ? ' on' : ''}" data-buymany="${n}">${n ? `×${n}` : 'Max'}</button>`).join('')}${has(s, 'council') ? `<span class="seg-gap"></span><button class="px-btn${s.auto ? ' on' : ''}" data-act="auto">Council: ${s.auto ? 'buying' : 'resting'}</button>` : ''}</div>`;
  const gens = GENS.filter((g) => genOpen(s, g.id)).map((g) => genRow(s, g.id)).join('');
  const next = GENS.find((g) => !genOpen(s, g.id) && g.critters !== undefined);
  return `${pages}${head}${work}${many}${gens}
    ${next ? `<p class="tiny dim">More to come as the village grows (at ${next.critters} critters).</p>` : ''}`;
}

function genRow(s: ShoreState, id: GenId): string {
  const g = GENS.find((x) => x.id === id)!;
  const have = count(s, id);
  const n = buyMany || Math.max(1, maxBuy(s, id));
  const cost = genCost(s, id, n);
  const can = s.food >= cost;
  return `<div class="card px-box build"><div class="info"><div class="name">${g.name} <span class="dim">×${have}</span></div><div class="sub">${g.does}</div>
    <div class="sub fx">${g.rate ? `<span data-t="gen-${id}">${format(genRate(s, id))}/s</span> in all` : `Room for ${g.room} each`}</div></div>
    <button class="px-btn buy${can ? ' gold' : ''}" data-sgen="${id}"${can ? '' : ' disabled'}>${n > 1 ? `×${n} ` : ''}<span class="num">${format(cost)}</span></button></div>`;
}

// ---- The island ----

function islandLayout(s: ShoreState): string {
  const marks = poisOf(s).filter((p) => p.found && p.known && p.done < poiDef(p).layers.length).length;
  const tab = (id: typeof islandView, name: string) => `<button class="px-btn${islandView === id ? ' on' : ''}" data-islandview="${id}">${name}</button>`;
  if (islandView === 'villages') islandView = 'landmarks';
  const views = `<div class="seg build-cats">${tab('landmarks', `Landmarks · ${marks}`)}${tab('finds', 'Relics')}</div>`;
  const head = `<div class="panel-head"><h2>The island</h2></div>${islandCounts(s)}${scoutsCard(s)}`;
  if (islandView === 'finds') return head + views + relicsCard(s);
  return head + views + landmarksCard(s);
}

/** The island in numbers: the villages found and won, the critters of other kinds, the landmarks. */
function islandCounts(s: ShoreState): string {
  const found = s.villages.filter((v) => v.found && !v.gone);
  const won = found.filter((v) => v.won !== undefined).length;
  const marks = poisOf(s).filter((p) => p.found).length;
  const others = s.people.filter((p) => p.kind !== undefined).length;
  return `<div class="card px-box"><div class="info"><div class="sub">${found.length} village${found.length === 1 ? '' : 's'} found${found.length < s.villages.length ? ' (more in the fog)' : ''} · ${won} won · ${marks} landmark${marks === 1 ? '' : 's'} found · ${s.relics?.length ?? 0} relic${(s.relics?.length ?? 0) === 1 ? '' : 's'}${others ? ` · ${others} critters of other kinds among yours` : ''}</div></div></div>`;
}

/** Setting out for a new island: once every village is won. */
function crossCard(s: ShoreState): string {
  const left = s.villages.filter((v) => v.won === undefined && !v.gone).length;
  const n = embersFor(s);
  if (!canCross(s)) return `<div class="card px-box"><div class="info"><div class="name">A new island</div><div class="sub">Win every village to set out (${left} left). Now worth +${n} embers.</div></div></div>`;
  return `<div class="card px-box build raid"><div class="info"><div class="name">Set out for a new island</div><div class="sub">+${n} ember${n === 1 ? '' : 's'}: food +${Math.round(n * EMBER_MORE * 100)}%, births +${Math.round(n * EMBER_BIRTHS * 100)}%. Worth more the longer you stay.</div></div><button class="px-btn buy gold" data-act="cross-ask">Set out</button></div>`;
}

function villagesCard(s: ShoreState): string {
  const found = s.villages.filter((v) => v.found && !v.gone);
  if (!found.length) return `<div class="panel-head"><h2>The villages</h2></div><div class="card px-box"><div class="info"><div class="sub">Smoke inland. Tap the land to send the chief.</div></div></div>`;
  const won = found.filter((v) => v.won !== undefined);
  const rest = found.filter((v) => v.won === undefined).sort((a, b) => Math.hypot(a.x - s.hearth.x, a.y - s.hearth.y) - Math.hypot(b.x - s.hearth.x, b.y - s.hearth.y));
  return `<div class="panel-head"><h2>The villages</h2><span class="dim">${found.length} of ${s.villages.length}${found.length < s.villages.length ? '+' : ''} found · ${won.length} won</span></div>
    <p class="tiny dim">Each won: +${Math.round(WON_MORE * 100)}% food. Kin: gifts. Others: beat them.</p>
    ${rest.map((v) => villageRow(s, v)).join('')}${won.map((v) => villageRow(s, v)).join('')}`;
}

function villageRow(s: ShoreState, v: Village): string {
  const rel = relation(s, v);
  const icon = `<span class="kind">${miniIcon(v.look, 2)}</span>`;
  const near = chiefNear(s, v);
  if (v.won !== undefined) {
    return `<div class="card px-box village vassal">${icon}<div class="info"><div class="name">${cap(v.name)} <span class="rel rel-vassal">Yours</span></div>
      <div class="sub">${Math.round(v.pop)} of them. +${Math.round(WON_MORE * 100)}% food.</div></div>
      <div class="col">${near && canDance(s, v) ? `<button class="px-btn gold" data-dance="${v.id}"${danceLeft(s, v) > 0.5 ? '' : ' disabled'}>${danceLeft(s, v) > 0.5 ? 'Dance' : 'Worn out'}</button>` : `<button class="px-btn" data-visit="${v.id}">Visit</button>`}</div></div>`;
  }
  if (canWin(s, v)) {
    const cost = giftCost(s, v);
    return `<div class="card px-box village">${icon}<div class="info"><div class="name">${cap(v.name)} <span class="rel rel-kin">Kin</span></div>
      <div class="sub">${Math.round(v.pop)} of them. ${near ? 'Chief here: gifts ×2.' : 'Gifts ×2 with the chief.'}</div>${trustBar(v)}</div>
      <div class="col"><button class="px-btn${s.food >= cost ? ' gold' : ''}" data-gift="${v.id}"${s.food >= cost ? '' : ' disabled'}>Gift ${format(cost)}</button>${near ? `<button class="px-btn gold" data-dance="${v.id}"${danceLeft(s, v) > 0.5 ? '' : ' disabled'}>${danceLeft(s, v) > 0.5 ? 'Dance' : 'Worn out'}</button>` : `<button class="px-btn" data-visit="${v.id}">Visit</button>`}</div></div>`;
  }
  const c = takeCost(s, v);
  const ok = s.food >= c.food && totalCritters(s) >= c.critters;
  return `<div class="card px-box village">${icon}<div class="info"><div class="name">${cap(v.name)} <span class="rel rel-${rel}">${REL_NAME[rel]}</span></div>
    <div class="sub">${Math.round(v.pop)} ${DIET_NAME[v.diet] ?? v.diet}. Needs ${format(c.food)} food, ${c.critters} critters${totalCritters(s) < c.critters ? ` (have ${totalCritters(s)})` : ''}.</div></div>
    <div class="col"><button class="px-btn${ok ? ' gold' : ''}" data-take="${v.id}"${ok ? '' : ' disabled'}>Beat them</button>${near ? `<button class="px-btn" data-dance="${v.id}"${danceLeft(s, v) > 0.5 ? '' : ' disabled'}>Dance</button>` : ''}</div></div>`;
}

/** A village's card (tapped on the map). */
export function villageCard(s: ShoreState, v: Village): string {
  const rel = relation(s, v);
  return `<p class="label dim">${v.won !== undefined ? 'Yours' : REL_NAME[rel]}</p><div class="village-head"><span class="kind">${miniIcon(v.look, 3)}</span><h3>${cap(v.name)}</h3></div>
    <p>${Math.round(v.pop)} of them, ${v.cannibal ? 'eaters of their own kind' : `${(DIET_NAME[v.diet] ?? v.diet).toLowerCase()}`}, another kind altogether.${v.habitat ? ` ${WHERE[v.habitat]}` : ''}</p>
    <p class="dim">${v.won !== undefined ? `Yours: +${Math.round(WON_MORE * 100)}% food.` : REL_LINE[rel]}</p>
    ${chiefNear(s, v) ? `<p class="dim tiny">Dance: all food ×2 while it lasts.</p>` : ''}
    <div class="choices">${villageRow(s, v).match(/<div class="col">([\s\S]*)<\/div><\/div>$/)?.[1] ?? ''}<button class="px-btn" data-act="dismiss">OK</button></div>`;
}

function scoutsCard(s: ShoreState): string {
  return `<div class="card px-box"><div class="info"><div class="name">Out in the fog</div>
    <div class="sub">${has(s, 'scouts') ? 'Two scouts exploring.' : 'No scouts yet.'} Tap the land to send ${s.people.find((p) => p.id === s.chief)?.name ?? 'the chief'}.</div></div></div>`;
}

const REL_LINE = {
  kin: 'Kin: win them with gifts.',
  prey: 'Prey: beat them.',
  predator: 'Predators: beat them.',
  enemy: 'Enemies.',
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

function landmarksCard(s: ShoreState): string {
  // (Explored to the end, a landmark's gone from the list as from the map: what it held is in
  // the relics, the know-how and the Chronicle.)
  const all = poisOf(s).filter((p) => p.found && p.known);
  const found = all.filter((p) => p.done < poiDef(p).layers.length);
  const gone = all.length - found.length;
  const head = `<div class="panel-head"><h2>Landmarks</h2><span class="dim">${found.length} to explore${gone ? ` · ${gone} explored` : ''}</span></div>`;
  if (!found.length) return `${head}<div class="card px-box"><div class="info"><div class="sub">${gone ? 'Nothing left to explore that you know of. There may be more out in the fog.' : 'None yet. Keep your eyes open out there.'}</div></div></div>`;
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
  const build = undefined as { name: string; does: string } | undefined;
  const got = dup
    ? `<p class="dim">They have one like it already: what was there is taken as food.</p>`
    : `${relic ? `<p class="fx">Relic: <b>${relic.name}</b>. ${relic.does}</p>` : ''}${build ? `<p class="fx">Learned: <b>${build.name}</b> (in Build). ${build.does}</p>` : ''}${f.food || f.wood ? '<p class="fx">Food, brought back.</p>' : ''}`;
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
  return `<div class="panel-head"><h2>The Critters</h2><span class="dim">${s.people.length}</span></div>
    <div class="card px-box"><div class="info"><div class="sub">${[...kinds].map(([k, n]) => `${n} ${k}`).join(' · ')}</div>
</div></div>
    <p class="tiny dim">Tap anyone for their family tree.</p>
    <div class="card px-box people-list"><div class="info">${list
      .map((p) => `<button class="person" data-tree="${p.id}">${iconOf(p)}<b>${p.name}</b><span class="dim">${p.id === s.chief ? 'chief' : p.founder ? 'one of the four' : age(p)}</span></button>`)
      .join('')}</div></div>`;
}


function peopleCard(s: ShoreState): string {
  const four = s.people.filter((p) => p.founder);
  const chief = s.people.find((p) => p.id === s.chief);
  const grown = s.people.filter((p) => !p.founder && isAdult(s, p)).length;
  const young = s.people.filter((p) => !isAdult(s, p)).length;
  return `<div class="card px-box"><div class="info"><div class="name">${chief ? `${chief.name} leads` : 'The critters'}</div>
    <div class="sub">${four.length ? `Of the four who crossed: ${four.map((p) => p.name).join(', ')}.` : 'The four who crossed are all gone.'} ${grown ? `${grown} born here and grown. ` : ''}${young ? `${young} children.` : ''}</div>
    <div class="sub dim">${s.births} born · ${s.deaths} dead.</div></div></div>`;
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


const cap = (t: string) => t[0].toUpperCase() + t.slice(1);

/** The Long Road: the Age, its lanes (what each has come to, and how near the next), the forks
 * taken (and the roads not taken, greyed), and the Age's Great Work. */
function cultureLayout(s: ShoreState): string {
  const c = s.culture;
  if (!c) return '';
  const name = ageName(c.age);
  const work = greatWork(s);
  const workName = AGES[c.age]?.workName ?? '';
  const done = lanesDone(c);
  const lanes = LANES.map((l) => {
    const ideas = IDEAS.filter((i) => i.lane === l.id && i.age === c.age);
    const next = nextIdea(c, l.id);
    const share = laneShare(c, l.id);
    const steps = ideas
      .map((i) => (c.done.includes(i.id) ? `<span class="road-idea done" title="${i.does}">${i.name}</span>` : i === next ? `<span class="road-idea next">???<i class="road-bar" style="width:${Math.round(share * 100)}%"></i></span>` : '<span class="road-idea fog">???</span>'))
      .join('<span class="road-step">›</span>');
    return `<div class="card px-box road-lane${c.focus === l.id ? ' focused' : ''}"><div class="info"><div class="name">${l.name}${next ? '' : ' <span class="tiny dim">· done for this Age</span>'}</div>
      <div class="road-steps">${steps}</div></div>
      <div class="col">${next && has(s, 'lore') ? `<button class="px-btn${c.focus === l.id ? ' on' : ''}" data-focus="${c.focus === l.id ? '' : l.id}">${c.focus === l.id ? 'Focused' : 'Focus'}</button>` : ''}</div></div>`;
  }).join('');
  const asking = c.asking ? `<div class="card px-box raid"><div class="info"><div class="name">${FORKS[c.asking.fork].name}</div><div class="sub">${FORKS[c.asking.fork].ask}</div></div><div class="col"><button class="px-btn gold" data-forkcard="${c.asking.fork}">Decide</button></div></div>` : '';
  const workCard = !work
    ? `<div class="card px-box"><div class="info"><div class="name">${name}</div><div class="sub">More in a future update.</div></div></div>`
    : `<div class="card px-box"><div class="info"><div class="name">The Age's Great Work: ${workName}</div><div class="sub">${workReady(s) ? `Ready: see Build.` : `Needs ${LANES_FOR_WORK} lanes done (${done} so far).`}</div></div></div>`;
  if (!ageHasIdeas(c.age)) return `<div class="panel-head"><h2>The Long Road</h2><span class="dim">${name}</span></div>${workCard}${forksCard(s)}`;
  return `<div class="panel-head"><h2>The Long Road</h2><span class="dim">${name}</span></div>
    ${asking}${workCard}${lanes}${forksCard(s)}`;
}


/** The forks taken (the roads not taken, greyed). */
function forksCard(s: ShoreState): string {
  const c = s.culture;
  if (!c) return '';
  const forks = Object.entries(c.forks).map(([f, o]) => {
    const def = FORKS[f as ForkId];
    return `<div class="sub">${def.name}: ${forkOptions(s, f as ForkId).map((x) => (x.id === o ? `<b>${x.name}</b>` : `<span class="road-not">${x.name}</span>`)).join(' · ')}</div>`;
  }).join('');
  return forks ? `<div class="panel-head"><h2>Chosen</h2></div><div class="card px-box"><div class="info">${forks}</div></div>` : '';
}


/** What a boost does, in words. */
const FX_WORDS: Partial<Record<keyof Boosts, (n: number) => string>> = {
  food: (n) => `All food +${pc(n)}`, tap: (n) => `Stoke +${pc(n)}`, births: (n) => `Births +${pc(n)}`, grow: (n) => `Growing up +${pc(n)}`,
  speed: (n) => `Walk +${pc(n)}`, sight: (n) => `Sight +${n}`, gift: (n) => `Gift trust +${pc(n)}`,
};

const pc = (n: number) => `${Math.round(n * 100)}%`;

function fxWords(fx?: Partial<Boosts>): string[] {
  return Object.entries(fx ?? {}).map(([k, n]) => FX_WORDS[k as keyof Boosts]?.(n as number)).filter((x): x is string => !!x);
}


/** A fork, as cards to choose between. */
export function forkCard(s: ShoreState, fork: ForkId): string {
  const def = FORKS[fork];
  return `<p class="label dim">A choice for your critters</p><h3>${def.name}</h3><p>${def.ask}</p><p class="dim tiny">For good.</p>
    ${deck(forkOptions(s, fork).map((o) => ({ act: `${fork}:${o.id}`, title: o.name, line: o.line, good: [...(o.lane ? [`${LANES.find((l) => l.id === o.lane)!.name} ideas +25%`] : []), ...fxWords(o.fx)], bad: [] })), 'fork')}`;
}


/** Dancing with a village: circles drawn round their fire, their way. */
export function danceCard(s: ShoreState, v: Village): string {
  const chief = s.people.find((p) => p.id === s.chief)?.name ?? 'The chief';
  return `<p class="label dim">${cap(v.name)}</p><h3>${chief} dances round their fire</h3>
    <p class="dim tiny">Draw circles round the fire. ${danceStyle(v.habitat).line}</p>
    <div class="dance" data-dancev="${v.id}"><canvas class="fire-dance"></canvas>
      <div class="dance-info"><span class="dance-streak tiny">Round the fire</span><span class="dance-left tiny dim"></span></div>
      ${canWin(s, v) ? trustBar(v) : ''}<div class="sub tiny dim">All food ×2: <b class="green" data-t="shore-boost"></b></div></div>
    <div class="choices"><button class="px-btn" data-act="dismiss">Rest</button></div>`;
}

