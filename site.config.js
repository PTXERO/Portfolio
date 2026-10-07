// ─────────────────────────────────────────────────────────────────
//  Site Homepage — Configuration
// ─────────────────────────────────────────────────────────────────

const SITE = {

  // ── Identity ────────────────────────────────────────────────────
  handle:   'PTXERO',          // displayed in header
  tagline:  'PROJECTS, TOOLS, AND EXPERIMENTS',

  // ── UI Theme ────────────────────────────────────────────────────
  // Shared with the ASCII//RENDER sub-app for visual consistency.
  theme: {
    bg:      '#07070a',
    surface: '#0d0d12',
    panel:   '#101015',
    border:  '#1c1c24',
    b2:      '#28282f',
    acc:     '#c8f542',   // primary accent
    acc2:    '#42d4f5',
    acc3:    '#f542a8',
    acc4:    '#f5a542',
    txt:     '#d8d8e0',
    dim:     '#5a5a70',
    mut:     '#2e2e38',
  },

  // ── Typography ──────────────────────────────────────────────────
  fonts: {
    mono:    'Share Tech Mono',
    display: 'Bebas Neue',
    body:    'DM Mono',
  },

  // ── Live status endpoint ────────────────────────────────────────
  // Cloudflare Worker (edge-cached ~30 min). Projects with status:'auto'
  // get their operational badge (LIVE / PARTIAL / DOWN) from this at load.
  statusUrl: 'https://share.ptxero.net/status',

  // ── Projects ────────────────────────────────────────────────────
  // status: 'live' | 'wip' | 'soon' | 'auto' (auto → resolved from statusUrl)
  projects: [
    {
      id:     'hub',
      title:  'PTXERO//HUB',
      sub:    'v2.0',
      desc:   'Data storage options and onboarding',
      tags:   [],
      url:    './hub/',
      status: 'live',
    },
    {
      id:     'ascii-render',
      title:  'ASCII//RENDER',
      sub:    'v8.1',
      desc:   'ASCII and UNICODE rendering engine',
      tags:   [],
      url:    './ascii-render/',
      status: 'auto',
    },
    {
      id:     'rf',
      title:  'RF',
      desc:   'Radio transmission simulation and calling',
      tags:   [],
      url:    './rf/',
      status: 'auto',
    },
    {
      id:     'social',
      title:  'PTXERO//SOCIAL',
      desc:   'Submit something',
      tags:   [],
      url:    './social.html',
      status: 'live',
    },
    {
      id:     'searchnet',
      title:  'SEARCH//NET',
      sub:    'v3.0',
      desc:   'Data harvesting and investigation',
      tags:   [],
      url:    './searchnet/',
      status: 'live',
    },
    // hidden for now (set hidden:false to bring back)
    {
      id:     'about',
      title:  'ABOUT',
      desc:   'Who I am, what I shoot.',
      tags:   ['photography', 'contact'],
      url:    './about/',
      status: 'live',
      hidden: true,
    },
    {
      id:     'gallery',
      title:  'GALLERY',
      desc:   'Image gallery of my photography',
      tags:   ['photography', 'film'],
      url:    './gallery/',
      status: 'live',
      hidden: true,
    },
    // Project Template:
    // {
    //   id:     'my-project',
    //   title:  'MY//PROJECT',
    //   sub:    'v1.0',
    //   desc:   'Short description of what it does.',
    //   tags:   ['tag1', 'tag2'],
    //   url:    './my-project/',
    //   status: 'wip',
    // },
  ],

  // ── Social Links ────────────────────────────────────────────────
  // icon: any single emoji or short string
  // Set url to null to hide a link.
  // Empty = the Socials bar is hidden.
  socials: [
    //{ label: 'Placeholder',    icon: '⌥', url: 'https://placeholder' },
  ],

  // ── Footer ──────────────────────────────────────────────────────
  //footer: '░▒▓ on neocities',

// ── Hero Background Animation ────────────────────────────────
  heroBg: {
    // Characters scattered as noise throughout the columns
    glyphs:    '░▒▓│─╔╗╚╝╠╬█▌▐·',
    // Characters from your handle mixed in at random
    highlight: 'PTXERO',
    // Probability (0–1) that any cell uses a highlight char vs a glyph
    highlightChance: 0.18,
    // Scroll speed in px per frame (higher = faster)
    speed:     0.8,
    // Column width in px
    colWidth:  14,
    // Row height in px
    rowHeight: 18,
    // Color of the characters (defaults to --border CSS var if null)
    color:     null,
  },

// ── Click words (physics) ────────────────────────────────────
  clickWords: [
    'EDAMAME','BURGER','STEAK','ELOTE','CHICKEN', 'LOBSTER',
    'PIEROGI','SCRAPPLE','APPLE','RICE','SUSHI', 'CRAB',
    'RAMEN', 'PHO', 'ICE CREAM', 'EGG', 'CHEESE', 'CEREAL',
    'CHICKEN PARM', 'MAC AND CHEESE','CHOCOLATE','WINE',
    'POPCORN','POPSICLE','JUMEX','SWEET TEA','COTTAGE CHEESE',
    'SWEET POTATO'
  ],

};
