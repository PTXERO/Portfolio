// Through their eyes: New Shore's island seen from where the chief stands, first person. Loaded
// only when asked for (its own chunk), and gone again when left, so the game pays nothing for it
// otherwise. The same height map, ground and fog as the map's 2.5D view; each (low-res) pixel
// casts a ray from the eye and steps over the land until it meets it: hills hide what's behind
// them, water lies flat and glints, the far side hazes into the sky, the fog of war is mist.
// Drawn small and scaled up with hard edges, in keeping with the pixel art.
// (A prototype: the land and sky; creatures, huts and trees standing in it come next.)

import { H_LO, H_SPAN } from './shade';

const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAG = `
precision highp float;
uniform sampler2D uHeight;
uniform sampler2D uGround0;
uniform sampler2D uGround1;
uniform sampler2D uFog;
uniform float uBlend;
uniform float uN;      // tiles across
uniform float uK;      // tiles the land rises per unit of height
uniform vec3 uEye;     // x, y (tiles), z (tiles up)
uniform vec2 uLook;    // yaw, pitch (radians)
uniform float uAspect;
uniform vec3 uSun;     // toward the sun
uniform vec3 uSunCol;
uniform vec3 uAmb;
uniform float uNight;
uniform float uTime;
varying vec2 vUv;

const float H_LO = ${H_LO.toFixed(4)};
const float H_SPAN = ${H_SPAN.toFixed(4)};
const float FAR = 260.0;

float h1(vec2 t) {
  vec4 c = texture2D(uHeight, (t + 0.5) / uN);
  return ((c.r * 255.0 * 256.0 + c.a * 255.0) / 65535.0 * H_SPAN + H_LO);
}
// The land's height at a point (tiles up), smooth between tiles; the sea, beyond the island.
float height(vec2 p) {
  if (p.x < 0.0 || p.y < 0.0 || p.x > uN - 1.0 || p.y > uN - 1.0) return H_LO * uK;
  // (Each tile's height sits at its middle, as on the map.)
  vec2 q = p - 0.5;
  vec2 i = floor(q);
  vec2 f = q - i;
  float a = h1(i), b = h1(i + vec2(1.0, 0.0)), c = h1(i + vec2(0.0, 1.0)), d = h1(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y) * uK;
}
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

vec3 skyCol(vec3 d) {
  float up = clamp(d.z, 0.0, 1.0);
  vec3 dayTop = vec3(0.36, 0.56, 0.86), dayLow = vec3(0.74, 0.84, 0.92);
  vec3 nightTop = vec3(0.02, 0.03, 0.08), nightLow = vec3(0.08, 0.1, 0.18);
  vec3 c = mix(mix(dayLow, dayTop, pow(up, 0.6)), mix(nightLow, nightTop, pow(up, 0.6)), uNight);
  // The sun's glow and disc.
  float s = max(dot(d, normalize(uSun)), 0.0);
  c += uSunCol * (pow(s, 8.0) * 0.25 + smoothstep(0.99975, 0.9999, s) * 1.5) * (1.0 - uNight);
  // Stars, at night.
  if (uNight > 0.3 && d.z > 0.0) {
    vec2 q = floor(vec2(atan(d.y, d.x) * 120.0, d.z * 180.0));
    c += step(0.995, hash(q)) * uNight * 0.8;
  }
  return c;
}

// (How deep the mist lies over unseen land, tiles; and how thick it is.)
#define MIST_DEEP 5.0
#define MIST_THICK 0.16

void main() {
  // The ray from the eye.
  float fov = 1.15;
  vec2 sc = (vUv * 2.0 - 1.0) * vec2(uAspect, 1.0) * tan(fov * 0.5);
  float cy = cos(uLook.x), sy = sin(uLook.x), cp = cos(uLook.y), sp = sin(uLook.y);
  vec3 fwd = vec3(cy * cp, sy * cp, sp);
  vec3 right = normalize(vec3(-sy, cy, 0.0));
  // (The map's y runs south: up is fwd × right here.)
  vec3 up = cross(fwd, right);
  vec3 d = normalize(fwd + right * sc.x + up * sc.y);

  // Step over the land: big steps high above it, small ones close (never past a hill's top).
  float t = 0.2;
  float hitT = -1.0;
  float sea = 0.0;
  // The fog of war as mist: a grey haze lying a few tiles deep over the land not yet seen,
  // gathered along the line of sight (seen through near by, thick over far unseen land).
  float mist = 0.0;
  for (int i = 0; i < 180; i++) {
    vec3 p = uEye + d * t;
    float g = max(height(p.xy), sea);
    float above = p.z - g;
    if (above < 0.02) { hitT = t; break; }
    float step = max(0.04 + t * 0.004, above * 0.45);
    if (above < MIST_DEEP) mist += texture2D(uFog, p.xy / uN).a * (1.0 - above / MIST_DEEP) * step;
    t += step;
    if (t > FAR || p.z > uK * 2.0) break;
  }
  vec3 col;
  if (hitT < 0.0) {
    col = skyCol(d);
  } else {
    // Back up a little to find the ground exactly.
    float lo = hitT - max(0.04 + hitT * 0.004, 0.1), hi = hitT;
    for (int k = 0; k < 6; k++) {
      float m = (lo + hi) * 0.5;
      vec3 p = uEye + d * m;
      if (p.z - max(height(p.xy), sea) < 0.0) hi = m; else lo = m;
    }
    t = hi;
    vec3 p = uEye + d * t;
    float land = height(p.xy);
    bool water = land < sea - 0.02;
    vec2 uv = (floor(p.xy) + 0.5) / uN;
    vec3 base = mix(texture2D(uGround0, uv).rgb, texture2D(uGround1, uv).rgb, uBlend);
    vec3 n;
    if (water) {
      // Ripples, and the sky in it (more toward the horizon).
      float w = sin(p.x * 1.7 + uTime * 1.3) * 0.5 + sin(p.y * 2.1 - uTime * 1.1) * 0.5;
      n = normalize(vec3(w * 0.06, w * 0.05, 1.0));
      vec3 deep = vec3(0.1, 0.28, 0.4);
      vec3 refl = skyCol(reflect(d, n));
      float fres = pow(1.0 - max(-d.z, 0.0), 3.0);
      base = mix(deep, refl, 0.25 + fres * 0.6);
      float glint = pow(max(dot(reflect(d, n), normalize(uSun)), 0.0), 60.0);
      base += uSunCol * glint * (1.0 - uNight);
      col = base * (uAmb + uSunCol * 0.5);
    } else {
      float e = 0.35;
      n = normalize(vec3(height(p.xy - vec2(e, 0.0)) - height(p.xy + vec2(e, 0.0)), height(p.xy - vec2(0.0, e)) - height(p.xy + vec2(0.0, e)), 2.0 * e));
      float diff = max(dot(n, normalize(uSun)), 0.0);
      // Texture within a tile: a speckle of lighter and darker (finer up close), and a blade-ish
      // streak, so the near ground isn't one flat colour.
      vec2 cell = floor(p.xy * 6.0);
      float sp = hash(cell) - 0.5;
      float streak = hash(vec2(cell.x, floor(p.y * 2.0))) - 0.5;
      base *= 1.0 + sp * 0.16 * smoothstep(60.0, 5.0, t) + streak * 0.06;
      // Cliffs: a darker face where it's steep.
      float steep = 1.0 - n.z;
      base = mix(base, base * 0.7 + vec3(0.05), smoothstep(0.35, 0.7, steep));
      col = base * (uAmb + uSunCol * diff);
    }
    // (Unseen ground itself wears a little of the mist too, so nothing unseen is sharp.)
    mist += texture2D(uFog, p.xy / uN).a * 4.0;
    // Distance: the far side fades into the sky.
    col = mix(col, skyCol(vec3(d.xy, 0.02)), smoothstep(FAR * 0.35, FAR, t));
  }
  // The mist: grey, see-through where it's thin, lit by the hour.
  vec3 mistCol = mix(vec3(0.64, 0.66, 0.69) * (uAmb + uSunCol * 0.6) * 1.15, vec3(0.16, 0.18, 0.24), uNight);
  col = mix(col, mistCol, 1.0 - exp(-mist * MIST_THICK));
  gl_FragColor = vec4(col, 1.0);
}`;

/** Something standing in the world (a critter, a hut, the fire): where its feet are (tiles; z
 * up, as the land's height), how tall it stands (tiles), its picture, facing which way. */
export interface EyeSprite {
  x: number;
  y: number;
  z: number;
  h: number;
  img: CanvasImageSource & { width: number; height: number };
  flip?: boolean;
}

export interface EyeInputs {
  key: string;
  n: number;
  heights: Uint8Array;
  fog: HTMLCanvasElement;
  fogVersion: number;
  ground: [HTMLCanvasElement, HTMLCanvasElement];
  blend: number;
}

function compile(gl: WebGLRenderingContext): WebGLProgram {
  const p = gl.createProgram()!;
  for (const [type, src] of [
    [gl.VERTEX_SHADER, VERT],
    [gl.FRAGMENT_SHADER, FRAG],
  ] as const) {
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) ?? 'eye shader');
    gl.attachShader(p, sh);
  }
  gl.bindAttribLocation(p, 0, 'aPos');
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'eye link');
  return p;
}

/** The light for a point in the day (0 sunrise, 0.75 sunset, 1 the next sunrise), as the map's. */
export function skyLight(day: number): { sun: number[]; sunCol: number[]; amb: number[]; night: number } {
  const dayLen = 0.75;
  const t = Math.min(day, dayLen) / dayLen;
  const a = t * Math.PI;
  const elev = Math.max(0.12, Math.sin(a)) * 0.95;
  const sun = [Math.cos(a) * Math.cos(elev), -Math.sin(a) * 0.6 * Math.cos(elev) - 0.2, Math.sin(elev)];
  const night = day >= dayLen ? Math.min(1, (day - dayLen) * 40, (1 - day) * 40) : 0;
  const dusk = Math.max(0, 1 - Math.sin(a) * 2.2);
  const mix3 = (x: number[], y: number[], k: number) => x.map((v, i) => v + (y[i] - v) * k);
  let sunCol = mix3([1.0, 0.96, 0.88], [1.0, 0.6, 0.35], dusk);
  sunCol = mix3(sunCol, [0.3, 0.38, 0.6], night).map((v) => v * (0.72 - night * 0.5));
  const amb = mix3(mix3([0.5, 0.54, 0.6], [0.46, 0.4, 0.5], dusk), [0.12, 0.15, 0.3], night);
  return { sun: night > 0.5 ? [0.3, -0.5, 0.8] : sun, sunCol, amb, night };
}

/** How many screen pixels each drawn pixel covers (the lower, the sharper and the dearer). */
const PIXEL = 3;

export class EyeView {
  readonly el: HTMLElement;
  private canvas: HTMLCanvasElement;
  /** What stands in the world, drawn over the land (as small, scaled up the same). */
  private over: HTMLCanvasElement;
  private gl: WebGLRenderingContext;
  private prog: WebGLProgram;
  private tex: Record<'height' | 'g0' | 'g1' | 'fog', WebGLTexture>;
  private uni = new Map<string, WebGLUniformLocation | null>();
  private key = '';
  private fogV = -1;
  private grounds: [HTMLCanvasElement | null, HTMLCanvasElement | null] = [null, null];
  /** Where they look: yaw (0 east, clockwise round), pitch (up is positive). */
  yaw = 0;
  pitch = -0.05;
  private drag: { x: number; y: number; yaw: number; pitch: number; moved: boolean } | null = null;

  constructor(
    parent: HTMLElement,
    private onWalk: (dir: { x: number; y: number }) => void,
    private onLeave: () => void,
  ) {
    this.el = document.createElement('div');
    this.el.id = 'eye';
    this.el.innerHTML = `<canvas></canvas><canvas class="eye-sprites"></canvas><button class="px-btn eye-leave" aria-label="Leave">×</button><div class="eye-tip label">Drag to look · tap to walk</div>`;
    parent.appendChild(this.el);
    this.canvas = this.el.querySelector('canvas')!;
    this.over = this.el.querySelector<HTMLCanvasElement>('canvas.eye-sprites')!;
    const gl = this.canvas.getContext('webgl', { antialias: false, premultipliedAlpha: false });
    if (!gl) throw new Error('no webgl');
    this.gl = gl;
    this.prog = compile(gl);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const mk = (filter: number) => {
      const t = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    };
    this.tex = { height: mk(gl.NEAREST), g0: mk(gl.NEAREST), g1: mk(gl.NEAREST), fog: mk(gl.LINEAR) };
    // Look by dragging; a tap (no drag) walks the way they're looking.
    this.el.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('.eye-leave')) return;
      e.preventDefault();
      e.stopPropagation();
      this.drag = { x: e.clientX, y: e.clientY, yaw: this.yaw, pitch: this.pitch, moved: false };
      try {
        this.el.setPointerCapture(e.pointerId);
      } catch {
        /* (a synthetic event) */
      }
    });
    this.el.addEventListener('pointermove', (e) => {
      e.stopPropagation();
      if (!this.drag) return;
      const dx = e.clientX - this.drag.x;
      const dy = e.clientY - this.drag.y;
      if (Math.hypot(dx, dy) > 6) this.drag.moved = true;
      const k = 3.2 / Math.max(320, this.el.clientWidth);
      this.yaw = this.drag.yaw - dx * k;
      this.pitch = Math.max(-0.9, Math.min(0.7, this.drag.pitch + dy * k));
    });
    const end = (e: PointerEvent) => {
      e.stopPropagation();
      if (this.drag && !this.drag.moved && e.type === 'pointerup') {
        this.onWalk({ x: Math.cos(this.yaw), y: Math.sin(this.yaw) });
        this.el.querySelector('.eye-tip')?.classList.add('gone');
      }
      this.drag = null;
    };
    this.el.addEventListener('pointerup', end);
    this.el.addEventListener('pointercancel', end);
    this.el.addEventListener('click', (e) => {
      e.stopPropagation();
      if ((e.target as HTMLElement).closest('.eye-leave')) this.onLeave();
    });
  }

  private u(name: string): WebGLUniformLocation | null {
    if (!this.uni.has(name)) this.uni.set(name, this.gl.getUniformLocation(this.prog, name));
    return this.uni.get(name)!;
  }

  /** One frame: the island's data (re-sent only when it changes), where the eye is, the light. */
  draw(inp: EyeInputs, eye: { x: number; y: number; z: number }, k: number, light: { sun: number[]; sunCol: number[]; amb: number[]; night: number }, time: number): void {
    const gl = this.gl;
    // (The canvas: the screen's size, in drawn pixels.)
    const w = Math.max(80, Math.round(this.el.clientWidth / PIXEL));
    const h = Math.max(80, Math.round(this.el.clientHeight / PIXEL));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    if (inp.key !== this.key) {
      this.key = inp.key;
      gl.bindTexture(gl.TEXTURE_2D, this.tex.height);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, inp.n, inp.n, 0, gl.RGBA, gl.UNSIGNED_BYTE, inp.heights);
    }
    if (inp.fogVersion !== this.fogV) {
      this.fogV = inp.fogVersion;
      gl.bindTexture(gl.TEXTURE_2D, this.tex.fog);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, inp.fog);
    }
    for (const i of [0, 1] as const) {
      if (this.grounds[i] !== inp.ground[i]) {
        this.grounds[i] = inp.ground[i];
        gl.bindTexture(gl.TEXTURE_2D, i ? this.tex.g1 : this.tex.g0);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, inp.ground[i]);
      }
    }
    gl.viewport(0, 0, w, h);
    gl.useProgram(this.prog);
    const units: [string, WebGLTexture][] = [['uHeight', this.tex.height], ['uGround0', this.tex.g0], ['uGround1', this.tex.g1], ['uFog', this.tex.fog]];
    units.forEach(([name, t], i) => {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.uniform1i(this.u(name), i);
    });
    gl.uniform1f(this.u('uBlend'), inp.blend);
    gl.uniform1f(this.u('uN'), inp.n);
    gl.uniform1f(this.u('uK'), k);
    gl.uniform3f(this.u('uEye'), eye.x, eye.y, eye.z);
    gl.uniform2f(this.u('uLook'), this.yaw, this.pitch);
    gl.uniform1f(this.u('uAspect'), w / h);
    gl.uniform3fv(this.u('uSun'), light.sun);
    gl.uniform3fv(this.u('uSunCol'), light.sunCol);
    gl.uniform3fv(this.u('uAmb'), light.amb);
    gl.uniform1f(this.u('uNight'), light.night);
    gl.uniform1f(this.u('uTime'), time);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  /** What stands in the world, over the land: placed with the same camera as the land's rays,
   * as tall as they are for how far off they are, the far first; hidden behind a hill (the land
   * between checked along the line to them), fading far off, darker at night. */
  drawSprites(list: EyeSprite[], eye: { x: number; y: number; z: number }, landAt: (x: number, y: number) => number, night: number): void {
    const c = this.over;
    const w = this.canvas.width;
    const h = this.canvas.height;
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    const b = c.getContext('2d')!;
    b.clearRect(0, 0, w, h);
    b.imageSmoothingEnabled = false;
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw), cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const fwd = [cy * cp, sy * cp, sp];
    const rl = Math.hypot(-sy, cy);
    const right = [-sy / rl, cy / rl, 0];
    // up = fwd × right (the map's y runs south)
    const up = [fwd[1] * right[2] - fwd[2] * right[1], fwd[2] * right[0] - fwd[0] * right[2], fwd[0] * right[1] - fwd[1] * right[0]];
    const tan = Math.tan(1.15 / 2);
    const aspect = w / h;
    const proj = (x: number, y: number, z: number) => {
      const v = [x - eye.x, y - eye.y, z - eye.z];
      const d = v[0] * fwd[0] + v[1] * fwd[1] + v[2] * fwd[2];
      if (d < 0.3) return null;
      const sx = (v[0] * right[0] + v[1] * right[1] + v[2] * right[2]) / d / (tan * aspect);
      const sy2 = (v[0] * up[0] + v[1] * up[1] + v[2] * up[2]) / d / tan;
      return { X: (sx * 0.5 + 0.5) * w, Y: (1 - (sy2 * 0.5 + 0.5)) * h, d };
    };
    const items: { X: number; Y: number; d: number; s: EyeSprite }[] = [];
    for (const s of list) {
      const p = proj(s.x, s.y, s.z);
      if (!p || p.X < -w || p.X > w * 2 || p.Y < -h || p.Y > h * 3) continue;
      // Behind a hill? (Looked for along the line to its middle.)
      const mz = s.z + s.h * 0.5;
      const dist = Math.hypot(s.x - eye.x, s.y - eye.y);
      let hidden = false;
      const steps = Math.min(24, Math.ceil(dist / 1.5));
      for (let k = 1; k < steps && !hidden; k++) {
        const f = k / steps;
        const px = eye.x + (s.x - eye.x) * f;
        const py = eye.y + (s.y - eye.y) * f;
        if (landAt(px, py) > eye.z + (mz - eye.z) * f + 0.05) hidden = true;
      }
      if (!hidden) items.push({ ...p, s });
    }
    items.sort((a, c2) => c2.d - a.d);
    for (const it of items) {
      const ph = (it.s.h / it.d / tan) * (h / 2);
      if (ph < 1) continue;
      const pw = ph * (it.s.img.width / it.s.img.height);
      b.globalAlpha = Math.max(0, Math.min(1, (110 - it.d) / 40));
      if (it.s.flip) {
        b.save();
        b.translate(Math.round(it.X + pw / 2), Math.round(it.Y - ph));
        b.scale(-1, 1);
        b.drawImage(it.s.img, 0, 0, pw, ph);
        b.restore();
      } else b.drawImage(it.s.img, Math.round(it.X - pw / 2), Math.round(it.Y - ph), pw, ph);
    }
    b.globalAlpha = 1;
    // Night falls on them too.
    if (night > 0.02) {
      b.globalCompositeOperation = 'source-atop';
      b.fillStyle = `rgba(12, 16, 40, ${0.6 * night})`;
      b.fillRect(0, 0, w, h);
      b.globalCompositeOperation = 'source-over';
    }
  }

  /** Gone: the GL context let go of (it's heavy to keep). */
  dispose(): void {
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
    this.el.remove();
  }
}
