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
  /** A line that gathers names (everyone born that season, say): what they did, and who. */
  group?: string;
  names?: string[];
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

/** Names as a list in words: "Ka", "Ka and Ri", "Ka, Ri and Mo" (a long list ends "and 9 more"). */
export function nameList(names: string[], most = 14): string {
  const shown = names.length > most ? names.slice(0, most - 1) : names;
  const more = names.length - shown.length;
  if (more) return `${shown.join(', ')} and ${more} more`;
  return shown.length < 2 ? shown.join('') : `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`;
}

/** One line for many: everyone that does the same thing in the same season goes on one line,
 * `one` for a single name ("{names} was born."), `many` for more ("{names} were born."). */
export function recordName(state: GameState, group: string, name: string, one: string, many: string, era: StageId = state.current, when?: string): void {
  const c = (state.chronicle ??= []);
  const w = when ?? whenIn(state, era);
  // (Looked for among the last few lines of the same season.)
  for (let i = c.length - 1; i >= Math.max(0, c.length - 12); i--) {
    const e = c[i];
    if (e.era !== era || e.when !== w) break;
    if (e.group === group && e.names) {
      e.names.push(name);
      e.text = many.replace('{names}', nameList(e.names));
      return;
    }
  }
  record(state, one.replace('{names}', name), era, w);
  const e = c[c.length - 1];
  e.group = group;
  e.names = [name];
}

/** Older saves' lines, one per birth or death, gathered as recordName gathers them now (for
 * showing: each season's births on one line, its deaths of old age on another). */
const GATHER: { re: RegExp; group: string; many: string }[] = [
  { re: /^(\S+) was born(?: to \S+)?\.$/, group: 'born', many: '{names} were born.' },
  { re: /^(\S+) died of old age\.$/, group: 'old', many: '{names} died of old age.' },
];
export function gathered(lines: string[]): string[] {
  const out: string[] = [];
  const at = new Map<string, { i: number; names: string[]; many: string }>();
  for (const l of lines) {
    const g = GATHER.find((x) => x.re.test(l));
    if (!g) {
      out.push(l);
      continue;
    }
    const name = l.match(g.re)![1];
    const has = at.get(g.group);
    if (has) {
      has.names.push(name);
      out[has.i] = g.many.replace('{names}', nameList(has.names));
    } else {
      at.set(g.group, { i: out.length, names: [name], many: g.many });
      out.push(l);
    }
  }
  return out;
}

/** What the eras are called in the Chronicle's headings. */
export function eraName(era: StageId): string {
  return STAGES[era].name;
}
