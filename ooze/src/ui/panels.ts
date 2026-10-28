// The tab panels under the scene. Each panel is laid out once (when its rows
// change) and then patched in place, so a button never vanishes under a finger.

import { icon, type SpriteName } from '../art/sprites';
import { STAGES } from '../content/stages';
import { buyCount, generatorCost, visibleUpgrades } from '../economy/actions';
import { D, format, formatTime } from '../economy/num';
import { timeBankCap } from '../economy/offline';
import { generatorRate, MILESTONES, nextMilestone, stageRate } from '../economy/rates';
import type { BuyAmount, Effect, GameState, StageId } from '../economy/types';

export type Tab = 'grow' | 'boosts' | 'time' | 'menu';

export const TABS: { id: Tab; label: string; sprite: SpriteName }[] = [
  { id: 'grow', label: 'Grow', sprite: 'sprout' },
  { id: 'boosts', label: 'Boosts', sprite: 'spark' },
  { id: 'time', label: 'Time', sprite: 'hourglass' },
  { id: 'menu', label: 'Menu', sprite: 'menu' },
];

export const CURRENCY_ICON: Record<StageId, SpriteName> = { soup: 'nutrient', cell: 'dna' };
export const WARPS = [1, 2, 5, 10];
const AMOUNTS: BuyAmount[] = [1, 10, 'max'];

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

function shownGenerators(state: GameState) {
  const def = STAGES[state.current];
  const st = state.stages[state.current];
  return def.generators.filter((g, i) => i === 0 || st.generators[g.id] > 0 || st.generators[def.generators[i - 1].id] > 0);
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
  }
}

/** A key that changes whenever a panel needs re-laying out. */
export function layoutKey(state: GameState, tab: Tab): string {
  return JSON.stringify([
    tab,
    state.current,
    tab === 'grow' ? shownGenerators(state).map((g) => g.id) : 0,
    tab === 'grow' ? state.unlocked : 0,
    tab === 'boosts' ? visibleUpgrades(state, state.current).map((u) => u.id) : 0,
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
    const locked = shownGenerators(state).length < def.generators.length ? `<p class="note">Own one of the last tier to discover the next.</p>` : '';
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
      setText(root, `sub-${g.id}`, owned ? `${format(generatorRate(state, id, g))}/s · next ×2 at ${nextMilestone(owned)}` : g.flavor);
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

/** True when the Boosts tab has something affordable, for the red dot. */
export function boostReady(state: GameState): boolean {
  const st = state.stages[state.current];
  return visibleUpgrades(state, state.current).some((u) => st.currency.gte(u.cost));
}
