// The Age of Sail's pacing: a player buying the best they can (ships, routes, upgrades), how
// long between buys, and how Influence grows. `npx tsx tools/sail-sim.ts` (SIM_HOURS, SIM_CHECK:
// seconds between looks in).
import { createState } from '../src/economy/state';
import { startShore, shoreOf, takeRaft } from '../src/economy/shore';
import { fightPirate, havensLeft, buyShips, buySailUp, conquer, conquerCost, giftCost, giftTrust, giveGift, ours, openCost, openRoute, routeOptions, routeRate, SAIL_UPS, sailRate, sendVoyage, setSail, shipCost, shipsOut, toWin, upCost, voyageCost, voyageTarget, type SailUp } from '../src/economy/sail';
import { tick } from '../src/economy/tick';
import type { TribeState } from '../src/economy/types';

const HOURS = Number(process.env.SIM_HOURS ?? 12);
const CHECK = Number(process.env.SIM_CHECK ?? 10);
const state = createState(0);
state.started = true;
state.stages.tribal.tribe = { awake: true, pop: 4, survivors: 4, look: { parts: { legs: 'hooves', mouth: 'grinders' }, diet: 'grazer' }, stats: {}, generations: 3, heritage: 1, seed: 4242, year: 0, family: [{ name: 'Ka', trait: 'hardy' }, { name: 'Ri', trait: 'keen' }, { name: 'Mo', trait: 'old' }, { name: 'Tu', trait: 'young' }], landed: { seed: 777, day: 60 } } as unknown as TribeState;
startShore(state);
takeRaft(state);
const s = shoreOf(state)!;
s.gens = { forager: 200, camp: 150, weir: 120 } as never;
s.culture = { since: 0, age: 6, practice: {}, done: [], forks: {} };
setSail(state);
const world = state.stages.sail.world!;
const have = () => state.stages.sail.currency.toNumber();
let last = 0;
const gaps: { t: number; gap: number }[] = [];
const hm = (x: number) => `${Math.floor(x / 3600)}h${String(Math.floor((x % 3600) / 60)).padStart(2, '0')}`;
const log: string[] = [];
let seenKey = '';
for (let t = 0; t <= HOURS * 3600; t += 2) {
  tick(state, 2);
  // (Anything bought, by the player or by Passage, counts as a buy.)
  const key = JSON.stringify([world.routes!.map((r) => r.ships), world.ups, world.voyages, world.isles.map((i) => i.gifts ?? 0), world.isles.filter((i) => i.joined).length]);
  if (key !== seenKey && seenKey) {
    gaps.push({ t, gap: t - last });
    last = t;
  }
  seenKey = key;
  if (t % CHECK) continue;
  // (An active player taps pirates away when they look in; an idle one doesn't.)
  if (process.env.SIM_IDLE !== '1') while (world.pirates?.length) for (let k = 0; k < 4; k++) fightPirate(state, 0);
  // The best buy: whatever adds the most Influence a second per Influence spent (upgrades by
  // their gain over the whole network), as long as it can be paid now.
  for (let k = 0; k < 200; k++) {
    const rate = sailRate(state);
    const opts: { cost: number; gain: number; go: () => boolean }[] = [];
    world.routes!.forEach((r, i) => opts.push({ cost: shipCost(world, r), gain: routeRate(state, world, r) / r.ships, go: () => buyShips(state, i, 1) }));
    const next = routeOptions(world)[0];
    if (next) opts.push({ cost: openCost(world, next.id), gain: rate * 0.3 + 1, go: () => openRoute(state, next.id) });
    for (const u of SAIL_UPS) {
      const c = upCost(world, u.id as SailUp);
      if (c === null) continue;
      const gain = u.id === 'sails' ? rate * 0.3 : u.id === 'holds' ? rate * 0.6 : u.id === 'fleet' ? rate * 0.25 : u.id === 'charts' ? rate * 0.2 : rate * 0.1;
      opts.push({ cost: c, gain, go: () => buySailUp(state, u.id as SailUp) });
    }
    if (!world.voyage && voyageTarget(world)) opts.push({ cost: voyageCost(world), gain: rate * 2 + 1, go: () => sendVoyage(state) });
    for (const i of world.isles) {
      if (!i.found || ours(i)) continue;
      opts.push({ cost: giftCost(world, i), gain: (rate * 0.15 * giftTrust(world, i)) / 100, go: () => giveGift(state, i.id) });
      const c = conquerCost(world, i);
      if (shipsOut(world) >= c.ships) opts.push({ cost: c.influence, gain: i.haven ? rate * 2 : rate * 0.15, go: () => conquer(state, i.id) });
    }
    // (Saving up for something worth it: the best of everything, if it's a priority and within
    // ten minutes' income, is waited for instead of spending on lesser things.)
    const haven = world.isles.find((i) => i.haven && i.found && !i.joined && shipsOut(world) >= conquerCost(world, i).ships && conquerCost(world, i).influence < rate * 900);
    if (haven) {
      if (!conquer(state, haven.id)) break;
      continue;
    }
    const best = opts.filter((o) => o.cost <= have()).sort((a, b) => b.gain / b.cost - a.gain / a.cost)[0];
    if (!best || !best.go()) break;
  }
  if (t % 1800 === 0) log.push(`${hm(t)} ${sailRate(state).toExponential(2)}/s · ${world.isles.filter((i) => i.joined).length} joined, ${toWin(world)} to win, ${world.isles.filter((i) => i.found).length} found · ${havensLeft(world)} havens · lost ${world.lost ?? 0} · ${world.routes!.length} routes · ${world.routes!.reduce((n, r) => n + r.ships, 0)} ships · ups ${JSON.stringify(world.ups)}`);
}
console.log(log.join('\n'));
for (const h of world.isles.filter((i) => i.haven && !i.joined)) console.log('haven', h.id, 'found', h.found, 'pop', h.pop, 'cost', conquerCost(world, h).influence.toExponential(2), 'ships', conquerCost(world, h).ships, 'have ships', shipsOut(world));
for (const h of world.isles.filter((i) => !ours(i))) console.log('left', h.id, 'pop', h.pop, 'trust', Math.round(h.trust ?? 0), 'gift', giftCost(world, h).toExponential(2), 'take', conquerCost(world, h).influence.toExponential(2), conquerCost(world, h).ships, 'route', world.routes!.some((r) => r.to === h.id), 'rate', sailRate(state).toExponential(2));
const worst = (a: number, b: number) => Math.max(0, ...gaps.filter((g) => g.t >= a && g.t < b).map((g) => g.gap));
console.log('buys', gaps.length, '· longest wait: hour 1', worst(0, 3600), 's · hours 1-4', worst(3600, 4 * 3600), 's · after', worst(4 * 3600, 1e9), 's');
