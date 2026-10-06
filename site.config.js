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

  // ── Projects ────────────────────────────────────────────────────
  // status: 'live' | 'wip' | 'soon'
  projects: [
    {
      id:     'about',
      title:  'ABOUT',
      desc:   'Who I am, what I shoot, and what I use.',
      tags:   ['photography', 'tools', 'contact'],
      url:    './about/',
      status: 'live',
    },
    {
      id:     'gallery',
      title:  'GALLERY',
      desc:   'Image gallery of my photography',
      tags:   ['flickr', 'photography', 'film'],
      url:    './gallery/',
      status: 'live',
    },
    {
      id:     'ascii-render',
      title:  'ASCII//RENDER',
      sub:    'v8.1',
      desc:   'Converts images, GIFs and video into ASCII art. Color modes, region masking, brush tool, GIF + WebM export. !!Not Mobile Friendly!!',
      tags:   ['image', 'video', 'ascii'],
      url:    './ascii-render/',
      status: 'wip',
    },
    {
      id:     'reel-vault',
      title:  'REEL//VAULT',
      sub:    'v2.0',
      desc:   'Self-learning video finder. Type a topic, it searches X, YouTube, Mastodon, Reddit and any site you add, then learns from your 👍/👎. Phone-first.',
      tags:   ['video', 'search', 'ml', 'python'],
      url:    './reel-vault/',
      status: 'wip',
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
  socials: [
    //{ label: 'Placeholder',    icon: '⌥', url: 'https://placeholder' },
    { label: 'Instagram', icon: '◎', url: 'https://instagram.com/PTXERO' },
    { label: 'Flickr',     icon: '⛶', url: 'https://www.flickr.com/people/198130461@N06/' },
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
