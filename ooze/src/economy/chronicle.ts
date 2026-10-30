// The Chronicle: everything that happened, the whole game through, era by era. Each era tells
// time its own way: minutes in the Soup and the Cell (things happen fast at that size), years
// and seasons for the Creature, and days in the Extinction (every one of them counted).

import { STAGES } from '../content/stages';
import { SEASON_SEC, seasonOf } from './rates';
import type { GameState, StageId } from './types';

export interface ChronicleEntry {
  era: StageId;
  when: string;
  text: string;
}

/** The most kept (the oldest go first). */
const KEEP = 2000;

/** When something happens, in the era's own time. */
export function whenIn(state: GameState, era: StageId): string {
  const st = state.stages[era];
  if (era === 'creature') {
    const year = Math.floor(st.year / (SEASON_SEC * 4)) + 1;
    return `Year ${year}, ${seasonOf(state).season.name}`;
  }
  if (era === 'tribal') {
    const t = st.tribe;
    if (t?.landed) return 'Landfall';
    if (t?.ex) return `Day ${t.ex.day + 1}${t.attempts ? ` · try ${t.attempts + 1}` : ''}`;
    return 'The strike';
  }
  return `${Math.max(1, Math.ceil(st.time / 60))} min`;
}

/** Writes a line into the Chronicle (in the era it happened in). */
export function record(state: GameState, text: string, era: StageId = state.current, when?: string): void {
  const c = (state.chronicle ??= []);
  c.push({ era, when: when ?? whenIn(state, era), text });
  if (c.length > KEEP) c.splice(0, c.length - KEEP);
}

/** What the eras are called in the Chronicle's headings. */
export function eraName(era: StageId): string {
  return STAGES[era].name;
}
