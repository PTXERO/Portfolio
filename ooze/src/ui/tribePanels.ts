// The Extinction's panels: the Survivors (food, rations, who does what, and who's left) and
// the Ideas the spear can teach.

import { STORY } from '../content/tribal';
import { count, dayYield, eatsMeat, eatsPlants, hungerWord, ideaCost, IDEAS, JOBS, jobOpen, TRAITS, type Diet, type ExtinctionState } from '../economy/extinction';
import { tribeOf } from '../economy/tribal';
import type { GameState } from '../economy/types';

const DIET_LINE: Record<Diet, string> = {
  herbivore: 'Your kind eat only plants.',
  carnivore: 'Your kind eat only meat.',
  omnivore: 'Your kind eat plants and meat.',
  cannibal: 'Your kind eat meat. And their dead.',
};

const n0 = (v: number) => String(Math.floor(v + 1e-6));

/** Changes whenever what the panels show changes (rounded, so it isn't every frame). */
export function tribeKey(state: GameState): string {
  const t = tribeOf(state);
  const ex = t?.ex;
  if (!ex) return JSON.stringify([t?.awake]);
  return JSON.stringify([ex.day, ex.people.map((p) => [p.id, p.job, Math.round(p.hunger * 4)]), Math.floor(ex.plants), Math.floor(ex.meat), Math.floor(ex.insight), ex.ration, ex.ideas, ex.diet, ex.over]);
}

export function tribeLayout(state: GameState): string {
  const t = tribeOf(state);
  if (!t) return '';
  const ex = t.ex;
  if (!ex) {
    return `<div class="panel-head"><h2>Survivors</h2></div>
      <div class="card px-box"><div class="info"><div class="name">${t.survivors} of the herd lived</div>
      <div class="sub">${t.awake ? STORY.wakeSub : STORY.approach}</div></div></div>`;
  }
  return [storesCard(ex), rationCard(ex), jobsCard(ex), peopleCard(ex)].join('');
}

function storesCard(ex: ExtinctionState): string {
  const plants = eatsPlants(ex.diet);
  const meat = eatsMeat(ex.diet);
  const y = dayYield(ex);
  const cell = (name: string, have: number, gain: number, eats: boolean, note: string) =>
    `<div class="store${eats ? '' : ' off'}"><span class="label dim">${name}</span><b class="num">${n0(have)}</b><span class="dim">+${n0(gain)} today${eats ? '' : ' · inedible'}</span><span class="tiny dim">${note}</span></div>`;
  return `<div class="panel-head"><h2>Survivors</h2><span class="dim">${ex.people.length} alive · ${ex.deaths} dead</span></div>
    <div class="card px-box ex-stores">
      ${cell('Plants', ex.plants, y.forage + y.dig, plants, 'keeps')}
      ${cell('Meat', ex.meat, y.scavenge + y.fish, meat, ex.ideas.includes('racks') ? 'dried, keeps' : 'rots overnight')}
      ${cell('Insight', ex.insight, y.listen, true, 'for ideas')}
      <div class="sub diet">${DIET_LINE[ex.diet]} Each eats ${ex.ration === 1 ? 'a full meal' : ex.ration === 0.5 ? 'half a meal' : 'a quarter meal'} at night: ${n0(ex.people.length * ex.ration)} wanted.</div>
    </div>`;
}

function rationCard(ex: ExtinctionState): string {
  const opt = (v: number, label: string) => `<button class="px-btn${ex.ration === v ? ' on' : ''}" data-ration="${v}">${label}</button>`;
  return `<div class="card px-box opts"><div class="info"><div class="name">Rations</div>
    <div class="sub">Less food a night stretches it further, but hunger still builds, and the hungry work worse.</div>
    <div class="policy">${opt(1, 'Full')}${opt(0.5, 'Half')}${opt(0.25, 'Quarter')}</div></div></div>`;
}

function jobsCard(ex: ExtinctionState): string {
  const y = dayYield(ex);
  const unit: Record<string, string> = { forage: 'plants', dig: 'plants', scavenge: 'meat', fish: 'meat', listen: 'insight' };
  const rows = JOBS.filter((j) => j.id !== 'rest' && jobOpen(ex, j.id))
    .map((j) => {
      const c = count(ex, j.id);
      const left = j.id === 'forage' ? ` · ${n0(ex.ash)} left` : j.id === 'scavenge' ? ` · ${n0(ex.carrion)} left` : '';
      return `<div class="job"><div class="info"><div class="name">${j.name}</div><div class="sub">${j.does}</div>
        <div class="sub gain">${c ? `+${n0(y[j.id])} ${unit[j.id]} a day` : unit[j.id]}${left}</div></div>
        <div class="seg"><button class="px-btn" data-job="${j.id}" data-d="-5">−5</button><button class="px-btn" data-job="${j.id}" data-d="-1">−</button><b class="num">${c}</b><button class="px-btn" data-job="${j.id}" data-d="1">+</button><button class="px-btn" data-job="${j.id}" data-d="5">+5</button></div></div>`;
    })
    .join('');
  return `<div class="card px-box ex-jobs"><div class="info"><div class="name">Work</div>
    <div class="sub">${count(ex, 'rest')} resting (hunger comes on a little slower).</div></div>${rows}</div>`;
}

function peopleCard(ex: ExtinctionState): string {
  const rows = [...ex.people]
    .sort((a, b) => b.hunger - a.hunger)
    .map((p) => {
      const w = hungerWord(p);
      return `<div class="person ${w.toLowerCase()}"><b>${p.name}</b><span class="dim">${TRAITS[p.trait].name}</span><span class="dim">${JOBS.find((j) => j.id === p.job)!.name.split(' ')[0]}</span><span class="hunger">${w}</span></div>`;
    })
    .join('');
  return `<div class="card px-box ex-people"><div class="info"><div class="name">Who's left</div><div class="sub">Hungriest first. They eat in that order too.</div></div>${rows}</div>`;
}

export function ideasLayout(state: GameState): string {
  const ex = tribeOf(state)?.ex;
  if (!ex) return '';
  const cards = IDEAS.map((i) => {
    const known = ex.ideas.includes(i.id);
    const cost = ideaCost(state, i.id);
    const remembered = cost < i.cost;
    return `<div class="card px-box idea${known ? ' known' : ''}"><div class="info"><div class="name">${i.name}</div><div class="sub">${i.does}</div>
      ${remembered && !known ? '<div class="sub tiny gold">The spear remembers: half the insight.</div>' : ''}</div>
      ${known ? '<span class="label dim">Known</span>' : `<button class="px-btn${ex.insight >= cost ? ' gold' : ''}" data-idea="${i.id}"${ex.insight >= cost ? '' : ' disabled'}>${cost} insight</button>`}</div>`;
  }).join('');
  return `<div class="panel-head"><h2>Ideas</h2><span class="dim">${n0(ex.insight)} insight</span></div>
    <p class="note">Those who listen to the spear hear ideas in it. Each costs insight, and there's never enough for all of them in time.</p>${cards}`;
}
