/**
 * Combat Adapter — Bridge between CombatEntity format and kernel CheckResolver.
 *
 * Converts CombatEntity conditions/stats into kernel Modifier[] and provides
 * helpers for deriving proficiency, attack stat, and save proficiency.
 */

import { getAbilityMod } from './check-resolver';
import type { Modifier } from './effect-types';
import type { AbilityStat } from './actor-sheet';
import type { CombatEntity } from '../combat/combat-types';

export const DEFAULT_ABILITY_SCORES = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };

/**
 * Convert a CombatEntity's activeConditions to kernel Modifier[].
 * Maps D&D 5e conditions to their mechanical effects.
 */
export function getEntityModifiers(entity: CombatEntity): Modifier[] {
  const mods: Modifier[] = [];

  for (const cond of entity.activeConditions) {
    switch (cond.name) {
      case 'blinded':
        mods.push({ type: 'disadvantage', on: 'attack' });
        break;
      case 'frightened':
        mods.push({ type: 'disadvantage', on: 'attack' });
        break;
      case 'poisoned':
        mods.push({ type: 'disadvantage', on: 'attack' });
        mods.push({ type: 'disadvantage', on: 'ability_check' });
        break;
      case 'restrained':
        mods.push({ type: 'disadvantage', on: 'attack' });
        mods.push({ type: 'disadvantage', on: 'save', stat: 'dex' });
        break;
      case 'invisible':
        mods.push({ type: 'advantage', on: 'attack' });
        break;
      case 'stunned':
        // Stunned: auto-fail STR/DEX saves (engine handles), disadvantage on them for completeness
        mods.push({ type: 'disadvantage', on: 'save', stat: 'str' });
        mods.push({ type: 'disadvantage', on: 'save', stat: 'dex' });
        break;
      case 'prone':
        // Prone: disadvantage on attack rolls (engine handles melee/ranged distinction separately)
        mods.push({ type: 'disadvantage', on: 'attack' });
        break;
      case 'paralyzed':
        // Paralyzed: auto-fail STR/DEX saves (engine handles)
        mods.push({ type: 'disadvantage', on: 'save', stat: 'str' });
        mods.push({ type: 'disadvantage', on: 'save', stat: 'dex' });
        break;
      // charmed, deafened, grappled, incapacitated, petrified, unconscious, concentrating
      // — no direct modifier effects relevant to attack/save rolls here
    }
  }

  return mods;
}

/**
 * Derive proficiency bonus from entity. Uses entity's proficiencyBonus if set,
 * otherwise defaults to +2.
 */
export function getProficiencyBonus(entity: CombatEntity): number {
  return entity.proficiencyBonus ?? 2;
}

/**
 * Determine which ability stat applies for a weapon attack.
 * STR for melee, DEX for ranged.
 */
export function getAttackStat(entity: CombatEntity): AbilityStat {
  if (entity.isRanged) return 'dex';
  return 'str';
}

/**
 * Determine which ability stat applies for a spell attack.
 * Uses entity's spellcastingAbility if set, otherwise defaults to 'int'.
 */
export function getSpellAttackStat(entity: CombatEntity): AbilityStat {
  return entity.spellcastingAbility ?? 'int';
}

/**
 * Check if entity is proficient in a saving throw.
 * Uses entity's saveProficiencies array if populated.
 */
export function isProficientInSave(entity: CombatEntity, stat: AbilityStat): boolean {
  return entity.saveProficiencies?.includes(stat) ?? false;
}

/**
 * Safety check: if entity has an explicit attackModifier AND ability scores that
 * don't derive to the same value, return correction modifiers so resolveCheck
 * produces the correct total matching the entity's attackModifier.
 */
export function getAttackBonusCorrection(entity: CombatEntity): Modifier[] {
  const scores = entity.abilityScores ?? DEFAULT_ABILITY_SCORES;
  const stat = getAttackStat(entity);
  const abilityMod = getAbilityMod(scores[stat]);
  const prof = getProficiencyBonus(entity);
  const derived = abilityMod + prof;

  if (entity.attackModifier !== derived) {
    return [{ type: 'attack_bonus' as const, value: entity.attackModifier - derived }];
  }
  return [];
}
