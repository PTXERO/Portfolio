// A lighting pass for the Creature's island, in WebGL: the pixel-art map is lit like a
// real landscape. The sun crosses the sky with the day, raking light and long shadows
// off the hills and mountains (from the island's height map); water ripples and glints;
// cloud shadows drift over the land; the fog of war rolls instead of sitting in blocks;
// bright things glow at night; and the whole picture is colour-graded for the time of day.
//
// Two passes: the light (sun, shadows, ambient occlusion) is worked out once per art pixel
// into a small buffer, then the full-resolution pass combines it with the art, filtered
// smooth, so the shading is soft while the pixels stay crisp.

const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5);
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

/** Pass 1, at art resolution: direct light with shadows (r) and ambient occlusion (g). */
const LIGHT = `
precision highp float;
uniform sampler2D uInfo;
uniform vec2 uArt;
uniform vec3 uSun;
uniform float uZoom;
varying vec2 vUv;
const float V = 34.0; // tiles of height per unit of the height map
float H(vec2 uv) { vec4 t = texture2D(uInfo, uv); return (t.r * 65280.0 + t.a * 255.0) / 65535.0 * 1.2 - 0.2; }
void main() {
  vec2 px = 1.0 / uArt;
  float h = H(vUv);
  float hx = (H(vUv + vec2(px.x, 0.0)) - H(vUv - vec2(px.x, 0.0))) * uZoom * 0.5;
  float hy = (H(vUv + vec2(0.0, px.y)) - H(vUv - vec2(0.0, px.y))) * uZoom * 0.5;
  vec3 n = normalize(vec3(-hx * V, -hy * V, 1.0));
  float diff = max(dot(n, uSun), 0.0);
  // March toward the sun: anything higher than the ray in the way casts a shadow.
  float sh = 1.0;
  vec2 dir = normalize(uSun.xy + 1e-5);
  float stepPx = clamp(uZoom * 0.9, 0.6, 6.0);
  float rise = uSun.z / max(length(uSun.xy), 0.05) * (stepPx / uZoom) / V;
  for (int i = 1; i <= 24; i++) {
    float fi = float(i);
    vec2 p = vUv + dir * px * stepPx * fi;
    float d = H(p) - (h + rise * fi + 0.002);
    sh = min(sh, 1.0 - smoothstep(0.0, 0.03, d) * (1.0 - fi / 30.0));
  }
  // Ambient occlusion: hollows between higher ground are darker.
  float around = 0.0;
  for (int i = 0; i < 8; i++) {
    float a = float(i) * 0.785;
    around += H(vUv + vec2(cos(a), sin(a)) * px * 2.5);
  }
  float ao = clamp(1.0 - max(around / 8.0 - h, 0.0) * 7.0, 0.55, 1.0);
  gl_FragColor = vec4(diff, ao, sh, 1.0);
}`;

/** Pass 2, at screen resolution: everything together. */
const FINAL = `
precision highp float;
uniform sampler2D uColor;
uniform sampler2D uInfo;
uniform sampler2D uLight;
uniform vec2 uArt;
uniform vec4 uCam; // camera centre x, y (tiles), zoom (art px per tile), screen row of the centre
uniform float uTime;
uniform float uNight;
uniform vec3 uSun;
uniform vec3 uSunCol;
uniform vec3 uAmb;
varying vec2 vUv;

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

void main() {
  vec2 art = vUv * uArt;
  vec2 cell = (floor(art) + 0.5) / uArt;
  vec2 world = vec2(uCam.x + (art.x - uArt.x * 0.5) / uCam.z, uCam.y + (art.y - uCam.w) / uCam.z);
  vec4 info = texture2D(uInfo, cell);
  float biome = floor(info.g * 255.0 / 28.0 + 0.5);
  vec3 col = texture2D(uColor, cell).rgb;
  vec3 L = texture2D(uLight, vUv).rgb;
  float sunLight = L.r * L.b;
  float ao = L.g;
  bool water = biome < 1.5;
  bool figure = biome > 8.5;

  vec3 lit;
  if (water) {
    // Water: rippling, a little lighter at the crests, glints where the sun catches it.
    vec2 w = world * 0.45;
    float t = uTime;
    float e = 0.15;
    float r0 = fbm(w + vec2(t * 0.12, t * 0.07));
    float rx = fbm(w + vec2(e, 0.0) + vec2(t * 0.12, t * 0.07)) - r0;
    float ry = fbm(w + vec2(0.0, e) + vec2(t * 0.12, t * 0.07)) - r0;
    vec3 n = normalize(vec3(-rx * 6.0, -ry * 6.0, 1.0));
    vec3 view = vec3(0.0, 0.25, 1.0);
    float spec = pow(max(dot(reflect(-uSun, n), normalize(view)), 0.0), 60.0) * (1.0 - uNight);
    float shallow = biome > 0.5 ? 1.0 : 0.0;
    // Caustics in the shallows: bright threads that wander over the sand below.
    float ca = pow(1.0 - abs(noise(world * 1.1 + t * 0.4) - noise(world * 1.3 - t * 0.3)), 6.0) * shallow;
    lit = col * (uAmb + uSunCol * 0.85) * (0.9 + r0 * 0.25) + uSunCol * spec * 1.4 + vec3(0.6, 0.85, 0.9) * ca * 0.12 * (1.0 - uNight);
  } else if (figure) {
    // Creatures stand up off the ground: lit by the sun (and the shadows of hills), no slope.
    lit = col * (uAmb * 1.1 + uSunCol * (0.35 + 0.65 * L.b));
  } else {
    lit = col * (uAmb + uSunCol * sunLight) * ao;
  }

  // Clouds drift over, their shadows darkening the land below.
  float cloud = smoothstep(0.52, 0.78, fbm(world * 0.018 + vec2(uTime * 0.012, uTime * 0.005)));
  lit *= 1.0 - cloud * 0.22 * (1.0 - uNight);

  // Fog of war: soft, rolling, with wisps at its edge.
  float fogA = texture2D(uInfo, vUv).b;
  float fn = fbm(world * 0.06 + vec2(uTime * 0.02, -uTime * 0.013));
  float fn2 = fbm(world * 0.16 - vec2(uTime * 0.035, uTime * 0.02));
  float fog = smoothstep(0.3, 0.7, fogA + (fn - 0.5) * 0.6 + (fn2 - 0.5) * 0.2);
  // Cloud-white, lit by however bright the day is; billows lighter on top, greyer beneath.
  float bright = clamp(lum(uAmb + uSunCol), 0.15, 1.2);
  vec3 fogCol = mix(vec3(0.70, 0.74, 0.79), vec3(0.95, 0.96, 0.97), smoothstep(0.3, 0.75, fn * 0.7 + fn2 * 0.3)) * (0.3 + bright * 0.72);
  lit = mix(lit, fogCol, fog);

  // Glow: bright little things (fireflies, eyes, snow catching the light) bloom.
  vec3 glow = vec3(0.0);
  for (int i = 0; i < 8; i++) {
    float a = float(i) * 0.785;
    vec3 c = texture2D(uColor, vUv + vec2(cos(a), sin(a)) * 1.6 / uArt).rgb;
    glow += c * smoothstep(0.75, 1.0, lum(c));
  }
  lit += glow / 8.0 * (0.12 + uNight * 0.9);

  // Grade: a touch more colour and contrast, and a soft vignette.
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
  time: number;
  /** 0 at sunrise, 0.75 at sunset, 1 at the next sunrise. */
  day: number;
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
  private light: WebGLProgram;
  private final: WebGLProgram;
  private colorTex: WebGLTexture;
  private infoTex: WebGLTexture;
  private lightTex: WebGLTexture;
  private fbo: WebGLFramebuffer;
  private lightSize = [0, 0];

  /** Throws if WebGL isn't available (the scene then draws without it). */
  constructor(readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl', { antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: false });
    if (!gl) throw new Error('no webgl');
    this.gl = gl;
    this.light = compile(gl, VERT, LIGHT);
    this.final = compile(gl, VERT, FINAL);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.colorTex = texture(gl, gl.NEAREST);
    this.infoTex = texture(gl, gl.LINEAR);
    this.lightTex = texture(gl, gl.LINEAR);
    this.fbo = gl.createFramebuffer()!;
  }

  /** The sun's direction and the light's colours for a point in the day. */
  private sky(day: number): { sun: number[]; sunCol: number[]; amb: number[]; night: number } {
    const dayLen = 0.75;
    const t = Math.min(day, dayLen) / dayLen;
    const a = t * Math.PI;
    const elev = Math.max(0.12, Math.sin(a)) * 0.95;
    // Rises in the east (right), sets in the west, across the north: shadows fall down-screen.
    const sun = [Math.cos(a) * Math.cos(elev), -Math.sin(a) * 0.6 * Math.cos(elev) - 0.2, Math.sin(elev)];
    const len = Math.hypot(sun[0], sun[1], sun[2]);
    const dir = sun.map((v) => v / len);
    const dusk = Math.max(0, 1 - Math.sin(a) * 2.2);
    const dayCol = [1.0, 0.95, 0.86];
    const duskCol = [1.0, 0.62, 0.38];
    const moonCol = [0.32, 0.4, 0.62];
    // Night fades in after sunset and out before sunrise.
    const nightW = day >= dayLen ? Math.min(1, (day - dayLen) * 40, (1 - day) * 40) : 0;
    const sunCol = blend(dayCol, duskCol, moonCol, (1 - dusk) * (1 - nightW), dusk * (1 - nightW), nightW).map((v) => v * (0.62 - nightW * 0.4));
    const amb = blend([0.46, 0.5, 0.58], [0.46, 0.4, 0.5], [0.13, 0.17, 0.32], (1 - dusk) * (1 - nightW), dusk * (1 - nightW), nightW);
    return { sun: nightW > 0.5 ? [0.3, -0.5, 0.8] : dir, sunCol, amb, night: nightW };
  }

  render(color: HTMLCanvasElement, info: Uint8Array, artW: number, artH: number, p: ShadeParams): void {
    const gl = this.gl;
    // The art and the per-pixel map data.
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.colorTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, color);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.infoTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, artW, artH, 0, gl.RGBA, gl.UNSIGNED_BYTE, info);
    // Light buffer, at art resolution.
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.lightTex);
    if (this.lightSize[0] !== artW || this.lightSize[1] !== artH) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, artW, artH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.lightTex, 0);
      this.lightSize = [artW, artH];
    }
    const sky = this.sky(p.day);
    // Pass 1: sun and shadow.
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, artW, artH);
    gl.useProgram(this.light);
    gl.uniform1i(gl.getUniformLocation(this.light, 'uInfo'), 1);
    gl.uniform2f(gl.getUniformLocation(this.light, 'uArt'), artW, artH);
    gl.uniform3fv(gl.getUniformLocation(this.light, 'uSun'), sky.sun);
    gl.uniform1f(gl.getUniformLocation(this.light, 'uZoom'), p.cam[2]);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    // Pass 2: the picture.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.final);
    const u = (n: string) => gl.getUniformLocation(this.final, n);
    gl.uniform1i(u('uColor'), 0);
    gl.uniform1i(u('uInfo'), 1);
    gl.uniform1i(u('uLight'), 2);
    gl.uniform2f(u('uArt'), artW, artH);
    gl.uniform4f(u('uCam'), p.cam[0], p.cam[1], p.cam[2], p.cam[3]);
    gl.uniform1f(u('uTime'), p.time);
    gl.uniform1f(u('uNight'), sky.night);
    gl.uniform3fv(u('uSun'), sky.sun);
    gl.uniform3fv(u('uSunCol'), sky.sunCol);
    gl.uniform3fv(u('uAmb'), sky.amb);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}
