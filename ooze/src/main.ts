// Ooze to Orbit: the game screen. The scene sits in the middle and takes taps
// (and, in the Soup, circling fingers); tabs underneath hold everything else.

import '@fontsource/pixelify-sans/latin-500.css';
import '@fontsource/pixelify-sans/latin-600.css';
import '@fontsource/pixelify-sans/latin-700.css';
import '@fontsource/jersey-10/latin-400.css';
import './ui/ui.css';
import jerseyDigits from '@fontsource/jersey-10/files/jersey-10-latin-400-normal.woff2?url';

import { icon } from './art/sprites';
import { STAGES } from './content/stages';
import { EVENTS } from './content/creature';
import { STORY } from './content/tribal';
import { awaken, sealed } from './economy/tribal';
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
  visitStage,
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
import type { BuyAmount, DialId, GameState, RunInPolicy, StageId } from './economy/types';
import { breed, buyPart, chooseEvent, EVENT_DC, court, equipPart, FARM_PAY, foundNest, islandFor, netRate, SIGHTINGS, placeRestLeft, placeSeen, placeShort, releaseMate, tripEventDue, tripPay, walkHome, walkSeconds, walkTo } from './economy/creature';
import { Scene } from './scene/scene';
import { playStrike, storyLine } from './ui/strike';
import { choiceButton } from './ui/creaturePanels';
import { boostReady, CURRENCY_ICON, finaleNeedsSwirl, finaleReady, heirloomReady, layout, layoutKey, organelleNear, rewardText, TABS, tabsFor, update, type Tab } from './ui/panels';

// Pixelify Sans draws 5 like S, 2 like Z and 8 like B, and its capital B like a G ("Giomass").
// Every digit, and B, comes from Jersey 10 instead (the other letters stay Pixelify), through
// a font that covers only those.
const digitsFont = new FontFace('Ooze Digits', `url(${jerseyDigits})`, { unicodeRange: 'U+0030-0039, U+0042', sizeAdjust: '118%' } as FontFaceDescriptors);
document.fonts.add(digitsFont);
void digitsFont.load().then(() => render());

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
    return { tab: 'grow' as Tab, open: true, full: false, scale: 1, ...JSON.parse(localStorage.getItem(UI_KEY) ?? '{}') };
  } catch {
    return { tab: 'grow' as Tab, open: true, full: false, scale: 1 };
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
const expandBtn = $('expand');

/** Interface size, and the menu pulled up full height (just under the top bar). */
function applyUiPrefs(): void {
  const k = String(ui.scale);
  for (const el of [sheet, overlayTop, modal]) if (el.style.getPropertyValue('zoom') !== k) el.style.setProperty('zoom', k);
  const full = ui.full && ui.open;
  sheet.classList.toggle('full', full);
  document.body.classList.toggle('menu-full', full);
  expandBtn.classList.toggle('on', full);
  // Room from the top bar's foot to the tab bar, less the knob, in the sheet's own (zoomed) pixels.
  const hud = $('hud').getBoundingClientRect().bottom;
  const room = (tabsEl.getBoundingClientRect().top - hud) / ui.scale - 12 - expandBtn.offsetHeight;
  sheet.style.setProperty('--full-h', `${Math.max(215, Math.round(room))}px`);
}
let panelKey = '';
/** Entrance animation for the next panel page: which side it slides in from. */
let panelEnter = '';
let goalKey = '';
let tabsKey = '';
let pokedThisStage = false;
/** Reaction discoveries waiting to be shown, one card at a time. */
const discoveryQueue: string[] = [];

// ---- Economy clock ----

let modalTimer = 0;
/** Shows a card. With `autoSec`, it clears itself after that long, a bar draining as it waits. */
function showModal(html: string, autoSec = 0): void {
  // While the story has the screen, popups wait their turn.
  if (cine()) {
    heldModals.push([html, autoSec]);
    return;
  }
  clearTimeout(modalTimer);
  modal.dataset.kind = '';
  const bar = autoSec ? `<div class="making-bar on auto-close" style="--dur: ${autoSec}s"><i></i></div>` : '';
  modal.innerHTML = `<div class="px-box">${html}${bar}</div>`;
  modal.hidden = false;
  if (autoSec) {
    const shown = modal.firstElementChild;
    modalTimer = window.setTimeout(() => {
      if (modal.firstElementChild === shown) modal.hidden = true;
    }, autoSec * 1000);
  }
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

/** Shows what came back from a roam or out of an egg. */
function showTripReport(): boolean {
  if (!modal.hidden || !state.reports.length) return false;
  const r = state.reports.shift()!;
  const def = STAGES.creature;
  const parts = r.parts.map((id) => def.parts!.find((p) => p.id === id)!.name);
  if (r.kind === 'hatch') {
    scene.discovery();
    showModal(`<p class="label dim">Generation ${r.generation}</p>
      <h3>An egg hatched!</h3>
      <p>The young one is yours and ${r.mate}'s. The whole line grows stronger.</p>
      ${parts.length ? `<p class="fx">Inherited: ${parts.join(', ')}</p>` : ''}
      <button class="px-btn gold" data-act="dismiss">Welcome</button>`, 8);
    return true;
  }
  if (r.sighting) {
    const d = SIGHTINGS[r.sighting];
    showModal(`<p class="label dim">A sighting · seen ${state.stages.creature.sightings[r.sighting] ?? 1}×</p>
      <h3>${d.name}</h3>
      <p>${r.event}</p>
      <p>+${format(D(r.earned))} ${def.currency}</p>
      <button class="px-btn gold" data-act="dismiss">Wonderful</button>`, 8);
    return true;
  }
  if (r.kind === 'event') {
    showModal(`<p class="label dim">On the road</p>
      <h3>${r.parts.length && D(r.earned).lte(0) ? 'A find!' : r.success ? 'It went well' : 'That went badly'}</h3>
      <p>${r.event}</p>
      ${D(r.earned).gt(0) ? `<p>+${format(D(r.earned))} ${def.currency}</p>` : ''}
      ${parts.length ? `<p class="fx">Found: ${parts.join(', ')} (in the Body tab)</p>` : ''}
      ${r.mate ? `<p class="fx">Met ${r.mate}, who follows it now (Family tab)</p>` : ''}
      <button class="px-btn gold" data-act="dismiss">On we go</button>`, 8);
    return true;
  }
  const place = def.places!.find((p) => p.id === r.place)!;
  const page = r.found ? def.reactions!.find((x) => x.id === r.found) : undefined;
  if (!r.success) {
    showModal(`<p class="label dim">The ${place.name}</p>
      <h3>Too much for it, for now</h3>
      <p>It turned back. To get in, it needs: ${(r.short ?? []).map((x) => x[0].toUpperCase() + x.slice(1)).join(', ')}.</p>
      <p class="dim">Train in the Body tab, wear better parts, or breed a stronger generation.</p>
      <button class="px-btn gold" data-act="dismiss">Okay</button>`, 8);
    return true;
  }
  showModal(`<p class="label dim">Settled: the ${place.name}</p>
    <h3>${page ? `New in the ${def.bookName}: ${page.name}` : 'Back again'}</h3>
    <p>+${format(D(r.earned))} ${def.currency}</p>
    ${page ? `<p class="fx">${rewardText('creature', page)}</p>` : ''}
    ${parts.length ? `<p class="fx">Found: ${parts.join(', ')} (in the Body tab)</p>` : ''}
    ${r.mate ? `<p class="fx">Met ${r.mate}, who follows it now (Family tab)</p>` : ''}
    <button class="px-btn gold" data-act="dismiss">Nice</button>`, 12);
  return true;
}

/** Run-ins already shown (each pops up once; after that it's in the Roam tab too). */
const shownRunIns = new WeakSet<object>();

/** A run-in on the road pops up with its choices. Unless choices wait for you, a bar drains
 * for the time left, and instinct plays safe when it runs out. */
function showRunIn(): boolean {
  if (state.current !== 'creature' || !modal.hidden) return false;
  const c = state.stages.creature;
  const ev = c.walk?.event;
  if (!ev || ev.choice !== null || shownRunIns.has(ev)) return false;
  shownRunIns.add(ev);
  const d = EVENTS.find((e) => e.id === ev.id);
  if (!d) return false;
  showModal(
    `<p class="label dim">On the road</p>
    <h3>A run-in!</h3>
    <p>${d.text}</p>
    <div class="choices">${d.options.map((o, i) => choiceButton(state, o, i)).join('')}</div>
    <p class="dim small">With the stat it asks for, it rolls two d20s and keeps the better (advantage); without, one. ${EVENT_DC} or more succeeds.</p>`,
    c.roamOpts.mandatory ? 0 : Math.max(1, ev.left),
  );
  modal.dataset.kind = 'runin';
  return true;
}

/** Shows the next discovered reaction, if nothing else is on screen. */
function showDiscovery(): void {
  if (cine()) return;
  if (showRunIn()) return;
  if (showTripReport()) return;
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
  const key = ids.join() + state.current;
  if (key === tabsKey) return;
  tabsKey = key;
  if (!ids.includes(ui.tab)) ui.tab = 'grow';
  tabsEl.style.gridTemplateColumns = `repeat(${ids.length}, 1fr)`;
  tabsEl.innerHTML = TABS.filter((t) => ids.includes(t.id))
    .map((t) => `<button class="px-btn tab" data-tab="${t.id}">${icon(t.sprite, 3)}<span>${t.id === 'grow' && STAGES[state.current].places ? 'Herd' : t.id === 'grow' && STAGES[state.current].tribal ? 'Survivors' : t.label}</span><i class="dot" hidden></i></button>`)
    .join('');
}

function renderHud(): void {
  const def = STAGES[state.current];
  const st = state.stages[state.current];
  const set = (id: string, text: string) => {
    const el = $(id);
    if (el.textContent !== text) el.textContent = text;
  };
  set('currency', format(st.currency));
  if (def.places) {
    // The herd eats: show what's left after that.
    const net = netRate(state);
    set('rate', `${net.lt(0) ? '−' : '+'}${format(net.abs())} ${def.currency}\nper second`);
  } else set('rate', `${format(stageRate(state, state.current))} ${def.currency}\nper second`);
  set('bank-chip', state.timeBank > 0 ? `⧗ ${formatTime(state.timeBank)}${state.warp > 1 ? ` · ${state.warp}×` : ''}` : '');
  set('stage-name', def.name);
  // Small buttons under the banner hop to the previous age (left) or the next one (right).
  const ageNav = $('age-nav');
  // Sealed eras (before the Tribal) can't be gone back to, so they get no button.
  const open = state.unlocked.filter((id) => !sealed(state, id));
  const i = open.indexOf(state.current);
  const prev = open[i - 1];
  const next = open[i + 1];
  const navKey = `${prev ?? ''}|${next ?? ''}`;
  if (ageNav.dataset.key !== navKey) {
    ageNav.dataset.key = navKey;
    const btn = (s: StageId, side: 'prev' | 'next') =>
      `<button class="px-btn age-btn ${side}" data-stage="${s}" aria-label="Go to the ${STAGES[s].name}">${side === 'prev' ? '<span class="arrow">‹</span>' : ''}${icon(CURRENCY_ICON[s], 2)}${side === 'next' ? '<span class="arrow">›</span>' : ''}</button>`;
    ageNav.innerHTML = `${prev ? btn(prev, 'prev') : '<span></span>'}${next ? btn(next, 'next') : '<span></span>'}`;
  }
  const iconEl = $('currency-icon');
  if (iconEl.dataset.stage !== state.current) {
    iconEl.dataset.stage = state.current;
    iconEl.innerHTML = icon(CURRENCY_ICON[state.current], 4);
  }
}

/** The strip under the top bar: this stage's own goal. It never names what comes next. */
function renderGoal(): void {
  const def = STAGES[state.current];
  // The Tribal era: for now, just what's asked before they wake.
  if (def.tribal) {
    const awake = !!state.stages.tribal.tribe?.awake;
    const key = `tribal:${awake}`;
    if (key !== goalKey) {
      goalKey = key;
      evolveEl.hidden = awake;
      evolveEl.innerHTML = `<div class="evolve-row"><span class="label">The spear</span></div><div class="goal-next">${STORY.approach}</div>`;
    }
    return;
  }
  const rs = reactions(state.current);
  // Once every page of the book is found, the strip has nothing left to say.
  const shown = goalShown(state) && !(rs.length > 0 && rs.every((r) => state.stages[state.current].discovered.includes(r.id)));
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
    const cr = state.stages[state.current];
    if (def.places && tripEventDue(state)) text = 'Your creature ran into something! Choose in the Roam tab.';
    else if (def.places && netRate(state).lt(0) && cr.currency.lt(netRate(state).abs().mul(60))) text = 'The herd is going hungry! Stores run out, and the weakest go first (Herd tab).';
    else if (def.places && n && !n.r.final) {
      // Creature: the next place, in sight or still somewhere in the fog.
      text = placeSeen(state, n.r.id) ? `The ${n.r.name} is in sight. Send your creature there (Roam tab).` : 'Something new is out in the fog. Explore! (Riddles in the Roam tab)';
    } else if (engulfable(state, state.current).length) text = 'A rare microbe is about. Catch it before it gets away!';
    else if (n && !finaleReady(state)) {
      const name = n.r.final ? n.r.name : '???';
      const missing = n.check.parts.filter((p) => !p.ok);
      const grow = missing.find((p) => /^\d/.test(p.label))?.label;
      if (!n.check.gens && !def.habitats && grow) text = `Next ${name}: grow ${grow}`;
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

/** The markup each top-level card was last laid out from, to tell which ones changed. */
let panelChildHtml: string[] = [];
let panelTab = '';

function splitChildren(el: HTMLElement): string[] {
  return [...el.children].map((c) => c.outerHTML);
}

function patchChildren(inner: HTMLElement, html: string): void {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  const fresh = [...tpl.content.children] as HTMLElement[];
  // Compare against what each card was laid out from, not its current (patched) state.
  const freshHtml = fresh.map((c) => c.outerHTML);
  const old = [...inner.children];
  freshHtml.forEach((h, i) => {
    if (old[i] && panelChildHtml[i] === h) return;
    if (old[i]) old[i].replaceWith(fresh[i]);
    else inner.appendChild(fresh[i]);
  });
  for (let i = freshHtml.length; i < old.length; i++) old[i].remove();
  panelChildHtml = freshHtml;
}

function renderPanel(): void {
  sheet.classList.toggle('closed', !ui.open);
  for (const b of tabsEl.querySelectorAll<HTMLButtonElement>('[data-tab]')) {
    b.classList.toggle('on', ui.open && b.dataset.tab === ui.tab);
    const dot = b.querySelector<HTMLElement>('.dot');
    const t = b.dataset.tab;
    const on =
      t === 'boosts' || t === 'mutate'
        ? boostReady(state)
        : t === 'lab'
          ? finaleReady(state)
          : t === 'pond'
            ? organelleNear(state) || finaleReady(state)
            : t === 'roots'
              ? heirloomReady(state)
              : t === 'explore'
                ? tripEventDue(state)
                : t === 'grow' && STAGES[state.current].places
                  ? netRate(state).lt(0) && state.stages.creature.currency.lt(netRate(state).abs().mul(60))
                  : false;
    if (dot) dot.hidden = !on;
  }
  if (!ui.open) return;
  const key = layoutKey(state, ui.tab);
  if (key !== panelKey) {
    panelKey = key;
    const keepText = ($('save-text') as HTMLTextAreaElement | null)?.value ?? '';
    const html = layout(state, ui.tab);
    const inner = panel.firstElementChild as HTMLElement | null;
    if (!panelEnter && inner && panelTab === ui.tab + state.current) {
      // Same page, something changed (usually a purchase): swap only the cards whose
      // markup changed, so nothing under the finger jumps or gets rebuilt.
      patchChildren(inner, html);
    } else {
      panel.innerHTML = `<div class="panel-inner ${panelEnter}">${html}</div>`;
      panel.scrollTop = 0;
      panelChildHtml = splitChildren(panel.firstElementChild as HTMLElement);
    }
    panelTab = ui.tab + state.current;
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
  } else if (state.current === 'creature') {
    if (!pokedThisStage) text = 'Tap to walk · pinch to zoom';
  } else if (state.current === 'tribal') {
    if (!state.stages.tribal.tribe?.awake) text = 'Tap the spear';
    else if (!pokedThisStage) text = 'Drag to look around · pinch to zoom';
  } else if (!pokedThisStage) text = 'Tap to steer your cell';
  else if (!dietOf(state, state.current)) text = 'Pick a diet in Mutate so your cell can eat';
  hint.hidden = !text || !modal.hidden;
  if (hint.textContent !== text) hint.textContent = text;
}

function render(): void {
  // Mid-press, leave the page alone (see the button handling below).
  if (pressed?.isConnected && performance.now() - pressT < 4000) return;
  applyUiPrefs();
  renderTabs();
  renderHud();
  renderGoal();
  scene.setTopInset(overlayTop.getBoundingClientRect().bottom - stageEl.getBoundingClientRect().top);
  // The sheet's height when open (the same clamp as the stylesheet), open or not, so the floor never moves.
  scene.setBottomInset(Math.min(250, Math.max(215, window.innerHeight * 0.27)));
  // Where the open (or closed) sheet starts: the map centres its known land above it.
  // (The panel sits above the tab bar, so it's the panel's top when open, the bar's when closed.)
  scene.setVisibleBottom((ui.open ? panel : sheet).getBoundingClientRect().top - stageEl.getBoundingClientRect().top);
  renderPanel();
  for (const b of document.querySelectorAll<HTMLElement>('[data-uiscale]')) b.classList.toggle('on', Number(b.dataset.uiscale) === ui.scale);
  renderHint();
  showDiscovery();
}

// ---- A stage's ending ----

function playEnding(): void {
  const def = STAGES[state.current];
  const st = state.stages[state.current];
  const book = def.bookName ?? 'Discoveries';
  const stats = [
    ['Time', formatTime(st.time || state.playTime)],
    ...(def.places
      ? [
          ['Generations', String(st.generation)],
          ['The herd', String(Math.floor(st.pop))],
        ]
      : [def.habitats ? ['Food eaten', String(st.eaten)] : ['Stirs', String(state.taps)]]),
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
  // Into the Tribal era there's no evolving: the spear falls.
  if (STAGES[state.current].next === 'tribal') {
    striking = true;
    syncCine();
    scene.frameStrike(state);
    playStrike(
      () => moveOn(),
      () => {
        striking = false;
        syncCine();
      },
      () => scene.strikePoint(state),
    );
    return;
  }
  moveOn();
}

function moveOn(): void {
  if (evolve(state)) {
    scene.evolveFlash();
    pokedThisStage = false;
    ui.tab = 'grow';
    panelKey = '';
    save();
    render();
  }
}

/** Whether the screen shows a map (the Creature's island or what's left of it). */
const onMap = () => state.current === 'creature' || state.current === 'tribal';

// ---- The story's hold on the screen ----
// From the strike to the waking, everything but the world and the story's words steps away
// (the `cinematic` class), and popups wait until it's over.
let striking = false;
let waking = false;
const heldModals: [string, number][] = [];
/** Before they wake: the walk to the spear, then the wait to touch it. */
const beforeWaking = () => state.current === 'tribal' && !state.stages.tribal.tribe?.awake;
function cine(): boolean {
  return striking || waking || beforeWaking();
}
function syncCine(): void {
  const on = cine();
  document.body.classList.toggle('cinematic', on);
  scene.holdWalk = striking;
  if (!striking && !waking && beforeWaking()) storyLine(scene.spearReady ? STORY.touch : STORY.approach);
  if (!on && heldModals.length && modal.hidden) {
    const [html, sec] = heldModals.shift()!;
    showModal(html, sec);
  }
}

/** Applies what happened in the pond: food eaten, organelles engulfed, predators driven off. */
function pondEvents(): void {
  for (const e of scene.pondEvents()) {
    if (e.type === 'eat') scene.float(e.x, e.y - 8, `+${format(forage(state, e.food))}`, '#7fe0b0');
    else if (e.type === 'engulf') {
      const got = engulf(state, state.current, e.id);
      const r = reactions(state.current).find((x) => x.id === e.id);
      if (got === 'found') scene.float(e.x, e.y - 10, 'engulfed!', '#f5c45e');
      else if (got === 'caught') scene.float(e.x, e.y - 10, `caught ${state.stages[state.current].captured[e.id]} of ${r?.captures ?? 1}`, '#f5c45e');
    } else if (e.type === 'rare') scene.float(e.x, e.y - 10, 'a rare microbe!', '#f5c45e');
    else if (e.type === 'hit') scene.float(e.x, e.y - 10, ['thwack', 'ow!', 'scram!'][Math.floor(Math.random() * 3)], '#f2ead7');
    else if (e.type === 'court') {
      const name = court(state);
      scene.float(e.x, e.y, name ? `${name} joins you!` : 'not interested…', name ? '#e68ab8' : '#f2ead7');
    } else if (e.type === 'fend') scene.float(e.x, e.y - 10, `driven off! +${format(fendOff(state))}`, '#f5c45e');
    else if (e.type === 'forage') {
      const got = e.party ? state.stages.creature.lastParty : state.stages.creature.lastForage;
      if (got) scene.float(e.x, e.y, `${e.party ? 'party home ' : ''}+${format(D(got))}`, '#f5c45e');
    } else if (e.type === 'place') showPlaceCard(e.id, e.x, e.y);
    else if (e.type === 'spear' && awaken(state)) {
      // The waking: it touches the spear, and they know that they are. A flash, the
      // shockwave rolling out across the world, then the words; then the Extinction begins.
      waking = true;
      storyLine('');
      panelKey = '';
      save();
      window.setTimeout(() => storyLine(STORY.wake), 1600);
      window.setTimeout(() => storyLine(STORY.wakeSub), 6000);
      window.setTimeout(() => storyLine(''), 10500);
      window.setTimeout(() => {
        waking = false;
        syncCine();
        render();
      }, 11500);
    }
  }
  collectNews();
}

/** A little card over a tapped flag: what the place is, how it stands, and a button to go. */
const placeCard = document.createElement('div');
placeCard.id = 'placecard';
placeCard.className = 'px-box';
placeCard.hidden = true;
stageEl.appendChild(placeCard);
let placeCardTimer = 0;

function showPlaceCard(id: string, x: number, y: number): void {
  const def = STAGES.creature;
  const p = def.places!.find((q) => q.id === id);
  if (!p) return;
  const s = state.stages.creature;
  const q = islandFor(state).places[id];
  const found = (s.trips[id] ?? 0) > 0;
  const rest = placeRestLeft(state, id);
  const short = placeShort(state, p);
  const status = !found
    ? short.length
      ? `Too much for it yet: ${short.map(([k, n]) => `${k} ${n}`).join(', ')}`
      : `Finding it: about ${format(tripPay(state, p))} ${def.currency}`
    : `Settled: gives ${format(tripPay(state, p).mul(FARM_PAY))} ${def.currency} every time it grows back (next in ${formatTime(rest)})`;
  const parts = p.parts.filter((pid) => s.parts.includes(pid)).length;
  placeCard.innerHTML = `<div class="name">${found ? p.name : 'Something out here'}</div>
    <div class="sub">${formatTime(walkSeconds(state, q.x, q.y))} away · parts ${parts}/${p.parts.length}</div>
    <div class="sub">${status}</div>
    <button class="px-btn small gold" data-goto="${id}">Go here</button>`;
  placeCard.hidden = false;
  const w = placeCard.offsetWidth;
  const h = placeCard.offsetHeight;
  placeCard.style.left = `${Math.max(8, Math.min(stageEl.clientWidth - w - 8, x - w / 2))}px`;
  placeCard.style.top = `${Math.max(8, y - h - 6)}px`;
  clearTimeout(placeCardTimer);
  placeCardTimer = window.setTimeout(() => (placeCard.hidden = true), 8000);
}

// ---- Input ----

/** Finger tracking for the whirlpool: turns are summed around the path's recent centre. */
let swirlPath: { x: number; y: number }[] = [];
let swirlAngle: number | null = null;
let swirlSpin = 0;

/** Fingers on the Creature's map: one taps (or drags, when zoomed in), two pinch to zoom. */
const fingers = new Map<number, { x: number; y: number; sx: number; sy: number }>();
let mapDragged = false;

stageEl.addEventListener('pointerdown', (e) => {
  if (!modal.hidden || (e.target as HTMLElement).closest('#evolve, button, #placecard')) return;
  placeCard.hidden = true;
  stageEl.setPointerCapture(e.pointerId);
  const r = stageEl.getBoundingClientRect();
  const x = e.clientX - r.left;
  const y = e.clientY - r.top;
  if (onMap()) {
    // The tap itself happens on release, so a drag or a pinch doesn't send the creature off.
    fingers.set(e.pointerId, { x, y, sx: x, sy: y });
    if (fingers.size === 1) mapDragged = false;
    else mapDragged = true;
    return;
  }
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
  if (onMap()) {
    const f = fingers.get(e.pointerId);
    if (!f) return;
    const r = stageEl.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    if (fingers.size >= 2) {
      // Pinch: zoom by the change in spread, about the middle, and pan with the middle.
      const [a, b] = [...fingers.values()];
      const before = Math.hypot(a.x - b.x, a.y - b.y);
      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;
      f.x = x;
      f.y = y;
      const after = Math.hypot(a.x - b.x, a.y - b.y);
      if (before > 10) scene.zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, after / before);
      scene.panBy((a.x + b.x) / 2 - midX, (a.y + b.y) / 2 - midY);
      return;
    }
    if (Math.hypot(x - f.sx, y - f.sy) > 8) mapDragged = true;
    if (mapDragged && scene.zoomed) scene.panBy(x - f.x, y - f.y);
    f.x = x;
    f.y = y;
    return;
  }
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

const endFinger = (e: PointerEvent) => {
  const f = fingers.get(e.pointerId);
  if (!f) return;
  fingers.delete(e.pointerId);
  if (e.type === 'pointerup' && !mapDragged && fingers.size === 0 && onMap()) {
    scene.ripple(f.x, f.y);
    scene.shoreTap(state, f.x, f.y);
    pokedThisStage = true;
    render();
  }
};
stageEl.addEventListener('pointerup', endFinger);
stageEl.addEventListener('pointercancel', endFinger);
stageEl.addEventListener(
  'wheel',
  (e) => {
    if (state.current !== 'creature') return;
    e.preventDefault();
    const r = stageEl.getBoundingClientRect();
    scene.zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1.15 : 1 / 1.15);
  },
  { passive: false },
);

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
  else if (el.dataset.policy) state.stages.creature.roamOpts.policy = el.dataset.policy as RunInPolicy;
  else if (el.dataset.roamopt) {
    const c = state.stages.creature;
    const k = el.dataset.roamopt;
    if (k === 'explore') c.autoRoam = !c.autoRoam;
    else if (k === 'places' || k === 'settle' || k === 'mandatory') c.roamOpts[k] = !c.roamOpts[k];
  } else if (el.dataset.uiscale) {
    ui.scale = Number(el.dataset.uiscale);
    saveUi();
  }
  else if (el.dataset.habitat) moveHabitat(state, id, el.dataset.habitat);
  else if (el.dataset.equip) equipPart(state, el.dataset.equip);
  else if (el.dataset.buypart) {
    if (buyPart(state, el.dataset.buypart)) scene.purchase(state, el.dataset.buypart);
  } else if (el.dataset.goto) {
    const p = islandFor(state).places[el.dataset.goto];
    if (p && walkTo(state, p.x, p.y)) scene.purchase(state, 'trip');
    placeCard.hidden = true;
  } else if (el.dataset.nest) {
    if (foundNest(state, el.dataset.nest)) scene.purchase(state, 'nest');
  } else if (el.dataset.breed) breed(state, Number(el.dataset.breed));
  else if (el.dataset.release) releaseMate(state, Number(el.dataset.release));
  else if (el.dataset.choice) {
    if (chooseEvent(state, Number(el.dataset.choice))) panelKey = '';
    if (modal.dataset.kind === 'runin') modal.hidden = true;
  }
  else if (el.dataset.stage) {
    if (visitStage(state, el.dataset.stage as StageId)) {
      scene.evolveFlash();
      ui.tab = 'grow';
      panelKey = '';
      goalKey = '';
    }
  }
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
      case 'expand':
        ui.full = !ui.full;
        saveUi();
        break;
      case 'update':
        void checkForUpdate(true);
        break;
      case 'walkhome':
        walkHome(state);
        break;
      case 'autoroam':
        state.stages.creature.autoRoam = !state.stages.creature.autoRoam;
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

// Buttons act when the finger lifts off the one it went down on, however long it was held.
// While a finger is down, the panel isn't redrawn, so the button under it can't be swapped
// out mid-press (which used to eat the tap). The click that follows is then ignored.
let pressed: HTMLButtonElement | null = null;
let pressAt = { x: 0, y: 0 };
let pressT = 0;
let actedAt = 0;
document.addEventListener('pointerdown', (e) => {
  pressed = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
  pressAt = { x: e.clientX, y: e.clientY };
  pressT = performance.now();
});
document.addEventListener('pointerup', (e) => {
  const el = pressed;
  pressed = null;
  if (!el || el.disabled || !el.isConnected) return;
  const under = document.elementFromPoint(e.clientX, e.clientY)?.closest('button');
  if (under !== el || Math.hypot(e.clientX - pressAt.x, e.clientY - pressAt.y) > 24) return;
  actedAt = performance.now();
  act(el);
});
document.addEventListener('pointercancel', () => (pressed = null));
document.addEventListener('click', (e) => {
  const el = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
  // Already done on release (a click from the keyboard comes without one).
  if (performance.now() - actedAt < 800) return;
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
/** This build's name (from its script file). */
const BUILD = document.querySelector<HTMLScriptElement>('script[src*="/assets/index-"]')?.src.match(/index-([^/]+)\.js/)?.[1] ?? 'dev';

async function checkForUpdate(manual = false): Promise<void> {
  try {
    const mine = document.querySelector<HTMLScriptElement>('script[src*="/assets/index-"]')?.src.match(/index-[^/]+\.js/)?.[0];
    // Ask for the page by a fresh address too, so no cache along the way can answer.
    const html = await (await fetch(`./?check=${Date.now()}`, { cache: 'no-store' })).text();
    const live = html.match(/index-[^"/]+\.js/)?.[0];
    if (manual && live === mine) alert(`You're on the latest build (${BUILD}).`);
    if (mine && live && live !== mine) {
      // A plain reload can come back from the browser's cache (iOS Safari does), so ask
      // for the page by a fresh address; once per build, so a stale server can't loop us.
      try {
        if (!manual && sessionStorage.getItem('oozeTried') === live) return;
        sessionStorage.setItem('oozeTried', live);
      } catch {
        /* private mode: try anyway */
      }
      save();
      location.replace(`${location.pathname}?v=${live.slice(6, -3)}&t=${Date.now()}`);
    }
  } catch {
    /* offline: keep playing this build */
  }
}

/**
 * For testing: opening the game with ?start=creature offers a fresh game at the start of the
 * Creature (the Soup and Cell played through), replacing the current save if you say so.
 */
async function startFromLink(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const where = params.get('start');
  if (where !== 'creature' && where !== 'tribal') return;
  history.replaceState(null, '', location.pathname);
  const what = where === 'tribal' ? 'at the end of the Creature stage (to see the strike and the Extinction)' : 'at the beginning of the Creature stage';
  if (!confirm(`Start a fresh game ${what}? This replaces your current save (export it from the Menu first if you want to keep it).`)) return;
  try {
    const code = (await (await fetch('./creature-start.txt', { cache: 'no-store' })).text()).trim();
    state = importSave(code);
    state.lastSeen = Date.now();
    if (where === 'tribal') {
      // The Creature played through: every place settled, six generations, a big herd.
      const c = state.stages.creature;
      for (const r of STAGES.creature.reactions!) if (!c.discovered.includes(r.id)) c.discovered.push(r.id);
      for (const p of STAGES.creature.places!) c.trips[p.id] = Math.max(1, c.trips[p.id] ?? 0);
      c.generation = 6;
      c.generators.territory = 8;
      c.pop = 400;
      if (c.seen) c.seen.fill(1);
    }
    scene.reload();
    save();
    render();
    if (where === 'tribal') playEnding();
  } catch {
    alert('That start could not be loaded.');
  }
}
void startFromLink();

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') save();
  else {
    catchUp();
    render();
    if (!import.meta.env.DEV) void checkForUpdate();
  }
});
window.addEventListener('pagehide', save);
// Also look for a newer build on opening, and now and then while playing.
if (!import.meta.env.DEV) {
  void checkForUpdate();
  setInterval(() => void checkForUpdate(), 5 * 60_000);
}
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
  syncCine();
}

// A save made mid-ending (closed during the credits) picks up at the reveal. This also
// carries on a Cell finished before the Creature existed: its ending now leads somewhere.
if (canEvolve(state)) playEnding();
catchUp();
render();
document.fonts?.ready.then(() => render());
requestAnimationFrame(frame);
setInterval(step, TICK_SEC * 1000);
setInterval(render, 250);
setInterval(save, 10_000);
