// Ooze to Orbit: the game screen. The scene sits in the middle and takes taps;
// tabs underneath hold everything you buy.

import '@fontsource/pixelify-sans/latin-500.css';
import '@fontsource/pixelify-sans/latin-600.css';
import '@fontsource/pixelify-sans/latin-700.css';
import '@fontsource/jersey-10/latin-400.css';
import './ui/ui.css';

import { icon } from './art/sprites';
import { STAGES } from './content/stages';
import { buyCount, buyGenerator, buyUpgrade, canEvolve, evolve, goalProgress, nextStageTeased, tap } from './economy/actions';
import { D, format, formatTime } from './economy/num';
import { applyOffline, type OfflineReport } from './economy/offline';
import { stageRate } from './economy/rates';
import { clearStorage, exportSave, importSave, loadFromStorage, saveToStorage } from './economy/save';
import { createState } from './economy/state';
import { liveTick, TICK_SEC } from './economy/tick';
import type { BuyAmount, GameState } from './economy/types';
import { Scene } from './scene/scene';
import { boostReady, CURRENCY_ICON, layout, layoutKey, TABS, update, type Tab } from './ui/panels';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const stageEl = $('stage');
const sheet = $('sheet');
const panel = $('panel');
const tabsEl = $('tabs');
const modal = $('modal');
const evolveEl = $('evolve');
const hint = $('hint');

/** Gaps longer than this (app closed, phone locked) go through offline progress. */
const LIVE_GAP_SEC = 5;
const FRAME_MS = 1000 / 30;
const UI_KEY = 'ooze-to-orbit/ui';

let state: GameState = loadFromStorage() ?? createState();
const ui = (() => {
  try {
    return { tab: 'grow' as Tab, open: true, ...JSON.parse(localStorage.getItem(UI_KEY) ?? '{}') };
  } catch {
    return { tab: 'grow' as Tab, open: true };
  }
})();
const saveUi = () => {
  try {
    localStorage.setItem(UI_KEY, JSON.stringify(ui));
  } catch {
    /* private mode: the tab just isn't remembered */
  }
};

const scene = new Scene($<HTMLCanvasElement>('scene'));
let panelKey = '';
/** Entrance animation for the next panel page: which side it slides in from. */
let panelEnter = '';
let evolveKey = '';
let pokedThisStage = false;

// ---- Economy clock ----

function showReport(r: OfflineReport): void {
  const lines = Object.entries(r.earned)
    .filter(([, v]) => v && v.gt(0))
    .map(([k, v]) => `<p>${icon(CURRENCY_ICON[k as keyof typeof CURRENCY_ICON], 2, 'px-icon inline')} +${format(v!)} ${STAGES[k as keyof typeof STAGES].currency}</p>`)
    .join('');
  modal.innerHTML = `<div class="px-box">
    <h3>While you were away</h3>
    <p class="dim">${formatTime(r.awaySec)}${r.capped ? ' (capped)' : ''}</p>
    ${lines}
    ${r.bankedSec > 0 ? `<p class="dim">${formatTime(r.bankedSec)} saved to your time bank.</p>` : ''}
    <button class="px-btn gold" data-act="dismiss">Nice</button>
  </div>`;
  modal.hidden = false;
}

function catchUp(): void {
  const r = applyOffline(state);
  if (r.awaySec >= 60) showReport(r);
}

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

// ---- Rendering ----

function renderTabs(): void {
  tabsEl.innerHTML = TABS.map(
    (t) => `<button class="px-btn tab" data-tab="${t.id}">${icon(t.sprite, 3)}<span>${t.label}</span>${t.id === 'boosts' ? '<i class="dot" hidden></i>' : ''}</button>`,
  ).join('');
}

function renderHud(): void {
  const def = STAGES[state.current];
  const st = state.stages[state.current];
  const set = (id: string, text: string) => {
    const el = $(id);
    if (el.textContent !== text) el.textContent = text;
  };
  set('stage-name', def.name);
  set('currency', format(st.currency));
  set('rate', `${format(stageRate(state, state.current))} ${def.currency}\nper second`);
  set('bank-chip', state.timeBank > 0 ? `⧗ ${formatTime(state.timeBank)}${state.warp > 1 ? ` · ${state.warp}×` : ''}` : '');
  const iconEl = $('currency-icon');
  if (iconEl.dataset.stage !== state.current) {
    iconEl.dataset.stage = state.current;
    iconEl.innerHTML = icon(CURRENCY_ICON[state.current], 4);
  }
}

function renderEvolve(): void {
  const def = STAGES[state.current];
  const teased = nextStageTeased(state);
  const ready = canEvolve(state);
  const key = JSON.stringify([state.current, teased, ready]);
  if (key !== evolveKey) {
    evolveKey = key;
    evolveEl.hidden = !teased;
    const nextName = def.next ? STAGES[def.next].name : 'Creature';
    evolveEl.innerHTML = `
      <div class="evolve-row"><span class="label">Next: ${nextName}</span><span class="label dim" data-t="eta"></span></div>
      <div class="bar">${'<i></i>'.repeat(20)}</div>
      ${ready ? '<button class="px-btn gold pulse" data-act="evolve">Evolve</button>' : ''}
      ${!def.next && goalProgress(state) >= 1 ? '<p class="dim label" style="margin:8px 0 0">Arrives in the next update</p>' : ''}`;
  }
  if (!teased) return;
  const p = goalProgress(state);
  evolveEl.querySelectorAll('.bar > i').forEach((el, i) => el.classList.toggle('on', p >= (i + 1) / 20));
  const st = state.stages[state.current];
  const rate = stageRate(state, state.current);
  const eta = p >= 1 ? 'Ready' : rate.gt(0) ? `about ${formatTime(D(def.goal).sub(st.currency).div(rate).toNumber())}` : '';
  const el = evolveEl.querySelector('[data-t="eta"]')!;
  if (el.textContent !== eta) el.textContent = eta;
}

function renderPanel(): void {
  sheet.classList.toggle('closed', !ui.open);
  for (const b of tabsEl.querySelectorAll<HTMLButtonElement>('[data-tab]')) b.classList.toggle('on', ui.open && b.dataset.tab === ui.tab);
  const dot = tabsEl.querySelector<HTMLElement>('.dot');
  if (dot) dot.hidden = !boostReady(state);
  if (!ui.open) return;
  const key = layoutKey(state, ui.tab);
  if (key !== panelKey) {
    panelKey = key;
    const keepText = ($('save-text') as HTMLTextAreaElement | null)?.value ?? '';
    panel.innerHTML = `<div class="panel-inner ${panelEnter}">${layout(state, ui.tab)}</div>`;
    panelEnter = '';
    const ta = $('save-text') as HTMLTextAreaElement | null;
    if (ta) ta.value = keepText;
  }
  update(panel, state, ui.tab);
}

function renderHint(): void {
  const text = state.current === 'soup' ? (state.taps < 3 ? 'Tap the soup to stir it' : '') : pokedThisStage ? '' : 'Tap to poke your cells';
  hint.hidden = !text || !modal.hidden;
  if (hint.textContent !== text) hint.textContent = text;
}

function render(): void {
  renderHud();
  renderEvolve();
  renderPanel();
  renderHint();
}

// ---- Input ----

stageEl.addEventListener('pointerdown', (e) => {
  if (!modal.hidden || (e.target as HTMLElement).closest('#evolve')) return;
  const r = stageEl.getBoundingClientRect();
  const x = e.clientX - r.left;
  const y = e.clientY - r.top;
  scene.ripple(x, y);
  if (state.current === 'soup') {
    const v = tap(state);
    if (v.gt(0)) scene.float(x, y - 10, `+${format(v)}`, '#f5c45e');
  } else {
    const quip = scene.poke(x, y);
    pokedThisStage = true;
    if (quip) scene.float(x, y - 14, quip, '#f2ead7');
  }
  render();
});

function act(el: HTMLElement): void {
  const id = state.current;
  if (el.dataset.gen) buyGenerator(state, id, el.dataset.gen, buyCount(state, id, el.dataset.gen, state.buyAmount));
  else if (el.dataset.up) buyUpgrade(state, id, el.dataset.up);
  else if (el.dataset.amount) state.buyAmount = el.dataset.amount === 'max' ? 'max' : (Number(el.dataset.amount) as BuyAmount);
  else if (el.dataset.warp) state.warp = Number(el.dataset.warp);
  else if (el.dataset.tab) {
    const t = el.dataset.tab as Tab;
    const order = TABS.map((x) => x.id);
    if (!ui.open) panelEnter = 'from-below';
    else if (t !== ui.tab) panelEnter = order.indexOf(t) > order.indexOf(ui.tab) ? 'from-right' : 'from-left';
    ui.open = ui.tab === t ? !ui.open : true;
    ui.tab = t;
    saveUi();
    if (panelEnter) {
      // Rebuild the page so its entrance plays, starting from the top.
      panelKey = '';
      panel.scrollTop = 0;
    }
  } else {
    const ta = $('save-text') as HTMLTextAreaElement | null;
    switch (el.dataset.act) {
      case 'evolve':
        if (evolve(state)) {
          scene.evolveFlash();
          pokedThisStage = false;
        }
        break;
      case 'dismiss':
        modal.hidden = true;
        break;
      case 'export':
        if (ta) {
          ta.value = exportSave(state);
          ta.select();
        }
        break;
      case 'import':
        try {
          state = importSave(ta?.value ?? '');
          catchUp();
          if (ta) ta.value = '';
        } catch {
          alert('That save code could not be read.');
        }
        break;
      case 'reset':
        if (confirm('Restart from the very beginning? This cannot be undone.')) {
          clearStorage();
          state = createState();
        }
        break;
    }
  }
  save();
  render();
}

document.addEventListener('click', (e) => {
  const el = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
  if (el && !el.disabled) act(el);
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') save();
  else {
    catchUp();
    render();
  }
});
window.addEventListener('pagehide', save);
// The scene resizes as the sheet slides; redraw at once so it never flashes blank.
new ResizeObserver(() => {
  scene.fit();
  scene.draw(state, 0);
}).observe(stageEl);

// ---- Loops ----

let last = performance.now();
let acc = 0;
function frame(now: number): void {
  requestAnimationFrame(frame);
  acc += now - last;
  last = now;
  if (acc < FRAME_MS) return;
  const dt = Math.min(acc, 100) / 1000;
  acc %= FRAME_MS;
  scene.draw(state, dt);
}

renderTabs();
catchUp();
render();
document.fonts?.ready.then(() => render());
requestAnimationFrame(frame);
setInterval(step, TICK_SEC * 1000);
setInterval(render, 250);
setInterval(save, 10_000);
