// What the spear teaches: a web of ideas, grown out from the waking mind at its centre. Six
// branches (Fire, Stone, Sea, Earth, Kin, Mind), each a path of small ideas to a great one
// (a notable) and out to a keystone: strong, with a cost. Ideas are learned one at a time, each
// next to one already known, for insight; the outer ring links the branches, so paths can cross
// over. There's far more than one run can afford: the path taken is how that run is played.

import type { Diet, JobId } from './extinction';

export type NodeKind = 'start' | 'minor' | 'notable' | 'keystone';
export type BranchId = 'fire' | 'stone' | 'sea' | 'earth' | 'kin' | 'mind';

/** What an idea does. Gathering bonuses add up per job (0.1 is +10%) and multiply the work. */
export interface Fx {
  gather?: Partial<Record<JobId | 'all', number>>;
  /** Meals count for this much more (fire, cooking). */
  meal?: number;
  /** Meat kept overnight: added to the share that doesn't rot (and the same for plants). */
  meatKeep?: number;
  plantKeep?: number;
  /** Hunger off each night: for everyone, and more for those resting. */
  night?: number;
  rest?: number;
  /** Hunger they can bear before dying: everyone, and the frail, old and young. */
  limit?: number;
  weak?: number;
  /** How far roots and fish stretch (their daily limits), and the ash coming back. */
  digCap?: number;
  fishCap?: number;
  ashRegrow?: number;
  /** A job it opens. */
  unlock?: JobId;
  /** Trait bonuses to all work. */
  keen?: number;
  strong?: number;
  others?: number;
  /** Extra hunger each night for those listening to the spear. */
  listenHunger?: number;
  /** Short meals count for more (when rations are less than full). */
  ration?: number;
  /** Workers eat before the resting; workers bear more, the resting less. */
  strongFirst?: boolean;
}

export interface MindNode {
  id: string;
  name: string;
  kind: NodeKind;
  branch: BranchId | null;
  does: string;
  fx: Fx;
  /** Where it sits in the web (units, centre 0,0). */
  x: number;
  y: number;
  links: string[];
}

export const NODE_COST: Record<NodeKind, number> = { start: 0, minor: 3, notable: 6, keystone: 10 };
/** Each idea known makes the next cost this much more (the further in, the harder). */
export const COST_STEP = 0.5;
/** The ideas the raft can't be built without: rope to lash it, hollowing for its hull. */
export const RAFT_IDEAS = ['rope', 'hollow'];

export const BRANCHES: { id: BranchId; name: string; angle: number }[] = [
  { id: 'fire', name: 'Fire', angle: -90 },
  { id: 'stone', name: 'Stone', angle: -30 },
  { id: 'sea', name: 'Sea', angle: 30 },
  { id: 'earth', name: 'Earth', angle: 90 },
  { id: 'kin', name: 'Kin', angle: 150 },
  { id: 'mind', name: 'Mind', angle: 210 },
];

type Leaf = { id: string; name: string; does: string; fx: Fx };
type Twelve = [Leaf, Leaf, Leaf, Leaf, Leaf, Leaf, Leaf, Leaf, Leaf, Leaf, Leaf, Leaf];
const L = (id: string, name: string, does: string, fx: Fx): Leaf => ({ id, name, does, fx });
/**
 * Each branch, out from the middle: a first small idea and a great one; then it forks, each
 * side a path of small ideas, one side to two more great ideas, the other to the keystone. In
 * order: first, great; left 1, right 1; left 2, right 2; great (left), right 3; left 4, right 4;
 * great (left), keystone (right).
 */
const PATHS: Record<BranchId, Twelve> = {
  fire: [
    L('warmth', 'Warmth', 'Huddled close, nights cost a little less hunger.', { night: 0.03 }),
    L('fire', 'Fire', 'Cooked food goes a little further: meals +15%.', { meal: 0.15 }),
    L('smoke', 'Smoke', 'Meat hung in the smoke keeps a little longer.', { meatKeep: 0.06 }),
    L('hearth', 'Hearth stones', 'Those resting by the fire get a little less hungry.', { rest: 0.06 }),
    L('embers', 'Slow coals', 'Food cooked slow over coals: meals +4%.', { meal: 0.04 }),
    L('pits', 'Roasting pits', 'Food baked in the ground: meals +5%.', { meal: 0.05 }),
    L('racks', 'Drying racks', 'Dried meat keeps for days instead of rotting overnight.', { meatKeep: 0.18 }),
    L('firewatch', 'Fire-watch', 'Someone always keeps the fire: nights are a little kinder.', { night: 0.03 }),
    L('charcoal', 'Charcoal', 'Fire-hardened edges: wood cutting +8%.', { gather: { wood: 0.08 } }),
    L('torches', 'Torches', 'They work on past dusk by torchlight: all work +3%.', { gather: { all: 0.03 } }),
    L('hollow', 'Hollowing', 'Burn a log, scrape out the char, burn again: logs hollowed into hulls. The raft can have one. Raft work +10%.', { gather: { build: 0.1 } }),
    L('cookall', 'Cook everything', 'Meals go further still (+12%), but all the cooking slows the work (−10%).', { meal: 0.12, gather: { all: -0.1 } }),
  ],
  stone: [
    L('edges', 'Sharp edges', 'Scavenging +5%.', { gather: { scavenge: 0.05 } }),
    L('tools', 'Stone tools', 'Foraging, scavenging and digging +20%.', { gather: { forage: 0.2, scavenge: 0.2, dig: 0.2 } }),
    L('knapping', 'Knapping', 'All work +4%.', { gather: { all: 0.04 } }),
    L('scrapers', 'Scrapers', 'Scavenging +6%.', { gather: { scavenge: 0.06 } }),
    L('flint', 'Flint axes', 'Wood cutting +8%.', { gather: { wood: 0.08 } }),
    L('hammers', 'Hammerstones', 'Digging +6%.', { gather: { dig: 0.06 } }),
    L('butcher', 'Butchering', 'Nothing on a carcass wasted: scavenging +15%.', { gather: { scavenge: 0.15 } }),
    L('grinders', 'Grindstones', 'Foraging +8%.', { gather: { forage: 0.08 } }),
    L('blades', 'Blades', 'All work +3%.', { gather: { all: 0.03 } }),
    L('bars', 'Digging bars', 'Digging +8%.', { gather: { dig: 0.08 } }),
    L('axes', 'Hafted axes', 'A stone head bound to a handle: wood cutting +20%, raft work +10%.', { gather: { wood: 0.2, build: 0.1 } }),
    L('mightmakes', 'Strength above all', 'The Strong work 35% harder; everyone else works 12% less.', { strong: 0.35, others: -0.12 }),
  ],
  sea: [
    L('watch', 'Watch the water', 'Fishing +5%.', { gather: { fish: 0.05 } }),
    L('line', 'Fishing line', 'Fish the shore: meat that keeps coming.', { unlock: 'fish' }),
    L('bait', 'Bait', 'Fishing +8%, and the shore holds 10% more lines.', { gather: { fish: 0.08 }, fishCap: 0.1 }),
    L('pools', 'Tide-pool lore', 'Fishing +5%.', { gather: { fish: 0.05 } }),
    L('deeper', 'Deeper water', 'The shore holds 20% more lines.', { fishCap: 0.2 }),
    L('driftwood', 'Driftwood', 'The sea brings wood up the beach: wood cutting +10%.', { gather: { wood: 0.1 } }),
    L('nets', 'Nets', 'Fishing +10%, and the shore holds 35% more.', { gather: { fish: 0.1 }, fishCap: 0.35 }),
    L('weirs', 'Stone weirs', 'The shore holds 12% more.', { fishCap: 0.12 }),
    L('hooks', 'Bone hooks', 'Fishing +6%.', { gather: { fish: 0.06 } }),
    L('currents', 'Read the currents', 'They know which way the sea runs: raft work +8%.', { gather: { build: 0.08 } }),
    L('traps', 'Fish traps', 'The shore holds 25% more.', { fishCap: 0.25 }),
    L('tides', 'Read the tides', 'Fishing +35%, and the shore holds 30% more; foraging and digging 25% worse.', { gather: { fish: 0.35, forage: -0.25, dig: -0.25 }, fishCap: 0.3 }),
  ],
  earth: [
    L('green', 'Know the green', 'Foraging +5%.', { gather: { forage: 0.05 } }),
    L('stick', 'Digging stick', 'Dig for roots: plants that keep coming.', { unlock: 'dig' }),
    L('rootlore', 'Root lore', 'Digging +8%, and roots stretch 8% further.', { gather: { dig: 0.08 }, digCap: 0.08 }),
    L('seeds', 'Seed keeping', 'A little of the ash grows back each day.', { ashRegrow: 0.005 }),
    L('tubers', 'Tubers', 'Roots stretch 15% further.', { digCap: 0.15 }),
    L('bark', 'Bark stripping', 'Wood cutting +6%.', { gather: { wood: 0.06 } }),
    L('deeproots', 'Deep roots', 'Roots stretch 35% further.', { digCap: 0.35 }),
    L('fibre', 'Root fibre', 'Raft work +5%.', { gather: { build: 0.05 } }),
    L('mulch', 'Mulch', 'A little more of the ash grows back each day.', { ashRegrow: 0.005 }),
    L('twine', 'Twine', 'Raft work +5%.', { gather: { build: 0.05 } }),
    L('rope', 'Rope', 'Root fibre and bark twisted into cord that holds wet: the raft can be lashed together.', {}),
    L('tend', 'Tend the ash', 'The ash grows back faster (+1.5% a day), and roots stretch 20% further; scavenging 25% worse.', { ashRegrow: 0.015, digCap: 0.2, gather: { scavenge: -0.25 } }),
  ],
  kin: [
    L('huddle', 'Huddle', 'Nights cost a little less hunger.', { night: 0.03 }),
    L('care', 'Care for the weak', 'The frail, old and young last longer starving.', { weak: 0.3 }),
    L('sleepclose', 'Sleep close', 'Those resting get a little less hungry.', { rest: 0.05 }),
    L('songs', 'Work songs', 'All work +3%.', { gather: { all: 0.03 } }),
    L('tough', 'Tough it out', 'Everyone lasts a little longer starving.', { limit: 0.12 }),
    L('mourning', 'Mourning', 'The dead named and sung for: everyone lasts a little longer.', { limit: 0.05 }),
    L('rationing', 'Rationing', 'Short rations count for 10% more.', { ration: 0.1 }),
    L('nightwatch', 'Night watch', 'Nights are a little kinder.', { night: 0.02 }),
    L('elders', 'Heed the old', 'Insight +8%.', { gather: { listen: 0.08 } }),
    L('kinship', 'Kinship', 'All work +3%.', { gather: { all: 0.03 } }),
    L('shelters', 'Lean-tos', 'Shelter from the ash: nights kinder, and everyone lasts a little longer.', { night: 0.05, limit: 0.1 }),
    L('strongfirst', 'The strong eat first', 'Workers eat first and last longer; the resting eat last and starve sooner.', { strongFirst: true }),
  ],
  mind: [
    L('stillness', 'Stillness', 'Insight +8%.', { gather: { listen: 0.08 } }),
    L('memory', 'Memory', 'Insight +15%.', { gather: { listen: 0.15 } }),
    L('dreams', 'Dreams', 'Insight +8%.', { gather: { listen: 0.08 } }),
    L('counting', 'Counting', 'All work +2%.', { gather: { all: 0.02 } }),
    L('ears', 'Keen ears', 'The keen work 15% harder at everything.', { keen: 0.15 }),
    L('stars', 'Read the stars', 'Raft work +5%.', { gather: { build: 0.05 } }),
    L('teaching', 'Teaching', 'All work +6%.', { gather: { all: 0.06 } }),
    L('patience', 'Patience', 'Everyone lasts a little longer starving.', { limit: 0.05 }),
    L('visions', 'Visions', 'Insight +10%.', { gather: { listen: 0.1 } }),
    L('plans', 'Planning', 'Raft work +8%.', { gather: { build: 0.08 } }),
    L('speech', 'Shared words', 'All work +5%.', { gather: { all: 0.05 } }),
    L('voices', 'Voices', 'Insight much greater (+60%), but those listening get hungrier each night.', { gather: { listen: 0.6 }, listenHunger: 0.25 }),
  ],
};

/** Ring radii (web units, out from the middle). */
const R = [0, 15, 28, 41, 54, 67, 80, 93];
const polar = (deg: number, r: number) => ({ x: Math.cos((deg * Math.PI) / 180) * r, y: Math.sin((deg * Math.PI) / 180) * r });

function build(): MindNode[] {
  const out: MindNode[] = [{ id: 'mind0', name: 'Awake', kind: 'start', branch: null, does: 'The spear touched it, and it knew that it was.', fx: {}, x: 0, y: 0, links: [] }];
  const add = (b: BranchId, leaf: Leaf, kind: NodeKind, deg: number, r: number, from: string) => {
    out.push({ ...leaf, kind, branch: b, ...polar(deg, r), links: [from] });
    out.find((n) => n.id === from)!.links.push(leaf.id);
  };
  for (const br of BRANCHES) {
    const [m1, n1, l1, r1, l2, r2, n2, r3, l4, r4, n3, k] = PATHS[br.id];
    const a = br.angle;
    add(br.id, m1, 'minor', a, R[1], 'mind0');
    add(br.id, n1, 'notable', a, R[2], m1.id);
    add(br.id, l1, 'minor', a - 9, R[3], n1.id);
    add(br.id, r1, 'minor', a + 9, R[3], n1.id);
    add(br.id, l2, 'minor', a - 11, R[4], l1.id);
    add(br.id, r2, 'minor', a + 11, R[4], r1.id);
    add(br.id, n2, 'notable', a - 12, R[5], l2.id);
    add(br.id, r3, 'minor', a + 12, R[5], r2.id);
    add(br.id, l4, 'minor', a - 13, R[6], n2.id);
    add(br.id, r4, 'minor', a + 13, R[6], r3.id);
    add(br.id, n3, 'notable', a - 12, R[7], l4.id);
    add(br.id, k, 'keystone', a + 14, R[7] + 3, r4.id);
  }
  // Rings across: each branch's right side reaches the next branch's left, twice over.
  BRANCHES.forEach((br, i) => {
    const next = BRANCHES[(i + 1) % BRANCHES.length];
    for (const [mine, theirs] of [[5, 4], [9, 8]]) {
      const a = out.find((n) => n.id === PATHS[br.id][mine].id)!;
      const b = out.find((n) => n.id === PATHS[next.id][theirs].id)!;
      a.links.push(b.id);
      b.links.push(a.id);
    }
  });
  return out;
}

export const MIND_TREE: MindNode[] = build();
export const MIND_NODE: Record<string, MindNode> = Object.fromEntries(MIND_TREE.map((n) => [n.id, n]));

/**
 * The web as each diet hears it: the same shape, but ideas for food a line can't eat become
 * ideas for food it can. Plant-eaters gather kelp where others fish, and pick fallen fruit where
 * others butcher; meat-eaters set snares where others dig roots, and grub in the ash.
 */
const PLANT_EATERS: Record<string, Partial<Leaf>> = {
  smoke: { name: 'Roast roots', does: 'Roasted, roots and seeds go further: meals +5%.', fx: { meal: 0.05 } },
  racks: { name: 'Seed cakes', does: 'Pressed and dried, plants keep almost for good, and meals go 5% further.', fx: { plantKeep: 0.04, meal: 0.05 } },
  edges: { name: 'Fruit sense', does: 'Gathering fallen fruit +5%.' },
  tools: { name: 'Stone tools', does: 'Foraging, fruit gathering and digging +20%.' },
  scrapers: { name: 'Husking stones', does: 'Gathering fallen fruit +6%.' },
  butcher: { name: 'Pick clean', does: 'Nothing on a branch wasted: fruit gathering +15%.' },
  watch: { name: 'Kelp lore', does: 'Kelp gathering +5%.' },
  line: { name: 'Kelp knife', does: 'Gather kelp from the shallows: plants that keep coming.' },
  bait: { name: 'Tide flats', does: 'Kelp gathering +8%, and the shallows hold 10% more.' },
  pools: { name: 'Tide-pool lore', does: 'Kelp gathering +5%.' },
  deeper: { name: 'Deeper beds', does: 'The shallows hold 20% more gatherers.' },
  nets: { name: 'Kelp baskets', does: 'Kelp gathering +10%, and the shallows hold 35% more.' },
  weirs: { name: 'Kelp beds', does: 'The shallows hold 12% more.' },
  hooks: { name: 'Kelp hooks', does: 'Kelp gathering +6%.' },
  traps: { name: 'Kelp rafts', does: 'The shallows hold 25% more.' },
  tides: { name: 'Read the tides', does: 'Kelp gathering +35%, and the shallows hold 30% more; foraging and digging 25% worse.' },
};
const MEAT_EATERS: Record<string, Partial<Leaf>> = {
  green: { name: 'Tracks in the ash', does: 'Grubbing in the ash +5%.' },
  tools: { name: 'Stone tools', does: 'Grubbing, scavenging and trapping +20%.' },
  grinders: { name: 'Grub sieves', does: 'Grubbing +8%.' },
  stick: { name: 'Snares', does: 'Set snares for what hid underground: meat that keeps coming.' },
  rootlore: { name: 'Trap lore', does: 'Trapping +8%, and snares reach 8% further.' },
  seeds: { name: 'Let some go', does: 'A few grubs are left to breed: a little of the ash comes back each day.' },
  tubers: { name: 'Burrow lore', does: 'Snares reach 15% further.' },
  deeproots: { name: 'Wide trapline', does: 'Snares reach 35% further.' },
  mulch: { name: 'Leave the young', does: 'A little more of the ash comes back each day.' },
  hammers: { name: 'Deadfalls', does: 'Trapping +6%.' },
  bars: { name: 'Pit traps', does: 'Trapping +8%.' },
  tides: { name: 'Read the tides', does: 'Fishing +35%, and the shore holds 30% more; grubbing and trapping 25% worse.' },
  tend: { name: 'Breed the grubs', does: 'The ash comes back faster, and snares reach 20% further; scavenging 25% worse.' },
};

/** An idea as a diet knows it (its name, what it says and does). */
export function nodeFor(id: string, diet: Diet): MindNode {
  const n = MIND_NODE[id];
  const o = diet === 'herbivore' ? PLANT_EATERS[id] : diet === 'carnivore' || diet === 'cannibal' ? MEAT_EATERS[id] : undefined;
  return o ? { ...n, ...o, fx: o.fx ?? n.fx } : n;
}

/** Whether an idea can be learned next: not known, and next to one that is. */
export function reachable(known: string[], id: string): boolean {
  if (known.includes(id)) return false;
  const n = MIND_NODE[id];
  return !!n && n.links.some((l) => l === 'mind0' || known.includes(l));
}

/** All the known ideas' effects, added up. */
export interface Mods {
  gather: Record<JobId | 'all', number>;
  meal: number;
  meatKeep: number;
  plantKeep: number;
  night: number;
  rest: number;
  limit: number;
  weak: number;
  digCap: number;
  fishCap: number;
  ashRegrow: number;
  unlock: Set<JobId>;
  keen: number;
  strong: number;
  others: number;
  listenHunger: number;
  ration: number;
  strongFirst: boolean;
}

export function modsOf(known: string[], diet: Diet = 'omnivore'): Mods {
  const m: Mods = { gather: { forage: 0, scavenge: 0, dig: 0, fish: 0, wood: 0, build: 0, listen: 0, rest: 0, all: 0 }, meal: 0, meatKeep: 0, plantKeep: 0, night: 0, rest: 0, limit: 0, weak: 0, digCap: 0, fishCap: 0, ashRegrow: 0, unlock: new Set(), keen: 0, strong: 0, others: 0, listenHunger: 0, ration: 0, strongFirst: false };
  for (const id of known) {
    const f = MIND_NODE[id] && nodeFor(id, diet).fx;
    if (!f) continue;
    for (const [k, v] of Object.entries(f.gather ?? {})) m.gather[k as JobId | 'all'] += v ?? 0;
    m.meal += f.meal ?? 0;
    m.meatKeep += f.meatKeep ?? 0;
    m.plantKeep += f.plantKeep ?? 0;
    m.night += f.night ?? 0;
    m.rest += f.rest ?? 0;
    m.limit += f.limit ?? 0;
    m.weak += f.weak ?? 0;
    m.digCap += f.digCap ?? 0;
    m.fishCap += f.fishCap ?? 0;
    m.ashRegrow += f.ashRegrow ?? 0;
    if (f.unlock) m.unlock.add(f.unlock);
    m.keen += f.keen ?? 0;
    m.strong += f.strong ?? 0;
    m.others += f.others ?? 0;
    m.listenHunger += f.listenHunger ?? 0;
    m.ration += f.ration ?? 0;
    m.strongFirst ||= !!f.strongFirst;
  }
  return m;
}
