import type { ExtinctionState } from './extinction';
import type { Decimal } from './num';

export type StageId = 'soup' | 'cell' | 'creature' | 'tribal';

/** The Soup's environment controls. Each runs from 0 to 3. */
export type DialId = 'heat' | 'light' | 'charge';
export const DIALS: DialId[] = ['heat', 'light', 'charge'];
/** Output multiplier at each dial level, 0 to 3. */
export type DialCurve = [number, number, number, number];

/** What the Cell stage's cells eat. Before choosing, a cell eats a bit of everything. */
export type Diet = 'grazer' | 'hunter' | 'omnivore';
export type FoodKind = 'algae' | 'bacteria';

export interface GeneratorDef {
  id: string;
  name: string;
  flavor: string;
  baseCost: number;
  /** Cost multiplier per unit owned (1.07 for cheap early tiers up to ~1.15). */
  growth: number;
  /** Currency per second produced by one unit, before multipliers. */
  baseRate: number;
  /** How this generator responds to each dial. Missing dials don't affect it. */
  prefs?: Partial<Record<DialId, DialCurve>>;
  /** Hidden until this reaction has been discovered. */
  unlockedBy?: string;
  /** The habitat this lives in (Cell stage). Each habitat has its own lineup. */
  habitat?: string;
}

export type Effect =
  | { kind: 'genMult'; target: string; mult: number }
  | { kind: 'stageMult'; mult: number }
  | { kind: 'tapMult'; mult: number }
  /** Each tap also yields this fraction of a second of stage production. */
  | { kind: 'tapFromRate'; seconds: number }
  /** Raises how strongly the previous stage feeds this one. */
  | { kind: 'feedMult'; mult: number }
  /** Unlocks a dial, or raises how far it turns. */
  | { kind: 'dialMax'; dial: DialId; max: number }
  /** Strengthens the whirlpool's production bonus. */
  | { kind: 'swirlMult'; mult: number }
  // ---- Cell stage ----
  /** The hero cell swims faster. */
  | { kind: 'heroSpeed'; mult: number }
  /** Shields the lineage from predators: 0 to 1, added up and capped. */
  | { kind: 'defense'; amount: number }
  /** Food the hero eats is worth more. */
  | { kind: 'forageMult'; mult: number }
  | { kind: 'diet'; diet: Diet }
  /** Cell size: bigger cells can engulf bigger things. */
  | { kind: 'size'; size: number }
  /** The hero forages on its own. */
  | { kind: 'autopilot' }
  /** Food and rare microbes turn up more often. */
  | { kind: 'spawnMult'; mult: number }
  /** Adds to how much time away counts. */
  | { kind: 'offlineHours'; hours: number }
  /** Your cell drives off predators on its own; each level rams harder. */
  | { kind: 'guard'; level: number }
  /** One habitat's life produces more. */
  | { kind: 'habitatMult'; habitat: string; mult: number }
  // ---- Creature stage ----
  /** Raises one of the creature's stats. */
  | { kind: 'stat'; stat: Stat; amount: number }
  /** Expeditions bring back more (and take less time with Speed). */
  | { kind: 'tripMult'; mult: number }
  /** Raises the body's energy budget for parts. */
  | { kind: 'energy'; amount: number }
  /** The herd eats less (upkeep ×mult). */
  | { kind: 'upkeepMult'; mult: number }
  /** Eggs hatch sooner (egg time ×mult). */
  | { kind: 'eggMult'; mult: number }
  /** Winter takes less of the herd (losses ×mult). */
  | { kind: 'winterMult'; mult: number }
  /** An instinct bred into the line: this share of the herd does it, on its own. */
  | { kind: 'instinct'; role: Role; share: number }
  /** Your creature explores on its own: 1 wanders into the fog, 2 heads for places it can
   * get into, 3 also settles run-ins on the road itself. */
  | { kind: 'curiosity'; level: number }
  /** Parties of the herd head out to found places on their own and carry food home. */
  | { kind: 'parties'; count: number }
  /** Your creature makes rounds of the places it knows, foraging those that have grown back. */
  | { kind: 'rounds' };

/** What instinct does with a run-in you leave to it: always run, take it on only with the
 * stat for it (advantage), or weigh it up (also chance a near miss). */
export type RunInPolicy = 'run' | 'ready' | 'smart';

/** What members of the herd do, by instinct (nobody is told to: these are animals). */
export type Role = 'forager' | 'carer' | 'digger' | 'guard' | 'scout';
export const ROLES: Role[] = ['forager', 'carer', 'digger', 'guard', 'scout'];

/** Something that happens partway through an expedition, with a choice to make. */
export interface TripEventDef {
  id: string;
  text: string;
  options: { label: string; stat?: Stat; need?: number; good: string; bad?: string; reward: 'pay' | 'part' | 'mate' }[];
}

/** The Creature stage's five stats. */
export type Stat = 'speed' | 'strength' | 'senses' | 'toughness' | 'charm';
export const STATS: Stat[] = ['speed', 'strength', 'senses', 'toughness', 'charm'];

/** Where a body part goes. One part per slot is worn at a time. */
export type Slot = 'legs' | 'mouth' | 'eyes' | 'back' | 'tail';
export const SLOTS: Slot[] = ['legs', 'mouth', 'eyes', 'back', 'tail'];

export interface PartDef {
  id: string;
  slot: Slot;
  name: string;
  flavor: string;
  stats: Partial<Record<Stat, number>>;
  /** Price in the stage's currency; parts without one are only found on expeditions. */
  cost?: number;
  /** Energy it takes to wear (defaults to half its stats, rounded up). */
  energy?: number;
  /** Drawn with another part's shape (and its own colour), for parts that share a look. */
  look?: string;
  tint?: string;
}

/** A place the creature can explore. Each is also a page in the stage's book. */
export interface PlaceDef {
  id: string;
  name: string;
  flavor: string;
  /** Minutes away, before Speed shortens it. */
  minutes: number;
  /** Stats it takes to explore safely; below these, trips can fail. */
  needs: Partial<Record<Stat, number>>;
  /** Parts that can be found here. */
  parts: string[];
  /** Chance per successful trip of meeting a mate. */
  mateChance: number;
  /** What the place's book page gives once it has been explored. */
  bonus?: Effect;
  unlocks?: string;
  /** Places that must be explored first. */
  after?: string[];
}

/** A mate met on an expedition. */
export interface Mate {
  id: number;
  name: string;
  parts: Partial<Record<Slot, string>>;
}

/** What came back from an expedition or a hatching, for the interface to show. */
export interface Report {
  kind: 'trip' | 'hatch' | 'event';
  place?: string;
  success: boolean;
  /** Currency earned, as a string (Decimal). */
  earned: string;
  parts: string[];
  mate?: string;
  /** Book page found on this trip. */
  found?: string;
  /** What happened on the way, and how the choice turned out. */
  event?: string;
  /** Turned back from a place: the stats it was short of. */
  short?: string[];
    /** A rare sighting tapped (its kind). */
    sighting?: string;
  generation?: number;
}

export interface UpgradeDef {
  id: string;
  name: string;
  flavor: string;
  cost: number;
  effect: Effect;
  /** More effects, for mutations that change several things at once. */
  extra?: Effect[];
  /** Shown only once these hold: generators owned, a reaction known, other upgrades bought. */
  requires?: {
    generator?: string;
    owned?: number;
    reaction?: string;
    upgrades?: string[];
    anyReaction?: string[];
    /** Other upgrades at these levels or higher. */
    levels?: Record<string, number>;
    /** Only offered once this habitat is open (Cell stage). */
    habitat?: string;
    /** Creature milestones: this many places found, generations bred, or this big a herd. */
    found?: number;
    generation?: number;
    pop?: number;
  };
  /** How many times it can be bought, each level adding the effect again (default 1). */
  levels?: number;
  /** Cost multiplier per level owned (default 3). */
  costGrowth?: number;
  /** Paid in an earlier stage's currency instead of this stage's. */
  pay?: StageId;
  /** Its effects land on another (earlier) stage instead of this one: giving back down the line. */
  target?: StageId;
  /** Mutation Tree branch; upgrades without one are plain boosts. */
  branch?: string;
  /** Can't be bought alongside these (a choice, like diets). */
  excludes?: string[];
}

/** A place in the Cell stage's pond. */
export interface HabitatDef {
  id: string;
  name: string;
  flavor: string;
  /** How much of each food there is; 1 is ordinary. */
  food: Record<FoodKind, number>;
  /** Share of output lost to predators with no defense, 0 to 1. */
  danger: number;
  /** Locked until this upgrade reaches `level` (default 1) or this reaction is found. */
  unlock?: { upgrade?: string; level?: number; reaction?: string };
}

/** A goal in an earlier stage that pays off in this one, e.g. "own 40 Protocells". */
export interface MilestoneDef {
  id: string;
  stage: StageId;
  gen: string;
  owned: number;
  bonus: Effect;
}

/** A discovery: happens by itself once its conditions all hold at the same moment. */
export interface ReactionDef {
  id: string;
  name: string;
  flavor: string;
  /** Clues shown before discovery, vaguest first. Later clues appear as you get closer. */
  hints: string[];
  needs: {
    gens?: Record<string, number>;
    /** Inclusive [min, max] dial levels. */
    dials?: Partial<Record<DialId, [number, number]>>;
    /** Whirlpool strength needed, 0 to 1. */
    swirl?: number;
    /** Upgrades (mutations) that must be owned. */
    upgrades?: string[];
    /** Any one of these upgrades will do (e.g. either diet). */
    anyUpgrade?: string[];
    /** Habitat your cell must be in. */
    habitat?: string;
    /** How settled in that habitat (0 to 1) the lineage must be. */
    settled?: number;
    /** How many other entries must already be found. */
    found?: number;
    /** Generations the line must have bred (Creature stage). */
    generation?: number;
    /** Herd size needed (Creature stage). */
    pop?: number;
  };
  /** Found by the player steering into it (engulfing), not automatically. */
  manual?: boolean;
  /** Rare microbes to catch before it's found (default 1). */
  captures?: number;
  /** The two molecules seen combining in the scene (looks only). */
  pair?: [string, string];
  /** Generator this reveals. */
  unlocks?: string;
  bonus?: Effect;
  /** The stage's ending: not automatic; the player triggers it and pays `cost`. */
  final?: boolean;
  cost?: number;
}

export interface StageDef {
  id: StageId;
  name: string;
  currency: string;
  /** Currency paid to evolve into the next stage. */
  goal: number;
  /** Line shown when the stage opens. Placeholder until the real script is written. */
  intro: string;
  /** Currency per tap; 0 means the stage has no tapping. */
  tapBase: number;
  /** Units of the first generator granted when the stage opens. */
  startingGenerators: number;
  generators: GeneratorDef[];
  upgrades: UpgradeDef[];
  /** Stages with reactions end on their final reaction instead of `goal`. */
  reactions?: ReactionDef[];
  /** What the stage calls its collection (the Recipe Book, Organelles). */
  bookName?: string;
  habitats?: HabitatDef[];
  /** Goals in earlier stages that boost this one. */
  milestones?: MilestoneDef[];
  /** Creature stage: body parts and places to explore. */
  parts?: PartDef[];
  places?: PlaceDef[];
  /** Text for the stage's finish screen. */
  ending?: { title: string; line: string };
  next?: StageId;
  /** The Tribal era: people, jobs and building (see economy/tribal.ts). */
  tribal?: true;
}

/** The tribe: who lived through the strike, and what they've become since. */
export interface TribeState {
  /** Whether they've touched the spear (woken up). */
  awake: boolean;
  /** How many there are. */
  pop: number;
  /** How many lived through the strike. */
  survivors: number;
  /** The look they carry from the Creature (parts worn and diet), for drawing them. */
  look: { parts: Partial<Record<Slot, string>>; diet: string };
  /** Their body's stats, carried from the Creature. */
  stats: Record<Stat, number>;
  /** Generations bred before the strike (they become the line's traits later). */
  generations: number;
  /** What the eras before leave them: a lasting boost to everything they do. */
  heritage: number;
  /** The island's seed (the same island, broken). */
  seed: number;
  /** Seconds on the tribe's own clock (days and seasons). */
  year: number;
  /** The Extinction under way (once they've woken), how it began (to try again from), how
   * many tries it's taken, the most days survived, and ideas the spear has taught before. */
  ex?: ExtinctionState;
  start?: string;
  attempts?: number;
  best?: number;
  remembered?: string[];
  /** Once the Extinction is survived: the four who set off, and whether they ate their dead. */
  family?: { name: string; trait: string }[];
  cannibal?: boolean;
}

export interface StageState {
  /** Tribal era only. */
  tribe?: TribeState;
  currency: Decimal;
  totalEarned: Decimal;
  generators: Record<string, number>;
  upgrades: string[];
  /** Levels of upgrades that have more than one; others are in `upgrades` at level 1. */
  levels: Record<string, number>;
  complete: boolean;
  dials: Record<DialId, number>;
  /** Reaction ids, in the order they were found. */
  discovered: string[];
  /** Generators made free by reactions; they produce but don't raise prices. */
  free: Record<string, number>;
  /** Progress toward each reaction's next free product, 0 to 1. */
  catalysis: Record<string, number>;
  /** The habitat on screen, where your own cell swims (Cell stage). */
  habitat: string;
  /** Food the hero has eaten, for stats. */
  eaten: number;
  /** How settled your lineage is in each habitat, 0 to 1. Grows while your cell lives there. */
  acclim: Record<string, number>;
  /** Rare microbes caught toward each organelle not yet found. */
  captured: Record<string, number>;
  /** Game seconds spent with this as the newest stage, for its finish screen. */
  time: number;
  // ---- Creature stage ----
  /** Body parts owned, and the one worn in each slot. */
  parts: string[];
  equipped: Partial<Record<Slot, string>>;
  /** The island this game rolled, where your creature is on it, and what's been seen. */
  seed: number;
  pos: { x: number; y: number };
  /** Cells of the map seen (1) or still in fog (0). Saved packed. */
  seen: Uint8Array;
  /** Where it's walking, seconds of walking till its next run-in, and the run-in it's stopped at. */
  walk: { tx: number; ty: number; next: number; event?: { id: string; choice: number | null; left: number } } | null;
  /** Seconds (on the seasons' clock) before another part can turn up rummaging or revisiting. */
  nextFind: number;
  /** Whether Curiosity sends it exploring on its own (the player can switch it off). */
  autoRoam: boolean;
  /** What Curiosity is allowed to do on its own (each can be switched off), and whether
   * run-ins wait for your choice instead of instinct deciding when time runs out. */
  roamOpts: { places: boolean; settle: boolean; mandatory: boolean; policy: RunInPolicy };
  /** Herd parties out on the road: the place they're bound for and seconds since they left. */
  parties: { place: string; t: number }[];
  /** When (seasons' clock) each place is ready to be foraged by a party again. */
  partyReady: Record<string, number>;
  /** Nests founded away from home, at these found places (once the island is all explored). */
  nests: string[];
  /** When (seasons' clock) each new nest is settled: the herd's had time to walk there. */
  nestSettle: Record<string, number>;
  /** Rare sightings tapped, by kind. */
  sightings: Record<string, number>;
  /** Times a found place has been foraged again (the scene puffs when it ticks up; not saved). */
  foraged?: number;
  /** What the last forage and the last party home brought in (for the scene to show; not saved). */
  lastForage?: string;
  lastForagePlace?: string;
  partiesHome?: number;
  lastParty?: string;
  /** The herd: how many, and what they're set to do (the rest forage). */
  pop: number;
  roles: Record<Role, number>;
  /** Seconds into the current year (seasons). */
  year: number;
  /** Times each place has been reached (found once it's 1). */
  trips: Record<string, number>;
  mates: Mate[];
  /** The egg incubating, if any. */
  egg: { mate: Mate; left: number; total: number } | null;
  /** How many generations the line has bred. */
  generation: number;
}

export type BuyAmount = 1 | 10 | 'max';

export interface GameState {
  version: 1;
  current: StageId;
  unlocked: StageId[];
  stages: Record<StageId, StageState>;
  /** Seconds of saved-up fast-forward. */
  timeBank: number;
  /** Fast-forward speed while the bank lasts; 1 = off. */
  warp: number;
  offlineCapSec: number;
  /** Wall-clock ms when the state was last advanced. */
  lastSeen: number;
  /** Game seconds simulated, including offline. */
  playTime: number;
  buyAmount: BuyAmount;
  taps: number;
  /** False until the player's first action; nothing is produced before then. */
  started: boolean;
  /** Whirlpool strength, 0 to 1. Built by circling a finger; fades on its own. */
  swirl: number;
  /** Reactions found since the interface last looked, for it to celebrate. */
  news: string[];
  /** Reaction ids that just made a free product, for the scene to show. */
  made: string[];
  /** Expeditions and hatchings finished since the interface last looked. */
  reports: Report[];
}
