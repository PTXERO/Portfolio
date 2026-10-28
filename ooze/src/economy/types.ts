import type { Decimal } from './num';

export type StageId = 'soup' | 'cell';

/** The Soup's environment controls. Each runs from 0 to 3. */
export type DialId = 'heat' | 'light' | 'charge';
export const DIALS: DialId[] = ['heat', 'light', 'charge'];
/** Output multiplier at each dial level, 0 to 3. */
export type DialCurve = [number, number, number, number];

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
  | { kind: 'swirlMult'; mult: number };

export interface UpgradeDef {
  id: string;
  name: string;
  flavor: string;
  cost: number;
  effect: Effect;
  /** Shown only once this many of a generator are owned, or a reaction is known. */
  requires?: { generator?: string; owned?: number; reaction?: string };
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
  };
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
  next?: StageId;
}

export interface StageState {
  currency: Decimal;
  totalEarned: Decimal;
  generators: Record<string, number>;
  upgrades: string[];
  complete: boolean;
  dials: Record<DialId, number>;
  /** Reaction ids, in the order they were found. */
  discovered: string[];
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
}
