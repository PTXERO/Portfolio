// How the creature looks, built from the parts it wears: legs, mouth, eyes, back
// and tail, drawn side-on facing right. Colours come from the Cell diet it grew
// out of. Every look is drawn pixel by pixel once and cached, like the cells.

import { PAL } from '../art/sprites';
import { dietOf } from '../economy/rates';
import type { GameState, Slot } from '../economy/types';
import { DIET_COLORS } from './cellLook';

export interface CreatureLook {
  parts: Partial<Record<Slot, string>>;
  diet: string;
}

export function creatureLookOf(state: GameState): CreatureLook {
  return { parts: { ...state.stages.creature.equipped }, diet: dietOf(state, 'creature') ?? 'none' };
}

const W = 30;
const H = 22;
/** Where the body's centre sits in the drawing. */
const CX = 15;
const CY = 11;
const cache = new Map<string, HTMLCanvasElement>();

function bake(look: CreatureLook, frame: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const b = c.getContext('2d')!;
  const [fill, edge] = DIET_COLORS[look.diet] ?? DIET_COLORS.none;
  const px = (x: number, y: number, col: string) => {
    b.fillStyle = col;
    b.fillRect(Math.round(x), Math.round(y), 1, 1);
  };
  const rect = (x: number, y: number, w: number, h: number, col: string) => {
    b.fillStyle = col;
    b.fillRect(x, y, w, h);
  };
  const p = look.parts;
  const rx = 7;
  const ry = 4;
  const inside = (x: number, y: number) => ((x - CX) / rx) ** 2 + ((y - CY) / ry) ** 2 <= 1.15;
  const step = frame ? 1 : -1;

  // Tail, behind the body (to the left).
  const tx = CX - rx;
  switch (p.tail) {
    case 'finTail':
      for (let i = 0; i < 4; i++) for (let j = -i; j <= i; j++) px(tx - 1 - i, CY + j * 0.7, i === 3 || Math.abs(j) === i ? edge : fill);
      break;
    case 'clubTail':
      for (let i = 0; i < 4; i++) px(tx - i, CY - 1 + (i >> 1), edge);
      rect(tx - 7, CY, 3, 3, PAL.r);
      px(tx - 6, CY, PAL.R);
      break;
    case 'crestTail':
      for (let i = 0; i < 3; i++) px(tx - i, CY - 1, edge);
      for (const [dx, dy, col] of [[-3, -4, PAL.p], [-4, -3, PAL.y], [-5, -1, PAL.p], [-4, 1, PAL.o], [-3, -2, PAL.o]] as const) {
        px(tx + dx, CY + dy, col);
        px(tx + dx + 1, CY + dy + 1, col);
      }
      break;
    default:
      px(tx - 1, CY, edge);
  }

  // Legs, under the body, stepping between two frames.
  const footY = CY + ry;
  const legsAt = [CX - 4, CX + 3];
  legsAt.forEach((lx, i) => {
    const s = i % 2 ? step : -step;
    switch (p.legs) {
      case 'stubby':
        rect(lx + (s > 0 ? 1 : 0), footY, 2, 3, edge);
        break;
      case 'runner':
        for (let k = 0; k < 6; k++) px(lx + (k < 3 ? 0 : s * (k - 2) * 0.5), footY + k, edge);
        px(lx + s * 2 + 1, footY + 5, edge);
        break;
      case 'climber':
        for (let k = 0; k < 4; k++) px(lx + (k < 2 ? 0 : s), footY + k, edge);
        px(lx + s - 1, footY + 4, PAL.w);
        px(lx + s + 1, footY + 4, PAL.w);
        break;
      default:
        rect(lx + (s > 0 ? 1 : 0), footY, 1, 2, edge);
    }
  });

  // Body.
  for (let y = CY - ry - 1; y <= CY + ry + 1; y++) {
    for (let x = CX - rx - 1; x <= CX + rx + 1; x++) {
      if (!inside(x, y)) continue;
      const rim = !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1);
      px(x, y, rim ? edge : fill);
    }
  }
  // A paler belly.
  for (let x = CX - 4; x <= CX + 4; x++) px(x, CY + 2, edge);

  // Back.
  switch (p.back) {
    case 'spines':
      for (let k = -4; k <= 3; k += 2) {
        px(CX + k, CY - ry - 1, PAL.w);
        px(CX + k, CY - ry - 2, PAL.w);
      }
      break;
    case 'shell':
      for (let y = CY - ry - 3; y <= CY - 1; y++) {
        for (let x = CX - 6; x <= CX + 4; x++) {
          if (((x - CX + 1) / 6) ** 2 + ((y - CY + 1) / 5) ** 2 > 1) continue;
          px(x, y, (x + y) % 3 === 0 ? PAL.S : PAL.Y);
        }
      }
      break;
    case 'sail':
      for (let k = 0; k < 7; k++) for (let h = 0; h < 4 - Math.abs(k - 3) * 0.8 + 2; h++) px(CX - 4 + k, CY - ry - 1 - h, h % 2 ? PAL.o : PAL.p);
      break;
  }

  // Head end (right): mouth and eyes.
  const hx = CX + rx;
  switch (p.mouth) {
    case 'jaws':
      rect(hx, CY + 1, 3, 1, edge);
      px(hx + 1, CY + 2, PAL.w);
      px(hx + 2, CY + 2, PAL.w);
      break;
    case 'beak':
      rect(hx, CY, 2, 2, PAL.y);
      px(hx + 2, CY + 1, PAL.Y);
      break;
    case 'tusks':
      px(hx, CY + 2, PAL.w);
      px(hx + 1, CY + 2, PAL.w);
      px(hx + 2, CY + 1, PAL.w);
      px(hx + 2, CY, PAL.w);
      break;
    default:
      px(hx - 1, CY + 1, PAL.k);
  }
  switch (p.eyes) {
    case 'lensEyes':
      rect(hx - 4, CY - 2, 2, 2, PAL.w);
      px(hx - 3, CY - 2, PAL.k);
      break;
    case 'stalkEyes':
      px(hx - 3, CY - ry - 1, edge);
      px(hx - 3, CY - ry - 2, edge);
      rect(hx - 4, CY - ry - 4, 2, 2, PAL.w);
      px(hx - 3, CY - ry - 4, PAL.k);
      break;
    case 'nightEyes':
      rect(hx - 5, CY - 3, 3, 3, PAL.y);
      px(hx - 4, CY - 2, PAL.k);
      break;
    default:
      px(hx - 3, CY - 1, PAL.k);
  }
  return c;
}

/**
 * Draws the creature with its feet on `groundY`, centred on x. `scale` (1 or more,
 * whole numbers) draws it bigger for portraits; `frame` steps the legs.
 */
export function drawCreature(b: CanvasRenderingContext2D, look: CreatureLook, x: number, groundY: number, opts: { left?: boolean; frame?: number; scale?: number } = {}): void {
  const frame = opts.frame ?? 0;
  const key = `${look.diet}|${Object.values(look.parts).join('.')}|${frame}`;
  let c = cache.get(key);
  if (!c) {
    if (cache.size > 200) cache.clear();
    c = bake(look, frame);
    cache.set(key, c);
  }
  const s = opts.scale ?? 1;
  // Feet sit at the bottom of the legs: the body centre is CY, legs reach about CY + 10.
  const top = groundY - (CY + 10) * s;
  b.save();
  b.imageSmoothingEnabled = false;
  if (opts.left) {
    b.translate(Math.round(x + (W / 2) * s), Math.round(top));
    b.scale(-s, s);
  } else {
    b.translate(Math.round(x - (W / 2) * s), Math.round(top));
    b.scale(s, s);
  }
  b.drawImage(c, 0, 0);
  b.restore();
}

/** An <img> portrait of a look, for the interface. */
export function creatureIcon(look: CreatureLook, scale = 3): string {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  drawCreature(c.getContext('2d')!, look, W / 2, H - 1);
  return `<img class="px-icon" src="${c.toDataURL()}" width="${W * scale}" height="${H * scale}" alt="" draggable="false">`;
}

/**
 * Your creature at herd size: a 14x10 sprite built from the same parts as its portrait
 * (legs, tail, eyes, mouth, back), so you and your herd are plainly the same animal at
 * any zoom. Facing right; drawn bottom-centre at (x, groundY), at a whole-number scale.
 */
const MW = 14;
const MH = 11;
const miniCache = new Map<string, HTMLCanvasElement>();

function bakeMini(look: CreatureLook, frame: number, sleeping: boolean): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = MW;
  c.height = MH;
  const b = c.getContext('2d')!;
  const [fill, edge] = DIET_COLORS[look.diet] ?? DIET_COLORS.none;
  const dark = mix(fill, '#10141f', 0.45);
  const px = (x: number, y: number, col: string) => {
    b.fillStyle = col;
    b.fillRect(x, y, 1, 1);
  };
  const p = look.parts;
  // The body's top row is `by`; it's four rows deep, with legs below and the shadow last.
  const lift = sleeping ? 1 : 0;
  const by = 3 + lift;
  // Back first (behind the body's top edge).
  if (p.back === 'shell') {
    for (let x = 4; x <= 9; x++) px(x, by - 1, x % 2 ? '#8a6a3a' : '#b08850');
    for (let x = 5; x <= 8; x++) px(x, by - 2, '#b08850');
  }
  if (p.back === 'spines') for (const x of [4, 6, 8]) px(x, by - 1, PAL.w);
  if (p.back === 'sail') for (let x = 5; x <= 8; x++) for (let y = by - 3 + Math.abs(x - 6.5) * 0.7; y < by; y++) px(x, Math.round(y), x === 6 || x === 7 ? PAL.p : PAL.P);
  // Body: an oval, light on top, dark underneath.
  const rows: [number, number, string][] = [
    [4, 9, edge],
    [3, 10, fill],
    [3, 10, fill],
    [4, 9, dark],
  ];
  rows.forEach(([x0, x1, col], j) => {
    for (let x = x0; x <= x1; x++) px(x, by + j, col);
  });
  px(3, by + 1, edge);
  // Head, at the front.
  px(11, by + 1, fill);
  px(11, by + 2, fill);
  px(12, by + 1, fill);
  px(12, by + 2, dark);
  px(11, by, edge);
  // Eyes.
  if (!sleeping) {
    if (p.eyes === 'stalkEyes') {
      px(11, by - 1, edge);
      px(11, by - 2, PAL.k);
    } else if (p.eyes === 'nightEyes') {
      px(11, by + 1, PAL.y);
      px(12, by + 1, PAL.k);
    } else if (p.eyes === 'lensEyes') {
      px(11, by + 1, PAL.w);
      px(12, by + 1, PAL.k);
    } else px(12, by + 1, PAL.k);
  } else px(12, by + 1, dark);
  // Mouth.
  if (p.mouth === 'jaws') px(13, by + 2, PAL.w);
  else if (p.mouth === 'beak') px(13, by + 2, PAL.o);
  else if (p.mouth === 'tusks') {
    px(13, by + 2, PAL.w);
    px(13, by + 1, PAL.w);
  }
  // Tail, at the back.
  if (p.tail === 'finTail') {
    px(2, by + 1, edge);
    px(1, by, edge);
    px(1, by + 2, edge);
  } else if (p.tail === 'clubTail') {
    px(2, by + 1, edge);
    px(1, by + 1, PAL.r);
    px(0, by + 1, PAL.r);
    px(1, by + 2, PAL.R);
  } else if (p.tail === 'crestTail') {
    px(2, by + 1, edge);
    px(1, by, PAL.p);
    px(1, by - 1, PAL.y);
    px(0, by, PAL.o);
  } else px(2, by + 2, edge);
  // Legs, stepping between frames.
  if (!sleeping) {
    const step = frame ? 1 : 0;
    const long = p.legs === 'runner' || p.legs === 'climber' ? 2 : 1;
    for (const lx of [5 - step, 9 + step]) {
      for (let k = 0; k < long; k++) px(lx, by + 4 + k, p.legs === 'stubby' ? dark : PAL.k);
      if (p.legs === 'climber') px(lx + 1, by + 4 + long - 1, PAL.w);
      if (p.legs === 'stubby') px(lx + 1, by + 4, dark);
    }
  }
  return c;
}

export function drawMini(
  b: CanvasRenderingContext2D,
  look: CreatureLook,
  x: number,
  groundY: number,
  opts: { left?: boolean; frame?: number; sleeping?: boolean; scale?: number } = {},
): void {
  const k = Math.max(1, Math.round(opts.scale ?? 1));
  const key = `${look.diet}|${Object.values(look.parts).join('.')}|${opts.frame ? 1 : 0}|${opts.sleeping ? 1 : 0}`;
  let c = miniCache.get(key);
  if (!c) {
    if (miniCache.size > 300) miniCache.clear();
    c = bakeMini(look, opts.frame ?? 0, !!opts.sleeping);
    miniCache.set(key, c);
  }
  const X = Math.round(x) - (MW / 2) * k;
  const Y = Math.round(groundY) - (MH - 1) * k;
  b.fillStyle = 'rgba(16,20,31,0.25)';
  b.fillRect(X + 2 * k, Y + (MH - 2) * k, (MW - 4) * k, k);
  b.save();
  b.imageSmoothingEnabled = false;
  if (opts.left) {
    b.translate(X + MW * k, Y);
    b.scale(-k, k);
  } else {
    b.translate(X, Y);
    b.scale(k, k);
  }
  b.drawImage(c, 0, 0);
  b.restore();
}

function mix(a: string, b: string, t: number): string {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('');
}
