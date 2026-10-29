// The Creature stage scene: a side-on shoreline. The sea on the left, beach, then
// grass and hills. Your creature walks the ground (tap to send it somewhere),
// eats from bushes and catches bugs, and chases off the odd beast. What you own
// fills the land: nests, burrows, a watering hole, dens and territory markers,
// and the herd itself, each member at its job. The seasons turn: green spring,
// gold summer, red autumn, snow in winter. While it's away exploring, it walks off-screen.

import { PAL } from '../art/sprites';
import { STAGES } from '../content/stages';
import { canEat } from '../economy/actions';
import { statsOf } from '../economy/creature';
import { seasonOf } from '../economy/rates';
import type { FoodKind, GameState, Role } from '../economy/types';
import { drawBlob, type BlobStyle } from './blob';
import { creatureLookOf, drawCreature } from './creatureLook';
import { Effects, floorY, hash, mixColor, visibleCount, type Frame } from './paint';
import type { PondEvent } from './pond';

interface Walker {
  x: number;
  vx: number;
  phase: number;
}

interface Member extends Walker {
  role: Role;
  /** Where it likes to be (its nest, its burrow, its post). */
  home: number;
}

/** Each season's land: sky top and bottom, slope, grass, grass tufts, hills. */
const SEASON_LOOK = [
  { sky: ['#9fd4e8', '#cbe7e6'], slope: '#9cc58a', grass: '#6faa5c', tuft: '#4f8a46', hills: '#7fae7a' },
  { sky: ['#8fcdf0', '#d8efe0'], slope: '#b4c878', grass: '#86b050', tuft: '#5e8a3a', hills: '#93b06a' },
  { sky: ['#e2b98a', '#efd9b0'], slope: '#c49a5a', grass: '#b08a4a', tuft: '#c0603a', hills: '#a87850' },
  { sky: ['#b8c4d0', '#e4e8ec'], slope: '#dfe6ea', grass: '#eef2f4', tuft: '#c8d2d8', hills: '#c8d4dc' },
];

interface Food {
  x: number;
  kind: FoodKind;
  /** Bugs hop: seconds into the current hop, or -1 on the ground. */
  hop: number;
  age: number;
}

interface Beast {
  x: number;
  dir: number;
  hits: number;
  flinch: number;
  fleeing: boolean;
  life: number;
}

const BEAST_STYLE: BlobStyle = { edge: '#e8615a', body: '#7a3a2a', nucleus: '#2a1008' };
const BEAST_FLINCH: BlobStyle = { edge: PAL.w, body: '#b0503a', nucleus: '#2a1008' };
/** Art pixels per second, before Speed. */
const WALK = 14;

export class ShoreScene {
  private fx = new Effects();
  private events: PondEvent[] = [];
  private me = { x: 40, vx: 0, tx: null as number | null, left: false, idle: 0, away: false };
  private members: Member[] = [];
  private flakes: { x: number; y: number; v: number }[] = [];
  private food: Food[] = [];
  private foodTimer = 0;
  private beast: Beast | null = null;
  /** Now and then a creature wanders by; tap it to court it as a mate. */
  private visitor: { x: number; dir: number; life: number; look: ReturnType<typeof creatureLookOf> } | null = null;
  private visitorTimer = 40;
  private beastTimer = 45;
  private W = 0;
  private floor = 0;

  reset(): void {
    this.fx.clear();
    this.food = [];
    this.beast = null;
    this.members = [];
    this.flakes = [];
  }

  drain(): PondEvent[] {
    return this.events.splice(0);
  }

  /** Hits needed to drive a beast off: fewer with Strength. */
  private hitsNeeded(state: GameState): number {
    const s = statsOf(state).strength;
    return s >= 15 ? 1 : s >= 6 ? 2 : 3;
  }

  tap(state: GameState, x: number, y: number): void {
    const b = this.beast;
    if (b && !b.fleeing && Math.abs(x - b.x) < 14 && y > this.floor - 22) {
      b.hits++;
      b.flinch = 0.3;
      if (b.hits >= this.hitsNeeded(state)) {
        b.fleeing = true;
        this.events.push({ type: 'fend', x: b.x, y: this.floor - 12 });
      } else this.events.push({ type: 'hit', x: b.x, y: this.floor - 12 });
      return;
    }
    const v = this.visitor;
    if (v && Math.abs(x - v.x) < 14 && y > this.floor - 22) {
      this.events.push({ type: 'court', x: v.x, y: this.floor - 16 });
      this.visitor = null;
      return;
    }
    if (this.me.away) return;
    this.me.tx = Math.max(10, Math.min(this.W - 10, x));
    this.me.idle = 0;
  }

  purchase(state: GameState, id: string): void {
    if (id === 'trip') {
      // Off it goes, out of the right side of the scene.
      this.me.tx = this.W + 30;
      return;
    }
    const at = this.me.away ? this.W / 2 : this.me.x;
    this.fx.sparkle(at, this.floor - 14);
    this.fx.pulse(at, this.floor - 8, PAL.y);
    void state;
  }

  /** Keeps the drawn herd in step with the real one: a sample of it, roles in proportion. */
  private syncHerd(state: GameState, W: number): void {
    const st = state.stages.creature;
    const pop = Math.max(1, Math.floor(st.pop));
    const n = visibleCount(pop - 1, 16);
    const want: Partial<Record<Role, number>> = {};
    let given = 0;
    for (const r of ['carer', 'digger', 'guard'] as Role[]) {
      want[r] = st.roles[r] > 0 ? Math.max(1, Math.round((n * st.roles[r]) / pop)) : 0;
      given += want[r]!;
    }
    want.forager = Math.max(0, n - given);
    const gens = st.generators;
    const fresh = this.members.length === 0;
    for (const r of ['forager', 'carer', 'digger', 'guard'] as Role[]) {
      const have = this.members.filter((m) => m.role === r);
      for (let i = have.length; i < want[r]!; i++) {
        const k = this.members.length;
        const home =
          r === 'carer'
            ? W * (0.05 + (i % Math.max(1, Math.min(5, gens.nest))) * 0.06)
            : r === 'digger'
              ? W * (0.45 + (i % Math.max(1, Math.min(6, gens.burrow))) * 0.08)
              : r === 'guard'
                ? i % 2
                  ? W - 8 - (i >> 1) * 6
                  : 8 + (i >> 1) * 6
                : W * (0.42 + hash(k, 7) * 0.5);
        // Newcomers walk in from the side (on first sight, everyone's already home).
        this.members.push({ role: r, home, x: fresh ? home : hash(k, 3) < 0.5 ? -6 : W + 6, vx: 0, phase: Math.random() * 10 });
      }
      let extra = have.length - want[r]!;
      if (extra > 0) this.members = this.members.filter((m) => m.role !== r || extra-- <= 0);
    }
  }

  draw(f: Frame, state: GameState): void {
    const { b, W, H, t, dt, top } = f;
    const floor = floorY(f, 0.82);
    this.W = W;
    this.floor = floor;
    const st = state.stages.creature;
    const gens = st.generators;

    // Sky and the line of the far hills.
    const horizon = Math.round(top + (floor - top) * 0.5);
    // The season's colours, blending into the next over its last 15 seconds.
    const { season, left } = seasonOf(state);
    const si = ['Spring', 'Summer', 'Autumn', 'Winter'].indexOf(season.name);
    const blend = Math.max(0, 1 - left / 15);
    const now = SEASON_LOOK[si];
    const nxt = SEASON_LOOK[(si + 1) % 4];
    const col = (k: 'slope' | 'grass' | 'tuft' | 'hills') => mixColor(now[k], nxt[k], blend);
    const skyTop = mixColor(now.sky[0], nxt.sky[0], blend);
    const skyBot = mixColor(now.sky[1], nxt.sky[1], blend);
    const sky = [0, 1, 2, 3].map((i) => mixColor(skyTop, skyBot, i / 3));
    const band = Math.ceil(horizon / sky.length);
    sky.forEach((c, i) => {
      b.fillStyle = c;
      b.fillRect(0, i * band, W, band);
    });
    b.fillStyle = PAL.w;
    for (let i = 0; i < 3; i++) {
      const cx = Math.floor((i * 53 + t * (1.5 + i * 0.4)) % (W + 40)) - 20;
      const cy = top + 6 + i * 7;
      b.fillRect(cx, cy, 14, 3);
      b.fillRect(cx + 3, cy - 2, 8, 2);
    }
    // Hills.
    b.fillStyle = col('hills');
    for (let x = Math.floor(W * 0.3); x < W; x++) {
      const h = 6 + Math.round(Math.sin(x * 0.05) * 4 + Math.sin(x * 0.13) * 2);
      b.fillRect(x, horizon - h, 1, h);
    }
    // Territory markers on the hills, one per few owned.
    const markers = Math.min(6, Math.ceil(gens.territory / 3));
    for (let i = 0; i < markers; i++) {
      const x = Math.floor(W * (0.42 + i * 0.1));
      const h = 6 + Math.round(Math.sin(x * 0.05) * 4 + Math.sin(x * 0.13) * 2);
      b.fillStyle = PAL.r;
      b.fillRect(x, horizon - h - 4, 1, 4);
      b.fillStyle = PAL.o;
      b.fillRect(x + 1, horizon - h - 4, 2 + (Math.floor(t * 3 + i) % 2), 1);
    }
    // Sea on the left, meeting the beach.
    b.fillStyle = '#3f8aa5';
    b.fillRect(0, horizon, Math.floor(W * 0.32), floor - horizon);
    b.fillStyle = '#5fa8bf';
    for (let i = 0; i < 8; i++) {
      const x = Math.floor((i * 17 + t * 4) % (W * 0.3));
      b.fillRect(x, horizon + 2 + ((i * 5) % Math.max(1, floor - horizon - 4)), 4, 1);
    }
    // Land between the hills and the ground: a gentle green slope.
    b.fillStyle = col('slope');
    b.fillRect(Math.floor(W * 0.32), horizon, W, floor - horizon);
    // Waves lapping the sand.
    const lap = Math.round(Math.sin(t * 1.2) * 2);
    b.fillStyle = PAL.w;
    b.fillRect(Math.floor(W * 0.32) + lap - 3, floor - 2, 5, 1);

    // The ground: sand by the sea, then grass.
    const sandTo = Math.floor(W * 0.4);
    b.fillStyle = PAL.s;
    b.fillRect(0, floor, sandTo, H - floor);
    b.fillStyle = col('grass');
    b.fillRect(sandTo, floor, W - sandTo, H - floor);
    b.fillStyle = col('tuft');
    for (let x = sandTo; x < W; x += 3) b.fillRect(x, floor - (x % 2), 1, 1 + (x % 2));
    b.fillStyle = PAL.S;
    for (let i = 0; i < 12; i++) b.fillRect(Math.floor(hash(i, 4) * sandTo), floor + 3 + ((i * 5) % 9), 2, 1);

    // Spring flowers in the grass; autumn leaves on the wind; snow falling in winter.
    if (season.name === 'Spring') {
      for (let i = 0; i < 10; i++) {
        b.fillStyle = i % 3 ? PAL.w : PAL.y;
        b.fillRect(Math.floor(sandTo + hash(i, 9) * (W - sandTo)), floor - 1, 1, 1);
      }
    }
    if (season.name === 'Autumn' || season.name === 'Winter') {
      const want = season.name === 'Winter' ? 40 : 10;
      while (this.flakes.length < want) this.flakes.push({ x: Math.random() * W, y: top + Math.random() * (floor - top), v: 4 + Math.random() * 6 });
      this.flakes.length = want;
      for (const q of this.flakes) {
        q.y += q.v * dt;
        q.x += Math.sin(t + q.v) * 3 * dt + (season.name === 'Autumn' ? 6 * dt : 0);
        if (q.y > floor) {
          q.y = top;
          q.x = Math.random() * W;
        }
        if (q.x > W) q.x -= W;
        b.fillStyle = season.name === 'Winter' ? PAL.w : q.v > 7 ? PAL.o : PAL.r;
        b.fillRect(Math.round(q.x), Math.round(q.y), 1, 1);
      }
    } else this.flakes.length = 0;

    // Burrows in the bank, nests on the sand, the watering hole and dens.
    for (let i = 0; i < Math.min(6, gens.burrow); i++) {
      const x = Math.floor(W * (0.45 + i * 0.08));
      b.fillStyle = '#3a2a1a';
      b.fillRect(x - 2, floor + 1, 5, 2);
      b.fillRect(x - 1, floor, 3, 1);
    }
    for (let i = 0; i < Math.min(5, gens.nest); i++) {
      const x = Math.floor(W * (0.05 + i * 0.06));
      b.fillStyle = PAL.S;
      b.fillRect(x - 2, floor - 1, 5, 1);
      b.fillStyle = PAL.w;
      b.fillRect(x - 1, floor - 3, 1, 2);
      b.fillRect(x + 1, floor - 3, 1, 2);
    }
    if (gens.waterhole > 0) {
      const x = Math.floor(W * 0.72);
      const r = Math.min(12, 6 + gens.waterhole);
      b.fillStyle = '#3f8aa5';
      b.fillRect(x - r, floor + 1, r * 2, 3);
      b.fillStyle = '#7fc3d8';
      b.fillRect(x - r + 2, floor + 1, 4, 1);
    }
    for (let i = 0; i < Math.min(3, gens.den); i++) {
      const x = Math.floor(W * (0.92 - i * 0.07));
      b.fillStyle = PAL.r;
      for (let y = 0; y < 8; y++) b.fillRect(x - 6 + y / 2, floor - y, 12 - y, 1);
      b.fillStyle = PAL.k;
      b.fillRect(x - 1, floor - 3, 3, 3);
    }

    const look = creatureLookOf(state);

    // Food: bushes with berries (plant food) and hopping bugs.
    this.foodTimer -= dt;
    const want = 6;
    if (this.food.length < want && this.foodTimer <= 0) {
      this.food.push({ x: 12 + Math.random() * (W - 24), kind: Math.random() < 0.55 ? 'algae' : 'bacteria', hop: -1, age: 0 });
      this.foodTimer = 2.5;
    }
    const edible = { algae: canEat(state, 'creature', 'algae'), bacteria: canEat(state, 'creature', 'bacteria') };
    for (const q of this.food) {
      q.age += dt;
      b.globalAlpha = edible[q.kind] ? 1 : 0.4;
      const x = Math.round(q.x);
      if (q.kind === 'algae') {
        b.fillStyle = PAL.L;
        b.fillRect(x - 2, floor - 3, 5, 3);
        b.fillRect(x - 1, floor - 4, 3, 1);
        b.fillStyle = PAL.p;
        b.fillRect(x - 1, floor - 3, 1, 1);
        b.fillRect(x + 1, floor - 2, 1, 1);
      } else {
        // Bugs hop about, and hop away from the creature.
        if (q.hop < 0 && Math.random() < dt * 0.6) q.hop = 0;
        let y = floor - 1;
        if (q.hop >= 0) {
          q.hop += dt;
          const away = Math.sign(q.x - this.me.x) || 1;
          q.x = Math.max(4, Math.min(W - 4, q.x + away * 18 * dt));
          y = floor - 1 - Math.round(Math.sin(Math.min(1, q.hop / 0.4) * Math.PI) * 5);
          if (q.hop > 0.4) q.hop = -1;
        }
        b.fillStyle = PAL.k;
        b.fillRect(x - 1, y, 3, 1);
        b.fillStyle = PAL.P;
        b.fillRect(x, y - 1, 1, 1);
      }
      b.globalAlpha = 1;
    }

    // The herd, each at its job: foragers peck about the grass, carers sit by the nests,
    // diggers work the burrows, guards stand at the edges (and run at beasts). Scouts are out.
    this.syncHerd(state, W);
    const beastNow = this.beast && !this.beast.fleeing ? this.beast : null;
    for (const m of this.members) {
      let goal = m.home + Math.sin(t * 0.2 + m.phase) * (m.role === 'forager' ? 18 : m.role === 'guard' ? 3 : 5);
      if (m.role === 'guard' && beastNow) goal = beastNow.x - beastNow.dir * 8;
      const d = goal - m.x;
      const sp = m.role === 'guard' && beastNow ? 22 : 6;
      m.vx += (Math.sign(d) * Math.min(sp, Math.abs(d) * 2) - m.vx) * Math.min(1, dt * 3);
      m.x = Math.max(4, Math.min(W - 4, m.x + m.vx * dt));
      const moving = Math.abs(m.vx) > 1;
      // Guards face out (or at the beast); everyone else faces the way they walk.
      const left = moving ? m.vx < 0 : m.role === 'guard' ? m.home < W / 2 : Math.sin(m.phase * 3) < 0;
      // Foragers dip to peck; diggers bob and throw up dirt.
      const bob = (m.role === 'forager' || m.role === 'digger') && !moving && Math.sin(t * 3 + m.phase * 5) > 0.6 ? 1 : 0;
      drawCreature(b, look, m.x, floor + bob, { left, frame: moving ? Math.floor(t * 8 + m.phase) % 2 : 0, scale: 0.5 });
      if (m.role === 'digger' && bob && Math.floor(t * 6 + m.phase) % 3 === 0) {
        b.fillStyle = '#3a2a1a';
        b.fillRect(Math.round(m.x + (left ? 3 : -3)), floor - 3, 1, 1);
      }
      if (m.role === 'carer' && Math.floor(t + m.phase) % 4 === 0) {
        b.fillStyle = PAL.p;
        b.fillRect(Math.round(m.x), floor - 12, 1, 1);
      }
      // Guards bump the beast too.
      if (m.role === 'guard' && beastNow && beastNow.flinch <= 0 && Math.abs(beastNow.x - m.x) < 9 && Math.random() < dt * 0.8) {
        beastNow.hits++;
        beastNow.flinch = 0.5;
        if (beastNow.hits >= this.hitsNeeded(state)) {
          beastNow.fleeing = true;
          this.events.push({ type: 'fend', x: beastNow.x, y: floor - 12 });
        } else this.events.push({ type: 'hit', x: beastNow.x, y: floor - 12 });
      }
    }

    // A beast wanders in now and then and goes for the food and the young.
    this.beastTimer -= dt;
    if (!this.beast && this.beastTimer <= 0) {
      const fromLeft = Math.random() < 0.5;
      this.beast = { x: fromLeft ? -16 : W + 16, dir: fromLeft ? 1 : -1, hits: 0, flinch: 0, fleeing: false, life: 25 };
      this.beastTimer = 60 + Math.random() * 40;
    }
    const bt = this.beast;
    if (bt) {
      bt.life -= dt;
      bt.flinch = Math.max(0, bt.flinch - dt);
      if (bt.life <= 0) bt.fleeing = true;
      const speed = bt.fleeing ? -28 : bt.flinch > 0 ? 0 : 8;
      bt.x += bt.dir * speed * dt;
      if (!bt.fleeing && (bt.x > W - 20 || bt.x < 20)) bt.dir = bt.x < 20 ? 1 : -1;
      // It eats any food it walks over.
      this.food = this.food.filter((q) => Math.abs(q.x - bt.x) > 6 || bt.fleeing);
      const y = floor - 7;
      const wob = bt.flinch > 0 ? 1.4 : 1;
      drawBlob(b, [{ x: bt.x, y, r: 6 * wob, nucleus: false }, { x: bt.x + bt.dir * 7, y: y - 2, r: 3.5, nucleus: false }, { x: bt.x - bt.dir * 7, y: y + 1, r: 2.5, nucleus: false }], bt.flinch > 0 ? BEAST_FLINCH : BEAST_STYLE);
      b.fillStyle = PAL.y;
      b.fillRect(Math.round(bt.x + bt.dir * 8), y - 3, 1, 1);
      b.fillStyle = PAL.k;
      for (let k = -1; k <= 1; k += 2) b.fillRect(Math.round(bt.x + k * 3), floor - 2, 2, 2);
      if (!bt.fleeing && bt.hits > 0) {
        b.fillStyle = PAL.w;
        for (let i = 0; i < bt.hits; i++) b.fillRect(Math.round(bt.x - 2 + i * 2), y - 9, 1, 1);
      }
      if (bt.fleeing && (bt.x < -30 || bt.x > W + 30)) this.beast = null;
    }

    // A visitor: one of your kind from elsewhere, in a different coat. It wanders, then leaves.
    this.visitorTimer -= dt;
    if (!this.visitor && this.visitorTimer <= 0 && st.mates.length < 3) {
      const fromLeft = Math.random() < 0.5;
      const parts = { ...look.parts };
      const pool = state.stages.creature.parts.concat(['shell', 'sail', 'runner']);
      for (const slot of ['back', 'tail', 'legs'] as const) {
        const opts = pool.filter((id) => STAGES.creature.parts!.find((p) => p.id === id)?.slot === slot);
        if (opts.length) parts[slot] = opts[Math.floor(Math.random() * opts.length)];
      }
      this.visitor = { x: fromLeft ? -16 : W + 16, dir: fromLeft ? 1 : -1, life: 30, look: { parts, diet: look.diet === 'grazer' ? 'omnivore' : look.diet === 'hunter' ? 'grazer' : 'hunter' } };
      this.visitorTimer = 90 + Math.random() * 60;
    }
    const v = this.visitor;
    if (v) {
      v.life -= dt;
      const target = v.life > 0 ? W * (v.dir > 0 ? 0.55 : 0.45) : v.dir > 0 ? W + 30 : -30;
      const d = target - v.x;
      v.x += Math.sign(d) * Math.min(Math.abs(d), 10 * dt);
      drawCreature(b, v.look, v.x, floor, { left: d < 0, frame: Math.abs(d) > 1 ? Math.floor(t * 7) % 2 : 0 });
      // A little heart over it, so it reads as "come say hello".
      if (Math.floor(t * 2) % 2) {
        b.fillStyle = PAL.p;
        const hx = Math.round(v.x);
        const hy = floor - 24;
        b.fillRect(hx - 2, hy, 2, 1);
        b.fillRect(hx + 1, hy, 2, 1);
        b.fillRect(hx - 2, hy + 1, 5, 1);
        b.fillRect(hx - 1, hy + 2, 3, 1);
        b.fillRect(hx, hy + 3, 1, 1);
      }
      if (v.life <= 0 && (v.x < -20 || v.x > W + 20)) this.visitor = null;
    }

    // Your creature: walks where you tap, wanders when left alone, and goes off exploring.
    const me = this.me;
    const tripping = !!st.trip;
    if (tripping && !me.away && me.tx === null) me.tx = W + 30;
    if (!tripping && me.away) {
      // Home again: walks back in from the right.
      me.away = false;
      me.x = W + 20;
      me.tx = W * 0.6;
    }
    me.idle += dt;
    if (!tripping && me.tx === null && me.idle > 3) {
      // Left alone, it heads for the nearest food it can eat.
      let best: Food | null = null;
      for (const q of this.food) if (edible[q.kind] && (!best || Math.abs(q.x - me.x) < Math.abs(best.x - me.x))) best = q;
      if (best) me.tx = best.x;
      else me.tx = Math.max(10, Math.min(W - 10, me.x + (Math.random() - 0.5) * 40));
    }
    const speed = WALK * (1 + 0.04 * statsOf(state).speed);
    if (me.tx !== null) {
      const d = me.tx - me.x;
      if (Math.abs(d) < 1.5) me.tx = null;
      me.vx += (Math.sign(d) * Math.min(speed, Math.abs(d) * 3) - me.vx) * Math.min(1, dt * 6);
    } else me.vx *= 1 - Math.min(1, dt * 6);
    me.x += me.vx * dt;
    if (Math.abs(me.vx) > 0.5) me.left = me.vx < 0;
    if (tripping && me.x > W + 20) me.away = true;
    if (!me.away) {
      for (const q of this.food) {
        if (Math.abs(q.x - me.x) < 6 && q.age > 0.4 && q.hop < 0.2) {
          if (edible[q.kind]) {
            q.age = -1;
            this.events.push({ type: 'eat', food: q.kind, x: q.x, y: floor - 8 });
          }
        }
      }
      this.food = this.food.filter((q) => q.age >= 0);
      // Bumping into a beast counts as a hit once it's strong enough to matter.
      if (bt && !bt.fleeing && bt.flinch <= 0 && Math.abs(bt.x - me.x) < 10 && statsOf(state).strength >= 6) {
        bt.hits++;
        bt.flinch = 0.5;
        if (bt.hits >= this.hitsNeeded(state)) {
          bt.fleeing = true;
          this.events.push({ type: 'fend', x: bt.x, y: floor - 12 });
        } else this.events.push({ type: 'hit', x: bt.x, y: floor - 12 });
      }
      const walking = Math.abs(me.vx) > 1;
      drawCreature(b, look, me.x, floor, { left: me.left, frame: walking ? Math.floor(t * 8) % 2 : 0 });
    } else {
      // Footprints heading off to the right while it's away.
      b.fillStyle = PAL.S;
      for (let i = 0; i < 5; i++) b.fillRect(W - 6 - i * 7, floor + 1 + (i % 2), 2, 1);
    }

    this.fx.run(f);
  }
}
