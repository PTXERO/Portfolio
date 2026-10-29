// The Creature stage scene: a side-on shoreline. The sea on the left, beach, then
// grass and hills. Your creature walks the ground (tap to send it somewhere),
// eats from bushes and catches bugs, and chases off the odd beast. What you own
// fills the land: hatchlings, burrows, a grazing herd, nests, a watering hole,
// dens and territory markers. While it's away exploring, it walks off-screen.

import { PAL } from '../art/sprites';
import { STAGES } from '../content/stages';
import { canEat } from '../economy/actions';
import { statsOf } from '../economy/creature';
import type { FoodKind, GameState } from '../economy/types';
import { drawBlob, type BlobStyle } from './blob';
import { creatureLookOf, drawCreature } from './creatureLook';
import { Effects, floorY, hash, visibleCount, type Frame } from './paint';
import type { PondEvent } from './pond';

interface Walker {
  x: number;
  vx: number;
  phase: number;
}

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
  private hatchlings: Walker[] = [];
  private herd: Walker[] = [];
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
    this.hatchlings = [];
    this.herd = [];
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

  draw(f: Frame, state: GameState): void {
    const { b, W, H, t, dt, top } = f;
    const floor = floorY(f, 0.82);
    this.W = W;
    this.floor = floor;
    const st = state.stages.creature;
    const gens = st.generators;

    // Sky and the line of the far hills.
    const horizon = Math.round(top + (floor - top) * 0.5);
    const sky = ['#9fd4e8', '#b6dfe9', '#cbe7e6', '#dcedde'];
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
    b.fillStyle = '#7fae7a';
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
    b.fillStyle = '#9cc58a';
    b.fillRect(Math.floor(W * 0.32), horizon, W, floor - horizon);
    // Waves lapping the sand.
    const lap = Math.round(Math.sin(t * 1.2) * 2);
    b.fillStyle = PAL.w;
    b.fillRect(Math.floor(W * 0.32) + lap - 3, floor - 2, 5, 1);

    // The ground: sand by the sea, then grass.
    const sandTo = Math.floor(W * 0.4);
    b.fillStyle = PAL.s;
    b.fillRect(0, floor, sandTo, H - floor);
    b.fillStyle = '#6faa5c';
    b.fillRect(sandTo, floor, W - sandTo, H - floor);
    b.fillStyle = '#4f8a46';
    for (let x = sandTo; x < W; x += 3) b.fillRect(x, floor - (x % 2), 1, 1 + (x % 2));
    b.fillStyle = PAL.S;
    for (let i = 0; i < 12; i++) b.fillRect(Math.floor(hash(i, 4) * sandTo), floor + 3 + ((i * 5) % 9), 2, 1);

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

    // The herd grazes in the distance, on the slope.
    const herdN = visibleCount(gens.herd, 10);
    while (this.herd.length < herdN) this.herd.push({ x: W * (0.5 + Math.random() * 0.45), vx: 0, phase: Math.random() * 10 });
    this.herd.length = herdN;
    const look = creatureLookOf(state);
    for (const w of this.herd) {
      w.x += Math.sin(t * 0.2 + w.phase) * 1.5 * dt;
      const y = horizon + Math.floor((floor - horizon) * 0.45) + Math.round(hash(w.phase, 2) * 6);
      b.globalAlpha = 0.85;
      drawBlob(b, [{ x: w.x, y, r: 2.6, nucleus: false }, { x: w.x + 3, y: y - 1, r: 1.6, nucleus: false }], { edge: '#5a7a4a', body: '#7a9a5a', nucleus: PAL.k });
      b.globalAlpha = 1;
    }

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

    // Hatchlings potter about near the nests and burrows.
    const hatchN = visibleCount(gens.hatchling, 14);
    while (this.hatchlings.length < hatchN) this.hatchlings.push({ x: Math.random() * W, vx: 0, phase: Math.random() * 10 });
    this.hatchlings.length = hatchN;
    for (const w of this.hatchlings) {
      const target = Math.sin(t * 0.3 + w.phase) * 4 + 3 * Math.sign(Math.sin(t * 0.15 + w.phase * 2));
      w.vx += (target - w.vx) * Math.min(1, dt);
      w.x += w.vx * dt;
      if (w.x < 6 || w.x > W - 6) w.vx = -w.vx;
      w.x = Math.max(6, Math.min(W - 6, w.x));
      const hopY = Math.abs(Math.sin(t * 6 + w.phase)) < 0.2 ? 1 : 0;
      drawBlob(b, [{ x: w.x, y: floor - 3 - hopY, r: 2.2, nucleus: false }], { edge: look.diet === 'none' ? PAL.g : '#8fe0c0', body: PAL.G, nucleus: PAL.k });
      b.fillStyle = PAL.k;
      b.fillRect(Math.round(w.x) + (w.vx < 0 ? -1 : 1), floor - 4 - hopY, 1, 1);
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
