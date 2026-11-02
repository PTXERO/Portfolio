// The Age of Sail's panels: the trade network (routes and their ships, new routes to open, the
// network's upgrades), then your islands to go and see.

import type { GameState } from '../economy/types';
import { conquerCost, giftCost, giftTrust, joinedCount, kin, level, milestone, openCost, ours, routeOptions, routeRate, SAIL_UPS, shipCost, shipsAffordable, shipsOut, toWin, upCost, voyageCost, voyageTarget, voyageTime, type World, type WorldIsle } from '../economy/sail';
import { langOf, shoreOf } from '../economy/shore';
import { namePlace } from '../economy/language';
import { D, format as formatD } from '../economy/num';

const format = (n: number) => formatD(D(n));

/** How many ships a buy takes: one, ten, or as many as there's Influence for. */
let sailMany: 1 | 10 | 0 = 1;
export function setSailMany(n: number): void {
  sailMany = n === 10 ? 10 : n === 0 ? 0 : 1;
}

/** What an island's called: yours by number (home is home), anyone else's by your critters'
 * own words for it (what it looks like from the sea). */
export function isleName(state: GameState, i: WorldIsle): string {
  if (i.mine === -1) return 'Home';
  if (i.mine !== undefined) return `Island ${i.mine + 1}`;
  const s = shoreOf(state);
  if (!s) return 'An island';
  const lang = langOf(s);
  const THINGS = ['water', 'wood', 'stone', 'sun', 'fish', 'star', 'root', 'rain'];
  const LOOKS = ['far', 'big', 'small', 'old', 'warm', 'cold', 'good', 'new'];
  const key = `w${i.id}`;
  const f = lang.places?.[key]?.f ?? namePlace(lang, key, [THINGS[i.id % THINGS.length], LOOKS[(i.id * 3) % LOOKS.length]], s.day);
  return f ? f.charAt(0).toUpperCase() + f.slice(1) : 'An island';
}

function influence(state: GameState): number {
  return state.stages.sail.currency.toNumber();
}
function shipsToBuy(world: World, i: number, have: number): number {
  const r = world.routes![i];
  return sailMany === 0 ? Math.max(1, shipsAffordable(world, r, have)) : sailMany;
}

export function sailKey(state: GameState): string {
  const world = state.stages.sail.world;
  if (!world) return '';
  const have = influence(state);
  return JSON.stringify([
    !!world.voyage,
    world.voyages,
    have >= voyageCost(world),
    world.isles.filter((i) => i.found && !ours(i)).map((i) => [i.id, Math.floor((i.trust ?? 0) / 5), have >= giftCost(world, i), have >= conquerCost(world, i).influence && shipsOut(world) >= conquerCost(world, i).ships]),
    sailMany,
    world.routes?.map((r, i) => [r.ships, have >= shipCost(world, r, shipsToBuy(world, i, have))]),
    routeOptions(world).slice(0, 2).map((x) => [x.id, have >= openCost(world, x.id)]),
    SAIL_UPS.map((u) => [level(world, u.id), have >= (upCost(world, u.id) ?? Infinity)]),
  ]);
}

export function worldLayout(state: GameState): string {
  const world = state.stages.sail.world;
  if (!world) return '';
  const have = influence(state);
  const amounts = [1, 10, 0].map((n) => `<button class="px-btn${sailMany === n ? ' on' : ''}" data-sailmany="${n}">${n ? `×${n}` : 'Max'}</button>`).join('');
  const routes = (world.routes ?? [])
    .map((r, i) => {
      const isle = world.isles[r.to];
      const n = shipsToBuy(world, i, have);
      const cost = shipCost(world, r, n);
      const next = [10, 25, 50, 100].find((m) => r.ships < m);
      return `<div class="card px-box build"><div class="info"><div class="name">${isleName(state, isle)} <span class="dim">×${r.ships}</span></div>
        <div class="sub"><span class="green" data-t="route-${i}">${format(routeRate(state, world, r, i))}/s</span>${next ? ` · ×2 at ${next} ships` : ''}${milestone(r.ships) ? ` · ×${2 ** milestone(r.ships)}` : ''}</div></div>
        <button class="px-btn buy${have >= cost ? ' gold' : ''}" data-routebuy="${i}" data-n="${n}"${have >= cost ? '' : ' disabled'}>${n > 1 ? `+${n} · ` : ''}${format(cost)}</button></div>`;
    })
    .join('');
  const opens = routeOptions(world)
    .slice(0, 2)
    .map((x) => {
      const c = openCost(world, x.id);
      return `<div class="card px-box build"><div class="info"><div class="name">A route to ${isleName(state, x)}</div><div class="sub">${x.mine !== undefined ? 'One of yours.' : 'Not yours: they trade.'}</div></div>
        <button class="px-btn buy${have >= c ? ' gold' : ''}" data-routeopen="${x.id}"${have >= c ? '' : ' disabled'}>${format(c)}</button></div>`;
    })
    .join('');
  const ups = SAIL_UPS.map((u) => {
    const lv = level(world, u.id);
    const c = upCost(world, u.id);
    return `<div class="card px-box build"><div class="info"><div class="name">${u.name} <span class="dim">${lv}/${u.most}</span></div><div class="sub">${u.does}</div></div>
      ${c === null ? '<span class="dim tiny">Done</span>' : `<button class="px-btn buy${have >= c ? ' gold' : ''}" data-sailup="${u.id}"${have >= c ? '' : ' disabled'}>${format(c)}</button>`}</div>`;
  }).join('');
  // Voyages out into the fog, and the peoples met: to be won over, traded with, or taken.
  const target = voyageTarget(world);
  const vc = voyageCost(world);
  const voyage = world.voyage
    ? `<div class="card px-box build"><div class="info"><div class="name">A voyage is out</div><div class="sub">Back in <span data-t="voyage-left"></span></div></div></div>`
    : target
      ? `<div class="card px-box build raid"><div class="info"><div class="name">Send a voyage</div><div class="sub">Into the fog: ${Math.ceil(voyageTime(world) / 60)} min.</div></div><button class="px-btn buy${have >= vc ? ' gold' : ''}" data-voyage="1"${have >= vc ? '' : ' disabled'}>${format(vc)}</button></div>`
      : '';
  const peoples = world.isles
    .filter((i) => i.found && !ours(i))
    .sort((a, b) => (b.trust ?? 0) - (a.trust ?? 0))
    .map((i) => peopleCard(state, world, i))
    .join('');
  const mine = world.isles.filter((i) => i.mine !== undefined).sort((a, b) => (a.mine === -1 ? 1 : b.mine === -1 ? -1 : a.mine! - b.mine!));
  const yours = mine.map((i) => `<button class="px-btn" data-worldisle="${i.id}">${isleName(state, i)}</button>`).join('');
  return `<div class="panel-head"><h2>The world</h2><span class="dim">${joinedCount(world)} joined · ${toWin(world)} to win</span></div>
    ${voyage}${peoples}
    <div class="panel-head"><h2>Trade routes</h2><span class="dim"><span data-t="sail-rate"></span></span></div>
    <div class="seg build-cats">${amounts}</div>
    ${routes}${opens}
    <div class="panel-head"><h2>The network</h2></div>
    ${ups}
    <div class="panel-head"><h2>Your islands</h2><span class="dim">tap to go and see</span></div>
    <div class="seg build-cats">${yours}</div>`;
}

/** A people met: who, how they're best won, how far they trust you, and what to do. */
export function peopleCard(state: GameState, world: World, i: WorldIsle, close = false): string {
  const have = influence(state);
  const g = giftCost(world, i);
  const c = conquerCost(world, i);
  const canTake = have >= c.influence && shipsOut(world) >= c.ships;
  const t = Math.floor(i.trust ?? 0);
  const how = kin(world, i) ? 'Kin: gifts win them fast.' : world.diet === 'hunter' ? 'Others: easiest taken.' : world.diet === 'omnivore' ? 'Others: trade wins them.' : 'Others: gifts, slowly.';
  return `<div class="card px-box village"><div class="info"><div class="name">${isleName(state, i)} <span class="rel ${kin(world, i) ? 'rel-kin' : 'rel-prey'}">${kin(world, i) ? 'Kin' : 'Others'}</span></div>
    <div class="sub">${i.pop} of them, ${i.diet}s. ${how}</div>
    <div class="trust"><span class="tiny dim">Trust</span><div class="making-bar on"><i style="width: ${t}%"></i></div></div></div>
    <div class="col"><button class="px-btn${have >= g ? ' gold' : ''}" data-sailgift="${i.id}"${have >= g ? '' : ' disabled'}>Gift ${format(g)} · +${giftTrust(world, i)}</button>
    <button class="px-btn${canTake ? ' gold' : ''}" data-conquer="${i.id}"${canTake ? '' : ' disabled'}>Take ${format(c.influence)} · ${c.ships} ships</button>${close ? '<button class="px-btn" data-act="dismiss">OK</button>' : ''}</div></div>`;
}

/** Numbers written in place every frame. */
export function sailUpdate(root: HTMLElement, state: GameState): void {
  const world = state.stages.sail.world;
  if (!world) return;
  const put = (k: string, v: string) => {
    for (const el of root.querySelectorAll<HTMLElement>(`[data-t="${k}"]`)) if (el.textContent !== v) el.textContent = v;
  };
  world.routes?.forEach((r, i) => put(`route-${i}`, `${format(routeRate(state, world, r, i))}/s`));
  if (world.voyage) put('voyage-left', `${Math.floor(world.voyage.left / 60)}:${String(Math.floor(world.voyage.left % 60)).padStart(2, '0')}`);
  put('sail-rate', `${format((world.routes ?? []).reduce((n, r, i) => n + routeRate(state, world, r, i), 0))} a second`);
}
