// What the spear teaches: a web of ideas, grown out from the waking mind at its centre. Six
// branches (Fire, Stone, Sea, Earth, Kin, Mind), each a path of small ideas to a great one
// (a notable) and out to a keystone: strong, with a cost. Ideas are learned one at a time, each
// next to one already known, for insight; the outer ring links the branches, so paths can cross
// over. There's far more than one run can afford: the path taken is how that run is played.

import type { JobId } from './extinction';

export type NodeKind = 'start' | 'minor' | 'notable' | 'keystone';
export type BranchId = 'fire' | 'stone' | 'sea' | 'earth' | 'kin' | 'mind';

/** What an idea does. Gathering bonuses add up per job (0.1 is +10%) and multiply the work. */
export interface Fx {
  gather?: Partial<Record<JobId | 'all', number>>;
  /** Meals count for this much more (fire, cooking). */
  meal?: number;
  /** Meat kept overnight: added to the share that doesn't rot. */
  meatKeep?: number;
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

export const NODE_COST: Record<NodeKind, number> = { start: 0, minor: 4, notable: 10, keystone: 16 };
/** Each idea known makes the next cost this much more (the further in, the harder). */
export const COST_STEP = 1.5;

export const BRANCHES: { id: BranchId; name: string; angle: number }[] = [
  { id: 'fire', name: 'Fire', angle: -90 },
  { id: 'stone', name: 'Stone', angle: -30 },
  { id: 'sea', name: 'Sea', angle: 30 },
  { id: 'earth', name: 'Earth', angle: 90 },
  { id: 'kin', name: 'Kin', angle: 150 },
  { id: 'mind', name: 'Mind', angle: 210 },
];

type Leaf = { id: string; name: string; does: string; fx: Fx };
/** Each branch: its first small idea, its great idea, two small ideas past that, then a second
 * great idea down one side and a keystone down the other. */
const PATHS: Record<BranchId, [Leaf, Leaf, Leaf, Leaf, Leaf, Leaf]> = {
  fire: [
    { id: 'warmth', name: 'Warmth', does: 'Huddled close, nights cost a little less hunger.', fx: { night: 0.06 } },
    { id: 'fire', name: 'Fire', does: 'Cooked food goes further: every meal counts for a third more.', fx: { meal: 0.35 } },
    { id: 'smoke', name: 'Smoke', does: 'Meat hung over the fire keeps a little longer.', fx: { meatKeep: 0.1 } },
    { id: 'hearth', name: 'Hearth stones', does: 'Those resting by the fire get less hungry.', fx: { rest: 0.12 } },
    { id: 'racks', name: 'Drying racks', does: 'Dried meat keeps for days instead of rotting overnight.', fx: { meatKeep: 0.25 } },
    { id: 'cookall', name: 'Cook everything', does: 'Meals count for even more (+30%), but all the cooking slows gathering (−15%).', fx: { meal: 0.3, gather: { all: -0.15 } } },
  ],
  stone: [
    { id: 'edges', name: 'Sharp edges', does: 'Scavenging +10%.', fx: { gather: { scavenge: 0.1 } } },
    { id: 'tools', name: 'Stone tools', does: 'Foraging, scavenging and digging +40%.', fx: { gather: { forage: 0.4, scavenge: 0.4, dig: 0.4 } } },
    { id: 'knapping', name: 'Knapping', does: 'All gathering +10%.', fx: { gather: { all: 0.1 } } },
    { id: 'heavy', name: 'Heavy stones', does: 'Scavenging +15%.', fx: { gather: { scavenge: 0.15 } } },
    { id: 'butcher', name: 'Butchering', does: 'Nothing on a carcass wasted: scavenging +30%.', fx: { gather: { scavenge: 0.3 } } },
    { id: 'mightmakes', name: 'Strength above all', does: 'The strong work half again as hard; everyone else, 15% less.', fx: { strong: 0.5, others: -0.15 } },
  ],
  sea: [
    { id: 'watch', name: 'Watch the water', does: 'Fishing +10%.', fx: { gather: { fish: 0.1 } } },
    { id: 'line', name: 'Fishing line', does: 'Fish the shore: meat that keeps coming.', fx: { unlock: 'fish' } },
    { id: 'bait', name: 'Bait', does: 'Fishing +15%.', fx: { gather: { fish: 0.15 } } },
    { id: 'deeper', name: 'Deeper water', does: 'The shore holds 20% more lines.', fx: { fishCap: 0.2 } },
    { id: 'nets', name: 'Nets', does: 'Fishing +20%, and the shore holds 40% more.', fx: { gather: { fish: 0.2 }, fishCap: 0.4 } },
    { id: 'tides', name: 'Read the tides', does: 'Fishing half again as good; foraging and digging 30% worse.', fx: { gather: { fish: 0.5, forage: -0.3, dig: -0.3 } } },
  ],
  earth: [
    { id: 'green', name: 'Know the green', does: 'Foraging +10%.', fx: { gather: { forage: 0.1 } } },
    { id: 'stick', name: 'Digging stick', does: 'Dig for roots: plants that keep coming.', fx: { unlock: 'dig' } },
    { id: 'rootlore', name: 'Root lore', does: 'Digging +15%.', fx: { gather: { dig: 0.15 } } },
    { id: 'seeds', name: 'Seed keeping', does: 'A little of the ash grows back each day.', fx: { ashRegrow: 0.01 } },
    { id: 'deeproots', name: 'Deep roots', does: 'Roots stretch 40% further.', fx: { digCap: 0.4 } },
    { id: 'tend', name: 'Tend the ash', does: 'The ash grows back four times as fast; scavenging 30% worse.', fx: { ashRegrow: 0.04, gather: { scavenge: -0.3 } } },
  ],
  kin: [
    { id: 'huddle', name: 'Huddle', does: 'Nights cost a little less hunger.', fx: { night: 0.06 } },
    { id: 'care', name: 'Care for the weak', does: 'The frail, old and young last much longer starving.', fx: { weak: 0.5 } },
    { id: 'sleepclose', name: 'Sleep close', does: 'Those resting get less hungry.', fx: { rest: 0.1 } },
    { id: 'tough', name: 'Tough it out', does: 'Everyone lasts a little longer starving.', fx: { limit: 0.2 } },
    { id: 'rationing', name: 'Rationing', does: 'Short rations count for 15% more.', fx: { ration: 0.15 } },
    { id: 'strongfirst', name: 'The strong eat first', does: 'Workers eat first and last longer; the resting eat last and starve sooner.', fx: { strongFirst: true } },
  ],
  mind: [
    { id: 'stillness', name: 'Stillness', does: 'Insight +15%.', fx: { gather: { listen: 0.15 } } },
    { id: 'memory', name: 'Memory', does: 'Insight +30%.', fx: { gather: { listen: 0.3 } } },
    { id: 'dreams', name: 'Dreams', does: 'Insight +15%.', fx: { gather: { listen: 0.15 } } },
    { id: 'ears', name: 'Keen ears', does: 'The keen work 30% harder at everything.', fx: { keen: 0.3 } },
    { id: 'teaching', name: 'Teaching', does: 'All work +10%.', fx: { gather: { all: 0.1 } } },
    { id: 'voices', name: 'Voices', does: 'Insight doubled, but those listening get hungrier each night.', fx: { gather: { listen: 1 }, listenHunger: 0.25 } },
  ],
};

const R = [0, 22, 42, 64, 88];
const polar = (deg: number, r: number) => ({ x: Math.cos((deg * Math.PI) / 180) * r, y: Math.sin((deg * Math.PI) / 180) * r });

function build(): MindNode[] {
  const out: MindNode[] = [{ id: 'mind0', name: 'Awake', kind: 'start', branch: null, does: 'The spear touched it, and it knew that it was.', fx: {}, x: 0, y: 0, links: [] }];
  const add = (b: BranchId, leaf: Leaf, kind: NodeKind, deg: number, r: number, from: string) => {
    out.push({ ...leaf, kind, branch: b, ...polar(deg, r), links: [from] });
    out.find((n) => n.id === from)!.links.push(leaf.id);
  };
  for (const br of BRANCHES) {
    const [m1, n1, m2a, m2b, n2, k] = PATHS[br.id];
    const a = br.angle;
    add(br.id, m1, 'minor', a, R[1], 'mind0');
    add(br.id, n1, 'notable', a, R[2], m1.id);
    add(br.id, m2a, 'minor', a - 11, R[3], n1.id);
    add(br.id, m2b, 'minor', a + 11, R[3], n1.id);
    add(br.id, n2, 'notable', a - 12, R[4], m2a.id);
    add(br.id, k, 'keystone', a + 13, R[4] + 4, m2b.id);
  }
  // The outer ring: each branch's far side reaches the next branch's near side.
  BRANCHES.forEach((br, i) => {
    const next = BRANCHES[(i + 1) % BRANCHES.length];
    const a = out.find((n) => n.id === PATHS[br.id][3].id)!;
    const b = out.find((n) => n.id === PATHS[next.id][2].id)!;
    a.links.push(b.id);
    b.links.push(a.id);
  });
  return out;
}

export const MIND_TREE: MindNode[] = build();
export const MIND_NODE: Record<string, MindNode> = Object.fromEntries(MIND_TREE.map((n) => [n.id, n]));

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

export function modsOf(known: string[]): Mods {
  const m: Mods = { gather: { forage: 0, scavenge: 0, dig: 0, fish: 0, listen: 0, rest: 0, all: 0 }, meal: 0, meatKeep: 0, night: 0, rest: 0, limit: 0, weak: 0, digCap: 0, fishCap: 0, ashRegrow: 0, unlock: new Set(), keen: 0, strong: 0, others: 0, listenHunger: 0, ration: 0, strongFirst: false };
  for (const id of known) {
    const f = MIND_NODE[id]?.fx;
    if (!f) continue;
    for (const [k, v] of Object.entries(f.gather ?? {})) m.gather[k as JobId | 'all'] += v ?? 0;
    m.meal += f.meal ?? 0;
    m.meatKeep += f.meatKeep ?? 0;
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
