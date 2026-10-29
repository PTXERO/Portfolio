// The Creature stage's own tabs: Body (parts and training), Explore (expeditions
// and the Field Guide) and Family (mates, the egg and the generations).
// Laid out once per layout key, then patched in place like the other panels.

import { icon } from '../art/sprites';
import { STAGES } from '../content/stages';
import { CREATURE, eggSeconds, GENERATION_MULT, MAX_MATES, partDef, placeOpen, statsOf, tripChance, tripPay, tripSeconds } from '../economy/creature';
import { D, format, formatTime } from '../economy/num';
import { checkReaction, payStage, reactionReady, upgradeCost, visibleUpgrades } from '../economy/actions';
import type { GameState, PartDef, Stat } from '../economy/types';
import { SLOTS, STATS } from '../economy/types';
import { creatureIcon, creatureLookOf } from '../scene/creatureLook';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const SLOT_NAMES = { legs: 'Legs', mouth: 'Mouth', eyes: 'Eyes', back: 'Back', tail: 'Tail' } as const;
const statText = (p: PartDef) =>
  Object.entries(p.stats)
    .map(([k, v]) => `${cap(k)} +${v}`)
    .join(' · ') || 'No stats';

/** What changes the creature tabs' layout. */
export function creatureKey(state: GameState): unknown {
  const s = state.stages[CREATURE];
  return [s.parts, s.equipped, s.trip?.place ?? '', s.trips, s.mates.map((m) => m.id), !!s.egg, s.generation, s.discovered, s.levels, visibleUpgrades(state, CREATURE).map((u) => u.id)];
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
    <div class="panel-head"><h2>Body</h2><span class="label dim">Tap a part to wear it</span></div>${slots}
    <div class="panel-head"><h2>Training</h2></div>${training}
    ${boosts ? `<div class="panel-head"><h2>Boosts</h2></div>${boosts}` : ''}`;
}

export function exploreLayout(state: GameState): string {
  const s = state.stages[CREATURE];
  const def = STAGES[CREATURE];
  const trip = `<div class="card px-box trip"><div class="info"><div class="name" data-t="trip-title"></div><div class="sub" data-t="trip-sub"></div><div class="making-bar on" data-bar="trip"><i></i></div></div></div>`;
  const places = def
    .places!.filter((p) => placeOpen(state, p) || (p.after ?? []).some((id) => (s.trips[id] ?? 0) > 0))
    .map((p) => {
      const open = placeOpen(state, p);
      const explored = (s.trips[p.id] ?? 0) > 0;
      const page = def.reactions!.find((r) => r.id === p.id)!;
      const reward = page.unlocks ? `New: ${def.generators.find((g) => g.id === page.unlocks)?.name}` : page.bonus ? 'A lasting boost' : '';
      const needs = Object.entries(p.needs)
        .map(([k]) => `<li data-need="${p.id}-${k}"></li>`)
        .join('');
      const found = p.parts.filter((id) => s.parts.includes(id)).length;
      return `<div class="card px-box place${explored ? ' owned' : ''}">
        <div class="info">
          <div class="name">${esc(p.name)} ${explored ? '<span class="tag">Explored</span>' : ''}</div>
          <div class="flavor">${esc(p.flavor)}</div>
          ${needs ? `<ul class="checks">${needs}</ul>` : ''}
          <div class="sub" data-t="place-${p.id}"></div>
          <div class="fx">${!explored && reward ? `First visit: ${esc(reward)} · ` : ''}Parts here: ${found}/${p.parts.length}</div>
        </div>
        ${open ? `<button class="px-btn buy" data-trip="${p.id}">Go</button>` : `<button class="px-btn buy locked" disabled><span class="qty">Explore ${esc((p.after ?? []).map((id) => def.places!.find((x) => x.id === id)!.name).join(' & '))} first</span></button>`}
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
  return `<div class="panel-head"><h2>Expedition</h2></div>${trip}
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
    ${mates || '<p class="note">Mates are met on expeditions. The first trip to the Shoreline always finds one.</p>'}
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

export function creatureUpdate(root: HTMLElement, state: GameState, tab: 'body' | 'explore' | 'family'): void {
  const s = state.stages[CREATURE];
  const def = STAGES[CREATURE];
  const stats = statsOf(state);
  if (tab === 'body') {
    for (const k of STATS) setText(root, `stat-${k}`, String(stats[k]));
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
    if (s.trip) {
      const p = def.places!.find((x) => x.id === s.trip!.place)!;
      setText(root, 'trip-title', `Exploring the ${p.name}`);
      setText(root, 'trip-sub', `Back in ${formatTime(s.trip.left)}`);
      bar(root, 'trip', 1 - s.trip.left / s.trip.total);
    } else {
      setText(root, 'trip-title', 'Your creature is home');
      setText(root, 'trip-sub', 'Pick a place to explore. Trips carry on while you are away.');
      bar(root, 'trip', 0);
    }
    for (const p of def.places!) {
      for (const [k, need] of Object.entries(p.needs)) {
        const li = root.querySelector<HTMLElement>(`[data-need="${p.id}-${k}"]`);
        if (!li) continue;
        const text = `${cap(k)} ${need} (yours ${stats[k as Stat]})`;
        if (li.textContent !== text) li.textContent = text;
        li.classList.toggle('ok', stats[k as Stat] >= (need ?? 0));
      }
      const chance = Math.round(tripChance(state, p) * 100);
      setText(root, `place-${p.id}`, `${chance}% safe · ${formatTime(tripSeconds(state, p))} · brings about ${format(tripPay(state, p))} ${def.currency}`);
      const go = root.querySelector<HTMLButtonElement>(`[data-trip="${p.id}"]`);
      if (go) {
        go.disabled = !!s.trip;
        go.classList.toggle('gold', !s.trip && chance >= 70);
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
      setText(root, 'egg-sub', s.mates.length ? `Breed with a mate below. It would take ${formatTime(eggSeconds(state))}.` : 'Find a mate on an expedition first.');
      bar(root, 'egg', 0);
    }
    for (const b of root.querySelectorAll<HTMLButtonElement>('[data-breed]')) {
      b.disabled = !!s.egg;
      b.classList.toggle('gold', !s.egg);
    }
  }
}
