// The crossing: forty days and forty nights adrift. A pixel seascape full screen: the raft with
// the four on it, riding the swell; day and night going over faster and faster (the sun across
// the sky, then the dark and the stars, forty times); a count of the days; and on the fortieth,
// a bird coming down onto the raft with something green in its beak. No sail, no oar: it goes
// where the sea takes it.

import { storyLine } from './strike';

const DAYS = 40;
/** Seconds the forty days take (they speed up), the bird after, and the whole. */
const SPAN = 13;
const BIRD = SPAN + 0.5;
const END = SPAN + 5;

export function playCrossing(look: { body: string; belly: string }, onDone: () => void): void {
  const cv = document.createElement('canvas');
  cv.id = 'strike';
  const W = Math.ceil(window.innerWidth / 3);
  const H = Math.ceil(window.innerHeight / 3);
  cv.width = W;
  cv.height = H;
  document.body.append(cv);
  const b = cv.getContext('2d')!;
  const start = performance.now();
  const stars = Array.from({ length: 60 }, () => ({ x: Math.random() * W, y: Math.random() * H * 0.55 }));
  const horizon = Math.round(H * 0.5);
  let lastDay = -1;

  /** How far through the forty days, by time: slow at first, then racing, then slowing to the
   * last morning. */
  const dayAt = (t: number) => {
    const k = Math.min(1, t / SPAN);
    const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
    return e * DAYS;
  };

  const frame = (now: number) => {
    const t = (now - start) / 1000;
    const days = dayAt(t);
    const phase = days % 1; // 0 dawn, 0.5 dusk-ish
    const sunUp = Math.sin(phase * Math.PI * 2 - Math.PI / 2) * -1; // 1 at noon, -1 at midnight
    const light = Math.max(0, Math.min(1, 0.5 + sunUp * 0.7));
    // Sky: dark to blue to dawn-warm.
    const sky = (k: number) => Math.round(k);
    const top = [sky(10 + 60 * light), sky(14 + 110 * light), sky(30 + 170 * light)];
    const low = [sky(20 + 200 * light * (phase < 0.15 || phase > 0.85 ? 1.1 : 0.8)), sky(20 + 150 * light), sky(40 + 120 * light)];
    for (let y = 0; y < horizon; y++) {
      const k = y / horizon;
      b.fillStyle = `rgb(${Math.round(top[0] + (low[0] - top[0]) * k)}, ${Math.round(top[1] + (low[1] - top[1]) * k)}, ${Math.round(top[2] + (low[2] - top[2]) * k)})`;
      b.fillRect(0, y, W, 1);
    }
    // Stars by night.
    if (light < 0.4) {
      b.fillStyle = `rgba(242, 234, 215, ${(0.4 - light) * 2})`;
      for (const s of stars) b.fillRect(Math.round(s.x), Math.round(s.y), 1, 1);
    }
    // The sun (by day) or the moon (by night), arcing over.
    const arc = (phase < 0.5 ? phase / 0.5 : (phase - 0.5) / 0.5);
    const ax = W * (0.1 + arc * 0.8);
    const ay = horizon - Math.sin(arc * Math.PI) * horizon * 0.8;
    if (phase < 0.5) {
      const g = b.createRadialGradient(ax, ay, 0, ax, ay, 18);
      g.addColorStop(0, 'rgba(255, 240, 200, 0.9)');
      g.addColorStop(1, 'rgba(255, 200, 120, 0)');
      b.fillStyle = g;
      b.fillRect(ax - 18, ay - 18, 36, 36);
      b.fillStyle = '#fff4d0';
      b.fillRect(Math.round(ax) - 2, Math.round(ay) - 2, 5, 5);
    } else {
      // A crescent: a disc, with the sky's own colour bitten out of it.
      const mx = Math.round(ax);
      const my = Math.round(ay);
      b.fillStyle = '#e8e4d8';
      b.fillRect(mx - 1, my - 3, 3, 7);
      b.fillRect(mx - 3, my - 1, 7, 3);
      b.fillRect(mx - 2, my - 2, 5, 5);
      const k = Math.max(0, Math.min(1, my / horizon));
      b.fillStyle = `rgb(${top.map((c, i) => Math.round(c + (low[i] - c) * k)).join(',')})`;
      b.fillRect(mx, my - 2, 3, 5);
      b.fillRect(mx + 1, my - 3, 2, 7);
    }
    // The sea: bands of swell, glinting under the sun.
    for (let y = horizon; y < H; y++) {
      const k = (y - horizon) / (H - horizon);
      const shade = 0.35 + light * 0.65;
      b.fillStyle = `rgb(${Math.round((20 + 30 * k) * shade)}, ${Math.round((50 + 60 * k) * shade)}, ${Math.round((90 + 50 * k) * shade)})`;
      b.fillRect(0, y, W, 1);
      if ((y + Math.floor(t * 6)) % 5 === 0) {
        b.fillStyle = `rgba(200, 225, 240, ${0.15 + light * 0.25})`;
        for (let x = (y * 37 + Math.floor(t * 20)) % 23; x < W; x += 23) b.fillRect(x, y, 3 + (y % 3), 1);
      }
    }
    // The raft riding the swell, the four on it.
    const rx = Math.round(W * 0.5 + Math.sin(t * 0.4) * 4);
    // Above the story line (which sits low on the screen).
    const ry = Math.round(horizon + (H - horizon) * 0.14 + Math.sin(t * 2.2) * 2);
    const tilt = Math.sin(t * 1.7) * 1.2;
    b.fillStyle = '#6a4a30';
    for (let k = 0; k < 3; k++) b.fillRect(rx - 12, ry + k, 24, 1);
    b.fillStyle = '#c8b080';
    b.fillRect(rx - 9, ry, 1, 3);
    b.fillRect(rx + 8, ry, 1, 3);
    for (let i = 0; i < 4; i++) {
      const x = rx - 9 + i * 6;
      const y = ry - 3 + Math.round(tilt * (i - 1.5) * 0.3);
      b.fillStyle = look.body;
      b.fillRect(x, y, 4, 3);
      b.fillStyle = look.belly;
      b.fillRect(x, y + 2, 4, 1);
      b.fillStyle = '#10141f';
      b.fillRect(x + (i % 2 ? 0 : 3), y, 1, 1);
    }
    // The bird, on the last morning: it comes down onto the raft with green in its beak.
    if (t > BIRD) {
      const k = Math.min(1, (t - BIRD) / 2.5);
      const bx = Math.round(W * 0.95 - (W * 0.95 - rx) * k);
      const by = Math.round(H * 0.15 + (ry - 6 - H * 0.15) * k);
      const flap = k < 1 ? Math.floor(t * 8) % 2 : 0;
      b.fillStyle = '#f2ead7';
      b.fillRect(bx - 2, by - flap, 2, 1);
      b.fillRect(bx + 1, by - flap, 2, 1);
      b.fillRect(bx, by, 2, 2);
      b.fillStyle = '#5fbf78';
      b.fillRect(bx - 1, by + 1, 1, 1);
    }
    // The count of days.
    const d = Math.min(DAYS, Math.floor(days) + 1);
    if (d !== lastDay && t < SPAN + 0.3) {
      lastDay = d;
      storyLine(d === 1 ? 'The first day, the island behind them going small.' : d >= DAYS ? 'The fortieth day.' : `Day ${d}`);
    }
    if (t > BIRD + 1.5 && t < END - 0.5) storyLine('On the fortieth day, a bird came down onto the raft with something green in its beak.');
    if (t > END - 1) cv.style.opacity = String(Math.max(0, END - t));
    if (t < END) requestAnimationFrame(frame);
    else {
      cv.remove();
      storyLine('');
      onDone();
    }
  };
  requestAnimationFrame(frame);
}
