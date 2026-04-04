import { describe, expect, it } from 'vitest';
import { createSkillChallenge, contributeCheck } from './skill-challenge';

const baseStats = { str: 14, dex: 16, con: 12, int: 10, wis: 13, cha: 8 } as const;

function makeParams(overrides: { rawRoll: number; skill?: any; ability?: any }) {
  return {
    characterName: 'TestChar',
    stats: baseStats,
    level: 5,
    proficientSkills: [] as any[],
    ...overrides,
  };
}

describe('skill-challenge', () => {
  it('creates a skill challenge with correct defaults', () => {
    const sc = createSkillChallenge({
      name: 'Chase',
      description: 'Catch the thief!',
      dc: 13,
      successesNeeded: 3,
      failuresAllowed: 2,
    });
    expect(sc.currentSuccesses).toBe(0);
    expect(sc.currentFailures).toBe(0);
    expect(sc.completedChecks).toHaveLength(0);
    expect(sc.allowedSkills).toEqual([]);
  });

  it('accumulates successes', () => {
    let sc = createSkillChallenge({
      name: 'Chase',
      description: 'Catch the thief!',
      dc: 10,
      successesNeeded: 3,
      failuresAllowed: 3,
    });
    // Roll 15 + dex mod 3 = 18 >= 10 -> success
    const r1 = contributeCheck(sc, makeParams({ rawRoll: 15, skill: 'stealth' }));
    expect(r1.checkResult.success).toBe(true);
    expect(r1.challenge.currentSuccesses).toBe(1);
    expect(r1.outcome).toBe('in_progress');

    const r2 = contributeCheck(r1.challenge, makeParams({ rawRoll: 12, skill: 'acrobatics' }));
    expect(r2.challenge.currentSuccesses).toBe(2);
    expect(r2.outcome).toBe('in_progress');

    const r3 = contributeCheck(r2.challenge, makeParams({ rawRoll: 10, skill: 'athletics' }));
    expect(r3.challenge.currentSuccesses).toBe(3);
    expect(r3.outcome).toBe('success');
  });

  it('accumulates failures and ends on threshold', () => {
    let sc = createSkillChallenge({
      name: 'Negotiate',
      description: 'Convince the guard',
      dc: 18,
      successesNeeded: 3,
      failuresAllowed: 2,
    });
    // Roll 2 + str mod 2 = 4 < 18 -> failure
    const r1 = contributeCheck(sc, makeParams({ rawRoll: 2, ability: 'str' }));
    expect(r1.checkResult.success).toBe(false);
    expect(r1.challenge.currentFailures).toBe(1);
    expect(r1.outcome).toBe('in_progress');

    const r2 = contributeCheck(r1.challenge, makeParams({ rawRoll: 3, ability: 'str' }));
    expect(r2.challenge.currentFailures).toBe(2);
    expect(r2.outcome).toBe('failure');
  });

  it('throws when challenge is already resolved', () => {
    const sc = createSkillChallenge({
      name: 'Test',
      description: 'test',
      dc: 5,
      successesNeeded: 1,
      failuresAllowed: 1,
    });
    // Roll 15 + dex 3 = 18 >= 5 -> success, challenge resolved
    const r1 = contributeCheck(sc, makeParams({ rawRoll: 15, skill: 'stealth' }));
    expect(r1.outcome).toBe('success');

    expect(() => contributeCheck(r1.challenge, makeParams({ rawRoll: 10, skill: 'stealth' }))).toThrow('already success');
  });

  it('rejects disallowed skills', () => {
    const sc = createSkillChallenge({
      name: 'Locked',
      description: 'Only certain skills',
      dc: 10,
      successesNeeded: 2,
      failuresAllowed: 2,
      allowedSkills: ['stealth', 'acrobatics'],
    });

    expect(() => contributeCheck(sc, makeParams({ rawRoll: 15, skill: 'athletics' }))).toThrow('not allowed');
  });

  it('tracks completed checks in the challenge', () => {
    const sc = createSkillChallenge({
      name: 'Track',
      description: 'test',
      dc: 10,
      successesNeeded: 5,
      failuresAllowed: 5,
    });
    const r1 = contributeCheck(sc, makeParams({ rawRoll: 15, skill: 'perception' }));
    expect(r1.challenge.completedChecks).toHaveLength(1);
    expect(r1.challenge.completedChecks[0].characterName).toBe('TestChar');
    expect(r1.challenge.completedChecks[0].success).toBe(true);

    const r2 = contributeCheck(r1.challenge, makeParams({ rawRoll: 1, skill: 'perception' }));
    expect(r2.challenge.completedChecks).toHaveLength(2);
  });

  it('includes progress in summary', () => {
    const sc = createSkillChallenge({
      name: 'Chase',
      description: 'test',
      dc: 10,
      successesNeeded: 3,
      failuresAllowed: 2,
    });
    const r1 = contributeCheck(sc, makeParams({ rawRoll: 15, skill: 'stealth' }));
    expect(r1.summary).toContain('1/3 successes');
    expect(r1.summary).toContain('0/2 failures');
  });
});
