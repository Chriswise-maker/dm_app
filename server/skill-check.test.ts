import { describe, expect, it } from "vitest";
import { getAbilityModifier, getProficiencyBonus, resolveSkillCheck } from "./skill-check";

describe("skill-check", () => {
    it("calculates ability modifiers correctly", () => {
        expect(getAbilityModifier(8)).toBe(-1);
        expect(getAbilityModifier(10)).toBe(0);
        expect(getAbilityModifier(18)).toBe(4);
    });

    it("applies proficiency to a trained skill", () => {
        const result = resolveSkillCheck({
            characterName: "Nyx",
            stats: { str: 10, dex: 16, con: 12, int: 11, wis: 14, cha: 10 },
            level: 5,
            skill: "stealth",
            proficientSkills: ["stealth"],
            dc: 15,
            rawRoll: 10,
        });

        expect(getProficiencyBonus(5)).toBe(3);
        expect(result.modifier).toBe(3);
        expect(result.proficiencyBonus).toBe(3);
        expect(result.total).toBe(16);
        expect(result.success).toBe(true);
    });

    it("supports direct ability checks without a skill", () => {
        const result = resolveSkillCheck({
            characterName: "Brom",
            stats: { str: 18, dex: 10, con: 14, int: 8, wis: 12, cha: 11 },
            level: 3,
            ability: "str",
            dc: 17,
            rawRoll: 12,
        });

        expect(result.skill).toBeUndefined();
        expect(result.total).toBe(16);
        expect(result.success).toBe(false);
    });
});
