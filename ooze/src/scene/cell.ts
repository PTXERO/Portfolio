// The Cell stage scene: a pond whose life is drawn from what you own, and
// whose purchases play out on screen (cells divide, colonies clump, pillars rise).
// Every cell wears the lineage's mutations; the pond's active life (your own
// cell, food, rare microbes, predators) lives in pond.ts.

import { PAL } from '../art/sprites';
import { habitatOf } from '../economy/rates';
import type { GameState } from '../economy/types';
import { Effects, ease, glints, hash, ring, strata, visibleCount, water, type Frame } from './paint';
import { drawBlob, type BlobStyle, type Core } from './blob';
import { DIET_COLORS, drawCellLook, lookOf, type Look } from './cellLook';
import { Pond, SHAFT_SLANT } from './pond';
import { SPLIT_AT, Swarm } from './swarm';

/** How each habitat looks: water bands top to bottom, glints, and the floor. */
const HABITATS: Record<string, { water: string[]; glint: string; sand: [string, string]; rock: [string, string] }> = {
  shallows: { water: ['#2a7184', '#1d5a6e', '#184d60', '#134052', '#0d2b3a'], glint: '#3f8a99', sand: [PAL.s, PAL.S], rock: [PAL.r, PAL.R] },
  depths: { water: ['#1a3f5c', '#16364f', '#122d43', '#0e2437', '#0a1a2a'], glint: '#2a5a78', sand: ['#5a6a70', '#46555c'], rock: ['#3a4650', '#4c5a64'] },
  vents: { water: ['#2b2236', '#251d2f', '#201927', '#1b1420', '#1a0f14'], glint: '#4a3550', sand: ['#3a3236', '#2a2428'], rock: ['#2e2a2c', '#46403f'] },
};

interface Colony {
  x: number;
  /** Height as a share of the open water, so it survives the scene resizing. */
  yf: number;
  vx: number;
  phase: number;
  /** Cells stuck together in this blob. */
  size: number;
  /** Seconds since it started forming (formation takes FORM_SEC). */
  age: number;
  /** Seconds of the pulse after a new cell joins. */
  pulse: number;
}

interface Pillar {
  x: number;
  h: number;
  maxH: number;
}

/**
 * What lives where: each habitat has its own lineup, drawn in the same roles
 * (a free-swimming swarm, colonies, a film on the rocks, mats on the floor,
 * pillars, drifting specks, chimneys) in its own colours.
 */
interface Lineup {
  swarm?: string;
  colony?: string;
  film?: string;
  mat?: string;
  pillar?: string;
  specks?: string;
  chimney?: string;
  matColors: string[];
  pillarColors: [string, string, string];
  speck: 'plankton' | 'glow';
}
const LINEUPS: Record<string, Lineup> = {
  shallows: { swarm: 'fission', colony: 'colony', film: 'biofilm', mat: 'mat', pillar: 'stromatolite', specks: 'plankton', matColors: [PAL.l, PAL.L, PAL.G, PAL.n], pillarColors: [PAL.r, PAL.R, PAL.l], speck: 'plankton' },
  depths: { swarm: 'ambusher', colony: 'pack', mat: 'snowfeeder', specks: 'glow', matColors: ['#c2cde0', '#8fa8b8', '#5a6a70', '#46555c'], pillarColors: [PAL.r, PAL.R, PAL.w], speck: 'glow' },
  vents: { swarm: 'thermophile', mat: 'sulfurMat', pillar: 'reef', chimney: 'chimney', matColors: [PAL.y, PAL.Y, '#a8782a', '#6a4a20'], pillarColors: ['#3a3236', '#4a4044', '#f2906c'], speck: 'plankton' },
};
type Role = 'swarm' | 'colony' | 'film' | 'mat' | 'pillar' | 'specks' | 'chimney';

const FORM_SEC = 1.3;
/** Where each member of a colony sits, relative to its centre. */
const MEMBERS: [number, number][] = [
  [0, 0],
  [7, -2],
  [-7, 1],
  [2, 5],
  [-3, -5],
  [8, 5],
  [-8, -5],
];

export class CellScene {
  swarm = new Swarm();
  pond = new Pond();
  private habitat = '';
  /** Seconds of the dark wipe after moving habitat. */
  private wipe = 0;
  private look: Look | null = null;
  /** The Depths' darkness, drawn on its own layer with a hole of light around your cell. */
  private dark = document.createElement('canvas');
  private colonies: Colony[] = [];
  private pillars: Pillar[] = [];
  private matShown = 0;
  private filmShown = 0;
  private fx = new Effects();
  private ready = false;
  private floor = 0;
  private W = 0;
  private top = 0;

  /** Called when the stage opens or the save loads: everything appears at once. */
  reset(): void {
    this.ready = false;
    this.fx.clear();
    this.pond.reset();
    this.habitat = '';
  }

  private colonyTargets(owned: number): { count: number; size: number } {
    return { count: Math.min(8, owned), size: Math.min(MEMBERS.length, 3 + Math.floor(Math.log2(1 + owned) / 2)) };
  }

  /** Colonies swim in four lanes across the water, so they rarely overlap. */
  private newColony(index: number, size: number, forming: boolean): Colony {
    return {
      x: this.W * ((Math.floor(index / 4) % 2) * 0.5 + 0.25) + (hash(index, 59) - 0.5) * 10,
      yf: ((index % 4) + 0.5) / 4 + (hash(index, 61) - 0.5) * 0.08,
      vx: (Math.random() < 0.5 ? -1 : 1) * (1.5 + Math.random()),
      phase: Math.random() * 10,
      size,
      age: forming ? 0 : FORM_SEC,
      pulse: 0,
    };
  }

  /** Pillars stand in the gaps between the rocks, never hidden behind one. */
  private pillarAt(i: number): Pillar {
    const slots = [0.33, 0.56, 0.45, 0.65, 0.25, 0.93];
    return { x: Math.floor(this.W * slots[i % slots.length]), h: 0, maxH: 10 + Math.floor(hash(i, 43) * 12) };
  }

  private colonyY(c: Colony): number {
    return this.top + 12 + c.yf * Math.max(1, this.floor - this.top - 34);
  }

  /** Share of each rock covered in biofilm. */
  private filmTarget(owned: number): number {
    return owned > 0 ? Math.min(1, 0.25 + 0.15 * Math.log2(owned)) : 0;
  }

  private lineup(state: GameState): Lineup {
    return LINEUPS[state.stages.cell.habitat] ?? LINEUPS.shallows;
  }

  /** How many of the generator playing `role` in this habitat are owned. */
  private owned(state: GameState, role: Role): number {
    const id = this.lineup(state)[role];
    return id ? state.stages.cell.generators[id] ?? 0 : 0;
  }

  /** Purchases, played out. `id` is a generator or boost id. Life in other habitats isn't on screen. */
  purchase(state: GameState, id: string): void {
    const L = this.lineup(state);
    const role = (Object.keys(L) as (keyof Lineup)[]).find((k) => L[k] === id) as Role | undefined;
    const isGen = state.stages.cell.generators[id] !== undefined;
    if (isGen && !role) return;
    const fx = this.fx;
    const W = this.W;
    const floor = this.floor;
    switch (role ?? id) {
      case 'swarm':
        // Growth divisions come from the target; at the cap, divide just for show.
        if (this.swarm.target >= visibleCount(this.owned(state, 'swarm'), 60)) this.swarm.divideBurst(1);
        break;
      case 'specks':
        fx.sparkle(W * (0.2 + Math.random() * 0.6), this.top + 10 + Math.random() * 20);
        break;
      case 'chimney':
        fx.dust(Math.floor(W * 0.5), floor, 10);
        break;
      case 'colony': {
        const { count, size } = this.colonyTargets(this.owned(state, 'colony'));
        if (this.colonies.length < count) this.colonies.push(this.newColony(this.colonies.length, size, true));
        else if (this.colonies.length) {
          // Full house: a cell swims over and joins an existing colony.
          const c = this.colonies[Math.floor(Math.random() * this.colonies.length)];
          const from = [Math.random() < 0.5 ? -10 : W + 10, Math.random() * floor * 0.8] as const;
          fx.add(1, (f, age) => {
            const k = ease(age);
            if (this.look) drawCellLook(f.b, this.look, from[0] + (c.x - from[0]) * k, from[1] + (this.colonyY(c) - from[1]) * k, { rx: 4, left: from[0] > c.x, frame: Math.floor(age * 8) % 2 });
            if (age > 0.95) c.pulse = 0.4;
          });
          c.size = Math.max(c.size, size);
        }
        break;
      }
      case 'film':
        for (const rx of this.rockXs()) fx.rain(PAL.l, 6, rx - 10, rx + 10, () => floor - 6);
        break;
      case 'mat': {
        const edge = Math.floor((W + this.matTarget(this.owned(state, 'mat'))) / 2);
        fx.sparkle(edge, floor + 1);
        fx.sparkle(W - edge, floor + 1, 0.1);
        break;
      }
      case 'pillar': {
        const target = Math.min(6, this.owned(state, 'pillar'));
        if (this.pillars.length < target) {
          const p = this.pillarAt(this.pillars.length);
          this.pillars.push(p);
          fx.dust(p.x, floor);
        } else if (this.pillars.length) {
          const p = this.pillars[Math.floor(Math.random() * this.pillars.length)];
          p.maxH = Math.min(30, p.maxH + 2);
          fx.dust(p.x, floor, 5);
        }
        break;
      }
      // Boosts
      case 'fastFission':
        this.swarm.divideBurst(4);
        break;
      case 'soupFeeding':
        fx.rain(PAL.y, 40, 0, W, () => floor * (0.3 + Math.random() * 0.6), 2);
        break;
      case 'quorum':
        this.colonies.forEach((c, i) => {
          fx.pulse(c.x, this.colonyY(c), PAL.g, i * 0.12);
          fx.pulse(c.x, this.colonyY(c), PAL.g, i * 0.12 + 0.35);
        });
        break;
      case 'slime':
        fx.add(1.6, (f, age) => {
          const reach = ease(age / 1.2) * W;
          f.b.fillStyle = PAL.l;
          for (let x = 0; x < reach; x += 2) f.b.fillRect(x, floor - 1 - ((x >> 1) % 2), 1, 1);
        });
        break;
      case 'layering':
        fx.sparkle(W / 2, floor + 3);
        break;
      default: {
        // A mutation: the change ripples out from your own cell, then the swarm.
        const at = this.pond.heroAt();
        if (!at) break;
        const diet = id === 'grazer' || id === 'hunter' || id === 'omnivore' ? DIET_COLORS[id][1] : PAL.w;
        fx.pulse(at[0], at[1], diet);
        fx.pulse(at[0], at[1], diet, 0.3);
        fx.sparkle(at[0] + 6, at[1] - 6, 0.2);
        this.swarm.cells.forEach((c, i) => {
          if (i < 12) fx.add(0.5, (f) => ring(f.b, c.x, c.y, 4, diet), 0.4 + i * 0.05);
        });
      }
    }
  }

  private matTarget(owned: number): number {
    return Math.min(this.W, owned > 0 ? Math.round(this.W * (0.15 + 0.12 * Math.log2(1 + owned))) : 0);
  }

  private rockXs(): number[] {
    return [Math.floor(this.W * 0.78), Math.floor(this.W * 0.14)];
  }

  draw(f: Frame, state: GameState): void {
    const { b, W, H, t, dt, top } = f;
    // The floor sits where it does with the sheet open; closing it just shows more sand.
    const floor = Math.floor((H - f.bottom) * 0.82);
    this.W = W;
    this.floor = floor;
    this.top = top;
    const st = state.stages.cell;
    const has = (u: string) => st.upgrades.includes(u);
    const look = (this.look = lookOf(state, 'cell'));
    // The swarm wears a lighter version of the look, so a crowd stays readable;
    // your own cell shows every mutation.
    const species = (st.habitat || 'shallows') as Look['species'];
    const crowd: Look = { ...look, flagella: Math.min(1, look.flagella), cilia: false, thick: false, eyespot: false, spikes: false, toxin: false, species };
    // Each place's cells move their own way: Depths ambushers drift slowly, Vents rods twitch in the heat.
    this.swarm.speed = species === 'vents' ? 1.3 : 1;
    this.swarm.jitter = species === 'vents' ? 10 : 0;
    this.swarm.mode = species === 'depths' ? 'ambush' : species === 'vents' ? 'vent' : 'school';
    const hab = HABITATS[habitatOf(state, 'cell')?.id ?? 'shallows'] ?? HABITATS.shallows;
    if (this.habitat !== st.habitat) {
      // Another habitat: a quick dark wipe, then its own life.
      if (this.habitat) this.wipe = 0.6;
      this.habitat = st.habitat;
      this.pond.moved();
      this.ready = false;
    }
    const L = this.lineup(state);
    const n = (role: Role) => this.owned(state, role);

    // First frame on this stage: show what's owned without replaying it all.
    if (!this.ready) {
      this.ready = true;
      this.swarm.fill(visibleCount(n('swarm'), 60), W, floor, top);
      const { count, size } = this.colonyTargets(n('colony'));
      this.colonies = Array.from({ length: count }, (_, i) => this.newColony(i, size, false));
      this.pillars = Array.from({ length: Math.min(6, n('pillar')) }, (_, i) => ({ ...this.pillarAt(i), h: this.pillarAt(i).maxH }));
      this.matShown = this.matTarget(n('mat'));
      this.filmShown = this.filmTarget(n('film'));
    }

    water(f, hab.water, floor);
    glints(f, hab.glint, floor);
    if (st.habitat !== 'vents') this.pond.env = { shafts: [], plumes: [] };
    if (st.habitat === 'shallows') {
      // Sunlight falls in slanting shafts that drift across the water; algae gathers in them.
      const shafts = [0, 1, 2].map((k) => Math.floor(W * (((t * 0.012 + k / 3) % 1) * 1.2 - 0.1)));
      this.pond.env = { shafts, plumes: [] };
      b.globalAlpha = 0.09;
      b.fillStyle = PAL.w;
      for (const sx of shafts) {
        for (let y = 0; y < floor; y += 2) b.fillRect(Math.round(sx + y * SHAFT_SLANT) - 4, y, 9, 2);
      }
      b.globalAlpha = 1;
    }
    if (st.habitat === 'depths') {
      // Marine snow drifting down through the dark.
      b.fillStyle = '#8fa8b8';
      for (let i = 0; i < 24; i++) {
        const x = Math.floor(hash(i, 3) * W + Math.sin(t * 0.5 + i) * 2);
        const y = Math.floor((hash(i, 7) * floor + t * (2 + (i % 3))) % floor);
        b.fillRect(x, y, 1, 1);
      }
    }
    if (st.habitat === 'vents') {
      // A hot glow along the floor, and chimneys puffing dark smoke.
      for (let y = 0; y < 10; y++) {
        b.fillStyle = y < 4 ? '#5a2020' : '#3a1820';
        for (let x = (y + Math.floor(t * 3)) % 3; x < W; x += 3 + (y >> 1)) b.fillRect(x, floor - y, 1, 1);
      }
      // Two natural chimneys, plus one more for each Chimney City (up to six).
      const spots = [0.3, 0.62, 0.12, 0.86, 0.46, 0.74].slice(0, 2 + Math.min(4, n('chimney')));
      this.pond.env = { shafts: [], plumes: spots.map((cx) => Math.floor(W * cx)) };
      // Heat shimmer rising the whole height of each plume.
      for (const cx of spots) {
        const x = Math.floor(W * cx);
        for (let i = 0; i < 14; i++) {
          const y = Math.round(floor - ((t * 26 + i * 13) % Math.max(1, floor - top)));
          b.fillStyle = i % 3 ? '#4a2a30' : '#6a3a38';
          b.fillRect(x + Math.round(Math.sin(t * 4 + i) * 3), y, 1, 2);
        }
      }
      for (const [k, cx] of spots.entries()) {
        const x = Math.floor(W * cx);
        const ch = 14 + ((k * 7) % 11);
        b.fillStyle = hab.rock[1];
        b.fillRect(x - 3, floor - ch, 6, ch);
        b.fillStyle = hab.rock[0];
        b.fillRect(x - 2, floor - ch, 1, ch);
        b.fillStyle = '#f2906c';
        b.fillRect(x - 1, floor - ch, 2, 1);
        for (let i = 0; i < 8; i++) {
          const age = (t * 0.7 + i / 8 + k * 0.3) % 1;
          b.fillStyle = age < 0.2 ? '#6a5a60' : '#3a3038';
          const s = 1 + Math.floor(age * 3);
          b.fillRect(Math.round(x + Math.sin(age * 6 + i) * age * 6) - (s >> 1), Math.round(floor - ch - age * 30), s, s);
        }
      }
    }

    // Pillars (stromatolites, smoker reefs) rise out of the floor at the back.
    for (const p of this.pillars) {
      p.h = Math.min(p.maxH, p.h + dt * 14);
      for (let y = 0; y < Math.round(p.h); y++) {
        b.fillStyle = (y >> 1) % 2 ? L.pillarColors[0] : L.pillarColors[1];
        b.fillRect(p.x - 3, floor - y, 6, 1);
      }
      if (p.h > 1) {
        b.fillStyle = L.pillarColors[2];
        b.fillRect(p.x - 3, floor - Math.round(p.h), 6, 1);
      }
    }

    // Sand (mud in the depths, basalt at the vents).
    b.fillStyle = hab.sand[0];
    for (let x = 0; x < W; x++) {
      const top = floor + Math.round(Math.sin(x * 0.06) * 1.5);
      b.fillRect(x, top, 1, H - top);
    }
    b.fillStyle = hab.sand[1];
    for (let i = 0; i < 40; i++) b.fillRect((i * 29) % W, floor + 4 + ((i * 13) % Math.max(1, Math.min(8, H - floor - 5))), 2, 1);
    strata(f, floor, hab.sand[0], '#14100e');

    // Microbial mats unroll outward from the middle.
    this.matShown += (this.matTarget(n('mat')) - this.matShown) * Math.min(1, dt * 2.5);
    const mw = Math.round(this.matShown);
    const layers = st.habitat === 'shallows' && has('layering') ? 4 : 3;
    const mx0 = Math.floor((W - mw) / 2);
    for (let x = 0; x < mw; x++) {
      for (let l = 0; l < layers; l++) {
        b.fillStyle = L.matColors[l];
        b.fillRect(mx0 + x, floor + 1 + l, 1, 1);
      }
    }

    // Rocks, with biofilm creeping up them.
    this.filmShown += (this.filmTarget(n('film')) - this.filmShown) * Math.min(1, dt * 2);
    const rocks: [number, number][] = [
      [this.rockXs()[0], 10],
      [this.rockXs()[1], 7],
    ];
    for (const [rx, r] of rocks) {
      const covered = Math.round(this.filmShown * r);
      for (let y = 0; y < r; y++) {
        const half = Math.round(Math.sqrt(1 - (y / r) ** 2) * r * 1.3);
        b.fillStyle = y < covered ? (y % 2 ? PAL.l : PAL.L) : hab.rock[0];
        b.fillRect(rx - half, floor + 1 - y, half * 2, 1);
      }
      if (covered < r * 0.7) {
        b.fillStyle = hab.rock[1];
        b.fillRect(rx - Math.floor(r * 0.6), floor + 1 - Math.floor(r * 0.7), Math.floor(r * 0.6), 2);
      }
    }

    // Colonies: member cells fused into one morphing amoeba that drifts slowly.
    const blobs: Core[][] = [];
    for (const c of this.colonies) {
      c.age += dt;
      c.pulse = Math.max(0, c.pulse - dt);
      c.x += c.vx * dt;
      if (c.x < 14) c.vx = Math.abs(c.vx);
      if (c.x > W - 14) c.vx = -Math.abs(c.vx);
      // Colonies sharing a lane bump apart instead of passing through each other.
      for (const o of this.colonies) {
        if (o === c || Math.abs(o.yf - c.yf) > 0.15) continue;
        const dx = o.x - c.x;
        if (Math.abs(dx) < 30 && Math.sign(dx) === Math.sign(c.vx)) c.vx = -c.vx;
      }
      const cy = this.colonyY(c) + Math.sin(t * 1.3 + c.phase) * 2;
      const k = ease(c.age / FORM_SEC);
      const swell = c.pulse > 0 ? 1 + Math.sin(c.pulse * 20) * 0.15 : 1;
      // While forming, members start far apart and swim in; as they meet,
      // their fields overlap and they melt into a single body.
      const spread = (0.75 + (1 - k) * 4) * swell;
      const cores: Core[] = [];
      for (let i = 0; i < c.size; i++) {
        const [ox, oy] = MEMBERS[i];
        cores.push({
          x: c.x + ox * spread + Math.sin(t * 1.7 + i * 2.1 + c.phase) * 1.3,
          y: cy + oy * spread + Math.cos(t * 1.3 + i * 1.7 + c.phase) * 1.1,
          r: 4.2,
          nucleus: true,
        });
      }
      // Two pseudopods reach out and pull back, so the outline keeps changing.
      if (k > 0.9) {
        for (let j = 0; j < 2; j++) {
          const a = c.phase + t * 0.35 + j * Math.PI;
          const reach = 9 + c.size * 0.8 + Math.sin(t * 1.9 + j * 2 + c.phase) * 4;
          cores.push({ x: c.x + Math.cos(a) * reach, y: cy + Math.sin(a) * reach * 0.6, r: 2.6, nucleus: false });
        }
      }
      blobs.push(cores);
    }
    // Colonies: the lineage's colours in the Shallows; hunting packs in the Depths glow like their members.
    const [fill, edge] = DIET_COLORS[look.diet ?? 'none'];
    const style: BlobStyle = species === 'depths' ? { edge: '#7fd3f0', body: '#1c3550', nucleus: '#b8f0ff' } : { edge, body: fill, nucleus: PAL.n };
    for (const cores of blobs) drawBlob(b, cores, style);
    for (const cores of blobs) drawBlob(b, cores, style, true);

    // Drifting specks: plankton near the bright surface, or glowing lures in the dark.
    const specks = visibleCount(n('specks'), 40);
    for (let i = 0; i < specks; i++) {
      const x = Math.floor((hash(i, 11) * W + t * (1 + (i % 3)) * (i % 2 ? 1 : -1) + W * 4) % W);
      if (L.speck === 'plankton') {
        const y = top + 4 + Math.floor(hash(i, 13) * Math.max(1, (floor - top) * 0.35) + Math.sin(t + i) * 1.5);
        b.fillStyle = i % 3 ? PAL.l : '#c8f08a';
        b.fillRect(x, y, 1, 1);
        if (i % 4 === 0) b.fillRect(x + 1, y, 1, 1);
      } else {
        const y = top + 8 + Math.floor(hash(i, 17) * Math.max(1, floor - top - 16) + Math.sin(t * 0.7 + i) * 2);
        const on = Math.sin(t * 2 + i * 1.7) > -0.3;
        if (!on) continue;
        b.fillStyle = i % 3 ? PAL.b : PAL.y;
        b.fillRect(x, y, 1, 1);
        b.globalAlpha = 0.35;
        b.fillRect(x - 1, y, 3, 1);
        b.fillRect(x, y - 1, 1, 3);
        b.globalAlpha = 1;
      }
    }

    this.swarm.env = { shafts: this.pond.env.shafts, slant: SHAFT_SLANT, plumes: this.pond.env.plumes };
    this.pond.step(f, state, floor, this.swarm);
    this.pond.drawBack(f);

    // The free-swimming swarm, dividing as it grows. Each cell wears the
    // lineage's mutations.
    this.swarm.target = visibleCount(n('swarm'), 60);
    this.swarm.step(dt, t, W, floor, top);
    for (const c of this.swarm.cells) {
      if (c.fade > 0 && Math.floor(t * 14) % 2) continue; // blink out
      const left = c.vx < 0;
      if (c.split >= 0) {
        // Two daughters pull apart inside one stretching body, wobbling as they go.
        const apart = Math.min(1, c.split / SPLIT_AT) * 3;
        const wob = Math.round(Math.sin(c.split * 40) * 0.6);
        drawCellLook(b, crowd, c.x - apart + wob, c.y, { rx: 4 });
        drawCellLook(b, crowd, c.x + apart + wob, c.y, { rx: 4, left: true });
        if (c.split > SPLIT_AT - 0.1) {
          b.fillStyle = PAL.w;
          b.fillRect(Math.round(c.x), Math.round(c.y) - 4, 1, 1);
        }
        continue;
      }
      const squish = (c.poked > 0 || c.pop > 0) && Math.floor(t * 16) % 2 === 0;
      drawCellLook(b, crowd, c.x, c.y, { rx: 4, left, frame: Math.floor(t * 8 + c.phase) % 2, squash: squish });
    }

    this.pond.drawFront(f);
    this.fx.run(f);

    // The Depths are dark: you only see what your cell can light. Glowing things show through.
    const at = this.pond.heroAt();
    if (st.habitat === 'depths' && at) {
      if (this.dark.width !== W || this.dark.height !== H) {
        this.dark.width = W;
        this.dark.height = H;
      }
      const d = this.dark.getContext('2d')!;
      d.globalCompositeOperation = 'source-over';
      d.clearRect(0, 0, W, H);
      d.fillStyle = 'rgba(3, 8, 18, 0.78)';
      d.fillRect(0, 0, W, H);
      d.globalCompositeOperation = 'destination-out';
      const r = this.pond.lightRadius(state) * (1 + Math.sin(t * 2) * 0.03);
      for (const [rad, a] of [[r + 6, 0.35], [r + 3, 0.6], [r, 1]] as const) {
        d.globalAlpha = a;
        d.beginPath();
        d.arc(Math.round(at[0]), Math.round(at[1]), rad, 0, Math.PI * 2);
        d.fill();
      }
      d.globalAlpha = 1;
      b.drawImage(this.dark, 0, 0);
      // Lures on the ambushers, the glow swarm's lights, rare microbes and predators' eyes.
      b.fillStyle = '#fff6a0';
      for (const c of this.swarm.cells) b.fillRect(Math.round(c.x + (c.vx < 0 ? -6 : 6)), Math.round(c.y) - 3, 1, 1);
      this.pond.drawGlows(f);
    }

    if (this.wipe > 0) {
      this.wipe = Math.max(0, this.wipe - dt);
      b.globalAlpha = Math.min(1, this.wipe * 2);
      b.fillStyle = PAL.k;
      b.fillRect(0, 0, W, H);
      b.globalAlpha = 1;
    }
  }

  /** A tap in the pond: hits a predator or steers your cell; nearby swimmers scatter. */
  tap(state: GameState, x: number, y: number): { hit: boolean; poked: boolean } {
    const hit = this.pond.tap(state, x, y) === 'hit';
    const poked = !hit && !!this.swarm.poke(x, y);
    return { hit, poked };
  }
}
