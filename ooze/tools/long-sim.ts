// New Shore left alone for a long while (hours of real time): does anything run away?
// npx tsx tools/long-sim.ts [hours]
import { createState } from '../src/economy/state';
import { build, buildsOpen, canPay, foodCap, room, shoreOf, shoreTick, startShore, takeRaft, totalCritters, woodCap, workPlan } from '../src/economy/shore';
import type { TribeState } from '../src/economy/types';
import type { BuildId } from '../src/content/shore';

const hours = Number(process.argv[2] ?? 10);
const state = createState(0);
state.started = true;
state.stages.tribal.tribe = { awake: true, pop: 4, survivors: 4, look: { parts: { legs: 'hooves' }, diet: process.env.DIET ?? 'grazer' }, stats: {}, generations: 3, heritage: 1, seed: 1234, year: 0, family: [{ name: 'Ka', trait: 'hardy' }, { name: 'Ri', trait: 'keen' }, { name: 'Mo', trait: 'old' }, { name: 'Tu', trait: 'young' }], landed: { seed: 3703, day: 60 } } as unknown as TribeState;
startShore(state);
const s = shoreOf(state)!;
takeRaft(state);
for (let t = 0; t < hours * 3600; t += 2) {
  shoreTick(state, 2);
  if (t % 1800 === 0) {
    for (const id of ['hearth', 'hut', 'council', 'envoy', 'scout'] as BuildId[]) {
      if (s.building) break;
      if (!s.built.some((b) => b.id === id) && buildsOpen(s).some((b) => b.id === id) && canPay(s, id)) build(state, id);
    }
  }
  if (t % 3600 === 0) {
    const kinds: Record<string, number> = {};
    for (const b of s.built) kinds[b.id] = (kinds[b.id] ?? 0) + 1;
    const p = workPlan(s);
    console.log(`${t / 3600}h day ${s.day} critters ${totalCritters(s)} room ${room(s)} food ${s.food.toFixed(0)}/${foodCap(s)} wood ${s.wood.toFixed(0)}/${woodCap(s)} plan f${p.food} w${p.wood} rate f${p.foodRate.toFixed(0)} w${p.woodRate.toFixed(0)} eat ${p.eat.toFixed(0)} culture ${s.culture ? s.culture.done.length : '-'} built ${JSON.stringify(kinds)}`);
  }
}
