// The Creature stage scene: the game's island, seen from above, at true scale. Zoomed
// out it's the whole island and your herd is a cluster of dots; zoomed in it's the
// grass at their feet. Fog lies over everything your creature hasn't seen: it clears
// as it walks (further with Senses). Tap anywhere to send it there.
//
// The herd lives at home: it drifts between grazing spots, beds down at the nests at
// night, huddles in winter and scatters from a stalking beast (sentries charge it).
// Creatures are drawn side-on (the old pixel-RPG convention), sorted by depth.

import { PAL } from '../art/sprites';
import { herdInView, squeak, thunder } from '../audio/sound';
import { STAGES } from '../content/stages';
import { islandFor, nearestNest, nestPoints, nestProgress, partyLeg, spot, statsOf, walkTo } from '../economy/creature';
import { Biome, CELL, ISLAND, isLand, type Island, type Pt } from '../economy/island';
import { SEASON_SEC, seasonOf } from '../economy/rates';
import { H_LO, H_SPAN, LIFT, TILT } from './shade';
import type { GameState, Role } from '../economy/types';
import { drawBlob, type BlobStyle } from './blob';
import { creatureLookOf, drawMini, type CreatureLook } from './creatureLook';
import { Effects, hash, mixColor, visibleCount, type Frame } from './paint';
import { Sightings } from './sightings';
import { Trails } from './trails';
import { Wild, type Bush, type Sprite, type WildView } from './wild';
import type { PondEvent } from './pond';

interface Member {
  x: number;
  y: number;
  vx: number;
  vy: number;
  role: Role;
  phase: number;
  /** Seconds left running from a beast. */
  flee: number;
  /** A moment of its own it's in the middle of (see startMoment). */
  act?: Act;
  /** Which nest it lives at (0 home, then the nests founded since). */
  base: number;
  /** Waypoints over land when it's moving to live at another nest. */
  path?: Pt[];
  /** Which member this is (decides its nest), and whether it's been given its nest yet. */
  id: number;
  placed?: boolean;
}

/** Herd life: little things members do now and then, on their own or in twos. */
interface Act {
  kind: 'chase' | 'nuzzle' | 'rest' | 'drink' | 'lookout' | 'eat';
  /** Seconds left. */
  t: number;
  /** Where it's happening. */
  x: number;
  y: number;
  /** In a pair: the one leading (the chased, the left of two nuzzling), and the other. */
  lead?: boolean;
  mate?: Member;
  bush?: Bush;
}

interface Beast {
  x: number;
  y: number;
  hits: number;
  flinch: number;
  fleeing: boolean;
  life: number;
  left: boolean;
}

/** Each season's ground colours. */
const SEASON_LAND = [
  { grass: '#6faa5c', dark: '#5a9450', forest: '#2f7048', marsh: '#4f8f7a', high: '#8fa860', sand: '#d8c08a', water: '#3f7f95' },
  { grass: '#86b050', dark: '#709a42', forest: '#3b7a3e', marsh: '#5a9070', high: '#a2ae62', sand: '#dcc58e', water: '#3f7f95' },
  { grass: '#b39a52', dark: '#9a8244', forest: '#a8582e', marsh: '#7a8058', high: '#a88e5a', sand: '#d0b884', water: '#3a7d98' },
  { grass: '#d3dde4', dark: '#b6c4cf', forest: '#5d7a6a', marsh: '#a8c0cd', high: '#cad4dc', sand: '#d0d4d2', water: '#b2cad6' },
];
const FOG = ['#d4dbe0', '#bfc8cf'];
/** Things that shine in the dark (fireflies, a beast's eye): alpha 254 tells the shader to make them glow. */
const GLOW_Y = 'rgba(245, 196, 94, 0.996)';
const GLOW_LIME = 'rgba(220, 250, 130, 0.996)';
const DEEP = '#24506e';
const DIET_DOT: Record<string, string> = { grazer: '#86dcd8', hunter: '#f2906c', omnivore: '#f5c45e', none: PAL.g };

const BEAST_STYLE: BlobStyle = { edge: '#e8615a', body: '#7a3a2a', nucleus: '#2a1008' };
const BEAST_FLINCH: BlobStyle = { edge: PAL.w, body: '#b0503a', nucleus: '#2a1008' };
/** Seconds in a day; the last quarter is night. */
const DAY_SEC = 120;
/** Tiles a second the herd ambles at. */
const HERD_WALK = 0.7;
const ZOOM_MIN = 0.3;
const ZOOM_MAX = 8;

type Mote = 'snow' | 'leaf' | 'petal' | 'pollen';
/** Each season's colour cast over the whole picture (spring fresh, summer warm, autumn gold, winter cold). */
const SEASON_TINT = [
  [0.98, 1.05, 1.0],
  [1.06, 1.02, 0.92],
  [1.1, 0.96, 0.84],
  [0.9, 0.97, 1.1],
];

/** How far into winter the seasons are (0 to 1), easing in and out with the change. */
const weight3 = (si: number, next: number, turn: number) => (si === 3 ? 1 - turn : 0) + (next === 3 ? turn : 0);

const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mixRgb = (a: number[], b: number[], t: number) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

/** Ground after the strike: grass and forest burnt to grey and black, rock scorched, the
 * fissures dark with a little heat still in them, the spear's lake dark red. */
function charred(p: number[], bi: number, scar: number, n: number, x: number, y: number): number[] {
  // The spear's lake: dark, wine-red water.
  if (scar === 3) return n > 0.9 ? [120, 60, 90] : n < 0.3 ? [44, 18, 34] : [62, 26, 46];
  if (scar === 2) return n > 0.82 ? [150, 42, 26] : n > 0.6 ? [46, 22, 20] : [22, 14, 14];
  switch (bi) {
    case Biome.Forest:
      // Burnt trunks standing in a loose grid, ash between.
      return (x + (y % 3)) % 3 === 0 && n < 0.7 ? [24, 20, 20] : n > 0.8 ? [70, 64, 60] : [44, 40, 40];
    case Biome.Rock:
    case Biome.Peak:
      return mixRgb(p, [20, 16, 16], 0.45);
    case Biome.Sand:
      return n < 0.2 ? [88, 82, 76] : [118, 110, 100];
    default:
      // Ash and char, and here and there an ember.
      return n > 0.985 ? [200, 70, 30] : n < 0.25 ? [40, 37, 37] : n < 0.6 ? [70, 66, 64] : [92, 88, 84];
  }
}

/** A storm's state, kept in the save. */
export interface WeatherKeep {
  storm: number;
  left: number;
  timer: number;
  wet: number;
  bow: number;
}

export class RangeScene {
  protected fx = new Effects();
  protected wild = new Wild();
  protected trails = new Trails();
  protected sightings = new Sightings();
  /** Weather: a storm building and passing (0 to 1), the ground still wet after, mist, ice. */
  protected storm = 0;
  /** Until the herd's next squeak (counts down faster the more are hopping). */
  private squeakIn = 1;
  protected stormLeft = 0;
  protected stormTimer = 90;
  protected wet = 0;
  protected weather: [number, number, number, number] = [0, 0, 0, 0];
  /** The weather as heard: how hard it's raining (a storm) and how far into winter (snow). */
  get skies(): { rain: number; snow: number; zoom: number } {
    return { rain: this.storm, snow: this.weather[2], zoom: this.zoom };
  }
  /** How deep in an ash winter the world is, 0 to 1 (the Extinction's; never on the Creature's). */
  protected ash = 0;
  protected rain: { x: number; y: number; z: number; v: number }[] = [];
  protected flash = 0;
  protected bow = 0;
  /** Where the camera was last frame (the air layer slides a little as it moves). */
  protected airCam = { x: 0, y: 0 };
  protected flies: { x: number; y: number; ph: number }[] = [];
  protected bowView: [number, number, number, number] = [0, 0, 1, 0];
  protected momentTimer = 6;
  protected memberId = 0;
  protected events: PondEvent[] = [];
  protected members: Member[] = [];
  protected beast: Beast | null = null;
  protected beastTimer = 50;
  protected visitor: { x: number; y: number; tx: number; ty: number; life: number; look: CreatureLook } | null = null;
  protected visitorTimer = 40;
  protected graze: Pt | null = null;
  protected grazeTimer = 0;
  /** Seasonal bits in the air: snow, falling leaves, blossom petals, summer pollen. */
  protected flakes: { x: number; y: number; z: number; v: number; kind: Mote; ph: number }[] = [];
  /** Each season's painted ground, for the island it was painted for. */
  protected ground = new Map<number, HTMLCanvasElement>();
  protected groundSeed = -1;
  /** Fog over the island, and which cells it was last painted for. */
  protected fog: HTMLCanvasElement | null = null;
  protected fogKnown: Uint8Array | null = null;
  // The camera: what's in the middle (in tiles), and how many art pixels a tile is.
  protected camX = 0;
  protected camY = 0;
  protected zoom = 3;
  protected auto = true;
  /** Held by a cutscene: nothing hands the camera back. */
  protected pinned = false;
  protected snap = true;
  protected viewTop = 0;
  protected viewBottom = 0;
  protected W = 0;
  protected H = 0;
  protected island: Island | null = null;
  protected lastPos: Pt | null = null;
  /** True while the lighting shader draws night and fog (see shade.ts), so they're left out here. */
  shaded = false;
  protected heightData: Uint8Array | null = null;
  protected heightDataSeed = '';
  /** Bumped whenever the fog changes, so the shader re-sends it only then. */
  protected fogVersion = 0;
  /** This season's ground and the next one's, and how far the change has got (0 to 1). */
  protected groundPair: [HTMLCanvasElement, HTMLCanvasElement] | null = null;
  protected seasonBlend = 0;
  protected seasonPair: [number, number] = [0, 1];

  /** How much the land rises on screen (art px per unit of height, per zoom), and how much the
   * slant squashes depth: each era's island can stand up more (New Shore's is the most 3D). */
  protected lift = LIFT;
  protected tilt = TILT;
  /** Haze over the far (top) side of the view, 0 to 1: depth in the air. */
  depth = 0;
  get liftTilt(): [number, number, number] {
    return [this.lift, this.tilt, this.depth];
  }

  /** Where in the day it is (0 sunrise, 0.75 sunset), when the island keeps its own clock (so a
   * reload doesn't make it morning again); null to go by the scene's. */
  dayAt: number | null = null;
  /** The weather as it was (kept in the save, so a storm is still on after a reload). */
  private kept: WeatherKeep | null = null;
  private keptKey = '';

  /** Picks the weather up where it was left (for this island), and keeps it as it changes. */
  protected keepWeather(state: GameState, key: string): void {
    const all = (state.weather ??= {});
    if (this.keptKey === key && this.kept === all[key]) return;
    this.keptKey = key;
    const k = all[key];
    if (k) {
      this.storm = k.storm;
      this.stormLeft = k.left;
      this.stormTimer = k.timer;
      this.wet = k.wet;
      this.bow = k.bow;
    }
    this.kept = all[key] = { storm: this.storm, left: this.stormLeft, timer: this.stormTimer, wet: this.wet, bow: this.bow };
  }

  /** Tiles across the island on show, and fog cells across. */
  protected get n(): number {
    return this.island?.n ?? ISLAND;
  }
  protected get cells(): number {
    return this.n / CELL;
  }

  reset(): void {
    this.fx.clear();
    this.keptKey = '';
    this.kept = null;
    this.members = [];
    this.beast = null;
    this.visitor = null;
    this.graze = null;
    this.auto = true;
    this.snap = true;
    this.pinned = false;
    this.glide = null;
    this.zoom = 3;
  }

  /** Takes the camera for a cutscene and holds it: after `delay` seconds it glides over `dur`
   * seconds to a spot and zoom, and stays there. */
  pinCamera(x: number, y: number, zoom: number, delay = 0, dur = 0): void {
    this.auto = false;
    this.snap = false;
    this.pinned = true;
    this.glide = { x0: this.camX, y0: this.camY, z0: this.zoom, x1: x, y1: y, z1: zoom, at: performance.now() / 1000 + delay, dur };
    this.stepGlide();
  }

  private glide: { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number; at: number; dur: number } | null = null;

  private stepGlide(): void {
    const g = this.glide;
    if (!g) return;
    const k = Math.max(0, Math.min(1, g.dur > 0 ? (performance.now() / 1000 - g.at) / g.dur : 1));
    const e = k * k * (3 - 2 * k);
    // The zoom eases in log space (so pulling far out doesn't rush the start).
    this.zoom = g.z0 * (g.z1 / g.z0) ** e;
    this.camX = g.x0 + (g.x1 - g.x0) * e;
    this.camY = g.y0 + (g.y1 - g.y0) * e;
  }

  /** Where a point of the island is on screen, in art pixels. */
  screenOf(p: Pt): Pt {
    return { x: this.sx(p.x), y: this.py(p.x, p.y) };
  }

  drain(): PondEvent[] {
    return this.events.splice(0);
  }

  // ---- Camera ----

  /** The band of the screen that shows the map (between the top bar and the sheet), in art pixels. */
  setView(top: number, bottom: number): void {
    // Opening or closing the sheet hands the camera back.
    if (!this.pinned && Math.abs(bottom - this.viewBottom) > 12) this.auto = true;
    this.viewTop = top;
    this.viewBottom = bottom;
  }

  protected midY(): number {
    return (this.viewTop + (this.viewBottom || this.H)) / 2;
  }

  /** Screen position (art pixels) of a point on the island. */
  protected sx(x: number): number {
    return (x - this.camX) * this.zoom + this.W / 2;
  }

  /** The ground's height at a point, smooth between tiles; water lies flat at 0. */
  heightAt(x: number, y: number): number {
    const is = this.island;
    if (!is) return 0;
    const fx = x - 0.5 - Math.floor(x - 0.5);
    const fy = y - 0.5 - Math.floor(y - 0.5);
    const x0 = Math.max(0, Math.min(this.n - 2, Math.floor(x - 0.5)));
    const y0 = Math.max(0, Math.min(this.n - 2, Math.floor(y - 0.5)));
    const h = is.height;
    const k = y0 * this.n + x0;
    const v = (h[k] * (1 - fx) + h[k + 1] * fx) * (1 - fy) + (h[k + this.n] * (1 - fx) + h[k + this.n + 1] * fx) * fy;
    return Math.max(0, Math.min(H_LO + H_SPAN, v));
  }

  /** Screen row of a point on the ground: in 2.5D, raised by the land's height and seen at a slant. */
  protected py(x: number, y: number): number {
    if (!this.shaded) return this.sy(y);
    return (y - this.camY) * this.zoom * this.tilt + this.midY() - this.heightAt(x, y) * this.lift * this.zoom;
  }

  protected sy(y: number): number {
    return (y - this.camY) * this.zoom + this.midY();
  }

  protected toWorld(ax: number, ay: number): Pt {
    const x = this.camX + (ax - this.W / 2) / this.zoom;
    if (!this.shaded) return { x, y: this.camY + (ay - this.midY()) / this.zoom };
    // In 2.5D, the ground under a pixel may have risen into it from nearer the viewer:
    // march back from the furthest that could, the same way the shader does.
    const base = this.camY + (ay - this.midY()) / (this.zoom * this.tilt);
    const span = (this.lift * 1.05) / this.tilt;
    for (let i = 0; i <= 60; i++) {
      const y = base + span - (i * span) / 60;
      if (this.py(x, y) <= ay) {
        if (i === 0) return { x, y };
        // Narrow it down between this step and the one before (so zooming about a point
        // doesn't creep: the coarse step alone was always a little to the north).
        let lo = y;
        let hi = y + span / 60;
        for (let k = 0; k < 14; k++) {
          const mid = (lo + hi) / 2;
          if (this.py(x, mid) <= ay) lo = mid;
          else hi = mid;
        }
        return { x, y: lo };
      }
    }
    return { x, y: base };
  }

  zoomAt(ax: number, ay: number, factor: number): void {
    // Keep the ground under the fingers exactly under them: find it, zoom, then place the
    // camera so that spot lands back on the same pixel.
    const at = this.toWorld(ax, ay);
    this.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, this.zoom * factor));
    this.camX = at.x - (ax - this.W / 2) / this.zoom;
    if (this.shaded) this.camY = at.y - (ay - this.midY() + this.heightAt(at.x, at.y) * this.lift * this.zoom) / (this.zoom * this.tilt);
    else this.camY = at.y - (ay - this.midY()) / this.zoom;
    this.auto = false;
    this.clamp();
  }

  pan(dx: number, dy: number): void {
    // In 2.5D a tile of depth is squashed on screen, so a drag moves further over the ground.
    this.camX -= dx / this.zoom;
    this.camY -= dy / (this.zoom * (this.shaded ? this.tilt : 1));
    this.auto = false;
    this.clamp();
  }

  protected clamp(): void {
    this.camX = Math.max(0, Math.min(this.n, this.camX));
    this.camY = Math.max(0, Math.min(this.n, this.camY));
  }

  /** The camera, for the shader: centre (tiles), zoom, and the screen row of the centre. */
  /** Places parties were bound for last frame (to puff when one gets home). */
  protected partiesOut = new Set<string>();
  protected foragedSeen = 0;
  protected partiesSeen = 0;
  protected lastPartyNest: Pt | null = null;

  get camParams(): [number, number, number, number] {
    return [this.camX, this.camY, this.zoom, this.midY()];
  }

  /** What the shader needs: the island's heights and kinds, the fog, and the seasons' ground. */
  shadeInputs(): { key: string; n: number; heights: Uint8Array; fog: HTMLCanvasElement; fogVersion: number; ground: [HTMLCanvasElement, HTMLCanvasElement]; blend: number; tint: [number, number, number]; trail: HTMLCanvasElement; trailVersion: number; weather: [number, number, number, number]; bow: [number, number, number, number]; ash: number } | null {
    const is = this.island;
    if (!is || !this.fog || !this.groundPair) return null;
    const key = `${is.seed}/${is.n}`;
    if (!this.heightData || this.heightDataSeed !== key) {
      // 16 bits of height (high byte in r, low in a), and the kind of ground in g.
      const d = new Uint8Array(this.n * this.n * 4);
      for (let i = 0; i < this.n * this.n; i++) {
        const h16 = Math.round(Math.max(0, Math.min(1, (is.height[i] - H_LO) / H_SPAN)) * 65535);
        d[i * 4] = h16 >> 8;
        d[i * 4 + 1] = is.biome[i] * 20;
        d[i * 4 + 3] = h16 & 255;
      }
      this.heightData = d;
      this.heightDataSeed = key;
    }
    const [a, c] = this.seasonPair;
    const tint = SEASON_TINT[a].map((v, i) => v + (SEASON_TINT[c][i] - v) * this.seasonBlend) as [number, number, number];
    return { key, n: is.n, heights: this.heightData, fog: this.fog, fogVersion: this.fogVersion, ground: this.groundPair, blend: this.seasonBlend, tint, trail: this.trails.canvas, trailVersion: this.trails.version, weather: this.weather, bow: this.bowView, ash: this.ash };
  }

  // ---- Input ----

  /** Hits needed to drive a beast off: fewer with Strength. */
  protected hitsNeeded(state: GameState): number {
    const s = statsOf(state).strength;
    return s >= 15 ? 1 : s >= 6 ? 2 : 3;
  }

  protected hitBeast(state: GameState, b: Beast): void {
    b.hits++;
    b.flinch = 0.4;
    if (b.hits >= this.hitsNeeded(state)) {
      b.fleeing = true;
      this.events.push({ type: 'fend', x: this.sx(b.x), y: this.py(b.x, b.y) - 8 });
    } else this.events.push({ type: 'hit', x: this.sx(b.x), y: this.py(b.x, b.y) - 8 });
  }

  tap(state: GameState, ax: number, ay: number): void {
    // A rare sighting, caught in time.
    const seen = this.sightings.hit(this.wildView, ax, ay);
    if (seen) {
      spot(state, seen);
      this.fx.sparkle(ax - 3, ay - 3);
      this.fx.pulse(ax, ay, PAL.y);
      return;
    }
    const near = (x: number, y: number) => Math.hypot(this.sx(x) - ax, this.py(x, y) - 3 - ay) < Math.max(9, this.zoom * 2);
    const b = this.beast;
    if (b && !b.fleeing && near(b.x, b.y)) {
      this.hitBeast(state, b);
      return;
    }
    const v = this.visitor;
    if (v && near(v.x, v.y)) {
      this.events.push({ type: 'court', x: this.sx(v.x), y: this.py(v.x, v.y) - 12 });
      this.visitor = null;
      return;
    }
    // A place's flag (or "!"): a little card about it, with a button to go (so a stray tap
    // near a flag doesn't send it off).
    const is = this.island;
    if (is) {
      const st = state.stages.creature;
      for (const pl of STAGES.creature.places!) {
        const p = is.places[pl.id];
        const found = (st.trips[pl.id] ?? 0) > 0;
        if (!found && !st.seen[Math.floor(p.y / CELL) * this.cells + Math.floor(p.x / CELL)]) continue;
        const X = this.sx(p.x);
        const Y = this.py(p.x, p.y);
        if (Math.abs(X + 1 - ax) < 5 && ay > Y - 11 && ay < Y + 2) {
          this.events.push({ type: 'place', id: pl.id, x: X, y: Y - 10 });
          return;
        }
      }
    }
    // Anywhere else: walk there. Into the fog is how the island gets explored.
    const w = this.toWorld(ax, ay);
    if (walkTo(state, w.x, w.y)) {
      this.auto = true;
      this.fx.pulse(ax, ay, PAL.w);
    }
  }

  purchase(state: GameState, id: string): void {
    void state;
    if (id === 'trip') {
      this.auto = true;
      return;
    }
    const at = this.lastPos ?? this.island?.home;
    if (!at) return;
    this.fx.sparkle(this.sx(at.x), this.py(at.x, at.y) - 8);
    this.fx.pulse(this.sx(at.x), this.py(at.x, at.y) - 4, PAL.y);
  }

  // ---- The ground and the fog ----

  protected paintGround(is: Island, si: number): HTMLCanvasElement {
    const job = this.paintGroundSteps(is, si);
    for (;;) {
      const r = job.next();
      if (r.done) return r.value;
    }
  }

  /** The same, a few rows at a time (a big island's season is painted over several frames). */
  protected *paintGroundSteps(is: Island, si: number): Generator<void, HTMLCanvasElement> {
    const N = is.n;
    const cv = document.createElement('canvas');
    cv.width = N;
    cv.height = N;
    const b = cv.getContext('2d')!;
    const img = b.createImageData(N, N);
    const L = SEASON_LAND[si];
    const c = {
      deep: rgb(DEEP),
      sea: rgb(si === 3 ? '#356a88' : '#3f8aa5'),
      foam: rgb('#7fc3d8'),
      sand: rgb(L.sand),
      grass: rgb(L.grass),
      grassDark: rgb(L.dark),
      forest: rgb(L.forest),
      forestHi: rgb(mixColor(L.forest, '#ffffff', 0.2)),
      forestLo: rgb(mixColor(L.forest, '#000000', 0.35)),
      marsh: rgb(L.marsh),
      water: rgb(L.water),
      reed: rgb(si === 2 ? '#a0884a' : si === 3 ? '#8a9a8a' : '#3e6e3a'),
      high: rgb(L.high),
      highDark: rgb(mixColor(L.high, '#000000', 0.15)),
      rock: rgb(PAL.r),
      rockHi: rgb(PAL.R),
      rockLo: rgb('#3e474e'),
      peak: rgb(si >= 2 ? '#f2f4f5' : '#9aa6ad'),
      snow: rgb('#f6f9fa'),
      flower: rgb(PAL.y),
      flower2: rgb(PAL.w),
      // New Shore's: desert sand and its dune shadows, dry scrub, fresh water.
      desert: rgb(si === 3 ? '#cfb88a' : '#dcbc7c'),
      dune: rgb(si === 3 ? '#b8a070' : '#c4a062'),
      scrub: rgb(mixColor(L.grass, '#c8a860', si === 1 ? 0.6 : 0.5)),
      scrubDark: rgb(mixColor(L.dark, '#8a7040', 0.45)),
      fresh: rgb(si === 3 ? '#5a8aa0' : '#4a9ab5'),
    };
    const H = is.height;
    for (let y = 0; y < N; y++) {
      if (y % 48 === 47) yield;
      for (let x = 0; x < N; x++) {
        const i = y * N + x;
        const bi = is.biome[i];
        const n = hash(x * 31 + y * 17, 3);
        // Light from the top left: darker where the ground falls away from it.
        const slope = H[i] - (y > 0 && x > 0 ? H[i - N - 1] : H[i]);
        let p: number[];
        switch (bi) {
          case Biome.Deep:
            p = c.deep;
            break;
          case Biome.Sea:
            p = H[i] > -0.02 && n < 0.35 ? c.foam : c.sea;
            break;
          case Biome.Sand:
            p = n < 0.1 ? mixRgb(c.sand, [0, 0, 0], 0.12) : c.sand;
            break;
          case Biome.Forest:
            // Tree crowns: a lit top and a dark gap, in a loose grid.
            p = (x + (y % 3)) % 3 === 0 && n < 0.7 ? c.forestLo : n > 0.75 ? c.forestHi : c.forest;
            break;
          case Biome.Marsh:
            p = hash(Math.floor(x / 2) + Math.floor(y / 2) * 999, 7) > 0.55 ? c.water : n < 0.3 ? c.reed : c.marsh;
            break;
          case Biome.High:
            p = slope > 0.004 ? c.highDark : c.high;
            break;
          case Biome.Rock:
            p = slope < -0.006 ? c.rockHi : slope > 0.006 ? c.rockLo : c.rock;
            break;
          case Biome.Peak:
            p = slope > 0.006 ? c.rock : c.peak;
            break;
          case Biome.Desert:
            // Dunes: long ripples across the sand, their lee sides in shadow.
            p = Math.sin((x * 0.55 + y * 0.25) + hash(Math.floor(x / 9) + Math.floor(y / 9) * 131, 17) * 4) > 0.55 ? c.dune : n < 0.06 ? c.dune : c.desert;
            break;
          case Biome.Scrub:
            p = n < 0.22 ? c.scrubDark : n > 0.93 ? c.desert : c.scrub;
            break;
          case Biome.Lake:
          case Biome.River:
            p = c.fresh;
            break;
          default:
            p = n < 0.18 ? c.grassDark : c.grass;
            if (si === 0 && n > 0.985) p = n > 0.993 ? c.flower : c.flower2;
        }
        const sc = is.scar?.[i] ?? 0;
        if (sc) p = charred(p, bi, sc, n, x, y);
        else if (si === 3 && (bi === Biome.Grass || bi === Biome.High || bi === Biome.Sand || bi === Biome.Scrub) && n > 0.15) p = c.snow;
        img.data[i * 4] = p[0];
        img.data[i * 4 + 1] = p[1];
        img.data[i * 4 + 2] = p[2];
        img.data[i * 4 + 3] = 255;
      }
    }
    b.putImageData(img, 0, 0);
    return cv;
  }

  /** Clears the fog wherever new cells have been seen since last time. */
  protected paintFog(seen: Uint8Array): void {
    const N = this.n;
    if (!this.fog || !this.fogKnown) {
      this.fog = document.createElement('canvas');
      this.fog.width = N;
      this.fog.height = N;
      this.fogKnown = new Uint8Array(this.cells * this.cells);
      const b = this.fog.getContext('2d')!;
      const img = b.createImageData(N, N);
      const f0 = rgb(FOG[0]);
      const f1 = rgb(FOG[1]);
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          const p = hash(Math.floor(x / 6) + Math.floor(y / 6) * 977, 5) > 0.5 ? f1 : f0;
          const i = (y * N + x) * 4;
          img.data[i] = p[0];
          img.data[i + 1] = p[1];
          img.data[i + 2] = p[2];
          img.data[i + 3] = 255;
        }
      }
      b.putImageData(img, 0, 0);
    }
    const known = this.fogKnown;
    const b = this.fog.getContext('2d')!;
    for (let i = 0; i < this.cells * this.cells; i++) {
      if (!seen[i] || known[i]) continue;
      known[i] = 1;
      b.clearRect((i % this.cells) * CELL, Math.floor(i / this.cells) * CELL, CELL, CELL);
      this.fogVersion++;
    }
  }

  /** Copies the part of a world-sized layer that's on screen, scaled to the zoom. */
  protected blitWorld(b: CanvasRenderingContext2D, layer: HTMLCanvasElement): void {
    const tl = this.toWorld(0, 0);
    const br = this.toWorld(this.W, this.H);
    const x0 = Math.max(0, Math.floor(tl.x));
    const y0 = Math.max(0, Math.floor(tl.y));
    const x1 = Math.min(this.n, Math.ceil(br.x));
    const y1 = Math.min(this.n, Math.ceil(br.y));
    if (x1 <= x0 || y1 <= y0) return;
    // (Safari won't draw a source rectangle that reaches outside the image, so it's clipped.)
    b.drawImage(layer, x0, y0, x1 - x0, y1 - y0, this.sx(x0), this.sy(y0), (x1 - x0) * this.zoom, (y1 - y0) * this.zoom);
  }

  // ---- The herd ----

  protected syncHerd(state: GameState, home: Pt): void {
    const st = state.stages.creature;
    const pop = Math.max(1, Math.floor(st.pop));
    const n = visibleCount(pop - 1, 40);
    const want: Partial<Record<Role, number>> = {};
    let given = 0;
    for (const r of ['carer', 'digger', 'guard'] as Role[]) {
      want[r] = st.roles[r] > 0 ? Math.max(1, Math.round((n * st.roles[r]) / pop)) : 0;
      given += want[r]!;
    }
    want.forager = Math.max(0, n - given);
    const fresh = this.members.length === 0;
    for (const r of ['forager', 'carer', 'digger', 'guard'] as Role[]) {
      const have = this.members.filter((m) => m.role === r).length;
      for (let i = have; i < want[r]!; i++) {
        // Newborns appear at the nests; on first sight, everyone's already about.
        let x = home.x;
        let y = home.y;
        for (let tries = 0; tries < 12; tries++) {
          const a = Math.random() * Math.PI * 2;
          const d = fresh ? 1 + Math.random() * 5 : 0.5;
          x = home.x + Math.cos(a) * d;
          y = home.y + Math.sin(a) * d;
          if (isLand(this.island!, x, y)) break;
        }
        this.members.push({ x, y, vx: 0, vy: 0, role: r, phase: Math.random() * 10, flee: 0, base: 0, id: this.memberId++ });
      }
      let extra = have - want[r]!;
      if (extra > 0) this.members = this.members.filter((m) => m.role !== r || extra-- <= 0);
    }
  }

  /** A grassy spot near home for the herd to wander to next (further with a bigger range). */
  /**
   * How far from its nest the herd grazes: close to start with, each Home Range widening it
   * (it takes a herd that can look after itself to range further).
   */
  protected grazeRadius(state: GameState): number {
    return 12 + 2.5 * Math.min(12, state.stages.creature.generators.territory);
  }

  protected pickGraze(is: Island, state: GameState): Pt {
    const range = Math.max(1, this.grazeRadius(state) - 3);
    for (let i = 0; i < 20; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = Math.random() * range;
      const p = { x: is.home.x + Math.cos(a) * d, y: is.home.y + Math.sin(a) * d };
      const b = is.biome[Math.round(p.y) * this.n + Math.round(p.x)];
      if (b === Biome.Grass || b === Biome.High) return p;
    }
    // No grass in reach yet: anywhere dry near home.
    for (let i = 0; i < 20; i++) {
      const a = Math.random() * Math.PI * 2;
      const p = { x: is.home.x + Math.cos(a) * range * Math.random(), y: is.home.y + Math.sin(a) * range * Math.random() };
      if (isLand(is, p.x, p.y)) return p;
    }
    return { ...is.home };
  }

  /** Paths over land between two spots, found once and kept (a breadth-first walk over the map's cells). */
  protected paths = new Map<string, Pt[]>();
  protected landPath(is: Island, from: Pt, to: Pt): Pt[] {
    const cell = (p: Pt) => Math.min(this.cells - 1, Math.max(0, Math.floor(p.y / CELL))) * this.cells + Math.min(this.cells - 1, Math.max(0, Math.floor(p.x / CELL)));
    const a = cell(from);
    const b = cell(to);
    const key = `${a}>${b}`;
    const known = this.paths.get(key);
    if (known) return known.map((p) => ({ ...p }));
    const prev = new Int32Array(this.cells * this.cells).fill(-1);
    const land = (i: number) => isLand(is, (i % this.cells) * CELL + CELL / 2, Math.floor(i / this.cells) * CELL + CELL / 2);
    const queue = [a];
    prev[a] = a;
    for (let h = 0; h < queue.length && prev[b] < 0; h++) {
      const i = queue[h];
      const x = i % this.cells;
      for (const j of [x > 0 ? i - 1 : -1, x < this.cells - 1 ? i + 1 : -1, i - this.cells, i + this.cells]) {
        if (j < 0 || j >= this.cells * this.cells || prev[j] >= 0 || (!land(j) && j !== b)) continue;
        prev[j] = i;
        queue.push(j);
      }
    }
    const out: Pt[] = [];
    if (prev[b] >= 0) {
      for (let i = b, k = 0; i !== a; i = prev[i], k++) if (k % 3 === 0) out.unshift({ x: (i % this.cells) * CELL + CELL / 2, y: Math.floor(i / this.cells) * CELL + CELL / 2 });
    }
    out.push({ ...to });
    this.paths.set(key, out);
    return out.map((p) => ({ ...p }));
  }

  /** The camera and effects, for the island's wild life. */
  /** The cells seen so far (for keeping what's under the fog hidden). */
  protected seenNow: Uint8Array | null = null;

  protected get wildView(): WildView {
    const seen = this.seenNow;
    return { zoom: this.zoom, W: this.W, H: this.H, sx: (x) => this.sx(x), py: (x, y) => this.py(x, y), fx: this.fx, toWorld: (x, y) => this.toWorld(x, y), fogged: seen ? (x, y) => !seen[Math.floor(y / CELL) * this.cells + Math.floor(x / CELL)] : undefined };
  }

  /** A little pink heart rising over a spot (age 0 to about 1). */
  protected heart(b: CanvasRenderingContext2D, x: number, y: number, age: number): void {
    const hx = Math.round(this.sx(x));
    const hy = Math.round(this.py(x, y) - (12 + age * 4) * (this.zoom >= 6 ? 2 : 1));
    b.fillStyle = PAL.p;
    b.fillRect(hx - 1, hy, 1, 1);
    b.fillRect(hx + 1, hy, 1, 1);
    b.fillRect(hx - 1, hy + 1, 3, 1);
    b.fillRect(hx, hy + 2, 1, 1);
  }

  /** The nearest spot within `r` tiles of a point that passes `ok` (sampled, so roughly). */
  protected findSpot(from: Pt, r: number, ok: (x: number, y: number) => boolean): Pt | null {
    let best: Pt | null = null;
    let bd = Infinity;
    for (let i = 0; i < 70; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = Math.sqrt(Math.random()) * r;
      const x = from.x + Math.cos(a) * d;
      const y = from.y + Math.sin(a) * d;
      if (x < 1 || y < 1 || x > this.n - 2 || y > this.n - 2 || !ok(x, y)) continue;
      if (d < bd) {
        bd = d;
        best = { x, y };
      }
    }
    return best;
  }

  /**
   * Herd life: one or two members break off for a moment of their own. The young chase each
   * other round in circles; pairs nuzzle; one lies down in the shade of the trees; one goes
   * down to the water to drink; one strips a ripe bush; and at dusk a sentry climbs to the
   * highest ground near home and stands looking out.
   */
  protected startMoment(is: Island, home: Pt, bases: Pt[], R: number, dayT: number, winter: boolean, season: number): void {
    const free = this.members.filter((m) => !m.act && m.flee <= 0 && m.role !== 'carer' && m.role !== 'digger');
    if (!free.length) return;
    const take = (pref?: Role) => {
      const i = pref ? free.findIndex((m) => m.role === pref) : -1;
      return free.splice(i >= 0 ? i : Math.floor(Math.random() * free.length), 1)[0];
    };
    const dusk = dayT > 0.6 && dayT < 0.74;
    const land = (x: number, y: number) => isLand(is, x, y);
    const bush = this.wild.ripeNear(home, R + 2);
    const choices: [Act['kind'], number][] = [
      ['chase', winter || free.length < 2 ? 0 : 3],
      ['nuzzle', free.length < 2 ? 0 : season === 0 ? 4 : 2],
      ['rest', winter ? 0.5 : 2],
      ['drink', 2],
      ['eat', bush ? 4 : 0],
      ['lookout', dusk ? 6 : 0],
    ];
    let r = Math.random() * choices.reduce((a, [, w]) => a + w, 0);
    const kind = choices.find(([, w]) => (r -= w) < 0)?.[0];
    if (!kind) return;
    if (kind === 'chase' || kind === 'nuzzle') {
      const a = take();
      const c = take();
      const x = (a.x + c.x) / 2;
      const y = (a.y + c.y) / 2;
      const t = kind === 'chase' ? 6 + Math.random() * 3 : 7;
      a.act = { kind, t, x, y, lead: true, mate: c };
      c.act = { kind, t, x, y, lead: false, mate: a };
      return;
    }
    const m = take(kind === 'lookout' ? 'guard' : undefined);
    // Never beyond the grazing range of its own nest.
    const nest = bases[m.base] ?? home;
    const inR = (x: number, y: number) => land(x, y) && Math.hypot(x - nest.x, y - nest.y) <= R + 1.5;
    const near = kind === 'eat' ? this.wild.ripeNear(nest, R + 2) : null;
    let spot: Pt | null = null;
    if (kind === 'rest') {
      // Shade: at the edge of the trees, else anywhere grassy.
      spot = this.findSpot(m, 14, (x, y) => inR(x, y) && is.biome[Math.round(y) * this.n + Math.round(x)] === Biome.Forest) ?? this.findSpot(m, 6, inR);
    } else if (kind === 'drink') {
      spot = this.findSpot(m, 14, (x, y) => inR(x, y) && (!land(x + 1.2, y) || !land(x - 1.2, y) || !land(x, y + 1.2) || !land(x, y - 1.2)));
    } else if (kind === 'eat' && near) {
      spot = { x: near.x + 0.6, y: near.y + 0.2 };
    } else if (kind === 'lookout') {
      let best = -Infinity;
      for (let i = 0; i < 50; i++) {
        const p = this.findSpot(nest, Math.min(12, R), land);
        if (p && is.height[Math.round(p.y) * this.n + Math.round(p.x)] > best) {
          best = is.height[Math.round(p.y) * this.n + Math.round(p.x)];
          spot = p;
        }
      }
    }
    if (!spot) return;
    m.act = { kind, t: kind === 'rest' ? 25 : kind === 'lookout' ? 22 : kind === 'eat' ? 3 : 12, x: spot.x, y: spot.y, bush: kind === 'eat' ? near ?? undefined : undefined };
  }

  protected nestSpots(home: Pt, n: number): Pt[] {
    return Array.from({ length: n }, (_, i) => ({ x: home.x - 1.5 + (i % 3) * 1.5, y: home.y + 0.5 + Math.floor(i / 3) * 1.2 }));
  }

  protected burrowSpots(home: Pt, n: number): Pt[] {
    return Array.from({ length: n }, (_, i) => {
      const a = -0.6 + i * 0.55;
      return { x: home.x + Math.cos(a) * 4, y: home.y - 1 + Math.sin(a) * 3 };
    });
  }

  /** The weather, as the seasons turn: now and then (never in winter) a storm, the ground wet
   * after it, mist in the hollows at dawn, winter's ice. */
  protected stepWeather(dt: number, si: number, next: number, turn: number, dayT: number): void {
    this.stormTimer -= dt;
    // (Never in winter, nor as it's coming on: rain and snow don't come together.)
    if (this.stormTimer <= 0 && !this.stormLeft && si !== 3 && !(next === 3 && turn > 0)) {
      this.stormLeft = 35 + Math.random() * 25;
      this.stormTimer = 200 + Math.random() * 220;
    }
    this.stormLeft = Math.max(0, this.stormLeft - dt);
    this.storm += ((this.stormLeft > 0 ? 1 : 0) - this.storm) * Math.min(1, dt / 5);
    this.wet = this.stormLeft > 0 ? Math.min(1, this.wet + dt / 8) : Math.max(0, this.wet - dt / 70);
    // Rain or snow is the weather while it lasts: no mist with it.
    const snowing = weight3(si, next, turn);
    const mistW = (si === 0 || si === 2 ? 1 : 0.5) * Math.max(0, 1 - Math.abs(dayT - 0.05) / 0.12) * (1 - this.storm) * (1 - snowing);
    if (this.kept) Object.assign(this.kept, { storm: this.storm, left: this.stormLeft, timer: this.stormTimer, wet: this.wet, bow: this.bow });
    this.weather = [this.storm, mistW, weight3(si, next, turn), this.wet];
  }

  /** What's in the air over the view: the seasons' petals, pollen, leaves and snow, a storm's
   * rain and lightning, and the sun breaking through after. */
  protected drawAir(f: Frame, si: number, next: number, turn: number, night: number, dayT: number): void {
    const { b, W, H, t, dt } = f;
    // The air through the year (screen space), easing from one season's to the next: blossom
    // petals in spring, slow pollen motes in summer, falling leaves in autumn, snow in winter.
    const weight = (n: number) => (si === n ? 1 - turn : 0) + (next === n ? turn : 0);
    // Petals, pollen and leaves are small things: from far up only a few are seen (else,
    // zoomed out, they read as snow). Snow is weather, and falls at any height.
    const near = Math.max(0.15, Math.min(1, (this.zoom - 0.6) / 2));
    // While it rains or snows, that's all there is in the air: no petals, pollen or leaves.
    const clear = (1 - this.storm) * (1 - weight(3));
    const mix: [Mote, number][] = [
      ['petal', 16 * weight(0) * near * clear],
      ['pollen', 10 * weight(1) * clear],
      ['leaf', 16 * weight(2) * near * clear],
      ['snow', 45 * weight(3)],
    ];
    const want = Math.round(mix.reduce((a, [, n]) => a + n, 0));
    const pick = (): Mote => {
      let r = Math.random() * Math.max(0.01, want);
      for (const [k, n] of mix) if ((r -= n) < 0) return k;
      return mix[0][0];
    };
    const lift = (q: { x: number; y: number; z: number }) => this.py(q.x, q.y) - q.z * this.zoom;
    // Seasonal bits in the air are a layer over the view (not on the map, so they never look
    // like something to tap), drifting on the wind and sliding a little as the view moves, as
    // the air between you and the land would. Each is drawn as what it is: a tumbling petal,
    // a seed on its fluff, a leaf with its stalk, a snowflake.
    const camDX = (this.camX - this.airCam.x) * this.zoom;
    const camDY = (this.camY - this.airCam.y) * this.zoom * (this.shaded ? this.tilt : 1);
    this.airCam = { x: this.camX, y: this.camY };
    while (this.flakes.length < want) this.flakes.push({ x: Math.random() * W, y: Math.random() * H, z: 0, v: 4 + Math.random() * 6, kind: pick(), ph: Math.random() * 10 });
    this.flakes.length = want;
    for (const q of this.flakes) {
      if (Math.abs(camDX) < W && Math.abs(camDY) < H) {
        q.x -= camDX * 0.3;
        q.y -= camDY * 0.3;
      }
      if (q.kind === 'pollen') {
        // Seed fluff floats on the breeze, bobbing, hardly falling.
        q.x += (3 + Math.sin(t * 0.5 + q.ph) * 2) * dt;
        q.y += Math.sin(t * 1.3 + q.ph) * 2 * dt + 0.6 * dt;
      } else {
        q.y += q.v * (q.kind === 'snow' ? 1 : 0.7) * dt;
        q.x += Math.sin(t * (q.kind === 'snow' ? 1 : 2) + q.ph) * (q.kind === 'snow' ? 3 : 6) * dt + (q.kind === 'snow' ? 0 : 5 * dt);
      }
      if (q.y > H + 4 || q.y < -4 || q.x > W + 4 || q.x < -4) {
        q.kind = pick();
        if (q.x > W + 4) {
          q.x = -3;
          q.y = Math.random() * H;
        } else if (q.x < -4) {
          q.x = W + 3;
          q.y = Math.random() * H;
        } else {
          q.y = q.y < -4 ? H + 3 : -3;
          q.x = Math.random() * W;
        }
      }
      // Fluff is a thing of warm days, not nights.
      if (q.kind === 'pollen' && night > 0.5) continue;
      const turn = Math.floor(t * 3 + q.ph) % 4;
      const px = Math.round(q.x);
      const py = Math.round(q.y);
      switch (q.kind) {
        case 'snow':
          // A little six-armed flake, or a single bright speck far off.
          b.fillStyle = PAL.w;
          if (q.v > 7.5) {
            b.fillRect(px, py - 1, 1, 3);
            b.fillRect(px - 1, py, 3, 1);
          } else b.fillRect(px, py, 1, 1);
          break;
        case 'leaf': {
          // A leaf with its stalk, turning over as it falls.
          b.fillStyle = q.v > 7 ? PAL.o : q.v > 5.5 ? '#c8702e' : PAL.O;
          if (turn % 2) b.fillRect(px, py, 3, 2);
          else b.fillRect(px, py, 2, 3);
          b.fillStyle = '#6a3a1a';
          b.fillRect(turn % 2 ? px + 3 : px + 1, turn % 2 ? py + 1 : py + 3, 1, 1);
          break;
        }
        case 'petal':
          // A petal: a pale tip and a deeper base, flipping.
          b.fillStyle = '#f6c6d8';
          b.fillRect(px, py, turn % 2 ? 2 : 1, 1);
          b.fillStyle = '#e07aa6';
          b.fillRect(turn % 2 ? px + 2 : px, turn % 2 ? py : py + 1, 1, 1);
          break;
        case 'pollen':
          // A seed on its fluff: a soft white puff with a dark seed hanging under it.
          b.fillStyle = 'rgba(250, 248, 236, 0.9)';
          b.fillRect(px - 1, py, 3, 1);
          b.fillRect(px, py - 1, 1, 3);
          b.fillStyle = 'rgba(250, 248, 236, 0.5)';
          b.fillRect(px - 1, py - 1, 1, 1);
          b.fillRect(px + 1, py - 1, 1, 1);
          b.fillStyle = '#5a4a30';
          b.fillRect(px, py + 2, 1, 1);
          break;
      }
    }

    // Rain, lightning, and the rainbow after.
    // Rain falls over the land around the view (twice its size each way), not just what's on
    // screen, so scrolling or zooming out never shows an empty patch of sky.
    const hw = W / this.zoom;
    const hh = H / (this.zoom * (this.shaded ? this.tilt : 1));
    const drop = <Q extends { x: number; y: number; z: number }>(q: Q, z: number): Q => {
      q.x = this.camX + (Math.random() * 2 - 1) * hw;
      q.y = this.camY + (Math.random() * 2 - 1) * hh;
      q.z = z;
      return q;
    };
    const want2 = Math.min(600, Math.round(this.storm * 90 * 4));
    while (this.rain.length < want2) this.rain.push(drop({ x: 0, y: 0, z: 0, v: 20 + Math.random() * 10 }, Math.random() * 14));
    this.rain.length = want2;
    b.fillStyle = 'rgba(190, 210, 230, 0.75)';
    for (const r of this.rain) {
      r.z -= r.v * dt;
      r.x -= r.v * 0.08 * dt;
      if (r.z <= 0 || Math.abs(r.x - this.camX) > hw * 1.2 || Math.abs(r.y - this.camY) > hh * 1.2) drop(r, 8 + Math.random() * 6);
      const X = this.sx(r.x);
      const Y = lift(r);
      if (X > -2 && X < W + 2 && Y > -3 && Y < H + 2) b.fillRect(Math.round(X), Math.round(Y), 1, 2);
    }
    if (this.storm > 0.7 && Math.random() < dt * 0.12) {
      // (Seconds since the flash: it plays out over about a second.)
      this.flash = 0.0001;
      // The thunder after it, from somewhere off across the island.
      thunder({ level: 0.6 + Math.random() * 0.4, delay: 0.4 + Math.random() * 1.6 });
    }
    // Lightning, gently: the sky brightens a little, flickers once more, and fades over a second
    // (never a white-out).
    if (this.flash > 0) {
      const f = this.flash;
      const glow = f < 0.06 ? f / 0.06 : f < 0.14 ? 1 - ((f - 0.06) / 0.08) * 0.6 : f < 0.22 ? 0.4 + ((f - 0.14) / 0.08) * 0.35 : 0.75 * Math.max(0, 1 - (f - 0.22) / 0.85) ** 2;
      b.fillStyle = `rgba(215, 225, 255, ${0.17 * glow})`;
      b.fillRect(0, 0, W, H);
      this.flash = f + dt > 1.1 ? 0 : f + dt;
    }
    // After rain by day, the sun breaks through: soft rays of light across the view and a
    // fresher, brighter day (the shader draws it), easing in as the rain stops and out as the
    // ground dries or evening comes.
    const bowWant = this.stormLeft <= 0 && this.wet > 0.2 && night < 0.2 ? Math.min(1, (this.wet - 0.2) * 3) * Math.max(0, Math.min(1, (0.75 - dayT) * 8)) : 0;
    this.bow += (bowWant - this.bow) * Math.min(1, dt / (bowWant > this.bow ? 8 : 14));
    this.bowView = [0, 0, 0, this.bow];

    // Summer nights: fireflies in the air over everything (a layer over the view, like the
    // seasons' motes, so they never look like something to tap). Each is a little dark body
    // whose tail lights up, glows and goes out, drifting in lazy loops.
    // (Not in the rain.)
    const flyWant = Math.round(14 * weight(1) * Math.max(0, (night - 0.3) / 0.7) * (this.storm < 0.05 && this.stormLeft <= 0 ? 1 : 0));
    while (this.flies.length < flyWant) this.flies.push({ x: Math.random() * W, y: H * 0.2 + Math.random() * H * 0.7, ph: Math.random() * 20 });
    this.flies.length = flyWant;
    for (const f of this.flies) {
      f.x += Math.sin(t * 0.6 + f.ph) * 4 * dt + (Math.abs(camDX) < W ? -camDX * 0.3 : 0);
      f.y += Math.cos(t * 0.5 + f.ph * 1.3) * 3 * dt + (Math.abs(camDY) < H ? -camDY * 0.3 : 0);
      if (f.x < -3) f.x += W + 6;
      if (f.x > W + 3) f.x -= W + 6;
      if (f.y < -3) f.y += H + 6;
      if (f.y > H + 3) f.y -= H + 6;
      const px = Math.round(f.x);
      const py = Math.round(f.y);
      const lit = Math.sin(t * 1.6 + f.ph) > 0.35;
      // Dark between flashes (a firefly in the dark is only its light).
      if (!lit) continue;
      b.fillStyle = 'rgba(214, 240, 120, 0.28)';
      b.fillRect(px - 1, py - 1, 3, 3);
      b.fillStyle = GLOW_LIME;
      b.fillRect(px, py, 1, 1);
      b.fillStyle = '#2a2a1e';
      b.fillRect(px - 1, py, 1, 1);
    }
  }

  /** A creature at the right size for the zoom: a dot from far away, a full sprite up close. */
  protected drawBeing(b: CanvasRenderingContext2D, look: CreatureLook, x: number, y: number, o: { left?: boolean; frame?: number; sleeping?: boolean; hero?: boolean; hop?: number }): void {
    const z = this.zoom;
    const X = this.sx(x);
    const Y = this.py(x, y);
    if (X < -40 || X > this.W + 40 || Y < -40 || Y > this.H + 40) return;
    this.behind(b, x, y, () => {
      if (z < 1.6) {
        b.fillStyle = o.hero ? PAL.y : DIET_DOT[look.diet] ?? PAL.g;
        const s = o.hero ? 2 : 1;
        b.fillRect(Math.round(X), Math.round(Y) - s, s, s);
        return;
      }
      const k = z >= 6 ? 2 : 1;
      // A cute little hop while it moves: up to a couple of pixels, the shadow staying put.
      const opts = { left: o.left, frame: o.frame, sleeping: o.sleeping, scale: k, hop: (o.hop ?? 0) * k };
      drawMini(b, look, X, Y, opts);
    });
  }

  /** The screen row of the highest ground between a point and the camera, if it rises above the
   * point (so whatever stands there is hidden behind it, up to that row); null if nothing's in
   * the way. In 2.5D the land's drawn by the shader, which knows what's behind a ridge, but what
   * stands on the land is drawn over it, and would show through a mountain without this. */
  protected ridgeRow(x: number, y: number): number | null {
    if (!this.shaded || !this.island) return null;
    const foot = this.py(x, y);
    // Ground further toward the camera than this can't rise into the way.
    const span = (this.lift * 1.05) / this.tilt;
    let top = Infinity;
    for (let d = 0.75; d <= span; d += 0.75) {
      const r = this.py(x, y + d);
      if (r < top) top = r;
    }
    return top < foot - 0.5 ? top : null;
  }

  /** Draws something standing at a point, hidden wherever the land in front rises over it. */
  protected behind(b: CanvasRenderingContext2D, x: number, y: number, draw: () => void): void {
    const ridge = this.ridgeRow(x, y);
    if (ridge === null) {
      draw();
      return;
    }
    b.save();
    b.beginPath();
    b.rect(0, 0, this.W, Math.floor(ridge));
    b.clip();
    draw();
    b.restore();
  }

  draw(f: Frame, state: GameState): void {
    const { b, W, H, t, dt } = f;
    this.W = W;
    this.H = H;
    if (!this.viewBottom) this.viewTop = f.top;
    this.stepGlide();
    const is = islandFor(state);
    this.island = is;
    const st = state.stages.creature;
    this.keepWeather(state, 'creature');
    const gens = st.generators;
    const look = creatureLookOf(state);
    const { season } = seasonOf(state);
    const si = ['Spring', 'Summer', 'Autumn', 'Winter'].indexOf(season.name);
    const winter = season.name === 'Winter';
    // Seasons turn gradually: over the last part of each, it blends into the next.
    const { left: seasonLeft } = seasonOf(state);
    const into = 1 - seasonLeft / SEASON_SEC;
    const blend = Math.max(0, Math.min(1, (into - 0.45) / 0.55));
    const turn = blend * blend * (3 - 2 * blend);
    const next = (si + 1) % 4;
    this.seasonBlend = turn;
    this.seasonPair = [si, next];
    // The day goes by the island's own clock (it carries on from where it was after a reload).
    this.dayAt = (st.year % DAY_SEC) / DAY_SEC;
    const dayT = this.dayAt;
    const night = Math.max(0, Math.min(1, (0.125 - Math.abs(dayT - 0.875)) * 40));
    const asleep = night > 0.5;
    const home = is.home;
    const me = st.pos;
    this.lastPos = me;

    // The camera follows your creature until you take it.
    if (this.auto) {
      const k = this.snap ? 1 : Math.min(1, dt * 3);
      // In 2.5D the creature stands raised by the land; aim so it's raised into the middle.
      const ty = this.shaded ? me.y - (this.heightAt(me.x, me.y) * this.lift) / this.tilt : me.y;
      this.camX += (me.x - this.camX) * k;
      this.camY += (ty - this.camY) * k;
      this.snap = false;
    }

    // Ground (painted once a season) and fog (patched as cells are seen).
    if (this.groundSeed !== is.seed) {
      this.ground.clear();
      this.fog = null;
      this.fogKnown = null;
      this.groundSeed = is.seed;
    }
    if (!this.ground.has(si)) this.ground.set(si, this.paintGround(is, si));
    if (!this.ground.has(next)) this.ground.set(next, this.paintGround(is, next));
    this.groundPair = [this.ground.get(si)!, this.ground.get(next)!];
    this.paintFog(st.seen);
    this.seenNow = st.seen;
    b.imageSmoothingEnabled = false;
    if (this.shaded) {
      // The shader draws the land (in 2.5D); this canvas carries only what stands on it.
      b.clearRect(0, 0, W, H);
    } else {
      b.fillStyle = DEEP;
      b.fillRect(0, 0, W, H);
      this.blitWorld(b, this.ground.get(si)!);
      if (turn > 0) {
        b.globalAlpha = turn;
        this.blitWorld(b, this.ground.get(next)!);
        b.globalAlpha = 1;
      }
      // Waves glint on the open sea.
      b.fillStyle = '#4c7f9c';
      for (let i = 0; i < 18; i++) {
        const x = Math.round(((hash(i, 81) * W + t * 3 * (1 + (i % 3))) % (W + 10)) - 5);
        const y = Math.round(hash(i, 83) * H);
        const w = this.toWorld(x, y);
        if (!isLand(is, w.x, w.y)) b.fillRect(x, y, 2, 1);
      }
    }

    // Home: nests (with the egg) and burrow mounds, in tile units.
    const tile = (x: number, y: number, w: number, h: number, col: string) => {
      b.fillStyle = col;
      b.fillRect(Math.round(this.sx(x)), Math.round(this.py(x + w / 2, y)), Math.max(1, Math.round(w * this.zoom)), Math.max(1, Math.round(h * this.zoom * (this.shaded ? this.tilt : 1))));
    };
    const nests = this.nestSpots(home, Math.min(9, Math.max(1, gens.nest)));
    for (const n of nests) {
      tile(n.x - 0.5, n.y - 0.3, 1, 0.5, PAL.S);
      tile(n.x - 0.3, n.y - 0.3, 0.6, 0.2, PAL.Y);
    }
    if (st.egg) {
      const n = nests[0];
      const wob = st.egg.left < 30 ? Math.sin(t * 12) * 0.1 : 0;
      tile(n.x - 0.25 + wob, n.y - 0.8, 0.5, 0.6, PAL.w);
    }
    // Nests founded away from home: a few mounds each.
    const bases = nestPoints(state, true);
    for (const p of bases.slice(1)) {
      for (const n of this.nestSpots(p, 4)) {
        tile(n.x - 0.5, n.y - 0.3, 1, 0.5, PAL.S);
        tile(n.x - 0.3, n.y - 0.3, 0.6, 0.2, PAL.Y);
      }
    }
    const burrows = this.burrowSpots(home, Math.min(10, gens.burrow));
    for (const p of burrows) {
      tile(p.x - 0.7, p.y, 1.4, 0.5, '#7a5a3a');
      tile(p.x - 0.3, p.y, 0.6, 0.5, '#3a2a1a');
    }

    // The Field Guide's places: a "!" once seen, a flag once found.
    for (const pl of STAGES.creature.places!) {
      const p = is.places[pl.id];
      const found = (st.trips[pl.id] ?? 0) > 0;
      if (!found && !st.seen[Math.floor(p.y / CELL) * this.cells + Math.floor(p.x / CELL)]) continue;
      const X = Math.round(this.sx(p.x));
      const Y = Math.round(this.py(p.x, p.y));
      if (X < -10 || X > W + 10 || Y < -10 || Y > H + 10) continue;
      if (found) {
        b.fillStyle = PAL.k;
        b.fillRect(X, Y - 7, 1, 7);
        b.fillStyle = PAL.y;
        b.fillRect(X + 1, Y - 7, 3, 2);
      } else if (Math.floor(t * 2) % 2) {
        b.fillStyle = PAL.k;
        b.fillRect(X - 1, Y - 10, 3, 6);
        b.fillRect(X - 1, Y - 3, 3, 2);
        b.fillStyle = PAL.y;
        b.fillRect(X, Y - 9, 1, 4);
        b.fillRect(X, Y - 2, 1, 1);
      }
    }

    // Where it's walking: footprints out to the target, and an X there.
    if (st.walk) {
      const d = Math.hypot(st.walk.tx - me.x, st.walk.ty - me.y);
      const step = 3 / this.zoom;
      b.fillStyle = PAL.w;
      for (let k = step * 2; k < d; k += step * 2) {
        const fx = me.x + ((st.walk.tx - me.x) * k) / d;
        const fy = me.y + ((st.walk.ty - me.y) * k) / d;
        b.fillRect(Math.round(this.sx(fx)), Math.round(this.py(fx, fy)), 1, 1);
      }
      const X = Math.round(this.sx(st.walk.tx));
      const Y = Math.round(this.py(st.walk.tx, st.walk.ty));
      b.fillStyle = PAL.o;
      for (let k = -2; k <= 2; k++) {
        b.fillRect(X + k, Y + k, 1, 1);
        b.fillRect(X + k, Y - k, 1, 1);
      }
    }

    // ---- Everyone who moves, sorted by depth. ----
    const sprites: { y: number; draw: () => void }[] = [];
    this.syncHerd(state, home);
    this.grazeTimer -= dt;
    if (!this.graze || this.grazeTimer <= 0) {
      this.graze = this.pickGraze(is, state);
      this.grazeTimer = 20 + Math.random() * 15;
    }
    // Weather. Now and then (never in winter) a storm rolls in: the sky greys, rain lashes
    // down, lightning flickers, and the herd huddles at home. After, the ground stays wet a
    // while, with puddles, and if the sun's up, a rainbow. Mist lies in the hollows at dawn;
    // in winter the shallows freeze.
    this.stepWeather(dt, si, next, turn, dayT);
    const huddle = asleep || winter || this.storm > 0.4;
    const center = huddle ? home : this.graze;
    // Room enough that, zoomed right in, you can pick out each one and see what it's up to.
    const grazeR = this.grazeRadius(state);
    const spread = Math.min(grazeR, (huddle ? 1.5 : 3) + Math.sqrt(this.members.length) * (huddle ? 0.9 : 1.8));
    const gap = huddle ? 1.6 : 2.4;
    const bt = this.beast && !this.beast.fleeing ? this.beast : null;
    // With nests away from home, the herd spreads between them (foragers only; the rest keep
    // to home), and now and then one sets off to live at another, walking the trail between.
    // With nests away from home, the herd is shared out between them (foragers only; the rest
    // keep to home), each member for good. Moving to a new nest, they walk there over land
    // (that walk is the settling); at a settled nest they simply live there, even seen afresh.
    if (bases.length > 1) {
      this.members.forEach((m) => {
        const want = m.role === 'forager' ? m.id % bases.length : 0;
        if (m.base === want && m.placed) return;
        const to = bases[want];
        const nest = want > 0 ? st.nests[want - 1] : null;
        const progress = nest ? nestProgress(state, nest) : 1;
        if (!m.placed && progress >= 1) {
          m.x = to.x + (hash(m.id, 3) - 0.5) * 6;
          m.y = to.y + (hash(m.id, 5) - 0.5) * 4;
          m.path = undefined;
        } else if (Math.hypot(m.x - to.x, m.y - to.y) > 8) {
          const path = this.landPath(is, m, to);
          // Seen partway through a move (after a reload): already partway along.
          if (!m.placed && progress > 0) {
            const k = Math.min(path.length - 1, Math.floor(path.length * progress));
            if (k > 0) {
              m.x = path[k - 1].x;
              m.y = path[k - 1].y;
              path.splice(0, k);
            }
          }
          m.path = path;
        }
        m.base = want;
        m.placed = true;
      });
    }
    // Herd life: every so often one or two of them break off to do something of their own.
    this.momentTimer -= dt;
    if (asleep || bt || this.storm > 0.4) for (const m of this.members) m.act = undefined;
    else if (this.momentTimer <= 0) {
      this.momentTimer = 4 + Math.random() * 6;
      this.startMoment(is, home, bases, grazeR, dayT, winter, si);
    }
    let hopping = 0;
    let hopX = 0;
    this.members.forEach((m, i) => {
      // Where instinct takes each one (around its own nest, if it lives away from home).
      const c = m.base > 0 && bases[m.base] ? bases[m.base] : center;
      const far = c !== center;
      let gx = c.x + Math.cos(i * 2.4 + m.phase) * spread * (far ? 0.7 : 1) * (0.4 + hash(i, 61) * 0.6);
      let gy = c.y + Math.sin(i * 2.4 + m.phase) * spread * (far ? 0.7 : 1) * (0.4 + hash(i, 61) * 0.6);
      if (!asleep) {
        if (m.role === 'carer') {
          const n = nests[i % nests.length];
          gx = n.x + Math.sin(t * 0.3 + m.phase) * 0.8;
          gy = n.y + 0.8;
        } else if (m.role === 'digger' && burrows.length) {
          const p = burrows[i % burrows.length];
          gx = p.x + 1;
          gy = p.y + 0.6;
        } else if (m.role === 'guard') {
          // Sentries ring the herd, a little way out; at a beast, they charge.
          const a = (i * 2.4) % (Math.PI * 2);
          gx = center.x + Math.cos(a) * (spread + 2.5);
          gy = center.y + Math.sin(a) * (spread + 2.5);
          if (bt) {
            gx = bt.x;
            gy = bt.y + 0.4;
          }
        } else {
          gx += Math.sin(t * 0.17 + m.phase * 3);
          gy += Math.cos(t * 0.13 + m.phase * 2) * 0.6;
        }
      }
      // Its own moment, if it's in one.
      const act = m.path?.length ? undefined : m.act;
      let fast = false;
      // On its way to live at another nest: follow the way over land.
      const travel = m.path?.length ? m.path : null;
      if (travel) {
        if (Math.hypot(travel[0].x - m.x, travel[0].y - m.y) < 1.5) travel.shift();
        if (travel.length) {
          gx = travel[0].x;
          gy = travel[0].y;
          fast = true;
        }
      }
      if (act) {
        act.t -= dt;
        const there = Math.hypot(act.x - m.x, act.y - m.y) < 0.4;
        // Eating starts the clock only once it's at the bush.
        if (act.kind === 'eat' && !there && Math.hypot(m.vx, m.vy) > 0.05) act.t = Math.max(act.t, 3);
        if (act.t <= 0) {
          if (act.kind === 'eat' && act.bush) this.wild.eat(this.wildView, act.bush);
          m.act = undefined;
        } else if (act.kind === 'chase') {
          fast = true;
          if (act.lead) {
            gx = act.x + Math.cos(t * 1.8 + m.phase) * 3.5;
            gy = act.y + Math.sin(t * 1.8 + m.phase) * 2.4;
          } else if (act.mate) {
            gx = act.mate.x;
            gy = act.mate.y;
          }
        } else if (act.kind === 'nuzzle') {
          gx = act.x + (act.lead ? -1.1 : 1.1);
          gy = act.y;
        } else {
          gx = act.x;
          gy = act.y;
        }
      }
      // Within the grazing range of its nest (unless running for its life).
      const own = bases[m.base] ?? home;
      const out = Math.hypot(gx - own.x, gy - own.y);
      if (out > grazeR + 1 && !(m.act?.kind === 'chase') && !travel) {
        gx = own.x + ((gx - own.x) / out) * grazeR;
        gy = own.y + ((gy - own.y) / out) * grazeR;
      }
      // Never aim for the sea: a spot out over the water is pulled back toward its nest, so
      // nobody piles up at the shore.
      for (let k = 0; k < 6 && !isLand(is, gx, gy); k++) {
        gx = (gx + c.x) / 2;
        gy = (gy + c.y) / 2;
      }
      // A beast close by: run from it (sentries excepted).
      if (bt && m.role !== 'guard' && Math.hypot(bt.x - m.x, bt.y - m.y) < 6) m.flee = 2;
      m.flee = Math.max(0, m.flee - dt);
      if (m.flee > 0 && bt) {
        const d = Math.hypot(m.x - bt.x, m.y - bt.y) || 1;
        gx = m.x + ((m.x - bt.x) / d) * 6;
        gy = m.y + ((m.y - bt.y) / d) * 6;
      }
      // Keep a body's width apart (unless busy with another).
      for (const o of this.members) {
        if (o === m || m.act) continue;
        const ox = m.x - o.x;
        const oy = m.y - o.y;
        const od = Math.hypot(ox, oy);
        if (od > 0 && od < gap) {
          gx += (ox / od) * (gap - od) * 3;
          gy += (oy / od) * (gap - od) * 3;
        }
      }
      const dx = gx - m.x;
      const dy = gy - m.y;
      const d = Math.hypot(dx, dy);
      const sp = (m.flee > 0 || (m.role === 'guard' && bt) ? 3 : fast ? 2.2 : HERD_WALK) * (d > 0.2 ? 1 : 0);
      m.vx += ((d ? (dx / d) * Math.min(sp, d * 2) : 0) - m.vx) * Math.min(1, dt * 3);
      m.vy += ((d ? (dy / d) * Math.min(sp, d * 2) : 0) - m.vy) * Math.min(1, dt * 3);
      const nx = m.x + m.vx * dt;
      const ny = m.y + m.vy * dt;
      // Never into the sea (but one that's somehow in it can always walk out).
      if (isLand(is, nx, ny) || !isLand(is, m.x, m.y)) {
        m.x = nx;
        m.y = ny;
      }
      if (m.role === 'guard' && bt && bt.flinch <= 0 && Math.hypot(bt.x - m.x, bt.y - m.y) < 1.5 && Math.random() < dt * 1.2) this.hitBeast(state, bt);
      const moving = Math.hypot(m.vx, m.vy) > 0.15;
      if (moving) {
        const sx = this.sx(m.x);
        const sy = this.py(m.x, m.y);
        if (sx > 0 && sx < W && sy > this.viewTop && sy < (this.viewBottom || H)) {
          hopping++;
          hopX += sx;
        }
      }
      const a = m.act;
      const settled = !!a && !moving && Math.hypot(a.x - m.x, a.y - m.y) < 0.8;
      // Facing: each other when nuzzling, out from home on lookout, else the way it goes.
      const left = a?.kind === 'nuzzle' && settled ? !a.lead : a?.kind === 'lookout' && settled ? a.x < home.x : moving ? m.vx < 0 : m.role === 'guard' ? m.x < center.x : Math.sin(m.phase * 3) < 0;
      const x = m.x;
      const y = m.y;
      // Playing, it bounds; heads go down and up drinking or eating; resting, it lies down.
      const hop = moving ? Math.abs(Math.sin(t * (a?.kind === 'chase' ? 11 : 7) + m.phase * 3)) * (a?.kind === 'chase' ? 3 : 2) : 0;
      const bob = settled && (a.kind === 'drink' || a.kind === 'eat') ? Math.floor(t * 2.5 + m.phase) % 2 : 0;
      const lying = asleep || (settled && a.kind === 'rest');
      const hearts = settled && a.kind === 'nuzzle' && a.lead && this.zoom >= 1.6;
      sprites.push({
        y,
        draw: () => {
          this.drawBeing(b, look, x, y, { left, frame: moving ? Math.floor(t * 8 + m.phase) % 2 : bob, sleeping: lying, hop });
          if (hearts && (t + m.phase) % 2 < 1.2) this.heart(b, x + 0.5, y, (t + m.phase) % 2);
        },
      });
    });

    // Hopping about, they squeak: more often the more of them are on the move, heard only up
    // close (half volume fully zoomed in, fading fast as the view pulls back). Your own creature
    // too, on the way somewhere (and the mates trotting after it).
    if (st.walk && !st.walk.event) {
      const hx = this.sx(me.x);
      const hy = this.py(me.x, me.y);
      if (hx > 0 && hx < W && hy > this.viewTop && hy < (this.viewBottom || H)) {
        hopping += 1 + st.mates.length;
        hopX += hx * (1 + st.mates.length);
      }
    }
    herdInView(hopping > 0);
    if (hopping) {
      this.squeakIn -= dt * Math.min(3, 0.6 + hopping * 0.35);
      if (this.squeakIn <= 0) {
        this.squeakIn = 0.5 + Math.random() * 1.4;
        const near = Math.max(0, (this.zoom - 2.5) / (ZOOM_MAX - 2.5));
        squeak(0.5 * near ** 1.8, (hopX / hopping / W) * 2 - 1);
      }
    }

    // A beast slinks in now and then and stalks the nearest of the herd.
    this.beastTimer -= dt;
    if (!this.beast && this.beastTimer <= 0 && !asleep) {
      const a = Math.random() * Math.PI * 2;
      const x = home.x + Math.cos(a) * 14;
      const y = home.y + Math.sin(a) * 14;
      if (isLand(is, x, y)) this.beast = { x, y, hits: 0, flinch: 0, fleeing: false, life: 30, left: false };
      this.beastTimer = 60 + Math.random() * 45;
    }
    const beast = this.beast;
    if (beast) {
      beast.life -= dt;
      beast.flinch = Math.max(0, beast.flinch - dt);
      if (beast.life <= 0) beast.fleeing = true;
      let tx = home.x;
      let ty = home.y;
      if (beast.fleeing) {
        tx = beast.x + (beast.x - home.x) * 4;
        ty = beast.y + (beast.y - home.y) * 4;
      } else if (this.members.length) {
        const prey = this.members.reduce((a, m) => (Math.hypot(m.x - beast.x, m.y - beast.y) < Math.hypot(a.x - beast.x, a.y - beast.y) ? m : a));
        tx = prey.x;
        ty = prey.y;
      }
      const d = Math.hypot(tx - beast.x, ty - beast.y) || 1;
      const sp = beast.fleeing ? 4 : beast.flinch > 0 ? 0 : 0.9;
      beast.x += ((tx - beast.x) / d) * sp * dt;
      beast.y += ((ty - beast.y) / d) * sp * dt;
      if (Math.abs(tx - beast.x) > 0.2) beast.left = tx < beast.x;
      const bx = beast.x;
      const by = beast.y;
      sprites.push({
        y: by,
        draw: () => {
          const X = this.sx(bx);
          const Y = this.py(bx, by);
          const z = Math.max(0.5, this.zoom / 3);
          const dir = beast.left ? -1 : 1;
          const wob = beast.flinch > 0 ? 1.3 : 1;
          drawBlob(b, [{ x: X, y: Y - 5 * z, r: 4.5 * z * wob, nucleus: false }, { x: X + dir * 5 * z, y: Y - 7 * z, r: 2.8 * z, nucleus: false }], beast.flinch > 0 ? BEAST_FLINCH : BEAST_STYLE);
          b.fillStyle = GLOW_Y;
          b.fillRect(Math.round(X + dir * 6 * z), Math.round(Y - 8 * z), 1, 1);
          if (!beast.fleeing && beast.hits > 0) {
            b.fillStyle = PAL.w;
            for (let i = 0; i < beast.hits; i++) b.fillRect(Math.round(X - 2 + i * 2), Math.round(Y - 13 * z), 1, 1);
          }
        },
      });
      if (beast.fleeing && Math.hypot(bx - home.x, by - home.y) > 30) this.beast = null;
    }

    // A visitor: one of your kind from elsewhere, in a different coat. Tap it to court it.
    this.visitorTimer -= dt;
    if (!this.visitor && this.visitorTimer <= 0 && st.mates.length < 3 && !asleep) {
      const parts = { ...look.parts };
      const pool = st.parts.concat(['shell', 'sail', 'runner']);
      for (const slot of ['back', 'tail', 'legs'] as const) {
        const opts = pool.filter((id) => STAGES.creature.parts!.find((p) => p.id === id)?.slot === slot);
        if (opts.length) parts[slot] = opts[Math.floor(Math.random() * opts.length)];
      }
      const a = Math.random() * Math.PI * 2;
      const g = this.pickGraze(is, state);
      this.visitor = { x: home.x + Math.cos(a) * 16, y: home.y + Math.sin(a) * 16, tx: g.x, ty: g.y, life: 40, look: { parts, diet: look.diet === 'grazer' ? 'omnivore' : look.diet === 'hunter' ? 'grazer' : 'hunter' } };
      this.visitorTimer = 90 + Math.random() * 60;
    }
    const v = this.visitor;
    if (v) {
      v.life -= dt;
      if (v.life <= 0) {
        v.tx = v.x + (v.x - home.x) * 3;
        v.ty = v.y + (v.y - home.y) * 3;
      }
      const d = Math.hypot(v.tx - v.x, v.ty - v.y);
      const k = d > 0.2 ? Math.min(d, dt) / d : 0;
      const left = v.tx < v.x;
      v.x += (v.tx - v.x) * k;
      v.y += (v.ty - v.y) * k;
      const vx = v.x;
      const vy = v.y;
      sprites.push({
        y: vy,
        draw: () => {
          this.drawBeing(b, v.look, vx, vy, { left, frame: d > 0.2 ? Math.floor(t * 7) % 2 : 0, hop: d > 0.2 ? Math.abs(Math.sin(t * 6)) * 2 : 0 });
          // A little heart over it, so it reads as "come say hello".
          if (Math.floor(t * 2) % 2 && this.zoom >= 1.6) {
            b.fillStyle = PAL.p;
            const hx = Math.round(this.sx(vx));
            const hy = Math.round(this.py(vx, vy) - 14 * (this.zoom >= 6 ? 2 : 1));
            b.fillRect(hx - 2, hy, 2, 1);
            b.fillRect(hx + 1, hy, 2, 1);
            b.fillRect(hx - 2, hy + 1, 5, 1);
            b.fillRect(hx - 1, hy + 2, 3, 1);
            b.fillRect(hx, hy + 3, 1, 1);
          }
        },
      });
      if (v.life <= 0 && Math.hypot(v.x - home.x, v.y - home.y) > 30) this.visitor = null;
    }

    // Your creature, wherever it is on the island, with its mates trailing behind.
    // Foraging parties: two of the herd trot out to a found place and back, the food they
    // carry bobbing over them on the way home. A puff at home when they drop it off.
    for (const party of st.parties) {
      const leg = partyLeg(state, party.place);
      const q = is.places[party.place];
      if (!q) continue;
      const nest = nearestNest(state, party.place);
      const back = party.t > leg;
      const k = Math.min(1, back ? 2 - party.t / leg : party.t / leg);
      const px = nest.x + (q.x - nest.x) * k;
      const py = nest.y + (q.y - nest.y) * k;
      const pleft = (q.x < nest.x) !== back;
      const ux = (q.x - nest.x) / (Math.hypot(q.x - nest.x, q.y - nest.y) || 1);
      const uy = (q.y - nest.y) / (Math.hypot(q.x - nest.x, q.y - nest.y) || 1);
      for (let j = 0; j < 2; j++) {
        const lag = (back ? 1.4 : -1.4) * j;
        const x = px - ux * lag + (j ? 0.5 : 0);
        const y = py - uy * lag;
        sprites.push({
          y,
          draw: () => {
            this.drawBeing(b, look, x, y, { left: pleft, frame: Math.floor(t * 8 + j) % 2, hop: Math.abs(Math.sin(t * 7 + j * 1.7)) * 2 });
            if (back && this.zoom >= 1.6) {
              b.fillStyle = j ? PAL.o : PAL.g;
              b.fillRect(Math.round(this.sx(x)), Math.round(this.py(x, y)) - (this.zoom >= 6 ? 22 : 12) - Math.round(Math.abs(Math.sin(t * 7 + j)) * 1), 2, 2);
            }
          },
        });
      }
    }
    // A settled place has grown back and given: a little puff over its flag, and what it gave
    // (when it's in view).
    if ((st.foraged ?? 0) > this.foragedSeen && st.lastForagePlace && is.places[st.lastForagePlace]) {
      const p = is.places[st.lastForagePlace];
      const X = Math.round(this.sx(p.x));
      const Y = Math.round(this.py(p.x, p.y)) - 6;
      if (X > 0 && X < W && Y > 0 && Y < H) {
        this.fx.pulse(X, Y, PAL.y);
        this.events.push({ type: 'forage', party: false, x: X, y: Y - 6 });
      }
    }
    this.foragedSeen = st.foraged ?? 0;
    if ((st.partiesHome ?? 0) > this.partiesSeen) {
      const n = this.lastPartyNest ?? home;
      this.events.push({ type: 'forage', party: true, x: Math.round(this.sx(n.x)), y: Math.round(this.py(n.x, n.y)) - 14 });
    }
    this.partiesSeen = st.partiesHome ?? 0;
    const nowOut = new Set(st.parties.map((p) => p.place));
    for (const was of this.partiesOut) {
      if (nowOut.has(was)) continue;
      const n = is.places[was] ? nearestNest(state, was) : home;
      this.lastPartyNest = n;
      this.fx.pulse(Math.round(this.sx(n.x)), Math.round(this.py(n.x, n.y)), PAL.g);
    }
    this.partiesOut = nowOut;

    const walking = !!st.walk && !st.walk.event;
    const left = st.walk ? st.walk.tx < me.x : false;
    sprites.push({
      y: me.y,
      draw: () => {
        st.mates.forEach((mate, k) => {
          const ox = me.x + (left ? 1.6 : -1.6) * (k + 1);
          this.drawBeing(b, { ...look, parts: { ...look.parts, ...mate.parts } }, ox, me.y + 0.3 * (k + 1), { left, frame: walking ? Math.floor(t * 8 + k) % 2 : 0, hop: walking ? Math.abs(Math.sin(t * 7 + k * 1.3)) * 2 : 0 });
        });
        this.drawBeing(b, look, me.x, me.y, { left, frame: walking ? Math.floor(t * 8) % 2 : 0, hero: true, hop: walking ? Math.abs(Math.sin(t * 7)) * 2 : 0 });
        // A blinking "!" when something's stopped it on the road.
        const X = Math.round(this.sx(me.x));
        const Y = Math.round(this.py(me.x, me.y)) - (this.zoom >= 6 ? 26 : this.zoom >= 1.6 ? 14 : 5);
        if (st.walk?.event) {
          if (Math.floor(t * 3) % 2) {
            b.fillStyle = PAL.o;
            b.fillRect(X, Y - 5, 1, 3);
            b.fillRect(X, Y - 1, 1, 1);
          }
        }
      },
    });

    // Paths wear in where feet go (your creature, the herd on the move, parties).
    const walkers: Pt[] = this.members.filter((m) => Math.hypot(m.vx, m.vy) > 0.15);
    if (st.walk && !st.walk.event) walkers.push(me);
    this.trails.update(is.seed, walkers, dt);

    // The island's own life: bushes, crabs, birds, fish, the wild grazers.
    this.wild.update(this.wildView, is, sprites, { b, t, dt, nests: bases, season: si, night, feet: [me, ...this.members], me });
    this.sightings.update(this.wildView, is, sprites, { b, t, dt, night, winter });

    sprites.sort((a, c) => a.y - c.y);
    // (Each hidden behind any ridge between it and the camera.)
    for (const s of sprites as Sprite[]) if (s.at) this.behind(b, s.at.x, s.at.y, s.draw);
    else s.draw();

    // The fog, over everything on the ground (the shader draws its own, softer).
    if (!this.shaded) this.blitWorld(b, this.fog!);

    // Night falls over everything; in summer, fireflies around home.
    if (night > 0) {
      if (!this.shaded) {
        b.fillStyle = `rgba(16, 24, 56, ${0.5 * night})`;
        b.fillRect(0, 0, W, H);
      }
    }
    this.drawAir(f, si, next, turn, night, dayT);
    this.fx.run(f);
  }
}
