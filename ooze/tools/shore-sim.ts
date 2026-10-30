// New Shore's pace: how long each kind of player takes to grow the village to a hundred.
// npm run sim:shore
import { createState } from '../src/economy/state';
import { answerJoin, build, buildCost, buildsOpen, canWin, chiefNear, foodCap, gift, giftCost, poiDef, poiHere, poisOf, room, shoreOf, shoreTick, startShore, takeRaft, walkChief, woodCap, workPlan } from '../src/economy/shore';
import { isLand } from '../src/economy/island';
import { shoreIsland } from '../src/economy/shore';
import type { TribeState } from '../src/economy/types';
import type { BuildId } from '../src/content/shore';

/** Seeded, so runs compare. */
let r0 = 7;
const rand = () => ((r0 = (r0 * 16807) % 2147483647) / 2147483647);

type Kind = 'idle' | 'builder' | 'explorer' | 'diplomat' | 'both';

function fresh(seed: number, diet: string) {
  const state = createState(0);
  state.started = true;
  state.stages.tribal.tribe = { awake: true, pop: 4, survivors: 4, look: { parts: { legs: 'hooves' }, diet }, stats: {}, generations: 3, heritage: 1, seed, year: 0, family: [{ name: 'Ka', trait: 'hardy' }, { name: 'Ri', trait: 'keen' }, { name: 'Mo', trait: 'old' }, { name: 'Tu', trait: 'young' }], landed: { seed: seed * 3 + 1, day: 60 } } as unknown as TribeState;
  startShore(state);
  return state;
}

/** What a sensible player builds next (or null: save up for it). */
function choose(state: ReturnType<typeof fresh>, explorer: boolean): BuildId | null {
  const s = shoreOf(state)!;
  if (s.building) return null;
  const open = new Set(buildsOpen(s).map((b) => b.id));
  const plan = workPlan(s);
  const want = (id: BuildId) => (open.has(id) ? id : null);
  if (open.has('hearth')) return 'hearth';
  const free = room(s) - s.people.length;
  let need: BuildId | null = null;
  if (free <= 2) need = open.has('longhouse') && buildCost(s, 'longhouse') / 12 < buildCost(s, 'hut') / 4 ? 'longhouse' : 'hut';
  else if (plan.food > plan.land) need = want('weir') && buildCost(s, 'weir') < buildCost(s, 'camp') ? 'weir' : 'camp';
  else if (explorer && open.has('scout') && s.built.filter((b) => b.id === 'scout').length < 1) need = 'scout';
  if (need && buildCost(s, need) > woodCap(s)) need = 'woodpile';
  if (need) return s.wood >= buildCost(s, need) ? need : null;
  // Nothing pressing: the cheapest useful thing, if the wood's piling up.
  const extras: BuildId[] = ['elders', 'pool', 'granary', 'rack', 'cutter', 'trails', 'lookout', 'woodpile', 'camp', 'hut'];
  const pick = extras.filter((id) => open.has(id)).sort((a, b) => buildCost(s, a) - buildCost(s, b))[0];
  return pick && s.wood >= buildCost(s, pick) && s.wood > woodCap(s) * 0.6 ? pick : null;
}

function run(kind: Kind, seed: number, diet: string) {
  const state = fresh(seed, diet);
  const s = shoreOf(state)!;
  const is = shoreIsland(s.seed);
  const explore = kind === 'explorer' || kind === 'both';
  const gifts = kind === 'diplomat' || kind === 'both';
  const every = kind === 'idle' ? 1800 : 60;
  const marks: Record<number, number> = {};
  let joined = 0;
  takeRaft(state);
  const STEP = 2;
  for (let t = 0; t < 12 * 3600; t += STEP) {
    shoreTick(state, STEP);
    for (const v of s.villages) if (v.asking !== undefined) answerJoin(state, v.id, gifts ? 'crowd' : 'wait');
    if (t % every === 0) {
      if (kind === 'idle') {
        // The idle player sets the elders and the envoy to work, sends out a scout, and leaves
        // the rest to them.
        for (const id of ['hearth', 'hut', 'council', 'envoy', 'scout'] as BuildId[]) {
          if (s.building) break;
          if (!s.built.some((b) => b.id === id) && buildsOpen(s).some((b) => b.id === id) && s.wood >= buildCost(s, id)) build(state, id);
        }
      } else {
        for (let i = 0; i < 3; i++) {
          const id = choose(state, explore);
          if (!id || !build(state, id)) break;
        }
      }
    }
    // The chief's day (an active player looks in every half minute or so).
    if ((explore || gifts) && t % 30 === 0 && !s.chiefTo && !poiHere(s)) {
      const kin = gifts ? s.villages.filter((v) => canWin(s, v)).sort((a, b) => Math.hypot(a.x - s.hearth.x, a.y - s.hearth.y) - Math.hypot(b.x - s.hearth.x, b.y - s.hearth.y))[0] : undefined;
      if (kin) {
        if (!chiefNear(s, kin)) walkChief(state, { x: kin.x + 4, y: kin.y + 4 });
        // Gifts when there's food to spare (keeping enough for a child).
        while (s.food >= giftCost(kin) + 15 && canWin(s, kin)) if (!gift(state, kin.id)) break;
      } else if (explore) {
        const p = poisOf(s).filter((q) => q.found && q.done < poiDef(q).layers.length).sort((a, b) => Math.hypot(a.x - s.chiefAt.x, a.y - s.chiefAt.y) - Math.hypot(b.x - s.chiefAt.x, b.y - s.chiefAt.y))[0];
        if (p) walkChief(state, { x: p.x, y: p.y + 2 });
        else {
          // Out into the fog: somewhere unseen not too far off.
          for (let k = 0; k < 40; k++) {
            const a = rand() * Math.PI * 2;
            const r = 40 + rand() * 80;
            const x = s.chiefAt.x + Math.cos(a) * r;
            const y = s.chiefAt.y + Math.sin(a) * r;
            const seen = state.stages.shore.seen[Math.floor(y / 3) * 340 + Math.floor(x / 3)];
            if (isLand(is, x, y) && !seen) {
              walkChief(state, { x, y });
              break;
            }
          }
        }
      } else if (gifts) {
        // Looking for kin: out toward unfound smoke.
        const v = s.villages.filter((x) => !x.found).sort((a, b) => Math.hypot(a.x - s.chiefAt.x, a.y - s.chiefAt.y) - Math.hypot(b.x - s.chiefAt.x, b.y - s.chiefAt.y))[0];
        if (v) walkChief(state, { x: v.x + 4, y: v.y + 4 });
      }
    }
    for (const m of [25, 50, 75, 100]) if (marks[m] === undefined && s.people.length >= m) marks[m] = t;
    joined = s.villages.filter((v) => v.joined).length;
    if (marks[100] !== undefined) break;
  }
  const f = (x?: number) => (x === undefined ? '  —  ' : `${Math.floor(x / 3600)}h${String(Math.floor((x % 3600) / 60)).padStart(2, '0')}`);
  return `${kind.padEnd(9)} ${diet.padEnd(8)} 25:${f(marks[25])}  50:${f(marks[50])}  75:${f(marks[75])}  100:${f(marks[100])}  (people ${s.people.length}, joined ${joined}, relics ${s.relics?.length ?? 0}, learned ${s.learned?.length ?? 0}, food cap ${foodCap(s)})`;
}

for (const diet of ['grazer', 'hunter', 'omnivore']) for (const kind of ['idle', 'builder', 'explorer', 'diplomat', 'both'] as Kind[]) console.log(run(kind, 1234, diet));
