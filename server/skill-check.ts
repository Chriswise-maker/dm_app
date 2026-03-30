import { DiceRoll } from "@dice-roller/rpg-dice-roller";

export const ABILITY_NAMES = ["str", "dex", "con", "int", "wis", "cha"] as const;
export type AbilityName = (typeof ABILITY_NAMES)[number];

export const SKILL_TO_ABILITY = {
    acrobatics: "dex",
    animal_handling: "wis",
    arcana: "int",
    athletics: "str",
    deception: "cha",
    history: "int",
    insight: "wis",
    intimidation: "cha",
    investigation: "int",
    medicine: "wis",
    nature: "int",
    perception: "wis",
    performance: "cha",
    persuasion: "cha",
    religion: "int",
    sleight_of_hand: "dex",
    stealth: "dex",
    survival: "wis",
} as const satisfies Record<string, AbilityName>;

export const SKILL_NAMES = Object.keys(SKILL_TO_ABILITY) as Array<keyof typeof SKILL_TO_ABILITY>;
export type SkillName = (typeof SKILL_NAMES)[number];

type RollLike = { total: number; rolls?: number[] };

export interface SkillCheckInput {
    characterName: string;
    stats: Record<AbilityName, number>;
    level: number;
    dc: number;
    ability?: AbilityName;
    skill?: SkillName;
    proficientSkills?: SkillName[];
    advantage?: boolean;
    disadvantage?: boolean;
    rawRoll?: number;
    rollFn?: (formula: string) => RollLike;
}

export interface SkillCheckResult {
    characterName: string;
    ability: AbilityName;
    skill?: SkillName;
    dc: number;
    rawRoll: number;
    modifier: number;
    proficiencyBonus: number;
    total: number;
    success: boolean;
    formula: string;
    summary: string;
}

function defaultRoll(formula: string): RollLike {
    const roll = new DiceRoll(formula);
    return {
        total: roll.total,
        rolls: roll.rolls.flatMap((group: any) => Array.isArray(group.rolls) ? group.rolls.map((die: any) => die.value) : []),
    };
}

export function getAbilityModifier(score: number): number {
    return Math.floor((score - 10) / 2);
}

export function getProficiencyBonus(level: number): number {
    if (level >= 17) return 6;
    if (level >= 13) return 5;
    if (level >= 9) return 4;
    if (level >= 5) return 3;
    return 2;
}

export function normalizeAbilityName(value?: string | null): AbilityName | undefined {
    if (!value) return undefined;
    const normalized = value.toLowerCase() as AbilityName;
    return ABILITY_NAMES.includes(normalized) ? normalized : undefined;
}

export function normalizeSkillName(value?: string | null): SkillName | undefined {
    if (!value) return undefined;
    const normalized = value.toLowerCase().replace(/[\s-]+/g, "_") as SkillName;
    return SKILL_NAMES.includes(normalized) ? normalized : undefined;
}

export function resolveSkillCheck(input: SkillCheckInput): SkillCheckResult {
    const skill = input.skill ? normalizeSkillName(input.skill) : undefined;
    const ability = input.ability ?? (skill ? SKILL_TO_ABILITY[skill] : "wis");
    const hasAdvantage = !!input.advantage && !input.disadvantage;
    const hasDisadvantage = !!input.disadvantage && !input.advantage;
    const formula = hasAdvantage ? "2d20kh1" : hasDisadvantage ? "2d20kl1" : "1d20";
    const roller = input.rollFn ?? defaultRoll;
    const rawRoll = input.rawRoll ?? roller(formula).total;
    const modifier = getAbilityModifier(input.stats[ability] ?? 10);
    const proficient = skill ? (input.proficientSkills ?? []).includes(skill) : false;
    const proficiencyBonus = proficient ? getProficiencyBonus(input.level) : 0;
    const total = rawRoll + modifier + proficiencyBonus;
    const success = total >= input.dc;
    const label = skill ? skill.replace(/_/g, " ") : `${ability.toUpperCase()} check`;
    const summary = `**${label[0].toUpperCase()}${label.slice(1)}:** ${input.characterName} rolls ${rawRoll}${modifier >= 0 ? ` + ${modifier}` : ` - ${Math.abs(modifier)}`}${proficiencyBonus > 0 ? ` + ${proficiencyBonus}` : ""} = **${total}** vs DC ${input.dc} — **${success ? "Success" : "Failure"}**.`;

    return {
        characterName: input.characterName,
        ability,
        skill,
        dc: input.dc,
        rawRoll,
        modifier,
        proficiencyBonus,
        total,
        success,
        formula,
        summary,
    };
}
