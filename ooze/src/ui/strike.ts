// The strike: the cutscene between the Creature and the Extinction, played once, and the
// biggest moment in the game so far. Everything but the story drops away. Night falls; a red
// point opens high in the sky and grows; the spear comes down through the air on fire; it
// hits: a blinding flash, the ground heaves, rock and fire are thrown up, a shockwave rolls
// out, and as the white clears the whole world is red and burning, ash coming down over it.
// The era changes behind the flash (`onImpact`); the screen stays the story's (the
// `cinematic` class) until the caller hands it back.

import { STORY } from '../content/tribal';
import { cue } from '../audio/sound';

/** Seconds into the cutscene that each beat happens. */
const UI_OUT = 0.8;
const OMEN = 1.2;
const FALL_AT = 4.2;
const FALL = 1.5;
const HIT = FALL_AT + FALL;
const END = 17;

interface Bit {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  size: number;
  hot: boolean;
}

/** `target` says where on screen (CSS px) the spear comes down: the island's heart. */
export function playStrike(onImpact: () => void, onDone: () => void, target: () => { x: number; y: number }): void {
  const app = document.getElementById('app')!;
  const cv = document.createElement('canvas');
  cv.id = 'strike';
  const W = Math.ceil(window.innerWidth / 3);
  const H = Math.ceil(window.innerHeight / 3);
  cv.width = W;
  cv.height = H;
  const words = storyWords();
  document.body.append(cv);
  document.body.classList.add('cinematic');
  const b = cv.getContext('2d')!;
  const start = performance.now();
  const at = { x: W * 0.52, y: H * 0.55 };
  const from = { x: W * 0.86, y: -H * 0.15 };
  const stars = Array.from({ length: 70 }, () => ({ x: Math.random() * W, y: Math.random() * H * 0.7, p: Math.random() * 6 }));
  // Fires breaking out across the land as the white clears.
  // (Out from the impact, catching as the fire on the ground below reaches them.)
  const fires = Array.from({ length: 70 }, () => {
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() ** 0.7;
    return { a, r, at: 0.6 + r * 7, ph: Math.random() * 9, sz: 1 + Math.floor(Math.random() * 3) };
  });
  const bits: Bit[] = [];
  let changed = false;
  let boomed = false;
  let last = start;
  // The rumble of its coming: it swells to the moment of the strike (HIT seconds in).
  cue('meteor');

  const say = (text: string) => storyLine(text, words);
  const shake = (cls: string) => {
    app.classList.remove('quake', 'quake-hard', 'quake-soft');
    if (cls) app.classList.add(cls);
  };

  const frame = (now: number) => {
    const t = (now - start) / 1000;
    // Aim at the island's heart until it lands (the screen may still be settling).
    if (t < HIT) {
      const p = target();
      at.x = Math.max(W * 0.15, Math.min(W * 0.85, p.x / 3));
      at.y = Math.max(H * 0.2, Math.min(H * 0.8, p.y / 3));
    }
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    b.clearRect(0, 0, W, H);

    // ---- Before the impact: night, an omen in the sky, the fall ----
    if (t < HIT + 0.2) {
      const dark = Math.min(1, t / OMEN);
      b.fillStyle = `rgba(6, 6, 18, ${0.82 * dark})`;
      b.fillRect(0, 0, W, H);
      for (const s of stars) {
        if (Math.sin(t * 2 + s.p) > -0.4) {
          b.fillStyle = `rgba(242, 234, 215, ${0.85 * dark})`;
          b.fillRect(Math.round(s.x), Math.round(s.y), 1, 1);
        }
      }
      // A red point opens in the sky and swells, the sky reddening around it.
      if (t > OMEN && t < FALL_AT) {
        const k = (t - OMEN) / (FALL_AT - OMEN);
        const r = 1 + k * k * 6;
        const g = b.createRadialGradient(from.x, H * 0.06, 0, from.x, H * 0.06, 40 + k * 60);
        g.addColorStop(0, `rgba(255, 70, 90, ${0.35 * k})`);
        g.addColorStop(1, 'rgba(255, 70, 90, 0)');
        b.fillStyle = g;
        b.fillRect(0, 0, W, H);
        b.fillStyle = '#ff5a6e';
        b.fillRect(Math.round(from.x - r / 2), Math.round(H * 0.06 - r / 2), Math.ceil(r), Math.ceil(r));
        b.fillStyle = '#fff2f0';
        b.fillRect(Math.round(from.x), Math.round(H * 0.06), 1, 1);
        if (k > 0.5) shake('quake-soft');
      }
      // The fall: a burning streak, sparks shed behind, the land below lit red.
      if (t >= FALL_AT && t < HIT) {
        const k = (t - FALL_AT) / FALL;
        const e = k * k * k;
        const sx = from.x;
        const sy = H * 0.06;
        const tip = { x: sx + (at.x - sx) * e, y: sy + (at.y - sy) * e };
        const trail = 60;
        for (let i = 0; i < trail; i++) {
          const q = Math.max(0, e - i * 0.009);
          const x = sx + (at.x - sx) * q;
          const y = sy + (at.y - sy) * q;
          const f = 1 - i / trail;
          b.fillStyle = `rgba(255, ${Math.round(60 + 140 * f)}, ${Math.round(60 + 60 * f)}, ${f})`;
          const w = 1 + Math.round(5 * f);
          b.fillRect(Math.round(x) - Math.floor(w / 2), Math.round(y) - 2, w, 4);
        }
        const head = b.createRadialGradient(tip.x, tip.y, 0, tip.x, tip.y, 14 + 10 * k);
        head.addColorStop(0, 'rgba(255, 240, 220, 0.95)');
        head.addColorStop(0.35, 'rgba(255, 110, 90, 0.6)');
        head.addColorStop(1, 'rgba(200, 40, 60, 0)');
        b.fillStyle = head;
        b.fillRect(tip.x - 30, tip.y - 30, 60, 60);
        b.fillStyle = '#ffffff';
        b.fillRect(Math.round(tip.x) - 2, Math.round(tip.y) - 3, 5, 6);
        if (Math.random() < 0.9) bits.push({ x: tip.x, y: tip.y, vx: (Math.random() - 0.5) * 30, vy: -Math.random() * 20, life: 0.6, size: 1, hot: true });
        const glow = b.createRadialGradient(at.x, at.y, 0, at.x, at.y, 20 + 90 * k);
        glow.addColorStop(0, `rgba(255, 120, 90, ${0.55 * k})`);
        glow.addColorStop(1, 'rgba(255, 80, 60, 0)');
        b.fillStyle = glow;
        b.fillRect(0, 0, W, H);
        shake(k > 0.6 ? 'quake' : 'quake-soft');
      }
    }

    // ---- The impact ----
    if (t >= HIT) {
      const s = t - HIT;
      if (s < 0.05 && bits.length < 300) {
        for (let i = 0; i < 160; i++) {
          const a = Math.random() * Math.PI * 2;
          const v = 40 + Math.random() * 140;
          bits.push({ x: at.x, y: at.y, vx: Math.cos(a) * v * 1.6, vy: Math.sin(a) * v * 0.8 - 80 - Math.random() * 110, life: 2 + Math.random() * 3, size: Math.random() < 0.35 ? 3 : Math.random() < 0.5 ? 2 : 1, hot: Math.random() < 0.5 });
        }
      }
      shake(s < 1.8 ? 'quake-hard' : s < 4 ? 'quake' : s < 6 ? 'quake-soft' : '');
      // The world changes behind the white.
      if (!boomed) {
        boomed = true;
        cue('impact');
      }
      if (s > 0.25 && !changed) {
        changed = true;
        onImpact();
      }
      // Darkness over the old world until the white takes it.
      if (s < 0.3) {
        b.fillStyle = 'rgba(6, 6, 18, 0.8)';
        b.fillRect(0, 0, W, H);
      }
      // The shockwave: rings racing out, the air bending.
      for (let k = 0; k < 3; k++) {
        const r = (s - k * 0.18) * W * 1.6;
        if (r <= 0 || r > W * 2.2) continue;
        b.strokeStyle = `rgba(255, ${230 - k * 50}, ${200 - k * 60}, ${Math.max(0, 0.8 - r / (W * 2.2))})`;
        b.lineWidth = 4 - k;
        b.beginPath();
        b.ellipse(at.x, at.y, r, r * 0.6, 0, 0, Math.PI * 2);
        b.stroke();
      }
      // The world gone red: a wash of it over everything, deepest just after, never quite
      // lifting before the end (the map below carries on smouldering).
      if (s > 0.3) {
        const k = Math.min(1, (s - 0.3) / 0.8);
        b.fillStyle = `rgba(120, 14, 10, ${k * Math.max(0.22, 0.42 - s * 0.02)})`;
        b.fillRect(0, 0, W, H);
        const g = b.createRadialGradient(at.x, at.y, 0, at.x, at.y, W * 0.9);
        g.addColorStop(0, `rgba(255, 120, 60, ${0.45 * k})`);
        g.addColorStop(1, 'rgba(255, 60, 30, 0)');
        b.fillStyle = g;
        b.fillRect(0, 0, W, H);
      }
      // Fire: flickering tongues across the land, then burning low.
      for (const f of fires) {
        if (s < f.at) continue;
        const fx = at.x + Math.cos(f.a) * f.r * W * 0.75;
        const fy = at.y + Math.sin(f.a) * f.r * W * 0.75 * 0.62;
        const life = Math.min(1, (s - f.at) / 0.4) * Math.max(0.25, 1 - (s - f.at) / 9);
        const fl = Math.sin(t * 14 + f.ph) * 0.5 + 0.5;
        const h = Math.round((2 + f.sz * 2) * life * (0.7 + 0.5 * fl));
        b.fillStyle = `rgba(255, ${Math.round(90 + 90 * fl)}, 40, ${0.9 * life})`;
        b.fillRect(Math.round(fx), Math.round(fy) - h, f.sz, h);
        b.fillStyle = `rgba(255, 236, 170, ${0.9 * life})`;
        b.fillRect(Math.round(fx), Math.round(fy) - 1, f.sz, 1);
        if (Math.random() < 0.04 * life) bits.push({ x: fx, y: fy - h, vx: (Math.random() - 0.5) * 6, vy: -10 - Math.random() * 14, life: 1.2, size: 1, hot: true });
      }
      // Dust and smoke rolling out and up, then thinning.
      if (s > 0.2) {
        const thick = Math.min(1, s / 0.8) * Math.max(0, 1 - (s - 4) / 7);
        for (let i = 0; i < 18; i++) {
          const a = (i / 18) * Math.PI * 2 + s * 0.05;
          const r = Math.min(W * 0.9, s * W * 0.35) * (0.6 + 0.4 * Math.sin(i * 1.7));
          const x = at.x + Math.cos(a) * r;
          const y = at.y + Math.sin(a) * r * 0.55 - s * 4;
          const g = b.createRadialGradient(x, y, 0, x, y, 30 + s * 6);
          g.addColorStop(0, `rgba(70, 62, 60, ${0.5 * thick})`);
          g.addColorStop(1, 'rgba(70, 62, 60, 0)');
          b.fillStyle = g;
          b.fillRect(x - 60 - s * 6, y - 60 - s * 6, 120 + s * 12, 120 + s * 12);
        }
      }
      // The flash: white, then searing red, then clearing over the new world.
      const white = s < 0.12 ? s / 0.12 : Math.max(0, 1 - (s - 0.6) / 1.4);
      b.fillStyle = `rgba(255, 252, 245, ${Math.min(1, white)})`;
      b.fillRect(0, 0, W, H);
      const red = Math.max(0, 0.45 - Math.abs(s - 1.4) * 0.35);
      if (red > 0) {
        b.fillStyle = `rgba(255, 70, 50, ${red})`;
        b.fillRect(0, 0, W, H);
      }
      // Ash falling over everything after.
      if (s > 3 && Math.random() < 0.8) bits.push({ x: Math.random() * W, y: -2, vx: 3 + Math.random() * 4, vy: 6 + Math.random() * 8, life: 4, size: 1, hot: false });
    }

    // Flying rock, embers and ash.
    for (const p of bits) {
      p.life -= dt;
      p.vy += (p.hot ? 50 : p.vx > 0 && p.vy < 20 ? 0 : 60) * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.life <= 0) continue;
      b.fillStyle = p.hot ? (p.life > 1 ? '#ffd27a' : '#ff6a40') : t > HIT + 3 ? 'rgba(200, 196, 190, 0.8)' : '#2a2420';
      b.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
    }
    for (let i = bits.length - 1; i >= 0; i--) if (bits[i].life <= 0) bits.splice(i, 1);

    // The words.
    if (t > 0.6 && t < FALL_AT - 0.2) say(STORY.omen);
    else if (t > HIT + 1.6 && t < HIT + 5.4) say(STORY.strike);
    else if (t > HIT + 6 && t < END - 1) say(STORY.after);
    else say('');

    // Fade the canvas off at the end (onto the burnt world below); the story keeps the screen.
    if (t > END - 1.2) cv.style.opacity = String(Math.max(0, (END - t) / 1.2));
    if (t > UI_OUT && t < UI_OUT + 0.1) document.body.classList.add('cinematic');
    if (t < END) requestAnimationFrame(frame);
    else {
      cv.remove();
      say('');
      shake('');
      onDone();
    }
  };
  requestAnimationFrame(frame);
}

/** The story's line of words over the screen (one, shared by every cutscene). */
export function storyWords(): HTMLElement {
  let el = document.getElementById('strike-words');
  if (!el) {
    el = document.createElement('div');
    el.id = 'strike-words';
    document.body.append(el);
  }
  return el;
}

/** Shows a line of the story (fading in), or clears it with ''. */
export function storyLine(text: string, el = storyWords()): void {
  if (el.dataset.text === text) return;
  el.dataset.text = text;
  el.classList.remove('in');
  void el.offsetWidth;
  el.textContent = text;
  if (text) el.classList.add('in');
}
