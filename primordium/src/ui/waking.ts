// The waking: the cutscene when the spear is touched. Inside its mind: dark, then one point
// of light where the spear touched it, a web of light branching out from it (thought, for the
// first time), pulses racing along it; things it has seen all its life showing in the web as
// if for the first time (the sun, the stars, fire, a stone, its own kind); and an eye opening,
// the spear's red in it. Then back to the world. The story keeps the screen throughout.

import { STORY } from '../content/tribal';
import { storyLine } from './strike';

/** Seconds into the cutscene that each beat happens. */
const DARK = 1.2;
const WEB_AT = 1.4;
const VISIONS_AT = 5.2;
const EYE_AT = 10.4;
const END = 15;

interface Node {
  x: number;
  y: number;
  /** The node it grew from (-1 for the first), and when it lit (seconds). */
  from: number;
  at: number;
}

/** Little pictures, as rows of pixels ('#' lit, '+' bright). */
const VISIONS: { name: string; rows: string[] }[] = [
  { name: 'sun', rows: ['  # # #  ', '#  ###  #', '  #####  ', ' ##+++## ', '  #####  ', '#  ###  #', '  # # #  '] },
  { name: 'stars', rows: ['#     +  ', '    #    ', ' +      #', '   #  #  ', '#      + ', '  +  #   '] },
  { name: 'fire', rows: ['   #   ', '  ##   ', '  ###  ', ' ##+## ', ' #+++# ', '##+++##', ' ##### '] },
  { name: 'stone', rows: ['   ##  ', '  ####  ', ' ##+### ', ' ###### ', '  ####  ', '   ##   '] },
  { name: 'kin', rows: [' #   #   # ', '###.###.###', ' #   #   # ', '# # # # # #'] },
];

export function playWaking(onDone: () => void): void {
  const cv = document.createElement('canvas');
  cv.id = 'strike';
  const W = Math.ceil(window.innerWidth / 3);
  const H = Math.ceil(window.innerHeight / 3);
  cv.width = W;
  cv.height = H;
  document.body.append(cv);
  const b = cv.getContext('2d')!;
  const cx = W / 2;
  const cy = H * 0.42;
  const start = performance.now();

  // The web: each node grows out of an earlier one, further out as time goes on.
  const nodes: Node[] = [{ x: cx, y: cy, from: -1, at: WEB_AT }];
  for (let i = 1; i < 120; i++) {
    const p = nodes[Math.floor(Math.random() * nodes.length)];
    // Branching outward (away from where it started), spreading the web wide.
    const out = p.from < 0 ? Math.random() * Math.PI * 2 : Math.atan2(p.y - cy, p.x - cx);
    const a = out + (Math.random() - 0.5) * 1.9;
    const l = 10 + Math.random() * 18;
    const x = p.x + Math.cos(a) * l;
    const y = p.y + Math.sin(a) * l * 0.85;
    if (x < -10 || x > W + 10 || y < -10 || y > H + 10) continue;
    nodes.push({ x, y, from: nodes.indexOf(p), at: p.at + 0.12 + Math.random() * 0.35 });
  }
  // Where the visions show: spread round the middle, one after another.
  const spots = VISIONS.map((v, i) => {
    const a = -Math.PI / 2 + (i / VISIONS.length) * Math.PI * 2;
    return { v, x: cx + Math.cos(a) * W * 0.3, y: cy + Math.sin(a) * H * 0.2, at: VISIONS_AT + i * 0.9 };
  });
  const pulses: { n: number; k: number }[] = [];

  const glow = (x: number, y: number, r: number, col: string, a: number) => {
    const g = b.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, col.replace('A', String(a)));
    g.addColorStop(1, col.replace('A', '0'));
    b.fillStyle = g;
    b.fillRect(x - r, y - r, r * 2, r * 2);
  };
  /** From the spear's red-purple, through gold, to white, as the mind fills. */
  const hue = (k: number) => {
    const c = k < 0.5 ? [200 + 110 * k, 60 + 260 * k, 140 - 120 * k] : [255, 190 + 130 * (k - 0.5), 80 + 340 * (k - 0.5)];
    return c.map((v) => Math.round(Math.min(255, v)));
  };

  let last = start;
  const frame = (now: number) => {
    const t = (now - start) / 1000;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    b.clearRect(0, 0, W, H);
    const fill = Math.min(1, Math.max(0, (t - WEB_AT) / (EYE_AT - WEB_AT)));
    const [r, g, bl] = hue(fill);

    // The dark of a mind that has never thought.
    const dark = Math.min(1, t / DARK) * (t > END - 1.6 ? Math.max(0, (END - t) / 1.6) : 1);
    b.fillStyle = `rgba(8, 4, 14, ${0.96 * dark})`;
    b.fillRect(0, 0, W, H);

    // The first light, where the spear touched it, beating like a heart.
    if (t > DARK * 0.6) {
      const beat = 0.6 + 0.4 * Math.abs(Math.sin(t * 2.4));
      glow(cx, cy, 10 + 26 * fill, `rgba(${r}, ${g}, ${bl}, A)`, 0.7 * beat * dark);
      b.fillStyle = '#fff6f0';
      b.fillRect(Math.round(cx) - 1, Math.round(cy) - 1, 2, 2);
    }

    // The web, branching out: each strand drawn from its root as it lights.
    for (let i = 1; i < nodes.length; i++) {
      const n = nodes[i];
      if (t < n.at) continue;
      const p = nodes[n.from];
      const k = Math.min(1, (t - n.at) / 0.35);
      const x = p.x + (n.x - p.x) * k;
      const y = p.y + (n.y - p.y) * k;
      const steps = Math.ceil(Math.max(Math.abs(x - p.x), Math.abs(y - p.y)));
      b.fillStyle = `rgba(${r}, ${g}, ${bl}, ${0.55 * dark})`;
      for (let j = 0; j <= steps; j++) b.fillRect(Math.round(p.x + ((x - p.x) * j) / steps), Math.round(p.y + ((y - p.y) * j) / steps), 1, 1);
      if (k >= 1) {
        b.fillStyle = `rgba(255, 240, 220, ${0.9 * dark})`;
        b.fillRect(Math.round(n.x), Math.round(n.y), 1, 1);
      }
      // Thoughts racing out along it.
      if (k >= 1 && Math.random() < dt * 0.8 * (0.3 + fill)) pulses.push({ n: i, k: 0 });
    }
    for (const q of pulses) {
      q.k += dt * 3;
      const n = nodes[q.n];
      const p = nodes[n.from];
      const x = p.x + (n.x - p.x) * q.k;
      const y = p.y + (n.y - p.y) * q.k;
      glow(x, y, 4, 'rgba(255, 250, 230, A)', 0.8 * dark);
    }
    for (let i = pulses.length - 1; i >= 0; i--) if (pulses[i].k >= 1) pulses.splice(i, 1);

    // The visions: what it has always seen, seen now as things. Each flares, then dims.
    for (const s of spots) {
      if (t < s.at || t > EYE_AT + 1) continue;
      const age = t - s.at;
      const a = Math.min(1, age / 0.4) * Math.max(0.25, 1 - Math.max(0, age - 1.4) / 2) * dark;
      const rows = s.v.rows;
      const px = 2;
      const x0 = Math.round(s.x - (rows[0].length * px) / 2);
      const y0 = Math.round(s.y - (rows.length * px) / 2);
      glow(s.x, s.y, 16, `rgba(${r}, ${g}, ${bl}, A)`, 0.35 * a);
      rows.forEach((row, ry) => {
        for (let rx = 0; rx < row.length; rx++) {
          const c = row[rx];
          if (c === ' ' || c === '.') continue;
          b.fillStyle = c === '+' ? `rgba(255, 250, 235, ${a})` : `rgba(${r}, ${g}, ${bl}, ${a})`;
          b.fillRect(x0 + rx * px, y0 + ry * px, px, px);
        }
      });
    }

    // The eye opening, the spear's red in it: it sees.
    if (t > EYE_AT) {
      const open = Math.min(1, (t - EYE_AT) / 1.4);
      const ease = open * open * (3 - 2 * open);
      const ew = Math.min(W * 0.36, 46);
      const eh = ew * 0.42 * ease;
      for (let x = -ew; x <= ew; x++) {
        const h = Math.round(eh * (1 - (x / ew) ** 2));
        if (h <= 0) continue;
        b.fillStyle = `rgba(242, 234, 215, ${dark})`;
        b.fillRect(Math.round(cx + x), Math.round(cy - h), 1, h * 2);
        b.fillStyle = `rgba(20, 10, 18, ${dark})`;
        b.fillRect(Math.round(cx + x), Math.round(cy - h) - 1, 1, 1);
        b.fillRect(Math.round(cx + x), Math.round(cy + h), 1, 1);
      }
      const ir = Math.min(eh, ew * 0.3);
      if (ir > 1) {
        for (let y = -ir; y <= ir; y++) {
          const w = Math.round(Math.sqrt(ir * ir - y * y));
          b.fillStyle = `rgba(160, 30, 70, ${dark})`;
          b.fillRect(Math.round(cx - w), Math.round(cy + y), w * 2, 1);
        }
        const pr = ir * 0.45;
        for (let y = -pr; y <= pr; y++) {
          const w = Math.round(Math.sqrt(pr * pr - y * y));
          b.fillStyle = `rgba(16, 6, 12, ${dark})`;
          b.fillRect(Math.round(cx - w), Math.round(cy + y), w * 2, 1);
        }
        b.fillStyle = `rgba(255, 250, 240, ${dark})`;
        b.fillRect(Math.round(cx - ir * 0.4), Math.round(cy - ir * 0.45), 2, 2);
      }
      // As it opens fully, light floods out of it.
      if (open >= 1) glow(cx, cy, W, 'rgba(255, 246, 236, A)', Math.min(0.9, (t - EYE_AT - 1.4) * 0.6) * dark);
    }

    // The words.
    if (t > WEB_AT + 0.6 && t < VISIONS_AT + 3.4) storyLine(STORY.wake);
    else if (t > VISIONS_AT + 3.8 && t < END - 1.2) storyLine(STORY.mind);
    else storyLine('');

    if (t < END) requestAnimationFrame(frame);
    else {
      cv.remove();
      storyLine('');
      onDone();
    }
  };
  requestAnimationFrame(frame);
}
