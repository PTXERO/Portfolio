import type { Decimal } from './num';

export type StageId = 'soup' | 'cell';

export interface GeneratorDef {
  id: string;
  name: string;
  flavor: string;
  baseCost: number;
  /** Cost multiplier per unit owned (1.07 for cheap early tiers up to ~1.15). */
  growth: number;
  /** Currency per second produced by one unit, before multipliers. */
  baseRate: number;
}

export type Effect =
  | { kind: 'genMult'; target: string; mult: number }
  | { kind: 'stageMult'; mult: number }
  | { kind: 'tapMult'; mult: number }
  /** Each tap also yields this fraction of a second of stage production. */
  | { kind: 'tapFromRate'; seconds: number }
  /** Raises how strongly the previous stage feeds this one. */
  | { kind: 'feedMult'; mult: number };

export interface UpgradeDef {
  id: string;
  name: string;
  flavor: string;
  cost: number;
  effect: Effect;
  /** Shown only once this many of a generator are owned. */
  requires?: { generator: string; owned: number };
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
  next?: StageId;
}

export interface StageState {
  currency: Decimal;
  totalEarned: Decimal;
  generators: Record<string, number>;
  upgrades: string[];
  complete: boolean;
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
}
