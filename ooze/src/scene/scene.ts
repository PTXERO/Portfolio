// The living diorama in the middle of the screen. It reads the game state and
// draws it; it never changes the economy except through the tap it reports.
//
// Everything is drawn into a small buffer in "art pixels", then scaled up with
// hard edges. How much of each thing appears follows what's owned (one each at
// first, then the log), so the scene fills up without drawing thousands of sprites.

import { PAL } from '../art/sprites';
import { ashenFor } from '../economy/tribal';
import type { GameState, StageId } from '../economy/types';
import { CellScene } from './cell';
import { RangeScene } from './range';
import { TribeScene } from './tribe';
import { ShoreScene } from './shore';
import { MapShader } from './shade';
import type { PondEvent } from './pond';
import { ring, type Frame } from './paint';
import { SoupScene } from './soup';

const QUIPS = ['eep!', 'hey!', 'rude.', 'blub', '!!', 'boop', 'why', 'mrrp', 'oi'];

interface Ripple {
  x: number;
  y: number;
  age: number;
}

interface Floater {
  x: number;
  y: number;
  text: string;
  color: string;
  age: number;
}

export class Scene {
  private ctx: CanvasRenderingContext2D;
  private buffer = document.createElement('canvas');
  private b: CanvasRenderingContext2D;
  private dpr = Math.min(2, window.devicePixelRatio || 1);
  /** CSS pixels per art pixel. */
  private px = 3;
  private W = 0;
  private H = 0;
  private time = 0;
  private ripples: Ripple[] = [];
  private floaters: Floater[] = [];
  private flash = 0;
  private stage: StageId | '' = '';
  private soup = new SoupScene();
  private cell = new CellScene();
  private range = new RangeScene();
  /** New Shore's island and village. */
  private village = new ShoreScene();
  /** The Tribal era's map: the same island, broken (it builds on the Creature's). */
  private tribe = new TribeScene();
  /** Whether the walk to the spear is done (and it's waiting to be touched). */
  get spearReady(): boolean {
    return this.tribe.arrived;
  }
  /** As the spear comes down, the camera pulls out to the whole island, centred on where it
   * lands (the timing matches the strike's: from the omen to just before it hits). */
  frameStrike(state: GameState): void {
    const { spear } = ashenFor(state);
    this.range.pinCamera(spear.x, spear.y, 0.5, 1, 4.4);
  }

  /** Where the spear comes down, on screen (CSS pixels). */
  strikePoint(state: GameState): { x: number; y: number } {
    const p = this.range.screenOf(ashenFor(state).spear);
    const r = this.canvas.getBoundingClientRect();
    return { x: r.left + p.x * this.px, y: r.top + p.y * this.px };
  }

  // ---- Casting miracles (screen points in CSS pixels) ----

  /** The stroke being drawn (or null when done). */
  castStroke(pts: { x: number; y: number }[] | null): void {
    this.tribe.setStroke(pts ? pts.map((p) => ({ x: p.x / this.px, y: p.y / this.px })) : null);
  }
  worldAt(x: number, y: number): { x: number; y: number } {
    return this.tribe.worldAt(x / this.px, y / this.px);
  }
  /** The four leaving the spear's island: where each one's name goes, in CSS pixels. */
  leavingLabels(): { id: number; x: number; y: number }[] {
    if (this.stage !== 'tribal') return [];
    return this.tribe.leavingLabels().map((l) => ({ id: l.id, x: l.x * this.px, y: l.y * this.px }));
  }

  /** The island's weather, for the sound (null off the islands). */
  get skies(): { rain: number; snow: number; zoom: number } | null {
    // (New Shore has no weather of its own yet: just the wind.)
    return this.stage === 'creature' ? this.range.skies : this.stage === 'shore' ? this.village.skies : null;
  }

  get tribeScene(): TribeScene {
    return this.tribe;
  }
  /** World distance for a screen distance (CSS px), roughly, at the current zoom. */
  tilesFor(cssPx: number): number {
    const a = this.tribe.worldAt(0, 0);
    const b = this.tribe.worldAt(cssPx / this.px, 0);
    return Math.hypot(b.x - a.x, b.y - a.y);
  }

  /** After the waking's vision: it spreads from the one at the spear to the others. */
  spreadWake(): void {
    this.tribe.spreadWake();
  }

  /** Holds the walk to the spear (while the strike plays over it). */
  set holdWalk(on: boolean) {
    this.tribe.hold = on;
  }

  /** The map on show: the Creature's island or the Tribal era's fragment. */
  private get map(): RangeScene {
    return this.stage === 'tribal' ? this.tribe : this.stage === 'shore' ? this.village : this.range;
  }

  private get isMap(): boolean {
    return this.stage === 'creature' || this.stage === 'tribal' || this.stage === 'shore';
  }

  get shoreScene(): ShoreScene {
    return this.village;
  }
  private displace = (x: number, y: number) => this.push(x, y);
  /** CSS pixels covered by the overlays at the top of the scene. */
  private topCss = 0;
  /** CSS pixels the open tab sheet covers at the bottom of the scene. */
  private bottomCss = 0;


  /** The island's lighting, on a canvas under the main one (null where WebGL isn't there). */
  private shader: MapShader | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.b = this.buffer.getContext('2d')!;
    try {
      const gl = document.createElement('canvas');
      gl.className = 'shade';
      canvas.parentElement!.insertBefore(gl, canvas);
      this.shader = new MapShader(gl);
    } catch {
      this.shader = null;
    }
    this.fit();
  }

  fit(): void {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (!w || !h) return;
    // The art's pixel size, from the screen's area (not just its width): a phone gets the
    // chunky pixels it always had (about 130 across), a laptop or desktop a wider view of the
    // world at a pixel size that still reads as pixel art (never bigger than 6).
    this.px = Math.max(2, Math.min(6, Math.round(Math.sqrt((w * h) / 34000))));
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.W = Math.ceil(w / this.px);
    this.H = Math.ceil(h / this.px);
    this.buffer.width = this.W;
    this.buffer.height = this.H;
    if (this.shader) {
      // The land is marched pixel by pixel; at the screen's CSS resolution that's plenty
      // (the art is far coarser), and phones keep their frame rate.
      const k = Math.min(1.5, this.dpr);
      this.shader.canvas.width = Math.round(w * k);
      this.shader.canvas.height = Math.round(h * k);
    }
  }

  private toArt(x: number, y: number): [number, number] {
    return [x / this.px, y / this.px];
  }

  /** Pinch or wheel on the Creature's map: zooms by `factor` about the point under the fingers. */
  zoomAt(cssX: number, cssY: number, factor: number): void {
    if (!this.isMap) return;
    const [x, y] = this.toArt(cssX, cssY);
    this.map.zoomAt(x, y, factor);
  }

  /** Dragging the Creature's map. */
  panBy(dxCss: number, dyCss: number): void {
    if (!this.isMap) return;
    this.map.pan(dxCss / this.px, dyCss / this.px);
  }

  /** Where the tab sheet starts (CSS pixels from the top), so the map centres above it. */
  setVisibleBottom(cssPx: number): void {
    this.range.setView(this.topCss / this.px, cssPx / this.px);
    this.tribe.setView(this.topCss / this.px, cssPx / this.px);
    this.village.setView(this.topCss / this.px, cssPx / this.px);
  }

  get zoomed(): boolean {
    return this.isMap;
  }

  ripple(cssX: number, cssY: number): void {
    const [x, y] = this.toArt(cssX, cssY);
    this.ripples.push({ x, y, age: 0 });
    if (this.ripples.length > 5) this.ripples.shift();
  }

  float(cssX: number, cssY: number, text: string, color: string): void {
    this.floaters.push({ x: cssX + (Math.random() - 0.5) * 16, y: cssY, text, color, age: 0 });
    if (this.floaters.length > 24) this.floaters.shift();
  }

  /**
   * A tap in the Cell pond: steers your cell, or hits a predator under the
   * finger. Returns a quip when a swimmer was poked instead.
   */
  cellTap(state: GameState, cssX: number, cssY: number): { hit: boolean; quip: string | null } {
    const [x, y] = this.toArt(cssX, cssY);
    const r = this.cell.tap(state, x, y);
    return { hit: r.hit, quip: r.poked && Math.random() < 0.3 ? QUIPS[Math.floor(Math.random() * QUIPS.length)] : null };
  }

  /** A tap on the shore: walks your creature there, or hits a beast under the finger. */
  shoreTap(state: GameState, cssX: number, cssY: number): void {
    const [x, y] = this.toArt(cssX, cssY);
    this.map.tap(state, x, y);
  }

  /** What happened in the pond since last asked, with positions in CSS pixels. */
  pondEvents(): PondEvent[] {
    if (this.stage !== 'cell' && !this.isMap) return [];
    return (this.stage === 'cell' ? this.cell.pond.drain() : this.map.drain()).map((e) => ({ ...e, x: e.x * this.px, y: e.y * this.px }));
  }

  /** Plays a purchase out in the scene. Call after the purchase went through. */
  purchase(state: GameState, id: string): void {
    if (state.current === 'soup') this.soup.purchase(state, id, this.displace);
    else if (state.current === 'creature') this.range.purchase(state, id);
    else if (state.current !== 'tribal' && state.current !== 'shore') this.cell.purchase(state, id);
  }

  /** Tells the scene how much of its bottom the open sheet covers, so the floor stays in view. */
  setBottomInset(cssPx: number): void {
    this.bottomCss = cssPx;
  }

  /** Tells the scene how much of its top is covered, so life stays visible. */
  setTopInset(cssPx: number): void {
    this.topCss = cssPx;
  }

  /** A finger circling at (cssX, cssY): where the whirlpool sits, and its direction. */
  whirl(cssX: number, cssY: number, dir: number): void {
    const [x, y] = this.toArt(cssX, cssY);
    this.soup.whirl(x, y, dir);
  }

  /** Free products the soup's reactions just made, to show bonding. */
  made(ids: string[]): void {
    if (this.stage === 'soup') this.soup.made(ids);
  }

  /** A reaction was just discovered. */
  discovery(): void {
    if (this.stage === 'soup') this.soup.discovery();
  }

  /** The Soup's final reaction. */
  finale(): void {
    this.soup.finale();
  }

  /** Redraws the current stage from scratch, after a save is loaded or reset. */
  reload(): void {
    this.stage = '';
  }

  evolveFlash(): void {
    this.flash = 1;
  }

  draw(state: GameState, dt: number): void {
    if (!this.W) this.fit();
    if (!this.W) return;
    this.time += dt;
    for (const r of this.ripples) r.age += dt;
    this.ripples = this.ripples.filter((r) => r.age < 1);
    for (const f of this.floaters) f.age += dt;
    this.floaters = this.floaters.filter((f) => f.age < 1.1);
    this.flash = Math.max(0, this.flash - dt * 1.5);

    if (this.stage !== state.current) {
      // Into the Extinction the camera carries straight on (the strike lands where it looks).
      const [cx, cy, cz] = this.range.camParams;
      const handOn = state.current === 'tribal' && this.stage === 'creature';
      this.stage = state.current;
      this.soup.reset();
      this.cell.reset();
      this.range.reset();
      this.tribe.reset();
      this.village.reset();
      if (handOn) this.tribe.takeCamera(cx, cy, cz);
    }
    const frame: Frame = { b: this.b, W: this.W, H: this.H, t: this.time, dt, top: Math.ceil(this.topCss / this.px), bottom: Math.ceil(this.bottomCss / this.px) };
    if (state.current === 'soup') this.soup.draw(frame, state, this.displace);
    else if (state.current === 'creature' || state.current === 'tribal' || state.current === 'shore') {
      this.map.shaded = !!this.shader;
      this.map.draw(frame, state);
    } else this.cell.draw(frame, state);
    for (const r of this.ripples) {
      this.b.globalAlpha = 1 - r.age;
      ring(this.b, r.x, r.y, r.age * 40, r.age < 0.5 ? PAL.w : PAL.b);
    }
    this.b.globalAlpha = 1;

    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    const shaded = !!this.shader && this.isMap;
    if (this.shader) this.shader.canvas.style.display = shaded ? 'block' : 'none';
    if (shaded) {
      // The island is drawn lit by the shader underneath; this canvas keeps only what's on top.
      const inp = this.map.shadeInputs();
      if (inp) {
        this.shader!.setIsland(inp.key, inp.n, inp.heights);
        this.shader!.setFog(inp.fog, inp.fogVersion);
        this.shader!.render(this.buffer, this.W, this.H, { cam: this.map.camParams, tint: inp.tint, time: this.time, day: (this.time % 120) / 120, ground: inp.ground, blend: inp.blend, trail: inp.trail, trailVersion: inp.trailVersion, weather: inp.weather, bow: inp.bow, ash: inp.ash });
      }
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    } else ctx.drawImage(this.buffer, 0, 0, this.W * this.px * this.dpr, this.H * this.px * this.dpr);

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.font = '700 18px "Ooze Digits", "Pixelify Sans", monospace';
    ctx.textAlign = 'center';
    ctx.lineJoin = 'round';
    for (const f of this.floaters) {
      const y = f.y - f.age * 46;
      ctx.globalAlpha = Math.min(1, (1.1 - f.age) * 3);
      ctx.lineWidth = 4;
      ctx.strokeStyle = PAL.k;
      ctx.strokeText(f.text, f.x, y);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, y);
    }
    ctx.globalAlpha = 1;
    if (this.flash > 0) {
      ctx.fillStyle = `rgba(242, 234, 215, ${this.flash})`;
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }
  }

  /** Push from recent ripples, so stirring visibly moves things. */
  private push(x: number, y: number): [number, number] {
    let dx = 0;
    let dy = 0;
    for (const r of this.ripples) {
      const ex = x - r.x;
      const ey = y - r.y;
      const d = Math.hypot(ex, ey) || 1;
      const near = 1 - Math.abs(d - r.age * 40) / 10;
      if (near > 0) {
        const f = near * (1 - r.age) * 5;
        dx += (ex / d) * f;
        dy += (ey / d) * f;
      }
    }
    return [x + dx, y + dy];
  }
}
