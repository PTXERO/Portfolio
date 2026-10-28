import { describe, expect, it } from 'vitest';
import { STAGES } from '../src/content/stages';
import { affordableCount, buyGenerator, buyUpgrade, canEvolve, evolve, generatorCost, tap } from '../src/economy/actions';
import { D } from '../src/economy/num';
import { applyOffline, timeBankCap } from '../src/economy/offline';
import { milestonesReached, stageRate } from '../src/economy/rates';
import { deserialize, exportSave, importSave, serialize } from '../src/economy/save';
import { cloneState, createState } from '../src/economy/state';
import { liveTick, tick } from '../src/economy/tick';

/** A game where the player has already made their first move. */
function fresh() {
  const s = createState(0);
  s.started = true;
  return s;
}

const near = (a: number, b: number, rel = 1e-6) => expect(Math.abs(a - b)).toBeLessThanOrEqual(Math.abs(b) * rel + 1e-9);

describe('costs', () => {
  it('bulk cost equals buying one at a time', () => {
    const s = fresh();
    const bulk = generatorCost(s, 'soup', 'lipid', 10).toNumber();
    let single = 0;
    for (let i = 0; i < 10; i++) {
      single += generatorCost(s, 'soup', 'lipid').toNumber();
      s.stages.soup.generators.lipid++;
    }
    near(bulk, single);
  });

  it('affordable count is the most that can be bought', () => {
    const s = fresh();
    s.stages.soup.currency = D(5000);
    const n = affordableCount(s, 'soup', 'amino');
    expect(generatorCost(s, 'soup', 'amino', n).lte(5000)).toBe(true);
    expect(generatorCost(s, 'soup', 'amino', n + 1).gt(5000)).toBe(true);
    expect(buyGenerator(s, 'soup', 'amino', n)).toBe(true);
    expect(buyGenerator(s, 'soup', 'amino', 1)).toBe(false);
  });
});

describe('rates', () => {
  it('doubles at each milestone', () => {
    expect(milestonesReached(9)).toBe(0);
    expect(milestonesReached(10)).toBe(1);
    expect(milestonesReached(100)).toBe(4);
    expect(milestonesReached(199)).toBe(4);
    expect(milestonesReached(200)).toBe(5);
    expect(milestonesReached(300)).toBe(6);
  });

  it('upgrades multiply the right generator', () => {
    const s = fresh();
    s.stages.soup.generators.amino = 10;
    const before = stageRate(s, 'soup').toNumber();
    s.stages.soup.currency = D(1e6);
    expect(buyUpgrade(s, 'soup', 'aminoChains')).toBe(true);
    near(stageRate(s, 'soup').toNumber(), before * 2);
  });

  it('a finished stage boosts the next one', () => {
    const s = fresh();
    s.stages.soup.currency = D(STAGES.soup.goal);
    s.stages.soup.generators.lipid = 20;
    expect(evolve(s)).toBe(true);
    const fed = stageRate(s, 'cell').toNumber();
    const unfed = cloneState(s);
    unfed.stages.soup.complete = false;
    expect(fed).toBeGreaterThan(stageRate(unfed, 'cell').toNumber());
  });
});

describe('stages', () => {
  it('evolving pays the goal and opens the next stage with a starter generator', () => {
    const s = fresh();
    s.stages.soup.currency = D(STAGES.soup.goal * 1.5);
    expect(canEvolve(s)).toBe(true);
    evolve(s);
    expect(s.current).toBe('cell');
    expect(s.stages.soup.complete).toBe(true);
    near(s.stages.soup.currency.toNumber(), STAGES.soup.goal * 0.5);
    expect(s.stages.cell.generators.fission).toBe(1);
  });

  it('the last stage cannot evolve yet', () => {
    const s = fresh();
    s.stages.soup.currency = D(STAGES.soup.goal);
    evolve(s);
    s.stages.cell.currency = D(STAGES.cell.goal * 10);
    expect(canEvolve(s)).toBe(false);
  });

  it('tapping only works where the stage has taps', () => {
    const s = fresh();
    expect(tap(s).toNumber()).toBe(1);
    s.stages.soup.currency = D(STAGES.soup.goal);
    evolve(s);
    expect(tap(s).toNumber()).toBe(0);
  });
});

describe('ticking', () => {
  it('small and large steps agree when nothing is bought', () => {
    const a = fresh();
    a.stages.soup.generators.lipid = 7;
    const b = cloneState(a);
    for (let i = 0; i < 100; i++) tick(a, 0.1);
    tick(b, 10);
    near(a.stages.soup.currency.toNumber(), b.stages.soup.currency.toNumber());
  });

  it('warp spends the time bank and runs faster', () => {
    const s = fresh();
    s.timeBank = 10;
    s.warp = 5;
    liveTick(s, 1);
    near(s.playTime, 5);
    near(s.timeBank, 6);
  });

  it('warp switches off when the bank runs dry', () => {
    const s = fresh();
    s.timeBank = 2;
    s.warp = 10;
    liveTick(s, 1);
    near(s.playTime, 3);
    expect(s.timeBank).toBe(0);
    expect(s.warp).toBe(1);
  });
});

describe('offline', () => {
  it('applies 80% of time away and banks the rest', () => {
    const s = fresh();
    const rate = stageRate(s, 'soup').toNumber();
    const r = applyOffline(s, 3600 * 1000);
    near(r.appliedSec, 2880);
    near(r.bankedSec, 720);
    near(s.stages.soup.currency.toNumber(), rate * 2880);
    expect(s.lastSeen).toBe(3600 * 1000);
  });

  it('respects the offline cap and the bank cap', () => {
    const s = fresh();
    const r = applyOffline(s, 100 * 3600 * 1000);
    expect(r.capped).toBe(true);
    near(r.appliedSec, s.offlineCapSec * 0.8);
    expect(s.timeBank).toBeLessThanOrEqual(timeBankCap(s));
  });

  it('short absences are caught up in full with nothing banked', () => {
    const s = fresh();
    const r = applyOffline(s, 10 * 1000);
    near(r.appliedSec, 10);
    expect(r.bankedSec).toBe(0);
  });

  it('keeps finished stages buying while away', () => {
    const s = fresh();
    s.stages.soup.currency = D(STAGES.soup.goal);
    evolve(s);
    s.stages.soup.generators.amino = 5;
    applyOffline(s, 2 * 3600 * 1000);
    expect(s.stages.soup.generators.amino).toBeGreaterThan(5);
  });
});

describe('before the first action', () => {
  it('nothing is produced and no time passes', () => {
    const s = createState(0);
    tick(s, 60);
    expect(s.stages.soup.currency.toNumber()).toBe(0);
    expect(s.playTime).toBe(0);
  });

  it('time away before starting is not counted or banked', () => {
    const s = createState(0);
    const r = applyOffline(s, 3600 * 1000);
    expect(r.appliedSec).toBe(0);
    expect(s.timeBank).toBe(0);
    expect(s.lastSeen).toBe(3600 * 1000);
  });

  it('the first tap starts production', () => {
    const s = createState(0);
    tap(s);
    expect(s.started).toBe(true);
    tick(s, 10);
    expect(s.stages.soup.currency.toNumber()).toBeGreaterThan(1);
  });

  it('old saves from players who had played count as started', () => {
    const s = fresh();
    s.playTime = 50;
    const saved = JSON.parse(serialize(s));
    delete saved.started;
    expect(deserialize(JSON.stringify(saved)).started).toBe(true);
  });
});

describe('saves', () => {
  it('round-trips through JSON and the export string', () => {
    const s = createState(1234);
    s.stages.soup.currency = D('1.5e400');
    s.stages.soup.generators.rna = 12;
    s.stages.soup.upgrades.push('warmVents');
    s.timeBank = 99;
    const a = deserialize(serialize(s));
    const b = importSave(exportSave(s));
    for (const x of [a, b]) {
      expect(x.stages.soup.currency.eq(s.stages.soup.currency)).toBe(true);
      expect(x.stages.soup.generators.rna).toBe(12);
      expect(x.stages.soup.upgrades).toEqual(['warmVents']);
      expect(x.timeBank).toBe(99);
      expect(x.lastSeen).toBe(1234);
    }
  });

  it('fills in generators added after the save was made', () => {
    const s = fresh();
    const saved = JSON.parse(serialize(s));
    delete saved.stages.soup.generators.protocell;
    expect(deserialize(JSON.stringify(saved)).stages.soup.generators.protocell).toBe(0);
  });
});
