// The Creature stage scene: the land seen from above, a new way of looking after
// two stages of peering side-on into water. The herd moves as a herd: it drifts
// between grazing spots, beds down at the nests at night, huddles in winter and
// scatters from a stalking beast. Every Field Guide place sits somewhere on the
// map under fog; your creature walks off into the fog to roam, and finding a
// place clears it. As the home range grows, so does the land you can see.
//
// The creatures themselves are drawn side-on (the old pixel-RPG convention), sorted
// by depth so nearer ones overlap farther ones.

import { PAL } from '../art/sprites';
import { STAGES } from '../content/stages';
import { canEat } from '../economy/actions';
import { statsOf } from '../economy/creature';
import { seasonOf } from '../economy/rates';
import type { FoodKind, GameState, Role } from '../economy/types';
import { drawBlob, type BlobStyle } from './blob';
import { creatureLookOf, drawCreature, drawMini, type CreatureLook } from './creatureLook';
import { Effects, hash, mixColor, visibleCount, type Frame } from './paint';
import type { PondEvent } from './pond';

type Pt = { x: number; y: number };

interface Member {
  x: number;
  y: number;
  vx: number;
  vy: number;
  role: Role;
  phase: number;
  /** Seconds left running from a beast. */
  flee: number;
}

interface Bug {
  x: number;
  y: number;
  hop: number;
  age: number;
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

type Biome = 'sea' | 'sand' | 'grass' | 'forest' | 'rock' | 'marsh' | 'pool' | 'high';

/** Each season's ground: grass, darker grass, flowers or none, the sea. */
const SEASON_LAND = [
  { grass: '#6faa5c', dark: '#5a9450', forest: '#2f7048', sea: '#3f8aa5', marsh: '#4f8f7a', high: '#7f9e5a' },
  { grass: '#86b050', dark: '#709a42', forest: '#3b7a3e', sea: '#3f8aa5', marsh: '#5a9070', high: '#94a85a' },
  { grass: '#b39a52', dark: '#9a8244', forest: '#a8582e', sea: '#3a7d98', marsh: '#7a8058', high: '#a08a56' },
  { grass: '#e8eef0', dark: '#cdd8de', forest: '#5d7a6a', sea: '#2f6a86', marsh: '#bcd6e2', high: '#dfe6ea' },
];

const BEAST_STYLE: BlobStyle = { edge: '#e8615a', body: '#7a3a2a', nucleus: '#2a1008' };
const BEAST_FLINCH: BlobStyle = { edge: PAL.w, body: '#b0503a', nucleus: '#2a1008' };
/** Seconds in a day; the last quarter is night. */
const DAY_SEC = 120;
/** Art pixels per second for the herd, and for your creature before Speed. */
const HERD_WALK = 7;
const WALK = 13;

export class RangeScene {
  private fx = new Effects();
  private events: PondEvent[] = [];
  private me = { x: 0, y: 0, tx: null as number | null, ty: 0, left: false, idle: 0, away: false, placed: false };
  private members: Member[] = [];
  private bugs: Bug[] = [];
  private berries: number[] = [];
  private beast: Beast | null = null;
  private beastTimer = 50;
  private visitor: { x: number; y: number; tx: number; ty: number; life: number; look: CreatureLook } | null = null;
  private visitorTimer = 40;
  /** Where the herd is grazing now, and when it moves on. */
  private graze: Pt | null = null;
  private grazeTimer = 0;
  private flakes: { x: number; y: number; v: number }[] = [];
  private terrain: HTMLCanvasElement | null = null;
  private terrainKey = '';
  private biomes: Biome[] = [];
  private W = 0;
  private places: Record<string, Pt> = {};
  /** Where it last roamed, so it comes home from there. */
  private lastPlace: Pt | null = null;
  private home: Pt = { x: 0, y: 0 };

  reset(): void {
    this.fx.clear();
    this.members = [];
    this.bugs = [];
    this.beast = null;
    this.visitor = null;
    this.graze = null;
    this.me.placed = false;
    this.terrainKey = '';
  }

  drain(): PondEvent[] {
    return this.events.splice(0);
  }

  /** Hits needed to drive a beast off: fewer with Strength. */
  private hitsNeeded(state: GameState): number {
    const s = statsOf(state).strength;
    return s >= 15 ? 1 : s >= 6 ? 2 : 3;
  }

  private hitBeast(state: GameState, b: Beast): void {
    b.hits++;
    b.flinch = 0.4;
    if (b.hits >= this.hitsNeeded(state)) {
      b.fleeing = true;
      this.events.push({ type: 'fend', x: b.x, y: b.y - 6 });
    } else this.events.push({ type: 'hit', x: b.x, y: b.y - 6 });
  }

  tap(state: GameState, x: number, y: number): void {
    const b = this.beast;
    if (b && !b.fleeing && Math.hypot(x - b.x, y - (b.y - 4)) < 12) {
      this.hitBeast(state, b);
      return;
    }
    const v = this.visitor;
    if (v && Math.hypot(x - v.x, y - (v.y - 5)) < 12) {
      this.events.push({ type: 'court', x: v.x, y: v.y - 10 });
      this.visitor = null;
      return;
    }
    if (this.me.away || !this.revealed(state, x, y) || !this.land(x, y)) return;
    this.me.tx = x;
    this.me.ty = y;
    this.me.idle = 0;
  }

  purchase(state: GameState, id: string): void {
    void state;
    if (id === 'trip') return;
    const at = this.me.away ? this.home : this.me;
    this.fx.sparkle(at.x, at.y - 8);
    this.fx.pulse(at.x, at.y - 4, PAL.y);
  }

  // ---- The map ----

  /** Where everything sits, over the whole screen. Home is near the top, so it shows
   * above the open tab sheet; close the sheet to see the rest of the land. */
  private layout(f: Frame): void {
    const { W, H, top } = f;
    const map = H - top;
    const at = (u: number, v: number): Pt => ({ x: Math.round(u * W), y: Math.round(top + v * map) });
    this.home = at(0.55, 0.2);
    this.places = {
      shore: at(0.22, 0.17),
      cliffs: at(0.3, 0.04),
      caves: at(0.88, 0.05),
      tidePools: at(0.2, 0.42),
      forest: at(0.8, 0.3),
      marsh: at(0.66, 0.56),
      highlands: at(0.5, 0.86),
    };
  }

  private coast(y: number): number {
    return this.W * 0.1 + Math.sin(y * 0.08) * 3 + Math.sin(y * 0.21) * 2;
  }

  /** Smooth 2D value noise in [0, 1). */
  private noise(x: number, y: number, s: number, salt: number): number {
    const gx = x / s;
    const gy = y / s;
    const ix = Math.floor(gx);
    const iy = Math.floor(gy);
    const fx = gx - ix;
    const fy = gy - iy;
    const h = (a: number, b: number) => hash(a * 57 + b * 131, salt);
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const top = h(ix, iy) + (h(ix + 1, iy) - h(ix, iy)) * sx;
    const bot = h(ix, iy + 1) + (h(ix + 1, iy + 1) - h(ix, iy + 1)) * sx;
    return top + (bot - top) * sy;
  }

  private biome(x: number, y: number): Biome {
    const c = this.coast(y);
    if (x < c) return 'sea';
    const d = (id: string) => Math.hypot(x - this.places[id].x, y - this.places[id].y);
    const wob = this.noise(x, y, 6, 3) * 8;
    if (d('tidePools') < 14 + wob && x < c + 20) return 'pool';
    if (x < c + 4) return 'sand';
    if (d('cliffs') < 17 + wob || d('caves') < 15 + wob) return 'rock';
    if (d('marsh') < 20 + wob) return 'marsh';
    if (d('forest') < 22 + wob) return 'forest';
    if (y > this.places.highlands.y - 24 - wob) return 'high';
    return 'grass';
  }

  land(x: number, y: number): boolean {
    const b = this.biomes[Math.round(y) * this.W + Math.round(x)];
    return !!b && b !== 'sea' && b !== 'rock';
  }

  /** How far the land is known around home: wider with the range and each generation. */
  private knownRadius(state: GameState): number {
    const c = state.stages.creature;
    return 26 + 4 * Math.min(10, c.generation) + 7 * Math.min(10, c.generators.territory) + Math.min(12, c.generators.burrow);
  }

  revealed(state: GameState, x: number, y: number): boolean {
    return this.fog(state, x, y) < 0.5;
  }

  /** 0 = clear, 1 = thick fog. Home and every place found are clear. */
  private fog(state: GameState, x: number, y: number): number {
    const c = state.stages.creature;
    let clear = (this.knownRadius(state) - Math.hypot(x - this.home.x, y - this.home.y)) / 6;
    for (const [id, p] of Object.entries(this.places)) {
      if ((c.trips[id] ?? 0) > 0) clear = Math.max(clear, (26 - Math.hypot(x - p.x, y - p.y)) / 6);
    }
    return Math.max(0, Math.min(1, 0.5 - clear));
  }

  /** Paints the ground and the fog once, until the season or what's known changes. */
  private paintTerrain(f: Frame, state: GameState): void {
    const c = state.stages.creature;
    const { season } = seasonOf(state);
    const si = ['Spring', 'Summer', 'Autumn', 'Winter'].indexOf(season.name);
    const key = [f.W, f.H, f.top, f.bottom, si, c.generation, c.generators.territory, c.generators.burrow, Object.keys(c.trips).join()].join('|');
    if (key === this.terrainKey && this.terrain) return;
    this.terrainKey = key;
    const { W, H } = f;
    const cv = this.terrain ?? document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    this.terrain = cv;
    const b = cv.getContext('2d')!;
    const img = b.createImageData(W, H);
    const L = SEASON_LAND[si];
    const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const col = {
      sea: rgb(L.sea),
      seaDeep: rgb(mixColor(L.sea, '#1f3f5a', 0.4)),
      sand: rgb(PAL.s),
      sandDark: rgb(PAL.S),
      grass: rgb(L.grass),
      grassDark: rgb(L.dark),
      forest: rgb(L.forest),
      forestHi: rgb(mixColor(L.forest, '#ffffff', 0.18)),
      forestLo: rgb(mixColor(L.forest, '#000000', 0.3)),
      rock: rgb(PAL.r),
      rockHi: rgb(PAL.R),
      marsh: rgb(L.marsh),
      water: rgb(si === 3 ? '#cfe4ee' : '#3f7f95'),
      reed: rgb(si === 2 ? '#a0884a' : '#3e6e3a'),
      high: rgb(L.high),
      highDark: rgb(mixColor(L.high, '#000000', 0.18)),
      fog: rgb('#d4dbe0'),
      fogDark: rgb('#b9c3cb'),
      flower: rgb(PAL.y),
      flower2: rgb(PAL.w),
      snow: rgb('#f6f9fa'),
    };
    this.biomes = new Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const bi = this.biome(x, y);
        this.biomes[y * W + x] = bi;
        const n = this.noise(x, y, 4, 7);
        const n2 = hash(x * 13 + y * 7, 5);
        let p: number[];
        switch (bi) {
          case 'sea':
            p = x < this.coast(y) - 8 ? col.seaDeep : col.sea;
            break;
          case 'sand':
            p = n2 < 0.12 ? col.sandDark : col.sand;
            break;
          case 'pool':
            p = this.noise(x, y, 3, 11) > 0.6 ? col.water : n2 < 0.3 ? col.rockHi : col.rock;
            break;
          case 'rock': {
            // Lit from the top left: a light edge where the rock above is lower.
            const r = this.noise(x, y, 5, 13);
            p = r > 0.62 ? col.rockHi : r < 0.3 ? mixRgb(col.rock, [30, 36, 40], 0.4) : col.rock;
            break;
          }
          case 'marsh':
            p = this.noise(x, y, 3, 17) > 0.58 ? col.water : n2 < 0.25 ? col.reed : col.marsh;
            break;
          case 'forest': {
            // Round tree crowns: brighter on top, dark in the gaps.
            const t = this.noise(x, y, 3, 19);
            p = t > 0.66 ? col.forestHi : t < 0.32 ? col.forestLo : col.forest;
            break;
          }
          case 'high':
            p = Math.sin(y * 0.5 + this.noise(x, y, 8, 23) * 6) > 0.8 ? col.highDark : col.high;
            break;
          default:
            p = n > 0.62 ? col.grassDark : col.grass;
            if (si === 0 && n2 < 0.02) p = n2 < 0.008 ? col.flower : col.flower2;
        }
        // Fog over what hasn't been found: dithered at its edge.
        const fg = this.fog(state, x, y);
        if (fg > 0) {
          const solid = fg >= 1 || hash(x * 3 + y * 17, 29) < fg * 1.6 - 0.3;
          if (solid) p = this.noise(x, y, 7, 31) > 0.55 ? col.fogDark : col.fog;
        }
        const i = (y * W + x) * 4;
        img.data[i] = p[0];
        img.data[i + 1] = p[1];
        img.data[i + 2] = p[2];
        img.data[i + 3] = 255;
      }
    }
    b.putImageData(img, 0, 0);
    // Cave mouths in the rock, once they're found.
    if ((c.trips.caves ?? 0) > 0) {
      const p = this.places.caves;
      for (const [dx, dy] of [[-4, 2], [3, -1]]) {
        b.fillStyle = PAL.k;
        b.fillRect(p.x + dx - 2, p.y + dy - 1, 4, 3);
        b.fillRect(p.x + dx - 1, p.y + dy - 2, 2, 1);
      }
    }
  }

  // ---- The herd ----

  /** Keeps the drawn herd in step with the real one: a sample of it, roles in proportion. */
  private syncHerd(state: GameState): void {
    const st = state.stages.creature;
    const pop = Math.max(1, Math.floor(st.pop));
    const n = visibleCount(pop - 1, 18);
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
        const a = Math.random() * Math.PI * 2;
        const d = fresh ? 4 + Math.random() * 14 : 2;
        this.members.push({ x: this.home.x + Math.cos(a) * d, y: this.home.y + Math.sin(a) * d * 0.6, vx: 0, vy: 0, role: r, phase: Math.random() * 10, flee: 0 });
      }
      let extra = have - want[r]!;
      if (extra > 0) this.members = this.members.filter((m) => m.role !== r || extra-- <= 0);
    }
  }

  /** A grassy spot within what's known, for the herd to wander to next. */
  private pickGraze(state: GameState): Pt {
    const r = this.knownRadius(state) * 0.7;
    for (let i = 0; i < 20; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = Math.random() * r;
      const p = { x: this.home.x + Math.cos(a) * d, y: this.home.y + Math.sin(a) * d * 0.7 };
      if (this.land(p.x, p.y) && this.biomes[Math.round(p.y) * this.W + Math.round(p.x)] !== 'forest') return p;
    }
    return { ...this.home };
  }

  private nestSpots(n: number): Pt[] {
    return Array.from({ length: n }, (_, i) => ({ x: this.home.x - 6 + (i % 3) * 6 - (i >> 1), y: this.home.y + 2 + Math.floor(i / 3) * 4 }));
  }

  private burrowSpots(n: number): Pt[] {
    return Array.from({ length: n }, (_, i) => {
      const a = -0.6 + i * 0.55;
      return { x: this.home.x + Math.cos(a) * 15, y: this.home.y - 4 + Math.sin(a) * 8 };
    });
  }

  private berrySpots(): Pt[] {
    return Array.from({ length: 6 }, (_, i) => ({ x: this.home.x + Math.round((hash(i, 41) - 0.5) * 50), y: this.home.y + Math.round((hash(i, 43) - 0.5) * 34) }));
  }

  draw(f: Frame, state: GameState): void {
    const { b, W, H, t, dt, top } = f;
    this.W = W;
    this.layout(f);
    this.paintTerrain(f, state);
    const st = state.stages.creature;
    const gens = st.generators;
    const look = creatureLookOf(state);
    const { season } = seasonOf(state);
    const winter = season.name === 'Winter';
    // Night: the last quarter of each day, fading in and out.
    const dayT = (t % DAY_SEC) / DAY_SEC;
    const night = Math.max(0, Math.min(1, (Math.abs(dayT - 0.875) < 0.125 ? 1 : 0) * Math.min(1, (0.125 - Math.abs(dayT - 0.875)) * 40)));
    const asleep = night > 0.5;

    b.drawImage(this.terrain!, 0, 0);
    // Glints on the sea and the marsh pools.
    b.fillStyle = PAL.b;
    for (let i = 0; i < 10; i++) {
      const y = top + Math.floor(hash(i, 51) * (H - top));
      const x = Math.floor(this.coast(y) - 3 - ((t * 2 + i * 7) % 12));
      if (x > 0) b.fillRect(x, y, 2, 1);
    }

    // What the herd has made of home: nests (with the egg), burrow mounds, berry bushes.
    const nests = this.nestSpots(Math.min(6, Math.max(1, gens.nest)));
    for (const n of nests) {
      b.fillStyle = PAL.S;
      b.fillRect(n.x - 2, n.y - 1, 5, 2);
      b.fillStyle = PAL.Y;
      b.fillRect(n.x - 1, n.y - 1, 3, 1);
    }
    if (st.egg) {
      const n = nests[0];
      const wob = st.egg.left < 30 ? Math.round(Math.sin(t * 12)) : 0;
      b.fillStyle = PAL.w;
      b.fillRect(n.x - 1 + wob, n.y - 4, 3, 3);
      b.fillRect(n.x + wob, n.y - 5, 1, 1);
      b.fillStyle = PAL.p;
      b.fillRect(n.x + wob, n.y - 3, 1, 1);
    }
    for (const p of this.burrowSpots(Math.min(8, gens.burrow))) {
      b.fillStyle = '#7a5a3a';
      b.fillRect(p.x - 3, p.y, 6, 2);
      b.fillStyle = '#3a2a1a';
      b.fillRect(p.x - 1, p.y, 3, 2);
    }
    const bushes = this.berrySpots();
    while (this.berries.length < bushes.length) this.berries.push(3);
    const edible = { algae: canEat(state, 'creature', 'algae'), bacteria: canEat(state, 'creature', 'bacteria') };
    bushes.forEach((p, i) => {
      if (!this.land(p.x, p.y) || !this.revealed(state, p.x, p.y)) return;
      // Berries grow back, but not in winter.
      if (!winter) this.berries[i] = Math.min(3, this.berries[i] + dt * 0.08);
      b.fillStyle = winter ? '#8a9a8a' : PAL.L;
      b.fillRect(p.x - 3, p.y - 3, 7, 4);
      b.fillRect(p.x - 2, p.y - 4, 5, 1);
      b.fillStyle = winter ? '#a8b8a8' : PAL.l;
      b.fillRect(p.x - 2, p.y - 4, 2, 1);
      b.globalAlpha = edible.algae ? 1 : 0.5;
      b.fillStyle = PAL.p;
      for (let k = 0; k < Math.floor(this.berries[i]); k++) b.fillRect(p.x - 2 + k * 2, p.y - 2 + (k % 2), 1, 1);
      b.globalAlpha = 1;
    });

    // Bugs hop about the grass near home.
    if (!winter && this.bugs.length < 4 && Math.random() < dt * 0.3) {
      const p = this.pickGraze(state);
      this.bugs.push({ x: p.x, y: p.y, hop: -1, age: 0 });
    }

    // The places still to find: a "?" in the fog, where the next roam could go.
    for (const pl of STAGES.creature.places!) {
      if ((st.trips[pl.id] ?? 0) > 0) continue;
      const open = (pl.after ?? []).every((id) => (st.trips[id] ?? 0) > 0);
      if (!open) continue;
      const p = this.places[pl.id];
      if (Math.floor(t * 1.5) % 2 || st.trip?.place === pl.id) {
        b.fillStyle = PAL.k;
        b.fillRect(p.x - 1, p.y - 4, 3, 1);
        b.fillRect(p.x + 1, p.y - 3, 1, 1);
        b.fillRect(p.x, p.y - 2, 1, 1);
        b.fillRect(p.x, p.y, 1, 1);
      }
    }

    // A trail of footprints out to where it's roaming.
    if (st.trip) {
      const p = this.places[st.trip.place];
      const done = 1 - st.trip.left / st.trip.total;
      const steps = Math.floor(Math.hypot(p.x - this.home.x, p.y - this.home.y) / 4);
      b.fillStyle = mixColor(PAL.S, '#000000', 0.2);
      for (let i = 1; i < steps; i++) {
        const k = i / steps;
        // Out, then back: the prints reach as far as it has gone.
        if (k > Math.min(1, done * 2)) break;
        b.fillRect(Math.round(this.home.x + (p.x - this.home.x) * k + (i % 2 ? 1 : -1)), Math.round(this.home.y + (p.y - this.home.y) * k), 1, 1);
      }
    }

    // ---- Everyone who moves, sorted by depth. ----
    this.syncHerd(state);
    this.grazeTimer -= dt;
    if (!this.graze || this.grazeTimer <= 0) {
      this.graze = this.pickGraze(state);
      this.grazeTimer = 20 + Math.random() * 15;
    }
    const center = asleep || winter ? this.home : this.graze;
    // Bedded down at night and huddled in winter: closer, but still a body apart.
    const spread = (asleep || winter ? 5 : 10) + Math.sqrt(this.members.length) * (asleep || winter ? 2 : 3);
    const bt = this.beast && !this.beast.fleeing ? this.beast : null;
    const sprites: { y: number; draw: () => void }[] = [];
    this.members.forEach((m, i) => {
      // Where instinct takes each one.
      let gx = center.x + Math.cos(i * 2.4 + m.phase) * spread * (0.4 + hash(i, 61) * 0.6);
      let gy = center.y + Math.sin(i * 2.4 + m.phase) * spread * 0.55 * (0.4 + hash(i, 61) * 0.6);
      if (!asleep) {
        if (m.role === 'carer') {
          const n = nests[i % nests.length];
          gx = n.x + Math.sin(t * 0.3 + m.phase) * 3;
          gy = n.y + 3;
        } else if (m.role === 'digger' && gens.burrow > 0) {
          const p = this.burrowSpots(Math.min(8, gens.burrow))[i % Math.min(8, gens.burrow)];
          gx = p.x + 3;
          gy = p.y + 2;
        } else if (m.role === 'guard') {
          // Sentries ring the herd, a little way out, facing out; at a beast, they charge.
          const a = (i * 2.4) % (Math.PI * 2);
          gx = center.x + Math.cos(a) * (spread + 10);
          gy = center.y + Math.sin(a) * (spread + 10) * 0.6;
          if (bt) {
            gx = bt.x;
            gy = bt.y + 2;
          }
        } else {
          gx += Math.sin(t * 0.17 + m.phase * 3) * 4;
          gy += Math.cos(t * 0.13 + m.phase * 2) * 2;
        }
      }
      // A beast close by: run from it (sentries excepted).
      if (bt && m.role !== 'guard' && Math.hypot(bt.x - m.x, bt.y - m.y) < 22) m.flee = 2;
      m.flee = Math.max(0, m.flee - dt);
      if (m.flee > 0 && bt) {
        const d = Math.hypot(m.x - bt.x, m.y - bt.y) || 1;
        gx = m.x + ((m.x - bt.x) / d) * 20;
        gy = m.y + ((m.y - bt.y) / d) * 12;
      }
      // Keep a body's width apart.
      for (const o of this.members) {
        if (o === m) continue;
        const ox = m.x - o.x;
        const oy = m.y - o.y;
        const od = Math.hypot(ox, oy);
        if (od > 0 && od < 7) {
          gx += (ox / od) * (7 - od) * 3;
          gy += (oy / od) * (7 - od) * 2;
        }
      }
      const dx = gx - m.x;
      const dy = gy - m.y;
      const d = Math.hypot(dx, dy);
      const sp = (m.flee > 0 || (m.role === 'guard' && bt) ? 22 : HERD_WALK) * (d > 1 ? 1 : 0);
      m.vx += ((d ? (dx / d) * Math.min(sp, d * 2) : 0) - m.vx) * Math.min(1, dt * 3);
      m.vy += ((d ? (dy / d) * Math.min(sp, d * 2) : 0) - m.vy) * Math.min(1, dt * 3);
      const nx = m.x + m.vx * dt;
      const ny = m.y + m.vy * dt;
      if (this.land(nx, ny)) {
        m.x = nx;
        m.y = ny;
      } else {
        m.vx = -m.vx;
        m.vy = -m.vy;
      }
      // Sentries strike the beast they reach.
      if (m.role === 'guard' && bt && bt.flinch <= 0 && Math.hypot(bt.x - m.x, bt.y - m.y) < 7 && Math.random() < dt * 1.2) this.hitBeast(state, bt);
      const moving = Math.hypot(m.vx, m.vy) > 1;
      const left = moving ? m.vx < 0 : m.role === 'guard' ? m.x < center.x : Math.sin(m.phase * 3) < 0;
      const peck = !moving && !asleep && (m.role === 'forager' || m.role === 'digger') && Math.sin(t * 3 + m.phase * 5) > 0.6 ? 1 : 0;
      const x = m.x;
      const y = m.y;
      sprites.push({
        y,
        draw: () => {
          drawMini(b, look, x, y + peck, { left, frame: moving ? Math.floor(t * 8 + m.phase) % 2 : 0, sleeping: asleep });
          if (asleep && Math.floor(t + m.phase) % 3 === 0) {
            b.fillStyle = PAL.w;
            b.fillRect(Math.round(x + 2), Math.round(y - 9 - ((t + m.phase) % 1) * 3), 1, 1);
          }
          if (m.role === 'digger' && peck && Math.floor(t * 6 + m.phase) % 3 === 0) {
            b.fillStyle = '#3a2a1a';
            b.fillRect(Math.round(x + (left ? 3 : -3)), Math.round(y - 3), 1, 1);
          }
        },
      });
    });

    // Bugs.
    for (const q of this.bugs) {
      q.age += dt;
      if (q.hop < 0 && Math.random() < dt * 0.5) q.hop = 0;
      let lift = 0;
      if (q.hop >= 0) {
        q.hop += dt;
        const d = Math.hypot(q.x - this.me.x, q.y - this.me.y) || 1;
        const nx = q.x + ((q.x - this.me.x) / d) * 14 * dt;
        const ny = q.y + ((q.y - this.me.y) / d) * 8 * dt;
        if (this.land(nx, ny)) {
          q.x = nx;
          q.y = ny;
        }
        lift = Math.round(Math.sin(Math.min(1, q.hop / 0.4) * Math.PI) * 3);
        if (q.hop > 0.4) q.hop = -1;
      }
      const x = Math.round(q.x);
      const y = Math.round(q.y);
      sprites.push({
        y,
        draw: () => {
          b.globalAlpha = edible.bacteria ? 1 : 0.5;
          b.fillStyle = PAL.k;
          b.fillRect(x - 1, y - lift, 3, 1);
          b.fillStyle = PAL.P;
          b.fillRect(x, y - 1 - lift, 1, 1);
          b.globalAlpha = 1;
        },
      });
    }

    // A beast slinks in from the fog now and then, and stalks the nearest of the herd.
    this.beastTimer -= dt;
    if (!this.beast && this.beastTimer <= 0 && !asleep) {
      const a = Math.random() * Math.PI * 2;
      const r = this.knownRadius(state) + 8;
      const x = Math.max(this.coast(this.home.y) + 6, Math.min(W - 4, this.home.x + Math.cos(a) * r));
      const y = Math.max(top + 4, Math.min(H - 4, this.home.y + Math.sin(a) * r * 0.7));
      this.beast = { x, y, hits: 0, flinch: 0, fleeing: false, life: 30, left: false };
      this.beastTimer = 60 + Math.random() * 45;
    }
    const beast = this.beast;
    if (beast) {
      beast.life -= dt;
      beast.flinch = Math.max(0, beast.flinch - dt);
      if (beast.life <= 0) beast.fleeing = true;
      let tx = this.home.x;
      let ty = this.home.y;
      if (beast.fleeing) {
        tx = beast.x + (beast.x - this.home.x) * 4;
        ty = beast.y + (beast.y - this.home.y) * 4;
      } else if (this.members.length) {
        const prey = this.members.reduce((a, m) => (Math.hypot(m.x - beast.x, m.y - beast.y) < Math.hypot(a.x - beast.x, a.y - beast.y) ? m : a));
        tx = prey.x;
        ty = prey.y;
      }
      const d = Math.hypot(tx - beast.x, ty - beast.y) || 1;
      const sp = beast.fleeing ? 26 : beast.flinch > 0 ? 0 : 6;
      beast.x += ((tx - beast.x) / d) * sp * dt;
      beast.y += ((ty - beast.y) / d) * sp * dt;
      if (Math.abs(tx - beast.x) > 1) beast.left = tx < beast.x;
      // It snatches berries it passes.
      bushes.forEach((p, i) => {
        if (Math.hypot(p.x - beast.x, p.y - beast.y) < 5) this.berries[i] = Math.max(0, this.berries[i] - dt);
      });
      const bx = beast.x;
      const by = beast.y;
      const dir = beast.left ? -1 : 1;
      const wob = beast.flinch > 0 ? 1.3 : 1;
      const hits = beast.hits;
      const fleeing = beast.fleeing;
      sprites.push({
        y: by,
        draw: () => {
          b.fillStyle = 'rgba(16,20,31,0.25)';
          b.fillRect(Math.round(bx - 6), Math.round(by), 12, 2);
          drawBlob(b, [{ x: bx, y: by - 5, r: 4.5 * wob, nucleus: false }, { x: bx + dir * 5, y: by - 7, r: 2.8, nucleus: false }, { x: bx - dir * 5, y: by - 4, r: 2, nucleus: false }], beast.flinch > 0 ? BEAST_FLINCH : BEAST_STYLE);
          b.fillStyle = PAL.y;
          b.fillRect(Math.round(bx + dir * 6), Math.round(by - 8), 1, 1);
          if (!fleeing && hits > 0) {
            b.fillStyle = PAL.w;
            for (let i = 0; i < hits; i++) b.fillRect(Math.round(bx - 2 + i * 2), Math.round(by - 13), 1, 1);
          }
        },
      });
      if (fleeing && (bx < -20 || bx > W + 20 || by < -20 || by > H + 20 || !this.revealed(state, bx, by))) this.beast = null;
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
      const r = this.knownRadius(state) + 6;
      const x = Math.max(this.coast(this.home.y) + 6, Math.min(W - 6, this.home.x + Math.cos(a) * r));
      const y = Math.max(top + 6, Math.min(H - 6, this.home.y + Math.sin(a) * r * 0.7));
      const g = this.pickGraze(state);
      this.visitor = { x, y, tx: g.x, ty: g.y, life: 30, look: { parts, diet: look.diet === 'grazer' ? 'omnivore' : look.diet === 'hunter' ? 'grazer' : 'hunter' } };
      this.visitorTimer = 90 + Math.random() * 60;
    }
    const v = this.visitor;
    if (v) {
      v.life -= dt;
      if (v.life <= 0) {
        v.tx = v.x + (v.x - this.home.x) * 3;
        v.ty = v.y + (v.y - this.home.y) * 3;
      }
      const d = Math.hypot(v.tx - v.x, v.ty - v.y);
      const k = d > 1 ? Math.min(d, 9 * dt) / d : 0;
      const left = v.tx < v.x;
      v.x += (v.tx - v.x) * k;
      v.y += (v.ty - v.y) * k;
      const vx = v.x;
      const vy = v.y;
      sprites.push({
        y: vy,
        draw: () => {
          drawCreature(b, v.look, vx, vy, { left, frame: d > 1 ? Math.floor(t * 7) % 2 : 0 });
          // A little heart over it, so it reads as "come say hello".
          if (Math.floor(t * 2) % 2) {
            b.fillStyle = PAL.p;
            const hx = Math.round(vx);
            const hy = Math.round(vy - 26);
            b.fillRect(hx - 2, hy, 2, 1);
            b.fillRect(hx + 1, hy, 2, 1);
            b.fillRect(hx - 2, hy + 1, 5, 1);
            b.fillRect(hx - 1, hy + 2, 3, 1);
            b.fillRect(hx, hy + 3, 1, 1);
          }
        },
      });
      if (v.life <= 0 && !this.revealed(state, v.x, v.y)) this.visitor = null;
    }

    // Your creature: walks where you tap, forages when left alone, and roams off into the fog.
    const me = this.me;
    if (!me.placed) {
      me.x = this.home.x + 8;
      me.y = this.home.y + 6;
      me.placed = true;
      me.away = !!st.trip;
    }
    const roaming = !!st.trip;
    if (roaming && !me.away) {
      const p = this.places[st.trip!.place];
      me.tx = p.x;
      me.ty = p.y;
      // Once it's into the fog (or there), it's gone.
      if (!this.revealed(state, me.x, me.y) || Math.hypot(p.x - me.x, p.y - me.y) < 3) me.away = true;
    }
    if (!roaming && me.away) {
      // Home again: back from wherever it went.
      me.away = false;
      const back = this.lastPlace ?? this.places.shore;
      me.x = back.x;
      me.y = back.y;
      me.tx = this.home.x + 6;
      me.ty = this.home.y + 4;
    }
    if (roaming) this.lastPlace = this.places[st.trip!.place];
    me.idle += dt;
    if (!roaming && me.tx === null && me.idle > 3 && !asleep) {
      // Left alone, it heads for the nearest food it can eat.
      let best: Pt | null = null;
      let bd = 45;
      if (edible.bacteria) for (const q of this.bugs) if (Math.hypot(q.x - me.x, q.y - me.y) < bd) [best, bd] = [q, Math.hypot(q.x - me.x, q.y - me.y)];
      if (edible.algae) bushes.forEach((p, i) => {
        if (this.berries[i] >= 1 && Math.hypot(p.x - me.x, p.y - me.y) < bd && this.revealed(state, p.x, p.y)) [best, bd] = [{ x: p.x, y: p.y + 2 }, Math.hypot(p.x - me.x, p.y - me.y)];
      });
      const g = best ?? { x: center.x + (Math.random() - 0.5) * 30, y: center.y + (Math.random() - 0.5) * 16 };
      if (this.land(g.x, g.y)) {
        me.tx = g.x;
        me.ty = g.y;
      }
      me.idle = 0;
    }
    if (asleep && !roaming && me.tx === null) {
      me.tx = this.home.x + 7;
      me.ty = this.home.y + 5;
    }
    const speed = WALK * (1 + 0.03 * statsOf(state).speed);
    let walking = false;
    if (me.tx !== null) {
      const dx = me.tx - me.x;
      const dy = me.ty - me.y;
      const d = Math.hypot(dx, dy);
      if (d < 1.5) me.tx = null;
      else {
        const s = Math.min(speed * dt, d);
        me.x += (dx / d) * s;
        me.y += (dy / d) * s;
        if (Math.abs(dx) > 0.5) me.left = dx < 0;
        walking = true;
      }
    }
    if (!me.away) {
      // Eating what it reaches.
      if (edible.bacteria) {
        this.bugs = this.bugs.filter((q) => {
          if (q.age > 0.4 && q.hop < 0.2 && Math.hypot(q.x - me.x, q.y - me.y) < 5) {
            this.events.push({ type: 'eat', food: 'bacteria' as FoodKind, x: q.x, y: q.y - 6 });
            return false;
          }
          return true;
        });
      }
      if (edible.algae) {
        bushes.forEach((p, i) => {
          if (this.berries[i] >= 1 && Math.hypot(p.x - me.x, p.y + 2 - me.y) < 5) {
            this.berries[i] -= 1;
            this.events.push({ type: 'eat', food: 'algae', x: p.x, y: p.y - 6 });
          }
        });
      }
      // Bumping into a beast counts as a hit once it's strong enough to matter.
      if (beast && !beast.fleeing && beast.flinch <= 0 && Math.hypot(beast.x - me.x, beast.y - me.y) < 8 && statsOf(state).strength >= 6) this.hitBeast(state, beast);
      const mx = me.x;
      const my = me.y;
      const left = me.left;
      sprites.push({
        y: my,
        draw: () => {
          b.fillStyle = 'rgba(16,20,31,0.25)';
          b.fillRect(Math.round(mx - 6), Math.round(my), 12, 1);
          // Mates follow it about.
          st.mates.forEach((mate, k) => {
            const ox = mx + (left ? 14 : -14) + (left ? 7 : -7) * k;
            drawMini(b, { ...look, parts: { ...look.parts, ...mate.parts } }, ox, my + 1 + k, { left, frame: walking ? Math.floor(t * 8 + k) % 2 : 0 });
            b.fillStyle = PAL.p;
            if (Math.floor(t * 1.5 + k) % 3 === 0) b.fillRect(Math.round(ox), Math.round(my - 9), 1, 1);
          });
          drawCreature(b, look, mx, my, { left, frame: walking ? Math.floor(t * 8) % 2 : 0 });
        },
      });
    }

    sprites.sort((a, c) => a.y - c.y);
    for (const s of sprites) s.draw();

    // Falling leaves in autumn, snow in winter.
    if (season.name === 'Autumn' || winter) {
      const want = winter ? 45 : 12;
      while (this.flakes.length < want) this.flakes.push({ x: Math.random() * W, y: top + Math.random() * (H - top), v: 4 + Math.random() * 6 });
      this.flakes.length = want;
      for (const q of this.flakes) {
        q.y += q.v * dt;
        q.x += Math.sin(t + q.v) * 3 * dt + (winter ? 0 : 6 * dt);
        if (q.y > H) {
          q.y = top;
          q.x = Math.random() * W;
        }
        if (q.x > W) q.x -= W;
        b.fillStyle = winter ? PAL.w : q.v > 7 ? PAL.o : PAL.O;
        b.fillRect(Math.round(q.x), Math.round(q.y), 1, 1);
      }
    } else this.flakes.length = 0;

    // Night falls over everything; in summer, fireflies.
    if (night > 0) {
      b.fillStyle = `rgba(16, 24, 56, ${0.5 * night})`;
      b.fillRect(0, 0, W, H);
      if (season.name === 'Summer') {
        for (let i = 0; i < 8; i++) {
          if (Math.sin(t * 2 + i * 1.7) < 0.2) continue;
          b.fillStyle = PAL.y;
          b.fillRect(Math.round(this.home.x + Math.sin(t * 0.3 + i) * 30 + (hash(i, 71) - 0.5) * 40), Math.round(this.home.y + Math.cos(t * 0.4 + i * 2) * 14), 1, 1);
        }
      }
    }

    this.fx.run(f);
  }
}

function mixRgb(a: number[], b: number[], t: number): number[] {
  return a.map((v, i) => Math.round(v + (b[i] - v) * t));
}
