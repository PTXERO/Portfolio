// The Creature's island in 2.5D, drawn by WebGL. The camera looks down at a slant: the
// land rises toward you by its height, so hills swell, cliffs stand up as faces and
// mountains tower, with creatures standing on top (the scene draws them into an overlay
// at the same lifted positions). Each screen pixel marches through the height map to
// find the ground it sees, the classic "voxel space" way.
//
// It's lit like a landscape too: the sun crosses with the day and casts shadows off the
// heights; water ripples and glints; cloud shadows drift; the fog of war rolls like
// cloud; seasons blend into each other; bright things glow at night; and the picture is
// colour-graded for the time of day.

import { ISLAND } from '../economy/island';

/** Tiles the land rises per unit of height, and how much the slant squashes depth. */
export const LIFT = 20;
export const TILT = 0.78;
/** The height map's range, stored in 16 bits. */
export const H_LO = -0.3;
export const H_SPAN = 1.4;

const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5);
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

/**
 * The light, worked out once per tile of the island (not per screen pixel), so shadows stay
 * fixed to the land however the view pans or zooms: r = direct sun on the slope,
 * g = ambient occlusion, b = how much of the sun reaches it past the heights (1 = all).
 */
const LIGHT = `
precision highp float;
uniform sampler2D uHeight;
uniform vec3 uSun;
varying vec2 vUv;
const float N = ${ISLAND.toFixed(1)};
const float K = ${LIFT.toFixed(1)};
float hTop(vec2 w) {
  vec4 t = texture2D(uHeight, w / N);
  return max((t.r * 65280.0 + t.a * 255.0) / 65535.0 * ${H_SPAN.toFixed(2)} + ${H_LO.toFixed(2)}, 0.0);
}
void main() {
  vec2 w = vUv * N;
  float h = hTop(w);
  float hl = hTop(w - vec2(1.0, 0.0)), hr = hTop(w + vec2(1.0, 0.0));
  float hu = hTop(w - vec2(0.0, 1.0)), hd = hTop(w + vec2(0.0, 1.0));
  vec3 n = normalize(vec3(-(hr - hl) * 0.5 * K, -(hd - hu) * 0.5 * K, 1.0));
  float diff = max(dot(n, uSun), 0.0);
  // March toward the sun over the island: higher ground in the way casts a shadow.
  float sh = 1.0;
  vec2 dir = normalize(uSun.xy + 1e-5);
  float rise = uSun.z / max(length(uSun.xy), 0.05);
  for (int i = 1; i <= 28; i++) {
    float d = float(i) * 1.3;
    float over = hTop(w + dir * d) * K - (h * K + rise * d + 0.3);
    sh = min(sh, 1.0 - smoothstep(0.0, 1.5, over) * (1.0 - float(i) / 32.0));
  }
  float around = 0.0;
  for (int i = 0; i < 8; i++) {
    float a = float(i) * 0.785;
    around += hTop(w + vec2(cos(a), sin(a)) * 2.5);
  }
  float ao = clamp(1.0 - max(around / 8.0 - h, 0.0) * K * 0.08, 0.6, 1.0);
  gl_FragColor = vec4(diff, ao, sh, 1.0);
}`;

const FRAG = `
precision highp float;
uniform sampler2D uGround0;
uniform sampler2D uGround1;
uniform sampler2D uHeight;
uniform sampler2D uFog;
uniform sampler2D uOver;
uniform sampler2D uLight;
uniform sampler2D uTrail; // paths worn into the ground (alpha)
uniform vec4 uWeather; // storm, morning mist, winter ice, wet ground (each 0 to 1)
uniform float uBlend;
uniform vec2 uArt;
uniform vec4 uCam; // camera centre x, y (tiles), zoom (art px per tile), screen row of the centre
uniform float uTime;
uniform float uNight;
uniform vec3 uSun;
uniform vec3 uSunCol;
uniform vec3 uAmb;
uniform vec3 uShadeCol; // the colour shadows take on (cool by day, violet at dawn and dusk)
uniform float uShadowK; // how deep shadows are: faint with the sun high, long and deep low down
uniform vec3 uGrade; // the time of day's and the season's colour cast
uniform vec3 uHaze; // light the low sun scatters through the air (rosy at dawn, orange at dusk)
varying vec2 vUv;

const float N = ${ISLAND.toFixed(1)};
const float K = ${LIFT.toFixed(1)};
const float TY = ${TILT.toFixed(2)};

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += noise(p) * a; p = p * 2.03 + 17.0; a *= 0.5; }
  return v;
}
float lum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

// Raw height (below 0 is under water), smooth between tiles.
float hRaw(vec2 w) {
  if (w.x < 0.0 || w.y < 0.0 || w.x > N || w.y > N) return -0.3;
  vec4 t = texture2D(uHeight, w / N);
  return (t.r * 65280.0 + t.a * 255.0) / 65535.0 * ${H_SPAN.toFixed(2)} + ${H_LO.toFixed(2)};
}
// The surface: water lies flat at sea level.
float hTop(vec2 w) { return max(hRaw(w), 0.0); }
float biomeAt(vec2 w) {
  if (w.x < 0.0 || w.y < 0.0 || w.x >= N || w.y >= N) return 0.0;
  return floor(texture2D(uHeight, (floor(w) + 0.5) / N).g * 255.0 / 28.0 + 0.5);
}
// Where a bit of ground lands on screen (art pixels, row).
float screenRow(vec2 w) { return (w.y - uCam.y) * uCam.z * TY + uCam.w - hTop(w) * K * uCam.z; }

void main() {
  vec2 art = vUv * uArt;
  float wx = uCam.x + (art.x - uArt.x * 0.5) / uCam.z;
  float base = uCam.y + (art.y - uCam.w) / (uCam.z * TY);
  // March from the furthest ground that could rise into this pixel back to the ground
  // right under it: the first that reaches up to the pixel is what's seen.
  float span = K * 1.05 / TY;
  float stepW = span / 56.0;
  float wy = base;
  for (int i = 0; i <= 56; i++) {
    float y = base + span - float(i) * stepW;
    if (screenRow(vec2(wx, y)) <= art.y) { wy = y; break; }
  }
  // Narrow it down between that step and the one before.
  float lo = wy, hi = wy + stepW;
  for (int i = 0; i < 5; i++) {
    float m = (lo + hi) * 0.5;
    if (screenRow(vec2(wx, m)) <= art.y) lo = m; else hi = m;
  }
  vec2 w = vec2(wx, lo);
  float h = hTop(w);
  float raw = hRaw(w);
  float biome = biomeAt(w);
  vec2 tuv = (floor(w) + 0.5) / N;
  bool inside = w.x >= 0.0 && w.y >= 0.0 && w.x < N && w.y < N;
  vec3 col = inside ? mix(texture2D(uGround0, tuv).rgb, texture2D(uGround1, tuv).rgb, uBlend) : vec3(0.141, 0.314, 0.431);

  // How steep the ground is as seen: a face standing up toward the camera, or a top.
  float dRow = (screenRow(w + vec2(0.0, 0.3)) - screenRow(w - vec2(0.0, 0.3))) / 0.6;
  float face = 1.0 - clamp(dRow / (uCam.z * TY * 0.55), 0.0, 1.0);

  // Light, from the island's light map (fixed to the land).
  vec3 L = inside ? texture2D(uLight, w / N).rgb : vec3(0.8, 1.0, 1.0);
  float diff = L.r;
  float ao = L.g;
  // Shadow: deep and coloured when the sun is low, barely there at noon.
  float shade = (1.0 - L.b) * uShadowK;
  vec3 sunLight = uAmb + uSunCol * diff * (1.0 - shade);
  sunLight = mix(sunLight, sunLight * uShadeCol, shade);

  vec3 lit;
  bool water = biome < 1.5 && raw <= 0.0;
  if (water) {
    vec2 ww = w * 0.45;
    float t = uTime;
    float e = 0.15;
    vec2 flow = vec2(t * 0.12, t * 0.07);
    float r0 = fbm(ww + flow);
    float rx = fbm(ww + vec2(e, 0.0) + flow) - r0;
    float ry = fbm(ww + vec2(0.0, e) + flow) - r0;
    vec3 wn = normalize(vec3(-rx * 6.0, -ry * 6.0, 1.0));
    float spec = pow(max(dot(reflect(-uSun, wn), normalize(vec3(0.0, 0.6, 1.0))), 0.0), 60.0) * (1.0 - uNight);
    float shallow = biome > 0.5 ? 1.0 : 0.0;
    float ca = pow(1.0 - abs(noise(w * 1.1 + t * 0.4) - noise(w * 1.3 - t * 0.3)), 6.0) * shallow;
    vec3 wl = mix(uAmb + uSunCol * 0.85, (uAmb + uSunCol * 0.4) * uShadeCol, shade);
    lit = col * wl * (0.9 + r0 * 0.25) + uSunCol * spec * 1.4 * (1.0 - shade) + vec3(0.6, 0.85, 0.9) * ca * 0.12 * (1.0 - uNight);
    // Winter: the shallows freeze out from the shore, crazed with cracks.
    float ice = shallow * step(-0.075 * uWeather.z, raw) * step(0.05, uWeather.z);
    if (ice > 0.5) {
      float crack = 1.0 - smoothstep(0.0, 0.035, abs(noise(floor(w * 2.0) * 0.4) - 0.5)) * 0.18;
      vec3 iceCol = vec3(0.8, 0.88, 0.95) * (0.94 + 0.06 * hash(floor(w * 2.0))) * crack;
      lit = iceCol * mix(uAmb + uSunCol * 0.85, (uAmb + uSunCol * 0.4) * uShadeCol, shade) + uSunCol * spec * 0.5;
    }
  } else {
    // Paths worn by the herd's feet: grass gives way to trodden earth.
    float worn = smoothstep(0.12, 0.7, inside ? texture2D(uTrail, w / N).a : 0.0) * (biome > 2.5 && biome < 6.5 ? 0.7 : 0.0);
    col = mix(col, vec3(0.52, 0.42, 0.3) * (0.88 + 0.24 * hash(floor(w * 2.0))), worn);
    // Faces: the earth and rock under the top, darker the steeper.
    vec3 earth = mix(vec3(0.42, 0.32, 0.22), vec3(0.45, 0.47, 0.5), smoothstep(0.45, 0.65, h));
    col = mix(col, earth * (0.75 + 0.25 * fract(w.y * 0.5)), face * 0.85);
    lit = col * sunLight * ao * (1.0 - face * 0.25);
  }

  // After rain: the ground darkens and puddles hold the sky.
  if (!water) {
    lit *= 1.0 - uWeather.w * 0.16;
    float puddle = step(0.8, noise(floor(w * 2.0) * 0.35)) * uWeather.w * (biome > 2.5 && biome < 6.5 ? 1.0 : 0.0);
    lit = mix(lit, vec3(0.55, 0.64, 0.74) * clamp(lum(uAmb + uSunCol), 0.2, 1.1), puddle * 0.6);
  }

  // Clouds drift over, their shadows darkening the land below (heavy and grey in a storm).
  float cloud = smoothstep(0.52 - uWeather.x * 0.4, 0.78, fbm(w * 0.018 + vec2(uTime * 0.012, uTime * 0.005) * (1.0 + uWeather.x * 2.0)));
  lit *= 1.0 - cloud * (0.22 + uWeather.x * 0.2) * (1.0 - uNight);
  lit = mix(lit, vec3(lum(lit)) * vec3(0.86, 0.9, 1.0), uWeather.x * 0.45) * (1.0 - uWeather.x * 0.3);

  // Fog of war: soft, rolling cloud, with wisps at its edge.
  // Past what's been seen, and thickening toward the map's edge (and beyond it), all is cloud.
  float edge = min(min(w.x, w.y), min(N - w.x, N - w.y));
  float fogA = max(inside ? texture2D(uFog, w / N).a : 1.0, 1.0 - smoothstep(4.0, 34.0, edge));
  float fn = fbm(w * 0.06 + vec2(uTime * 0.02, -uTime * 0.013));
  float fn2 = fbm(w * 0.16 - vec2(uTime * 0.035, uTime * 0.02));
  float fog = smoothstep(0.3, 0.7, fogA + (fn - 0.5) * 0.6 + (fn2 - 0.5) * 0.2);
  float bright = clamp(lum(uAmb + uSunCol), 0.15, 1.2);
  vec3 fogCol = mix(vec3(0.70, 0.74, 0.79), vec3(0.95, 0.96, 0.97), smoothstep(0.3, 0.75, fn * 0.7 + fn2 * 0.3)) * (0.3 + bright * 0.72);
  lit = mix(lit, fogCol, fog);
  // Morning mist lies in the low ground and burns off as the sun climbs.
  float mist = uWeather.y * (1.0 - smoothstep(0.02, 0.3, h)) * smoothstep(0.35, 0.7, fbm(w * 0.05 + vec2(uTime * 0.01, 0.0)));
  lit = mix(lit, vec3(0.86, 0.88, 0.92) * (0.35 + bright * 0.7), mist * 0.75);

  // Creatures, markers and weather, drawn by the scene at their lifted spots: lit as
  // figures standing up in the light.
  vec2 ouv = (floor(art) + 0.5) / uArt;
  vec4 o = texture2D(uOver, ouv);
  if (o.a > 0.01) lit = mix(lit, o.rgb * (uAmb * 1.1 + uSunCol * 0.95), o.a);

  // Glow: only things marked as shining (fireflies, a beast's eye, drawn at alpha 254) bloom,
  // so creatures and snow stay dark at night.
  vec3 glow = vec3(0.0);
  for (int i = 0; i < 8; i++) {
    float a = float(i) * 0.785;
    vec4 c = texture2D(uOver, vUv + vec2(cos(a), sin(a)) * 0.9 / uArt);
    glow += c.rgb * (1.0 - step(0.0016, abs(c.a - 254.0 / 255.0)));
  }
  lit += glow / 8.0 * (0.15 + uNight * 0.85);
  if (abs(o.a - 254.0 / 255.0) < 0.0016) lit = mix(lit, o.rgb, uNight);

  // Grade: highlights roll off instead of burning out (snow in the sun keeps its shape),
  // a touch more colour and contrast, and a soft vignette.
  lit *= uGrade;
  // The low sun's glow hangs in the air, strongest toward the far (top) side of the view.
  lit += uHaze * (1.0 - vUv.y * 0.6);
  lit -= max(lit - 0.72, 0.0) * 0.55;
  float l = lum(lit);
  lit = mix(vec3(l), lit, 1.12);
  lit = (lit - 0.5) * 1.05 + 0.5;
  vec2 v = vUv - 0.5;
  lit *= 1.0 - dot(v, v) * 0.45;
  gl_FragColor = vec4(clamp(lit, 0.0, 1.0), 1.0);
}`;

export interface ShadeParams {
  /** Camera centre in tiles, zoom (art px per tile), and the screen row of the centre. */
  cam: [number, number, number, number];
  /** The season's colour cast. */
  tint: [number, number, number];
  time: number;
  /** 0 at sunrise, 0.75 at sunset, 1 at the next sunrise. */
  day: number;
  /** The season's ground and the next one's, and how far into the change it is (0 to 1). */
  ground: [HTMLCanvasElement, HTMLCanvasElement];
  blend: number;
  /** Worn paths (alpha) and their version; storm, mist, ice and wet ground, 0 to 1. */
  trail: HTMLCanvasElement;
  trailVersion: number;
  weather: [number, number, number, number];
}

function compile(gl: WebGLRenderingContext, vs: string, fs: string): WebGLProgram {
  const p = gl.createProgram()!;
  for (const [type, src] of [
    [gl.VERTEX_SHADER, vs],
    [gl.FRAGMENT_SHADER, fs],
  ] as const) {
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) ?? 'shader');
    gl.attachShader(p, sh);
  }
  gl.bindAttribLocation(p, 0, 'aPos');
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
  return p;
}

function texture(gl: WebGLRenderingContext, filter: number): WebGLTexture {
  const t = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

/** Mixes three colours by weights that sum to about 1. */
function blend(a: number[], b: number[], c: number[], wa: number, wb: number, wc: number): number[] {
  return a.map((v, i) => v * wa + b[i] * wb + c[i] * wc);
}

export class MapShader {
  private gl: WebGLRenderingContext;
  private prog: WebGLProgram;
  private lightProg: WebGLProgram;
  private lightTex: WebGLTexture;
  private lightFbo: WebGLFramebuffer;
  private lightKey = '';
  private heightTex: WebGLTexture;
  private fogTex: WebGLTexture;
  private overTex: WebGLTexture;
  /** Ground textures by the canvas they came from (one per season), uploaded once. */
  private grounds = new Map<HTMLCanvasElement, WebGLTexture>();
  private heightSeed = -1;
  private fogVersion = -1;
  private trailTex: WebGLTexture;
  private trailVersion = -1;
  private uni = new Map<string, WebGLUniformLocation | null>();

  /** Throws if WebGL isn't available (the scene then draws without it). */
  constructor(readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl', { antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: false });
    if (!gl) throw new Error('no webgl');
    this.gl = gl;
    this.prog = compile(gl, VERT, FRAG);
    this.lightProg = compile(gl, VERT, LIGHT);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.heightTex = texture(gl, gl.LINEAR);
    this.fogTex = texture(gl, gl.LINEAR);
    this.overTex = texture(gl, gl.NEAREST);
    this.trailTex = texture(gl, gl.LINEAR);
    this.lightTex = texture(gl, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, ISLAND, ISLAND, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    this.lightFbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.lightFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.lightTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /** Re-lights the island's light map (only when the sun has moved enough to show). */
  private relight(sun: number[]): void {
    const key = `${this.heightSeed}|${sun.map((v) => v.toFixed(2)).join()}`;
    if (key === this.lightKey) return;
    this.lightKey = key;
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.lightFbo);
    gl.viewport(0, 0, ISLAND, ISLAND);
    gl.useProgram(this.lightProg);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.heightTex);
    gl.uniform1i(gl.getUniformLocation(this.lightProg, 'uHeight'), 2);
    gl.uniform3fv(gl.getUniformLocation(this.lightProg, 'uSun'), sun);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  private u(name: string): WebGLUniformLocation | null {
    if (!this.uni.has(name)) this.uni.set(name, this.gl.getUniformLocation(this.prog, name));
    return this.uni.get(name)!;
  }

  /** The island's heights and kinds of ground (once per island). */
  setIsland(seed: number, data: Uint8Array): void {
    if (seed === this.heightSeed) return;
    this.heightSeed = seed;
    this.grounds.forEach((t) => this.gl.deleteTexture(t));
    this.grounds.clear();
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.heightTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, ISLAND, ISLAND, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
  }

  /** The fog over the island (re-sent only when it changes). */
  setFog(canvas: HTMLCanvasElement, version: number): void {
    if (version === this.fogVersion) return;
    this.fogVersion = version;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.fogTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
  }

  private groundTex(c: HTMLCanvasElement): WebGLTexture {
    let t = this.grounds.get(c);
    if (!t) {
      const gl = this.gl;
      t = texture(gl, gl.NEAREST);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
      this.grounds.set(c, t);
    }
    return t;
  }

  /** The sun's direction and the light's colours for a point in the day. */
  private sky(day: number): { sun: number[]; sunCol: number[]; amb: number[]; night: number; shadeCol: number[]; shadowK: number; grade: number[]; haze: number[] } {
    const dayLen = 0.75;
    const t = Math.min(day, dayLen) / dayLen;
    const a = t * Math.PI;
    const elev = Math.max(0.12, Math.sin(a)) * 0.95;
    // Rises in the east (right), sets in the west, across the north: shadows fall toward the viewer.
    const sun = [Math.cos(a) * Math.cos(elev), -Math.sin(a) * 0.6 * Math.cos(elev) - 0.2, Math.sin(elev)];
    const len = Math.hypot(sun[0], sun[1], sun[2]);
    const dir = sun.map((v) => v / len);
    const dusk = Math.max(0, 1 - Math.sin(a) * 2.2);
    // Night fades in after sunset and out before sunrise.
    const nightW = day >= dayLen ? Math.min(1, (day - dayLen) * 40, (1 - day) * 40) : 0;
    // Dawn is rosy gold, dusk deep orange; their shadows go violet and plum. By day shadows are
    // a cool, faint blue (the sky lighting them), and they deepen as the sun gets low.
    const morning = t < 0.5;
    const lowSun = morning ? [1.0, 0.7, 0.6] : [1.0, 0.56, 0.3];
    const lowShade = morning ? [0.86, 0.7, 1.05] : [0.82, 0.58, 0.82];
    const lowGrade = morning ? [1.04, 0.97, 1.0] : [1.06, 0.96, 0.9];
    const lowHaze = morning ? [0.16, 0.07, 0.12] : [0.2, 0.08, 0.02];
    const dayW = (1 - dusk) * (1 - nightW);
    const duskW = dusk * (1 - nightW);
    const sunCol = blend([1.0, 0.96, 0.88], lowSun, [0.32, 0.4, 0.62], dayW, duskW, nightW).map((v) => v * (0.66 - nightW * 0.44));
    const amb = blend([0.5, 0.54, 0.6], [0.46, 0.4, 0.5], [0.13, 0.17, 0.32], dayW, duskW, nightW);
    const shadeCol = blend([0.8, 0.88, 1.1], lowShade, [0.75, 0.82, 1.1], dayW, duskW, nightW);
    const grade = blend([1.0, 1.0, 0.99], lowGrade, [0.88, 0.94, 1.12], dayW, duskW, nightW);
    // Faint at noon, deep with the sun low.
    const shadowK = (0.3 + 0.62 * (1 - Math.sin(a))) * (1 - nightW) + 0.45 * nightW;
    const haze = lowHaze.map((v) => v * duskW);
    return { sun: nightW > 0.5 ? [0.3, -0.5, 0.8] : dir, sunCol, amb, night: nightW, shadeCol, shadowK, grade, haze };
  }

  render(over: HTMLCanvasElement, artW: number, artH: number, p: ShadeParams): void {
    const gl = this.gl;
    const g0 = this.groundTex(p.ground[0]);
    const g1 = this.groundTex(p.ground[1]);
    const sky = this.sky(p.day);
    this.relight(sky.sun);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, g0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, g1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.heightTex);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.fogTex);
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, this.overTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, over);
    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_2D, this.lightTex);
    gl.uniform1i(this.u('uGround0'), 0);
    gl.uniform1i(this.u('uGround1'), 1);
    gl.uniform1i(this.u('uHeight'), 2);
    gl.uniform1i(this.u('uFog'), 3);
    gl.uniform1i(this.u('uOver'), 4);
    gl.uniform1i(this.u('uLight'), 5);
    gl.activeTexture(gl.TEXTURE6);
    gl.bindTexture(gl.TEXTURE_2D, this.trailTex);
    if (p.trailVersion !== this.trailVersion) {
      this.trailVersion = p.trailVersion;
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, p.trail);
    }
    gl.uniform1i(this.u('uTrail'), 6);
    gl.uniform4fv(this.u('uWeather'), p.weather);
    gl.uniform1f(this.u('uBlend'), p.blend);
    gl.uniform2f(this.u('uArt'), artW, artH);
    gl.uniform4f(this.u('uCam'), p.cam[0], p.cam[1], p.cam[2], p.cam[3]);
    gl.uniform1f(this.u('uTime'), p.time);
    gl.uniform1f(this.u('uNight'), sky.night);
    gl.uniform3fv(this.u('uSun'), sky.sun);
    gl.uniform3fv(this.u('uSunCol'), sky.sunCol);
    gl.uniform3fv(this.u('uAmb'), sky.amb);
    gl.uniform3fv(this.u('uShadeCol'), sky.shadeCol);
    gl.uniform3fv(this.u('uHaze'), sky.haze);
    gl.uniform1f(this.u('uShadowK'), sky.shadowK);
    gl.uniform3fv(this.u('uGrade'), sky.grade.map((v, i) => v * p.tint[i]));
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}
