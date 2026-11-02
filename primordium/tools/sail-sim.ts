// The Age of Sail's pacing: a player buying the best they can (ships, routes, upgrades), how
// long between buys, and how Influence grows. `npx tsx tools/sail-sim.ts` (SIM_HOURS, SIM_CHECK:
// seconds between looks in).
import { createState } from '../src/economy/state';
import { startShore, shoreOf, takeRaft } from '../src/economy/shore';
import { buyShips, buySailUp, openCost, openRoute, routeOptions, routeRate, SAIL_UPS, sailRate, setSail, shipCost, upCost, type SailUp } from '../src/economy/sail';
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
  const key = JSON.stringify([world.routes!.map((r) => r.ships), world.ups]);
  if (key !== seenKey && seenKey) {
    gaps.push({ t, gap: t - last });
    last = t;
  }
  seenKey = key;
  if (t % CHECK) continue;
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
    const best = opts.filter((o) => o.cost <= have()).sort((a, b) => b.gain / b.cost - a.gain / a.cost)[0];
    if (!best || !best.go()) break;
  }
  if (t % 1800 === 0) log.push(`${hm(t)} ${sailRate(state).toExponential(2)}/s · ${world.routes!.length} routes · ${world.routes!.reduce((n, r) => n + r.ships, 0)} ships · ups ${JSON.stringify(world.ups)}`);
}
console.log(log.join('\n'));
const worst = (a: number, b: number) => Math.max(0, ...gaps.filter((g) => g.t >= a && g.t < b).map((g) => g.gap));
console.log('buys', gaps.length, '· longest wait: hour 1', worst(0, 3600), 's · hours 1-4', worst(3600, 4 * 3600), 's · after', worst(4 * 3600, 1e9), 's');
