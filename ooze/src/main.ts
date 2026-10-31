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
import { awaken, sealed, startTribe } from './economy/tribal';
import { autoAssign, daysLeft, daysLeftSteps, decideFallen, DAY_SEC, eatsPlants, extinctionTick, hungerWord, jobInfo, landedSeed, launch, learnIdea, startExtinction, TRAITS, tryAgain, waitingOnChoice, WINTER } from './economy/extinction';
import { prepareShoreIsland } from './economy/terrainStore';
import { setSteward, type StewardPlan } from './economy/shore';
import { dance, danceLeft, answerJoin, build, shoreIsland, terrainReady, gift, isAdult, poisOf, setTax, type JoinAnswer, setLean, shoreOf, shoreSeason, startShore, takeRaft, walkChief, type Lean } from './economy/shore';
import { danceCard, battleCard, fightCard, fightNote, findCard, forkCard, joinCard, poiCard, setBuildCat, setVillageView, stanceCard, villageCard } from './ui/shorePanels';
import { lineTree, shoreTree } from './ui/familyTree';
import { choose, setFocus, type ForkId, type Lane } from './economy/culture';
import { canStepIn, rally, sendBand, setStance, setWarRule, stepIn, type Stance, type WarRule } from './economy/war';
import type { BuildId } from './content/shore';
import { moodWord, QUIRKS } from './economy/society';
import { cast, say, SPELL, spellsFor, toggleOrdain, type SpellId } from './economy/miracles';
import { CRISES, crisisAnswered, crisisAt, crisisMissed, startCrisis } from './economy/crises';
import { answerWhisper, tribeDecides, WHISPERS } from './economy/whispers';
import { readGesture } from './ui/gesture';
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
  habitatUnlocked,
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
import { LOOK_BACK_SEC } from './scene/tribe';
import { playStrike, storyLine } from './ui/strike';
import { playWaking } from './ui/waking';
import { playCrossing } from './ui/crossing';
import { cue, glug, hushDrone, popSound, setVolume, soundFrame, soundHidden, tapSound, unlockSound, type Channel } from './audio/sound';
import { creatureLookOf, miniIcon } from './scene/creatureLook';
import { describe } from './economy/genes';
import { glyph, panWeb, pickIdea, webTransform, webView, zoomWeb } from './ui/tribePanels';
import { record } from './economy/chronicle';
import { PARTS } from './content/creature';
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
    return { tab: 'grow' as Tab, open: true, full: false, scale: 1, watching: false, tilt: null as number | null, ...JSON.parse(localStorage.getItem(UI_KEY) ?? '{}') };
  } catch {
    return { tab: 'grow' as Tab, open: true, full: false, scale: 1, watching: false, tilt: null as number | null };
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
scene.setTilt(ui.tilt);
const expandBtn = $('expand');

/** A wide screen (a laptop or desktop): the menu is a sidebar beside the world, always open.
 * Wide enough for both side by side counts, whatever the shape (a desktop window split in half
 * stands taller than it's wide, but has room to spare). */
const wideQuery = window.matchMedia('(min-width: 960px), (min-width: 900px) and (min-aspect-ratio: 5/4)');
const isWide = () => wideQuery.matches;
wideQuery.addEventListener('change', () => {
  panelKey = '';
  render();
});

/** Interface size, and the menu pulled up full height (just under the top bar). */
function applyUiPrefs(): void {
  // (Side by side, the menu is always open, and never pulled up: it's already full height.)
  document.body.classList.toggle('wide', isWide());
  document.body.classList.toggle('tab-ideas', ui.open && ui.tab === 'ideas');
  if (isWide()) {
    ui.open = true;
    ui.full = false;
  }
  // On a big monitor the interface steps up a size (on top of the player's own choice).
  const k = String(Math.round(ui.scale * (isWide() && window.innerWidth >= 1600 ? (window.innerWidth >= 2200 ? 1.35 : 1.15) : 1) * 100) / 100);
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
  modal.dataset.village = '';
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
      ${r.looks ? `<p class="fx">${r.looks}</p>` : ''}
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
  showModal(`<p class="label dim">Found: the ${place.name}</p>
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
  if (STAGES[state.current].habitats) cue('shine');
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
  chronicleStep();
  if (!state.news.length) return;
  for (const id of state.news) {
    const r = reactions(state.current).find((x) => x.id === id);
    if (r) record(state, `${STAGES[state.current].habitats ? 'Took in' : 'Discovered'} ${r.name}.`);
  }
  discoveryQueue.push(...state.news);
  state.news = [];
  save();
}

/** Whether New Shore's island is still being made or loaded (nothing of it runs meanwhile). */
let waitingIsland = false;
function needIsland(): void {
  const s = state.stages.shore.shore;
  if (!s || s.terrain === undefined || terrainReady(s.seed)) return;
  waitingIsland = true;
  const done = () => {
    waitingIsland = false;
    catchUp();
    scene.reload();
    render();
  };
  prepareShoreIsland(s.seed).then(done, () => {
    // (No worker: made here instead.)
    shoreIsland(s.seed);
    done();
  });
}

function catchUp(): void {
  const r = applyOffline(state);
  // (Not in the Extinction: its clock doesn't run while away.)
  if (r.awaySec >= 60 && !state.stages.tribal.tribe?.ex) showReport(r);
  collectNews();
}

function step(): void {
  // (While New Shore's island is still being made, its time waits: none of it is lost.)
  if (waitingIsland) return;
  const now = Date.now();
  const gap = (now - state.lastSeen) / 1000;
  if (gap > LIVE_GAP_SEC) catchUp();
  else {
    liveTick(state, gap);
    state.lastSeen = now;
    extinctionStep(gap);
  }
  collectNews();
}

// ---- The Extinction's days ----
// Its clock runs only while it's being played: never offline, never under a cutscene, and not
// while a choice waits.

let alone = false;
let guessSig = '';
let tickerText = '';
/** Whether the menu was pulled full height for the web of ideas (and so goes back after). */
let ideasFull = false;
let guess: number | null = null;
/** The countdown being worked out, a day a frame (null when it's done), and whether there's
 * been a first guess yet (that one's worked out at once, so the strip never starts blank). */
let guessJob: Generator<void, number | null> | null = null;
let guessed = false;
const extinctEl = document.createElement('div');
extinctEl.id = 'extinct';
extinctEl.hidden = true;
document.body.appendChild(extinctEl);

function extinctionStep(sec: number): void {
  if (state.current !== 'tribal' || cine()) return;
  const t = state.stages.tribal.tribe;
  if (t?.awake && (!t.ex || !t.ex.powers)) {
    startExtinction(state);
    hushDrone(false);
    panelKey = '';
    tabsKey = '';
    save();
  }
  const ex = t?.ex;
  if (!ex) return;
  if (ex.escaped) {
    showEscape();
    return;
  }
  if (ex.over) {
    showAlone();
    return;
  }
  if (waitingOnChoice(ex)) {
    // The day waits for the spear's answer, but not for ever: left too long, they decide
    // for themselves (the dead are left to the ash: eating them is the spear's to say).
    choiceIdle += sec;
    if (choiceIdle >= CHOICE_SEC) {
      choiceIdle = 0;
      if (ex.whisper) tribeDecides(ex);
      else {
        decideFallen(state, false);
        say(ex, 'The spear was silent. They left the dead to the ash.');
      }
      if (modal.dataset.kind === 'whisper' || modal.dataset.kind === 'fallen') modal.hidden = true;
      panelKey = '';
      save();
      return;
    }
    if (ex.whisper) askWhisper();
    else askFallen();
    const left = modal.querySelector<HTMLElement>('[data-t="choice-left"]');
    const lead = ex.people.find((p) => p.id === ex.leader)?.name;
    if (left) left.textContent = `If the spear stays silent, ${lead ?? 'they'} will decide in ${Math.ceil(CHOICE_SEC - choiceIdle)}s`;
    return;
  }
  choiceIdle = 0;
  if (extinctionTick(state, sec)) {
    save();
    if (ex.escaped) showEscape(true);
    else if (ex.over) showAlone();
    else {
      nightReport();
      // What the spear worked unasked in the night, shown where it landed.
      for (const id of ex.worked ?? []) scene.tribeScene.wonder(id, scene.tribeScene.wonderPlace(id));
      ex.worked = [];
    }
  }
  showDiscovered();
  // A crisis: it starts when its time comes (the map says where), and is lost when time's up.
  if (ex.crisisPlan && !ex.crisis && ex.clock >= ex.crisisPlan.at) {
    const c = startCrisis(ex, scene.tribeScene.crisisPlace(ex.crisisPlan.kind, ex));
    if (c) save();
  }
  if (ex.crisis && (ex.crisis.day !== ex.day || ex.clock >= ex.crisis.until)) {
    crisisMissed(ex);
    panelKey = '';
    save();
  }
}

// ---- The spear's will: miracles drawn on the world ----

let casting: SpellId | null = null;
let castPts: { x: number; y: number }[] = [];
const castBar = document.createElement('div');
castBar.id = 'castbar';
castBar.className = 'px-box';
castBar.hidden = true;
stageEl.appendChild(castBar);
const crisisBar = document.createElement('div');
crisisBar.id = 'crisisbar';
crisisBar.className = 'px-box';
crisisBar.hidden = true;
stageEl.appendChild(crisisBar);
const spellBar = document.createElement('div');
spellBar.id = 'spellbar';
spellBar.hidden = true;
stageEl.appendChild(spellBar);

/** Picks a miracle to cast: the menu steps aside and the next stroke on the map is it. */
function startCast(id: SpellId): void {
  const ex = state.stages.tribal.tribe?.ex;
  const sp = SPELL[id];
  if (!ex || (ex.prayer ?? 0) < sp.cost) return;
  casting = id;
  ui.open = false;
  castBar.innerHTML = `${glyph(sp.gesture, 3)}<div><b>${sp.name}</b><span>${sp.how}</span></div><button class="px-btn" data-act="cast-cancel">×</button>`;
  castBar.hidden = false;
  render();
}

function endCast(): void {
  casting = null;
  castPts = [];
  castBar.hidden = true;
  scene.castStroke(null);
}

/** The stroke's done: read it, check it's where it should be, and if so, it happens. */
function finishCast(): void {
  const id = casting;
  const ex = state.stages.tribal.tribe?.ex;
  const pts = castPts;
  castPts = [];
  scene.castStroke(null);
  if (!id || !ex || pts.length < 2) return;
  const sp = SPELL[id];
  const end = pts[pts.length - 1];
  const fizzle = (why: string) => scene.float(end.x, end.y - 10, why, '#c8a0ff');
  const shape = readGesture(pts);
  const names = { zigzag: 'a zigzag', spiral: 'a spiral', circle: 'a circle', line: 'a line' };
  if (shape !== sp.gesture) return fizzle(shape ? `That was ${names[shape]}: ${sp.name} needs ${names[sp.gesture]}` : `Draw ${names[sp.gesture]}`);
  const tribe = scene.tribeScene;
  const W = pts.map((p) => scene.worldAt(p.x, p.y));
  const first = W[0];
  const last = W[W.length - 1];
  let at = [last];
  let people: number[] | undefined;
  let struck: number | undefined;
  if (id === 'lightning') {
    // Where it comes down: the lowest point of the zigzag.
    const low = pts.reduce((a, p) => (p.y > a.y ? p : a));
    const ground = scene.worldAt(low.x, low.y);
    // On one of them, it strikes them dead (the nearest, if it comes down among several).
    const under = tribe.inside(ground, 1.6);
    if (under.length) {
      struck = under.reduce((a, i) => (tribe.distTo(i, ground) < tribe.distTo(a, ground) ? i : a));
      at = [tribe.personAt(struck)];
    } else {
      const tree = tribe.nearSpot(ex, 'wood', ground, 6);
      if (!tree) return fizzle('Bring it down onto a charred tree');
      at = [tree];
    }
  } else if (id === 'rain') {
    const c = { x: W.reduce((a, p) => a + p.x, 0) / W.length, y: W.reduce((a, p) => a + p.y, 0) / W.length };
    if (!tribe.landAt(c)) return fizzle('Over the ash, not the sea');
    at = [c];
  } else if (id === 'ward') {
    const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length;
    const cy = pts.reduce((a, p) => a + p.y, 0) / pts.length;
    const rCss = pts.reduce((a, p) => a + Math.hypot(p.x - cx, p.y - cy), 0) / pts.length;
    const c = scene.worldAt(cx, cy);
    const r = Math.max(2, scene.tilesFor(rCss));
    people = tribe.inside(c, r);
    if (!people.length) return fizzle('Draw it round some of them');
    at = [c, { x: r, y: 0 }];
  } else if (id === 'quicken') {
    if (!tribe.landAt(first) || !tribe.landAt(last)) return fizzle('Across the ash, not the sea');
    if (Math.hypot(last.x - first.x, last.y - first.y) < 3) return fizzle('A longer line');
    at = [first, last];
  } else if (id === 'kelp' || id === 'shoals') {
    if (tribe.landAt(first) || !tribe.landAt(last) || !tribe.byWater(last, 4)) return fizzle('From the sea, up onto the shore');
    at = [first, last];
  } else if (id === 'dying') {
    if (!tribe.landAt(last) || Math.hypot(last.x - first.x, last.y - first.y) < 8) return fizzle('A long line, in toward them');
    at = [first, last];
  }
  // Answering a crisis: the right miracle, with any part of the stroke near enough to it (or
  // round the one trapped).
  const c = ex.crisis;
  const now = crisisAt(ex);
  const near = (p: { x: number; y: number }) => !!now && Math.hypot(p.x - now.x, p.y - now.y) < (c?.kind === 'storm' ? 12 : 9);
  const answers = !!c && c.spell === id && (c.kind === 'trapped' ? !!people?.some((i) => ex.people[i]?.id === c.who) : c.kind === 'cold' ? true : at.some(near) || W.some(near));
  const r = cast(ex, id, { people, struck, power: answers && c!.kind !== 'trapped' && c!.kind !== 'cold' ? 2 : 1 });
  if (!r.ok) return fizzle(r.text);
  if (struck !== undefined) tribe.remove(struck);
  cue('spell', 0.8);
  tribe.wonder(id, at);
  scene.float(end.x, end.y - 12, answers ? `${crisisAnswered(ex)} · ${r.text}` : r.text, '#e8b0ff');
  endCast();
  panelKey = '';
  goalKey = '';
  save();
}

/** A crisis on: what it is, what answers it, and how long's left (tap to answer it). */
function renderCrisis(): void {
  const ex = state.current === 'tribal' ? state.stages.tribal.tribe?.ex : undefined;
  const c = ex?.crisis;
  const show = !!c && !cine() && !casting;
  crisisBar.hidden = !show;
  // (With the menu up, it sits at the top instead, over the bar, so it's never missed.)
  // (On a phone with the menu up, it sits just under the top bars; otherwise at the map's foot.)
  const top = ui.open && !isWide();
  crisisBar.classList.toggle('top', top);
  if (top) crisisBar.style.setProperty('--below-bars', `${Math.round(overlayTop.getBoundingClientRect().bottom - stageEl.getBoundingClientRect().top + 8)}px`);
  if (!show || !c || !ex) return;
  const who = c.who !== undefined ? ex.people.find((p) => p.id === c.who)?.name : '';
  const left = Math.max(0, Math.ceil(c.until - ex.clock));
  const sp = SPELL[c.spell];
  const poor = (ex.prayer ?? 0) < sp.cost;
  // Built once for each crisis (a button rebuilt under the finger never takes the tap); only
  // the countdown changes after.
  const key = `${c.kind}:${c.day}:${c.until}:${poor}`;
  if (crisisBar.dataset.key !== key) {
    crisisBar.dataset.key = key;
    crisisBar.innerHTML = `<span class="warn-mark">!</span><div><b>${who ? `${who} ${CRISES[c.kind].call}` : CRISES[c.kind].call}</b><span>${CRISES[c.kind].how}. <i data-left></i></span></div>
      <button class="px-btn gold answer" data-cast="${c.spell}"${poor ? ' disabled' : ''}>${glyph(sp.gesture, 2)}<span>${poor ? `${sp.cost} prayer` : sp.name}</span></button>`;
  }
  const t = crisisBar.querySelector<HTMLElement>('[data-left]');
  if (t && t.textContent !== `${left}s left`) t.textContent = `${left}s left`;
}

/** The quick bar of miracles on the map (when the menu's down): tap one, then draw it. */
function renderSpellbar(): void {
  const ex = state.current === 'tribal' ? state.stages.tribal.tribe?.ex : undefined;
  // (On the map when the menu's down; in the Miracles tab when it's up.)
  const show = !!ex && !cine() && !ex.over && !ex.escaped && !casting && !ui.open;
  spellBar.hidden = !show;
  if (!show || !ex) return;
  const prayer = Math.floor(ex.prayer ?? 0);
  const key = JSON.stringify([prayer, ex.powers, ex.diet]);
  if (spellBar.dataset.key === key) return;
  spellBar.dataset.key = key;
  const known = spellsFor(ex.diet).filter((sp) => (ex.powers ?? []).includes(sp.id));
  spellBar.innerHTML = `<span class="prayer num">${prayer}<i>prayer</i></span>${known.map((sp) => `<button class="px-btn spell-btn${prayer >= sp.cost ? '' : ' poor'}" data-cast="${sp.id}"${prayer >= sp.cost ? '' : ' disabled'} aria-label="${sp.name}">${glyph(sp.gesture, 2)}<span>${sp.cost}</span></button>`).join('')}`;
}

/** When the hint to save them first showed (the spear's first word waits on it). */
let saveHintSince = 0;

/** A miracle found: the spear stirs, and shows how it's done. */
function showDiscovered(): void {
  const ex = state.stages.tribal.tribe?.ex;
  if (!ex?.newPowers?.length || !modal.hidden || cine()) return;
  // (The spear's first word waits till they've been set to work and the hint to save them has
  // been up a few seconds: else it covers the very line it follows.)
  if (ex.newPowers[0] === 'lightning' && ex.day === 0 && (saveHintSince === 0 || performance.now() - saveHintSince < 6000)) return;
  const id = ex.newPowers.shift()!;
  const sp = SPELL[id];
  showModal(`<p class="label dim">${id === 'lightning' ? 'The spear\'s will' : 'The spear stirs'}</p>
    <h3>${sp.name}</h3>
    <div class="glyph-big">${glyph(sp.gesture, 6)}</div>
    <p>${sp.does}</p>
    <p class="fx">${sp.how}</p>
    ${id === 'lightning' ? '<p class="small dim">They live or die by their own choices now. You are the voice in the spear: teach them ideas, and work miracles, drawn on the world, paid for in their prayer. Every miracle frightens them a little more.</p>' : ''}
    <button class="px-btn gold" data-act="dismiss">${id === 'lightning' ? 'Watch over them' : 'Let it be'}</button>`);
  save();
}

// ---- The Chronicle: what to write down, from every era ----

/** The last counts seen (so a change is noticed once), and whether they've been read yet. */
let seenCounts: Record<string, number> | null = null;

function chronicleStep(): void {
  // The Extinction keeps its own log: copy across whatever's new in it.
  const t = state.stages.tribal.tribe;
  const ex = t?.ex;
  if (ex?.log) {
    const n = ex.logN ?? ex.log.length;
    let mark = state.chronicleMark ?? 0;
    if (mark > n) {
      // A new try (the log started over).
      mark = 0;
      record(state, 'Back on the ash, just woken, to try again. The spear remembered.', 'tribal');
    }
    const fresh = Math.min(n - mark, ex.log.length);
    if (fresh > 0) for (const l of ex.log.slice(-fresh)) record(state, l.text, 'tribal', `Day ${l.day}${t!.attempts ? ` · try ${t!.attempts + 1}` : ''}`);
    state.chronicleMark = n;
  }
  // The Creature's milestones: a new generation, a mate, a place found, a nest, a new part.
  if (!state.unlocked.includes('creature') || sealed(state, 'creature')) return;
  const c = state.stages.creature;
  const now: Record<string, number> = {
    gen: c.generation,
    mates: c.mates.length,
    found: Object.values(c.trips).filter((v) => v > 0).length,
    nests: c.nests.length,
    parts: c.parts.length,
  };
  if (!seenCounts) {
    // (The first look just notes how things stand: only what changes after is news.)
    seenCounts = now;
    seenFound = new Set(Object.keys(c.trips).filter((k) => (c.trips[k] ?? 0) > 0));
    return;
  }
  if (now.gen > seenCounts.gen) record(state, `A new generation hatched: the ${ordinal(now.gen)}.`, 'creature');
  if (now.mates > seenCounts.mates) record(state, `A mate joined the herd (${now.mates} now).`, 'creature');
  if (now.found > seenCounts.found) {
    const p = STAGES.creature.places?.find((q) => (c.trips[q.id] ?? 0) > 0 && !(seenFound ??= new Set()).has(q.id));
    record(state, p ? `Found ${p.name}.` : 'Found a new place.', 'creature');
  }
  if (now.nests > seenCounts.nests) record(state, `Some of the herd set off to found a new nest.`, 'creature');
  if (now.parts > seenCounts.parts) {
    const id = c.parts[c.parts.length - 1];
    record(state, `Grew something new: ${PARTS.find((q) => q.id === id)?.name ?? id}.`, 'creature');
  }
  for (const q of STAGES.creature.places ?? []) if ((c.trips[q.id] ?? 0) > 0) (seenFound ??= new Set()).add(q.id);
  seenCounts = now;
}
let seenFound: Set<string> | null = null;
const ordinal = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;

/** One of them, tapped: who they are, who they have, how they're doing, and what's
 * happened to them. */
function showPersonCard(i: number, x: number, y: number): void {
  const ex = state.stages.tribal.tribe?.ex;
  const p = ex?.people[i];
  if (!ex || !p) return;
  const name = (id: number) => ex.people.find((q) => q.id === id)?.name;
  const kin = (p.bonds ?? [])
    .map((b) => [b, name(b.id)] as const)
    .filter(([, n]) => n)
    .map(([b, n]) => `${b.kind === 'parent' ? 'parent of' : b.kind === 'child' ? 'child of' : `${b.kind} of`} ${n}`);
  const state2 = [hungerWord(ex, p), moodWord(ex, p)].filter((v, k, a) => a.indexOf(v) === k).join(', ');
  const mem = [...(p.memories ?? [])].reverse();
  placeCard.className = 'px-box person';
  placeCard.innerHTML = `<h4>${p.name}${p.id === ex.leader ? ' <span class="dim">· the one they follow</span>' : ''}</h4>
    <div class="who">${TRAITS[p.trait].name}${p.quirk ? ` · ${QUIRKS[p.quirk]}` : ''} · ${jobInfo(ex.diet, p.job).name} · ${state2}</div>
    <div class="sub">${kin.length ? kin.slice(0, 4).join(', ') : 'No one left of their own.'}</div>
    ${mem.length ? `<ul>${mem.map((m) => `<li>${m}</li>`).join('')}</ul>` : '<p class="sub dim">Nothing yet has happened to them that the others would remember.</p>'}`;
  placeCard.hidden = false;
  placeCard.style.left = `${Math.max(8, Math.min(stageEl.clientWidth - 248, x - 120))}px`;
  placeCard.style.top = `${Math.max(8, y - placeCard.offsetHeight - 16)}px`;
  scene.tribeScene.chosen = i;
  window.clearTimeout(placeCardTimer);
  placeCardTimer = window.setTimeout(() => {
    placeCard.hidden = true;
    scene.tribeScene.chosen = -1;
  }, 9000);
}

/** The morning after: who starved, and how much there was. */
function nightReport(): void {
  const r = state.stages.tribal.tribe?.ex?.last;
  if (!r) return;
  const names = r.starved.map((p) => p.name);
  const who = names.length === 0 ? 'No one starved in the night.' : names.length === 1 ? `${names[0]} starved in the night.` : names.length <= 4 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]} starved in the night.` : `${names.length} starved in the night: ${names.slice(0, 3).join(', ')} and ${names.length - 3} more.`;
  const one = r.starved.length === 1 ? r.starved[0] : null;
  const more: string[] = [];
  if (r.killed) more.push(`<p class="grim">${r.killed.name} was killed in the night. ${r.killed.by} was seen at the body.</p>`);
  if (r.shook?.length) more.push(`<p class="grim">${r.shook.join(', ')} died of the shaking.</p>`);
  if (r.caught?.length) more.push(`<p class="shake">${r.caught.join(', ')} began to shake.</p>`);
  if (r.fire === false && state.stages.tribal.tribe?.ex?.ideas.includes('fire')) more.push('<p class="dim">The fire went out: no wood to keep it.</p>');
  if (r.season === 'coming') more.push('<p class="winter">To the west the sky has gone brown, and it is spreading. The old ones say it is ash: the strike\'s, coming back down.</p>');
  if (r.season === 'winter') more.push(`<p class="winter">The sky has gone dark with ash. The ash winter: gathering will be poor, and nights cold without a fire, until day ${WINTER[1] + 1}.</p>`);
  if (r.season === 'green') more.push('<p class="green">Something green pushed up through the ash this morning.</p>');
  showModal(
    `<p class="label dim">Night ${r.day}</p>
    <h3 class="${names.length || r.killed ? 'grim' : ''}">${who}</h3>
    ${one ? `<p class="dim">${TRAITS[one.trait].name}: ${TRAITS[one.trait].does}.</p>` : ''}
    <p>They ate ${Math.floor(r.ate)} of the ${Math.ceil(r.wanted)} meals they needed.${r.spoiled >= 1 ? ` ${Math.floor(r.spoiled)} food spoiled.` : ''}</p>
    ${more.join('')}`,
    more.length ? 9 : 6,
  );
  modal.dataset.kind = 'night';
}

/** A question the tribe brings to the spear: the leader asks, the player whispers the answer
 * (time waits for it). */
/** Seconds a choice waits for the spear before they decide for themselves, and how long this
 * one has waited. */
const CHOICE_SEC = 45;
let choiceIdle = 0;

function askWhisper(): void {
  const ex = state.stages.tribal.tribe?.ex;
  const w = ex?.whisper;
  if (!ex || !w || !modal.hidden) return;
  const def = WHISPERS[w.id];
  const lead = ex.people.find((p) => p.id === ex.leader)?.name;
  showModal(`<p class="label dim">Day ${ex.day + 1} · ${lead ? `${lead} comes to the spear` : 'They come to the spear'}</p>
    <h3>${def.ask(ex, w)}</h3>
    <p class="dim">What does the spear whisper?</p>
    <div class="choices">${def.options.map((o, i) => `<button class="px-btn${i === 0 ? '' : ''}" data-whisper="${i}">${o}</button>`).join('')}</div>
    <p class="small dim" data-t="choice-left"></p>`);
  modal.dataset.kind = 'whisper';
}

/** The first dead: what's to be done with them. Eating them changes the tribe for good. */
function askFallen(): void {
  const ex = state.stages.tribal.tribe?.ex;
  if (!ex || !modal.hidden) return;
  const loses = eatsPlants(ex.diet) ? ' They will never eat plants again.' : '';
  showModal(`<p class="label dim">Day ${ex.day + 1} · The dead</p>
    <h3>${ex.corpses === 1 ? 'One of them' : `${ex.corpses} of them`} didn't wake this morning.</h3>
    <p>The others sit by the bodies. There is so little to eat.</p>
    <div class="choices"><button class="px-btn" data-act="fallen-leave">Leave them to the ash</button>
    <button class="px-btn grim" data-act="fallen-eat">Eat them</button></div>
    <p class="small dim">Eating the dead makes your kind cannibals, for good: from now on, and in every age to come.${loses}</p>
    <p class="small dim" data-t="choice-left"></p>`);
  modal.dataset.kind = 'fallen';
}

/** They set off: the four on the raft, the ash behind them. */
function showEscape(fresh = false): void {
  if (alone) return;
  const t = state.stages.tribal.tribe!;
  const ex = t.ex!;
  alone = true;
  modal.hidden = true;
  syncCine();
  // The island they'll land on is made in the background while they cross.
  if (t.landed) void prepareShoreIsland(t.landed.seed).catch(() => undefined);
  const screen = () => {
    storyLine('');
    extinctEl.innerHTML = `<div class="ending-inner">
      <p class="label dim">Extinction</p>
      <p>They survived the Extinction</p>
      <h1>${ex.day} days</h1>
      <dl>${(t.family ?? []).map((p) => `<dt>${p.name}</dt><dd>${TRAITS[p.trait as keyof typeof TRAITS]?.name ?? ''}</dd>`).join('')}
      <dt>Lost</dt><dd>${ex.deaths}</dd><dt>Born on the ash</dt><dd>${ex.births ?? 0}</dd>
      <dt>Left on the ash</dt><dd>${t.ashIsland?.left ?? ex.people.length - (t.family?.length ?? 0)}</dd><dt>Days adrift</dt><dd>40</dd><dt>Tries</dt><dd>${(t.attempts ?? 0) + 1}</dd></dl>
      ${t.cannibal ? '<p class="dim">They are cannibals now, and always will be.</p>' : ''}
      <p class="dim">Those left on the ash didn't last. The island did to them what it had begun to.</p>
      <p>Ashore on a new island. Someone was already there.</p>
      <button class="px-btn gold" data-act="look-landed">Go ashore</button>
    </div>`;
    extinctEl.hidden = false;
    requestAnimationFrame(() => extinctEl.classList.add('in'));
  };
  // (Off the spear's island now: its rumble is over.)
  hushDrone(true);
  if (!fresh) return screen();
  // The four walk down and board; the raft goes out with the others shouting after it; forty
  // days adrift; then the new island, and smoke on a hill.
  const ids = ex.family ?? [];
  const four = (t.family ?? []).map((p) => p.name);
  const crowd = ex.people.filter((p) => !ids.includes(p.id)).map((p) => p.name);
  const pick = (k: number) => crowd[k % Math.max(1, crowd.length)] ?? 'Someone';
  scene.tribeScene.holdOld = true;
  scene.tribeScene.depart(ids);
  const lines: [number, string][] = [
    [0, ex.sendRule
      ? `It had been settled: ${ex.sendRule === 'family' ? 'a family would go' : ex.sendRule === 'young' ? 'the youngest would go' : 'the strongest would go'}.`
      : 'They argued through the night over who should go. By morning, four were chosen.'],
    [4000, `${four.slice(0, -1).join(', ')} and ${four[four.length - 1] ?? ''} walked down to the raft.`],
    [8500, STORY.launch],
    [13000, `“Don't forget us!” ${pick(0)} shouted from the shore.`],
    [15500, `“Tell them who we were!” called ${pick(1)}.`],
    [18000, `“We will,” ${four[0] ?? 'they'} called back, and then they were too far to hear.`],
  ];
  for (const [at, line] of lines) window.setTimeout(() => storyLine(line), at);
  // The rest goes by what's on screen: once the raft's out of sight the camera turns back to
  // the spear (and its line); when that's done, down into black, the island's rumble ends, and
  // up out of it into the crossing; the crossing ends in black, and up out of it they land.
  let saidBack = false;
  const watch = window.setInterval(() => {
    const back = scene.tribeScene.lookingBack();
    if (back >= 0 && !saidBack) {
      saidBack = true;
      storyLine(STORY.lookBack);
    }
    if (back < LOOK_BACK_SEC) return;
    window.clearInterval(watch);
    fadeTo(1, 1500);
    window.setTimeout(() => {
      storyLine('');
      hushDrone(true);
      playCrossing(t.look as never, () => {
        fadeTo(1, 0);
        scene.tribeScene.holdOld = false;
        scene.tribeScene.arrive();
        window.setTimeout(() => fadeTo(0, 1800), 100);
        // Ashore one by one; then they look inland, the fog drawing back, the smoke rising.
        window.setTimeout(() => storyLine(STORY.landing), 10000);
        window.setTimeout(screen, 19000);
      });
      // (The crossing opens out of black itself.)
      window.setTimeout(() => fadeTo(0, 0), 60);
    }, 1600);
  }, 200);
}

/** No one left: the last of them looks round, alone. Then how long they lasted, and again. */
function showAlone(): void {
  if (alone) return;
  alone = true;
  const t = state.stages.tribal.tribe!;
  const ex = t.ex!;
  modal.hidden = true;
  syncCine();
  storyLine(STORY.alone);
  window.setTimeout(() => {
    storyLine('');
    const best = Math.max(t.best ?? 0, ex.day);
    extinctEl.innerHTML = `<div class="ending-inner">
      <p class="label dim">Extinction</p>
      <p>Time survived in the Extinction</p>
      <h1>${ex.day} day${ex.day === 1 ? '' : 's'}</h1>
      <dl><dt>Best</dt><dd>${best} day${best === 1 ? '' : 's'}</dd><dt>Tries</dt><dd>${(t.attempts ?? 0) + 1}</dd><dt>Ideas learned</dt><dd>${ex.ideas.length}</dd></dl>
      <p class="dim">The spear remembers what it taught them.</p>
      <button class="px-btn gold" data-act="retry">Try again</button>
    </div>`;
    extinctEl.hidden = false;
    requestAnimationFrame(() => extinctEl.classList.add('in'));
  }, 7000);
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
    .map((t) => `<button class="px-btn tab" data-tab="${t.id}">${icon(t.sprite, 3)}<span>${t.id === 'grow' && STAGES[state.current].places ? 'Herd' : t.id === 'grow' && STAGES[state.current].tribal ? 'Survivors' : t.id === 'grow' && STAGES[state.current].shore ? 'Village' : t.label}</span><i class="dot" hidden></i></button>`)
    .join('');
}

function renderHud(): void {
  const def = STAGES[state.current];
  const st = state.stages[state.current];
  const set = (id: string, text: string) => {
    const el = $(id);
    if (el.textContent !== text) el.textContent = text;
  };
  const ex = def.tribal ? st.tribe?.ex : undefined;
  const sh = def.shore ? st.shore : undefined;
  if (sh) {
    // New Shore counts people too (no limit: the culture begins when the village is big enough).
    // (One of them is the number's icon: it reads as people.) On the right, what's in store.
    set('currency', String(sh.people.length));
    set('rate', `${Math.floor(sh.food)} food\n${Math.floor(sh.wood)} wood`);
  } else if (ex) {
    // The Extinction counts people, not currency.
    set('currency', String(ex.people.length));
    set('rate', `alive\n${ex.deaths} dead`);
  } else set('currency', format(st.currency));
  if (ex || sh) {
    /* set above */
  } else if (def.places) {
    // The herd eats: show what's left after that.
    const net = netRate(state);
    set('rate', `${net.lt(0) ? '−' : '+'}${format(net.abs())} ${def.currency}\nper second`);
  } else set('rate', `${format(stageRate(state, state.current))} ${def.currency}\nper second`);
  if (!sh) $('hud-news').hidden = true;
  if (sh) set('bank-chip', ['Spring', 'Summer', 'Autumn', 'Winter'][shoreSeason(sh).si]);
  else set('bank-chip', state.timeBank > 0 && !ex ? `⧗ ${formatTime(state.timeBank)}${state.warp > 1 ? ` · ${state.warp}×` : ''}` : '');
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
    const look = sh ? sh.look : ex ? st.tribe!.look : null;
  const iconKey = state.current + (look ? JSON.stringify(look) : '');
  if (iconEl.dataset.stage !== iconKey) {
    iconEl.dataset.stage = iconKey;
    // The Extinction counts people: its number wears one of them (their own look).
    iconEl.innerHTML = look ? miniIcon(look, 4) : icon(CURRENCY_ICON[state.current], 4);
  }
}

/** New Shore's strip: just the village's news going by. (No clock:
 * this is just life now.) */
const shoreNews: string[] = [];
/** Villages already known to have joined (so only new ones get a card; not those in the save). */
const joinedSeen = new Set<number>();
const askedSeen = new Set<string>();
let joinedReady = false;
function renderShoreGoal(): void {
  const s = shoreOf(state);
  if (!s) return;
  // (All in the one banner at the top: who leads, how many, and the news under it.)
  if (goalKey !== 'shore') {
    goalKey = 'shore';
    tickerText = '';
    evolveEl.hidden = true;
  }
  const box = $('hud-news');
  const news = shoreNews.slice(-3).join('   ·   ');
  box.hidden = !news;
  if (news !== tickerText) {
    tickerText = news;
    const t = box.firstElementChild as HTMLElement;
    t.textContent = news;
    t.style.setProperty('--dur', `${Math.max(10, news.length * 0.16)}s`);
    t.style.animation = 'none';
    void t.offsetWidth;
    t.style.animation = '';
  }
}

/** New Shore's news since the last frame: births and deaths go by on the strip; a village
 * found gets its own card. */
function shoreFrame(): void {
  const s = shoreOf(state);
  if (!s || state.current !== 'shore') return;
  if (s.news.length) {
    shoreNews.push(...s.news.splice(0));
    if (shoreNews.length > 12) shoreNews.splice(0, shoreNews.length - 12);
  }
  if (s.newFinds.length && modal.hidden && !cine()) {
    const v = s.villages.find((x) => x.id === s.newFinds[0]);
    s.newFinds.shift();
    if (v) {
      cue('chime', 0.5);
      showModal(`<p class="label dim">Found</p>${villageCard(s, v).replace(/^<p class="label dim">[^<]*<\/p>/, '')}`);
      modal.dataset.village = String(v.id);
    }
  }
  // A village won over with no room for them: the question, once.
  for (const v of s.villages) {
    if (v.asking === undefined || askedSeen.has(`${v.id}:${v.asking}`) || !modal.hidden || cine()) continue;
    askedSeen.add(`${v.id}:${v.asking}`);
    cue('chime', 0.5);
    showModal(joinCard(s, v));
  }
  // What exploring turned up: a card each.
  if (s.finds?.length && modal.hidden && !cine()) {
    const f = s.finds.shift()!;
    const p = poisOf(s).find((x) => x.id === f.poi);
    if (p) {
      cue(f.find.relic && !f.dup ? 'shine' : 'chime', 0.5);
      showModal(findCard(p, f.find, !!f.dup));
    }
  }
  // A village won over: they come to live by your hearth.
  for (const v of s.villages) {
    if (!v.joined || joinedSeen.has(v.id) || !modal.hidden || cine()) continue;
    joinedSeen.add(v.id);
    if (!joinedReady) continue;
    cue('ascend', 0.5);
    showModal(`<p class="label dim">Joined</p><div class="village-head"><span class="kind">${miniIcon(v.look, 3)}</span><h3>${v.name[0].toUpperCase() + v.name.slice(1)}</h3></div>
      <p>They've been won over. ${Math.round(v.pop)} of them are coming to live by your hearth: another kind among you, from now on.</p>
      <button class="px-btn gold" data-act="dismiss">Welcome them</button>`);
  }
  joinedReady = true;
  // The turn: a hundred, at the great fire. Phase 2 begins.
  if (s.turned && modal.hidden && !cine()) {
    s.turned = false;
    cue('ascend', 0.6);
    showModal(`<p class="label dim">${s.people.length} of them</p><h3>The great fire</h3>
      <p>[STORY] They were a hundred. One night they all gathered at one fire, every one of them, and looked at each other, and knew themselves one kind of critter, together.</p>
      <p class="dim">From now on the village grows a culture of its own: ideas come by themselves, from what the critters do. See the Culture tab.</p>
      <button class="px-btn gold" data-act="dismiss">The long road</button>`);
    save();
  }
  // A fork waiting on the chief: the cards, once.
  const asked = s.culture?.asking;
  if (asked && !forkAsked.has(`${asked.fork}:${asked.since}`) && modal.hidden && !cine()) {
    forkAsked.add(`${asked.fork}:${asked.since}`);
    cue('chime', 0.5);
    showModal(forkCard(s, asked.fork));
  }
  // Raiders seen coming: how to meet them, asked once.
  const r = s.raid;
  if (r?.seen !== undefined && r.stance === undefined && !stanceAsked.has(`${r.from}:${r.seen}`) && modal.hidden && !cine()) {
    stanceAsked.add(`${r.from}:${r.seen}`);
    cue('impact', 0.4);
    showModal(stanceCard(s));
  }
  // A fight going on: shown live, a round at a time.
  const f = s.fight;
  if (f) {
    const live = modal.querySelector<HTMLElement>(`.battle.live[data-fight="${f.id}"]`);
    // (Shown once: closed, it's left to play out; the result still comes.)
    if (!live && modal.hidden && !cine() && liveFight !== f.id) {
      cue('impact', 0.5);
      showModal(fightCard(s, f));
      liveFight = f.id;
      liveRounds = 0;
    }
    if (live || !modal.hidden) showFight(s);
  }
  // A battle fought: the one watched live ends where it stands; one fought while away is played
  // out, round by round.
  if (s.battles?.length && !cine()) {
    const b = s.battles[0];
    const watching = b.id !== undefined && b.id === liveFight && !!modal.querySelector(`.battle.live[data-fight="${b.id}"]`);
    if (watching || modal.hidden) {
      s.battles.shift();
      const html = battleCard(s, b);
      if (html) {
        if (!watching) cue('impact', 0.5);
        showModal(html);
        playBattle(watching);
      }
      liveFight = undefined;
    }
  }
}

/** The family tree on show, and the way back through it. */
type TreeAt = { id?: number; line?: boolean };
let treeAt: TreeAt | null = null;
let treeTrail: TreeAt[] = [];
function showTree(at: TreeAt): void {
  const s = shoreOf(state);
  const back = treeTrail.length > 0;
  const html = at.line ? lineTree(state, back) : s && at.id !== undefined ? shoreTree(state, s, at.id, back) : '';
  if (!html) return;
  showModal(html);
  modal.dataset.kind = 'tree';
  treeAt = at;
  // A wide family: scrolled so the one whose tree it is starts in the middle.
  const wrap = modal.querySelector<HTMLElement>('.chart-wrap');
  const me = wrap?.querySelector<HTMLElement>('.chart-node.me');
  if (wrap && me) wrap.scrollLeft = Math.max(0, me.offsetLeft + me.offsetWidth / 2 - wrap.clientWidth / 2);
}

/** The dance: a marker swinging across the bar, a gold zone to step in; faster and narrower
 * the longer the streak. */
const dancing = { streak: 0, zone: 0.5, width: 0.3, speed: 2.2, t0: 0, raf: 0 };
function danceAt(): number {
  return (Math.sin((performance.now() - dancing.t0) / 1000 * dancing.speed) + 1) / 2;
}
function newZone(): void {
  dancing.width = Math.max(0.1, 0.3 - dancing.streak * 0.035);
  dancing.speed = 2.2 + Math.min(8, dancing.streak) * 0.25;
  dancing.zone = dancing.width / 2 + Math.random() * (1 - dancing.width);
  const z = modal.querySelector<HTMLElement>('.dance-zone');
  if (z) {
    z.style.left = `${(dancing.zone - dancing.width / 2) * 100}%`;
    z.style.width = `${dancing.width * 100}%`;
  }
}
function startDance(): void {
  dancing.streak = 0;
  dancing.t0 = performance.now();
  newZone();
  danceInfo();
  cancelAnimationFrame(dancing.raf);
  const loop = () => {
    const mark = modal.querySelector<HTMLElement>('.dance-mark');
    if (!mark || modal.hidden) return;
    mark.style.left = `${danceAt() * 100}%`;
    dancing.raf = requestAnimationFrame(loop);
  };
  loop();
}
function danceInfo(): void {
  const s = shoreOf(state);
  const box = modal.querySelector<HTMLElement>('.dance');
  const v = s?.villages.find((x) => x.id === Number(box?.dataset.dancev));
  if (!s || !v || !box) return;
  const left = danceLeft(s, v);
  box.querySelector('.dance-streak')!.textContent = dancing.streak ? `Streak ${dancing.streak}` : 'Streak 0';
  box.querySelector('.dance-left')!.textContent = left > 0 ? `${Math.ceil(left)} trust left in them today` : 'They\'re worn out for today.';
  const bar = box.querySelector<HTMLElement>('.trust .making-bar i');
  if (bar) bar.style.width = `${Math.floor(v.trust ?? 0)}%`;
  const btn = modal.querySelector<HTMLButtonElement>('.dance-step');
  if (btn) btn.disabled = left <= 0 || !!v.joined || v.asking !== undefined;
}
function stepDance(id: number, el: HTMLElement): void {
  const s = shoreOf(state);
  if (!s) return;
  const hit = Math.abs(danceAt() - dancing.zone) <= dancing.width / 2;
  const r = el.getBoundingClientRect();
  if (hit) {
    const got = dance(state, id, dancing.streak);
    if (got > 0) {
      dancing.streak++;
      popSound(0.8 + Math.min(10, dancing.streak) * 0.08);
      scene.float(r.left + r.width / 2, r.top, `+${got.toFixed(1)} trust`, '#8acf6a');
      modal.querySelector('.dance')?.classList.remove('good');
      void (modal.querySelector('.dance') as HTMLElement | null)?.offsetWidth;
      modal.querySelector('.dance')?.classList.add('good');
      newZone();
    }
  } else {
    dancing.streak = 0;
    popSound(0.5);
    scene.float(r.left + r.width / 2, r.top, 'missed the step', '#f2ead7');
    newZone();
  }
  danceInfo();
  save();
}

const stanceAsked = new Set<string>();
const forkAsked = new Set<string>();
let liveFight: number | undefined;
let liveRounds = 0;

/** The live fight on screen: bars, counts, the fallen, the chief's note and button. */
function showFight(s: NonNullable<ReturnType<typeof shoreOf>>): void {
  const f = s.fight;
  const el = f && modal.querySelector<HTMLElement>(`.battle.live[data-fight="${f.id}"]`);
  if (!f || !el) return;
  const now = [f.x, f.y];
  const start = [f.ours, f.theirs];
  el.querySelectorAll<HTMLElement>('.side').forEach((side, k) => {
    side.querySelector<HTMLElement>('.making-bar i')!.style.width = `${Math.round((now[k] / Math.max(1, start[k])) * 100)}%`;
    side.querySelector<HTMLElement>('.num')!.textContent = String(Math.round(now[k]));
    const icons = side.querySelectorAll<HTMLElement>('.line img');
    const stand = Math.ceil((now[k] / Math.max(1, start[k])) * icons.length);
    icons.forEach((ic, j) => ic.classList.toggle('down', j >= stand));
  });
  if (f.rounds.length !== liveRounds) {
    liveRounds = f.rounds.length;
    if (liveRounds) {
      const prev = f.rounds[liveRounds - 2] ?? [f.ours, f.theirs];
      animateRound(el, prev, f.rounds[liveRounds - 1]);
      popSound(0.7 + Math.random() * 0.3);
    }
  }
  const note = modal.querySelector<HTMLElement>('.fight-note');
  const say = fightNote(s, f);
  if (note && note.textContent !== say) note.textContent = say;
  const btn = modal.querySelector<HTMLButtonElement>('[data-stepin]');
  if (btn) btn.hidden = !canStepIn(s);
}

/** A round of blows, shown: the lines lunge at each other and clash; those who took losses
 * flash, and the losses rise off them. */
function animateRound(el: HTMLElement, prev: [number, number], next: [number, number]): void {
  el.classList.remove('lunge');
  void el.offsetWidth;
  el.classList.add('lunge');
  window.setTimeout(() => {
    if (!el.isConnected) return;
    const vs = el.querySelector<HTMLElement>('.vs');
    if (vs) {
      const c = document.createElement('i');
      c.className = 'clash';
      c.textContent = '✶';
      vs.appendChild(c);
      window.setTimeout(() => c.remove(), 500);
    }
    el.querySelectorAll<HTMLElement>('.side').forEach((side, k) => {
      const lost = Math.round(prev[k] - next[k]);
      if (lost <= 0) return;
      side.classList.remove('hit');
      void side.offsetWidth;
      side.classList.add('hit');
      const d = document.createElement('i');
      d.className = 'dmg';
      d.textContent = `−${lost}`;
      d.style.left = `${30 + Math.random() * 40}%`;
      side.appendChild(d);
      window.setTimeout(() => d.remove(), 1000);
    });
  }, 180);
}

/** The battle's over: the winners hop for joy; the beaten turn and run. */
function endBattle(el: HTMLElement): void {
  const usWon = el.dataset.won === 'us';
  el.classList.add('over');
  el.querySelector('.side.us')?.classList.add(usWon ? 'win' : 'flee');
  el.querySelector('.side.them')?.classList.add(usWon ? 'flee' : 'win');
}

/** The battle on show: the two lines thin round by round, then the result. */
function playBattle(done = false): void {
  const el = modal.querySelector<HTMLElement>('.battle');
  if (!el) return;
  const all: [number, number][] = JSON.parse(el.dataset.rounds ?? '[]');
  // (Watched live: only the last round left to show.)
  const rounds = done ? all.slice(-1) : all;
  const start = [Number(el.dataset.ours), Number(el.dataset.theirs)];
  const sides = [el.querySelector<HTMLElement>('.side.us')!, el.querySelector<HTMLElement>('.side.them')!];
  let i = 0;
  const step = () => {
    if (!el.isConnected) return;
    if (i >= rounds.length) {
      const res = modal.querySelector<HTMLElement>('.battle-result');
      if (res) res.hidden = false;
      endBattle(el);
      return;
    }
    const prevR = (done ? all[all.length - 2] : rounds[i - 1]) ?? (start as [number, number]);
    const r = rounds[i++];
    if (!done) animateRound(el, prevR, r);
    sides.forEach((side, k) => {
      const left = r[k];
      side.querySelector<HTMLElement>('.making-bar i')!.style.width = `${Math.round((left / Math.max(1, start[k])) * 100)}%`;
      side.querySelector<HTMLElement>('.num')!.textContent = String(left);
      const icons = side.querySelectorAll<HTMLElement>('.line img');
      const stand = Math.ceil((left / Math.max(1, start[k])) * icons.length);
      icons.forEach((ic, j) => ic.classList.toggle('down', j >= stand));
    });
    if (!done) popSound(0.7 + Math.random() * 0.3);
    setTimeout(step, done ? 300 : 850);
  };
  setTimeout(step, done ? 0 : 600);
}

/** The strip under the top bar: this stage's own goal. It never names what comes next. */
function renderGoal(): void {
  const def = STAGES[state.current];
  if (def.shore) return renderShoreGoal();
  // The Tribal era: for now, just what's asked before they wake.
  if (def.tribal) {
    const ex = state.stages.tribal.tribe?.ex;
    if (ex) {
      // The countdown: how long they've got, if things go on as they are. (The guess re-runs
      // whenever the plan changes, and every 15 s; worked out a day a frame, in frame(), so it
      // never stutters. The last guess stands till the new one's in.)
      const sig = JSON.stringify([ex.day, Math.floor(ex.clock / 15), ex.people.length, ex.people.map((p) => p.job), ex.ideas, ex.ration, ex.lead, ex.fallen]);
      if (sig !== guessSig) {
        guessSig = sig;
        if (guessed) guessJob = daysLeftSteps(ex);
        else {
          guess = daysLeft(ex);
          guessed = true;
        }
      }
      const d = guess;
      const night = Math.max(0, Math.ceil(DAY_SEC - ex.clock));
      // Built once; after that only its words change (so the ticker keeps scrolling).
      if (goalKey !== 'ex') {
        goalKey = 'ex';
        tickerText = '';
        evolveEl.hidden = false;
        evolveEl.innerHTML = `<div class="evolve-row"><span class="label" data-g="day"></span><span class="label dim" data-g="night"></span></div>
          <div class="ex-row"><div class="ex-count" data-g="count"></div><div class="ticker"><span data-g="tick"></span></div></div>`;
      }
      const g = (k: string) => evolveEl.querySelector<HTMLElement>(`[data-g="${k}"]`)!;
      const put = (k: string, text: string) => {
        if (g(k).textContent !== text) g(k).textContent = text;
      };
      put('day', `Day ${ex.day + 1}`);
      put('night', `Night in ${night}s`);
      put('count', d === null ? 'Holding on' : `Extinction in ${d} day${d === 1 ? '' : 's'}`);
      g('count').className = `ex-count ${d === null ? 'safe' : d <= 2 ? 'dire' : d <= 5 ? 'warn' : ''}`;
      // The news: the latest few things that happened, going by.
      const news = (ex.log ?? []).slice(-3).map((l) => l.text).join('   ·   ');
      if (news !== tickerText) {
        tickerText = news;
        const t = g('tick');
        t.textContent = news;
        t.style.setProperty('--dur', `${Math.max(10, news.length * 0.16)}s`);
        t.style.animation = 'none';
        void t.offsetWidth;
        t.style.animation = '';
      }
      return;
    }
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
  // The Creature's end, stayed to watch: the strip waits with the way on (the strike).
  if (def.next === 'tribal' && canEvolve(state) && ending.hidden && !striking) {
    if (goalKey !== 'waiting') {
      goalKey = 'waiting';
      evolveEl.hidden = false;
      evolveEl.innerHTML = `<div class="evolve-row"><span class="label">Something is coming</span></div>
        <button class="px-btn gold pulse" data-act="look">Look up</button>`;
    }
    return;
  }
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
    else if (state.stages.tribal.tribe?.ex && state.stages.tribal.tribe.ex.day === 0 && state.stages.tribal.tribe.ex.people.every((p) => p.job === 'rest')) text = 'Set them to work, or they starve';
    else if (state.stages.tribal.tribe?.ex && !Object.keys(state.stages.tribal.tribe.ex.casts ?? {}).length && !casting) {
      text = 'They live or die on their own. Work miracles to save them';
      if (!saveHintSince && modal.hidden) saveHintSince = performance.now();
    }
  } else if (state.current === 'shore') {
    const s = shoreOf(state);
    if (s && !s.raftTaken && !s.built.length && !s.building) text = 'Break up the raft for wood (in the Build tab)';
    else if (s && !s.built.length && !s.building) text = 'Build the hearth (in the Build tab)';
    else if (!pokedThisStage) text = 'Tap the land to walk · pinch to zoom';
  } else if (!pokedThisStage) text = 'Tap to steer your cell';
  else if (!dietOf(state, state.current)) text = 'Pick a diet in Mutate so your cell can eat';
  hint.hidden = !text || !modal.hidden || (ui.open && ui.full);
  if (hint.textContent !== text) hint.textContent = text;
}

function render(): void {
  // (A save loaded or imported into New Shore: its island may need making first.)
  if (state.current === 'shore' && !waitingIsland) needIsland();
  // Mid-press, leave the page alone (see the button handling below).
  if (pressed?.isConnected && performance.now() - pressT < 4000) return;
  applyUiPrefs();
  renderTabs();
  renderHud();
  renderGoal();
  scene.setTopInset(overlayTop.getBoundingClientRect().bottom - stageEl.getBoundingClientRect().top);
  // The sheet's height when open (the same clamp as the stylesheet), open or not, so the floor never moves.
  scene.setBottomInset(isWide() ? 0 : Math.min(250, Math.max(215, window.innerHeight * 0.27)));
  // Where the open (or closed) sheet starts: the map centres its known land above it.
  // (The panel sits above the tab bar, so it's the panel's top when open, the bar's when closed.)
  scene.setVisibleBottom(isWide() ? stageEl.clientHeight : (ui.open ? panel : sheet).getBoundingClientRect().top - stageEl.getBoundingClientRect().top);
  renderPanel();
  for (const b of document.querySelectorAll<HTMLElement>('[data-uiscale]')) b.classList.toggle('on', Number(b.dataset.uiscale) === ui.scale);
  for (const b of document.querySelectorAll<HTMLElement>('[data-tilt]')) b.classList.toggle('on', ui.tilt === null ? b.dataset.tilt === '0' : Math.abs(Number(b.dataset.tilt) - ui.tilt) < 0.02);
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
  // (Before the strike, there's no hurry: they can stay and watch the island a while, and
  // look up when they're ready.)
  const after = def.next
    ? `<p class="stir">…but something is still moving.</p>
      <button class="px-btn gold pulse" data-act="look">${def.next === 'tribal' ? 'Look up' : 'Look closer'}</button>${def.next === 'tribal' ? '<button class="px-btn" data-act="keep">Keep watching</button>' : ''}`
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

/** Before the strike: the line as it stands, and the warning that this is for good. */
function lastLookCard(): string {
  const c = state.stages.creature;
  const look = creatureLookOf(state);
  return `<p class="label dim">Before you look up</p>
    <div class="tree-me">${miniIcon(look, 5)}<div><h3>Your line</h3><p class="tiny">Generation ${c.generation} · ${describe(c.genes)}</p><p class="tiny dim">A herd of ${Math.floor(c.pop)}</p></div></div>
    <p><b>There's no going back.</b> Once you look up, there's no more breeding, no more mates, no more parts.</p>
    <p class="dim">Your line goes forward exactly as it is now: these looks, these parts, these generations.</p>
    <p class="dim tiny">If you'd still like another generation, a new mate's markings, or a different look, stay a while longer.</p>
    <div class="choices"><button class="px-btn gold" data-act="look-sure">I'm happy with my line: go on</button><button class="px-btn" data-act="dismiss">Not yet</button></div>`;
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
  const was = state.current;
  if (evolve(state)) {
    if (was === 'soup') cue('boom');
    record(state, `The ${STAGES[was].name} was over.`, was);
    record(state, STAGES[state.current].tribal ? 'The spear fell, and the world burned.' : `The ${STAGES[state.current].name} began.`);
    scene.evolveFlash();
    pokedThisStage = false;
    ui.tab = 'grow';
    panelKey = '';
    save();
    render();
  }
}

/** Whether the screen shows a map (the Creature's island or what's left of it). */
const onMap = () => state.current === 'creature' || state.current === 'tribal' || state.current === 'shore';

// ---- The story's hold on the screen ----
// From the strike to the waking, everything but the world and the story's words steps away
// (the `cinematic` class), and popups wait until it's over.
let striking = false;
let waking = false;
const heldModals: [string, number][] = [];
/** Before they wake: the walk to the spear, then the wait to touch it. */
const beforeWaking = () => state.current === 'tribal' && !state.stages.tribal.tribe?.awake;
function cine(): boolean {
  return striking || waking || alone || beforeWaking();
}
function syncCine(): void {
  const on = cine();
  // A popup already open when the story takes the screen (an egg hatching, say) waits until
  // after: hidden under the story it would otherwise swallow every tap, and seem frozen.
  if (on && !modal.hidden && modal.dataset.kind !== 'whisper' && modal.dataset.kind !== 'fallen') {
    const box = modal.firstElementChild as HTMLElement | null;
    box?.querySelector('.auto-close')?.remove();
    if (box) heldModals.unshift([box.innerHTML, 0]);
    clearTimeout(modalTimer);
    modal.hidden = true;
  }
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
      if (got) glug();
      if (got === 'found') scene.float(e.x, e.y - 10, 'engulfed!', '#f5c45e');
      else if (got === 'caught') scene.float(e.x, e.y - 10, `caught ${state.stages[state.current].captured[e.id]} of ${r?.captures ?? 1}`, '#f5c45e');
    } else if (e.type === 'rare') {
      scene.float(e.x, e.y - 10, 'a rare microbe!', '#f5c45e');
      cue('chime', 0.4);
    }
    else if (e.type === 'hit') scene.float(e.x, e.y - 10, ['thwack', 'ow!', 'scram!'][Math.floor(Math.random() * 3)], '#f2ead7');
    else if (e.type === 'court') {
      const name = court(state, Math.random, { parts: e.parts, genes: e.genes });
      scene.float(e.x, e.y, name ? `${name} joins you!` : 'not interested…', name ? '#e68ab8' : '#f2ead7');
    } else if (e.type === 'fend') scene.float(e.x, e.y - 10, `driven off! +${format(fendOff(state))}`, '#f5c45e');
    else if (e.type === 'forage') {
      const got = e.party ? state.stages.creature.lastParty : state.stages.creature.lastForage;
      if (got) scene.float(e.x, e.y, `${e.party ? 'party home ' : ''}+${format(D(got))}`, '#f5c45e');
    } else if (e.type === 'place') showPlaceCard(e.id, e.x, e.y);
    else if (e.type === 'person') showPersonCard(e.i, e.x, e.y);
    else if (e.type === 'village') {
      const s = shoreOf(state);
      const v = s?.villages.find((x) => x.id === e.id);
      if (s && v) {
        showModal(villageCard(s, v));
        modal.dataset.village = String(v.id);
      }
    } else if (e.type === 'poi') {
      const s = shoreOf(state);
      const p = s && poisOf(s).find((x) => x.id === e.id);
      if (s && p) {
        p.known = true;
        showModal(poiCard(s, p));
      }
    } else if (e.type === 'villager') {
      const s = shoreOf(state);
      const p = s?.people.find((x) => x.id === e.id);
      if (s && p) {
        scene.float(e.x, e.y, `${p.name}${p.id === s.chief ? ', chief' : p.founder ? ', one of the four' : isAdult(s, p) ? '' : ', a child'}`, '#f2ead7');
        treeTrail = [];
        showTree({ id: p.id });
      }
    }
    else if (e.type === 'spear' && awaken(state)) {
      // The waking: it touches the spear, and they know that they are. A flash, the
      // shockwave rolling out across the world, then the words; then the Extinction begins.
      // Inside its mind: the vision. Then out again, and the waking spreads to the others.
      waking = true;
      storyLine('');
      panelKey = '';
      save();
      window.setTimeout(
        () => {
          // Inside its mind, a choir.
          cue('choir', 0.75);
          playWaking(() => {
            scene.spreadWake();
            storyLine(STORY.wakeSub);
            window.setTimeout(() => storyLine(''), 7000);
            window.setTimeout(() => {
              waking = false;
              syncCine();
              render();
            }, 8000);
          });
        },
        2400,
      );
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
  placeCard.className = 'px-box';
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
    : `Found: gives ${format(tripPay(state, p).mul(FARM_PAY))} ${def.currency} every time it grows back (next in ${formatTime(rest)})`;
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
/** What two fingers are doing (decided once they've moved): tilting the view, or pinching. */
let twoMode: 'none' | 'tilt' | 'pinch' = 'none';
let twoStart: { spread: number; midY: number } | null = null;
let mapDragged = false;

// Keys, on a computer: Esc lets go of a miracle being drawn, or closes a card.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (casting) endCast();
  else if (!placeCard.hidden) placeCard.hidden = true;
  else if (!modal.hidden && modal.dataset.kind === 'night') modal.hidden = true;
});

// A report that closes itself (the night's news) also closes at a tap.
modal.addEventListener('click', (e) => {
  if (modal.dataset.kind === 'night' && !(e.target as HTMLElement).closest('button')) modal.hidden = true;
});

// The web of ideas: one finger drags it about, two pinch to zoom (the window's in the menu).
const webFingers = new Map<number, { x: number; y: number }>();
panel.addEventListener('pointerdown', (e) => {
  const box = (e.target as HTMLElement).closest<HTMLElement>('.mind-tree');
  if (!box || (e.target as HTMLElement).closest('.mind-zoom')) return;
  webFingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
});
panel.addEventListener('pointermove', (e) => {
  const f = webFingers.get(e.pointerId);
  const box = document.querySelector<HTMLElement>('.mind-tree');
  const pan = document.querySelector<HTMLElement>('.mind-pan');
  if (!f || !box || !pan) return;
  const size = box.clientWidth;
  if (webFingers.size >= 2) {
    const [a, b] = [...webFingers.values()];
    const before = Math.hypot(a.x - b.x, a.y - b.y);
    f.x = e.clientX;
    f.y = e.clientY;
    const after = Math.hypot(a.x - b.x, a.y - b.y);
    const r = box.getBoundingClientRect();
    if (before > 10) zoomWeb(after / before, (a.x + b.x) / 2 - r.left - r.width / 2, (a.y + b.y) / 2 - r.top - r.height / 2, size);
  } else {
    panWeb(e.clientX - f.x, e.clientY - f.y, size);
    f.x = e.clientX;
    f.y = e.clientY;
  }
  pan.setAttribute('style', webTransform());
});
const webUp = (e: PointerEvent) => webFingers.delete(e.pointerId);
panel.addEventListener('pointerup', webUp);
panel.addEventListener('pointercancel', webUp);

// Casting: while a miracle is picked, a finger on the map draws it (no panning, no taps).
stageEl.addEventListener(
  'pointerdown',
  (e) => {
    if (!casting || (e.target as HTMLElement).closest('button, #castbar')) return;
    e.stopImmediatePropagation();
    stageEl.setPointerCapture(e.pointerId);
    const r = stageEl.getBoundingClientRect();
    castPts = [{ x: e.clientX - r.left, y: e.clientY - r.top }];
    scene.castStroke(castPts);
  },
  true,
);
stageEl.addEventListener(
  'pointermove',
  (e) => {
    if (!casting || !castPts.length) return;
    e.stopImmediatePropagation();
    const r = stageEl.getBoundingClientRect();
    castPts.push({ x: e.clientX - r.left, y: e.clientY - r.top });
    scene.castStroke(castPts);
  },
  true,
);
const castUp = (e: PointerEvent) => {
  if (!casting || !castPts.length) return;
  e.stopImmediatePropagation();
  finishCast();
};
stageEl.addEventListener('pointerup', castUp, true);
stageEl.addEventListener('pointercancel', castUp, true);

// Sound can only start from a tap: the first one anywhere wakes it.
for (const ev of ['pointerdown', 'touchend', 'click']) document.addEventListener(ev, unlockSound, true);

stageEl.addEventListener('pointerdown', (e) => {
  // (A popup only blocks the world when it can be seen: never under a cutscene.)
  if ((!modal.hidden && !cine()) || (e.target as HTMLElement).closest('#evolve, button, #placecard')) return;
  placeCard.hidden = true;
  if (state.current === 'tribal') scene.tribeScene.chosen = -1;
  stageEl.setPointerCapture(e.pointerId);
  const r = stageEl.getBoundingClientRect();
  const x = e.clientX - r.left;
  const y = e.clientY - r.top;
  if (onMap()) {
    // The tap itself happens on release, so a drag or a pinch doesn't send the creature off.
    fingers.set(e.pointerId, { x, y, sx: x, sy: y });
    twoMode = 'none';
    twoStart = null;
    if (fingers.size === 1) mapDragged = false;
    else mapDragged = true;
    return;
  }
  swirlPath = [{ x, y }];
  swirlAngle = null;
  swirlSpin = 0;
  scene.ripple(x, y);
  if (state.current === 'soup' || state.current === 'cell') tapSound();
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
      const [a, b] = [...fingers.values()];
      const before = Math.hypot(a.x - b.x, a.y - b.y);
      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;
      f.x = x;
      f.y = y;
      const after = Math.hypot(a.x - b.x, a.y - b.y);
      // Which it is, decided once the fingers have moved a little: two fingers side by side
      // dragged up or down together tilt the view; anything else pinches and pans.
      if (twoMode === 'none') {
        twoStart ??= { spread: before, midY };
        const dy = (a.y + b.y) / 2 - twoStart.midY;
        const ds = Math.abs(after - twoStart.spread);
        if (Math.abs(dy) > 14 && ds < twoStart.spread * 0.15 && Math.abs(a.y - b.y) < Math.abs(a.x - b.x) * 0.7) twoMode = 'tilt';
        else if (Math.abs(dy) > 14 || ds > 14 || Math.abs((a.x + b.x) / 2 - midX) > 14) twoMode = 'pinch';
      }
      if (twoMode === 'tilt') {
        // Up looks out toward the horizon (lower, more side-on); down looks straight down.
        ui.tilt = scene.tiltBy(((a.y + b.y) / 2 - midY) * 0.004);
        return;
      }
      // Pinch: zoom by the change in spread, about the middle, and pan with the middle.
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
  if (twoMode === 'tilt' && fingers.size < 2) saveUi();
  twoMode = 'none';
  twoStart = null;
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
    if (!onMap()) return;
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
  // (Building has its own, deeper pop.)
  if (!el.dataset.build) popSound();
  if (el.dataset.gen) {
    if (buyGenerator(state, id, el.dataset.gen, buyCount(state, id, el.dataset.gen, state.buyAmount))) scene.purchase(state, el.dataset.gen);
  } else if (el.dataset.up) {
    if (buyUpgrade(state, id, el.dataset.up)) scene.purchase(state, el.dataset.up);
  } else if (el.dataset.dial) setDial(state, id, el.dataset.dial as DialId, Number(el.dataset.level));
  else if (el.dataset.amount) state.buyAmount = el.dataset.amount === 'max' ? 'max' : (Number(el.dataset.amount) as BuyAmount);
  else if (el.dataset.warp) state.warp = Number(el.dataset.warp);
  else if (el.dataset.policy) state.stages.creature.roamOpts.policy = el.dataset.policy as RunInPolicy;
  else if (el.dataset.whisper !== undefined) {
    const ex = state.stages.tribal.tribe?.ex;
    if (ex) answerWhisper(ex, Number(el.dataset.whisper));
    modal.hidden = true;
    panelKey = '';
    save();
  } else if (el.dataset.node) pickIdea(el.dataset.node);
  else if (el.dataset.webzoom) {
    const box = document.querySelector<HTMLElement>('.mind-tree');
    const size = box?.clientWidth ?? 360;
    if (el.dataset.webzoom === 'fit') Object.assign(webView, { s: 1, x: 0, y: 0 });
    else zoomWeb(el.dataset.webzoom === 'in' ? 1.5 : 1 / 1.5, 0, 0, size);
    const pan = document.querySelector<HTMLElement>('.mind-pan');
    if (pan) pan.setAttribute('style', webTransform());
  }
  else if (el.dataset.cast) startCast(el.dataset.cast as SpellId);
  else if (el.dataset.build) {
    if (build(state, el.dataset.build as BuildId)) {
      popSound(0.72);
      save();
    }
  } else if (el.dataset.lean) setLean(state, el.dataset.lean as Lean);
  else if (el.dataset.buildcat) setBuildCat(el.dataset.buildcat);
  else if (el.dataset.villageview) setVillageView(el.dataset.villageview);
  else if (el.dataset.steward) setSteward(state, el.dataset.steward === 'on');
  else if (el.dataset.stewardplan) setSteward(state, true, el.dataset.stewardplan as StewardPlan);
  else if (el.dataset.camera) {
    // Back to the village (and the camera stays there), or back with the chief.
    const s = shoreOf(state);
    if (s) {
      if (el.dataset.camera === 'home') scene.shoreScene.lookAt(s.hearth, 3);
      else scene.shoreScene.follow();
      if (!isWide()) ui.open = false;
    }
  }
  else if (el.dataset.deck) {
    const deck = el.closest<HTMLElement>('.deck');
    if (deck) flipDeck(deck, Number(el.dataset.deck));
  }
  else if (el.dataset.join) {
    const [id, a] = el.dataset.join.split(':');
    answerJoin(state, Number(id), a as JoinAnswer);
    modal.hidden = true;
    panelKey = '';
    save();
  } else if (el.dataset.askjoin) {
    const s = shoreOf(state);
    const v = s?.villages.find((x) => x.id === Number(el.dataset.askjoin));
    if (s && v && v.asking !== undefined) showModal(joinCard(s, v));
  } else if (el.dataset.tax) {
    const [id, t] = el.dataset.tax.split(':');
    setTax(state, Number(id), Number(t));
    panelKey = '';
  }
  else if (el.dataset.gopoi || el.dataset.seepoi) {
    const s = shoreOf(state);
    const p = s && poisOf(s).find((x) => x.id === Number(el.dataset.gopoi ?? el.dataset.seepoi));
    if (s && p) {
      if (el.dataset.gopoi) {
        // Right up to it (a step short, on its near side).
        walkChief(state, { x: p.x, y: p.y + 2 });
        scene.shoreScene.follow();
      } else scene.shoreScene.lookAt(p, 3);
      modal.hidden = true;
      if (!isWide()) ui.open = false;
    }
  }
  else if (el.dataset.gift) {
    const s = shoreOf(state);
    const id = Number(el.dataset.gift);
    const got = gift(state, id);
    if (got && s) {
      cue('chime', 0.35);
      const r = el.getBoundingClientRect();
      scene.float(r.left + r.width / 2, r.top, `+${got} trust`, '#8acf6a');
      // (The card, if it's open, shows the new trust.)
      const v = s.villages.find((x) => x.id === id);
      if (!modal.hidden && modal.dataset.village === String(id) && v && !v.joined) {
        showModal(villageCard(s, v));
        modal.dataset.village = String(id);
      } else if (v?.joined) modal.hidden = true;
      save();
    }
  } else if (el.dataset.visit) {
    const v = shoreOf(state)?.villages.find((x) => x.id === Number(el.dataset.visit));
    if (v) {
      walkChief(state, { x: v.x + 4, y: v.y + 4 });
      scene.shoreScene.follow();
      modal.hidden = true;
    }
  }
  else if (el.dataset.raid) {
    const s = shoreOf(state);
    const v = s?.villages.find((x) => x.id === Number(el.dataset.raid));
    if (s && v) {
      showModal(villageCard(s, v));
      modal.dataset.village = String(v.id);
    }
  } else if (el.dataset.band) {
    const s = shoreOf(state);
    const [id, n] = el.dataset.band.split(':').map(Number);
    if (s && sendBand(state, s, id, n)) {
      cue('impact', 0.3);
      modal.hidden = true;
      save();
    }
  } else if (el.dataset.tree || el.dataset.treeline) {
    // (From a tree on show: Back returns to it. Opened afresh: a new trail.)
    if (treeAt && !modal.hidden && modal.dataset.kind === 'tree') treeTrail.push(treeAt);
    else treeTrail = [];
    showTree(el.dataset.treeline ? { line: true } : { id: Number(el.dataset.tree) });
  } else if (el.dataset.treeback) {
    const back = treeTrail.pop();
    if (back) showTree(back);
    else modal.hidden = true;
  } else if (el.dataset.fork) {
    const s = shoreOf(state);
    const [f, o] = el.dataset.fork.split(':');
    if (s && choose(state, s, f as ForkId, o)) {
      cue('ascend', 0.5);
      modal.hidden = true;
      panelKey = '';
      save();
    }
  } else if (el.dataset.forkcard) {
    const s = shoreOf(state);
    if (s?.culture?.asking) showModal(forkCard(s, s.culture.asking.fork));
  } else if (el.dataset.focus !== undefined) {
    const s = shoreOf(state);
    if (s) {
      setFocus(s, (el.dataset.focus || undefined) as Lane | undefined);
      popSound(0.8);
      save();
    }
  } else if (el.dataset.warrule) {
    const s = shoreOf(state);
    if (s) {
      setWarRule(s, el.dataset.warrule as WarRule);
      popSound(0.8);
      save();
    }
  } else if (el.dataset.dance) {
    const s = shoreOf(state);
    const v = s?.villages.find((x) => x.id === Number(el.dataset.dance));
    if (s && v) {
      showModal(danceCard(s, v));
      startDance();
    }
  } else if (el.dataset.step) {
    stepDance(Number(el.dataset.step), el);
  } else if (el.dataset.stance) {
    const s = shoreOf(state);
    if (s && setStance(s, el.dataset.stance as Stance)) {
      popSound(0.8);
      modal.hidden = true;
      save();
    }
  } else if (el.dataset.stancecard) {
    const s = shoreOf(state);
    if (s?.raid?.seen !== undefined) showModal(stanceCard(s));
  } else if (el.dataset.stepin) {
    const s = shoreOf(state);
    if (s && stepIn(s)) {
      cue('ascend', 0.5);
      const r = el.getBoundingClientRect();
      scene.float(r.left + r.width / 2, r.top, 'To the front!', '#e8c050');
      save();
    }
  } else if (el.dataset.rally) {
    const s = shoreOf(state);
    if (s && rally(s)) {
      cue('ascend', 0.4);
      const r = el.getBoundingClientRect();
      scene.float(r.left + r.width / 2, r.top, 'Rallied!', '#e8c050');
      save();
    }
  }
  else if (el.dataset.seevillage) {
    const v = shoreOf(state)?.villages.find((x) => x.id === Number(el.dataset.seevillage));
    if (v) {
      scene.shoreScene.lookAt(v, 3);
      if (!isWide()) ui.open = false;
    }
  }
  else if (el.dataset.ordain) {
    const ex = state.stages.tribal.tribe?.ex;
    if (ex) toggleOrdain(ex, el.dataset.ordain as SpellId);
  }
  else if (el.dataset.learn) {
    if (learnIdea(state, el.dataset.learn)) {
      scene.purchase(state, 'idea');
      // A new job may have opened: the tribe takes it into account straight away.
      const ex = state.stages.tribal.tribe?.ex;
      if (ex) autoAssign(ex);
    }
  }
  else if (el.dataset.roamopt) {
    const c = state.stages.creature;
    const k = el.dataset.roamopt;
    if (k === 'explore') c.autoRoam = !c.autoRoam;
    else if (k === 'breed') c.keepBreeding = !c.keepBreeding;
    else if (k === 'places' || k === 'settle' || k === 'mandatory') c.roamOpts[k] = !c.roamOpts[k];
  } else if (el.dataset.tilt) {
    const v = Number(el.dataset.tilt);
    ui.tilt = v || null;
    scene.setTilt(ui.tilt);
    saveUi();
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
    ui.open = ui.tab === t && !isWide() ? !ui.open : true;
    // The web of ideas wants the whole screen; leaving it, the menu goes back as it was.
    if (t === 'ideas' && ui.open && !ui.full && !isWide()) {
      ui.full = true;
      ideasFull = true;
    } else if (t !== 'ideas' && ideasFull) {
      ui.full = false;
      ideasFull = false;
    }
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
        // Out of the Creature there's no coming back: asked once more, with the line as it is.
        if (STAGES[state.current].next === 'tribal') {
          if (!ending.hidden) {
            ending.classList.remove('in');
            setTimeout(() => (ending.hidden = true), 600);
            ui.watching = true;
            saveUi();
            goalKey = '';
          }
          showModal(lastLookCard());
          break;
        }
        closeEnding();
        break;
      case 'look-sure':
        modal.hidden = true;
        closeEnding();
        break;
      case 'keep':
        ending.classList.remove('in');
        setTimeout(() => (ending.hidden = true), 600);
        // At the Creature's end, staying to watch: the strike waits for them (the strip says so).
        if (STAGES[state.current].next === 'tribal') {
          ui.watching = true;
          saveUi();
        }
        goalKey = '';
        break;
      case 'evolve': {
        const was = state.current;
        if (evolve(state)) {
          if (was === 'soup') cue('boom');
          scene.evolveFlash();
          pokedThisStage = false;
        }
        break;
      }
      case 'dismiss':
        modal.hidden = true;
        break;
      case 'fallen-leave':
      case 'fallen-eat':
        decideFallen(state, el.dataset.act === 'fallen-eat');
        modal.hidden = true;
        panelKey = '';
        save();
        break;
      case 'take-raft': {
        const got = takeRaft(state);
        if (got) {
          popSound(0.72);
          const r = el.getBoundingClientRect();
          scene.float(r.left + r.width / 2, r.top, `+${got} wood`, '#c8a878');
          save();
        }
        break;
      }
      case 'look-landed':
        // Ashore: New Shore begins.
        extinctEl.classList.remove('in');
        window.setTimeout(() => (extinctEl.hidden = true), 600);
        startShore(state);
        record(state, 'They came ashore on a new island. There was smoke inland.', 'shore', 'Landfall');
        // (The story's over: the interface comes back.)
        alone = false;
        syncCine();
        scene.reload();
        panelKey = '';
        goalKey = '';
        ui.tab = 'grow';
        save();
        render();
        break;
      case 'cast-cancel':
        endCast();
        break;
      case 'retry':
        tryAgain(state);
        alone = false;
        extinctEl.classList.remove('in');
        window.setTimeout(() => (extinctEl.hidden = true), 600);
        scene.reload();
        panelKey = '';
        goalKey = '';
        save();
        syncCine();
        break;
      case 'expand':
        ideasFull = false;
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
// The Menu's volume sliders.
document.addEventListener('input', (e) => {
  const el = e.target as HTMLInputElement;
  if (el.dataset?.vol) setVolume(el.dataset.vol as Channel, Number(el.value) / 100);
});

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
  if (where !== 'creature' && where !== 'tribal' && where !== 'escape' && where !== 'shore') return;
  history.replaceState(null, '', location.pathname);
  const what =
    where === 'shore'
      ? 'at the start of New Shore (just ashore)'
      : where === 'escape'
      ? 'in the Extinction, the raft built and the night about to fall (to see them set off)'
      : where === 'tribal'
        ? 'at the end of the Creature stage (to see the strike and the Extinction)'
        : 'at the beginning of the Creature stage';
  if (!confirm(`Start a fresh game ${what}? This replaces your current save (export it from the Menu first if you want to keep it).`)) return;
  try {
    const code = (await (await fetch('./creature-start.txt', { cache: 'no-store' })).text()).trim();
    const next = importSave(code);
    // (Straight to New Shore: its island is made first, before anything changes on screen.)
    if (where === 'shore') await prepareShoreIsland(landedSeed(islandFor(next).seed)).catch(() => undefined);
    state = next;
    state.lastSeen = Date.now();
    if (where === 'tribal') {
      // The Creature played through: every place found, six generations, a big herd.
      const c = state.stages.creature;
      for (const r of STAGES.creature.reactions!) if (!c.discovered.includes(r.id)) c.discovered.push(r.id);
      for (const p of STAGES.creature.places!) c.trips[p.id] = Math.max(1, c.trips[p.id] ?? 0);
      c.generation = 6;
      c.generators.territory = 8;
      c.pop = 400;
      if (c.seen) c.seen.fill(1);
    }
    if (where === 'escape' || where === 'shore') {
      // Into the Extinction, awake, with the raft done and the crossing's food put by: at
      // nightfall (a few seconds off) they set out.
      if (!state.unlocked.includes('tribal')) state.unlocked.push('tribal');
      state.current = 'tribal';
      const t = startTribe(state);
      t.awake = true;
      state.stages.tribal.tribe = t;
      startExtinction(state);
      const ex = t.ex!;
      for (const id of ['rope', 'hollow']) if (!ex.ideas.includes(id)) ex.ideas.push(id);
      ex.raft = { frame: 30, lashing: 20, hull: 45 };
      ex.voyage = 40;
      ex.sendRule = 'family';
      ex.clock = DAY_SEC - 6;
      if (where === 'shore') {
        ex.family = ex.people.slice(0, 4).map((p) => p.id);
        launch(state);
        startShore(state);
        record(state, 'They came ashore on a new island. There was smoke inland.', 'shore', 'Landfall');
      }
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
  soundHidden(document.visibilityState === 'hidden');
  if (document.visibilityState === 'hidden') save();
  else {
    catchUp();
    render();
    if (!import.meta.env.DEV) void checkForUpdate();
  }
});
window.addEventListener('pagehide', save);
// A deck of choices: one card on show, flipped one at a time (the arrows, or a swipe).
function flipDeck(deck: HTMLElement, by: number): void {
  const n = Number(deck.dataset.n ?? 1);
  const i = Math.max(0, Math.min(n - 1, Number(deck.dataset.i ?? 0) + by));
  deck.dataset.i = String(i);
  const track = deck.querySelector<HTMLElement>('.deck-track');
  if (track) track.style.transform = `translateX(${-i * 100}%)`;
  deck.querySelectorAll('.deck-dots i').forEach((d, k) => d.classList.toggle('on', k === i));
}
let deckSwipe: { deck: HTMLElement; x: number; y: number } | null = null;
document.addEventListener('pointerdown', (e) => {
  const deck = (e.target as HTMLElement).closest<HTMLElement>('.deck');
  deckSwipe = deck ? { deck, x: e.clientX, y: e.clientY } : null;
});
document.addEventListener('pointerup', (e) => {
  if (!deckSwipe) return;
  const dx = e.clientX - deckSwipe.x;
  const dy = e.clientY - deckSwipe.y;
  // A swipe: mostly sideways, far enough to mean it.
  if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5) flipDeck(deckSwipe.deck, dx < 0 ? 1 : -1);
  deckSwipe = null;
});
// Back from another app or tab (or the page restored from the back button): the sound picks up
// again (on iPhone, if it can't yet, the first touch does it).
window.addEventListener('pageshow', () => soundHidden(false));
window.addEventListener('focus', () => soundHidden(false));
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
/** A black veil over everything, for fading between scenes: to `to` (0 clear, 1 black) over ms. */
const veil = document.createElement('div');
veil.id = 'veil';
document.body.appendChild(veil);
function fadeTo(to: number, ms: number): void {
  veil.style.transition = `opacity ${ms}ms ease-in-out`;
  veil.style.opacity = String(to);
}

/** The four leaving on the raft: their names over their heads, till the raft is far out. */
const leavingNames = new Map<number, HTMLElement>();
function nameLeaving(): void {
  const labels = scene.leavingLabels();
  const ex = state.stages.tribal.tribe?.ex;
  const seen = new Set<number>();
  for (const l of labels) {
    const p = ex?.people.find((q) => q.id === l.id);
    if (!p) continue;
    seen.add(l.id);
    let el = leavingNames.get(l.id);
    if (!el) {
      el = document.createElement('div');
      el.className = 'leaving-name';
      el.textContent = p.name;
      stageEl.appendChild(el);
      leavingNames.set(l.id, el);
    }
    el.style.transform = `translate(${Math.round(l.x)}px, ${Math.round(l.y)}px) translate(-50%, -100%)`;
  }
  for (const [id, el] of leavingNames) {
    if (seen.has(id)) continue;
    el.remove();
    leavingNames.delete(id);
  }
}

/** A habitat newly open (Depths, Vents): a rising chime, and its name. */
let openSeen = '';
function habitatsOpened(): void {
  const habitats = STAGES[state.current].habitats;
  if (!habitats) return void (openSeen = '');
  const open = habitats.filter((h) => habitatUnlocked(state, state.current, h));
  const key = `${state.current}:${open.length}`;
  const [stage, was] = openSeen.split(':');
  if (stage === state.current && open.length > Number(was)) {
    cue('ascend');
    const h = open[open.length - 1];
    const r = stageEl.getBoundingClientRect();
    scene.float(r.width / 2, r.height * 0.45, `The ${h.name} are open`, '#9ad8d4');
  }
  openSeen = key;
}

function frame(now: number): void {
  requestAnimationFrame(frame);
  acc += now - last;
  last = now;
  if (acc < FRAME_MS) return;
  const dt = Math.min(acc, 100) / 1000;
  acc %= FRAME_MS;
  scene.draw(state, dt);
  nameLeaving();
  // The Extinction's countdown, worked on a little each frame (about 4 ms at most).
  if (guessJob) {
    const t0 = performance.now();
    do {
      const r = guessJob.next();
      if (r.done) {
        guess = r.value;
        guessJob = null;
        break;
      }
    } while (performance.now() - t0 < 4);
  }
  pondEvents();
  shoreFrame();
  syncCine();
  habitatsOpened();
  renderSpellbar();
  renderCrisis();
  // (Once the strike begins, the island's weather is hushed at once: the night falls still.)
  soundFrame(state, striking ? null : scene.skies);
}

// A save made mid-ending (closed during the credits) picks up at the reveal. This also
// carries on a Cell finished before the Creature existed: its ending now leads somewhere.
if (canEvolve(state) && !(STAGES[state.current].next === 'tribal' && ui.watching)) playEnding();
// New Shore's island has to be loaded (or made) before its time can be caught up.
needIsland();
if (!waitingIsland) catchUp();
render();
document.fonts?.ready.then(() => render());
requestAnimationFrame(frame);
setInterval(step, TICK_SEC * 1000);
setInterval(render, 250);
setInterval(save, 10_000);
