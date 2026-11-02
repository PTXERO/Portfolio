import { describe, expect, it } from 'vitest';
import { STAGES } from '../src/content/stages';
import { evolve, visitStage } from '../src/economy/actions';
import { islandFor } from '../src/economy/creature';
import { stageRate } from '../src/economy/rates';
import { exportSave, importSave } from '../src/economy/save';
import { createState } from '../src/economy/state';
import { tick } from '../src/economy/tick';
import { awaken, sealed, SURVIVE } from '../src/economy/tribal';

/** A game at the end of the Creature, with "Many" found. */
function atManyEnd() {
  const s = createState(0);
  s.started = true;
  s.unlocked.push('cell', 'creature');
  s.stages.soup.complete = true;
  s.stages.cell.complete = true;
  s.current = 'creature';
  const c = s.stages.creature;
  c.seed = 4242;
  islandFor(s);
  c.pop = 400;
  c.generation = 6;
  c.discovered.push(...STAGES.creature.reactions!.map((r) => r.id));
  return s;
}

describe('tribal era', () => {
  it('opens from the Creature: a quarter of the herd lives, and the eras before are sealed', () => {
    const s = atManyEnd();
    const soupBefore = s.stages.soup.totalEarned;
    expect(evolve(s)).toBe(true);
    expect(s.current).toBe('tribal');
    const t = s.stages.tribal.tribe!;
    expect(t.survivors).toBe(Math.round(400 * SURVIVE));
    expect(t.awake).toBe(false);
    expect(t.generations).toBe(6);
    expect(sealed(s, 'creature')).toBe(true);
    expect(sealed(s, 'soup')).toBe(true);
    expect(visitStage(s, 'creature')).toBe(false);
    tick(s, 10);
    expect(s.stages.soup.totalEarned.eq(soupBefore)).toBe(true);
    expect(s.stages.tribal.totalEarned.gt(0)).toBe(true);
  });

  it('touching the spear wakes them, and they gather far more', () => {
    const s = atManyEnd();
    evolve(s);
    const before = stageRate(s, 'tribal');
    expect(awaken(s)).toBe(true);
    expect(stageRate(s, 'tribal').gt(before.mul(2))).toBe(true);
    expect(awaken(s)).toBe(false);
  });

  it('a tribal save survives a round trip', () => {
    const s = atManyEnd();
    evolve(s);
    awaken(s);
    const back = importSave(exportSave(s));
    expect(back.current).toBe('tribal');
    expect(back.stages.tribal.tribe).toEqual(s.stages.tribal.tribe);
  });
});
