import { describe, it, expect } from 'vitest';
import { resolveCheck, getAbilityMod, CheckInput } from '../check-resolver';
import type { Modifier } from '../effect-types';

function makeInput(overrides: Partial<CheckInput> & Pick<CheckInput, 'type' | 'stat'>): CheckInput {
  return {
    abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    proficiencyBonus: 2,
    isProficient: false,
    activeModifiers: [],
    ...overrides,
  };
}

/** Creates a rollFn that returns values in sequence */
function sequentialRolls(...values: number[]) {
  let i = 0;
  return () => values[i++];
}

describe('getAbilityMod', () => {
  it('computes standard D&D ability modifiers', () => {
    expect(getAbilityMod(10)).toBe(0);
    expect(getAbilityMod(16)).toBe(3);
    expect(getAbilityMod(14)).toBe(2);
    expect(getAbilityMod(15)).toBe(2);
    expect(getAbilityMod(8)).toBe(-1);
    expect(getAbilityMod(1)).toBe(-5);
  });
});

describe('resolveCheck', () => {
  // 1. Basic attack hit
  it('basic attack hit — STR 16, prof +2, roll 13 vs AC 15', () => {
    const result = resolveCheck(makeInput({
      type: 'attack',
      stat: 'str',
      abilityScores: { str: 16, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
      isProficient: true,
      targetAC: 15,
      rollFn: () => 13,
    }));
    expect(result.d20Roll).toBe(13);
    expect(result.abilityMod).toBe(3);
    expect(result.proficiencyMod).toBe(2);
    expect(result.total).toBe(18);
    expect(result.success).toBe(true);
  });

  // 2. Basic attack miss
  it('basic attack miss — STR 16, prof +2, roll 5 vs AC 15', () => {
    const result = resolveCheck(makeInput({
      type: 'attack',
      stat: 'str',
      abilityScores: { str: 16, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
      isProficient: true,
      targetAC: 15,
      rollFn: () => 5,
    }));
    expect(result.total).toBe(10);
    expect(result.success).toBe(false);
  });

  // 3. Save success
  it('save success — DEX 14, proficient, roll 12 vs DC 15', () => {
    const result = resolveCheck(makeInput({
      type: 'save',
      stat: 'dex',
      abilityScores: { str: 10, dex: 14, con: 10, int: 10, wis: 10, cha: 10 },
      isProficient: true,
      dc: 15,
      rollFn: () => 12,
    }));
    expect(result.abilityMod).toBe(2);
    expect(result.proficiencyMod).toBe(2);
    expect(result.total).toBe(16);
    expect(result.success).toBe(true);
  });

  // 4. Save failure
  it('save failure — CON 10, not proficient, roll 8 vs DC 15', () => {
    const result = resolveCheck(makeInput({
      type: 'save',
      stat: 'con',
      dc: 15,
      rollFn: () => 8,
    }));
    expect(result.total).toBe(8);
    expect(result.success).toBe(false);
  });

  // 5. Ability check
  it('ability check — INT 15, proficient, roll 11 vs DC 15', () => {
    const result = resolveCheck(makeInput({
      type: 'ability_check',
      stat: 'int',
      abilityScores: { str: 10, dex: 10, con: 10, int: 15, wis: 10, cha: 10 },
      isProficient: true,
      dc: 15,
      rollFn: () => 11,
    }));
    expect(result.abilityMod).toBe(2);
    expect(result.proficiencyMod).toBe(2);
    expect(result.total).toBe(15);
    expect(result.success).toBe(true);
  });

  // 6. Effect bonus stacking
  it('stacks multiple attack_bonus modifiers', () => {
    const mods: Modifier[] = [
      { type: 'attack_bonus', value: 1 },
      { type: 'attack_bonus', value: 2 },
    ];
    const result = resolveCheck(makeInput({
      type: 'attack',
      stat: 'str',
      activeModifiers: mods,
      targetAC: 10,
      rollFn: () => 10,
    }));
    expect(result.effectBonuses).toBe(3);
    expect(result.total).toBe(13); // 10 + 0 (ability) + 0 (prof) + 3 (effects)
  });

  // 7. Advantage — takes higher roll
  it('advantage — rolls 8 and 15, uses 15', () => {
    const result = resolveCheck(makeInput({
      type: 'attack',
      stat: 'str',
      hasAdvantage: true,
      targetAC: 10,
      rollFn: sequentialRolls(8, 15),
    }));
    expect(result.d20Roll).toBe(15);
    expect(result.secondD20).toBe(8);
    expect(result.usedAdvantage).toBe(true);
    expect(result.usedDisadvantage).toBe(false);
  });

  // 8. Disadvantage — takes lower roll
  it('disadvantage — rolls 18 and 6, uses 6', () => {
    const result = resolveCheck(makeInput({
      type: 'attack',
      stat: 'str',
      hasDisadvantage: true,
      targetAC: 10,
      rollFn: sequentialRolls(18, 6),
    }));
    expect(result.d20Roll).toBe(6);
    expect(result.secondD20).toBe(18);
    expect(result.usedDisadvantage).toBe(true);
  });

  // 9. Advantage + disadvantage cancel — straight roll
  it('advantage + disadvantage cancel to straight roll', () => {
    let rollCount = 0;
    const result = resolveCheck(makeInput({
      type: 'attack',
      stat: 'str',
      hasAdvantage: true,
      hasDisadvantage: true,
      targetAC: 10,
      rollFn: () => { rollCount++; return 12; },
    }));
    expect(rollCount).toBe(1); // rolled only once
    expect(result.usedAdvantage).toBe(false);
    expect(result.usedDisadvantage).toBe(false);
    expect(result.secondD20).toBeUndefined();
  });

  // 10. Nat 20 always hits
  it('nat 20 always hits even against AC 30', () => {
    const result = resolveCheck(makeInput({
      type: 'attack',
      stat: 'str',
      targetAC: 30,
      rollFn: () => 20,
    }));
    expect(result.success).toBe(true);
    expect(result.isCritical).toBe(true);
  });

  // 11. Nat 1 always misses
  it('nat 1 always misses even with high modifier', () => {
    const result = resolveCheck(makeInput({
      type: 'attack',
      stat: 'str',
      abilityScores: { str: 30, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, // +10
      isProficient: true,
      proficiencyBonus: 5,
      targetAC: 5,
      rollFn: () => 1,
    }));
    expect(result.success).toBe(false);
    expect(result.isFumble).toBe(true);
  });

  // 12. Nat 20/1 on saves don't auto-pass/fail (5e 2014)
  it('nat 20 on save does NOT auto-succeed', () => {
    const result = resolveCheck(makeInput({
      type: 'save',
      stat: 'dex',
      dc: 25,
      rollFn: () => 20,
    }));
    // total = 20 + 0 = 20 < 25
    expect(result.isCritical).toBe(true);
    expect(result.success).toBe(false);
  });

  it('nat 1 on save does NOT auto-fail', () => {
    const result = resolveCheck(makeInput({
      type: 'save',
      stat: 'wis',
      abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 20, cha: 10 }, // +5
      isProficient: true,
      proficiencyBonus: 6,
      dc: 10,
      rollFn: () => 1,
    }));
    // total = 1 + 5 + 6 = 12 >= 10
    expect(result.isFumble).toBe(true);
    expect(result.success).toBe(true);
  });

  // Effect-granted advantage
  it('advantage from effect modifier', () => {
    const mods: Modifier[] = [
      { type: 'advantage', on: 'attack' },
    ];
    const result = resolveCheck(makeInput({
      type: 'attack',
      stat: 'str',
      activeModifiers: mods,
      targetAC: 10,
      rollFn: sequentialRolls(5, 18),
    }));
    expect(result.usedAdvantage).toBe(true);
    expect(result.d20Roll).toBe(18);
  });

  // save_bonus with "all" stat
  it('save_bonus with stat "all" applies to any save', () => {
    const mods: Modifier[] = [
      { type: 'save_bonus', stat: 'all', value: 3 },
    ];
    const result = resolveCheck(makeInput({
      type: 'save',
      stat: 'cha',
      activeModifiers: mods,
      dc: 10,
      rollFn: () => 10,
    }));
    expect(result.effectBonuses).toBe(3);
  });

  // preRolledD20 takes priority
  it('uses preRolledD20 when provided', () => {
    const result = resolveCheck(makeInput({
      type: 'attack',
      stat: 'str',
      preRolledD20: 17,
      targetAC: 10,
      rollFn: () => 3, // should be ignored
    }));
    expect(result.d20Roll).toBe(17);
  });
});
