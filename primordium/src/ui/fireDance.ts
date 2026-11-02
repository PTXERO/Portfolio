// The fire circle: dancing with a village round their fire. Draw circles round the fire, the way
// the Soup's whirlpool was spun: the faster and rounder, the higher the flames, and the more of
// them get up and join the ring, spinning round with you. Each clan dances its own way (their
// pace, and which way round); dance it their way and it counts for twice as much.

import type { CreatureLook } from '../scene/creatureLook';
import type { Habitat, Village } from '../economy/shore';
import { personal } from '../economy/genes';
import { drawMini } from '../scene/creatureLook';

export interface DanceStyle {
  /** How they dance, in a word: sway, stamp, leap. */
  kind: 'sway' | 'stamp' | 'leap';
  /** Turns a second they dance at (from, to). */
  pace: [number, number];
  /** Which way round: 1 sunwise (clockwise), -1 against the sun, 0 either. */
  dir: 1 | -1 | 0;
  /** Said to the player: how they dance. */
  line: string;
}

const SWAY: DanceStyle = { kind: 'sway', pace: [0.35, 1.1], dir: 1, line: 'They sway: slow, steady circles, sunwise (clockwise).' };
const STAMP: DanceStyle = { kind: 'stamp', pace: [0.8, 1.7], dir: -1, line: 'They stamp: a brisk round, against the sun (anticlockwise).' };
const LEAP: DanceStyle = { kind: 'leap', pace: [1.5, 4], dir: 0, line: 'They leap: fast, wild circles, either way round.' };

export function danceStyle(h?: Habitat): DanceStyle {
  if (h === 'river' || h === 'lake' || h === 'coast' || h === 'marsh') return SWAY;
  if (h === 'forest' || h === 'mountain') return LEAP;
  return STAMP;
}

export interface FireDance {
  stop(): void;
}

/** A turn danced: whether it was their way, how round it was (0.3 to 1), the streak of their-way
 * turns. Returns what it won (0 once they're worn out). */
type OnTurn = (theirWay: boolean, round: number, streak: number, at: { x: number; y: number }) => number | string;

/** Pixels of the drawing: the canvas is this, scaled up to fit. */
const PW = 160;
const PH = 100;

export function startFireDance(canvas: HTMLCanvasElement, v: Village, chief: CreatureLook, onTurn: OnTurn, hint: (text: string) => void): FireDance {
  canvas.width = PW;
  canvas.height = PH;
  const b = canvas.getContext('2d')!;
  b.imageSmoothingEnabled = false;
  const style = danceStyle(v.habitat);
  const cx = PW / 2;
  const cy = PH / 2 + 8;
  // (Each of theirs in their own coat.)
  const theirs: CreatureLook[] = [];
  for (let i = 0; i < Math.min(14, Math.max(3, Math.round(v.pop))); i++) theirs.push({ ...v.look, genes: personal(v.look.genes, v.id * 101 + i) });

  // The dance's state: how hot the fire is, the ring's turn, and the circle being drawn.
  let heat = 0;
  let ring = 0;
  let spinRate = 0;
  let streak = 0;
  let last: number | null = null;
  let turn = 0;
  let turnStart = performance.now();
  let radii: number[] = [];
  let lastMove = 0;
  let down = false;
  let raf = 0;
  let prev = performance.now();
  let frameAt = performance.now();
  const sparks: { x: number; y: number; vy: number; life: number }[] = [];

  const at = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * PW, y: ((e.clientY - r.top) / r.height) * PH, sx: e.clientX, sy: e.clientY };
  };
  const onDown = (e: PointerEvent) => {
    down = true;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // (Not a pointer the browser knows: fine, it's followed anyway.)
    }
    last = null;
    turn = 0;
    radii = [];
    turnStart = performance.now();
    move(e);
  };
  const onUp = () => {
    down = false;
    last = null;
  };
  const move = (e: PointerEvent) => {
    if (!down) return;
    const p = at(e);
    const a = Math.atan2(p.y - cy, p.x - cx);
    const r = Math.hypot(p.x - cx, (p.y - cy) * 1.6);
    if (r < 6) return;
    const now = performance.now();
    lastMove = now;
    if (last !== null) {
      let d = a - last;
      if (d > Math.PI) d -= Math.PI * 2;
      if (d < -Math.PI) d += Math.PI * 2;
      // (Turned back on yourself: a new circle.)
      if (turn !== 0 && Math.sign(d) !== Math.sign(turn) && Math.abs(d) > 0.05) {
        turn = 0;
        radii = [];
        turnStart = now;
        streak = 0;
      }
      turn += d;
      radii.push(r);
      ring += d * 0.9;
      spinRate = spinRate * 0.8 + (d / Math.max(0.008, (now - prev) / 1000)) * 0.2;
      if (Math.abs(turn) >= Math.PI * 2) {
        // A full circle: how fast, how round, which way.
        const secs = Math.max(0.05, (now - turnStart) / 1000);
        const pace = 1 / secs;
        const dir = Math.sign(turn);
        const mean = radii.reduce((x, y) => x + y, 0) / radii.length;
        const cv = Math.sqrt(radii.reduce((x, y) => x + (y - mean) ** 2, 0) / radii.length) / Math.max(1, mean);
        const round = Math.max(0.3, Math.min(1, 1.15 - cv * 2));
        const theirWay = pace >= style.pace[0] && pace <= style.pace[1] && (style.dir === 0 || dir === style.dir);
        streak = theirWay ? streak + 1 : 0;
        heat = Math.min(1, heat + (theirWay ? 0.16 : 0.07) * round);
        const got = onTurn(theirWay, round, streak, { x: p.sx, y: p.sy });
        for (let i = 0; i < (theirWay ? 10 : 4); i++) sparks.push({ x: cx + (Math.random() - 0.5) * 8, y: cy - 6, vy: 20 + Math.random() * 30, life: 1 });
        hint(typeof got === 'string' ? got : theirWay ? (streak >= 3 ? 'Their way, and they love it!' : 'Their way!') : pace < style.pace[0] ? 'Too slow for them.' : pace > style.pace[1] ? 'Too fast for them.' : style.dir === 1 ? 'The other way round: sunwise.' : 'The other way round: against the sun.');
        turn = 0;
        radii = [];
        turnStart = now;
      }
    }
    last = a;
    prev = now;
  };
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);

  const draw = (now: number) => {
    // (Gone from the screen: the dance is over.)
    if (!canvas.isConnected || canvas.closest('[hidden]')) {
      api.stop();
      return;
    }
    const dt = Math.min(0.1, Math.max(0.001, (now - frameAt) / 1000));
    frameAt = now;
    const idle = now - lastMove > 250;
    if (idle) {
      heat = Math.max(0, heat - dt * 0.08);
      spinRate *= Math.pow(0.1, dt);
      // (Left to themselves the ring keeps going round a while, slowing.)
      ring += spinRate * dt * 0.3;
    }
    const t = now / 1000;
    // Night, the ground lit by the fire.
    b.fillStyle = '#141826';
    b.fillRect(0, 0, PW, PH);
    const glow = 18 + heat * 34;
    const g = b.createRadialGradient(cx, cy, 2, cx, cy, glow * 1.6);
    g.addColorStop(0, `rgba(232, 150, 60, ${0.35 + heat * 0.3})`);
    g.addColorStop(1, 'rgba(232, 150, 60, 0)');
    b.fillStyle = g;
    b.fillRect(0, 0, PW, PH);
    b.fillStyle = 'rgba(80, 64, 44, 0.6)';
    b.beginPath();
    b.ellipse(cx, cy, 52, 32, 0, 0, Math.PI * 2);
    b.fill();

    // The ring: the chief, and as many of theirs as are up dancing (more, the hotter it gets).
    const up = Math.max(1, Math.ceil(heat * theirs.length + 0.01));
    const dancers = [chief, ...theirs.slice(0, up)];
    const placed = dancers.map((look, i) => {
      const a = ring + (i / dancers.length) * Math.PI * 2;
      const ph = i * 1.7;
      let x = cx + Math.cos(a) * 44;
      const y = cy + Math.sin(a) * 26;
      let hop = 0;
      const moving = Math.abs(spinRate) > 0.5 || !idle;
      if (moving) {
        if (style.kind === 'sway') x += Math.sin(t * 3 + ph) * 2;
        else if (style.kind === 'stamp') hop = Math.abs(Math.sin(t * 9 + ph)) > 0.7 ? 2 : 0;
        else hop = Math.abs(Math.sin(t * 6 + ph)) * 6;
      }
      // (And now and then one spins on the spot: silly, and they love it.)
      const twirl = moving && Math.sin(t * 2.3 + ph * 3) > 0.85;
      const left = twirl ? Math.floor(t * 12) % 2 === 0 : Math.cos(a + (spinRate >= 0 ? Math.PI / 2 : -Math.PI / 2)) < 0;
      return { look, x, y, hop, left, frame: moving ? Math.floor(t * 8 + ph) % 2 : 0 };
    });
    // Behind the fire first, then the fire, then in front of it.
    const behind = placed.filter((p) => p.y < cy).sort((a, c) => a.y - c.y);
    const front = placed.filter((p) => p.y >= cy).sort((a, c) => a.y - c.y);
    for (const p of behind) drawMini(b, p.look, p.x, p.y, { left: p.left, frame: p.frame, hop: p.hop });
    // The fire: logs, and flames as high as the dance is hot.
    b.fillStyle = '#5a3a22';
    b.fillRect(cx - 7, cy - 1, 14, 3);
    b.fillRect(cx - 5, cy - 3, 10, 2);
    const tall = 6 + heat * 26;
    for (let i = 0; i < 9; i++) {
      const fx = cx - 6 + i * 1.5;
      const h = tall * (0.5 + 0.5 * Math.abs(Math.sin(t * (7 + i) + i * 2))) * (1 - Math.abs(i - 4) / 6);
      b.fillStyle = i % 3 === 0 ? '#f2d060' : i % 3 === 1 ? '#e88a30' : '#d0502a';
      b.fillRect(Math.round(fx), Math.round(cy - 2 - h), 2, Math.round(h));
    }
    for (const sp of sparks) {
      sp.y -= sp.vy * dt;
      sp.x += Math.sin(t * 5 + sp.vy) * 0.3;
      sp.life -= dt * 0.9;
      b.fillStyle = `rgba(255, 210, 120, ${Math.max(0, sp.life)})`;
      b.fillRect(Math.round(sp.x), Math.round(sp.y), 1, 1);
    }
    for (let i = sparks.length - 1; i >= 0; i--) if (sparks[i].life <= 0) sparks.splice(i, 1);
    for (const p of front) drawMini(b, p.look, p.x, p.y, { left: p.left, frame: p.frame, hop: p.hop });
    raf = requestAnimationFrame(draw);
  };
  const api: FireDance = {
    stop() {
      cancelAnimationFrame(raf);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
    },
  };
  raf = requestAnimationFrame(draw);
  return api;
}
