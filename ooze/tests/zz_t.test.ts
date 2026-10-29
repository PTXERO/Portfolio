import { it } from 'vitest';
import { count, DAY_SEC, decideFallen, extinctionTick, learnIdea, startExtinction, dayYield } from '../src/economy/extinction';
import { createState } from '../src/economy/state';
it('t', () => {
  const s = createState();
  s.unlocked.push('tribal'); s.current = 'tribal';
  s.stages.tribal.tribe = { awake: true, pop: 100, survivors: 100, look: { parts: {}, diet: 'grazer' }, stats: { speed: 10, strength: 10, senses: 10, toughness: 10, charm: 10 }, generations: 6, heritage: 1.5, seed: 1234, year: 0 };
  startExtinction(s);
  const ex = () => s.stages.tribal.tribe!.ex!;
  for (let d = 0; d < 40 && !ex().over; d++) {
    for (const id of ['green', 'stick', 'rootlore', 'warmth', 'fire', 'deeproots', 'seeds', 'tend']) { if (ex().ideas.includes(id)) continue; if (!learnIdea(s, id)) break; }
    const e = ex(); const y = dayYield(e);
    console.log(`d${e.day} n${e.people.length} r${e.ration} plants ${e.plants.toFixed(0)} dig ${count(e,"dig")}/${y.dig.toFixed(0)} carrion ${e.carrion.toFixed(0)} ash ${e.ash.toFixed(0)} jobs f${count(e,'forage')} s${count(e,'scavenge')} fi${count(e,'fish')} w${count(e,'wood')} b${count(e,'build')} l${count(e,'listen')} r${count(e,'rest')} y f${y.forage.toFixed(0)} s${y.scavenge.toFixed(0)} fi${y.fish.toFixed(0)} ideas ${e.ideas.length} avgH ${(e.people.reduce((a,p)=>a+p.hunger,0)/e.people.length).toFixed(2)}`);
    if (e.fallen === 'undecided' && e.corpses > 0) decideFallen(s, false);
    extinctionTick(s, DAY_SEC);
  }
});
