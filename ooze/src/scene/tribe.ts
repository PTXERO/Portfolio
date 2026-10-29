// The Extinction's map: the island after the strike. The same 2.5D, lit land as the
// Creature's (this builds on its scene), all of it burnt grey and black and still smouldering,
// fissures torn out from the spear, which stands in a small lake at the island's heart. The
// survivors huddle at the old home; one of them (the one you were) walks out to the spear, and
// when you touch it they wake. After that they go about the ash on their own.

import { PAL } from '../art/sprites';
import { SEASON_SEC } from '../economy/rates';
import { Biome, CELLS, ISLAND, isLand, islandOf, type Island, type Pt } from '../economy/island';
import { BURNT, LAKE, ashenFor, tribeOf } from '../economy/tribal';
import { DAY_SEC as EX_DAY, RAFT, raftPart, WINTER, type ExtinctionState, type JobId } from '../economy/extinction';
import type { SpellId } from '../economy/miracles';
import { crisisAt } from '../economy/crises';
import type { GameState } from '../economy/types';
import { hash, type Frame } from './paint';
import { RangeScene } from './range';

interface Person {
  x: number;
  y: number;
  vx: number;
  vy: number;
  ph: number;
  /** Where it's headed next, and seconds before it picks somewhere else. */
  goal: Pt | null;
  wait: number;
  /** When the waking reached it (scene seconds; -1 not yet). */
  lit: number;
}

/** Every cell seen: there is no fog on what's left (they know every step of it). */
const ALL_SEEN = new Uint8Array(CELLS * CELLS).fill(1);
const DAY_SEC = 120;
/** How long the fire takes to run over the island after the strike (seconds). */
const BURN_SEC = 9;
/** How fast the waking spreads back over the ash to the others (tiles a second, at the least),
 * and how long it takes to reach the camp however far it is. */
const SPREAD_SPEED = 9;
const SPREAD_SEC = 4;
/** How fast the spear turns in its pool. */
const SPIN = 1.2;

/** How deep the ash winter is on a given (fractional) day: rising over the three days before it,
 * full through it, lifting over the four after. */
function ashWinter(day: number): number {
  const [a, b] = WINTER;
  const up = Math.max(0, Math.min(1, (day - (a - 3)) / 3));
  const down = Math.max(0, Math.min(1, (b + 3 - day) / 4));
  const k = Math.min(up, down);
  return k * k * (3 - 2 * k);
}

/** Where each kind of work is done on the island (tiles), found once per island. */
interface Spot {
  job: JobId;
  x: number;
  y: number;
}

/** Work places round the camp: carcasses (or fallen fruit) and patches of ash to forage or dig
 * near by, charred trees, the shore for fishing (or kelp), and the beach the raft is built on. */
function spotsFor(is: Island, camp: Pt, spear: Pt): { spots: Spot[]; raft: Pt } {
  const out: Spot[] = [];
  const shore: Pt[] = [];
  const trees: Pt[] = [];
  const ground: Pt[] = [];
  const R = 34;
  for (let y = Math.max(1, Math.floor(camp.y - R)); y < Math.min(ISLAND - 1, camp.y + R); y++) {
    for (let x = Math.max(1, Math.floor(camp.x - R)); x < Math.min(ISLAND - 1, camp.x + R); x++) {
      const d = Math.hypot(x - camp.x, y - camp.y);
      if (d > R || d < 5 || !isLand(is, x, y) || Math.hypot(x - spear.x, y - spear.y) < LAKE + 4) continue;
      const wet = !isLand(is, x + 1, y) || !isLand(is, x - 1, y) || !isLand(is, x, y + 1) || !isLand(is, x, y - 1);
      if (wet) shore.push({ x: x + 0.5, y: y + 0.5 });
      else if (is.biome[y * ISLAND + x] === Biome.Forest) trees.push({ x: x + 0.5, y: y + 0.5 });
      else ground.push({ x: x + 0.5, y: y + 0.5 });
    }
  }
  /** A few of them, spread apart, picked the same way every time. */
  const pick = (from: Pt[], n: number, gap: number, salt: number): Pt[] => {
    const got: Pt[] = [];
    const sorted = [...from].sort((a, b) => hash(Math.floor(a.x) * 7 + Math.floor(a.y) * 131, salt) - hash(Math.floor(b.x) * 7 + Math.floor(b.y) * 131, salt));
    for (const p of sorted) {
      if (got.length >= n) break;
      if (got.every((g) => Math.hypot(g.x - p.x, g.y - p.y) > gap)) got.push(p);
    }
    return got;
  };
  const near = (p: Pt) => Math.hypot(p.x - camp.x, p.y - camp.y);
  const beach = [...shore].sort((a, b) => near(a) - near(b));
  const raft = beach[0] ?? { x: camp.x + 3, y: camp.y + 3 };
  for (const p of pick(shore.filter((q) => Math.hypot(q.x - raft.x, q.y - raft.y) > 5), 6, 5, 21)) out.push({ job: 'fish', ...p });
  for (const p of pick(trees.length > 6 ? trees : ground, 8, 4, 23)) out.push({ job: 'wood', ...p });
  for (const p of pick(ground, 8, 4, 25)) out.push({ job: 'scavenge', ...p });
  for (const p of pick(ground, 6, 5, 27)) out.push({ job: 'forage', ...p });
  for (const p of pick(ground, 5, 5, 29)) out.push({ job: 'dig', ...p });
  out.push({ job: 'build', ...raft });
  out.push({ job: 'listen', x: spear.x, y: spear.y + LAKE + 1.5 });
  return { spots: out, raft };
}

export class TribeScene extends RangeScene {
  /** Work places on the island, and where the raft is built. */
  private spots: Spot[] = [];
  private raftAt: Pt | null = null;
  private spotSeed = -1;
  /** Piles a miracle left (fish, kelp, fruit, a fallen beast): the tribe goes to them. */
  private piles: (Spot & { kind: 'fish' | 'kelp' | 'fruit' | 'beast' | 'green'; until: number })[] = [];
  /** Miracles playing out on the map (seconds since cast, and where, in tiles). */
  private wonders: { id: SpellId; age: number; pts: Pt[] }[] = [];
  /** The stroke being drawn to cast one (art pixels), shown as it's drawn. */
  private stroke: Pt[] = [];
  private strokeFade = 0;
  private people: Person[] = [];
  /** The one that walks to the spear: where it is, and whether it's got there. */
  private walker: Pt | null = null;
  arrived = false;
  /** Holds the walk (while the strike is still playing over it). */
  hold = false;
  /** The shockwave when they wake: seconds since it went out (-1 when there isn't one). */
  private wave = -1;
  private smoke: { x: number; y: number; z: number; life: number }[] = [];
  private placed = false;
  /** The camera handed on from the Creature's map at the strike. */
  private handed: { x: number; y: number; z: number } | null = null;
  /** The burning after the strike: when it started (scene seconds), whether it's over, and the
   * ground it's painting (green and ash, and the order each cell catches). */
  private burnAt = -1;
  private burnReach = 1;
  private burnDone = false;
  private burn: { cv: HTMLCanvasElement; img: ImageData; green: Uint8ClampedArray; ash: Uint8ClampedArray; order: Float32Array; v: number; season: number } | null = null;
  /** When the strike let go of the walk (scene seconds). */
  private released = -1;
  /** The waking spreading to the others: when it set out (scene seconds), or asked for. */
  private spreadAt = -1;
  private spreadPending = false;
  /** Woken before this scene was opened (a reload): everyone's already lit. */
  private allLit = false;
  private firstLook = true;
  private seedSeen = -1;

  reset(): void {
    super.reset();
    this.people = [];
    this.walker = null;
    this.arrived = false;
    this.piles = [];
    this.landSeed = -1;
    this.wonders = [];
    this.stroke = [];
    this.handed = null;
    this.burnAt = -1;
    this.burnDone = false;
    this.burn = null;
    this.released = -1;
    this.spreadAt = -1;
    this.spreadPending = false;
    this.allLit = false;
    this.firstLook = true;
    this.placed = false;
    this.auto = false;
  }

  tap(state: GameState, ax: number, ay: number): void {
    const t = tribeOf(state);
    if (!t || !this.island) return;
    const { spear } = ashenFor(state);
    // The spear: once the walker has reached it, touching it is how they wake.
    const X = this.sx(spear.x);
    const Y = this.py(spear.x, spear.y);
    const tall = this.spearHeight();
    if (!t.awake && this.arrived && Math.abs(ax - X) < Math.max(8, tall * 0.25) && ay > Y - tall - 4 && ay < Y + 4) {
      this.events.push({ type: 'spear', x: X, y: Y - tall });
      this.wave = 0;
      return;
    }
    // After the waking: a tap on one of them says who they are.
    if (!t.ex) return;
    let best = -1;
    let d0 = Math.max(6, this.zoom * 2);
    this.people.forEach((p, i) => {
      const X = this.sx(p.x);
      const Y = this.py(p.x, p.y) - Math.max(2, this.zoom);
      const d = Math.hypot(X - ax, Y - ay);
      if (d < d0) {
        d0 = d;
        best = i;
      }
    });
    if (best >= 0) {
      const p = this.people[best];
      this.events.push({ type: 'person', i: best, x: this.sx(p.x), y: this.py(p.x, p.y) - Math.max(8, this.zoom * 3) });
    }
  }

  /** Where a crisis happens (tiles), found from what's on the island. */
  crisisPlace(kind: import('../economy/crises').CrisisKind, ex: ExtinctionState): { x: number; y: number; who?: number; toX?: number; toY?: number } {
    const is = this.island!;
    const camp = this.spots.find((q) => q.job === 'build') ?? { x: 0, y: 0 };
    const spot = (job: JobId) => this.spots.find((q) => q.job === job && this.spotShown(ex, q)) ?? this.spots.find((q) => q.job === job) ?? camp;
    const landNear = (c: Pt, r0: number, r1: number, salt: number): Pt => {
      for (let k = 0; k < 80; k++) {
        const a = hash(k, salt + ex.day) * Math.PI * 2;
        const r = r0 + hash(k, salt + 1 + ex.day) * (r1 - r0);
        const p = { x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r };
        if (isLand(is, p.x, p.y)) return p;
      }
      return { ...c };
    };
    if (kind === 'trapped') {
      const n = Math.min(this.people.length, ex.people.length);
      const i = Math.floor(hash(ex.day, 113) * n);
      const p = this.people[i];
      return { x: p.x, y: p.y, who: ex.people[i].id };
    }
    if (kind === 'shoal') {
      const f = spot('fish');
      for (let r = 3; r < 20; r++) {
        for (let a = 0; a < 16; a++) {
          const p = { x: f.x + Math.cos((a / 16) * Math.PI * 2) * r, y: f.y + Math.sin((a / 16) * Math.PI * 2) * r };
          if (!isLand(is, p.x, p.y)) return p;
        }
      }
      return f;
    }
    if (kind === 'cold') return spot('wood');
    if (kind === 'seeds') return landNear(spot('forage'), 2, 8, 117);
    if (kind === 'beast') return landNear(camp, 22, 34, 119);
    // A storm: out at sea, to roll in toward the camp.
    for (let r = 26; r < 60; r += 2) {
      for (let a = 0; a < 24; a++) {
        const an = (a / 24) * Math.PI * 2 + hash(ex.day, 123) * 6;
        const p = { x: camp.x + Math.cos(an) * r, y: camp.y + Math.sin(an) * r };
        if (!isLand(is, p.x, p.y)) return { ...p, toX: camp.x, toY: camp.y };
      }
    }
    return { ...landNear(camp, 6, 14, 121), toX: camp.x, toY: camp.y };
  }

  /** A crisis out on the island: a pulsing mark (and what it is: a storm cloud, a glitter
   * offshore, the stirring seed, the beast). */
  private drawCrisis(b: CanvasRenderingContext2D, ex: ExtinctionState, t: number): void {
    const c = ex.crisis;
    if (!c) return;
    const at = crisisAt(ex)!;
    const X = Math.round(this.sx(at.x));
    const Y = Math.round(this.py(at.x, at.y));
    const z = this.detail();
    if (c.kind === 'storm') {
      // A wall of ash, rolling in off the sea: its shadow on the ground, a heaving black-brown
      // cloud many tiles across, and ash pouring down out of it.
      const R = 9 * this.zoom;
      b.fillStyle = 'rgba(10, 8, 8, 0.28)';
      for (let k = 0; k < 18; k++) {
        const a = hash(k, 151) * Math.PI * 2;
        const r = hash(k, 153) * R * 0.9;
        const sz = Math.round(R * (0.35 + hash(k, 155) * 0.3));
        b.fillRect(Math.round(X + Math.cos(a) * r - sz / 2), Math.round(Y + Math.sin(a) * r * 0.45 - sz / 4), sz, Math.round(sz / 2));
      }
      for (let k = 0; k < 60; k++) {
        const fall = ((t * 0.9 + hash(k, 157)) % 1) * R * 0.9;
        const ax = X + (hash(k, 159) - 0.5) * R * 1.8 + Math.sin(t + k) * 2;
        b.fillStyle = k % 3 ? 'rgba(70, 64, 62, 0.8)' : 'rgba(140, 132, 128, 0.7)';
        b.fillRect(Math.round(ax), Math.round(Y - R * 0.9 + fall), Math.max(1, Math.round(z)), Math.max(2, Math.round(2 * z)));
      }
      for (let k = 0; k < 46; k++) {
        const a = hash(k, 131) * Math.PI * 2 + t * (0.15 + hash(k, 161) * 0.25);
        const r = hash(k, 133) * R;
        const sz = Math.max(3, Math.round(R * (0.25 + hash(k, 163) * 0.3)));
        const shade = 22 + Math.round(hash(k, 165) * 30 + 10 * Math.sin(t * 1.5 + k));
        b.fillStyle = `rgba(${shade + 6}, ${shade}, ${shade - 2}, ${0.55 + 0.25 * hash(k, 167)})`;
        b.fillRect(Math.round(X + Math.cos(a) * r - sz / 2), Math.round(Y - R * 1.1 + Math.sin(a) * r * 0.45 - sz / 2), sz, Math.round(sz * 0.7));
      }
    } else if (c.kind === 'shoal') {
      for (let k = 0; k < 14; k++) {
        if (Math.sin(t * 6 + k * 1.7) < 0.4) continue;
        b.fillStyle = k % 2 ? 'rgba(230, 245, 255, 0.996)' : 'rgba(160, 220, 240, 0.996)';
        b.fillRect(Math.round(X + (hash(k, 137) - 0.5) * 10 * z), Math.round(Y + (hash(k, 139) - 0.5) * 6 * z), z, z);
      }
    } else if (c.kind === 'seeds') {
      for (let k = 0; k < 10; k++) {
        if (Math.sin(t * 3 + k) < 0.2) continue;
        b.fillStyle = '#6aaa4a';
        b.fillRect(Math.round(X + (hash(k, 141) - 0.5) * 10 * z), Math.round(Y + (hash(k, 143) - 0.5) * 6 * z), z, z);
      }
    } else if (c.kind === 'beast') {
      b.fillStyle = '#3a2a24';
      b.fillRect(X - 4 * z, Y - 5 * z, 8 * z, 3 * z);
      b.fillRect(X + 3 * z, Y - 7 * z, 3 * z, 2 * z);
      b.fillRect(X - 3 * z, Y - 2 * z, z, 2 * z);
      b.fillRect(X + 2 * z, Y - 2 * z, z, 2 * z);
      b.fillStyle = '#8a2a2a';
      b.fillRect(X - z, Y - 4 * z, 2 * z, z);
    }
    // The mark: a ring of light pulsing, and a "!" over it (the same size at any zoom).
    const pulse = (t * 1.5) % 1;
    const r = 4 + pulse * 6;
    b.globalAlpha = 1 - pulse;
    b.fillStyle = 'rgba(232, 120, 200, 0.996)';
    for (let k = 0; k < 20; k++) {
      const a = (k / 20) * Math.PI * 2;
      b.fillRect(Math.round(X + Math.cos(a) * r), Math.round(Y + Math.sin(a) * r * 0.6), 1, 1);
    }
    b.globalAlpha = 1;
    if (Math.floor(t * 3) % 2) {
      b.fillStyle = PAL.k;
      b.fillRect(X - 1, Y - 15, 3, 6);
      b.fillRect(X - 1, Y - 8, 3, 2);
      b.fillStyle = 'rgba(232, 120, 200, 0.996)';
      b.fillRect(X, Y - 14, 1, 4);
      b.fillRect(X, Y - 7, 1, 1);
    }
  }

  /** Ash coming down out of a dark sky, thick as the winter is deep (across the screen). */
  private drawAshfall(b: CanvasRenderingContext2D, t: number): void {
    if (this.ash < 0.05) return;
    const n = Math.round(160 * this.ash);
    for (let k = 0; k < n; k++) {
      const speed = 6 + hash(k, 171) * 8;
      const x = (hash(k, 173) * this.W + t * (3 + hash(k, 175) * 4) + Math.sin(t * 0.8 + k) * 3) % this.W;
      const y = (hash(k, 177) * this.H + t * speed) % this.H;
      b.fillStyle = k % 4 ? `rgba(120, 112, 108, ${0.55 * this.ash})` : `rgba(190, 182, 176, ${0.6 * this.ash})`;
      b.fillRect(Math.round(x), Math.round(y), 1, 1);
    }
  }

  /** The one whose card is open (marked over their head), or -1. */
  chosen = -1;

  // ---- Casting: the stroke, where things are, and the wonders themselves ----

  /** The stroke so far (art pixels), or null when it's done (it fades). */
  setStroke(pts: Pt[] | null): void {
    if (pts) {
      this.stroke = pts;
      this.strokeFade = 1;
    } else this.strokeFade = Math.min(this.strokeFade, 0.99);
  }

  /** The island under a point on screen (art pixels). */
  worldAt(ax: number, ay: number): Pt {
    return this.toWorld(ax, ay);
  }

  landAt(p: Pt): boolean {
    return !!this.island && isLand(this.island, p.x, p.y);
  }

  /** The nearest work place of a kind (still there) within r tiles of p. */
  nearSpot(ex: ExtinctionState, job: JobId, p: Pt, r: number): Pt | null {
    let best: Spot | null = null;
    let d0 = r;
    for (const s of this.spots) {
      if (s.job !== job || !this.spotShown(ex, s)) continue;
      const d = Math.hypot(s.x - p.x, s.y - p.y);
      if (d < d0) {
        d0 = d;
        best = s;
      }
    }
    return best;
  }

  /** Whether a point on land is by the water (within r tiles of the sea). */
  byWater(p: Pt, r: number): boolean {
    if (!this.island) return false;
    for (let a = 0; a < 12; a++) {
      const x = p.x + Math.cos((a / 12) * Math.PI * 2) * r;
      const y = p.y + Math.sin((a / 12) * Math.PI * 2) * r;
      if (!isLand(this.island, x, y)) return true;
    }
    return false;
  }

  /** Those (of the ones drawn) inside a circle on the island: their places in the tribe. */
  inside(c: Pt, r: number): number[] {
    const out: number[] = [];
    this.people.forEach((p, i) => {
      if (Math.hypot(p.x - c.x, p.y - c.y) <= r) out.push(i);
    });
    return out;
  }

  /** A miracle happens: show it, and leave what it leaves (the tribe goes to piles). */
  wonder(id: SpellId, pts: Pt[]): void {
    this.wonders.push({ id, age: 0, pts });
    const end = pts[pts.length - 1];
    const until = 60;
    if (id === 'quicken') {
      // A furrow of fireweed along the stroke: the foragers go to it.
      const s0 = pts[0];
      for (let k = 0; k <= 2; k++) this.piles.push({ job: 'forage', kind: 'green', x: s0.x + ((end.x - s0.x) * k) / 2, y: s0.y + ((end.y - s0.y) * k) / 2, until });
    }
    if (id === 'kelp') this.piles.push({ job: 'fish', kind: 'kelp', x: end.x, y: end.y, until });
    if (id === 'shoals') this.piles.push({ job: 'fish', kind: 'fish', x: end.x, y: end.y, until });
  }

  /** Where a miracle the spear works unasked lands: a fitting place near the camp. */
  wonderPlace(id: SpellId): Pt[] {
    const camp = this.spots.find((s) => s.job === 'build') ?? { x: 0, y: 0 };
    const pick = (job: JobId) => this.spots.find((s) => s.job === job) ?? camp;
    if (id === 'lightning') return [pick('wood')];
    if (id === 'quicken') {
      const f = pick('forage');
      return [{ x: f.x - 4, y: f.y }, { x: f.x + 4, y: f.y + 1 }];
    }
    if (id === 'rain') return [pick('forage')];
    if (id === 'ward') return [pick('listen')];
    if (id === 'kelp' || id === 'shoals') {
      const f = pick('fish');
      return [{ x: f.x + 6, y: f.y + 6 }, f];
    }
    const s = pick('scavenge');
    return [{ x: s.x - 18, y: s.y - 10 }, s];
  }

  /** Whether a work place is there to see (carcasses rot away and trees get cut down). */
  private spotShown(ex: ExtinctionState, s: Spot): boolean {
    const of = this.spots.filter((o) => o.job === s.job);
    const k = of.indexOf(s);
    if (s.job === 'scavenge') return k < Math.ceil((of.length * ex.carrion) / Math.max(1, (ex.people.length + ex.deaths) * 6));
    if (s.job === 'wood') return k < Math.ceil((of.length * (ex.trees ?? 0)) / Math.max(1, (ex.people.length + ex.deaths) * 4));
    return true;
  }

  /** What miracles left lying: fish or kelp on the beach, fruit under a tree, a fallen beast. */
  private drawPiles(sprites: { y: number; draw: () => void }[], b: CanvasRenderingContext2D, dt: number): void {
    const z = this.detail();
    const close = this.zoom >= 1.6;
    for (const q of this.piles) q.until -= dt;
    this.piles = this.piles.filter((q) => q.until > 0);
    for (const q of this.piles) {
      const X = Math.round(this.sx(q.x));
      const Y = Math.round(this.py(q.x, q.y));
      sprites.push({
        y: q.y,
        draw: () => {
          const cols = q.kind === 'green' ? ['#4a8a3a', '#c84a98'] : q.kind === 'fish' ? ['#c8d8e0', '#8aa8b8'] : q.kind === 'kelp' ? ['#4a7a3a', '#2e5a2a'] : q.kind === 'fruit' ? ['#c0402a', '#e8a040'] : ['#5a3a30', '#8a5a48'];
          if (!close) {
            b.fillStyle = cols[1];
            b.fillRect(X - 1, Y - 1, 2, 1);
            return;
          }
          for (let k = 0; k < 7; k++) {
            b.fillStyle = cols[k % 2];
            b.fillRect(X + (((k * 5) % 7) - 3) * z, Y - (1 + (k % 3)) * z, 2 * z, z);
          }
        },
      });
    }
  }

  /** Miracles playing out: lightning down onto a tree, rain over the ash, a ring of light, a
   * wave up the beach, fruit falling, a beast staggering in to die. */
  private drawWonders(b: CanvasRenderingContext2D, t: number, dt: number): void {
    const glow = (col: string, x: number, y: number, w = 1, h = 1) => {
      b.fillStyle = col;
      b.fillRect(Math.round(x), Math.round(y), w, h);
    };
    for (const w of this.wonders) {
      w.age += dt;
      const a = w.age;
      const end = w.pts[w.pts.length - 1];
      const X = this.sx(end.x);
      const Y = this.py(end.x, end.y);
      const z = this.detail();
      if (w.id === 'lightning') {
        if (a < 0.6) {
          // The bolt: jagged, white-violet, from the top of the sky to the tree.
          let x = X + (Math.sin(w.pts.length + Math.floor(a * 20)) * 10);
          for (let y = 0; y < Y; y += 2) {
            x += (Math.sin(y * 0.7 + Math.floor(a * 30)) > 0 ? 1 : -1) * (y % 6 === 0 ? 2 : 0);
            glow(a < 0.15 ? 'rgba(255, 255, 255, 0.996)' : 'rgba(210, 160, 255, 0.996)', x + (X - x) * (y / Y), y, 2, 2);
          }
          if (a < 0.12) {
            b.fillStyle = `rgba(255, 245, 255, ${0.5 * (1 - a / 0.12)})`;
            b.fillRect(0, 0, this.W, this.H);
          }
        }
        // The tree burning after.
        if (a < 5) {
          const f = Math.floor(t * 9) % 3;
          for (let k = 0; k < 4; k++) glow(k % 2 ? 'rgba(255, 200, 90, 0.996)' : 'rgba(255, 110, 40, 0.996)', X - 2 * z + k * z, Y - (5 + ((k + f) % 3)) * z, z, 2 * z);
        }
      } else if (w.id === 'rain') {
        // Rain over a patch, then green coming up through the ash.
        const r = 7;
        if (a < 3.5) {
          for (let k = 0; k < 60; k++) {
            const dx = (hash(k, 71) - 0.5) * 2 * r;
            const dy = (hash(k, 73) - 0.5) * 2 * r * 0.7;
            const fall = ((a * 1.6 + hash(k, 75)) % 1) * 14;
            glow('rgba(150, 190, 255, 0.85)', this.sx(end.x + dx), this.py(end.x + dx, end.y + dy) - 14 + fall, 1, 2);
          }
        }
        if (a > 1.5 && a < 40) {
          const k2 = Math.min(1, (a - 1.5) / 3) * Math.max(0, 1 - (a - 30) / 10);
          for (let k = 0; k < 40; k++) {
            if (hash(k, 77) > k2) continue;
            const dx = (hash(k, 79) - 0.5) * 2 * r * 0.8;
            const dy = (hash(k, 81) - 0.5) * 2 * r * 0.55;
            glow(k % 3 ? '#5a8a3a' : '#7ab048', this.sx(end.x + dx), this.py(end.x + dx, end.y + dy) - 1, z, z);
          }
        }
      } else if (w.id === 'ward') {
        // A ring of gold light round them, rising.
        if (a < 2.5) {
          const c = w.pts[0];
          const rr = (w.pts[1]?.x ?? 6) * this.zoom;
          const cx = this.sx(c.x);
          const cy = this.py(c.x, c.y);
          b.globalAlpha = Math.max(0, 1 - a / 2.5);
          const n = Math.ceil(rr * 4) + 12;
          for (let i = 0; i < n; i++) {
            const an = (i / n) * Math.PI * 2;
            glow('rgba(255, 220, 140, 0.996)', cx + Math.cos(an) * rr, cy + Math.sin(an) * rr * 0.6 - a * 6, 1, 1);
          }
          b.globalAlpha = 1;
        }
      } else if (w.id === 'quicken') {
        // Fireweed springing up along the stroke, start to end, and flowering pink.
        const s0 = w.pts[0];
        const grown = Math.min(1, a / 1.5);
        const n = 26;
        for (let k = 0; k < n * grown; k++) {
          const f = k / n;
          const gx = s0.x + (end.x - s0.x) * f + (hash(k, 87) - 0.5) * 1.2;
          const gy = s0.y + (end.y - s0.y) * f + (hash(k, 89) - 0.5) * 1.2;
          const tall = Math.min(3, Math.floor((a - f * 1.5) * 4) + 1);
          if (tall <= 0 || a > 40) continue;
          const sx = this.sx(gx);
          const sy = this.py(gx, gy);
          glow('#4a8a3a', sx, sy - tall * z, z, tall * z);
          if (tall >= 3) glow(k % 2 ? '#e070b0' : '#c84a98', sx, sy - (tall + 1) * z, z, z);
        }
      } else if (w.id === 'kelp' || w.id === 'shoals') {
        // A wave running up onto the beach along the stroke.
        if (a < 1.6) {
          const s0 = w.pts[0];
          const k = Math.min(1, a / 1.2);
          const px = s0.x + (end.x - s0.x) * k;
          const py = s0.y + (end.y - s0.y) * k;
          for (let i = -6; i <= 6; i++) glow(i % 2 ? 'rgba(220, 240, 255, 0.996)' : 'rgba(140, 200, 230, 0.996)', this.sx(px) + i * 2 * z * Math.cos(Math.atan2(end.y - s0.y, end.x - s0.x) + Math.PI / 2), this.py(px, py) + i * z * Math.sin(Math.atan2(end.y - s0.y, end.x - s0.x) + Math.PI / 2), 2 * z, z);
        }
      } else if (w.id === 'dying') {
        // A wounded beast staggering in along the stroke, and falling.
        const s0 = w.pts[0];
        const k = Math.min(1, a / 4);
        const bx = s0.x + (end.x - s0.x) * k;
        const by = s0.y + (end.y - s0.y) * k;
        const BX = Math.round(this.sx(bx));
        const BY = Math.round(this.py(bx, by));
        const down = k >= 1;
        if (!down || a < 60) {
          b.fillStyle = '#3a2a24';
          if (down) b.fillRect(BX - 5 * z, BY - 2 * z, 10 * z, 2 * z);
          else {
            b.fillRect(BX - 4 * z, BY - 5 * z, 8 * z, 3 * z);
            b.fillRect(BX + 3 * z, BY - 7 * z, 3 * z, 2 * z);
            const step = Math.floor(a * 4) % 2;
            b.fillRect(BX - 3 * z, BY - 2 * z, z, (2 - step) * z);
            b.fillRect(BX + 2 * z, BY - 2 * z, z, (1 + step) * z);
          }
          b.fillStyle = '#8a2a2a';
          b.fillRect(BX - z, BY - (down ? 2 : 4) * z, 2 * z, z);
        }
      }
    }
    this.wonders = this.wonders.filter((w) => w.age < (w.id === 'dying' ? 60 : w.id === 'rain' || w.id === 'quicken' ? 40 : 6));
  }

  /** The stroke being drawn: a trail of purple-red light, fading once it's done. */
  private drawStroke(b: CanvasRenderingContext2D, dt: number): void {
    if (!this.stroke.length) return;
    if (this.strokeFade < 1) this.strokeFade -= dt * 1.5;
    if (this.strokeFade <= 0) {
      this.stroke = [];
      return;
    }
    b.globalAlpha = Math.max(0, Math.min(1, this.strokeFade));
    for (let i = 1; i < this.stroke.length; i++) {
      const a = this.stroke[i - 1];
      const c = this.stroke[i];
      const n = Math.max(1, Math.ceil(Math.hypot(c.x - a.x, c.y - a.y)));
      for (let k = 0; k < n; k++) {
        const x = Math.round(a.x + ((c.x - a.x) * k) / n);
        const y = Math.round(a.y + ((c.y - a.y) * k) / n);
        b.fillStyle = (i + k) % 3 ? 'rgba(200, 90, 255, 0.996)' : 'rgba(255, 110, 150, 0.996)';
        b.fillRect(x - 1, y - 1, 2, 2);
      }
    }
    b.globalAlpha = 1;
  }

  /** The work places: carcasses (or fallen fruit), charred trees, the fire at the camp, and the
   * raft on its beach, growing part by part. */
  private drawWork(sprites: { y: number; draw: () => void }[], b: CanvasRenderingContext2D, ex: ExtinctionState, camp: Pt, t: number): void {
    const z = this.detail();
    // Small things (trees, carcasses) only close up: zoomed out, a pixel would be too big for
    // them, and they'd tower over the island.
    const close = this.zoom >= 1.6;
    const plantEaters = ex.diet === 'herbivore';
    // Flags, as the Creature's places had (a pole and a pennant, the same size at any zoom):
    // the camp in gold, always; and zoomed out, one at each kind of work they're at today,
    // coloured by the work.
    const flag = (x: number, y: number, col: string) => {
      const X = Math.round(this.sx(x));
      const Y = Math.round(this.py(x, y));
      if (X < -6 || X > this.W + 6 || Y < -10 || Y > this.H + 10) return;
      sprites.push({
        y,
        draw: () => {
          b.fillStyle = PAL.k;
          b.fillRect(X, Y - 7, 1, 7);
          b.fillStyle = col;
          b.fillRect(X + 1, Y - 7, 3, 2);
        },
      });
    };
    flag(camp.x, camp.y, PAL.y);
    if (!close) {
      const FLAG: Partial<Record<JobId, string>> = { wood: '#a07850', scavenge: plantEaters ? '#e8a040' : '#d0584a', fish: '#7fc3d8', forage: '#8acf6a', dig: '#4f9a5a', build: '#e0a060' };
      for (const job of Object.keys(FLAG) as JobId[]) {
        if (!ex.people.some((p) => p.job === job) && job !== 'build') continue;
        const at = job === 'build' ? (raftPart(ex) || (ex.raft?.frame ?? 0) > 0 ? this.raftAt : null) : this.spots.find((q) => q.job === job && this.spotShown(ex, q));
        if (at) flag(at.x, at.y, FLAG[job]!);
      }
    }
    for (const s of this.spots) {
      if (!close || !this.spotShown(ex, s)) continue;
      const X = Math.round(this.sx(s.x));
      const Y = Math.round(this.py(s.x, s.y));
      if (X < -10 || X > this.W + 10 || Y < -20 || Y > this.H + 10) continue;
      if (s.job === 'scavenge') {
        sprites.push({
          y: s.y - 0.2,
          draw: () => {
            if (plantEaters) {
              // Fallen fruit: a little heap of red and gold.
              b.fillStyle = '#c0402a';
              b.fillRect(X - 2 * z, Y - z, 2 * z, z);
              b.fillStyle = '#e8a040';
              b.fillRect(X, Y - z, 2 * z, z);
              b.fillRect(X - z, Y - 2 * z, 2 * z, z);
            } else {
              // A carcass: pale ribs on the ash.
              b.fillStyle = '#d8d0c0';
              b.fillRect(X - 3 * z, Y - z, 6 * z, z);
              for (let k = 0; k < 3; k++) b.fillRect(X - 2 * z + k * 2 * z, Y - 3 * z, z, 2 * z);
              b.fillStyle = '#7a3a30';
              b.fillRect(X + 3 * z, Y - 2 * z, 2 * z, 2 * z);
            }
          },
        });
      } else if (s.job === 'wood') {
        sprites.push({
          y: s.y,
          draw: () => {
            // A charred tree: a black trunk and a few bare branches.
            b.fillStyle = '#0c0908';
            b.fillRect(X, Y - 7 * z, z, 7 * z);
            b.fillRect(X - 2 * z, Y - 6 * z, 2 * z, z);
            b.fillRect(X + z, Y - 5 * z, 2 * z, z);
            b.fillRect(X - z, Y - 8 * z, z, z);
          },
        });
      } else if (s.job === 'dig' && ex.ideas.includes('stick')) {
        b.fillStyle = '#2a1e18';
        b.fillRect(X - z, Y - z, 2 * z, z);
      }
    }
    // The fire at the camp, once they have it and the wood to keep it.
    if (ex.ideas.includes('fire') && (ex.wood ?? 0) >= 1) {
      const X = Math.round(this.sx(camp.x));
      const Y = Math.round(this.py(camp.x, camp.y));
      sprites.push({
        y: camp.y,
        draw: () => {
          if (!close) {
            b.fillStyle = 'rgba(255, 150, 60, 0.996)';
            b.fillRect(X, Y - 1, 1, 1);
            return;
          }
          // Logs, flames that lick up and fall back, a bright heart.
          const f = Math.floor(t * 8) % 3;
          b.fillStyle = '#3a2a20';
          b.fillRect(X - 3 * z, Y - z, 6 * z, z);
          b.fillStyle = 'rgba(255, 110, 40, 0.996)';
          b.fillRect(X - 2 * z, Y - 3 * z, 4 * z, 2 * z);
          b.fillStyle = 'rgba(255, 160, 60, 0.996)';
          b.fillRect(X - z, Y - (4 + (f % 2)) * z, 2 * z, (2 + (f % 2)) * z);
          b.fillRect(X + (f === 2 ? z : -2 * z), Y - (5 + (f % 2)) * z, z, z);
          b.fillStyle = 'rgba(255, 235, 160, 0.996)';
          b.fillRect(X - (f === 1 ? z : 0), Y - 3 * z, z, z);
        },
      });
    }
    // The raft on its beach: logs for the frame, ties for the lashing, a deck for the hull.
    if (this.raftAt) {
      const r = this.raftAt;
      const prog = (id: string) => {
        const part = RAFT.find((p) => p.id === id)!;
        return Math.min(1, (ex.raft?.[part.id] ?? 0) / part.work);
      };
      const frame = prog('frame');
      if (frame > 0 || raftPart(ex)) {
        const X = Math.round(this.sx(r.x));
        const Y = Math.round(this.py(r.x, r.y));
        const lash = prog('lashing');
        const hull = prog('hull');
        sprites.push({
          y: r.y - 0.5,
          draw: () => {
            if (!close) {
              // Far off: just a mark on the beach.
              b.fillStyle = '#6a4a30';
              b.fillRect(X - 1, Y - 1, 3, 1);
              return;
            }
            const w = 10 * z;
            const logs = Math.round(frame * 5);
            b.fillStyle = '#6a4a30';
            for (let k = 0; k < logs; k++) b.fillRect(X - w / 2, Y - 5 * z + k * z, w, Math.max(1, z - (z > 1 ? 1 : 0)));
            if (lash > 0) {
              b.fillStyle = '#c8b080';
              for (let k = 0; k < Math.round(lash * 3); k++) b.fillRect(X - w / 2 + (2 + k * 3) * z, Y - 5 * z, z, 5 * z);
            }
            if (hull > 0) {
              b.fillStyle = '#8a6a44';
              b.fillRect(X - w / 2, Y - 5 * z, Math.round(w * hull), z);
              b.fillRect(X - w / 2, Y - z, Math.round(w * hull), z);
            }
          },
        });
      }
    }
  }

  /** How big a detail's pixels are drawn at this zoom: one screen pixel each at the usual
   * zoom, growing as it zooms in (so small things keep their size against the land). */
  private detail(): number {
    return Math.max(1, Math.round(this.zoom / 2.4));
  }

  /** Keeps the spear's island on screen while the crossing is told (then the new island). */
  holdOld = false;
  private landSeed = -1;
  private family: Person[] = [];
  private locals: Person[] = [];
  private localCamp: Pt = { x: 0, y: 0 };

  /** The new island: green, unburnt, the four come ashore on its beach, and on a rise inland
   * the smoke of someone else's fire, and them. */
  private drawLanded(f: Frame, tribe: NonNullable<ReturnType<typeof tribeOf>>): void {
    const { b, W, H, t, dt } = f;
    const is = islandOf(tribe.landed!.seed);
    this.island = is;
    this.ash = 0;
    if (this.landSeed !== is.seed) {
      this.landSeed = is.seed;
      this.ground.clear();
      this.fog = null;
      this.fogKnown = null;
      this.groundSeed = is.seed;
      // Their camp: on land a fair way inland from the beach.
      this.localCamp = { ...is.home };
      for (let k = 0; k < 200; k++) {
        const a = hash(k, 91) * Math.PI * 2;
        const r = 30 + hash(k, 93) * 18;
        const p = { x: is.home.x + Math.cos(a) * r, y: is.home.y + Math.sin(a) * r };
        if (isLand(is, p.x, p.y) && isLand(is, p.x + 3, p.y) && isLand(is, p.x - 3, p.y)) {
          this.localCamp = p;
          break;
        }
      }
      const at = (c: Pt, k: number, r: number): Person => ({ x: c.x + (hash(k, 95) - 0.5) * r, y: c.y + (hash(k, 97) - 0.5) * r * 0.7, vx: 0, vy: 0, ph: hash(k, 99) * 9, goal: null, wait: hash(k, 101) * 3, lit: -100 });
      this.family = Array.from({ length: 4 }, (_, k) => at(is.home, k, 3));
      this.locals = Array.from({ length: 14 }, (_, k) => at(this.localCamp, k + 10, 7));
      this.camX = (is.home.x * 2 + this.localCamp.x) / 3;
      this.camY = (is.home.y * 2 + this.localCamp.y) / 3;
      this.zoom = 3;
      this.auto = false;
    }
    this.seasonBlend = 0;
    this.seasonPair = [0, 0];
    if (!this.ground.has(0)) this.ground.set(0, this.paintGround(is, 0));
    this.groundPair = [this.ground.get(0)!, this.ground.get(0)!];
    this.paintFog(ALL_SEEN);
    b.imageSmoothingEnabled = false;
    if (this.shaded) b.clearRect(0, 0, W, H);
    else {
      b.fillStyle = '#24506e';
      b.fillRect(0, 0, W, H);
      this.blitWorld(b, this.ground.get(0)!);
    }
    const sprites: { y: number; draw: () => void }[] = [];
    const ours = tribe.look as never;
    // The locals: another kind altogether (other legs, other jaws, the other diet).
    const p = tribe.look.parts;
    const theirs = { parts: { legs: p.legs === 'hooves' ? 'runner' : 'hooves', mouth: p.mouth === 'tusks' ? 'fangs' : 'tusks', back: p.back === 'spines' ? 'sail' : 'spines', eyes: 'periscope' }, diet: tribe.look.diet === 'hunter' ? 'grazer' : 'hunter' } as never;
    const move = (list: Person[], home: Pt, r: number, look: never, wary: boolean) =>
      list.forEach((q, i) => {
        q.wait -= dt;
        if (!q.goal || q.wait <= 0) {
          q.wait = 3 + hash(i, Math.floor(t / 5)) * 5;
          const a = hash(i * 7, Math.floor(t / 6)) * Math.PI * 2;
          const g = { x: home.x + Math.cos(a) * r * hash(i, 103), y: home.y + Math.sin(a) * r * 0.7 * hash(i, 103) };
          q.goal = isLand(this.island!, g.x, g.y) ? g : { ...home };
        }
        const dx = q.goal.x - q.x;
        const dy = q.goal.y - q.y;
        const d = Math.hypot(dx, dy);
        const moving = d > 0.3;
        if (moving) {
          q.x += (dx / d) * Math.min(d, 1.2 * dt);
          q.y += (dy / d) * Math.min(d, 1.2 * dt);
        }
        const x = q.x;
        const y = q.y;
        // The family keeps looking toward the smoke; the locals, at first, toward the beach.
        const left = moving ? dx < 0 : wary ? this.localCamp.x < x : is.home.x < x;
        sprites.push({ y, draw: () => this.drawBeing(b, look, x, y, { left, frame: moving ? Math.floor(t * 7 + q.ph) % 2 : 0, sleeping: false, hop: moving ? Math.abs(Math.sin(t * 7 + q.ph)) * 1.5 : 0 }) });
      });
    move(this.family, is.home, 4, ours, true);
    move(this.locals, this.localCamp, 8, theirs, false);
    // Their fire, and its smoke going up: seen from the beach before anything else.
    const FX = Math.round(this.sx(this.localCamp.x));
    const FY = Math.round(this.py(this.localCamp.x, this.localCamp.y));
    sprites.push({
      y: this.localCamp.y,
      draw: () => {
        const fl = Math.floor(t * 8) % 3;
        b.fillStyle = '#3a2a20';
        b.fillRect(FX - 2, FY - 1, 4, 1);
        b.fillStyle = 'rgba(255, 150, 60, 0.996)';
        b.fillRect(FX - 1, FY - 3 - (fl % 2), 2, 2 + (fl % 2));
        for (let k = 0; k < 8; k++) {
          const h = ((t * 4 + k * 5) % 40);
          b.fillStyle = `rgba(200, 200, 205, ${0.35 * (1 - h / 40)})`;
          b.fillRect(FX + Math.round(Math.sin(h * 0.15 + k) * 2 + h * 0.2), FY - 6 - Math.round(h), 2, 2);
        }
      },
    });
    // The raft, pulled up on the sand.
    const RX = Math.round(this.sx(is.home.x - 2));
    const RY = Math.round(this.py(is.home.x - 2, is.home.y + 1));
    sprites.push({
      y: is.home.y + 1,
      draw: () => {
        b.fillStyle = '#6a4a30';
        for (let k = 0; k < 4; k++) b.fillRect(RX - 5, RY - 4 + k, 10, 1);
        b.fillStyle = '#c8b080';
        b.fillRect(RX - 3, RY - 4, 1, 4);
        b.fillRect(RX + 2, RY - 4, 1, 4);
      },
    });
    sprites.sort((a, c) => a.y - c.y);
    for (const s of sprites) s.draw();
    this.fx.run(f);
  }

  /** Sends the waking out from the one at the spear to the others. */
  spreadWake(): void {
    this.spreadPending = true;
  }

  /** A point of light over a head (`age` seconds old): flaring, then fading upward. */
  private spark(b: CanvasRenderingContext2D, x: number, y: number, age: number): void {
    const a = age < 0.3 ? age / 0.3 : Math.max(0, 1 - (age - 0.3) / 2.7);
    if (a <= 0) return;
    const X = Math.round(this.sx(x));
    const Y = Math.round(this.py(x, y) - Math.max(6, 2.2 * this.zoom) - age * 2);
    b.globalAlpha = a;
    b.fillStyle = 'rgba(255, 236, 170, 0.996)';
    b.fillRect(X - 1, Y, 3, 1);
    b.fillRect(X, Y - 1, 1, 3);
    b.fillStyle = 'rgba(255, 255, 250, 0.996)';
    b.fillRect(X, Y, 1, 1);
    b.globalAlpha = 1;
  }

  /** Takes the camera as the Creature's map left it (so the strike lands where it looked). */
  takeCamera(x: number, y: number, z: number): void {
    this.handed = { x, y, z };
    this.placed = false;
  }

  /** Paints the ground part burnt: ash inside the fire's reach, a glowing front, green beyond. */
  private paintBurn(is: Island, si: number, spear: Pt, p: number): void {
    const N = ISLAND;
    if (!this.burn || this.burn.season !== si) {
      const read = (cv: HTMLCanvasElement) => cv.getContext('2d')!.getImageData(0, 0, N, N).data;
      const green = read(this.paintGround({ ...is, scar: undefined }, si));
      const ash = read(this.ground.get(si)!);
      const order = new Float32Array(N * N);
      let far = 1;
      for (let i = 0; i < N * N; i++) if (is.height[i] > 0) far = Math.max(far, Math.hypot((i % N) - spear.x, Math.floor(i / N) - spear.y));
      for (let i = 0; i < N * N; i++) {
        const x = i % N;
        const y = Math.floor(i / N);
        // Ragged: it runs ahead in some places and lags in others.
        const rag = 0.88 + 0.24 * hash(Math.floor(x / 5) + Math.floor(y / 5) * 97, 51) + 0.06 * hash(x, y);
        order[i] = (Math.hypot(x - spear.x, y - spear.y) / far) * rag;
      }
      const cv = document.createElement('canvas');
      cv.width = N;
      cv.height = N;
      const img = cv.getContext('2d')!.createImageData(N, N);
      this.burn = { cv, img, green, ash, order, v: 0, season: si };
    }
    const { img, green, ash, order } = this.burn;
    const d = img.data;
    // Eased: it races out from the blow and slows as it reaches the shore.
    const reach = 1 - (1 - Math.min(1, p)) ** 2;
    this.burnReach = reach;
    const front = 0.05;
    for (let i = 0; i < N * N; i++) {
      const o = order[i];
      const j = i * 4;
      if (o < reach - front) {
        d[j] = ash[j];
        d[j + 1] = ash[j + 1];
        d[j + 2] = ash[j + 2];
      } else if (o < reach) {
        // The fire itself: white-yellow at the leading edge, red behind it, going to char.
        const k = (reach - o) / front;
        d[j] = 255 - 120 * k;
        d[j + 1] = 220 - 190 * k;
        d[j + 2] = 120 - 100 * k;
      } else {
        d[j] = green[j];
        d[j + 1] = green[j + 1];
        d[j + 2] = green[j + 2];
      }
      d[j + 3] = 255;
    }
    this.burn.cv.getContext('2d')!.putImageData(img, 0, 0);
    this.burn.cv.dataset.v = String(++this.burn.v);
  }

  /** How tall the spear stands on screen (art px): a giant, whatever the zoom. */
  private spearHeight(): number {
    // A fixed size in the world: it shrinks with the land as you zoom out.
    return 15 * this.zoom;
  }

  draw(f: Frame, state: GameState): void {
    const { b, W, H, t, dt } = f;
    this.W = W;
    this.H = H;
    if (!this.viewBottom) this.viewTop = f.top;
    const tribe = tribeOf(state);
    if (!tribe) return;
    // Ashore on the new island (once the crossing's been told).
    if (tribe.landed && !this.holdOld) {
      this.drawLanded(f, tribe);
      return;
    }
    const frag = ashenFor(state);
    const is = frag.island;
    this.island = is;
    if (this.spotSeed !== is.seed) {
      const f = spotsFor(is, frag.camp, frag.spear);
      this.spots = f.spots;
      this.raftAt = f.raft;
      this.spotSeed = is.seed;
    }
    if (this.firstLook) {
      this.firstLook = false;
      this.allLit = tribe.awake;
    }
    if (this.spreadPending) {
      this.spreadPending = false;
      this.spreadAt = t;
    }
    // First look: the camera where the Creature's left it (at the strike), or on the camp.
    if (!this.placed || this.seedSeen !== is.seed) {
      const h = this.handed;
      this.camX = h ? h.x : tribe.awake ? (frag.camp.x + frag.spear.x) / 2 : frag.camp.x;
      this.camY = h ? h.y : tribe.awake ? (frag.camp.y + frag.spear.y) / 2 : frag.camp.y;
      this.zoom = h ? h.z : 3;
      this.handed = null;
      this.auto = false;
      this.placed = true;
      this.seedSeen = is.seed;
    }

    // Seasons by the tribe's own clock.
    const y = tribe.year % (SEASON_SEC * 4);
    const si = Math.floor(y / SEASON_SEC);
    const into = (y % SEASON_SEC) / SEASON_SEC;
    const blend = Math.max(0, Math.min(1, (into - 0.45) / 0.55));
    const turn = blend * blend * (3 - 2 * blend);
    const next = (si + 1) % 4;
    this.seasonBlend = turn;
    this.seasonPair = [si, next];
    if (this.groundSeed !== is.seed) {
      this.ground.clear();
      this.fog = null;
      this.fogKnown = null;
      this.groundSeed = is.seed;
    }
    if (!this.ground.has(si)) this.ground.set(si, this.paintGround(is, si));
    if (!this.ground.has(next)) this.ground.set(next, this.paintGround(is, next));
    this.groundPair = [this.ground.get(si)!, this.ground.get(next)!];
    // The burning: the first time the burnt island is seen (just after the strike), the fire
    // runs out from the spear across the green, leaving ash behind it.
    if (!this.burnDone) {
      if (this.burnAt < 0) {
        if (tribe.awake || tribe.year > 40) this.burnDone = true;
        else this.burnAt = t;
      }
      const p = (t - this.burnAt) / BURN_SEC;
      if (this.burnDone || p >= 1.15) {
        this.burnDone = true;
        this.burn = null;
      } else {
        this.paintBurn(is, si, frag.spear, p);
        this.groundPair = [this.burn!.cv, this.burn!.cv];
      }
    }
    this.paintFog(ALL_SEEN);
    b.imageSmoothingEnabled = false;
    if (this.shaded) b.clearRect(0, 0, W, H);
    else {
      b.fillStyle = '#24506e';
      b.fillRect(0, 0, W, H);
      this.blitWorld(b, this.ground.get(si)!);
    }

    const dayT = (t % DAY_SEC) / DAY_SEC;
    const night = Math.max(0, Math.min(1, (0.125 - Math.abs(dayT - 0.875)) * 40));
    const sprites: { y: number; draw: () => void }[] = [];
    // They look as they did when the strike came (their look is kept with the tribe).
    const look = tribe.look;

    // The world still smoulders: smoke curling up off the ash and embers glowing in it,
    // dying down over the first days (never quite out). A red haze over all of it at first.
    const heat = Math.max(0.15, 1 - tribe.year / 900);
    // Embers and smoke come from the burnt cells in view (the same cells every time).
    const c0 = this.toWorld(0, 0);
    const c1 = this.toWorld(W, H);
    const x0 = Math.max(0, Math.floor(Math.min(c0.x, c1.x)) - 2);
    const x1 = Math.min(ISLAND - 1, Math.ceil(Math.max(c0.x, c1.x)) + 2);
    const y0 = Math.max(0, Math.floor(Math.min(c0.y, c1.y)) - 2);
    const y1 = Math.min(ISLAND - 1, Math.ceil(Math.max(c0.y, c1.y)) + 6);
    // Zoomed out, only every so many cells are looked at: on a grid fixed to the world (and
    // stepping in doublings), so the same embers glow wherever the view is moved.
    const stride = 2 ** Math.max(0, Math.ceil(Math.log2(Math.sqrt(((x1 - x0) * (y1 - y0)) / 6000))));
    const embers: Pt[] = [];
    for (let y = y0 - (y0 % stride); y <= y1; y += stride) {
      for (let x = x0 - (x0 % stride); x <= x1; x += stride) {
        if (is.scar?.[y * ISLAND + x] === BURNT && hash(x * 7 + y * 131, 49) < 0.035 && (!this.burn || this.burn.order[y * ISLAND + x] < this.burnReach)) embers.push({ x: x + 0.5, y: y + 0.5 });
      }
    }
    if (embers.length && Math.random() < heat * dt * 12) {
      const e = embers[Math.floor(Math.random() * embers.length)];
      this.smoke.push({ x: e.x, y: e.y, z: 0, life: 5 + Math.random() * 3 });
    }
    for (const m of this.smoke) {
      m.life -= dt;
      m.z += dt * 4;
      m.x += dt * 0.5;
    }
    this.smoke = this.smoke.filter((m) => m.life > 0);
    // (An ember is a speck: zoomed far out, a pixel of one would be far too big, so they go.)
    const ez = this.detail();
    if (this.zoom >= 1.8)
      embers.forEach((e) => {
        const glow = Math.sin(t * (0.8 + hash(Math.floor(e.x), Math.floor(e.y))) + e.x) * 0.5 + 0.5;
        if (glow < 1 - heat * 0.8) return;
        b.fillStyle = glow > 0.85 ? 'rgba(255, 170, 80, 0.996)' : 'rgba(220, 60, 30, 0.996)';
        b.fillRect(Math.round(this.sx(e.x)), Math.round(this.py(e.x, e.y)), ez, ez);
      });

    // The survivors (up to 40 drawn; more are about, off where you can't see them).
    const shown = Math.min(40, Math.max(1, Math.round(tribe.pop)));
    while (this.people.length < shown) {
      const k = this.people.length;
      const a = hash(k, 3) * Math.PI * 2;
      const d = 1 + hash(k, 5) * 4;
      this.people.push({ x: frag.camp.x + Math.cos(a) * d, y: frag.camp.y + Math.sin(a) * d * 0.7, vx: 0, vy: 0, ph: hash(k, 7) * 10, goal: null, wait: hash(k, 9) * 4, lit: this.allLit ? -100 : -1 });
    }
    this.people.length = shown;
    const sleeping = night > 0.5;
    // The waking spreading out from the one at the spear, back over the ash to the others.
    const from = this.walker ?? frag.spear;
    const spreadSpeed = Math.max(SPREAD_SPEED, Math.hypot(frag.camp.x - from.x, frag.camp.y - from.y) / SPREAD_SEC);
    const spread = this.spreadAt >= 0 ? (t - this.spreadAt) * spreadSpeed : -1;
    this.people.forEach((p, i) => {
      if (p.lit < 0 && spread >= 0 && Math.hypot(p.x - from.x, p.y - from.y) < spread) {
        p.lit = t;
        p.goal = null;
        p.vx = 0;
        p.vy = 0;
      }
      // A while after it reaches them they're still, looking toward the spear.
      const struck = p.lit >= 0 && t - p.lit < 4;
      const woke = tribe.awake && p.lit !== -1 && !struck;
      // Before waking they keep close to the camp, away from the spear; after, they range
      // over what's left, and some stand looking up at it.
      p.wait -= dt;
      const trapped = tribe.ex?.crisis?.kind === 'trapped' && tribe.ex.people[i]?.id === tribe.ex.crisis.who;
      if (struck || trapped) {
        p.goal = { x: p.x, y: p.y };
        if (trapped) {
          p.vx = 0;
          p.vy = 0;
        }
      }
      else if (!p.goal || p.wait <= 0) {
        p.wait = 4 + hash(i, Math.floor(t / 7)) * 8;
        const ex = tribe.ex;
        const job = ex?.people[i]?.job;
        const evening = ex ? ex.clock > EX_DAY * 0.82 : false;
        if (woke && ex && job && job !== 'rest' && !evening) {
          // To work: their own spot of their job, a little apart from the others there.
          const of = [...this.piles.filter((q) => q.job === job), ...this.spots.filter((s) => s.job === job && this.spotShown(ex, s))];
          const s = of.length ? of[Math.floor(hash(ex.people[i].id, 31) * of.length)] : null;
          if (s) {
            const a = hash(ex.people[i].id, 33) * Math.PI * 2;
            const r = 0.8 + hash(ex.people[i].id, 35) * 1.8;
            p.goal = { x: s.x + Math.cos(a) * r, y: s.y + Math.sin(a) * r * 0.7 };
            p.wait = 3;
          }
        } else if (!woke || sleeping || (ex && (evening || job === 'rest'))) {
          const a = hash(i, Math.floor(t / 9) + 1) * Math.PI * 2;
          const r = sleeping ? 2 + hash(i, 13) * 3 : 3 + hash(i, 11) * 7;
          p.goal = { x: frag.camp.x + Math.cos(a) * r, y: frag.camp.y + Math.sin(a) * r * 0.7 };
        } else if (i % 5 === 0) {
          const a = hash(i, Math.floor(t / 11)) * Math.PI * 2;
          p.goal = { x: frag.spear.x + Math.cos(a) * (LAKE + 2), y: frag.spear.y + Math.sin(a) * (LAKE + 2) };
        } else {
          for (let k = 0; k < 8; k++) {
            const a = hash(i * 13 + k, Math.floor(t / 13)) * Math.PI * 2;
            const r = 4 + hash(i * 7 + k, 17) * 24;
            const g = { x: frag.camp.x + Math.cos(a) * r, y: frag.camp.y + Math.sin(a) * r };
            if (isLand(is, g.x, g.y) && Math.hypot(g.x - frag.spear.x, g.y - frag.spear.y) > LAKE + 3) {
              p.goal = g;
              break;
            }
          }
        }
      }
      let gx = p.goal?.x ?? p.x;
      let gy = p.goal?.y ?? p.y;
      for (const o of this.people) {
        if (o === p) continue;
        const ox = p.x - o.x;
        const oy = p.y - o.y;
        const od = Math.hypot(ox, oy);
        if (od > 0 && od < 2.4) {
          gx += (ox / od) * (2.4 - od) * 2.5;
          gy += (oy / od) * (2.4 - od) * 2.5;
        }
      }
      const dx = gx - p.x;
      const dy = gy - p.y;
      const d = Math.hypot(dx, dy);
      const sp = d > 0.3 ? (tribe.ex ? 2.6 : 0.8) : 0;
      p.vx += ((d ? (dx / d) * Math.min(sp, d) : 0) - p.vx) * Math.min(1, dt * 3);
      p.vy += ((d ? (dy / d) * Math.min(sp, d) : 0) - p.vy) * Math.min(1, dt * 3);
      const nx = p.x + p.vx * dt;
      const ny = p.y + p.vy * dt;
      if (isLand(is, nx, ny)) {
        p.x = nx;
        p.y = ny;
      }
      const moving = Math.hypot(p.vx, p.vy) > 0.12;
      const left = moving ? p.vx < 0 : frag.spear.x < p.x;
      const x = p.x;
      const yy = p.y;
      const hop = moving ? Math.abs(Math.sin(t * 7 + p.ph * 3)) * 2 : 0;
      const lit = p.lit >= 0 ? t - p.lit : -1;
      sprites.push({
        y: yy,
        draw: () => {
          this.drawBeing(b, look, x, yy, { left, frame: moving ? Math.floor(t * 8 + p.ph) % 2 : 0, sleeping: sleeping && !struck, hop });
          // The spark as it reaches them: a point of light over each head, fading.
          if (lit >= 0 && lit < 3) this.spark(b, x, yy, lit);
          if (i === this.chosen) {
            // Picked out: a small gold mark over their head.
            const X = Math.round(this.sx(x));
            const Y = Math.round(this.py(x, yy) - Math.max(7, 2.4 * this.zoom) - (Math.floor(t * 2) % 2));
            b.fillStyle = 'rgba(245, 196, 94, 0.996)';
            b.fillRect(X - 1, Y, 3, 1);
            b.fillRect(X, Y + 1, 1, 1);
          }
        },
      });
    });
    if (spread >= 0) {
      // The wave itself: a soft ring of gold going out over the ground.
      const reach = Math.max(...this.people.map((p) => Math.hypot(p.x - from.x, p.y - from.y)), 10);
      if (spread < reach + 6) {
        const X = this.sx(from.x);
        const Y = this.py(from.x, from.y);
        const rr = spread * this.zoom;
        const steps = Math.ceil(rr * 3) + 8;
        b.fillStyle = `rgba(255, 220, 140, ${0.996})`;
        b.globalAlpha = Math.max(0, 0.8 - spread / (reach + 6) * 0.5);
        for (let i = 0; i < steps; i++) {
          const a = (i / steps) * Math.PI * 2;
          const x = Math.round(X + Math.cos(a) * rr);
          const y = Math.round(Y + Math.sin(a) * rr * (this.shaded ? 0.6 : 1));
          if (x < -2 || x > W + 2 || y < -2 || y > H + 2) continue;
          b.fillRect(x, y, 1, 1);
        }
        b.globalAlpha = 1;
        // The camera goes with it, out to the others.
        const front = Math.min(1, spread / reach);
        const k = Math.min(1, dt * 2.5);
        this.camX += (from.x + (frag.camp.x - from.x) * front - this.camX) * k;
        this.camY += (from.y + (frag.camp.y - from.y) * front - 3 - this.camY) * k;
      }
    }

    // The walk: before they wake, the one you were walks alone from the camp out over the ash
    // to the lake's edge, the camera with it. Once the waking has reached the others, it
    // walks back to them.
    if (tribe.awake && this.walker) {
      const w = this.walker;
      // After the vision it runs back to the others, behind the light going out to them.
      const back = this.spreadAt >= 0 && t - this.spreadAt > 0.8;
      const dx = frag.camp.x - w.x;
      const dy = frag.camp.y - w.y;
      const d = Math.hypot(dx, dy);
      if (back && d < 2) {
        // Home: one of them again.
        this.walker = null;
      } else {
        if (back) {
          const step = Math.min(d, Math.max(6, Math.hypot(frag.camp.x - frag.spear.x, frag.camp.y - frag.spear.y) / 7) * dt);
          w.x += (dx / d) * step;
          w.y += (dy / d) * step;
        }
        const wx = w.x;
        const wy = w.y;
        const sinceTouch = this.wave >= 0 ? this.wave : 99;
        sprites.push({
          y: wy,
          draw: () => {
            this.drawBeing(b, look, wx, wy, { left: back ? dx < 0 : frag.spear.x < wx, frame: back ? Math.floor(t * 10) % 2 : 0, sleeping: false, hop: back ? Math.abs(Math.sin(t * 10)) * 2 : 0 });
            if (sinceTouch < 4) this.spark(b, wx, wy, sinceTouch * 0.75);
          },
        });
      }
    }
    if (!tribe.awake) {
      if (!this.walker) this.walker = { ...frag.camp };
      const w = this.walker;
      const dx = frag.spear.x - w.x;
      const dy = frag.spear.y - w.y;
      const d = Math.hypot(dx, dy);
      const stop = LAKE + 1.2;
      // After the strike, a beat while the camera finds them, then the walk.
      if (!this.hold && this.released < 0) this.released = t;
      const finding = this.hold || t - this.released < 3;
      const moving = d > stop + 0.05 && !finding;
      if (moving) {
        const sp = Math.max(2.5, Math.hypot(frag.spear.x - frag.camp.x, frag.spear.y - frag.camp.y) / 14);
        const step = Math.min(d - stop, sp * dt);
        w.x += (dx / d) * step;
        w.y += (dy / d) * step;
      } else if (d <= stop + 0.05) this.arrived = true;
      if (!this.hold) {
        const k = Math.min(1, dt * (finding ? 1.4 : 2.5));
        this.camX += (w.x - this.camX) * k;
        this.camY += (w.y - 3 - this.camY) * k;
        this.zoom += (3 - this.zoom) * Math.min(1, dt * (finding ? 1.2 : 2));
      }
      const wx = w.x;
      const wy = w.y;
      const hop = moving ? Math.abs(Math.sin(t * 7)) * 2 : 0;
      sprites.push({ y: wy, draw: () => this.drawBeing(b, look, wx, wy, { left: dx < 0, frame: moving ? Math.floor(t * 8) % 2 : 0, sleeping: false, hop }) });
    }

    // The goop round its foot, bubbling: slow blisters of glowing red rising and popping.
    for (let k = 0; k < 14; k++) {
      const cyc = (t * 0.35 + hash(k, 61) * 7) % 1;
      const a = hash(k, Math.floor(t * 0.35 + hash(k, 61) * 7) + 63) * Math.PI * 2;
      const r = Math.sqrt(hash(k, Math.floor(t * 0.35 + hash(k, 61) * 7) + 67)) * (LAKE - 0.8);
      const bx = Math.round(this.sx(frag.spear.x + Math.cos(a) * r));
      const by = Math.round(this.py(frag.spear.x + Math.cos(a) * r, frag.spear.y + Math.sin(a) * r));
      const size = cyc < 0.8 ? Math.max(1, Math.round((cyc / 0.8) * Math.max(1, this.zoom * 0.5))) : 0;
      if (size) {
        b.fillStyle = 'rgba(190, 60, 100, 0.996)';
        b.fillRect(bx - Math.floor(size / 2), by - size, size, size);
        b.fillStyle = 'rgba(255, 170, 200, 0.996)';
        b.fillRect(bx - Math.floor(size / 2), by - size, 1, 1);
      } else if (cyc < 0.86) {
        // Pop.
        b.fillStyle = 'rgba(255, 150, 180, 0.996)';
        b.fillRect(bx - 1, by - 1, 1, 1);
        b.fillRect(bx + 1, by - 1, 1, 1);
      }
    }

    if (tribe.ex) {
      this.drawWork(sprites, b, tribe.ex, frag.camp, t);
      this.drawPiles(sprites, b, dt);
    }

    // The spear, standing in its lake.
    const sx = this.sx(frag.spear.x);
    const sy = this.py(frag.spear.x, frag.spear.y);
    sprites.push({ y: frag.spear.y, draw: () => this.drawSpear(b, sx, sy, t, tribe.awake) });

    sprites.sort((a, c) => a.y - c.y);
    for (const s of sprites) s.draw();
    for (const m of this.smoke) {
      if (this.zoom < 1.2) break;
      const X = Math.round(this.sx(m.x));
      const Y = Math.round(this.py(m.x, m.y) - m.z * this.zoom * 0.6);
      const k = Math.min(1, m.life / 2) * Math.min(1, m.z) * 0.3;
      b.fillStyle = `rgba(110, 104, 100, ${k})`;
      const sz = Math.max(1, Math.round((0.6 + m.z * 0.12) * this.zoom * 0.35));
      b.fillRect(X - sz, Y - sz, sz * 2, sz * 2);
    }

    this.drawWonders(b, t, dt);
    if (tribe.ex) this.drawCrisis(b, tribe.ex, t);
    // The ash winter: coming on over a few days, holding, then lifting.
    this.ash = tribe.ex ? ashWinter(tribe.ex.day + tribe.ex.clock / EX_DAY) : 0;
    this.drawAshfall(b, t);
    this.drawStroke(b, dt);

    // A red haze over the burnt world, thinning as it cools.
    b.fillStyle = `rgba(150, 30, 20, ${0.16 * heat * (1 - this.ash)})`;
    b.fillRect(0, 0, W, H);

    // The waking: a shockwave of purple and red light rolls out from the spear across the
    // whole world (it glows: the shader blooms it), the air itself tinted for a moment.
    if (this.wave >= 0) {
      this.wave += dt;
      const w = this.wave;
      // A flash as it's touched, then the air tinted purple.
      if (w < 0.25) {
        b.fillStyle = `rgba(255, 245, 255, ${1 - w / 0.25})`;
        b.fillRect(0, 0, W, H);
      }
      if (w < 2) {
        b.fillStyle = `rgba(150, 50, 180, ${0.35 * (1 - w / 2)})`;
        b.fillRect(0, 0, W, H);
      }
      const tall = this.spearHeight();
      const cy = sy - tall * 0.15;
      for (let k = 0; k < 4; k++) {
        const r = (w - k * 0.22) * Math.max(W, H) * 0.9;
        if (r <= 0) continue;
        const fade = Math.max(0, 1 - r / (Math.max(W, H) * 1.6));
        if (fade <= 0) continue;
        const col = k % 2 ? `rgba(230, 60, 90, 0.996)` : `rgba(170, 70, 255, 0.996)`;
        const steps = Math.ceil(r * 3);
        b.globalAlpha = fade;
        b.fillStyle = col;
        for (let i = 0; i < steps; i++) {
          const a = (i / steps) * Math.PI * 2;
          const x = Math.round(sx + Math.cos(a) * r);
          const y2 = Math.round(cy + Math.sin(a) * r * 0.62);
          if (x < -2 || x > W + 2 || y2 < -2 || y2 > H + 2) continue;
          b.fillRect(x, y2, 2, 1);
        }
        b.globalAlpha = 1;
      }
      if (w > 5) this.wave = -1;
    }

    // Once there: a pulse at the spear, so it's plain it's the thing to touch.
    if (!tribe.awake && this.arrived && Math.floor(t * 1.5) % 2) {
      const tall = this.spearHeight();
      b.fillStyle = PAL.y;
      b.fillRect(Math.round(sx) - 1, Math.round(sy - tall - 10), 3, 5);
      b.fillRect(Math.round(sx) - 1, Math.round(sy - tall - 3), 3, 2);
    }
    this.fx.run(f);
  }

  /** The spear: a long twisted shaft, dark red and black, forked at the head, faint light
   * running up it. Not a thing anyone here could have made. */
  private drawSpear(b: CanvasRenderingContext2D, X: number, Y: number, t: number, awake: boolean): void {
    const tall = this.spearHeight();
    const w = Math.max(1, Math.round(tall / 22));
    const x0 = Math.round(X);
    const y0 = Math.round(Y);
    // Shadow, and the scorch where it went in.
    b.fillStyle = 'rgba(0, 0, 0, 0.35)';
    b.fillRect(x0 - 3 * w, y0, 7 * w, w);
    for (let i = 0; i < tall; i++) {
      // Two strands twisting round each other.
      const k = i / tall;
      // The strands twist round each other as the whole spear turns.
      const tw = Math.sin(k * 14 + t * SPIN) * w;
      b.fillStyle = '#5a1018';
      b.fillRect(x0 - w + Math.round(tw), y0 - i, w, 1);
      b.fillStyle = '#2a0a10';
      b.fillRect(x0 - Math.round(tw), y0 - i, w, 1);
      // Light running up it now and then (it glows, so the shader blooms it).
      const run = (t * 0.35 + k) % 1;
      if (run < 0.06) {
        b.fillStyle = 'rgba(255, 90, 110, 0.996)';
        b.fillRect(x0, y0 - i, 1, 1);
      }
    }
    // The fork: two prongs curving apart at the head.
    const top = y0 - tall;
    const prong = Math.max(4, Math.round(tall * 0.22));
    b.fillStyle = '#6a1420';
    // Turning slowly: the prongs swing round (seen edge-on, they close together).
    const turn = Math.cos(t * SPIN * 0.5);
    for (let i = 0; i < prong; i++) {
      const spread = Math.round((i / prong) ** 1.5 * prong * 0.45 * turn);
      b.fillRect(x0 - spread - w, top - i, w, 1);
      b.fillRect(x0 + spread, top - i, w, 1);
    }
    if (!awake || Math.sin(t * 2) > 0.6) {
      const tip = Math.round(prong * 0.45 * turn);
      b.fillStyle = 'rgba(255, 120, 140, 0.996)';
      b.fillRect(x0 - tip - w, top - prong, w, 1);
      b.fillRect(x0 + tip, top - prong, w, 1);
    }
  }
}
