import { describe, expect, it, vi } from "vitest";
import {
    buildDefaultResourceState,
    detectHitDiceToSpend,
    getCharacterResourceState,
    resolveLongRest,
    resolveShortRest,
    setCharacterResourceState,
} from "./rest";

const wizard = {
    id: 7,
    name: "Elira",
    className: "Wizard",
    level: 5,
    hpCurrent: 9,
    hpMax: 24,
    stats: JSON.stringify({ str: 8, dex: 14, con: 14, int: 18, wis: 12, cha: 10 }),
};

describe("rest", () => {
    it("creates sensible default resource state", () => {
        const state = buildDefaultResourceState(wizard);
        expect(state.hitDieSize).toBe(6);
        expect(state.hitDiceRemaining).toBe(5);
        expect(state.spellSlotsCurrent).toEqual({ "1": 4, "2": 3, "3": 2 });
    });

    it("resolves a short rest by spending hit dice and healing", () => {
        const state = buildDefaultResourceState(wizard);
        const rollFn = vi.fn().mockReturnValue({ total: 6 });

        const result = resolveShortRest(wizard, state, {
            hitDiceToSpend: 2,
            rollFn,
        });

        expect(result.hitDiceSpent).toBe(2);
        expect(result.hpAfter).toBeGreaterThan(wizard.hpCurrent);
        expect(result.resourceState.hitDiceRemaining).toBe(3);
    });

    it("resolves a long rest and restores spell slots", () => {
        const state = {
            ...buildDefaultResourceState(wizard),
            hitDiceRemaining: 1,
            spellSlotsCurrent: { "1": 0, "2": 1, "3": 0 },
        };

        const result = resolveLongRest(wizard, state);

        expect(result.hpAfter).toBe(24);
        expect(result.resourceState.spellSlotsCurrent).toEqual(result.resourceState.spellSlotsMax);
        expect(result.resourceState.hitDiceRemaining).toBe(3);
    });

    it("persists character resources inside worldState", () => {
        const initialWorld = {};
        const resourceState = buildDefaultResourceState(wizard);
        const updatedWorld = setCharacterResourceState(initialWorld, wizard.id, resourceState);
        const restored = getCharacterResourceState(updatedWorld, wizard);

        expect(restored.hitDiceRemaining).toBe(5);
        expect(restored.spellSlotsCurrent["3"]).toBe(2);
    });

    it("detects hit dice counts from chat text", () => {
        expect(detectHitDiceToSpend("I spend 2 hit dice during the short rest")).toBe(2);
        expect(detectHitDiceToSpend("We spend three hit dice and patch up")).toBe(3);
    });

    it("recovers warlock pact slots on short rest", () => {
        const warlock = {
            id: 8,
            name: "Hex",
            className: "Warlock",
            level: 5,
            hpCurrent: 20,
            hpMax: 20,
            stats: JSON.stringify({ str: 8, dex: 14, con: 14, int: 10, wis: 12, cha: 18 }),
        };
        const state = {
            ...buildDefaultResourceState(warlock),
            spellSlotsCurrent: { "3": 0 }, // both pact slots used
        };

        const result = resolveShortRest(warlock, state);

        expect(result.resourceState.spellSlotsCurrent["3"]).toBe(2);
        expect(result.summary).toContain("pact magic");
    });

    it("does not waste hit dice when character reaches full HP", () => {
        const state = buildDefaultResourceState(wizard);
        const rollFn = vi.fn().mockReturnValue({ total: 6 });
        // Wizard is 9/24 HP, deficit = 15. Request 5 dice.
        // Each die heals 6+2=8. After 2 dice: 9+16=25 capped to 24. Should stop at 2.
        const result = resolveShortRest(wizard, state, { hitDiceToSpend: 5, rollFn });

        expect(result.hitDiceSpent).toBe(2);
        expect(result.hpAfter).toBe(24);
        expect(result.resourceState.hitDiceRemaining).toBe(3);
    });
});
