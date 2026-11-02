// An island's coast, shrunk to a little grid (for the world map): land 1, sea 0, packed as hex.

import { isLand, type Island } from './island';

/** Cells across an island's coast grid. */
export const MASK = 40;

export function packCoast(cells: boolean[]): string {
  let out = '';
  for (let i = 0; i < cells.length; i += 4) {
    let v = 0;
    for (let k = 0; k < 4; k++) if (cells[i + k]) v |= 1 << k;
    out += v.toString(16);
  }
  return out;
}

export function coastAt(mask: string, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= MASK || y >= MASK) return false;
  const i = y * MASK + x;
  return ((parseInt(mask[i >> 2], 16) >> (i & 3)) & 1) === 1;
}

/** An island's coast from its own land. */
export function coastOfIsland(is: Island): string {
  const cells: boolean[] = [];
  const k = is.n / MASK;
  for (let y = 0; y < MASK; y++) for (let x = 0; x < MASK; x++) cells.push(isLand(is, (x + 0.5) * k, (y + 0.5) * k));
  return packCoast(cells);
}
