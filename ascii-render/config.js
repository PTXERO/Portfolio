// ─────────────────────────────────────────────────────────────────
//  ASCII//RENDER — Configuration
//  Edit this file to customise the app without touching app code.
// ─────────────────────────────────────────────────────────────────

const CONFIG = {

  // ── Identity ────────────────────────────────────────────────────
  version:     '8.1',
  title:       'ASCII//RENDER',
  filename:    'ascii-render',   // default export filename prefix

  // ── UI Theme (CSS custom properties) ───────────────────────────
  theme: {
    bg:      '#07070a',   // page background
    surface: '#0d0d12',   // header / elevated surfaces
    panel:   '#101015',   // sidebar panels
    border:  '#1c1c24',   // subtle borders
    b2:      '#28282f',   // stronger borders / inactive elements
    acc:     '#c8f542',   // primary accent — lime green
    acc2:    '#42d4f5',   // secondary accent — cyan
    acc3:    '#f542a8',   // tertiary accent — pink
    acc4:    '#f5a542',   // quaternary accent — orange
    txt:     '#d8d8e0',   // primary text
    dim:     '#5a5a70',   // muted / label text
    mut:     '#2e2e38',   // very muted elements
  },

  // ── Typography ──────────────────────────────────────────────────
  fonts: {
    mono:    'Share Tech Mono',  // monospace — used for ASCII output labels, inputs
    display: 'Bebas Neue',       // display — logo, headings
    body:    'DM Mono',          // body — sidebar text
    // Extra monospace fonts available in the render font selector
    // (loaded from Google Fonts at runtime)
    extraMono: ['IBM+Plex+Mono', 'Fira+Code', 'JetBrains+Mono'],
  },

  // ── Sidebar ─────────────────────────────────────────────────────
  sidebar: {
    defaultWidth: 262,   // px
    minWidth:     160,   // px — drag resize minimum
    maxWidth:     520,   // px — drag resize maximum
  },

  // ── Render Defaults ─────────────────────────────────────────────
  defaults: {
    charset:     'dense',
    colorMode:   'char',
    bothMode:    'invert',
    bgStyle:     'black',
    bgColor:     '#07070a',
    bgInverted:  false,
    renderFont:  'Share Tech Mono',
    blockSize:   20,
    fontSize:    20,
    scale:       1,
    cellMode:    'fit',
    arLocked:    true,
    bfLocked:    true,
    invertThr:   150,   // char vs bg brightness threshold (0-255)
    ditherMode:  'none',
    palMode:     'average',
    hexColors:   ['#ff4444', '#44ff88', '#4488ff'],
    targetColors:['#ff0000'],
    outline: {
      enabled: false,
      style:   'solid',
      width:   2,
      color:   '#c8f542',
    },
    pp: {
      exposure:   0,
      contrast:   0,
      highlights: 0,
      shadows:    0,
      whites:     0,
      blacks:     0,
      saturation: 0,
      vibrance:   0,
      temp:       0,
      tint:       0,
      sharpness:  0,
      clarity:    0,
    },
  },

  // ── Region Defaults ─────────────────────────────────────────────
  region: {
    default:        'all',
    leniency:       30,   // 0–100
    edgeThresh:     20,   // 1–100
    hueTolerance:   30,   // degrees, 1–180
    subjectPadding: 10,   // % around detected box
    subjectConf:    50,   // % minimum detection confidence
    brushSize:      20,   // px
  },

  // ── Performance / Memory Limits ─────────────────────────────────
  perf: {
    memLimit:   true,
    maxMp:      8,     // max source megapixels before downsampling
    maxOut:     4000,  // max output canvas dimension in px
    chunked:    true,
    chunkRows:  6,     // rows rendered per animation frame
    watchdog:   true,
    wdogSec:    60,    // render timeout in seconds
    autoRender: true,
    maxUndo:    40,    // undo history depth
    videoFps:   24,    // default video render FPS
  },

  // ── External URLs ───────────────────────────────────────────────
  // Update CDN versions here — also update the script tags in index.html
  urls: {
    corsProxy:      'https://corsproxy.io/?',
    googleFonts:    'https://fonts.googleapis.com/css2?family=',
    gifWorker:      'https://cdn.jsdelivr.net/npm/gif.js@0.2.0/dist/gif.worker.js',
  },

};
