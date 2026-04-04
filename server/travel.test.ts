import { describe, expect, it } from 'vitest';
import { createTravel, advanceTravelDay, getMilesPerDay, PACE_PERCEPTION_MODIFIER, PACE_CAN_STEALTH } from './travel';

describe('travel', () => {
  it('creates travel with correct defaults', () => {
    const t = createTravel({
      destination: 'Waterdeep',
      distanceMiles: 100,
      pace: 'normal',
    });
    expect(t.milesCompleted).toBe(0);
    expect(t.encounterChance).toBe(20);
    expect(t.encounterCheckIntervalMiles).toBe(6);
    expect(t.completed).toBe(false);
    expect(t.encounters).toHaveLength(0);
  });

  it('fast pace covers 30 miles per day', () => {
    expect(getMilesPerDay('fast')).toBe(30);
  });

  it('normal pace covers 24 miles per day', () => {
    expect(getMilesPerDay('normal')).toBe(24);
  });

  it('slow pace covers 18 miles per day', () => {
    expect(getMilesPerDay('slow')).toBe(18);
  });

  it('fast pace has -5 passive Perception', () => {
    expect(PACE_PERCEPTION_MODIFIER.fast).toBe(-5);
    expect(PACE_PERCEPTION_MODIFIER.normal).toBe(0);
    expect(PACE_PERCEPTION_MODIFIER.slow).toBe(0);
  });

  it('only slow pace can stealth', () => {
    expect(PACE_CAN_STEALTH.fast).toBe(false);
    expect(PACE_CAN_STEALTH.normal).toBe(false);
    expect(PACE_CAN_STEALTH.slow).toBe(true);
  });

  it('advances travel and tracks miles', () => {
    const t = createTravel({
      destination: 'Neverwinter',
      distanceMiles: 50,
      pace: 'normal',
    });
    // No encounters (roll always > 20)
    const result = advanceTravelDay(t, () => 100);
    expect(result.milesAdvanced).toBe(24);
    expect(result.travel.milesCompleted).toBe(24);
    expect(result.completed).toBe(false);
    expect(result.summary).toContain('24 miles');
    expect(result.summary).toContain('Neverwinter');
  });

  it('completes travel when distance reached', () => {
    const t = createTravel({
      destination: 'Baldurs Gate',
      distanceMiles: 20,
      pace: 'normal',
    });
    const result = advanceTravelDay(t, () => 100);
    expect(result.milesAdvanced).toBe(20);
    expect(result.travel.milesCompleted).toBe(20);
    expect(result.completed).toBe(true);
    expect(result.summary).toContain('arrives at Baldurs Gate');
  });

  it('triggers encounter checks at correct intervals', () => {
    const t = createTravel({
      destination: 'Phandalin',
      distanceMiles: 100,
      pace: 'normal',
      encounterCheckIntervalMiles: 6,
    });
    // Normal pace = 24 miles. Intervals at 6, 12, 18, 24 = 4 checks.
    let rollCount = 0;
    const result = advanceTravelDay(t, () => {
      rollCount++;
      return 100; // no encounter
    });
    expect(rollCount).toBe(4);
    expect(result.encounterChecks).toHaveLength(4);
    expect(result.encounterChecks[0].atMile).toBe(6);
    expect(result.encounterChecks[1].atMile).toBe(12);
    expect(result.encounterChecks[2].atMile).toBe(18);
    expect(result.encounterChecks[3].atMile).toBe(24);
  });

  it('triggers encounter when roll <= encounterChance', () => {
    const t = createTravel({
      destination: 'Phandalin',
      distanceMiles: 100,
      pace: 'normal',
      encounterChance: 25,
      encounterCheckIntervalMiles: 12,
    });
    // 24 miles / 12 interval = 2 checks. First roll 10 (triggers), second roll 50 (no trigger).
    const rolls = [10, 50];
    let i = 0;
    const result = advanceTravelDay(t, () => rolls[i++]);
    expect(result.encounterChecks).toHaveLength(2);
    expect(result.encounterChecks[0].triggered).toBe(true);
    expect(result.encounterChecks[1].triggered).toBe(false);
    expect(result.summary).toContain('Random encounter triggered');
  });

  it('no encounter when roll > encounterChance', () => {
    const t = createTravel({
      destination: 'Phandalin',
      distanceMiles: 100,
      pace: 'normal',
      encounterChance: 20,
      encounterCheckIntervalMiles: 12,
    });
    const result = advanceTravelDay(t, () => 50);
    expect(result.encounterChecks.every(ec => !ec.triggered)).toBe(true);
    expect(result.summary).not.toContain('Random encounter triggered');
  });

  it('throws when travel is already completed', () => {
    const t = createTravel({
      destination: 'Phandalin',
      distanceMiles: 10,
      pace: 'fast',
    });
    const result = advanceTravelDay(t, () => 100);
    expect(result.completed).toBe(true);
    expect(() => advanceTravelDay(result.travel, () => 100)).toThrow('already completed');
  });

  it('multi-day travel accumulates progress', () => {
    let t = createTravel({
      destination: 'FarCity',
      distanceMiles: 60,
      pace: 'slow', // 18 miles/day
      encounterCheckIntervalMiles: 6,
    });

    const d1 = advanceTravelDay(t, () => 100);
    expect(d1.travel.milesCompleted).toBe(18);
    expect(d1.completed).toBe(false);
    // 18 miles / 6 interval = 3 checks
    expect(d1.encounterChecks).toHaveLength(3);

    const d2 = advanceTravelDay(d1.travel, () => 100);
    expect(d2.travel.milesCompleted).toBe(36);
    // Next checks at 24, 30, 36 = 3 more
    expect(d2.encounterChecks).toHaveLength(3);

    const d3 = advanceTravelDay(d2.travel, () => 100);
    expect(d3.travel.milesCompleted).toBe(54);

    const d4 = advanceTravelDay(d3.travel, () => 100);
    expect(d4.travel.milesCompleted).toBe(60);
    expect(d4.completed).toBe(true);
  });

  it('fast pace summary notes perception penalty', () => {
    const t = createTravel({ destination: 'X', distanceMiles: 100, pace: 'fast' });
    const result = advanceTravelDay(t, () => 100);
    expect(result.summary).toContain('-5 passive Perception');
  });

  it('slow pace summary notes stealth ability', () => {
    const t = createTravel({ destination: 'X', distanceMiles: 100, pace: 'slow' });
    const result = advanceTravelDay(t, () => 100);
    expect(result.summary).toContain('can use stealth');
  });
});
