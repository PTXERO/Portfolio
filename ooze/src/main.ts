// M1 economy test page: plain numbers and buttons, no art yet.
//
// The page is laid out only when its structure changes (a new stage, a new row).
// Numbers and button states are then patched in place four times a second, so a
// button is never replaced under a finger mid-tap (iOS would drop the click).

import { STAGES } from './content/stages';
import {
  buyCount,
  buyGenerator,
  buyUpgrade,
  canEvolve,
  evolve,
  generatorCost,
  goalProgress,
  nextStageTeased,
  tap,
  visibleUpgrades,
} from './economy/actions';
import { D, format, formatTime } from './economy/num';
import { applyOffline, timeBankCap, type OfflineReport } from './economy/offline';
import { generatorRate, nextMilestone, stageRate, tapValue } from './economy/rates';
import { clearStorage, exportSave, importSave, loadFromStorage, saveToStorage } from './economy/save';
import { createState } from './economy/state';
import { liveTick, TICK_SEC } from './economy/tick';
import type { BuyAmount, GameState } from './economy/types';

const game = document.getElementById('game')!;
const saveBox = document.getElementById('save-text') as HTMLTextAreaElement;
const WARPS = [1, 2, 5, 10];
const AMOUNTS: BuyAmount[] = [1, 10, 'max'];
/** Gaps longer than this (tab hidden, phone locked) go through offline progress. */
const LIVE_GAP_SEC = 5;

let state: GameState = loadFromStorage() ?? createState();
let report: OfflineReport | null = null;
let layoutKey = '';

function catchUp(): void {
  const r = applyOffline(state);
  if (r.awaySec >= 30) report = r;
}
catchUp();

function step(): void {
  const now = Date.now();
  const gap = (now - state.lastSeen) / 1000;
  if (gap > LIVE_GAP_SEC) catchUp();
  else {
    liveTick(state, gap);
    state.lastSeen = now;
  }
}

const save = () => saveToStorage(state);
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

/** Generators on show: owned ones, plus the next tier up. */
function shownGenerators() {
  const def = STAGES[state.current];
  const st = state.stages[state.current];
  return def.generators.filter((g, i) => i === 0 || st.generators[g.id] > 0 || st.generators[def.generators[i - 1].id] > 0);
}

function layout(): void {
  const id = state.current;
  const def = STAGES[id];
  const gens = shownGenerators()
    .map(
      (g) => `<div class="row">
        <div class="info"><div class="name">${esc(g.name)} <span class="dim" data-text="owned-${g.id}"></span></div>
        <div class="sub" data-text="sub-${g.id}"></div></div>
        <button data-gen="${g.id}" data-text="buy-${g.id}"></button>
      </div>`,
    )
    .join('');
  const ups = visibleUpgrades(state, id)
    .map(
      (u) => `<div class="row">
        <div class="info"><div class="name">${esc(u.name)}</div><div class="sub">${esc(u.flavor)}</div></div>
        <button data-up="${u.id}">${format(D(u.cost))}</button>
      </div>`,
    )
    .join('');
  const nextName = def.next ? STAGES[def.next].name : 'Creature (coming in M3)';
  const background = state.unlocked.filter((sid) => sid !== id);

  game.innerHTML = `
    ${report ? `<div class="banner"><span data-text="report"></span><br><button data-act="dismiss" style="margin-top:8px">OK</button></div>` : ''}
    <h1>${esc(def.name)}</h1>
    <div class="big" data-text="currency"></div>
    <div class="rate" data-text="rate"></div>
    <p class="intro">${esc(def.intro)}</p>
    ${def.tapBase > 0 ? `<button class="tap" data-act="tap" data-text="tap"></button>` : ''}
    ${
      nextStageTeased(state)
        ? `<h2>Next: ${esc(nextName)}</h2>
           <div class="progress"><div data-bar></div></div>
           <div class="dim" data-text="goal"></div>
           ${def.next ? `<button class="primary" style="margin-top:8px;width:100%" data-act="evolve">Evolve</button>` : ''}`
        : ''
    }
    <h2>Generators</h2>
    <div class="amounts">${AMOUNTS.map((a) => `<button data-amount="${a}">${a === 'max' ? 'Max' : `x${a}`}</button>`).join('')}</div>
    ${gens}
    ${ups ? `<h2>Upgrades</h2>${ups}` : ''}
    ${background.length ? `<h2>Running in the background</h2>${background.map((sid) => `<div class="dim" data-text="bg-${sid}"></div>`).join('')}` : ''}
    <h2 data-text="bank"></h2>
    <div class="amounts">${WARPS.map((w) => `<button data-warp="${w}">${w}x</button>`).join('')}</div>
    <p class="dim" data-text="stats"></p>`;
}

function setText(key: string, text: string): void {
  const el = game.querySelector<HTMLElement>(`[data-text="${key}"]`);
  if (el && el.textContent !== text) el.textContent = text;
}

function update(): void {
  const key = JSON.stringify([
    state.current,
    shownGenerators().map((g) => g.id),
    visibleUpgrades(state, state.current).map((u) => u.id),
    nextStageTeased(state),
    !!report,
    state.unlocked,
  ]);
  if (key !== layoutKey) {
    layoutKey = key;
    layout();
  }

  const id = state.current;
  const def = STAGES[id];
  const st = state.stages[id];
  const rate = stageRate(state, id);

  setText('currency', format(st.currency));
  setText('rate', `${def.currency} · ${format(rate)}/s`);
  setText('tap', state.started ? `Stir the soup (+${format(tapValue(state))})` : 'Stir the soup to begin');

  for (const g of shownGenerators()) {
    const owned = st.generators[g.id];
    const n = buyCount(state, id, g.id, state.buyAmount);
    const cost = generatorCost(state, id, g.id, n);
    setText(`owned-${g.id}`, `×${owned}`);
    setText(`sub-${g.id}`, `${owned ? `${format(generatorRate(state, id, g))}/s total · ` : ''}x2 at ${nextMilestone(owned)}`);
    setText(`buy-${g.id}`, `+${n} · ${format(cost)}`);
    const btn = game.querySelector<HTMLButtonElement>(`[data-gen="${g.id}"]`);
    if (btn) btn.disabled = st.currency.lt(cost);
  }
  for (const u of visibleUpgrades(state, id)) {
    const btn = game.querySelector<HTMLButtonElement>(`[data-up="${u.id}"]`);
    if (btn) btn.disabled = st.currency.lt(u.cost);
  }

  const progress = goalProgress(state);
  const bar = game.querySelector<HTMLElement>('[data-bar]');
  if (bar) bar.style.width = `${(progress * 100).toFixed(1)}%`;
  const eta = progress < 1 && rate.gt(0) ? ` · about ${formatTime(D(def.goal).sub(st.currency).div(rate).toNumber())}` : '';
  setText('goal', `${format(st.currency)} / ${format(D(def.goal))} ${def.currency}${eta}`);
  const evolveBtn = game.querySelector<HTMLButtonElement>('[data-act="evolve"]');
  if (evolveBtn) evolveBtn.disabled = !canEvolve(state);

  for (const sid of state.unlocked) {
    if (sid !== id) setText(`bg-${sid}`, `${STAGES[sid].name}: ${format(stageRate(state, sid))} ${STAGES[sid].currency}/s, automated`);
  }

  if (report) {
    const earned = Object.entries(report.earned)
      .map(([k, v]) => `+${format(v!)} ${STAGES[k as keyof typeof STAGES].currency}`)
      .join(', ');
    setText(
      'report',
      `While you were away (${formatTime(report.awaySec)}${report.capped ? ', capped' : ''}): ${earned}.` +
        (report.bankedSec > 0 ? ` ${formatTime(report.bankedSec)} saved to the time bank.` : ''),
    );
  }

  for (const b of game.querySelectorAll<HTMLButtonElement>('[data-amount]')) {
    b.classList.toggle('on', String(state.buyAmount) === b.dataset.amount);
  }
  for (const b of game.querySelectorAll<HTMLButtonElement>('[data-warp]')) {
    const w = Number(b.dataset.warp);
    b.classList.toggle('on', state.warp === w);
    b.disabled = w > 1 && state.timeBank <= 0;
  }
  setText('bank', `Time bank: ${formatTime(state.timeBank)} of ${formatTime(timeBankCap(state))}`);
  setText('stats', `Played ${formatTime(state.playTime)} · ${state.taps} taps · offline cap ${formatTime(state.offlineCapSec)}`);
}

game.addEventListener('click', (e) => {
  const el = (e.target as HTMLElement).closest('button');
  if (!el || el.disabled) return;
  const id = state.current;
  if (el.dataset.gen) buyGenerator(state, id, el.dataset.gen, buyCount(state, id, el.dataset.gen, state.buyAmount));
  else if (el.dataset.up) buyUpgrade(state, id, el.dataset.up);
  else if (el.dataset.amount) state.buyAmount = el.dataset.amount === 'max' ? 'max' : (Number(el.dataset.amount) as BuyAmount);
  else if (el.dataset.warp) state.warp = Number(el.dataset.warp);
  else if (el.dataset.act === 'tap') tap(state);
  else if (el.dataset.act === 'evolve') evolve(state);
  else if (el.dataset.act === 'dismiss') report = null;
  save();
  update();
});

document.getElementById('save-tools')!.addEventListener('click', (e) => {
  const act = (e.target as HTMLElement).closest('button')?.dataset.act;
  if (act === 'export') {
    saveBox.value = exportSave(state);
    saveBox.select();
  } else if (act === 'import') {
    try {
      state = importSave(saveBox.value);
      catchUp();
      saveBox.value = '';
      save();
    } catch {
      alert('That save could not be read.');
    }
  } else if (act === 'reset' && confirm('Start over from the beginning?')) {
    clearStorage();
    state = createState();
    report = null;
  }
  update();
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') save();
  else {
    catchUp();
    update();
  }
});
window.addEventListener('pagehide', save);

setInterval(step, TICK_SEC * 1000);
setInterval(update, 250);
setInterval(save, 30_000);
update();
