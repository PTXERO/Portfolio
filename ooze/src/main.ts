// Ooze to Orbit: the game screen. The scene sits in the middle and takes taps
// (and, in the Soup, circling fingers); tabs underneath hold everything else.

import '@fontsource/pixelify-sans/latin-500.css';
import '@fontsource/pixelify-sans/latin-600.css';
import '@fontsource/pixelify-sans/latin-700.css';
import '@fontsource/jersey-10/latin-400.css';
import './ui/ui.css';

import { icon } from './art/sprites';
import { STAGES } from './content/stages';
import {
  addSwirl,
  buyCount,
  buyGenerator,
  buyUpgrade,
  canEvolve,
  engulf,
  engulfable,
  evolve,
  fendOff,
  forage,
  goalProgress,
  goalShown,
  moveHabitat,
  nextReaction,
  reactions,
  setDial,
  tap,
  triggerFinale,
} from './economy/actions';
import { D, format, formatTime } from './economy/num';
import { applyOffline, type OfflineReport } from './economy/offline';
import { dietOf, stageRate } from './economy/rates';
import { clearStorage, exportSave, importSave, loadFromStorage, saveToStorage } from './economy/save';
import { createState } from './economy/state';
import { liveTick, TICK_SEC } from './economy/tick';
import type { BuyAmount, DialId, GameState } from './economy/types';
import { Scene } from './scene/scene';
import { boostReady, CURRENCY_ICON, finaleNeedsSwirl, finaleReady, layout, layoutKey, organelleNear, rewardText, TABS, tabsFor, update, type Tab } from './ui/panels';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const stageEl = $('stage');
const sheet = $('sheet');
const panel = $('panel');
const tabsEl = $('tabs');
const modal = $('modal');
const evolveEl = $('evolve');
const hint = $('hint');
const ending = $('ending');
const overlayTop = $('overlay-top');

/** Gaps longer than this (app closed, phone locked) go through offline progress. */
const LIVE_GAP_SEC = 5;
const FRAME_MS = 1000 / 30;
const UI_KEY = 'ooze-to-orbit/ui';

let state: GameState = loadFromStorage() ?? createState();
// For automated checks and debugging from the browser console.
(window as unknown as { ooze: () => GameState }).ooze = () => state;
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
let goalKey = '';
let tabsKey = '';
let pokedThisStage = false;
/** Reaction discoveries waiting to be shown, one card at a time. */
const discoveryQueue: string[] = [];

// ---- Economy clock ----

function showModal(html: string): void {
  modal.innerHTML = `<div class="px-box">${html}</div>`;
  modal.hidden = false;
}

function showReport(r: OfflineReport): void {
  const lines = Object.entries(r.earned)
    .filter(([, v]) => v && v.gt(0))
    .map(([k, v]) => `<p>${icon(CURRENCY_ICON[k as keyof typeof CURRENCY_ICON], 2, 'px-icon inline')} +${format(v!)} ${STAGES[k as keyof typeof STAGES].currency}</p>`)
    .join('');
  showModal(`<h3>While you were away</h3>
    <p class="dim">${formatTime(r.awaySec)}${r.capped ? ' (capped)' : ''}</p>
    ${lines}
    ${r.bankedSec > 0 ? `<p class="dim">${formatTime(r.bankedSec)} saved to your time bank.</p>` : ''}
    <button class="px-btn gold" data-act="dismiss">Nice</button>`);
}

/** Shows the next discovered reaction, if nothing else is on screen. */
function showDiscovery(): void {
  if (!modal.hidden || !discoveryQueue.length) return;
  const id = discoveryQueue.shift()!;
  const r = reactions(state.current).find((x) => x.id === id);
  if (!r) return;
  scene.discovery();
  const n = state.stages[state.current].discovered.indexOf(id) + 1;
  const kind = STAGES[state.current].habitats ? 'New organelle' : 'New reaction';
  showModal(`<p class="label dim">${kind} · ${n} of ${reactions(state.current).length}</p>
    <h3>${r.name}</h3>
    <p>${r.flavor}</p>
    <p class="fx">${rewardText(state.current, r)}</p>
    <button class="px-btn gold" data-act="dismiss">Into the book</button>`);
}

function collectNews(): void {
  if (state.made.length) scene.made(state.made.splice(0));
  if (!state.news.length) return;
  discoveryQueue.push(...state.news);
  state.news = [];
  save();
}

function catchUp(): void {
  const r = applyOffline(state);
  if (r.awaySec >= 60) showReport(r);
  collectNews();
}

function step(): void {
  const now = Date.now();
  const gap = (now - state.lastSeen) / 1000;
  if (gap > LIVE_GAP_SEC) catchUp();
  else {
    liveTick(state, gap);
    state.lastSeen = now;
  }
  collectNews();
}

const save = () => saveToStorage(state);

// ---- Rendering ----

function renderTabs(): void {
  const ids = tabsFor(state);
  const key = ids.join();
  if (key === tabsKey) return;
  tabsKey = key;
  if (!ids.includes(ui.tab)) ui.tab = 'grow';
  tabsEl.style.gridTemplateColumns = `repeat(${ids.length}, 1fr)`;
  tabsEl.innerHTML = TABS.filter((t) => ids.includes(t.id))
    .map((t) => `<button class="px-btn tab" data-tab="${t.id}">${icon(t.sprite, 3)}<span>${t.label}</span><i class="dot" hidden></i></button>`)
    .join('');
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

/** The strip under the top bar: this stage's own goal. It never names what comes next. */
function renderGoal(): void {
  const def = STAGES[state.current];
  const rs = reactions(state.current);
  const shown = goalShown(state);
  const finale = finaleReady(state);
  const almost = finaleNeedsSwirl(state);
  const ready = canEvolve(state);
  const key = JSON.stringify([state.current, shown, finale, almost, ready, rs.length]);
  if (key !== goalKey) {
    goalKey = key;
    evolveEl.hidden = !shown;
    const pips = rs.length || 20;
    const label = rs.length ? (def.bookName ?? 'Discoveries') : 'Something is changing';
    const button = finale
      ? `<button class="px-btn gold pulse" data-act="finale">${rs.find((r) => r.final)!.name}</button>`
      : almost
        ? '<button class="px-btn" disabled>Spin up a whirlpool…</button>'
        : ready && !rs.length
        ? '<button class="px-btn gold pulse" data-act="evolve">Evolve</button>'
        : '';
    evolveEl.innerHTML = `
      <div class="evolve-row"><span class="label">${label}</span><span class="label dim" data-t="goal-note"></span></div>
      <div class="bar">${'<i></i>'.repeat(pips)}</div>
      ${rs.length ? '<div class="goal-next" data-t="goal-next"></div>' : ''}${button}`;
  }
  if (!shown) return;
  const st = state.stages[state.current];
  const bars = evolveEl.querySelectorAll('.bar > i');
  if (rs.length) bars.forEach((el, i) => el.classList.toggle('on', i < st.discovered.length));
  else bars.forEach((el, i) => el.classList.toggle('on', goalProgress(state) >= (i + 1) / bars.length));
  const rate = stageRate(state, state.current);
  const note = rs.length
    ? `${st.discovered.length} / ${rs.length}`
    : goalProgress(state) >= 1
      ? def.next
        ? 'Ready'
        : 'Not yet…'
      : rate.gt(0)
        ? `about ${formatTime(D(def.goal).sub(st.currency).div(rate).toNumber())}`
        : '';
  const el = evolveEl.querySelector('[data-t="goal-note"]')!;
  if (el.textContent !== note) el.textContent = note;

  // What the next reaction still needs, so it's clear whether the mix is right.
  const nextEl = evolveEl.querySelector('[data-t="goal-next"]');
  if (nextEl) {
    const n = nextReaction(state, state.current);
    let text = '';
    if (engulfable(state, state.current).length) text = 'A rare microbe is about: steer your cell into it!';
    else if (n && !finaleReady(state)) {
      const name = n.r.final ? n.r.name : '???';
      const missing = n.check.parts.filter((p) => !p.ok);
      if (!n.check.gens && !def.habitats) text = `Next ${name}: grow ${missing.find((p) => /^\d/.test(p.label))?.label ?? 'more molecules'}`;
      else if (missing.length || !n.check.cost) {
        const met = n.check.parts.length - missing.length;
        let need = missing[0]?.label;
        if (!need) {
          // Only the cost is left: show how far along and how long to go.
          const st = state.stages[state.current];
          const cost = D(n.r.cost ?? 0);
          const rate = stageRate(state, state.current);
          const eta = rate.gt(0) ? ` · about ${formatTime(cost.sub(st.currency).div(rate).toNumber())}` : '';
          need = `${format(cost)} ${def.currency} (have ${format(st.currency)})${eta}`;
        }
        text = `Next ${name}: ${met} of ${n.check.parts.length} · needs ${need}`;
      } else text = `${name}: reacting…`;
    }
    if (nextEl.textContent !== text) nextEl.textContent = text;
  }
}

function renderPanel(): void {
  sheet.classList.toggle('closed', !ui.open);
  for (const b of tabsEl.querySelectorAll<HTMLButtonElement>('[data-tab]')) {
    b.classList.toggle('on', ui.open && b.dataset.tab === ui.tab);
    const dot = b.querySelector<HTMLElement>('.dot');
    const t = b.dataset.tab;
    const on = t === 'boosts' || t === 'mutate' ? boostReady(state) : t === 'lab' ? finaleReady(state) : t === 'pond' ? organelleNear(state) || finaleReady(state) : false;
    if (dot) dot.hidden = !on;
  }
  if (!ui.open) return;
  const key = layoutKey(state, ui.tab);
  if (key !== panelKey) {
    panelKey = key;
    const keepText = ($('save-text') as HTMLTextAreaElement | null)?.value ?? '';
    const keepScroll = panelEnter ? 0 : panel.scrollTop;
    panel.innerHTML = `<div class="panel-inner ${panelEnter}">${layout(state, ui.tab)}</div>`;
    panel.scrollTop = keepScroll;
    panelEnter = '';
    const ta = $('save-text') as HTMLTextAreaElement | null;
    if (ta) ta.value = keepText;
  }
  update(panel, state, ui.tab);
}

function renderHint(): void {
  let text = '';
  if (state.current === 'soup') {
    const st = state.stages.soup;
    if (state.taps < 3) text = 'Tap the soup to stir it';
    else if (st.discovered.includes('phosphorylation') && !st.discovered.includes('polymerization') && state.swirl < 0.05) text = 'Draw circles to spin a whirlpool';
  } else if (!pokedThisStage) text = 'Tap to steer your cell';
  else if (!dietOf(state, state.current)) text = 'Pick a diet in Mutate so your cell can eat';
  hint.hidden = !text || !modal.hidden;
  if (hint.textContent !== text) hint.textContent = text;
}

function render(): void {
  renderTabs();
  renderHud();
  renderGoal();
  scene.setTopInset(overlayTop.getBoundingClientRect().bottom - stageEl.getBoundingClientRect().top);
  renderPanel();
  renderHint();
  showDiscovery();
}

// ---- A stage's ending ----

function playEnding(): void {
  const def = STAGES[state.current];
  const st = state.stages[state.current];
  const book = def.bookName ?? 'Discoveries';
  const stats = [
    ['Time', formatTime(state.playTime)],
    def.habitats ? ['Food eaten', String(st.eaten)] : ['Stirs', String(state.taps)],
    [book, `${st.discovered.length} / ${reactions(state.current).length}`],
    [`${def.currency[0].toUpperCase()}${def.currency.slice(1)} made`, format(st.totalEarned)],
  ];
  if (state.current === 'soup') scene.finale();
  else scene.evolveFlash();
  // With nothing built after this stage yet, the ending says so instead of going on.
  const after = def.next
    ? `<p class="stir">…but something is still moving.</p>
      <button class="px-btn gold pulse" data-act="look">Look closer</button>`
    : `<p class="stir">The story continues in a future update.</p>
      <button class="px-btn gold" data-act="keep">Keep watching</button>`;
  ending.innerHTML = `<div class="ending-inner">
    <p class="label dim">${def.name}</p>
    <h1>${def.ending?.title ?? 'The end.'}</h1>
    <p>${def.ending?.line ?? ''}</p>
    <dl>${stats.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>
    <p class="thanks">Thank you for playing.</p>
    <div class="after" hidden>${after}</div>
  </div>`;
  ending.hidden = false;
  requestAnimationFrame(() => ending.classList.add('in'));
  // A long beat on "the end" first, so it feels like the end.
  setTimeout(() => {
    ending.querySelector<HTMLElement>('.after')!.hidden = false;
  }, 6500);
}

function closeEnding(): void {
  ending.classList.remove('in');
  setTimeout(() => (ending.hidden = true), 600);
  if (evolve(state)) {
    scene.evolveFlash();
    pokedThisStage = false;
    ui.tab = 'grow';
    panelKey = '';
  }
}

/** Applies what happened in the pond: food eaten, organelles engulfed, predators driven off. */
function pondEvents(): void {
  for (const e of scene.pondEvents()) {
    if (e.type === 'eat') scene.float(e.x, e.y - 8, `+${format(forage(state, e.food))}`, '#7fe0b0');
    else if (e.type === 'engulf') {
      if (engulf(state, state.current, e.id)) scene.float(e.x, e.y - 10, 'engulfed!', '#f5c45e');
    } else if (e.type === 'rare') scene.float(e.x, e.y - 10, 'a rare microbe!', '#f5c45e');
    else if (e.type === 'hit') scene.float(e.x, e.y - 10, ['thwack', 'ow!', 'scram!'][Math.floor(Math.random() * 3)], '#f2ead7');
    else if (e.type === 'fend') scene.float(e.x, e.y - 10, `driven off! +${format(fendOff(state))}`, '#f5c45e');
  }
  collectNews();
}

// ---- Input ----

/** Finger tracking for the whirlpool: turns are summed around the path's recent centre. */
let swirlPath: { x: number; y: number }[] = [];
let swirlAngle: number | null = null;
let swirlSpin = 0;

stageEl.addEventListener('pointerdown', (e) => {
  if (!modal.hidden || (e.target as HTMLElement).closest('#evolve')) return;
  stageEl.setPointerCapture(e.pointerId);
  const r = stageEl.getBoundingClientRect();
  const x = e.clientX - r.left;
  const y = e.clientY - r.top;
  swirlPath = [{ x, y }];
  swirlAngle = null;
  swirlSpin = 0;
  scene.ripple(x, y);
  if (state.current === 'soup') {
    const v = tap(state);
    if (v.gt(0)) scene.float(x, y - 10, `+${format(v)}`, '#f5c45e');
  } else {
    const { quip } = scene.cellTap(state, x, y);
    pokedThisStage = true;
    if (quip) scene.float(x, y - 14, quip, '#f2ead7');
  }
  render();
});

stageEl.addEventListener('pointermove', (e) => {
  if (!swirlPath.length || state.current !== 'soup') return;
  const r = stageEl.getBoundingClientRect();
  const p = { x: e.clientX - r.left, y: e.clientY - r.top };
  swirlPath.push(p);
  if (swirlPath.length > 40) swirlPath.shift();
  const cx = swirlPath.reduce((a, q) => a + q.x, 0) / swirlPath.length;
  const cy = swirlPath.reduce((a, q) => a + q.y, 0) / swirlPath.length;
  if (Math.hypot(p.x - cx, p.y - cy) < 12) return;
  const a = Math.atan2(p.y - cy, p.x - cx);
  if (swirlAngle !== null) {
    let d = a - swirlAngle;
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    // Only consistent turning counts; scribbling back and forth doesn't.
    if (Math.sign(d) === Math.sign(swirlSpin) || swirlSpin === 0) {
      swirlSpin += d;
      addSwirl(state, Math.abs(d) / (Math.PI * 2));
      scene.whirl(cx, cy, Math.sign(swirlSpin));
    } else swirlSpin = d;
  }
  swirlAngle = a;
});

const endSwirl = () => {
  swirlPath = [];
  swirlAngle = null;
};
stageEl.addEventListener('pointerup', endSwirl);
stageEl.addEventListener('pointercancel', endSwirl);

function act(el: HTMLElement): void {
  const id = state.current;
  if (el.dataset.gen) {
    if (buyGenerator(state, id, el.dataset.gen, buyCount(state, id, el.dataset.gen, state.buyAmount))) scene.purchase(state, el.dataset.gen);
  } else if (el.dataset.up) {
    if (buyUpgrade(state, id, el.dataset.up)) scene.purchase(state, el.dataset.up);
  } else if (el.dataset.dial) setDial(state, id, el.dataset.dial as DialId, Number(el.dataset.level));
  else if (el.dataset.amount) state.buyAmount = el.dataset.amount === 'max' ? 'max' : (Number(el.dataset.amount) as BuyAmount);
  else if (el.dataset.warp) state.warp = Number(el.dataset.warp);
  else if (el.dataset.habitat) moveHabitat(state, id, el.dataset.habitat);
  else if (el.dataset.tab) {
    const t = el.dataset.tab as Tab;
    const order = tabsFor(state);
    if (!ui.open) panelEnter = 'from-below';
    else if (t !== ui.tab) panelEnter = order.indexOf(t) > order.indexOf(ui.tab) ? 'from-right' : 'from-left';
    ui.open = ui.tab === t ? !ui.open : true;
    ui.tab = t;
    saveUi();
    if (panelEnter) panelKey = '';
  } else {
    const ta = $('save-text') as HTMLTextAreaElement | null;
    switch (el.dataset.act) {
      case 'finale':
        if (triggerFinale(state)) playEnding();
        break;
      case 'look':
        closeEnding();
        break;
      case 'keep':
        ending.classList.remove('in');
        setTimeout(() => (ending.hidden = true), 600);
        break;
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
          scene.reload();
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
          scene.reload();
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

// Tapping the book strip opens the book: the Lab in the Soup, the Pond after.
evolveEl.addEventListener('click', (e) => {
  const tabs = tabsFor(state);
  const book: Tab | null = tabs.includes('lab') ? 'lab' : tabs.includes('pond') ? 'pond' : null;
  if ((e.target as HTMLElement).closest('button') || !book) return;
  if (ui.tab !== book || !ui.open) {
    panelEnter = ui.open ? 'from-right' : 'from-below';
    panelKey = '';
  }
  ui.tab = book;
  ui.open = true;
  saveUi();
  render();
});

/** Reloads onto a newer build when there is one, so a tab left open never runs old rules. */
async function checkForUpdate(): Promise<void> {
  try {
    const mine = document.querySelector<HTMLScriptElement>('script[src*="/assets/index-"]')?.src.match(/index-[^/]+\.js/)?.[0];
    const html = await (await fetch('./', { cache: 'no-store' })).text();
    const live = html.match(/index-[^"/]+\.js/)?.[0];
    if (mine && live && live !== mine) {
      save();
      location.reload();
    }
  } catch {
    /* offline: keep playing this build */
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') save();
  else {
    catchUp();
    render();
    if (!import.meta.env.DEV) void checkForUpdate();
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
  pondEvents();
}

// A save made mid-ending (closed during the credits) picks up at the reveal.
if (state.current === 'soup' && canEvolve(state)) playEnding();
catchUp();
render();
document.fonts?.ready.then(() => render());
requestAnimationFrame(frame);
setInterval(step, TICK_SEC * 1000);
setInterval(render, 250);
setInterval(save, 10_000);
