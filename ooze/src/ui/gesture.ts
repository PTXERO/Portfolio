// Reading a drawn shape: the strokes miracles are cast with. A stroke is read as a line, a
// zigzag, a circle or a spiral, from how straight it runs, how sharply it turns, and how far
// round it winds. Forgiving: a wobbly line is still a line, and a loose circle still a circle.

import type { Gesture } from '../economy/miracles';

export interface P {
  x: number;
  y: number;
}

/** Evens out a stroke into points a fixed distance apart (so speed doesn't matter). */
function resample(pts: P[], step: number): P[] {
  const out: P[] = [pts[0]];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    let a = pts[i - 1];
    const b = pts[i];
    let d = Math.hypot(b.x - a.x, b.y - a.y);
    while (carry + d >= step) {
      const k = (step - carry) / d;
      const q = { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
      out.push(q);
      a = q;
      d = Math.hypot(b.x - a.x, b.y - a.y);
      carry = 0;
    }
    carry += d;
  }
  return out;
}

export function readGesture(pts: P[]): Gesture | null {
  if (pts.length < 4) return null;
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const size = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  if (size < 24) return null;
  const r = resample(pts, Math.max(6, size / 18));
  if (r.length < 4) return null;
  let length = 0;
  for (let i = 1; i < r.length; i++) length += Math.hypot(r[i].x - r[i - 1].x, r[i].y - r[i - 1].y);
  const ends = Math.hypot(r[r.length - 1].x - r[0].x, r[r.length - 1].y - r[0].y);
  // Turning: added up (signed: how far it winds round), and the sharp corners.
  let turn = 0;
  let sharp = 0;
  let inCorner = false;
  for (let i = 2; i < r.length; i++) {
    const a1 = Math.atan2(r[i - 1].y - r[i - 2].y, r[i - 1].x - r[i - 2].x);
    const a2 = Math.atan2(r[i].y - r[i - 1].y, r[i].x - r[i - 1].x);
    let d = a2 - a1;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    turn += d;
  }
  // Corners: sharp turns measured over a couple of steps either side (a corner drawn quickly
  // can fall between two samples), each counted once.
  for (let i = 2; i < r.length - 2; i++) {
    const a1 = Math.atan2(r[i].y - r[i - 2].y, r[i].x - r[i - 2].x);
    const a2 = Math.atan2(r[i + 2].y - r[i].y, r[i + 2].x - r[i].x);
    let d = a2 - a1;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    const corner = Math.abs(d) > (60 * Math.PI) / 180;
    if (corner && !inCorner) sharp++;
    inCorner = corner;
  }
  // (A zigzag first: one drawn tall and narrow runs nearly straight end to end.)
  if (sharp >= 2 && ends / length > 0.45) return 'zigzag';
  if (ends / length > 0.8) return 'line';
  if (Math.abs(turn) > Math.PI * 3.4) return 'spiral';
  if (ends < size * 0.35 && Math.abs(turn) > Math.PI * 1.4) return 'circle';
  if (sharp >= 2) return 'zigzag';
  return null;
}
