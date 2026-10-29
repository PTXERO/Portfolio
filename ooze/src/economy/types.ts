import type { Decimal } from './num';

export type StageId = 'soup' | 'cell';

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
  | { kind: 'offlineHours'; hours: number };

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
  };
  /** How many times it can be bought, each level adding the effect again (default 1). */
  levels?: number;
  /** Cost multiplier per level owned (default 3). */
  costGrowth?: number;
  /** Paid in an earlier stage's currency instead of this stage's. */
  pay?: StageId;
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
  /** Text for the stage's finish screen. */
  ending?: { title: string; line: string };
  next?: StageId;
}

export interface StageState {
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
}
