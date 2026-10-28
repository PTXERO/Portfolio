// The tab panels under the scene. Each panel is laid out once (when its rows
// change) and then patched in place, so a button never vanishes under a finger.

import { icon, type SpriteName } from '../art/sprites';
import { STAGES } from '../content/stages';
import {
  buyCount,
  catalysisRate,
  checkReaction,
  engulfable,
  generatorCost,
  generatorVisible,
  habitatUnlocked,
  reactionReady,
  reactions,
  upgradeVisible,
  visibleUpgrades,
} from '../economy/actions';
import { D, format, formatTime } from '../economy/num';
import { timeBankCap } from '../economy/offline';
import { dialMax, generatorRate, habitatMult, MILESTONES, nextMilestone, stageRate } from '../economy/rates';
import { DIALS, type BuyAmount, type DialId, type Effect, type GameState, type ReactionDef, type StageId, type UpgradeDef } from '../economy/types';

export type Tab = 'grow' | 'boosts' | 'lab' | 'mutate' | 'pond' | 'time' | 'menu';

export const TABS: { id: Tab; label: string; sprite: SpriteName }[] = [
  { id: 'grow', label: 'Grow', sprite: 'sprout' },
  { id: 'boosts', label: 'Boosts', sprite: 'spark' },
  { id: 'lab', label: 'Lab', sprite: 'flask' },
  { id: 'mutate', label: 'Mutate', sprite: 'helix' },
  { id: 'pond', label: 'Pond', sprite: 'pond' },
  { id: 'time', label: 'Time', sprite: 'hourglass' },
  { id: 'menu', label: 'Menu', sprite: 'menu' },
];

/** Tabs that exist on the current stage: the Soup has Boosts and a Lab, the Cell a Mutation Tree and a Pond. */
export function tabsFor(state: GameState): Tab[] {
  const habitats = !!STAGES[state.current].habitats;
  const has: Record<Tab, boolean> = {
    grow: true,
    boosts: !habitats,
    lab: !habitats && reactions(state.current).length > 0,
    mutate: habitats,
    pond: habitats,
    time: true,
    menu: true,
  };
  return TABS.map((t) => t.id).filter((t) => has[t]);
}

export const DIAL_INFO: Record<DialId, { name: string; sprite: SpriteName }> = {
  heat: { name: 'Heat', sprite: 'flame' },
  light: { name: 'Light', sprite: 'sun' },
  charge: { name: 'Charge', sprite: 'bolt' },
};

export const CURRENCY_ICON: Record<StageId, SpriteName> = { soup: 'nutrient', cell: 'dna' };
export const WARPS = [1, 2, 5, 10];
const AMOUNTS: BuyAmount[] = [1, 10, 'max'];

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

function shownGenerators(state: GameState) {
  return STAGES[state.current].generators.filter((g) => generatorVisible(state, state.current, g));
}

/** How far into a reaction's clues the player gets: more once the molecules are there. */
function hintLevel(state: GameState, r: ReactionDef): number {
  return checkReaction(state, state.current, r).gens ? 2 : 1;
}

function visibleDials(state: GameState): DialId[] {
  return DIALS.filter((d) => dialMax(state, state.current, d) > 0);
}

export function describeEffect(stage: StageId, e: Effect): string {
  switch (e.kind) {
    case 'genMult':
      return `${STAGES[stage].generators.find((g) => g.id === e.target)?.name} ×${e.mult}`;
    case 'stageMult':
      return `Everything here ×${e.mult}`;
    case 'tapMult':
      return `Stirring ×${e.mult}`;
    case 'tapFromRate':
      return `Each stir adds ${e.seconds}s of output`;
    case 'feedMult':
      return `Boost from the last stage ×${e.mult}`;
    case 'dialMax':
      return e.max === 3 ? `${DIAL_INFO[e.dial].name} turns all the way up` : `Unlocks the ${DIAL_INFO[e.dial].name} dial`;
    case 'swirlMult':
      return `Whirlpool bonus ×${e.mult}`;
    case 'heroSpeed':
      return e.mult >= 1 ? `Swims ${Math.round((e.mult - 1) * 100)}% faster` : `Swims ${Math.round((1 - e.mult) * 100)}% slower`;
    case 'defense':
      return `Predators take ${Math.round(e.amount * 100)}% less`;
    case 'forageMult':
      return `Food worth ×${e.mult}`;
    case 'diet':
      return e.diet === 'grazer' ? 'Eats algae' : e.diet === 'hunter' ? 'Eats bacteria' : 'Eats everything';
    case 'size':
      return e.size === 2 ? 'Can swallow bigger things' : 'Can swallow almost anything';
    case 'autopilot':
      return 'Forages on its own';
    case 'spawnMult':
      return `Rare microbes ×${e.mult} as often`;
    case 'offlineHours':
      return `Time away counts ${e.hours}h longer`;
  }
}

function upgradeText(stage: StageId, u: UpgradeDef): string {
  return [u.effect, ...(u.extra ?? [])].map((e) => describeEffect(stage, e)).join(' · ');
}

/** Why a mutation can't be bought yet, in a few words. */
function lockReason(state: GameState, stage: StageId, u: UpgradeDef): string {
  const st = state.stages[stage];
  const def = STAGES[stage];
  const r = u.requires;
  const missing = (r?.upgrades ?? []).filter((x) => !st.upgrades.includes(x)).map((x) => def.upgrades.find((y) => y.id === x)?.name ?? x);
  if (missing.length) return `Needs ${missing.join(' and ')}`;
  if (r?.anyReaction) return `Needs a ${r.anyReaction.map((x) => def.reactions?.find((y) => y.id === x)?.name ?? x).join(' or ')}`;
  if (r?.generator) return `Needs ${r.owned} ${def.generators.find((g) => g.id === r.generator)?.name}`;
  return 'Locked';
}

/** What a reaction gives, in a few words. */
function rewardText(stage: StageId, r: ReactionDef): string {
  const parts: string[] = [];
  if (r.unlocks) parts.push(`New: ${STAGES[stage].generators.find((g) => g.id === r.unlocks)?.name}`);
  if (r.bonus) parts.push(describeEffect(stage, r.bonus));
  return parts.join(' · ');
}

export { rewardText };

/** A key that changes whenever a panel needs re-laying out. */
export function layoutKey(state: GameState, tab: Tab): string {
  return JSON.stringify([
    tab,
    state.current,
    tab === 'grow' ? shownGenerators(state).map((g) => g.id) : 0,
    tab === 'grow' ? state.unlocked : 0,
    tab === 'boosts' || tab === 'mutate' ? [visibleUpgrades(state, state.current).map((u) => u.id), state.stages[state.current].upgrades] : 0,
    tab === 'lab' || tab === 'pond' ? [visibleDials(state), state.stages[state.current].discovered, reactions(state.current).map((r) => hintLevel(state, r))] : 0,
    tab === 'pond' ? [state.stages[state.current].habitat, (STAGES[state.current].habitats ?? []).map((h) => habitatUnlocked(state, state.current, h))] : 0,
  ]);
}

export function layout(state: GameState, tab: Tab): string {
  const id = state.current;
  const def = STAGES[id];
  const cur = icon(CURRENCY_ICON[id], 2);

  if (tab === 'grow') {
    const rows = shownGenerators(state)
      .map(
        (g) => `<div class="card px-box">
          <div class="slot">${icon(g.id as SpriteName, 3)}</div>
          <div class="info">
            <div class="name">${esc(g.name)}<span class="count" data-t="owned-${g.id}"></span></div>
            <div class="sub" data-t="sub-${g.id}"></div>
            <div class="mini" data-mini="${g.id}">${MILESTONES.map(() => '<i></i>').join('')}</div>
          </div>
          <button class="px-btn buy" data-gen="${g.id}">
            <span class="cost">${cur}<span data-t="cost-${g.id}"></span></span>
            <span class="qty" data-t="qty-${g.id}"></span>
          </button>
        </div>`,
      )
      .join('');
    const others = state.unlocked.filter((s) => s !== id);
    const auto = others.map((s) => `<p class="note" data-t="auto-${s}"></p>`).join('');
    const locked =
      shownGenerators(state).length < def.generators.length
        ? `<p class="note">${def.habitats ? 'New kinds of life come from organelles. Find them in the Pond.' : def.reactions ? 'New molecules come from reactions. Find them in the Lab.' : 'Own one of the last tier to discover the next.'}</p>`
        : '';
    return `<div class="panel-head"><h2>Grow</h2><div class="seg">${AMOUNTS.map(
      (a) => `<button class="px-btn" data-amount="${a}">${a === 'max' ? 'MAX' : `×${a}`}</button>`,
    ).join('')}</div></div>${rows}${locked}${auto}`;
  }

  if (tab === 'boosts') {
    const ups = visibleUpgrades(state, id);
    const rows = ups
      .map(
        (u) => `<div class="card px-box">
          <div class="slot">${icon('spark', 3)}</div>
          <div class="info">
            <div class="name">${esc(u.name)}</div>
            <div class="fx">${esc(describeEffect(id, u.effect))}</div>
            <div class="flavor">${esc(u.flavor)}</div>
          </div>
          <button class="px-btn buy" data-up="${u.id}"><span class="cost">${cur}${format(D(u.cost))}</span></button>
        </div>`,
      )
      .join('');
    return `<div class="panel-head"><h2>Boosts</h2></div>${rows || '<p class="note">Nothing new yet. More boosts appear as you grow.</p>'}`;
  }

  if (tab === 'lab') {
    const dials = visibleDials(state)
      .map(
        (d) => `<div class="card px-box dial">
          <div class="slot">${icon(DIAL_INFO[d].sprite, 3)}</div>
          <div class="info">
            <div class="name">${DIAL_INFO[d].name}</div>
            <div class="sub" data-t="dialfx-${d}"></div>
            <div class="seg levels">${[0, 1, 2, 3].map((n) => `<button class="px-btn" data-dial="${d}" data-level="${n}">${n}</button>`).join('')}</div>
          </div>
        </div>`,
      )
      .join('');
    return `<div class="panel-head"><h2>Conditions</h2></div>
      ${dials || '<p class="note">Boosts unlock dials for heat, light and charge.</p>'}
      ${bookLayout(state)}`;
  }

  if (tab === 'mutate') {
    const st = state.stages[id];
    const branches = [...new Set(def.upgrades.filter((u) => u.branch).map((u) => u.branch!))];
    const card = (u: UpgradeDef) => {
      const owned = st.upgrades.includes(u.id);
      const action = owned
        ? '<span class="label owned-tag">Evolved</span>'
        : upgradeVisible(state, id, u)
          ? `<button class="px-btn buy" data-up="${u.id}"><span class="cost">${cur}${format(D(u.cost))}</span></button>`
          : `<button class="px-btn buy locked" disabled><span class="qty">${esc(lockReason(state, id, u))}</span></button>`;
      return `<div class="card px-box${owned ? ' owned' : ''}">
        <div class="slot">${icon('helix', 3)}</div>
        <div class="info">
          <div class="name">${esc(u.name)}</div>
          <div class="fx">${esc(upgradeText(id, u))}</div>
          <div class="flavor">${esc(u.flavor)}</div>
        </div>
        ${action}
      </div>`;
    };
    // A choice already made elsewhere (the other diet) drops out of the tree.
    const tree = branches
      .map((b) => {
        const ups = def.upgrades.filter((u) => u.branch === b && !(u.excludes ?? []).some((x) => st.upgrades.includes(x)));
        return `<div class="panel-head"><h2>${b}</h2></div>${ups.map(card).join('')}`;
      })
      .join('');
    const boosts = visibleUpgrades(state, id).filter((u) => !u.branch);
    return `${tree}${boosts.length ? `<div class="panel-head"><h2>Boosts</h2></div>${boosts.map(card).join('')}` : ''}`;
  }

  if (tab === 'pond') {
    const st = state.stages[id];
    const places = (def.habitats ?? [])
      .map((h) => {
        const open = habitatUnlocked(state, id, h);
        const here = st.habitat === h.id;
        const need = h.unlock?.upgrade ? def.upgrades.find((u) => u.id === h.unlock!.upgrade)?.name : h.unlock?.reaction;
        const action = here
          ? '<span class="label owned-tag">You live here</span>'
          : open
            ? `<button class="px-btn buy" data-habitat="${h.id}">Move</button>`
            : `<button class="px-btn buy locked" disabled><span class="qty">Needs ${esc(need ?? '?')}</span></button>`;
        return `<div class="card px-box${here ? ' owned' : ''}">
          <div class="slot">${icon('pond', 3)}</div>
          <div class="info">
            <div class="name">${esc(h.name)}</div>
            <div class="sub">Algae ×${h.food.algae} · Bacteria ×${h.food.bacteria} · Danger ${Math.round(h.danger * 100)}%</div>
            <div class="fx" data-t="hab-${h.id}"></div>
            <div class="flavor">${esc(h.flavor)}</div>
          </div>
          ${action}
        </div>`;
      })
      .join('');
    return `<div class="panel-head"><h2>Habitats</h2></div>${places}${bookLayout(state)}`;
  }

  if (tab === 'time') {
    return `<div class="panel-head"><h2>Time bank</h2></div>
      <div class="bank"><span class="num big" data-t="bank"></span><span class="dim" data-t="bank-cap"></span></div>
      <div class="warp">${WARPS.map((w) => `<button class="px-btn" data-warp="${w}">${w}×</button>`).join('')}</div>
      <p class="note">While you're away, most of the time is played out for you. The rest is saved here. Spend it to run the game faster while you watch.</p>
      <p class="note" data-t="offline"></p>`;
  }

  return `<div class="panel-head"><h2>Menu</h2></div>
    <div class="tools">
      <button class="px-btn" data-act="export">Export save</button>
      <button class="px-btn" data-act="import">Import</button>
      <button class="px-btn" data-act="reset">Restart</button>
    </div>
    <textarea id="save-text" placeholder="Export gives you a backup code. To restore, paste one here and tap Import."></textarea>
    <p class="note" data-t="stats"></p>
    <p class="note">Ooze to Orbit · test build · art and names are placeholders</p>`;
}

/** The stage's collection: the Soup's Recipe Book or the Cell's Organelles. */
function bookLayout(state: GameState): string {
  const id = state.current;
  const def = STAGES[id];
  const st = state.stages[id];
  const rs = reactions(id);
  const pages = rs
    .map((r) => {
      if (st.discovered.includes(r.id)) {
        return `<div class="card px-box page found">
          <div class="slot">${icon(def.habitats ? 'organelle' : 'flask', 3)}</div>
          <div class="info">
            <div class="name">${esc(r.name)}</div>
            <div class="flavor">${esc(r.flavor)}</div>
            <div class="fx">${esc(rewardText(id, r))}</div>
            ${r.unlocks && r.pair ? `<div class="making" data-t="making-${r.id}"></div><div class="making-bar" data-bar="${r.id}"><i></i></div>` : ''}
          </div>
        </div>`;
      }
      const level = hintLevel(state, r);
      const checks = level >= 2 ? `<ul class="checks">${checkReaction(state, id, r).parts.map((p, i) => `<li data-check="${r.id}-${i}">${esc(p.label)}</li>`).join('')}${r.cost ? `<li data-check="${r.id}-cost" data-t="cost-${r.id}"></li>` : ''}</ul>` : '';
      const finale = r.final ? `<button class="px-btn gold pulse finale" data-act="finale" hidden>${esc(r.name)}</button>` : '';
      const watch = r.manual ? `<div class="making on" data-t="watch-${r.id}" hidden>Watch the pond: a rare microbe is about. Steer your cell into it!</div>` : '';
      return `<div class="card px-box page${r.final ? ' final' : ''}">
        <div class="slot">${icon('unknown', 3)}</div>
        <div class="info">
          <div class="name">${r.final ? esc(r.name) : '???'}</div>
          <div class="flavor">${esc(r.hints.slice(0, level).join(' '))}</div>
          ${checks}${watch}${finale}
        </div>
      </div>`;
    })
    .join('');
  return `<div class="panel-head"><h2>${def.bookName ?? 'Discoveries'}</h2><span class="label dim">${st.discovered.length} / ${rs.length}</span></div>${pages}`;
}

function bookUpdate(root: HTMLElement, state: GameState): void {
  const id = state.current;
  const st = state.stages[id];
  const ready = new Set(engulfable(state, id).map((r) => r.id));
  for (const r of reactions(id)) {
    if (st.discovered.includes(r.id)) {
      if (!r.unlocks || !r.pair) continue;
      const rate = catalysisRate(state, id, r);
      const product = STAGES[id].generators.find((g) => g.id === r.unlocks)!.name;
      const progress = st.catalysis[r.id] ?? 0;
      // The whirlpool only speeds reactions up, so it's never listed as missing here.
      const missing = checkReaction(state, id, r).parts.filter((p) => !p.ok && !/^\d/.test(p.label) && p.label !== 'a strong whirlpool');
      const text =
        rate > 0
          ? `Making ${product} · next in ${formatTime((1 - progress) / rate)}${state.swirl > 0.05 ? ' · whirlpool ×' + (1 + 2 * state.swirl).toFixed(1) : ''}`
          : missing.length
            ? `Paused: needs ${missing[0].label}`
            : 'Paused';
      setText(root, `making-${r.id}`, text);
      root.querySelector(`[data-t="making-${r.id}"]`)?.classList.toggle('on', rate > 0);
      const bar = root.querySelector<HTMLElement>(`[data-bar="${r.id}"] > i`);
      if (bar) {
        bar.style.width = `${Math.round(progress * 100)}%`;
        bar.parentElement!.classList.toggle('on', rate > 0);
      }
      continue;
    }
    const c = checkReaction(state, id, r);
    c.parts.forEach((p, i) => root.querySelector(`[data-check="${r.id}-${i}"]`)?.classList.toggle('ok', p.ok));
    root.querySelector(`[data-check="${r.id}-cost"]`)?.classList.toggle('ok', c.cost);
    if (r.cost) setText(root, `cost-${r.id}`, `${format(st.currency.gte(r.cost) ? D(r.cost) : st.currency)} / ${format(D(r.cost))} ${STAGES[id].currency}`);
    const watch = root.querySelector<HTMLElement>(`[data-t="watch-${r.id}"]`);
    if (watch) watch.hidden = !ready.has(r.id);
    const btn = root.querySelector<HTMLButtonElement>('[data-act="finale"]');
    if (btn && r.final) btn.hidden = !reactionReady(state, id, r);
  }
}

function setText(root: HTMLElement, key: string, text: string): void {
  const el = root.querySelector<HTMLElement>(`[data-t="${key}"]`);
  if (el && el.textContent !== text) el.textContent = text;
}

export function update(root: HTMLElement, state: GameState, tab: Tab): void {
  const id = state.current;
  const st = state.stages[id];

  if (tab === 'grow') {
    for (const g of shownGenerators(state)) {
      const owned = st.generators[g.id];
      const n = buyCount(state, id, g.id, state.buyAmount);
      const cost = generatorCost(state, id, g.id, n);
      setText(root, `owned-${g.id}`, owned ? `×${owned}` : '');
      const free = st.free[g.id] ?? 0;
      setText(root, `sub-${g.id}`, owned ? `${format(generatorRate(state, id, g))}/s · next ×2 at ${nextMilestone(owned)}${free ? ` · ${free} made by reactions` : ''}` : g.flavor);
      setText(root, `cost-${g.id}`, format(cost));
      setText(root, `qty-${g.id}`, `BUY ${n}`);
      const btn = root.querySelector<HTMLButtonElement>(`[data-gen="${g.id}"]`);
      if (btn) {
        btn.disabled = st.currency.lt(cost);
        btn.classList.toggle('gold', !btn.disabled);
      }
      const mini = root.querySelectorAll<HTMLElement>(`[data-mini="${g.id}"] > i`);
      mini.forEach((el, i) => el.classList.toggle('on', owned >= MILESTONES[i]));
    }
    for (const b of root.querySelectorAll<HTMLButtonElement>('[data-amount]')) {
      b.classList.toggle('on', String(state.buyAmount) === b.dataset.amount);
    }
    for (const s of state.unlocked) {
      if (s !== id) setText(root, `auto-${s}`, `${STAGES[s].name} runs itself now: ${format(stageRate(state, s))} ${STAGES[s].currency}/s, boosting everything here.`);
    }
  } else if (tab === 'boosts') {
    for (const u of visibleUpgrades(state, id)) {
      const btn = root.querySelector<HTMLButtonElement>(`[data-up="${u.id}"]`);
      if (btn) {
        btn.disabled = st.currency.lt(u.cost);
        btn.classList.toggle('gold', !btn.disabled);
      }
    }
  } else if (tab === 'mutate') {
    for (const u of visibleUpgrades(state, id)) {
      const btn = root.querySelector<HTMLButtonElement>(`[data-up="${u.id}"]`);
      if (btn) {
        btn.disabled = st.currency.lt(u.cost);
        btn.classList.toggle('gold', !btn.disabled);
      }
    }
  } else if (tab === 'pond') {
    for (const h of STAGES[id].habitats ?? []) {
      setText(root, `hab-${h.id}`, `Your cells here: output ×${habitatMult(state, id, h).toFixed(2)}`);
    }
    bookUpdate(root, state);
  } else if (tab === 'lab') {
    for (const d of visibleDials(state)) {
      const max = dialMax(state, id, d);
      for (const b of root.querySelectorAll<HTMLButtonElement>(`[data-dial="${d}"]`)) {
        const n = Number(b.dataset.level);
        b.disabled = n > max;
        b.classList.toggle('on', st.dials[d] === n);
      }
      // Which molecules this setting helps or hurts, strongest first.
      const fx = shownGenerators(state)
        .filter((g) => g.prefs?.[d])
        .map((g) => ({ name: g.name, m: g.prefs![d]![st.dials[d]] }))
        .sort((a, b) => Math.abs(Math.log(b.m)) - Math.abs(Math.log(a.m)))
        .slice(0, 3)
        .map((x) => `${x.name} ×${+x.m.toFixed(2)}`)
        .join(' · ');
      setText(root, `dialfx-${d}`, fx || 'Nothing you have cares about this yet');
    }
    bookUpdate(root, state);
  } else if (tab === 'time') {
    setText(root, 'bank', formatTime(state.timeBank));
    setText(root, 'bank-cap', `of ${formatTime(timeBankCap(state))}`);
    setText(root, 'offline', `Time away counts for up to ${formatTime(state.offlineCapSec)}.`);
    for (const b of root.querySelectorAll<HTMLButtonElement>('[data-warp]')) {
      const w = Number(b.dataset.warp);
      b.classList.toggle('on', state.warp === w);
      b.disabled = w > 1 && state.timeBank <= 0;
    }
  } else {
    setText(root, 'stats', `Played ${formatTime(state.playTime)} · ${state.taps} stirs`);
  }
}

/** True when only the whirlpool is missing for the final reaction. */
export function finaleNeedsSwirl(state: GameState): boolean {
  const r = reactions(state.current).find((x) => x.final);
  if (!r || state.stages[state.current].discovered.includes(r.id)) return false;
  const c = checkReaction(state, state.current, r);
  return c.gens && c.dials && c.cost && !c.swirl;
}

/** True when a rare microbe can turn up (an organelle is within reach), for the Pond tab's dot. */
export function organelleNear(state: GameState): boolean {
  return engulfable(state, state.current).length > 0;
}

/** True when the final reaction can be triggered, for the Lab tab's dot. */
export function finaleReady(state: GameState): boolean {
  const r = reactions(state.current).find((x) => x.final);
  return !!r && !state.stages[state.current].discovered.includes(r.id) && reactionReady(state, state.current, r);
}

/** True when the Boosts tab has something affordable, for the red dot. */
export function boostReady(state: GameState): boolean {
  const st = state.stages[state.current];
  return visibleUpgrades(state, state.current).some((u) => st.currency.gte(u.cost));
}
