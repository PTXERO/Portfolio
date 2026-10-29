import { describe, expect, it } from 'vitest';
import { STAGES } from '../src/content/stages';
import {
  addSwirl,
  affordableCount,
  buyGenerator,
  buyUpgrade,
  canEvolve,
  engulf,
  engulfable,
  evolve,
  forage,
  upgradeCost,
  visitStage,
  generatorCost,
  generatorVisible,
  moveHabitat,
  setDial,
  tap,
  triggerFinale,
} from '../src/economy/actions';
import { D } from '../src/economy/num';
import { applyOffline, timeBankCap } from '../src/economy/offline';
import { defenseOf, dialMax, guardLevel, dietOf, forageMult, habitatMult, heroSpeed, milestonesReached, offlineBonusSec, spawnMult, stageRate, upgradeLevel } from '../src/economy/rates';
import { deserialize, exportSave, importSave, serialize } from '../src/economy/save';
import { cloneState, createState } from '../src/economy/state';
import { liveTick, tick } from '../src/economy/tick';
import { breed, buyPart, court, courtChance, equipPart, startTrip, statsOf, tripChance } from '../src/economy/creature';

/** A game where the player has already made their first move. */
function fresh() {
  const s = createState(0);
  s.started = true;
  return s;
}

/** Skips to the end of the Soup: every reaction found, then evolve into Cell. */
function finishSoup(s: ReturnType<typeof createState>) {
  s.stages.soup.discovered = STAGES.soup.reactions!.map((r) => r.id);
  expect(evolve(s)).toBe(true);
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
    s.stages.soup.generators.amino = 25;
    const before = stageRate(s, 'soup').toNumber();
    s.stages.soup.currency = D(1e6);
    expect(buyUpgrade(s, 'soup', 'aminoChains')).toBe(true);
    near(stageRate(s, 'soup').toNumber(), before * 2);
  });

  it('a finished stage boosts the next one', () => {
    const s = fresh();
    s.stages.soup.generators.amino = 200;
    finishSoup(s);
    const fed = stageRate(s, 'cell').toNumber();
    const unfed = cloneState(s);
    unfed.stages.soup.complete = false;
    expect(fed).toBeGreaterThan(stageRate(unfed, 'cell').toNumber());
  });
});

describe('stages', () => {
  it('the Soup ends on the Spark of Life, which needs everything at once and costs nutrients', () => {
    const s = fresh();
    const spark = STAGES.soup.reactions!.find((r) => r.final)!;
    s.stages.soup.discovered = STAGES.soup.reactions!.filter((r) => !r.final).map((r) => r.id);
    s.stages.soup.upgrades.push('thunderhead', 'clearSkies', 'volcanic');
    s.stages.soup.generators.protocell = 20;
    s.stages.soup.currency = D(spark.cost! * 1.5);
    expect(triggerFinale(s)).toBe(false); // dials and whirlpool not right yet
    setDial(s, 'soup', 'heat', 1);
    setDial(s, 'soup', 'light', 2);
    setDial(s, 'soup', 'charge', 3);
    expect(triggerFinale(s)).toBe(false); // no whirlpool
    s.swirl = 1;
    expect(canEvolve(s)).toBe(false);
    expect(triggerFinale(s)).toBe(true);
    near(s.stages.soup.currency.toNumber(), spark.cost! * 0.5);
    expect(canEvolve(s)).toBe(true);
    evolve(s);
    expect(s.current).toBe('cell');
    expect(s.stages.soup.complete).toBe(true);
    expect(s.stages.cell.generators.fission).toBe(1);
  });

  it('the last stage cannot evolve yet', () => {
    const s = fresh();
    finishSoup(s);
    s.stages.cell.currency = D(STAGES.cell.goal * 10);
    expect(canEvolve(s)).toBe(false);
  });

  it('tapping only works where the stage has taps', () => {
    const s = fresh();
    expect(tap(s).toNumber()).toBe(1);
    finishSoup(s);
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

  it('keeps finished stages producing while away (growing them is up to the player)', () => {
    const s = fresh();
    finishSoup(s);
    s.stages.soup.generators.amino = 5;
    const before = s.stages.soup.currency;
    applyOffline(s, 2 * 3600 * 1000);
    expect(s.stages.soup.generators.amino).toBe(5);
    expect(s.stages.soup.currency.gt(before)).toBe(true);
  });
});

describe('dials', () => {
  it('stay locked until a boost unlocks them, and only turn as far as allowed', () => {
    const s = fresh();
    expect(dialMax(s, 'soup', 'heat')).toBe(0);
    expect(setDial(s, 'soup', 'heat', 1)).toBe(false);
    s.stages.soup.upgrades.push('warmVents');
    expect(setDial(s, 'soup', 'heat', 2)).toBe(true);
    expect(setDial(s, 'soup', 'heat', 3)).toBe(false);
  });

  it('change what each molecule produces', () => {
    const s = fresh();
    s.stages.soup.upgrades.push('warmVents');
    const cold = stageRate(s, 'soup').toNumber();
    setDial(s, 'soup', 'heat', 2);
    const amino = STAGES.soup.generators.find((g) => g.id === 'amino')!;
    near(stageRate(s, 'soup').toNumber(), (cold / amino.prefs!.heat![0]) * amino.prefs!.heat![2]);
  });
});

describe('reactions', () => {
  it('are discovered the moment their conditions all hold, and reveal a molecule', () => {
    const s = fresh();
    const peptide = STAGES.soup.generators.find((g) => g.id === 'peptide')!;
    expect(generatorVisible(s, 'soup', peptide)).toBe(false);
    s.stages.soup.generators.amino = 15;
    tick(s, 0.1);
    expect(s.stages.soup.discovered).toEqual([]); // cold water: no bond yet
    s.stages.soup.upgrades.push('warmVents');
    setDial(s, 'soup', 'heat', 1);
    tick(s, 0.1);
    expect(s.stages.soup.discovered).toEqual(['peptideBond']);
    expect(s.news).toEqual(['peptideBond']);
    expect(generatorVisible(s, 'soup', peptide)).toBe(true);
  });

  it('that need a whirlpool only happen while one spins', () => {
    const s = fresh();
    s.stages.soup.discovered = ['peptideBond', 'formose', 'selfAssembly', 'phosphorylation'];
    s.stages.soup.generators.nucleotide = 20;
    applyOffline(s, 3600 * 1000);
    expect(s.stages.soup.discovered).not.toContain('polymerization');
    addSwirl(s, 3);
    expect(s.swirl).toBeGreaterThan(0.5);
    tick(s, 0.1);
    expect(s.stages.soup.discovered).toContain('polymerization');
  });

  it('the whirlpool fades by itself and boosts output while it lasts', () => {
    const s = fresh();
    const calm = stageRate(s, 'soup').toNumber();
    addSwirl(s, 10);
    expect(s.swirl).toBe(1);
    expect(stageRate(s, 'soup').toNumber()).toBeGreaterThan(calm);
    tick(s, 30);
    expect(s.swirl).toBe(0);
  });

  it('discovered reactions make free product while their conditions hold, without using anything up', () => {
    const s = fresh();
    s.stages.soup.discovered = ['peptideBond'];
    s.stages.soup.upgrades.push('warmVents');
    s.stages.soup.generators.amino = 100;
    s.stages.soup.generators.peptide = 10;
    const priceBefore = generatorCost(s, 'soup', 'peptide').toNumber();
    tick(s, 120); // cold water: the bond doesn't hold
    expect(s.stages.soup.generators.peptide).toBe(10);
    setDial(s, 'soup', 'heat', 1);
    for (let i = 0; i < 60; i++) tick(s, 1);
    const made = s.stages.soup.generators.peptide - 10;
    expect(made).toBeGreaterThan(0);
    expect(s.stages.soup.free.peptide).toBe(made);
    expect(s.stages.soup.generators.amino).toBe(100);
    expect(s.made).toContain('peptideBond');
    // Free molecules don't make buying more expensive.
    near(generatorCost(s, 'soup', 'peptide').toNumber(), priceBefore);
  });

  it('once known, reactions that needed a whirlpool keep producing without one', () => {
    const s = fresh();
    s.stages.soup.discovered = ['peptideBond', 'formose', 'selfAssembly', 'phosphorylation', 'polymerization', 'ribozyme', 'encapsulation'];
    s.stages.soup.generators.lipid = 100;
    s.stages.soup.generators.rna = 30;
    expect(s.swirl).toBe(0);
    for (let i = 0; i < 1200; i++) tick(s, 1);
    expect(s.stages.soup.free.protocell ?? 0).toBeGreaterThan(0);
  });

  it('old saves count owned molecules as discovered', () => {
    const s = fresh();
    s.stages.soup.generators.lipid = 3;
    const back = deserialize(serialize(s));
    expect(back.stages.soup.discovered).toEqual(['peptideBond', 'formose', 'selfAssembly']);
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

describe('cell stage', () => {
  function cell() {
    const s = fresh();
    finishSoup(s);
    s.stages.cell.currency = D(1e30);
    return s;
  }

  it('diets are a choice: buying one hides the other', () => {
    const s = cell();
    expect(buyUpgrade(s, 'cell', 'grazer')).toBe(true);
    expect(buyUpgrade(s, 'cell', 'hunter')).toBe(false);
    expect(buyUpgrade(s, 'cell', 'omnivore')).toBe(false);
    expect(dietOf(s, 'cell')).toBe('grazer');
    // Each diet grows its own branch.
    expect(buyUpgrade(s, 'cell', 'lightHarvest')).toBe(true);
    expect(buyUpgrade(s, 'cell', 'pursuit')).toBe(false);
    // A save holding two diets (from before) keeps just one.
    s.stages.cell.upgrades.push('omnivore');
    expect(deserialize(serialize(s)).stages.cell.upgrades.filter((u) => ['grazer', 'hunter', 'omnivore'].includes(u))).toEqual(['omnivore']);
  });

  it('habitats open with mutations, and diet decides how well you do there', () => {
    const s = cell();
    buyUpgrade(s, 'cell', 'thickMembrane');
    expect(moveHabitat(s, 'cell', 'depths')).toBe(false); // needs level 2
    expect(buyUpgrade(s, 'cell', 'chemoreceptor')).toBe(false); // a Depths mutation
    buyUpgrade(s, 'cell', 'thickMembrane');
    buyUpgrade(s, 'cell', 'hunter');
    const before = habitatMult(s, 'cell');
    expect(moveHabitat(s, 'cell', 'depths')).toBe(true);
    expect(habitatMult(s, 'cell')).toBeGreaterThan(before);
  });

  it('each habitat has its own lineup, opened with the habitat', () => {
    const s = cell();
    const ambusher = STAGES.cell.generators.find((g) => g.id === 'ambusher')!;
    expect(generatorVisible(s, 'cell', ambusher)).toBe(false);
    buyUpgrade(s, 'cell', 'thickMembrane');
    buyUpgrade(s, 'cell', 'thickMembrane');
    expect(generatorVisible(s, 'cell', ambusher)).toBe(true);
    // It produces by its own habitat's fit, wherever you're looking.
    buyUpgrade(s, 'cell', 'grazer');
    s.stages.cell.generators.ambusher = 10;
    const inShallows = stageRate(s, 'cell').toNumber();
    moveHabitat(s, 'cell', 'depths');
    expect(stageRate(s, 'cell').toNumber()).toBeCloseTo(inShallows, 6);
  });

  it('mutations come in levels, each dearer and each adding its effect again', () => {
    const s = cell();
    const flag = STAGES.cell.upgrades.find((u) => u.id === 'flagellum')!;
    const c1 = upgradeCost(s, 'cell', flag);
    buyUpgrade(s, 'cell', 'flagellum');
    const c2 = upgradeCost(s, 'cell', flag);
    expect(c2.gt(c1)).toBe(true);
    for (let i = 0; i < 10; i++) buyUpgrade(s, 'cell', 'flagellum');
    expect(upgradeLevel(s, 'cell', 'flagellum')).toBe(flag.levels);
    expect(heroSpeed(s, 'cell')).toBeCloseTo(Math.pow((flag.effect as { mult: number }).mult, flag.levels!), 6);
  });

  it('heirlooms are paid for with the Soup\'s currency, and milestones there boost the Cell', () => {
    const s = cell();
    const dna = s.stages.cell.currency;
    s.stages.soup.currency = D(1e15);
    expect(buyUpgrade(s, 'cell', 'oldRecipes')).toBe(true);
    expect(s.stages.cell.currency.eq(dna)).toBe(true);
    expect(s.stages.soup.currency.lt(1e15)).toBe(true);
    s.stages.cell.generators.fission = 10;
    const before = stageRate(s, 'cell').toNumber();
    s.stages.soup.generators.protocell = 60;
    expect(stageRate(s, 'cell').toNumber()).toBeGreaterThan(before * 1.5);
  });

  it('a save sitting in a habitat that is no longer open goes back to the Shallows', () => {
    const s = cell();
    s.stages.cell.habitat = 'depths';
    expect(deserialize(serialize(s)).stages.cell.habitat).toBe('shallows');
  });

  it('every organelle is a permanent bonus that takes effect at once', () => {
    for (const r of STAGES.cell.reactions!.filter((x) => x.bonus)) {
      const s = cell();
      s.current = 'cell';
      Object.assign(s.stages.cell.generators, { fission: 50, colony: 20, thermophile: 5 });
      const measure = () => {
        const b = r.bonus!;
        if (b.kind === 'defense') return defenseOf(s, 'cell');
        if (b.kind === 'forageMult') return forageMult(s, 'cell');
        if (b.kind === 'offlineHours') return offlineBonusSec(s);
        if (b.kind === 'spawnMult') return spawnMult(s, 'cell');
        return stageRate(s, 'cell').toNumber();
      };
      const before = measure();
      s.stages.cell.discovered.push(r.id);
      const after = measure();
      expect(after, r.id).toBeGreaterThan(before);
      tick(s, 600);
      expect(measure(), `${r.id} still there later`).toBeGreaterThanOrEqual(after);
    }
  });

  it('your lineage settles into the habitat it lives in, and life there does better', () => {
    const s = cell();
    s.stages.cell.generators.fission = 50;
    const before = stageRate(s, 'cell').toNumber();
    tick(s, 15 * 60);
    expect(s.stages.cell.acclim.shallows).toBeCloseTo(0.5, 5);
    expect(stageRate(s, 'cell').toNumber()).toBeGreaterThan(before * 1.2);
    tick(s, 60 * 60);
    expect(s.stages.cell.acclim.shallows).toBe(1);
    expect(deserialize(serialize(s)).stages.cell.acclim.shallows).toBe(1);
  });

  it('Guard Instinct needs Spikes and an Eyespot, and grows with each level', () => {
    const s = cell();
    expect(buyUpgrade(s, 'cell', 'guardInstinct')).toBe(false);
    for (let i = 0; i < 3; i++) buyUpgrade(s, 'cell', 'thickMembrane');
    for (const u of ['thickMembrane', 'thickMembrane']) buyUpgrade(s, 'cell', u);
    moveHabitat(s, 'cell', 'depths');
    buyUpgrade(s, 'cell', 'spikes');
    buyUpgrade(s, 'cell', 'eyespot');
    expect(buyUpgrade(s, 'cell', 'guardInstinct')).toBe(true);
    buyUpgrade(s, 'cell', 'guardInstinct');
    expect(guardLevel(s, 'cell')).toBe(2);
  });

  it('each stage keeps its own clock for its finish screen', () => {
    const s = fresh();
    tick(s, 100);
    finishSoup(s);
    tick(s, 50);
    expect(s.stages.soup.time).toBeCloseTo(100, 6);
    expect(s.stages.cell.time).toBeCloseTo(50, 6);
  });

  it('endless upgrades never run out, each level a little dearer', () => {
    const s = cell();
    const u = STAGES.cell.upgrades.find((x) => x.id === 'adaptation')!;
    let last = upgradeCost(s, 'cell', u);
    for (let i = 0; i < 40; i++) {
      expect(buyUpgrade(s, 'cell', 'adaptation')).toBe(true);
      const next = upgradeCost(s, 'cell', u);
      expect(next.gt(last)).toBe(true);
      last = next;
    }
    expect(upgradeLevel(s, 'cell', 'adaptation')).toBe(40);
  });

  it('giving back: a Cell upgrade boosts the Soup, which feeds the Cell even more', () => {
    const s = cell();
    s.stages.cell.generators.fission = 50;
    s.stages.soup.generators.protocell = 20;
    s.stages.cell.currency = D(1e7);
    const soupBefore = stageRate(s, 'soup').toNumber();
    const cellBefore = stageRate(s, 'cell').toNumber();
    expect(buyUpgrade(s, 'cell', 'leakyMembranes')).toBe(true);
    expect(stageRate(s, 'soup').toNumber()).toBeCloseTo(soupBefore * 1.4, 3);
    expect(stageRate(s, 'cell').toNumber()).toBeGreaterThan(cellBefore);
    // Paid in DNA, not Nutrients.
    expect(s.stages.cell.currency.toNumber()).toBe(9e6);
  });

  it('you can go back to the Soup without it ending again', () => {
    const s = cell();
    expect(visitStage(s, 'soup')).toBe(true);
    expect(canEvolve(s)).toBe(false);
    expect(evolve(s)).toBe(false);
    expect(visitStage(s, 'cell')).toBe(true);
    expect(s.stages.cell.currency.gt(0)).toBe(true);
  });

  it('organelles are engulfed only when their conditions hold', () => {
    const s = cell();
    expect(engulf(s, 'cell', 'chloroplast')).toBe(false);
    buyUpgrade(s, 'cell', 'grazer');
    // It also needs the lineage settled into the Shallows a little.
    expect(engulfable(s, 'cell').map((r) => r.id)).not.toContain('chloroplast');
    tick(s, 0.25 * 30 * 60);
    expect(engulfable(s, 'cell').map((r) => r.id)).toContain('chloroplast');
    // And it takes a couple of catches.
    expect(engulf(s, 'cell', 'chloroplast')).toBe('caught');
    expect(s.stages.cell.discovered).not.toContain('chloroplast');
    expect(engulf(s, 'cell', 'chloroplast')).toBe('found');
    expect(s.stages.cell.discovered).toContain('chloroplast');
    expect(s.news).toContain('chloroplast');
    // Organelles are never discovered by just waiting.
    const t = fresh();
    finishSoup(t);
    t.stages.cell.currency = D(1e30);
    buyUpgrade(t, 'cell', 'grazer');
    tick(t, 10);
    expect(t.stages.cell.discovered).not.toContain('chloroplast');
  });

  it('a cell eats nothing until it has a diet, then only its own food', () => {
    const s = cell();
    s.stages.cell.generators.fission = 100;
    expect(forage(s, 'algae').eq(0)).toBe(true);
    buyUpgrade(s, 'cell', 'grazer');
    expect(forage(s, 'algae').gt(0)).toBe(true);
    expect(forage(s, 'bacteria').eq(0)).toBe(true);
    expect(s.stages.cell.eaten).toBe(1);
  });

  it('multicellularity ends the stage and opens the next', () => {
    const s = cell();
    s.stages.cell.discovered = STAGES.cell.reactions!.filter((r) => !r.final).map((r) => r.id);
    Object.assign(s.stages.cell.generators, { colony: 40, pack: 10 });
    buyUpgrade(s, 'cell', 'bigger');
    for (let i = 0; i < 5; i++) buyUpgrade(s, 'cell', 'cytoplasm');
    buyUpgrade(s, 'cell', 'giant');
    expect(triggerFinale(s)).toBe(false); // the Vents still need a reef
    s.stages.cell.generators.reef = 10;
    expect(triggerFinale(s)).toBe(true);
    expect(canEvolve(s)).toBe(true);
  });
});

describe('creature stage', () => {
  function creatureGame() {
    const s = fresh();
    finishSoup(s);
    s.stages.cell.discovered = STAGES.cell.reactions!.map((r) => r.id);
    expect(evolve(s)).toBe(true);
    expect(s.current).toBe('creature');
    return s;
  }

  it('starts with a simple body that its parts add up to', () => {
    const s = creatureGame();
    expect(s.stages.creature.equipped.legs).toBe('nubs');
    expect(statsOf(s).speed).toBe(2);
    s.stages.creature.currency = D(1e6);
    expect(buyPart(s, 'stubby')).toBe(true);
    expect(s.stages.creature.equipped.legs).toBe('stubby');
    expect(statsOf(s).speed).toBe(4);
    expect(equipPart(s, 'nubs')).toBe(true);
    expect(statsOf(s).speed).toBe(2);
  });

  it('expeditions take time, pay out and bring back a page, a part and a first mate', () => {
    const s = creatureGame();
    s.stages.creature.generators.hatchling = 10;
    expect(startTrip(s, 'shore')).toBe(true);
    expect(startTrip(s, 'shore')).toBe(false); // one at a time
    expect(startTrip(s, 'tidePools')).toBe(false); // not open yet
    const before = s.stages.creature.currency;
    tick(s, 30);
    expect(s.stages.creature.trip).not.toBeNull();
    tick(s, 120);
    expect(s.stages.creature.trip).toBeNull();
    expect(s.stages.creature.discovered).toContain('shore');
    expect(s.stages.creature.parts).toContain('shell');
    expect(s.stages.creature.mates.length).toBe(1);
    expect(s.stages.creature.currency.gt(before)).toBe(true);
    expect(s.reports.at(-1)?.kind).toBe('trip');
  });

  it('a weak creature often fails somewhere hard; a strong one never does', () => {
    const s = creatureGame();
    const cliffs = STAGES.creature.places!.find((p) => p.id === 'cliffs')!;
    expect(tripChance(s, cliffs)).toBeLessThan(0.1);
    s.stages.creature.upgrades.push('trainStrength', 'trainToughness');
    s.stages.creature.levels.trainStrength = 20;
    s.stages.creature.levels.trainToughness = 20;
    expect(tripChance(s, cliffs)).toBe(1);
  });

  it('breeding lays an egg that hatches into a stronger generation with the mate\'s parts', () => {
    const s = creatureGame();
    s.stages.creature.mates.push({ id: 1, name: 'Fern', parts: { legs: 'runner' } });
    const rate = () => stageRate(s, 'creature').toNumber();
    s.stages.creature.generators.hatchling = 10;
    const before = rate();
    expect(breed(s, 1)).toBe(true);
    expect(s.stages.creature.mates.length).toBe(0);
    tick(s, 500);
    expect(s.stages.creature.generation).toBe(1);
    expect(s.stages.creature.parts).toContain('runner');
    expect(rate()).toBeGreaterThan(before * 1.2);
    expect(statsOf(s).charm).toBe(2);
  });

  it('a visitor on the shore can be courted, more easily with Charm, up to three mates', () => {
    const s = creatureGame();
    expect(court(s, () => 0.99)).toBe(null);
    expect(court(s, () => 0)).not.toBe(null);
    s.stages.creature.upgrades.push('trainCharm');
    s.stages.creature.levels.trainCharm = 20;
    expect(courtChance(s)).toBe(1);
    court(s);
    court(s);
    expect(court(s)).toBe(null);
    expect(s.stages.creature.mates.length).toBe(3);
  });

  it('inherits the Cell diet for what it can eat', () => {
    const s = creatureGame();
    expect(dietOf(s, 'creature')).toBe(null);
    s.stages.cell.upgrades.push('hunter');
    expect(dietOf(s, 'creature')).toBe('hunter');
  });

  it('a creature save survives a round trip, mid-expedition and mid-egg', () => {
    const s = creatureGame();
    startTrip(s, 'shore');
    s.stages.creature.mates.push({ id: 2, name: 'Silt', parts: {} });
    breed(s, 2);
    const back = deserialize(serialize(s));
    expect(back.stages.creature.trip?.place).toBe('shore');
    expect(back.stages.creature.egg?.mate.name).toBe('Silt');
  });
});
