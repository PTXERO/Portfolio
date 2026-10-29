// The pond's active life in the Cell stage: your own cell (the hero) that you
// steer with taps, food drifting about, rare microbes carrying organelles, and
// predators. Like the rest of the scene it never touches the economy: it
// reports what happened (ate, engulfed, drove off) as events for main to apply.

import { PAL } from '../art/sprites';
import { canEat, engulfable } from '../economy/actions';
import { acclimOf, autopilot, defenseOf, guardLevel, habitatOf, heroSpeed, spawnMult, upgradeLevel } from '../economy/rates';
import type { FoodKind, GameState } from '../economy/types';
import { drawBlob, type BlobStyle, type Core } from './blob';
import { drawCellLook, lookOf, ORGANELLE_COLORS, type Look } from './cellLook';
import { ring, type Frame } from './paint';
import type { Swarm } from './swarm';

export type PondEvent =
  | { type: 'eat'; food: FoodKind; x: number; y: number }
  | { type: 'engulf'; id: string; x: number; y: number }
  | { type: 'rare'; x: number; y: number }
  | { type: 'fend'; x: number; y: number }
  | { type: 'hit'; x: number; y: number }
  /** A visiting creature on the shore was courted (Creature stage). */
  | { type: 'court'; x: number; y: number }
  /** Creature stage: a found place was foraged again (by your creature, or a party home). */
  | { type: 'forage'; party: boolean; x: number; y: number }
  /** Creature stage: a place's flag was tapped. */
  | { type: 'place'; id: string; x: number; y: number }
  /** Tribal era: the spear was touched. */
  | { type: 'spear'; x: number; y: number }
  /** Extinction: the leader gathered by hand at a work place (or listened at the spear). */
  | { type: 'hand'; job: import('../economy/extinction').JobId; x: number; y: number };

interface Hero {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Where it's heading, or null to drift. */
  tx: number | null;
  ty: number;
  /** Seconds since the player last steered (autopilot takes over later). */
  idle: number;
  left: boolean;
  /** Seconds of the gulp squash after eating. */
  gulp: number;
}

interface Food {
  x: number;
  y: number;
  vx: number;
  vy: number;
  kind: FoodKind;
  phase: number;
  /** Seconds since it appeared (it fades in). */
  age: number;
}

interface Rare {
  x: number;
  y: number;
  vx: number;
  vy: number;
  id: string;
  life: number;
  /** Seconds of dash left before it tires, and of rest before it can dash again. */
  dash: number;
  rest: number;
}

interface Predator {
  x: number;
  y: number;
  vx: number;
  vy: number;
  hits: number;
  /** Seconds it will hunt before leaving on its own. */
  life: number;
  /** Driven off: swims away and is gone. */
  fleeing: boolean;
  /** Seconds before it can bite again. */
  bite: number;
  /** Seconds of the flinch after being hit. */
  flinch: number;
  phase: number;
  /** Rammed by a toxic cell: too sick to bite again. */
  poisoned: boolean;
}

/** Art pixels per second, before mutations. */
const HERO_SPEED = 18;
/** Seconds without steering before the eyespot's autopilot takes over. */
const AUTOPILOT_AFTER = 2.5;
const RARE_LIFE = 35;
/** How fast a Vents plume carries an unprotected cell upward, art pixels per second. */
const PLUME_LIFT = 24;
/** How far a light shaft leans per art pixel down (it falls at a slant). */
export const SHAFT_SLANT = 0.3;
/** Your cell's radius by size mutation: only a little bigger than the swarm's 4. */
const HERO_RX = [5, 5, 6, 7];
const PREDATOR_STYLE: BlobStyle = { edge: '#e8615a', body: '#8a2f45', nucleus: '#3a1020' };
const PREDATOR_SICK: BlobStyle = { edge: '#b8d05a', body: '#5a6a2f', nucleus: '#2a3010' };
const PREDATOR_FLINCH: BlobStyle = { edge: PAL.w, body: '#c4485a', nucleus: '#3a1020' };

/** Hits a predator takes before giving up; tougher lineages scare it faster. */
export function hitsToFend(defense: number): number {
  return defense >= 0.5 ? 2 : 3;
}

export class Pond {
  hero: Hero | null = null;
  private food: Food[] = [];
  private rare: Rare | null = null;
  private preds: Predator[] = [];
  private events: PondEvent[] = [];
  private foodTimer: Record<FoodKind, number> = { algae: 0, bacteria: 0 };
  /** Seconds until a rare microbe may appear. */
  private rareTimer = 20;
  private predTimer = 30;
  private marker: { x: number; y: number; age: number } | null = null;
  private ramCooldown = 0;
  /** Swarm cells just bitten by a predator: a red burst where each one was. */
  private bites: { x: number; y: number; age: number }[] = [];
  /** Which foods the lineage can eat; the rest is drawn faded. */
  private edible: Record<FoodKind, boolean> = { algae: false, bacteria: false };
  private W = 0;
  private floor = 0;
  private top = 0;
  private look: Look | null = null;
  /** What the habitat is doing: light shafts (x at the surface) and hot plumes (x of each chimney). */
  env: { shafts: number[]; plumes: number[] } = { shafts: [], plumes: [] };

  reset(): void {
    this.hero = null;
    this.food = [];
    this.rare = null;
    this.preds = [];
    this.events = [];
    this.marker = null;
    this.rareTimer = 20;
    this.predTimer = 30;
  }

  /** Clears the pond after moving habitat: different water, different life. */
  moved(): void {
    this.food = [];
    this.preds = [];
    this.rare = null;
    this.rareTimer = 20;
    this.predTimer = 20;
  }

  drain(): PondEvent[] {
    return this.events.splice(0);
  }

  private heroRx(state: GameState): number {
    return HERO_RX[Math.min(3, lookOf(state, 'cell').size)];
  }

  /**
   * A tap at (x, y): hits a predator if there's one under the finger, otherwise
   * steers the hero there. Returns 'hit' or 'steer'.
   */
  tap(state: GameState, x: number, y: number): 'hit' | 'steer' {
    const p = this.preds.find((q) => !q.fleeing && Math.hypot(q.x - x, q.y - y) < 12);
    if (p) {
      this.hitPredator(state, p);
      return 'hit';
    }
    if (this.hero) {
      this.hero.tx = x;
      this.hero.ty = Math.max(this.top + 6, Math.min(this.floor - 6, y));
      this.hero.idle = 0;
      this.marker = { x, y: this.hero.ty, age: 0 };
    }
    return 'steer';
  }

  private hitPredator(state: GameState, p: Predator, power = 1): void {
    p.hits += power;
    p.flinch = 0.3;
    if (p.hits >= hitsToFend(defenseOf(state, 'cell'))) {
      p.fleeing = true;
      this.events.push({ type: 'fend', x: p.x, y: p.y });
    } else this.events.push({ type: 'hit', x: p.x, y: p.y });
  }

  private spawnPos(kind?: FoodKind): [number, number] {
    const y = this.top + 8 + Math.random() * Math.max(1, this.floor - this.top - 16);
    // In the Shallows, algae grows where the sunlight falls.
    if (kind === 'algae' && this.env.shafts.length && Math.random() < 0.8) {
      const sx = this.env.shafts[Math.floor(Math.random() * this.env.shafts.length)];
      return [Math.max(6, Math.min(this.W - 6, sx + (y - this.top) * SHAFT_SLANT + (Math.random() - 0.5) * 10)), y];
    }
    return [6 + Math.random() * (this.W - 12), y];
  }

  /**
   * How hard a Vents plume pushes your cell: strong tails swim against it and a
   * thick membrane shrugs off the heat. Settling in at the Vents helps too.
   */
  private plumeGrip(state: GameState): number {
    const lv = (id: string) => upgradeLevel(state, 'cell', id);
    const resist = 0.09 * lv('flagellum') + 0.12 * lv('twinFlagella') + 0.06 * lv('thickMembrane') + 0.3 * acclimOf(state, 'cell', 'vents');
    return Math.max(0.1, 1 - resist);
  }

  /** How far your cell can see in the dark Depths, in art pixels. */
  lightRadius(state: GameState): number {
    const lv = (id: string) => upgradeLevel(state, 'cell', id);
    return 16 + (lv('eyespot') ? 6 : 0) + 3 * lv('photoreceptor') + 10 * acclimOf(state, 'cell', 'depths');
  }

  step(f: Frame, state: GameState, floor: number, swarm: Swarm): void {
    const { dt, W, top } = f;
    this.W = W;
    this.floor = floor;
    this.top = top;
    this.look = lookOf(state, 'cell');
    const hab = habitatOf(state, 'cell');
    this.edible = { algae: canEat(state, 'cell', 'algae'), bacteria: canEat(state, 'cell', 'bacteria') };
    const spawn = spawnMult(state, 'cell');
    if (!this.hero) {
      const [x, y] = [W * 0.5, top + (floor - top) * 0.55];
      this.hero = { x, y, vx: 0, vy: 0, tx: null, ty: y, idle: 0, left: false, gulp: 0 };
    }
    const h = this.hero;
    const rx = this.heroRx(state);

    // Food drifts in, more of whatever the habitat is rich in.
    for (const kind of ['algae', 'bacteria'] as FoodKind[]) {
      const level = hab?.food[kind] ?? 1;
      const want = Math.round(2 + level * 3 * Math.min(2, spawn));
      const have = this.food.filter((q) => q.kind === kind).length;
      this.foodTimer[kind] -= dt;
      if (have < want && this.foodTimer[kind] <= 0) {
        const [x, y] = this.spawnPos(kind);
        this.food.push({ x, y, vx: (Math.random() - 0.5) * 3, vy: (Math.random() - 0.5) * 2, kind, phase: Math.random() * 10, age: 0 });
        this.foodTimer[kind] = 2.5 / (level * spawn);
      }
    }

    // Steering: toward the tap; with an eyespot, toward food once left alone.
    h.idle += dt;
    h.gulp = Math.max(0, h.gulp - dt);
    // Guard Instinct: left alone, your cell goes after any predator first, at full speed.
    const guard = guardLevel(state, 'cell');
    const threat = guard > 0 && h.tx === null && h.idle > AUTOPILOT_AFTER ? this.preds.find((p) => !p.fleeing) : undefined;
    if (threat) {
      this.goTo(h, threat.x, threat.y, HERO_SPEED * heroSpeed(state, 'cell') * (1 + 0.2 * guard), dt);
    } else if (h.tx === null && autopilot(state, 'cell') && h.idle > AUTOPILOT_AFTER) {
      const wants = (q: Food) => canEat(state, 'cell', q.kind);
      let best: Food | null = null;
      let bd = Infinity;
      for (const q of this.food) {
        const d = Math.hypot(q.x - h.x, q.y - h.y);
        if (wants(q) && q.age > 0.5 && d < bd) {
          bd = d;
          best = q;
        }
      }
      // The autopilot cruises at half speed, so steering yourself still pays.
      if (best) this.goTo(h, best.x, best.y, HERO_SPEED * heroSpeed(state, 'cell') * 0.5, dt);
      else this.drift(h, f.t, dt);
    } else if (h.tx !== null) {
      if (Math.hypot(h.tx - h.x, h.ty - h.y) < 2) h.tx = null;
      else this.goTo(h, h.tx, h.ty, HERO_SPEED * heroSpeed(state, 'cell'), dt);
    } else this.drift(h, f.t, dt);
    // Hot plumes at the Vents carry anything in them upward.
    const inPlume = (x: number) => this.env.plumes.some((p) => Math.abs(x - p) < 7);
    const lift = inPlume(h.x) ? PLUME_LIFT * this.plumeGrip(state) : 0;
    h.x = Math.max(rx, Math.min(W - rx, h.x + (h.vx + (lift ? Math.sin(f.t * 3) * lift * 0.3 : 0)) * dt));
    h.y = Math.max(top + rx, Math.min(floor - rx, h.y + (h.vy - lift) * dt));
    if (Math.abs(h.vx) > 1) h.left = h.vx < 0;

    // Food: algae drifts, bacteria wriggle and dart away from the hero.
    for (const q of this.food) {
      q.age += dt;
      const d = Math.hypot(q.x - h.x, q.y - h.y);
      if (q.kind === 'bacteria' && d < 16) {
        q.vx += ((q.x - h.x) / (d || 1)) * 40 * dt;
        q.vy += ((q.y - h.y) / (d || 1)) * 40 * dt;
      }
      if (q.kind === 'algae') {
        // Algae has no will of its own: it rides a slow current that wanders across the
        // pond (gentler in the still Depths), bobs as it goes and sinks a little.
        const flow = hab?.id === 'depths' ? 0.4 : hab?.id === 'vents' ? 0.2 : 1;
        const curX = (Math.sin(f.t * 0.11 + q.y * 0.045) * 2.5 + 1.3) * flow;
        const curY = 0.35 + Math.sin(f.t * 0.7 + q.phase) * 1.1;
        q.vx += (curX - q.vx) * Math.min(1, dt * 0.8);
        q.vy += (curY - q.vy) * Math.min(1, dt * 0.8);
        // A passing cell's wake pushes it along.
        if (d < rx + 10) {
          q.vx += h.vx * 1.2 * dt;
          q.vy += h.vy * 1.2 * dt;
        }
      } else {
        q.vx *= 1 - dt * 0.5;
        q.vy *= 1 - dt * 0.5;
      }
      const sp = Math.hypot(q.vx, q.vy);
      const max = q.kind === 'bacteria' ? 11 : 6;
      if (sp > max) {
        q.vx *= max / sp;
        q.vy *= max / sp;
      }
      q.x += (q.vx + (q.kind === 'bacteria' ? Math.sin(f.t * 5 + q.phase) * 2 : 0)) * dt;
      q.y += q.vy * dt - (inPlume(q.x) ? PLUME_LIFT * 0.6 * dt : 0);
      if (q.kind === 'algae') {
        // Carried off one side by the current, it drifts back in on the other.
        if (q.x < -3) q.x = W + 2;
        else if (q.x > W + 3) q.x = -2;
      } else if (q.x < 4 || q.x > W - 4) q.vx = (q.x < 4 ? 1 : -1) * Math.abs(q.vx || 2);
      // Food carried up a Vents plume to the top is swept away (a fresh piece drifts in later).
      if (q.y < top + 6 && inPlume(q.x)) {
        q.age = -1;
        continue;
      }
      if (q.y < top + 4 || q.y > floor - 4) q.vy = (q.y < top + 4 ? 1 : -1) * Math.abs(q.vy || 2);
      // When the floor rises (the sheet opening), food is lifted with it, never buried.
      q.y = Math.min(q.y, floor - 3);
      if (q.age > 0.5 && d < rx + 2) {
        if (canEat(state, 'cell', q.kind)) {
          q.age = -1;
          h.gulp = 0.25;
          this.events.push({ type: 'eat', food: q.kind, x: q.x, y: q.y });
        } else {
          // Not on the menu: it just gets nudged aside.
          q.vx += ((q.x - h.x) / (d || 1)) * 8;
          q.vy += ((q.y - h.y) / (d || 1)) * 8;
        }
      }
    }
    this.food = this.food.filter((q) => q.age >= 0);

    // A rare microbe turns up now and then while an organelle is there to find.
    const findable = engulfable(state, 'cell').map((r) => r.id);
    if (this.rare && !findable.includes(this.rare.id)) this.rare = null;
    if (!this.rare && findable.length) {
      this.rareTimer -= dt;
      if (this.rareTimer <= 0) {
        const [x, y] = this.spawnPos();
        this.rare = { x, y, vx: 4, vy: 2, id: findable[Math.floor(Math.random() * findable.length)], life: RARE_LIFE, dash: 1.6, rest: 0 };
        this.rareTimer = (40 + Math.random() * 30) / spawn;
        this.events.push({ type: 'rare', x, y });
      }
    }
    const r = this.rare;
    if (r) {
      r.life -= dt;
      const a = Math.sin(f.t * 0.6) * 2 + f.t * 0.3;
      r.vx += Math.cos(a) * 6 * dt;
      r.vy += Math.sin(a) * 6 * dt;
      // It darts away when your cell comes near, until it tires and has to rest:
      // a fast cell (or a patient one) catches it.
      const away = Math.hypot(r.x - h.x, r.y - h.y);
      let top = 6;
      r.rest = Math.max(0, r.rest - dt);
      if (away < 26 && r.rest <= 0 && r.dash > 0) {
        r.dash -= dt;
        r.vx += ((r.x - h.x) / (away || 1)) * 90 * dt;
        r.vy += ((r.y - h.y) / (away || 1)) * 90 * dt;
        top = 24;
        if (r.dash <= 0) {
          r.rest = 1.4;
          r.dash = 1.6;
        }
      }
      const sp = Math.hypot(r.vx, r.vy);
      if (sp > top) {
        r.vx *= top / sp;
        r.vy *= top / sp;
      }
      r.x = Math.max(6, Math.min(W - 6, r.x + r.vx * dt));
      r.y = Math.max(top + 6, Math.min(floor - 6, r.y + r.vy * dt));
      if (r.x <= 6 || r.x >= W - 6) r.vx = -r.vx;
      if (r.y <= top + 6 || r.y >= floor - 6) r.vy = -r.vy;
      if (Math.hypot(r.x - h.x, r.y - h.y) < rx + 3) {
        this.events.push({ type: 'engulf', id: r.id, x: r.x, y: r.y });
        h.gulp = 0.5;
        this.rare = null;
      } else if (r.life <= 0) this.rare = null;
    }

    // Predators: more often where it's dangerous. They pick off swarm cells
    // (which divide again) until driven off or bored.
    const danger = hab?.danger ?? 0;
    this.predTimer -= dt;
    if (this.predTimer <= 0 && !this.preds.length && danger > 0) {
      const fromLeft = Math.random() < 0.5;
      const y = top + 10 + Math.random() * Math.max(1, floor - top - 20);
      const defense = defenseOf(state, 'cell');
      this.preds.push({ x: fromLeft ? -10 : W + 10, y, vx: 0, vy: 0, hits: 0, life: 10 + 20 * (1 - defense), fleeing: false, bite: 2, flinch: 0, phase: Math.random() * 10, poisoned: false });
      this.predTimer = danger <= 0.15 ? 90 + Math.random() * 30 : (16 + Math.random() * 10) / danger;
    }
    this.ramCooldown = Math.max(0, this.ramCooldown - dt);
    for (const p of this.preds) {
      p.life -= dt;
      p.bite = Math.max(0, p.bite - dt);
      p.flinch = Math.max(0, p.flinch - dt);
      if (p.life <= 0) p.fleeing = true;
      let tx: number;
      let ty: number;
      let speed: number;
      if (p.fleeing) {
        tx = p.x < W / 2 ? -40 : W + 40;
        ty = p.y;
        speed = 30;
      } else {
        const prey = swarm.cells.filter((c) => c.fade === 0 && c.split < 0);
        let best = prey[0];
        let bd = Infinity;
        for (const c of prey) {
          const d = Math.hypot(c.x - p.x, c.y - p.y);
          if (d < bd) {
            bd = d;
            best = c;
          }
        }
        if (best) [tx, ty] = [best.x, best.y];
        else [tx, ty] = [W / 2 + Math.sin(f.t * 0.4) * W * 0.3, (top + floor) / 2];
        speed = p.flinch > 0 ? 2 : 11;
        if (best && bd < 5 && p.bite <= 0 && !p.poisoned) {
          // A bite: the cell bursts (the swarm divides again to replace it).
          best.dead = true;
          p.bite = 3;
          p.flinch = 0;
          this.bites.push({ x: best.x, y: best.y, age: 0 });
        }
      }
      this.goTo(p, tx, ty, speed, dt);
      p.x += p.vx * dt;
      p.y = Math.max(top + 8, Math.min(floor - 8, p.y + p.vy * dt));
      // Ramming it with spikes counts as a hit.
      if (!p.fleeing && this.look.spikes && this.ramCooldown <= 0 && Math.hypot(p.x - h.x, p.y - h.y) < rx + 8) {
        this.ramCooldown = 0.8;
        // Guard Instinct rams harder; Toxin leaves it too sick to bite again.
        if (this.look.toxin) p.poisoned = true;
        this.hitPredator(state, p, 1 + (guard >= 2 ? 1 : 0));
      }
    }
    this.preds = this.preds.filter((p) => !(p.fleeing && (p.x < -30 || p.x > W + 30)));

    for (const bt of this.bites) bt.age += dt;
    this.bites = this.bites.filter((bt) => bt.age < 0.7);
    if (this.marker) {
      this.marker.age += dt;
      if (this.marker.age > 0.6) this.marker = null;
    }
  }

  private goTo(o: { x: number; y: number; vx: number; vy: number }, tx: number, ty: number, speed: number, dt: number): void {
    const dx = tx - o.x;
    const dy = ty - o.y;
    const d = Math.hypot(dx, dy) || 1;
    // Ease in near the target so it doesn't overshoot.
    const want = Math.min(speed, d * 3);
    o.vx += ((dx / d) * want - o.vx) * Math.min(1, dt * 5);
    o.vy += ((dy / d) * want - o.vy) * Math.min(1, dt * 5);
  }

  private drift(h: Hero, t: number, dt: number): void {
    h.vx += (Math.sin(t * 0.5) * 3 - h.vx) * Math.min(1, dt * 2);
    h.vy += (Math.cos(t * 0.7) * 2 - h.vy) * Math.min(1, dt * 2);
  }

  /** Food and rare microbes, drawn under the swarm. */
  drawBack(f: Frame): void {
    const { b, t } = f;
    for (const q of this.food) {
      if (q.age < 0.5 && Math.floor(t * 12) % 2) continue;
      const x = Math.round(q.x);
      const y = Math.round(q.y);
      // Food your cell can't eat fades into the water.
      b.globalAlpha = this.edible[q.kind] ? 1 : 0.35;
      if (q.kind === 'algae') {
        // A little clump of green.
        b.fillStyle = PAL.l;
        b.fillRect(x - 1, y, 3, 1);
        b.fillRect(x, y - 1, 1, 3);
        b.fillStyle = PAL.L;
        b.fillRect(x + 1, y + 1, 1, 1);
        b.fillStyle = '#c8f08a';
        b.fillRect(x - 1, y - 1, 1, 1);
      } else {
        // A wriggling rod.
        const w = Math.floor(t * 6 + q.phase) % 2;
        b.fillStyle = '#e0a8d8';
        b.fillRect(x - 2, y + (w ? 0 : 1), 2, 1);
        b.fillRect(x, y + (w ? 1 : 0), 2, 1);
        b.fillStyle = PAL.P;
        b.fillRect(x + 2, y + (w ? 1 : 0), 1, 1);
      }
    }
    b.globalAlpha = 1;
    const r = this.rare;
    if (r) {
      const col = ORGANELLE_COLORS[r.id] ?? PAL.y;
      const x = Math.round(r.x);
      const y = Math.round(r.y);
      // Glowing, pulsing, and blinking as it's about to leave.
      if (r.life > 5 || Math.floor(t * 8) % 2) {
        ring(b, x, y, 5 + ((t * 6) % 4), col);
        b.fillStyle = PAL.w;
        b.fillRect(x - 2, y - 1, 5, 3);
        b.fillRect(x - 1, y - 2, 3, 5);
        b.fillStyle = col;
        b.fillRect(x - 1, y - 1, 3, 3);
        b.fillStyle = PAL.k;
        b.fillRect(x, y, 1, 1);
        if (Math.floor(t * 3) % 3 === 0) {
          b.fillStyle = PAL.w;
          b.fillRect(x + 4, y - 4, 1, 1);
        }
      }
    }
  }

  /** The hero and predators, drawn over the swarm. */
  drawFront(f: Frame): void {
    const { b, t } = f;
    const m = this.marker;
    if (m) {
      b.fillStyle = PAL.w;
      const s = Math.round(2 + m.age * 4);
      for (const [dx, dy] of [[-s, 0], [s, 0], [0, -s], [0, s]]) b.fillRect(Math.round(m.x + dx), Math.round(m.y + dy), 1, 1);
    }
    // Bitten cells burst into red bits.
    for (const bt of this.bites) {
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const r = 2 + bt.age * 14;
        b.fillStyle = bt.age < 0.25 ? PAL.w : '#e8615a';
        b.fillRect(Math.round(bt.x + Math.cos(a) * r), Math.round(bt.y + Math.sin(a) * r * 0.8), 1, 1);
      }
    }
    for (const p of this.preds) {
      const cores: Core[] = [];
      const wob = p.flinch > 0 ? 1.4 : 1;
      cores.push({ x: p.x, y: p.y, r: 6.5 * wob, nucleus: true });
      // A mouth-like pseudopod reaching toward where it swims.
      const a = Math.atan2(p.vy, p.vx || 0.01);
      const reach = 7 + Math.sin(t * 4 + p.phase) * 2;
      cores.push({ x: p.x + Math.cos(a) * reach, y: p.y + Math.sin(a) * reach * 0.7, r: 3.2, nucleus: false });
      cores.push({ x: p.x - Math.cos(a + 0.6) * 6, y: p.y - Math.sin(a + 0.6) * 5, r: 2.8, nucleus: false });
      drawBlob(b, cores, p.flinch > 0 ? PREDATOR_FLINCH : p.poisoned ? PREDATOR_SICK : PREDATOR_STYLE);
      // Little eyes, so it reads as a hunter.
      b.fillStyle = PAL.y;
      const ex = Math.round(p.x + Math.cos(a) * 3);
      const ey = Math.round(p.y + Math.sin(a) * 2 - 2);
      b.fillRect(ex - 1, ey, 1, 1);
      b.fillRect(ex + 1, ey, 1, 1);
      if (!p.fleeing && p.hits > 0) {
        // How hurt it is: a pip per hit.
        b.fillStyle = PAL.w;
        for (let i = 0; i < p.hits; i++) b.fillRect(Math.round(p.x - 2 + i * 2), Math.round(p.y - 10), 1, 1);
      }
    }
  }

  /** Your own cell, drawn last so it sits on top of everything, darkness and glows included. */
  drawHero(f: Frame): void {
    const { b, t } = f;
    const h = this.hero;
    if (h && this.look) {
      const rx = HERO_RX[Math.min(3, this.look.size)];
      const moving = Math.hypot(h.vx, h.vy) > 2;
      drawCellLook(b, this.look, h.x, h.y + Math.sin(t * 2) * 0.6, {
        rx,
        left: h.left,
        frame: Math.floor(t * (moving ? 10 : 4)) % 2,
        squash: h.gulp > 0 && Math.floor(t * 16) % 2 === 0,
        inner: true,
      });
    }
  }

  /** Things that glow, drawn again over the Depths' darkness: rare microbes and predators' eyes. */
  drawGlows(f: Frame): void {
    const { b, t } = f;
    const r = this.rare;
    if (r) {
      const col = ORGANELLE_COLORS[r.id] ?? PAL.y;
      ring(b, Math.round(r.x), Math.round(r.y), 5 + ((t * 6) % 4), col);
      b.fillStyle = col;
      b.fillRect(Math.round(r.x) - 1, Math.round(r.y) - 1, 3, 3);
    }
    for (const p of this.preds) {
      const a = Math.atan2(p.vy, p.vx || 0.01);
      const ex = Math.round(p.x + Math.cos(a) * 3);
      const ey = Math.round(p.y + Math.sin(a) * 2 - 2);
      b.fillStyle = PAL.y;
      b.fillRect(ex - 1, ey, 1, 1);
      b.fillRect(ex + 1, ey, 1, 1);
    }
  }

  /** Where the hero is, for effects. */
  heroAt(): [number, number] | null {
    return this.hero ? [this.hero.x, this.hero.y] : null;
  }
}
