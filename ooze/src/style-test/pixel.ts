// Pixel style: the scene is drawn into a small buffer one art-pixel at a time,
// then scaled up with smoothing off. Sprites are hand-placed pixels (placeholders
// until real art exists) and flip left/right instead of rotating.

import type { World } from './world';

/** Screen pixels (CSS) per art pixel. */
export const PIXEL = 3;

const PAL: Record<string, string> = {
  k: '#1b1b1b',
  w: '#f7f3e8',
  m: '#9ef0cf',
  b: '#4fb39a',
  n: '#2a6e63',
  o: '#f2906c',
  O: '#c4613f',
  p: '#ffc7a6',
};

const SPRITES = {
  cell: ['..mmmmm..', '.mbbbbbm.', 'mbbbbnnbm', 'mbbbbnnbm', 'mbbbbbbbm', '.mbbbbbm.', '..mmmmm..'],
  cellSquish: ['.........', '.mmmmmmm.', 'mbbbbnnbm', 'mbbbbnnbm', 'mbbbbbbbm', '.mmmmmmm.', '.........'],
  tailA: ['...m', '.mm.', 'm...'],
  tailB: ['m...', '.mm.', '...m'],
  head: ['..ooooo....', '.ooooooww..', 'oooooowkwo.', 'oooooowwooo', 'ooooooooooo', 'ooooooooOoo', 'OoooooooOOo', '.OOOOOOOOO.', '..OOOOOOO..'],
  segment: ['..ooooo..', '.oopoooo.', 'oopoooooo', 'ooooooooo', 'oooooooOo', 'OooooooOO', '.OOOOOOO.', '..OOOOO..'],
  legA: ['.O.', '.O.', '.O.', 'OO.'],
  legB: ['.O.', '.O.', 'O..', 'O..'],
};
type SpriteName = keyof typeof SPRITES;

interface Baked {
  right: HTMLCanvasElement;
  left: HTMLCanvasElement;
  w: number;
  h: number;
}

function bake(rows: string[]): Baked {
  const h = rows.length;
  const w = rows[0].length;
  const make = (flip: boolean) => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d')!;
    rows.forEach((row, y) =>
      [...row].forEach((ch, x) => {
        if (ch === '.') return;
        ctx.fillStyle = PAL[ch];
        ctx.fillRect(flip ? w - 1 - x : x, y, 1, 1);
      }),
    );
    return c;
  };
  return { right: make(false), left: make(true), w, h };
}

let baked: Record<SpriteName, Baked> | null = null;
let buffer: HTMLCanvasElement | null = null;

function sprite(ctx: CanvasRenderingContext2D, name: SpriteName, x: number, y: number, facingLeft: boolean): void {
  const s = baked![name];
  ctx.drawImage(facingLeft ? s.left : s.right, Math.round(x - s.w / 2), Math.round(y - s.h / 2));
}

function background(ctx: CanvasRenderingContext2D, W: number, H: number, floor: number, t: number): void {
  // Water in flat bands, with a checker dither where two bands meet.
  const bands = ['#1d5a6e', '#184d60', '#134052', '#0d2b3a'];
  const bandH = Math.ceil(floor / bands.length);
  bands.forEach((col, i) => {
    ctx.fillStyle = col;
    ctx.fillRect(0, i * bandH, W, bandH);
    if (i > 0) {
      ctx.fillStyle = bands[i - 1];
      for (let x = (i % 2); x < W; x += 2) ctx.fillRect(x, i * bandH, 1, 1);
    }
  });

  // Glints of light drifting along.
  ctx.fillStyle = '#3f8a99';
  for (let i = 0; i < 12; i++) {
    const x = Math.floor((i * 37 + t * (3 + (i % 4))) % (W + 20)) - 10;
    const y = 6 + ((i * 23) % Math.max(1, floor - 20));
    ctx.fillRect(x, y, 4 + (i % 3) * 2, 1);
  }

  // Seaweed: columns of pixels that sway as a whole, a few rows at a time.
  for (let i = 0; i < 7; i++) {
    const bx = Math.floor(((i + 0.5) / 7) * W);
    const h = Math.floor(H * (0.25 + (i % 3) * 0.08));
    for (let y = 0; y < h; y++) {
      const sway = Math.round(Math.sin(t * 0.9 + i - y * 0.08) * (y / h) * 4);
      ctx.fillStyle = (y >> 2) % 2 ? '#2f8a5a' : '#5fbf78';
      ctx.fillRect(bx + sway, floor - y, 2, 1);
    }
  }

  // Sand: a stepped top edge and speckles.
  ctx.fillStyle = '#d8c08a';
  for (let x = 0; x < W; x++) {
    const top = floor + Math.round(Math.sin(x * 0.06) * 1.5);
    ctx.fillRect(x, top, 1, H - top);
  }
  ctx.fillStyle = '#b99f69';
  for (let i = 0; i < 40; i++) ctx.fillRect((i * 29) % W, floor + 4 + ((i * 13) % Math.max(1, H - floor - 5)), 2, 1);

  // Rocks: pixel half-ellipses with a highlight.
  for (const [rx, r] of [
    [Math.floor(W * 0.78), 10],
    [Math.floor(W * 0.12), 7],
  ]) {
    for (let y = 0; y < r; y++) {
      const half = Math.round(Math.sqrt(1 - (y / r) ** 2) * r * 1.3);
      ctx.fillStyle = '#56636c';
      ctx.fillRect(rx - half, floor + 1 - y, half * 2, 1);
    }
    ctx.fillStyle = '#75848d';
    ctx.fillRect(rx - Math.floor(r * 0.6), floor + 1 - Math.floor(r * 0.7), Math.floor(r * 0.6), 2);
  }
}

export function drawPixel(ctx: CanvasRenderingContext2D, w: World, dpr: number): void {
  if (!baked) {
    baked = Object.fromEntries(Object.entries(SPRITES).map(([k, rows]) => [k, bake(rows)])) as Record<SpriteName, Baked>;
  }
  const W = Math.ceil(w.width / PIXEL);
  const H = Math.ceil(w.height / PIXEL);
  if (!buffer || buffer.width !== W || buffer.height !== H) {
    buffer = document.createElement('canvas');
    buffer.width = W;
    buffer.height = H;
  }
  const b = buffer.getContext('2d')!;
  const floor = Math.floor(w.floor / PIXEL);
  const t = w.time;
  background(b, W, H, floor, t);

  // Cells: body + whipping tail; squish when poked.
  for (const c of w.cells) {
    const left = c.vx < 0;
    const x = c.x / PIXEL;
    const y = c.y / PIXEL;
    const flick = Math.floor(t * 8 + c.phase) % 2 === 0;
    sprite(b, flick ? 'tailA' : 'tailB', x + (left ? 6 : -6), y, left);
    const squish = c.poked > 0 && Math.floor(t * 16) % 2 === 0;
    sprite(b, squish ? 'cellSquish' : 'cell', x, y, left);
  }

  // Creature: head plus segments trailing behind, legs alternating frames.
  const cr = w.creature;
  const left = cr.vx < 0;
  const dir = left ? -1 : 1;
  const cx = cr.x / PIXEL;
  const groundY = floor + 2;
  const hop = cr.poked > 0 ? -Math.abs(Math.round(Math.sin(t * 20) * 3)) : 0;
  for (let s = cr.segments - 1; s >= 0; s--) {
    const x = cx - dir * s * 8;
    const step = Math.floor(cr.phase * 2 + s) % 2 === 0;
    sprite(b, step ? 'legA' : 'legB', x - 2, groundY - 1, left);
    sprite(b, step ? 'legB' : 'legA', x + 2, groundY - 1, left);
    const name = s === 0 ? 'head' : 'segment';
    sprite(b, name, x, groundY - 6 + hop + (s === 0 ? -1 : 0), left);
  }

  // Scale the small buffer up to the screen with hard pixel edges.
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(buffer, 0, 0, W * PIXEL * dpr, H * PIXEL * dpr);

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.font = 'bold 13px ui-monospace, Menlo, monospace';
  ctx.textAlign = 'center';
  for (const q of w.quips) {
    ctx.globalAlpha = Math.max(0, 1 - q.age / 1.4);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(q.text, q.x, Math.round((q.y - q.age * 20) / PIXEL) * PIXEL);
  }
  ctx.globalAlpha = 1;
}
