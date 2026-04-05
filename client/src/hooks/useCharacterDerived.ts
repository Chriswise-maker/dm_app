import { useMemo } from 'react';
import type { ActorSheet } from '../../../server/kernel/actor-sheet';
import type { ActorState } from '../../../server/kernel/actor-state';

const SKILLS: { name: string; ability: 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha' }[] = [
  { name: 'Acrobatics', ability: 'dex' },
  { name: 'Animal Handling', ability: 'wis' },
  { name: 'Arcana', ability: 'int' },
  { name: 'Athletics', ability: 'str' },
  { name: 'Deception', ability: 'cha' },
  { name: 'History', ability: 'int' },
  { name: 'Insight', ability: 'wis' },
  { name: 'Intimidation', ability: 'cha' },
  { name: 'Investigation', ability: 'int' },
  { name: 'Medicine', ability: 'wis' },
  { name: 'Nature', ability: 'int' },
  { name: 'Perception', ability: 'wis' },
  { name: 'Performance', ability: 'cha' },
  { name: 'Persuasion', ability: 'cha' },
  { name: 'Religion', ability: 'int' },
  { name: 'Sleight of Hand', ability: 'dex' },
  { name: 'Stealth', ability: 'dex' },
  { name: 'Survival', ability: 'wis' },
];

export interface SkillEntry {
  name: string;
  ability: string;
  modifier: number;
  proficient: boolean;
}

export interface AbilityEntry {
  key: string;
  label: string;
  score: number;
  modifier: number;
  saveProficient: boolean;
  saveModifier: number;
}

export interface CharacterDerived {
  abilities: AbilityEntry[];
  skills: SkillEntry[];
  proficiencyBonus: number;
  passivePerception: number;
  initiativeModifier: number;
}

function abilityMod(score: number): number {
  return Math.floor((score - 10) / 2);
}

function formatMod(mod: number): string {
  return mod >= 0 ? `+${mod}` : `${mod}`;
}

export { formatMod, abilityMod };

export function useCharacterDerived(
  sheet: ActorSheet | null | undefined,
  _state: ActorState | null | undefined,
): CharacterDerived | null {
  return useMemo(() => {
    if (!sheet) return null;

    const profBonus = sheet.proficiencyBonus;
    const scores = sheet.abilityScores;
    const proficientSaves = new Set(sheet.proficiencies.saves);
    /** Match sheet strings whether they use spaces, underscores, or hyphens (e.g. sleight_of_hand vs "Sleight of Hand"). */
    const normalizeSkillKey = (s: string) =>
      s.toLowerCase().replace(/[\s_-]+/g, ' ').trim();
    const proficientSkills = new Set(
      sheet.proficiencies.skills.map((s: string) => normalizeSkillKey(s)),
    );

    const abilities: AbilityEntry[] = (
      ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const
    ).map((key) => {
      const score = scores[key];
      const mod = abilityMod(score);
      const saveProficient = proficientSaves.has(key);
      return {
        key,
        label: key.charAt(0).toUpperCase() + key.slice(1),
        score,
        modifier: mod,
        saveProficient,
        saveModifier: mod + (saveProficient ? profBonus : 0),
      };
    });

    const skills: SkillEntry[] = SKILLS.map((skill) => {
      const mod = abilityMod(scores[skill.ability]);
      const proficient = proficientSkills.has(normalizeSkillKey(skill.name));
      return {
        name: skill.name,
        ability: skill.ability.toUpperCase(),
        modifier: mod + (proficient ? profBonus : 0),
        proficient,
      };
    });

    const wisMod = abilityMod(scores.wis);
    const perceptionProficient = proficientSkills.has(normalizeSkillKey('Perception'));
    const passivePerception = 10 + wisMod + (perceptionProficient ? profBonus : 0);

    const initiativeModifier = abilityMod(scores.dex);

    return {
      abilities,
      skills,
      proficiencyBonus: profBonus,
      passivePerception,
      initiativeModifier,
    };
  }, [sheet, _state]);
}
