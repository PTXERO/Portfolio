// Every sprite in the game is a grid of palette letters. These are placeholders
// in the final palette, to be replaced by hand-drawn art without code changes:
// same names, any size.

export const PAL: Record<string, string> = {
  k: '#10141f', // ink, outlines
  w: '#f2ead7', // cream
  y: '#f5c45e', // gold (nutrients)
  Y: '#c08a2e',
  g: '#7fe0b0', // mint (DNA, cells)
  G: '#3f9c7e',
  n: '#2a6e63', // deep teal
  p: '#e68ab8', // pink (RNA)
  P: '#a2507f',
  b: '#8fd3f0', // bubble
  B: '#4c8fb3',
  o: '#f2906c', // creature orange
  O: '#c4613f',
  s: '#d8c08a', // sand
  S: '#b99f69',
  r: '#56636c', // rock
  R: '#75848d',
  l: '#5fbf78', // leaf
  L: '#2f8a5a',
};

export const SPRITES = {
  // Currencies
  nutrient: ['...kkk....', '..kyyyk...', '.kyywyyk..', 'kyywyyyYk.', 'kywyyyyYk.', 'kyyyyyYYk.', 'kYyyyYYYk.', '.kYYYYYk..', '..kkkkk...', '..........'],
  dna: ['kk....kk..', 'kgk..kpk..', '.kgwwwpk..', '..kgkpk...', '...kgpk...', '...kpgk...', '..kpkgk...', '.kpwwwgk..', 'kpk..kgk..', 'kk....kk..'],

  // Soup generators
  amino: ['..........', '..y...y...', '.yYy.yYy..', '..y...y...', '....y.....', '...yYy..y.', '....y..yYy', '.y......y.', 'yYy.......', '.y........'],
  lipid: ['...bbbb...', '..b....b..', '.b..ww..b.', '.b.w....b.', '.b......b.', '.b......b.', '.b......B.', '..b....B..', '...BBBB...', '..........'],
  rna: ['..........', '.pp....pp.', 'p..p..p..p', '....pp....', '..........', '.PP....PP.', 'P..P..P..P', '....PP....', '..........', '..........'],
  protocell: ['..gggggg..', '.gGGGGGGg.', 'gGGGGGGGGg', 'gGGnnGGGGg', 'gGGnnGGGGg', 'gGGGGGGwGg', 'gGGGGGGGGg', '.gGGGGGGg.', '..gggggg..', '..........'],

  // Cell generators
  fission: ['..........', '.ggg..ggg.', 'gGGGggGGGg', 'gGnGggGnGg', 'gGGGggGGGg', '.ggg..ggg.', '..........', '..........', '..........', '..........'],
  colony: ['...ggg....', '..gGnGg...', '..gGGGgggg', '.ggggggGng', 'gGnGgggGGg', 'gGGGg.gggg', '.ggg......', '....ggg...', '...gGnGg..', '....ggg...'],
  biofilm: ['..........', '..........', '..........', '..gglgg...', '.glLLLlgg.', 'lLLLLLLLlg', 'rrrrrrrrrr', 'rRRrrrRRrr', 'rrrrRrrrrr', 'rrrrrrrrrr'],
  mat: ['..........', '..........', 'llllllllll', 'LLLLLLLLLL', 'gggggggggg', 'GGGGGGGGGG', 'llllllllll', 'LLLLLLLLLL', 'ssssssssss', 'SSSSSSSSSS'],
  stromatolite: ['...llll...', '..lLLLLl..', '..rRRRRr..', '..rrrrrr..', '.lLLLLLLl.', '.rRRRRRRr.', '.rrrrrrrr.', 'lLLLLLLLLl', 'rRRRRRRRRr', 'rrrrrrrrrr'],

  // Interface
  spark: ['...y....', '...y....', '..yyy...', 'yyywyyy.', '..yyy...', '...y....', '...y....', '........'],
  hourglass: ['bbbbbbb.', '.bwwwb..', '..bwb...', '...b....', '..byb...', '.byyyb..', 'bbbbbbb.', '........'],
  sprout: ['...ll...', '..lLLl..', '.l.L..l.', '...L.ll.', '...LlL..', '...L....', '..sSs...', '.sSSSs..'],
  menu: ['........', 'wwwwwww.', '........', 'wwwwwww.', '........', 'wwwwwww.', '........', '........'],
  flask: ['..www...', '...b....', '...b....', '..bbb...', '.bgggb..', 'bggwggb.', 'bgggggb.', '.bbbbb..'],
  flame: ['...o....', '..oo....', '..oyo...', '.oyyo.o.', '.oyyyoo.', 'oyywyyo.', 'oyyyyyo.', '.oOOOo..'],
  sun: ['...y....', '.y.y.y..', '..yyy...', 'yyywyyy.', '..yyy...', '.y.y.y..', '...y....', '........'],
  bolt: ['....yy..', '...yy...', '..yy....', '.yyyyy..', '...yy...', '..yy....', '.yy.....', 'y.......'],
  lock: ['..RRR...', '.R...R..', '.R...R..', 'RRRRRRR.', 'RrrrrrR.', 'RrrkrrR.', 'RrrrrrR.', 'RRRRRRR.'],
  unknown: ['..wwww....', '.w....w...', '......w...', '.....w....', '....w.....', '....w.....', '..........', '....w.....', '..........', '..........'],

  // Scene sprites
  bubble: ['.bbb.', 'bw..b', 'b...b', 'b...B', '.BBB.'],
  rnaA: ['pp...', '..p.p', '...p.'],
  rnaB: ['...pp', 'p.p..', '.p...'],
  cell: ['..ggggg..', '.gGGGGGg.', 'gGGGGnnGg', 'gGGGGnnGg', 'gGGGGGGGg', '.gGGGGGg.', '..ggggg..'],
  cellSquish: ['.........', '.ggggggg.', 'gGGGGnnGg', 'gGGGGnnGg', 'gGGGGGGGg', '.ggggggg.', '.........'],
  cellStretch: ['..ggggggg..', '.gGGGGGGGg.', 'gGnnGGGnnGg', 'gGnnGGGnnGg', 'gGGGGGGGGGg', '.gGGGGGGGg.', '..ggggggg..'],
  cellPinch: ['..ggg...ggg..', '.gGGGg.gGGGg.', 'gGnnGGgGGnnGg', 'gGnnGGgGGnnGg', 'gGGGGGgGGGGGg', '.gGGGg.gGGGg.', '..ggg...ggg..'],
  sparkA: ['..w..', '..y..', 'wyYyw', '..y..', '..w..'],
  sparkB: ['.....', '..w..', '.wyw.', '..w..', '.....'],
  tailA: ['...g', '.gg.', 'g...'],
  tailB: ['g...', '.gg.', '...g'],
  protoSmall: ['.ggg.', 'gGnGg', 'gGGGg', '.ggg.'],
  peptide: ['..........', '..........', '.yy....yy.', 'yYyy..yyYy', '...yyyy...', '..........', '.yy....yy.', 'yYyy..yyYy', '...yyyy...', '..........'],
  sugar: ['...wwww...', '..w....w..', '.w.wwww.w.', '.w.w..w.w.', '.w.w..w.w.', '.w.wwww.w.', '..w....w..', '...wwww...', '..........', '..........'],
  nucleotide: ['..........', '...pppp...', '..pPPPPp..', '..pP..Pp..', '..pPPPPp..', '...pppp...', '....bb....', '....bb....', '...bbbb...', '..........'],
  peptideSmall: ['yy.yy', '.yy.y'],
  plusOne: ['.....w.', '.w..ww.', 'www..w.', '.w...w.', '....www'],
  sugarSmall: ['.ww.', 'w..w', '.ww.'],
  nucleoSmall: ['.pp.', 'pPPp', '.bb.'],
} satisfies Record<string, string[]>;

export type SpriteName = keyof typeof SPRITES;

export interface Baked {
  right: HTMLCanvasElement;
  left: HTMLCanvasElement;
  w: number;
  h: number;
}

const cache = new Map<SpriteName, Baked>();

function paint(rows: string[], flip: boolean): HTMLCanvasElement {
  const h = rows.length;
  const w = rows[0].length;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  rows.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (ch === '.') return;
      ctx.fillStyle = PAL[ch];
      ctx.fillRect(flip ? w - 1 - x : x, y, 1, 1);
    }),
  );
  return c;
}

export function baked(name: SpriteName): Baked {
  let b = cache.get(name);
  if (!b) {
    const rows = SPRITES[name];
    b = { right: paint(rows, false), left: paint(rows, true), w: rows[0].length, h: rows.length };
    cache.set(name, b);
  }
  return b;
}

/** Draws a sprite centred on (x, y) in art pixels. */
export function blit(ctx: CanvasRenderingContext2D, name: SpriteName, x: number, y: number, facingLeft = false): void {
  const s = baked(name);
  ctx.drawImage(facingLeft ? s.left : s.right, Math.round(x - s.w / 2), Math.round(y - s.h / 2));
}

const urls = new Map<SpriteName, string>();

/** A sprite as an image URL, for use in the HTML interface. */
export function spriteUrl(name: SpriteName): string {
  let u = urls.get(name);
  if (!u) {
    u = baked(name).right.toDataURL();
    urls.set(name, u);
  }
  return u;
}

/** An <img> tag for a sprite at a whole-number scale, with hard pixel edges. */
export function icon(name: SpriteName, scale = 3, cls = 'px-icon'): string {
  const s = baked(name);
  return `<img class="${cls}" src="${spriteUrl(name)}" width="${s.w * scale}" height="${s.h * scale}" alt="" draggable="false">`;
}
