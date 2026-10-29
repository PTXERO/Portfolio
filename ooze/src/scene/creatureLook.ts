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
 * A herd member, small enough to see dozens at once: a hand-drawn 9-pixel animal in
 * the line's colours with a hint of its back part, rather than a shrunken portrait.
 * E edge (light), F body, D underside, k ink. Facing right; legs step between frames.
 */
const MINI = ['...EEE...', '..EFFFE.E', '.DFFFFFEF', 'DFFFFFFFk', '.DFFFFFFF', '..DDDDDD.'];
const MINI_LEGS = ['..k..k.k.', '...k..k.k'];
const MINI_SLEEP = ['.........', '...EEE...', '.EFFFFFE.', 'DFFFFFFFE', '.DDDDDDD.', '.........'];

export function drawMini(
  b: CanvasRenderingContext2D,
  look: CreatureLook,
  x: number,
  groundY: number,
  opts: { left?: boolean; frame?: number; sleeping?: boolean; scale?: number } = {},
): void {
  const [fill, edge] = DIET_COLORS[look.diet] ?? DIET_COLORS.none;
  const dark = mix(fill, '#10141f', 0.45);
  const k = Math.max(1, Math.round(opts.scale ?? 1));
  const X = Math.round(x) - 4 * k;
  const Y = Math.round(groundY);
  const put = (dx: number, dy: number, c: string) => {
    b.fillStyle = c;
    b.fillRect(opts.left ? X + (8 - dx) * k : X + dx * k, Y + dy * k, k, k);
  };
  b.fillStyle = 'rgba(16,20,31,0.25)';
  b.fillRect(X, Y, 9 * k, k);
  const rows = opts.sleeping ? MINI_SLEEP : MINI;
  const legs = opts.sleeping ? '.........' : MINI_LEGS[opts.frame ? 1 : 0];
  const all = [...rows, legs];
  all.forEach((row, j) => {
    const dy = j - all.length;
    for (let i = 0; i < 9; i++) {
      const ch = row[i];
      if (ch === '.') continue;
      put(i, dy, ch === 'E' ? edge : ch === 'F' ? fill : ch === 'D' ? dark : PAL.k);
    }
  });
  // What it wears on its back shows.
  const top = -all.length;
  const back = look.parts.back;
  if (back === 'shell') for (let i = 2; i < 6; i++) put(i, top, i % 2 ? '#8a6a3a' : '#b08850');
  else if (back === 'spines') for (let i = 2; i < 7; i += 2) put(i, top - 1, PAL.w);
  else if (back === 'sail') for (let i = 3; i < 6; i++) put(i, top - 1, PAL.p);
}

function mix(a: string, b: string, t: number): string {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('');
}
