// ─────────────────────────────────────────────────────────────────
//  design-tokens.js — PTXERO site design system
//  Single source of truth for all visual values.
//  Load this before any other script on every page.
//  It auto-applies CSS vars to :root immediately on parse.
// ─────────────────────────────────────────────────────────────────

const TOKENS = {

  // ── Color ──────────────────────────────────────────────────────
  color: {
    bg:      '#07070a',   // page background — deepest layer
    surface: '#0d0d12',   // header, elevated surfaces
    panel:   '#101015',   // cards, sidebar panels
    border:  '#1c1c24',   // subtle section borders
    b2:      '#28282f',   // stronger borders, inactive states
    acc:     '#c8f542',   // primary accent — lime green
    acc2:    '#42d4f5',   // secondary — cyan
    acc3:    '#f542a8',   // tertiary — pink
    acc4:    '#f5a542',   // quaternary — orange
    txt:     '#d8d8e0',   // primary text
    dim:     '#5a5a70',   // muted labels, secondary text
    mut:     '#2e2e38',   // very muted, disabled states
    success: '#44ff88',   // granted/success states
  },

  // ── Fonts ──────────────────────────────────────────────────────
  fonts: {
    mono:    'Share Tech Mono',   // labels, UI, code, ASCII
    display: 'Bebas Neue',        // titles, headings, hero
    body:    'DM Mono',           // prose, descriptions
    googleFontsUrl: 'https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Bebas+Neue&family=DM+Mono:wght@300;400;500&display=swap',
  },

  // ── Font sizes ─────────────────────────────────────────────────
  // Use these values — never introduce new ones without adding here
  size: {
    film:       '7px',                      // gallery film stock label
    tag:        '8px',                      // tags, badges, status
    label:      '9px',                      // section labels, buttons, nav links, meta
    handle:     '10px',                     // @handle, card desc, about handle, vtab
    ui:         '11px',                     // field values, gallery counter
    base:       '12px',                     // html/body default, about prose
    navTitle:   '20px',                     // sub-page header title
    cardTitle:  '26px',                     // project card titles
    logoHome:   '22px',                     // site logo
    composite:  '28px',                     // exposed composite score
    pageName:   'clamp(48px,8vw,80px)',     // about page name
    hero:       'clamp(42px,8vw,88px)',     // homepage PTXERO title
    scanTitle:  'clamp(48px,10vw,96px)',    // exposed scan overlay
  },

  // ── Letter spacing ─────────────────────────────────────────────
  tracking: {
    tight:   '.04em',   // captions, values
    body:    '.05em',   // hero bg, tracker keys
    sm:      '.08em',   // body text, roll notes
    ui:      '.1em',    // nav links, social tabs, viewer tabs
    badge:   '.12em',   // logo, status badges
    wide:    '.15em',   // back links, handle, counter, footer
    wider:   '.2em',    // dossier ID, about handle, film labels
    widest:  '.25em',   // section labels — most common label spacing
  },

  // ── Line height ────────────────────────────────────────────────
  leading: {
    none:   '1',     // hero titles, display, badges
    tight:  '1.5',   // captions
    roll:   '1.6',   // roll descriptions, scanner desc
    card:   '1.7',   // card descriptions
    prose:  '1.9',   // about page body text
  },

  // ── Spacing ────────────────────────────────────────────────────
  // Base unit: 4px. All values are multiples.
  space: {
    '1':   '4px',    // xs — pill vertical padding
    '2':   '8px',    // sm — input padding unit
    '3':   '12px',   // md — tab padding, card gap
    '4':   '16px',   // mobile page padding, socials bar
    '5':   '20px',   // gallery column gap, photo card margin
    '6':   '24px',   // desktop page padding X
    '7':   '32px',   // roll header top padding
    '8':   '40px',   // projects top padding, about section margin
    '9':   '48px',   // about/gallery body top padding
    '10':  '56px',   // hero bottom, exp-note margin
    '11':  '64px',   // projects/gallery section bottom
    '12':  '72px',   // hero top padding
    '13':  '80px',   // about/exposed body bottom padding
  },

  // ── Border radius ──────────────────────────────────────────────
  // Signature detail — never fully round, never sharp zero
  radius: {
    component: '2px',   // buttons, pills, tags, badges, inputs
    card:      '3px',   // project cards, dropzone
  },

  // ── Shadows ────────────────────────────────────────────────────
  // Hard geometric offset only — no soft blur shadows
  shadow: {
    offset:      '6px 6px 0 #1a1a22',   // photo frames, lightbox
    offsetColor: '#1a1a22',
  },

  // ── Transitions ────────────────────────────────────────────────
  transition: {
    default:  'all .15s',         // all hover states
    filter:   '.2s',              // photo brightness hover
    collapse: 'max-height .35s ease',   // roll collapse/expand
    scan:     '.7s ease-out',     // gallery scan line
    overlay:  'opacity .8s ease', // scan overlay fade
  },

  // ── Layout ─────────────────────────────────────────────────────
  layout: {
    headerHeight:   '44px',     // identical on every page — never change
    pagePaddingX:   '24px',     // desktop
    pagePaddingXSm: '14px',     // mobile ≤480px / ≤600px
    maxWidth: {
      content:  '720px',    // about
      tool:     '860px',    // exposed/tool pages
      standard: '1100px',   // homepage, socials bar
      gallery:  '1400px',   // gallery grid
    },
  },

  // ── Z-index ────────────────────────────────────────────────────
  z: {
    canvas:    1,    // homepage physics canvas (behind everything)
    content:   2,    // header, main, socials-bar, footer
    asciiHdr:  20,   // ascii-render header
    pageHdr:   50,   // all sub-page sticky headers
    scanOverlay:100, // exposed scan overlay
    lightbox:  200,  // gallery lightbox
  },

  // ── Breakpoints ────────────────────────────────────────────────
  bp: {
    mobile:  '480px',   // homepage
    mobileL: '600px',   // gallery, exposed
    tablet:  '900px',   // gallery 2-column
  },

};

// ── Apply to :root immediately ─────────────────────────────────
(function(){
  const r = document.documentElement;
  const c = TOKENS.color, f = TOKENS.fonts;
  [
    ['--bg',      c.bg],
    ['--surface', c.surface],
    ['--panel',   c.panel],
    ['--border',  c.border],
    ['--b2',      c.b2],
    ['--acc',     c.acc],
    ['--acc2',    c.acc2],
    ['--acc3',    c.acc3],
    ['--acc4',    c.acc4],
    ['--txt',     c.txt],
    ['--dim',     c.dim],
    ['--mut',     c.mut],
    ['--fmono',   `'${f.mono}',monospace`],
    ['--fdisp',   `'${f.display}',sans-serif`],
    ['--fbody',   `'${f.body}',monospace`],
    ['--header-h',  TOKENS.layout.headerHeight],
    ['--page-px',   TOKENS.layout.pagePaddingX],
    ['--radius',    TOKENS.radius.component],
    ['--radius-card',TOKENS.radius.card],
    ['--shadow',    TOKENS.shadow.offset],
    ['--transition',TOKENS.transition.default],
  ].forEach(([k,v]) => r.style.setProperty(k,v));
})();
