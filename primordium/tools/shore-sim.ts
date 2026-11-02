// New Shore's pace, the idle way: how long a player takes to 25, 50, 75 and 100 critters, and
// where they are at 6 and 10 hours (food a second, villages won, ideas).
// npm run sim:shore
import { createState } from '../src/economy/state';
import { buyGen, buyUpgrade, buyWork, canTake, canWin, councilPick, foodRate, gift, giftCost, takeCost, shoreOf, shoreTick, startShore, stoke, take, takeRaft, upgradeOpen } from '../src/economy/shore';
import { UPGRADES } from '../src/content/idle';
import type { TribeState } from '../src/economy/types';

type Kind = 'idle' | 'active';

function fresh(diet: string) {
  const state = createState(0);
  state.started = true;
  state.stages.tribal.tribe = { awake: true, pop: 4, survivors: 4, look: { parts: { legs: 'hooves' }, diet }, stats: {}, generations: 3, heritage: 1, seed: 1234, year: 0, family: [{ name: 'Ka', trait: 'hardy' }, { name: 'Ri', trait: 'keen' }, { name: 'Mo', trait: 'old' }, { name: 'Tu', trait: 'young' }], landed: { seed: 3703, day: 60 } } as unknown as TribeState;
  startShore(state);
  return state;
}

function run(kind: Kind, diet: string): string {
  const state = fresh(diet);
  const s = shoreOf(state)!;
  takeRaft(state);
  const marks: Record<number, number> = {};
  const at: Record<number, string> = {};
  const STEP = 2;
  for (let t = 0; t <= 10 * 3600; t += STEP) {
    shoreTick(state, STEP);
    // The idle player: a few minutes' stoking and buying, then the council, and a look in every
    // half hour (upgrades, gifts). The active one: stokes now and then, buys what's best, looks
    // in every half minute.
    const looking = kind === 'active' ? t % 30 === 0 : t < 600 ? t % 10 === 0 : t % 1800 === 0;
    if (kind === 'active' && t % 4 === 0) stoke(state);
    if (kind === 'idle' && t < 600 && t % 4 === 0) stoke(state);
    if (looking) {
      for (const u of UPGRADES.filter((x) => upgradeOpen(s, x.id)).sort((a, b) => a.cost - b.cost)) buyUpgrade(state, u.id);
      if (!s.auto) for (let i = 0; i < 20; i++) { const p = councilPick(s); if (!p || !buyGen(state, p)) break; }
      // (Gifts and war bands only with plenty to spare; and the Great Work when it's on offer.)
      for (const v of s.villages) {
        v.found = true;
        if (canWin(s, v) && s.food > giftCost(s, v) * 5) gift(state, v.id);
        else if (canTake(s, v) && s.food > takeCost(s, v).food * 3) take(state, v.id);
      }
      buyWork(state);
    }
    for (const m of [25, 50, 75, 100]) if (marks[m] === undefined && s.people.length >= m) marks[m] = t;
    for (const h of [6, 10]) if (t === h * 3600) at[h] = `${h}h: ${Math.round(foodRate(s))}/s, ${s.villages.filter((v) => v.won !== undefined).length} won, ${s.culture?.done.length ?? 0} ideas, age ${s.culture?.age ?? 0}`;
  }
  const f = (x?: number) => (x === undefined ? '  —  ' : `${Math.floor(x / 3600)}h${String(Math.floor((x % 3600) / 60)).padStart(2, '0')}`);
  return `${kind.padEnd(7)} ${diet.padEnd(8)} 25:${f(marks[25])}  50:${f(marks[50])}  75:${f(marks[75])}  100:${f(marks[100])}   ${at[6]} · ${at[10]}`;
}

for (const diet of ['grazer', 'hunter', 'omnivore']) for (const kind of ['idle', 'active'] as Kind[]) console.log(run(kind, diet));
