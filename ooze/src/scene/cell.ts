// The Cell stage scene: a pond whose life is drawn from what you own, and
// whose purchases play out on screen (cells divide, colonies clump, pillars rise).
// Every cell wears the lineage's mutations; the pond's active life (your own
// cell, food, rare microbes, predators) lives in pond.ts.

import { PAL } from '../art/sprites';
import { habitatOf } from '../economy/rates';
import type { GameState } from '../economy/types';
import { Effects, ease, glints, hash, ring, visibleCount, water, type Frame } from './paint';
import { drawBlob, type BlobStyle, type Core } from './blob';
import { DIET_COLORS, drawCellLook, lookOf, type Look } from './cellLook';
import { Pond } from './pond';
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

  /** Purchases, played out. `id` is a generator or boost id. */
  purchase(state: GameState, id: string): void {
    const gens = state.stages.cell.generators;
    const fx = this.fx;
    const W = this.W;
    const floor = this.floor;
    switch (id) {
      case 'fission':
        // Growth divisions come from the target; at the cap, divide just for show.
        if (this.swarm.target >= visibleCount(gens.fission, 60)) this.swarm.divideBurst(1);
        break;
      case 'colony': {
        const { count, size } = this.colonyTargets(gens.colony);
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
      case 'biofilm':
        for (const rx of this.rockXs()) fx.rain(PAL.l, 6, rx - 10, rx + 10, () => floor - 6);
        break;
      case 'mat': {
        const edge = Math.floor((W + this.matTarget(gens.mat)) / 2);
        fx.sparkle(edge, floor + 1);
        fx.sparkle(W - edge, floor + 1, 0.1);
        break;
      }
      case 'stromatolite': {
        const target = Math.min(6, gens.stromatolite);
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
    const floor = Math.floor(H * 0.82);
    this.W = W;
    this.floor = floor;
    this.top = top;
    const st = state.stages.cell;
    const gens = st.generators;
    const has = (u: string) => st.upgrades.includes(u);
    const look = (this.look = lookOf(state, 'cell'));
    // The swarm wears a lighter version of the look, so a crowd stays readable;
    // your own cell shows every mutation.
    const crowd: Look = { ...look, flagella: Math.min(1, look.flagella), cilia: false, thick: false, eyespot: false, spikes: false, toxin: false };
    const hab = HABITATS[habitatOf(state, 'cell')?.id ?? 'shallows'] ?? HABITATS.shallows;
    if (this.habitat !== st.habitat) {
      // Moving house: a quick dark wipe and a fresh pond.
      if (this.habitat) this.wipe = 0.6;
      this.habitat = st.habitat;
      this.pond.moved();
    }

    // First frame on this stage: show what's owned without replaying it all.
    if (!this.ready) {
      this.ready = true;
      this.swarm.fill(visibleCount(gens.fission, 60), W, floor, top);
      const { count, size } = this.colonyTargets(gens.colony);
      this.colonies = Array.from({ length: count }, (_, i) => this.newColony(i, size, false));
      this.pillars = Array.from({ length: Math.min(6, gens.stromatolite) }, (_, i) => ({ ...this.pillarAt(i), h: this.pillarAt(i).maxH }));
      this.matShown = this.matTarget(gens.mat);
      this.filmShown = this.filmTarget(gens.biofilm);
    }

    water(f, hab.water, floor);
    glints(f, hab.glint, floor);
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
      for (const [k, cx] of [[0, 0.3], [1, 0.62]] as const) {
        const x = Math.floor(W * cx);
        const ch = 14 + k * 6;
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

    // Stromatolites rise out of the sand at the back.
    for (const p of this.pillars) {
      p.h = Math.min(p.maxH, p.h + dt * 14);
      for (let y = 0; y < Math.round(p.h); y++) {
        b.fillStyle = (y >> 1) % 2 ? PAL.r : PAL.R;
        b.fillRect(p.x - 3, floor - y, 6, 1);
      }
      if (p.h > 1) {
        b.fillStyle = PAL.l;
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
    for (let i = 0; i < 40; i++) b.fillRect((i * 29) % W, floor + 4 + ((i * 13) % Math.max(1, H - floor - 5)), 2, 1);

    // Microbial mats unroll outward from the middle.
    this.matShown += (this.matTarget(gens.mat) - this.matShown) * Math.min(1, dt * 2.5);
    const mw = Math.round(this.matShown);
    const layers = has('layering') ? 4 : 3;
    const mx0 = Math.floor((W - mw) / 2);
    for (let x = 0; x < mw; x++) {
      for (let l = 0; l < layers; l++) {
        b.fillStyle = [PAL.l, PAL.L, PAL.G, PAL.n][l];
        b.fillRect(mx0 + x, floor + 1 + l, 1, 1);
      }
    }

    // Rocks, with biofilm creeping up them.
    this.filmShown += (this.filmTarget(gens.biofilm) - this.filmShown) * Math.min(1, dt * 2);
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
    const [fill, edge] = DIET_COLORS[look.diet ?? 'none'];
    const style: BlobStyle = { edge, body: fill, nucleus: PAL.n };
    for (const cores of blobs) drawBlob(b, cores, style);
    for (const cores of blobs) drawBlob(b, cores, style, true);

    this.pond.step(f, state, floor, this.swarm);
    this.pond.drawBack(f);

    // The free-swimming swarm, dividing as it grows. Each cell wears the
    // lineage's mutations.
    this.swarm.target = visibleCount(gens.fission, 60);
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
