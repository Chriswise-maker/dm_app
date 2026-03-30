import type { AbilityStat } from './actor-sheet';
import type { Modifier } from './effect-types';

export interface CheckInput {
  type: 'attack' | 'save' | 'ability_check' | 'contest';
  abilityScores: { str: number; dex: number; con: number; int: number; wis: number; cha: number };
  proficiencyBonus: number;
  stat: AbilityStat;
  isProficient: boolean;
  activeModifiers: Modifier[];
  dc?: number;
  targetAC?: number;
  preRolledD20?: number;
  rollFn?: () => number;
  hasAdvantage?: boolean;
  hasDisadvantage?: boolean;
}

export interface CheckResult {
  d20Roll: number;
  secondD20?: number;
  usedAdvantage: boolean;
  usedDisadvantage: boolean;
  abilityMod: number;
  proficiencyMod: number;
  effectBonuses: number;
  total: number;
  success: boolean;
  isCritical: boolean;
  isFumble: boolean;
}

export function getAbilityMod(score: number): number {
  return Math.floor((score - 10) / 2);
}

export function resolveCheck(input: CheckInput): CheckResult {
  const {
    type,
    abilityScores,
    proficiencyBonus,
    stat,
    isProficient,
    activeModifiers,
    dc,
    targetAC,
    preRolledD20,
    rollFn,
    hasAdvantage: callerAdvantage,
    hasDisadvantage: callerDisadvantage,
  } = input;

  // 1. Ability modifier
  const abilityMod = getAbilityMod(abilityScores[stat]);

  // 2. Proficiency
  const proficiencyMod = isProficient ? proficiencyBonus : 0;

  // 3. Sum matching effect bonuses
  let effectBonuses = 0;
  for (const mod of activeModifiers) {
    if (type === 'attack' && mod.type === 'attack_bonus') {
      effectBonuses += mod.value;
    } else if (type === 'save' && mod.type === 'save_bonus') {
      if (mod.stat === 'all' || mod.stat === stat) {
        effectBonuses += mod.value;
      }
    } else if (type === 'ability_check' && mod.type === 'stat_bonus') {
      if (mod.stat === stat) {
        effectBonuses += mod.value;
      }
    }
  }

  // 4. Determine advantage/disadvantage from effects + caller flags
  let hasAdv = !!callerAdvantage;
  let hasDisadv = !!callerDisadvantage;

  for (const mod of activeModifiers) {
    if (mod.type === 'advantage' && mod.on === type) {
      if (!mod.stat || mod.stat === stat) hasAdv = true;
    } else if (mod.type === 'disadvantage' && mod.on === type) {
      if (!mod.stat || mod.stat === stat) hasDisadv = true;
    }
  }

  // If both present, they cancel out
  const useAdvantage = hasAdv && !hasDisadv;
  const useDisadvantage = hasDisadv && !hasAdv;

  // 5. Roll d20
  const roll = preRolledD20 != null
    ? () => preRolledD20
    : rollFn ?? (() => Math.ceil(Math.random() * 20));

  let d20Roll: number;
  let secondD20: number | undefined;

  if (useAdvantage || useDisadvantage) {
    const first = roll();
    const second = roll();
    d20Roll = useAdvantage ? Math.max(first, second) : Math.min(first, second);
    secondD20 = d20Roll === first ? second : first;
  } else {
    d20Roll = roll();
  }

  // 6. Total
  const total = d20Roll + abilityMod + proficiencyMod + effectBonuses;

  // 7. Success determination
  const isCritical = d20Roll === 20;
  const isFumble = d20Roll === 1;

  let success: boolean;
  if (type === 'attack') {
    if (isCritical) success = true;
    else if (isFumble) success = false;
    else success = total >= (targetAC ?? 0);
  } else {
    // Saves and ability checks: no auto-pass/fail on nat 20/1 (5e 2014)
    success = total >= (dc ?? 0);
  }

  return {
    d20Roll,
    secondD20,
    usedAdvantage: useAdvantage,
    usedDisadvantage: useDisadvantage,
    abilityMod,
    proficiencyMod,
    effectBonuses,
    total,
    success,
    isCritical,
    isFumble,
  };
}
