// The living diorama in the middle of the screen. It reads the game state and
// draws it; it never changes the economy except through the tap it reports.
//
// Everything is drawn into a small buffer in "art pixels", then scaled up with
// hard edges. How much of each thing appears follows what's owned (one each at
// first, then the log), so the scene fills up without drawing thousands of sprites.

import { PAL } from '../art/sprites';
import type { GameState, StageId } from '../economy/types';
import { CellScene } from './cell';
import { RangeScene } from './range';
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
  private shore = new RangeScene();
  private displace = (x: number, y: number) => this.push(x, y);
  /** CSS pixels covered by the overlays at the top of the scene. */
  private topCss = 0;
  /** CSS pixels the open tab sheet covers at the bottom of the scene. */
  private bottomCss = 0;
  /** The Creature's map can be zoomed and panned: how far in, and the view's top-left in art pixels. */
  private zoom = 1;
  private camX = 0;
  private camY = 0;
  /** The camera keeps the known land centred until the player pans or pinches. */
  private autoCam = true;
  private camSnap = true;
  /** CSS pixels from the top of the scene to where the tab sheet starts. */
  private visBottomCss = 0;


  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.b = this.buffer.getContext('2d')!;
    this.fit();
  }

  fit(): void {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (!w || !h) return;
    // Aim for about 130 art pixels across, whatever the screen.
    this.px = Math.max(2, Math.round(w / 130));
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.W = Math.ceil(w / this.px);
    this.H = Math.ceil(h / this.px);
    this.buffer.width = this.W;
    this.buffer.height = this.H;
  }

  private toArt(x: number, y: number): [number, number] {
    return [this.camX + x / this.px / this.zoom, this.camY + y / this.px / this.zoom];
  }

  /** The camera may look a little past the map's edges (into fog), never further. */
  private clampCam(): void {
    const vw = this.W / this.zoom;
    const vh = this.H / this.zoom;
    this.camX = Math.max(-vw / 2, Math.min(this.W - vw / 2, this.camX));
    this.camY = Math.max(-vh / 2, Math.min(this.H - vh / 2, this.camY));
  }

  setVisibleBottom(cssPx: number): void {
    // Opening or closing the sheet re-centres the land in what's left of the screen.
    if (Math.abs(cssPx - this.visBottomCss) > 40) this.autoCam = true;
    this.visBottomCss = cssPx;
  }

  /** Pinch or wheel on the map: zooms by `factor`, keeping the point under the fingers still. */
  zoomAt(cssX: number, cssY: number, factor: number): void {
    if (this.stage !== 'creature') return;
    const [wx, wy] = this.toArt(cssX, cssY);
    this.autoCam = false;
    this.zoom = Math.max(1, Math.min(4, this.zoom * factor));
    this.camX = wx - cssX / this.px / this.zoom;
    this.camY = wy - cssY / this.px / this.zoom;
    this.clampCam();
  }

  /** Dragging the zoomed map. */
  panBy(dxCss: number, dyCss: number): void {
    if (this.stage !== 'creature') return;
    this.autoCam = false;
    this.camX -= dxCss / this.px / this.zoom;
    this.camY -= dyCss / this.px / this.zoom;
    this.clampCam();
  }

  get zoomed(): boolean {
    return this.zoom > 1.01;
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
    this.shore.tap(state, x, y);
  }

  /** What happened in the pond since last asked, with positions in CSS pixels. */
  pondEvents(): PondEvent[] {
    if (this.stage !== 'cell' && this.stage !== 'creature') return [];
    const k = this.px * this.zoom;
    return (this.stage === 'cell' ? this.cell.pond.drain() : this.shore.drain()).map((e) => ({ ...e, x: (e.x - this.camX) * k, y: (e.y - this.camY) * k }));
  }

  /** Plays a purchase out in the scene. Call after the purchase went through. */
  purchase(state: GameState, id: string): void {
    if (state.current === 'soup') this.soup.purchase(state, id, this.displace);
    else if (state.current === 'creature') this.shore.purchase(state, id);
    else this.cell.purchase(state, id);
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
      this.stage = state.current;
      this.soup.reset();
      this.cell.reset();
      this.shore.reset();
      this.zoom = 1;
      this.camX = 0;
      this.camY = 0;
      this.autoCam = true;
      this.camSnap = true;
    }
    const frame: Frame = { b: this.b, W: this.W, H: this.H, t: this.time, dt, top: Math.ceil(this.topCss / this.px), bottom: Math.ceil(this.bottomCss / this.px) };
    if (state.current === 'soup') this.soup.draw(frame, state, this.displace);
    else if (state.current === 'creature') {
      this.shore.draw(frame, state);
      if (this.autoCam) {
        // Home in the middle of the space between the top bar and the sheet.
        const home = this.shore.focus;
        const midCss = (this.topCss + (this.visBottomCss || this.H * this.px)) / 2;
        const tx = home.x - this.W / this.zoom / 2;
        const ty = home.y - midCss / this.px / this.zoom;
        const k = this.camSnap ? 1 : Math.min(1, dt * 4);
        this.camX += (tx - this.camX) * k;
        this.camY += (ty - this.camY) * k;
        this.camSnap = false;
        this.clampCam();
      }
    } else this.cell.draw(frame, state);
    for (const r of this.ripples) {
      this.b.globalAlpha = 1 - r.age;
      ring(this.b, r.x, r.y, r.age * 40, r.age < 0.5 ? PAL.w : PAL.b);
    }
    this.b.globalAlpha = 1;

    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    if (this.stage === 'creature') {
      // Past the map's edges is more fog. Only the part of the map in view is copied
      // (Safari won't draw a source rectangle that reaches outside the image).
      ctx.fillStyle = '#d4dbe0';
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      const k = this.px * this.dpr * this.zoom;
      const x0 = Math.max(0, this.camX);
      const y0 = Math.max(0, this.camY);
      const x1 = Math.min(this.W, this.camX + this.W / this.zoom);
      const y1 = Math.min(this.H, this.camY + this.H / this.zoom);
      if (x1 > x0 && y1 > y0) ctx.drawImage(this.buffer, x0, y0, x1 - x0, y1 - y0, (x0 - this.camX) * k, (y0 - this.camY) * k, (x1 - x0) * k, (y1 - y0) * k);
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
