// The Creature stage's own tabs: Body (parts and training), Roam (roaming
// and the Field Guide) and Family (mates, the egg and the generations).
// Laid out once per layout key, then patched in place like the other panels.

import { icon } from '../art/sprites';
import { STAGES } from '../content/stages';
import {
  birthRate,
  canWear,
  CREATURE,
  eggSeconds,
  energyBudget,
  energyUsed,
  GENERATION_MULT,
  housing,
  MAX_MATES,
  partDef,
  partEnergy,
  curiosity,
  EVENT_WAIT,
  islandFor,
  placeSeen,
  placeShort,
  statsOf,
  tripPay,
  walkSeconds,
  walkSpeed,
  upkeep,
  winterLoss,
} from '../economy/creature';
import { EVENTS } from '../content/creature';
import { PLACE_SPOTS, seenShare } from '../economy/island';
import { buyCount, generatorCost, generatorVisible } from '../economy/actions';
import { foragers, SEASON_SEC, seasonOf, stageRate } from '../economy/rates';
import { D, format, formatTime } from '../economy/num';
import { checkReaction, payStage, reactionReady, upgradeCost, visibleUpgrades } from '../economy/actions';
import type { GameState, PartDef, Role, Stat } from '../economy/types';
import { ROLES, SLOTS, STATS } from '../economy/types';
import { creatureIcon, creatureLookOf } from '../scene/creatureLook';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const SLOT_NAMES = { legs: 'Legs', mouth: 'Mouth', eyes: 'Eyes', back: 'Back', tail: 'Tail' } as const;
const statText = (p: PartDef) =>
  (Object.entries(p.stats)
    .map(([k, v]) => `${cap(k)} +${v}`)
    .join(' · ') || 'No stats') + (partEnergy(p) ? ` · ⚡${partEnergy(p)}` : '');

const ROLE_INFO: Record<Role, { name: string; text: string }> = {
  forager: { name: 'Foragers', text: 'Gather food: everyone whose instincts don\'t send them elsewhere.' },
  carer: { name: 'Nesters', text: 'Births +8% each; eggs hatch a little sooner.' },
  digger: { name: 'Burrowers', text: 'Dig out room for half a member each.' },
  guard: { name: 'Sentries', text: 'Fewer lost to winter; they mob beasts.' },
  scout: { name: 'Followers', text: 'Roams 3% quicker each, and turn up more parts.' },
};

const PLACE_TEXT: Record<string, string> = {
  nest: 'Births +0.04/s each',
  burrow: 'Room for 3 more',
  waterhole: 'The herd eats 4% less each (down to half)',
  den: 'Room for 15 more, and shelter from winter',
  territory: 'Room for 50 more, and food +2% each',
};

/** What changes the creature tabs' layout. */
export function creatureKey(state: GameState): unknown {
  const s = state.stages[CREATURE];
  return [s.parts, s.equipped, s.autoRoam, s.walk?.event?.id ?? '', s.trips, STAGES[CREATURE].places!.map((p) => placeSeen(state, p.id)), energyBudget(state), state.unlocked.length, s.mates.map((m) => m.id), !!s.egg, s.generation, s.discovered, s.levels, visibleUpgrades(state, CREATURE).map((u) => u.id)];
}

/** The Herd tab: how many, how fed, what season, who does what, and the buildings. */
export function herdLayout(state: GameState, amounts: string, upgradeCard: (u: (typeof STAGES)['creature']['upgrades'][number]) => string): string {
  const def = STAGES[CREATURE];
  const cur = icon('biomass', 2);
  const s = state.stages[CREATURE];
  // Who's doing what: only the instincts the line has show up.
  const roles = ROLES.filter((r) => r === 'forager' || s.roles[r] > 0 || def.upgrades.some((u) => u.effect.kind === 'instinct' && u.effect.role === r && (s.levels[u.id] ?? 0) > 0))
    .map(
      (r) => `<div class="role-row"><span class="name">${ROLE_INFO[r].name}<span class="count" data-t="role-${r}"></span></span><span class="sub">${ROLE_INFO[r].text}</span></div>`,
    )
    .join('');
  const instincts = visibleUpgrades(state, CREATURE)
    .filter((u) => u.branch === 'Instincts')
    .map(upgradeCard)
    .join('');
  const buildings = def.generators
    .filter((g) => generatorVisible(state, CREATURE, g))
    .map(
      (g) => `<div class="card px-box">
        <div class="info"><div class="name">${esc(g.name)}<span class="count" data-t="owned-${g.id}"></span></div><div class="sub">${esc(PLACE_TEXT[g.id] ?? g.flavor)}</div></div>
        <button class="px-btn buy" data-gen="${g.id}"><span class="cost">${cur}<span data-t="cost-${g.id}"></span></span><span class="qty" data-t="qty-${g.id}"></span></button>
      </div>`,
    )
    .join('');
  const locked = def.generators.some((g) => !generatorVisible(state, CREATURE, g)) ? '<p class="note">Roaming further finds new places for the herd to live.</p>' : '';
  return `<div class="card px-box herd"><div class="info">
      <div class="name" data-t="herd-pop"></div>
      <div class="sub" data-t="herd-food"></div>
      <div class="sub" data-t="herd-season"></div>
      <div class="making-bar on" data-bar="season"><i></i></div>
    </div></div>
    <div class="card px-box roles"><div class="info">${roles}</div></div>
    <div class="panel-head"><h2>Instincts</h2></div>
    <p class="note">Nobody tells an animal what to do. Breed an instinct into the line and a share of the herd does it on its own.</p>
    ${instincts}
    <div class="panel-head"><h2>Where they live</h2><div class="seg">${amounts}</div></div>${buildings}${locked}`;
}

export function bodyLayout(state: GameState, upgradeCard: (u: (typeof STAGES)['creature']['upgrades'][number]) => string): string {
  const s = state.stages[CREATURE];
  const def = STAGES[CREATURE];
  const stats = STATS.map((k) => `<div class="stat"><span class="dim">${cap(k)}</span><span class="num" data-t="stat-${k}"></span></div>`).join('');
  const slots = SLOTS.map((slot) => {
    const all = def.parts!.filter((p) => p.slot === slot);
    const shown = all.filter((p) => s.parts.includes(p.id) || p.cost);
    const hidden = all.length - shown.length;
    const chips = shown
      .map((p) =>
        s.parts.includes(p.id)
          ? `<button class="px-btn part${s.equipped[slot] === p.id ? ' on' : ''}" data-equip="${p.id}"><b>${esc(p.name)}</b><span>${statText(p)}</span></button>`
          : `<button class="px-btn part shop" data-buypart="${p.id}"><b>${esc(p.name)}</b><span>${statText(p)}</span><span class="cost">${icon('biomass', 2)}${format(D(p.cost!))}</span></button>`,
      )
      .join('');
    return `<div class="slot-row"><div class="label dim">${SLOT_NAMES[slot]}${hidden ? ` <span class="tag">+${hidden} out there</span>` : ''}</div><div class="parts">${chips}</div></div>`;
  }).join('');
  const training = def.upgrades.filter((u) => u.branch === 'Training').map(upgradeCard).join('');
  const boosts = visibleUpgrades(state, CREATURE)
    .filter((u) => !u.branch && !u.pay && !u.target)
    .map(upgradeCard)
    .join('');
  return `<div class="portrait">${creatureIcon(creatureLookOf(state), 4)}<div class="stats">${stats}</div></div>
    <div class="panel-head"><h2>Body</h2><span class="label dim" data-t="energy"></span></div><p class="note">Every part costs energy (⚡). Wear what the body can feed; generations and a Bigger Heart give it more.</p>${slots}
    <div class="panel-head"><h2>Training</h2></div>${training}
    ${boosts ? `<div class="panel-head"><h2>Boosts</h2></div>${boosts}` : ''}`;
}

/** Where each kind of place is, as a hint while it's still in the fog. */
const WHERE: Record<string, string> = {
  coast: 'Somewhere along the coast',
  pools: 'Where rocks meet the sea',
  marsh: 'In wet, low ground',
  forest: 'Deep in the trees',
  cliff: 'Where the hills turn to rock',
  cave: 'In the mountains',
  high: 'Up on the high plateau',
};

export function exploreLayout(state: GameState, upgradeCard: (u: (typeof STAGES)['creature']['upgrades'][number]) => string): string {
  const s = state.stages[CREATURE];
  const def = STAGES[CREATURE];
  const ev = s.walk?.event ? EVENTS.find((e) => e.id === s.walk!.event!.id)! : null;
  const stats = statsOf(state);
  const choice = ev
    ? `<div class="event"><div class="flavor">${esc(ev.text)}</div><div class="making-bar on" data-bar="event"><i></i></div><div class="choices">${ev.options
        .map(
          (o, i) =>
            `<button class="px-btn choice${!o.stat || stats[o.stat] >= (o.need ?? 0) ? ' gold' : ''}" data-choice="${i}"><b>${esc(o.label)}</b>${o.stat ? `<span>${cap(o.stat)} ${o.need} (yours ${stats[o.stat]})</span>` : '<span>Safe</span>'}</button>`,
        )
        .join('')}</div></div>`
    : '';
  const walk = `<div class="card px-box trip"><div class="info"><div class="name" data-t="walk-title"></div><div class="sub" data-t="walk-sub"></div>${choice}</div>
    <button class="px-btn small" data-act="walkhome" data-t="home-btn">Home</button></div>
    <p class="note">Tap anywhere on the map to send your creature there. It clears the fog as it walks: Senses lets it see further, Speed gets it there sooner.</p>
    ${visibleUpgrades(state, CREATURE)
      .filter((u) => u.branch === 'Wandering')
      .map(upgradeCard)
      .join('')}
    ${curiosity(state) ? `<button class="px-btn small${s.autoRoam ? ' on' : ''}" data-act="autoroam">Exploring on its own: ${s.autoRoam ? 'on' : 'off'}</button>` : ''}`;
  const places = def
    .places!.map((p) => {
      const found = (s.trips[p.id] ?? 0) > 0;
      const seen = placeSeen(state, p.id);
      const page = def.reactions!.find((r) => r.id === p.id)!;
      const reward = page.unlocks ? `New: ${def.generators.find((g) => g.id === page.unlocks)?.name}` : page.bonus ? 'A lasting boost' : '';
      const needs = Object.entries(p.needs)
        .map(([k]) => `<li data-need="${p.id}-${k}"></li>`)
        .join('');
      const parts = p.parts.filter((id) => s.parts.includes(id)).length;
      if (!found && !seen) {
        return `<div class="card px-box place"><div class="info"><div class="name">???</div>
          <div class="flavor">${esc(WHERE[PLACE_SPOTS[p.id]?.where ?? ''] ?? 'Somewhere out there')}, still in the fog.</div>
          ${needs ? `<ul class="checks">${needs}</ul>` : ''}</div></div>`;
      }
      return `<div class="card px-box place${found ? ' owned' : ''}">
        <div class="info">
          <div class="name">${esc(p.name)} ${found ? '<span class="tag">Found</span>' : ''}</div>
          <div class="flavor">${esc(p.flavor)}</div>
          ${!found && needs ? `<ul class="checks">${needs}</ul>` : ''}
          <div class="sub" data-t="place-${p.id}"></div>
          <div class="fx">${!found && reward ? `Finding it: ${esc(reward)} · ` : ''}Parts here: ${parts}/${p.parts.length}</div>
        </div>
        <button class="px-btn buy" data-goto="${p.id}">Go</button>
      </div>`;
    })
    .join('');
  const fin = def.reactions!.find((r) => r.final)!;
  const done = s.discovered.includes(fin.id);
  const finale = done
    ? ''
    : `<div class="card px-box page final"><div class="info"><div class="name">${esc(fin.name)}</div><div class="flavor">${esc(fin.hints.join(' '))}</div>
        <ul class="checks">${checkReaction(state, CREATURE, fin)
          .parts.map((p, i) => `<li data-check="${fin.id}-${i}">${esc(p.label)}</li>`)
          .join('')}<li data-check="${fin.id}-cost" data-t="cost-${fin.id}"></li></ul>
        <button class="px-btn gold pulse finale" data-act="finale" hidden>${esc(fin.name)}</button></div></div>`;
  return `<div class="panel-head"><h2>Roaming</h2><span class="label dim" data-t="seen"></span></div>${walk}
    <div class="panel-head"><h2>${def.bookName}</h2><span class="label dim">${s.discovered.filter((id) => id !== fin.id).length} / ${def.places!.length}</span></div>${places}${finale}`;
}

export function familyLayout(state: GameState): string {
  const s = state.stages[CREATURE];
  const look = creatureLookOf(state);
  const egg = `<div class="card px-box egg"><div class="slot">${icon('family', 3)}</div><div class="info"><div class="name" data-t="egg-title"></div><div class="sub" data-t="egg-sub"></div><div class="making-bar on" data-bar="egg"><i></i></div></div></div>`;
  const mates = s.mates
    .map(
      (m) => `<div class="card px-box mate">
        <div class="portrait-sm">${creatureIcon({ ...look, parts: { ...look.parts, ...m.parts } }, 2)}</div>
        <div class="info"><div class="name">${esc(m.name)}</div>
          <div class="sub">${Object.values(m.parts).map((id) => esc(partDef(id!).name)).join(' · ')}</div></div>
        <div class="mate-btns"><button class="px-btn buy" data-breed="${m.id}">Breed</button><button class="px-btn small" data-release="${m.id}">Let go</button></div>
      </div>`,
    )
    .join('');
  return `<div class="panel-head"><h2>Generation ${s.generation}</h2><span class="label dim">Line ×${(GENERATION_MULT ** s.generation).toFixed(2)}</span></div>
    ${egg}
    <div class="panel-head"><h2>Mates</h2><span class="label dim">${s.mates.length} / ${MAX_MATES}</span></div>
    ${mates || '<p class="note">Mates are met while roaming, or courted when one wanders by the herd. The first new place your creature finds always has one.</p>'}
    <p class="note">Each generation makes the whole line stronger (all output ×${GENERATION_MULT}, every stat +1), and the young inherit the mate's parts. Eggs take longer each generation; Charm hurries them.</p>`;
}

function setText(root: HTMLElement, key: string, text: string): void {
  const el = root.querySelector<HTMLElement>(`[data-t="${key}"]`);
  if (el && el.textContent !== text) el.textContent = text;
}

function bar(root: HTMLElement, key: string, frac: number): void {
  const el = root.querySelector<HTMLElement>(`[data-bar="${key}"] > i`);
  if (el) el.style.width = `${Math.round(Math.max(0, Math.min(1, frac)) * 100)}%`;
}

export function creatureUpdate(root: HTMLElement, state: GameState, tab: 'grow' | 'body' | 'explore' | 'family'): void {
  const s = state.stages[CREATURE];
  const def = STAGES[CREATURE];
  const stats = statsOf(state);
  if (tab === 'grow') {
    const room = housing(state);
    const pop = Math.floor(s.pop);
    const births = pop >= room ? 'no room for more' : `+${birthRate(state).toFixed(2)}/s born`;
    setText(root, 'herd-pop', `Herd ${pop} / ${room} · ${births}`);
    const gain = stageRate(state, CREATURE);
    const eat = upkeep(state);
    const net = gain.sub(eat);
    setText(root, 'herd-food', `Food ${format(gain)}/s in · ${format(D(eat))}/s eaten · ${net.lt(0) ? '−' : '+'}${format(net.abs())}/s`);
    const { season, left } = seasonOf(state);
    const loss = winterLoss(state);
    const tip =
      season.name === 'Winter'
        ? `lean${loss ? `, ${(loss * 100 * 60).toFixed(1)}% lost a minute` : ''}`
        : season.name === 'Spring'
          ? 'twice the births'
          : season.name === 'Summer'
            ? 'the richest foraging'
            : 'store up for winter';
    setText(root, 'herd-season', `${season.name}: ${tip} · ${formatTime(left)} left`);
    bar(root, 'season', 1 - left / SEASON_SEC);
    for (const r of ROLES) setText(root, `role-${r}`, ` ×${r === 'forager' ? foragers(state) : s.roles[r]}`);
    for (const u of visibleUpgrades(state, CREATURE).filter((x) => x.branch === 'Instincts')) {
      const btn = root.querySelector<HTMLButtonElement>(`[data-up="${u.id}"]`);
      if (!btn) continue;
      btn.disabled = s.currency.lt(upgradeCost(state, CREATURE, u));
      btn.classList.toggle('gold', !btn.disabled);
    }
    for (const g of def.generators.filter((x) => generatorVisible(state, CREATURE, x))) {
      const n = buyCount(state, CREATURE, g.id, state.buyAmount);
      const cost = generatorCost(state, CREATURE, g.id, n);
      setText(root, `owned-${g.id}`, s.generators[g.id] ? ` ×${s.generators[g.id]}` : '');
      setText(root, `cost-${g.id}`, format(cost));
      setText(root, `qty-${g.id}`, `+${n}`);
      const btn = root.querySelector<HTMLButtonElement>(`[data-gen="${g.id}"]`);
      if (btn) {
        btn.disabled = s.currency.lt(cost);
        btn.classList.toggle('gold', !btn.disabled);
      }
    }
    for (const b of root.querySelectorAll<HTMLButtonElement>('[data-amount]')) b.classList.toggle('on', String(state.buyAmount) === b.dataset.amount);
  } else if (tab === 'body') {
    for (const k of STATS) setText(root, `stat-${k}`, String(stats[k]));
    setText(root, 'energy', `Energy ⚡${energyUsed(state)} / ${energyBudget(state)}`);
    for (const b of root.querySelectorAll<HTMLButtonElement>('[data-equip]')) {
      const id = b.dataset.equip!;
      b.classList.toggle('heavy', s.equipped[partDef(id).slot] !== id && !canWear(state, id));
    }
    for (const b of root.querySelectorAll<HTMLButtonElement>('[data-buypart]')) {
      const p = partDef(b.dataset.buypart!);
      b.disabled = s.currency.lt(p.cost!);
      b.classList.toggle('gold', !b.disabled);
    }
    for (const u of visibleUpgrades(state, CREATURE)) {
      const btn = root.querySelector<HTMLButtonElement>(`[data-up="${u.id}"]`);
      if (!btn) continue;
      btn.disabled = state.stages[payStage(CREATURE, u)].currency.lt(upgradeCost(state, CREATURE, u));
      btn.classList.toggle('gold', !btn.disabled);
    }
  } else if (tab === 'explore') {
    for (const u of visibleUpgrades(state, CREATURE).filter((x) => x.branch === 'Wandering')) {
      const btn = root.querySelector<HTMLButtonElement>(`[data-up="${u.id}"]`);
      if (!btn) continue;
      btn.disabled = s.currency.lt(upgradeCost(state, CREATURE, u));
      btn.classList.toggle('gold', !btn.disabled);
    }
    const is = islandFor(state);
    const atHome = Math.hypot(s.pos.x - is.home.x, s.pos.y - is.home.y) < 3;
    if (s.walk?.event) {
      setText(root, 'walk-title', 'Something on the road!');
      // A draining bar for the time left, not a ticking number: changing text can re-wrap
      // and shift the buttons just as a finger lands on them.
      setText(root, 'walk-sub', 'Choose, or instinct plays it safe when the bar runs out.');
      bar(root, 'event', s.walk.event.left / EVENT_WAIT);
    } else if (s.walk) {
      const d = Math.hypot(s.walk.tx - s.pos.x, s.walk.ty - s.pos.y);
      setText(root, 'walk-title', `Walking · ${Math.ceil(d)} steps to go`);
      setText(root, 'walk-sub', `There in ${formatTime(d / walkSpeed(state))}. It keeps going while you're away.`);
    } else {
      setText(root, 'walk-title', atHome ? 'Home with the herd' : 'Resting where it stopped');
      setText(root, 'walk-sub', 'Tap the map to send it somewhere.');
    }
    const home = root.querySelector<HTMLButtonElement>('[data-act="walkhome"]');
    if (home) home.hidden = atHome || !!s.walk?.event;
    setText(root, 'seen', `${Math.floor(seenShare(is, s.seen) * 100)}% seen`);
    for (const p of def.places!) {
      for (const [k, need] of Object.entries(p.needs)) {
        const li = root.querySelector<HTMLElement>(`[data-need="${p.id}-${k}"]`);
        if (!li) continue;
        const text = `${cap(k)} ${need} (yours ${stats[k as Stat]})`;
        if (li.textContent !== text) li.textContent = text;
        li.classList.toggle('ok', stats[k as Stat] >= (need ?? 0));
      }
      const q = is.places[p.id];
      const ready = !placeShort(state, p).length;
      setText(root, `place-${p.id}`, `${formatTime(walkSeconds(state, q.x, q.y))} away${(s.trips[p.id] ?? 0) > 0 ? '' : ` · finding it brings about ${format(tripPay(state, p))} ${def.currency}`}`);
      const go = root.querySelector<HTMLButtonElement>(`[data-goto="${p.id}"]`);
      if (go) {
        go.disabled = !!s.walk?.event;
        go.classList.toggle('gold', !go.disabled && ready && !((s.trips[p.id] ?? 0) > 0));
      }
    }
    const fin = def.reactions!.find((r) => r.final)!;
    const c = checkReaction(state, CREATURE, fin);
    c.parts.forEach((p, i) => root.querySelector(`[data-check="${fin.id}-${i}"]`)?.classList.toggle('ok', p.ok));
    root.querySelector(`[data-check="${fin.id}-cost"]`)?.classList.toggle('ok', c.cost);
    setText(root, `cost-${fin.id}`, `${format(s.currency.gte(fin.cost!) ? D(fin.cost!) : s.currency)} / ${format(D(fin.cost!))} ${def.currency}`);
    const btn = root.querySelector<HTMLButtonElement>('[data-act="finale"]');
    if (btn) btn.hidden = !reactionReady(state, CREATURE, fin);
  } else {
    if (s.egg) {
      setText(root, 'egg-title', `Egg with ${s.egg.mate.name}`);
      setText(root, 'egg-sub', `Hatches in ${formatTime(s.egg.left)} · generation ${s.generation + 1}`);
      bar(root, 'egg', 1 - s.egg.left / s.egg.total);
    } else {
      setText(root, 'egg-title', 'No egg yet');
      setText(root, 'egg-sub', s.mates.length ? `Breed with a mate below. It would take ${formatTime(eggSeconds(state))}.` : 'Find a mate while roaming first.');
      bar(root, 'egg', 0);
    }
    for (const b of root.querySelectorAll<HTMLButtonElement>('[data-breed]')) {
      b.disabled = !!s.egg;
      b.classList.toggle('gold', !s.egg);
    }
  }
}
