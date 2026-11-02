// New Shore's pace, the idle way: an "auto" player (the council buying, the envoy and the scouts
// out, and a look in every half hour to buy upgrades, the Great Work, and beat whoever there's
// the food for) against an "active" one (stoking now and then, looking in every few minutes).
// How long to win the whole island, and where the waits are: the longest gaps between anything
// new happening (a new kind of thing to buy, an upgrade, a village, an Age).
// npm run sim:shore
import { createState } from '../src/economy/state';
import { upgradeCost, buyPerk, perkCost, canCross, cross, embersFor, buyGen, buyUpgrade, buyWork, canTake, canWin, councilPick, foodRate, gift, giftCost, takeCost, shoreOf, shoreTick, startShore, stoke, take, takeRaft, upgradeOpen, genOpen } from '../src/economy/shore';
import { GENS, PERKS, UPGRADES } from '../src/content/idle';
import type { TribeState } from '../src/economy/types';

type Kind = 'auto' | 'active';
const HOURS = Number(process.env.SIM_HOURS ?? 48);

function fresh(diet: string) {
  const state = createState(0);
  state.started = true;
  state.stages.tribal.tribe = { awake: true, pop: 4, survivors: 4, look: { parts: { legs: 'hooves' }, diet }, stats: {}, generations: 3, heritage: 1, seed: 1234, year: 0, family: [{ name: 'Ka', trait: 'hardy' }, { name: 'Ri', trait: 'keen' }, { name: 'Mo', trait: 'old' }, { name: 'Tu', trait: 'young' }], landed: { seed: 3703, day: 60 } } as unknown as TribeState;
  startShore(state);
  return state;
}

const hm = (x?: number) => (x === undefined ? '  —  ' : `${Math.floor(x / 3600)}h${String(Math.floor((x % 3600) / 60)).padStart(2, '0')}`);

function run(kind: Kind, diet: string): void {
  const state = fresh(diet);
  let s = shoreOf(state)!;
  const islands: string[] = [];
  let islandAt = 0;
  takeRaft(state);
  const STEP = 4;
  const events: { t: number; what: string }[] = [];
  const seenGens = new Set<string>();
  let wonAll: number | undefined;
  let lastAge = s.culture?.age ?? 0;
  let ideasSeen = 0;
  const rates: string[] = [];
  for (let t = 0; t <= HOURS * 3600; t += STEP) {
    shoreTick(state, STEP);
    const looking = kind === 'active' ? t % 120 === 0 : t < 600 ? t % 20 === 0 : t % 1800 === 0;
    if (kind === 'active' && t % 8 === 0) stoke(state);
    if (kind === 'auto' && t < 600 && t % 4 === 0) stoke(state);
    if (looking) {
      for (const u of UPGRADES.filter((x) => upgradeOpen(s, x.id)).sort((a, b) => upgradeCost(s, a) - upgradeCost(s, b))) if (buyUpgrade(state, u.id)) events.push({ t, what: `upgrade ${u.id}` });
      if (!s.auto) for (let i = 0; i < 40; i++) { const p = councilPick(s); if (!p || !buyGen(state, p)) break; }
      for (const v of s.villages) {
        if (canWin(s, v) && s.food > giftCost(s, v) * 3) gift(state, v.id);
        else if (canTake(s, v) && s.food > takeCost(s, v).food) if (take(state, v.id)) events.push({ t, what: `beat ${v.name}` });
      }
      if (buyWork(state)) events.push({ t, what: 'great work' });
    }
    for (const g of GENS) if (!seenGens.has(g.id) && genOpen(s, g.id)) { seenGens.add(g.id); events.push({ t, what: `new ${g.id}` }); }
    if ((s.culture?.done.length ?? 0) > ideasSeen) { ideasSeen = s.culture!.done.length; events.push({ t, what: `idea ${ideasSeen}` }); }
    const won = s.villages.filter((v) => v.won !== undefined).length;
    if (events.length && !events[events.length - 1].what.startsWith('won') && won > events.filter((e) => e.what.startsWith('won')).length) events.push({ t, what: `won ${won}` });
    if ((s.culture?.age ?? 0) !== lastAge) { lastAge = s.culture?.age ?? 0; events.push({ t, what: `age ${lastAge}` }); }
    if (wonAll === undefined && s.villages.every((v) => v.won !== undefined || v.gone)) wonAll = t;
    // Setting out as soon as they can (and looking in): the next island.
    if (looking && canCross(s) && islands.length < 4 && !process.env.SIM_STAY) {
      if (process.env.SIM_DEBUG) console.log('leaving', islands.length + 1, s.villages.map((v) => `${v.name}:${v.pop}:${v.won !== undefined ? 'won' : v.gone ? 'gone' : '-'}`).join(' '), 'people', s.people.length, 'rate', foodRate(s).toExponential(1));
      islands.push(`island ${islands.length + 1}: ${hm(t - islandAt)} (+${embersFor(s)} embers, age ${s.culture?.age ?? 0}, ${s.culture?.done.length ?? 0} ideas)`);
      cross(state);
      s = shoreOf(state)!;
      takeRaft(state);
      // (Embers spent, cheapest first, as long as there are any.)
      for (let k = 0; k < 50; k++) {
        const next = PERKS.map((p) => ({ p, c: perkCost(s, p.id) })).filter((x) => x.c !== null).sort((a, b) => a.c! - b.c!)[0];
        if (!next || !buyPerk(state, next.p.id)) break;
      }
      islandAt = t;
      seenGens.clear();
      ideasSeen = 0;
      events.push({ t, what: 'set out' });
    }
    if (t % (6 * 3600) === 0 && t) rates.push(`${t / 3600}h ${foodRate(s).toExponential(1)}/s ${s.people.length}c ${won}/${s.villages.length}w ${s.villages.filter((v) => v.found).length}f`);
  }
  // The longest waits with nothing new.
  const gaps = events.slice(1).map((e, i) => ({ from: events[i].t, gap: e.t - events[i].t, next: e.what })).sort((a, b) => b.gap - a.gap).slice(0, 5);
  console.log(`\n${kind} ${diet}: whole island ${hm(wonAll)} · villages ${s.villages.length}`);
  console.log('  ' + islands.join(' · '));
  console.log('  ' + rates.join(' | '));
  console.log('  longest waits: ' + gaps.map((g) => `${hm(g.gap)} from ${hm(g.from)} (→ ${g.next})`).join('; '));
  console.log('  ages: ' + events.filter((e) => e.what.startsWith('age') || e.what === 'set out').map((e) => `${hm(e.t)} ${e.what}`).join(', '));
  console.log('  villages: ' + events.filter((e) => e.what.startsWith('beat') || e.what.startsWith('won')).map((e) => `${hm(e.t)} ${e.what}`).join(', '));
}

for (const diet of (process.env.SIM_DIETS ?? 'grazer,hunter').split(',')) for (const kind of ['auto', 'active'] as Kind[]) run(kind, diet);
