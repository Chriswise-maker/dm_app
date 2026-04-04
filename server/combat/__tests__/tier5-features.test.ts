/**
 * Tier 5 Class Features — Bardic Inspiration (Bard) & Lay on Hands (Paladin)
 *
 * Tests: granting inspiration die, auto-consuming on attack, die scaling,
 * Lay on Hands healing, pool depletion, no overheal, action economy.
 */

import { describe, it, expect } from "vitest";
import { createCombatEngine, type RollFn } from "../combat-engine-v2";
import { createPlayerEntity, createEnemyEntity, type CombatEntity, RangeBand } from "../combat-types";

// =============================================================================
// TEST HELPERS
// =============================================================================

function mockRollFn(total: number): RollFn {
    return (_formula: string) => ({
        total,
        rolls: [total],
        isCritical: false,
        isFumble: false,
    });
}

/** Returns different totals for d20 (attack) vs other dice (damage/inspiration). */
function sequenceRollFn(rolls: number[]): RollFn {
    let i = 0;
    return (_formula: string) => ({
        total: rolls[i++] ?? 10,
        rolls: [rolls[(i - 1)] ?? 10],
        isCritical: false,
        isFumble: false,
    });
}

function createBard(overrides?: Partial<CombatEntity>): CombatEntity {
    return createPlayerEntity("bard1", "Melody", 30, 30, 14, 20, {
        characterClass: "Bard",
        level: 5,
        attackModifier: 5,
        damageFormula: "1d8+2",
        damageType: "piercing",
        featureUses: { "Bardic Inspiration": 3 },
        weapons: [{
            name: "Rapier",
            damageFormula: "1d8+2",
            damageType: "piercing",
            isRanged: false,
            attackBonus: 5,
            properties: ["finesse"],
        }],
        ...overrides,
    });
}

function createFighter(overrides?: Partial<CombatEntity>): CombatEntity {
    return createPlayerEntity("fighter1", "Arden", 45, 45, 18, 15, {
        characterClass: "Fighter",
        level: 5,
        attackModifier: 7,
        damageFormula: "1d10+4",
        damageType: "slashing",
        featureUses: { "Second Wind": 1 },
        weapons: [{
            name: "Longsword",
            damageFormula: "1d10+4",
            damageType: "slashing",
            isRanged: false,
            attackBonus: 7,
            properties: [],
        }],
        ...overrides,
    });
}

function createPaladin(overrides?: Partial<CombatEntity>): CombatEntity {
    return createPlayerEntity("paladin1", "Aldric", 50, 50, 18, 10, {
        characterClass: "Paladin",
        level: 5,
        attackModifier: 7,
        damageFormula: "1d10+4",
        damageType: "slashing",
        featureUses: { "Lay on Hands": 25 },
        weapons: [{
            name: "Longsword",
            damageFormula: "1d10+4",
            damageType: "slashing",
            isRanged: false,
            attackBonus: 7,
            properties: [],
        }],
        ...overrides,
    });
}

function createGoblin(id = "e1", overrides?: Partial<CombatEntity>): CombatEntity {
    return createEnemyEntity(id, "Goblin", 15, 13, 4, "1d6+2", {
        initiative: 5,
        rangeTo: { bard1: RangeBand.MELEE, fighter1: RangeBand.MELEE, paladin1: RangeBand.MELEE },
        ...overrides,
    });
}

// =============================================================================
// BARDIC INSPIRATION
// =============================================================================

describe("Bardic Inspiration (Bard)", () => {
    describe("legal actions", () => {
        it("appears for Bard with uses remaining and bonus action available", () => {
            const engine = createCombatEngine(1, undefined, mockRollFn(10));
            engine.initiateCombat([createBard(), createFighter(), createGoblin()]);

            const actions = engine.getLegalActions("bard1");
            const biActions = actions.filter(a => a.type === "BARDIC_INSPIRATION");
            expect(biActions.length).toBe(1); // one ally: fighter
            expect(biActions[0].targetId).toBe("fighter1");
            expect(biActions[0].resourceCost).toBe("bonus_action");
        });

        it("does not appear for non-Bards", () => {
            const fighter = createFighter({ featureUses: { "Bardic Inspiration": 3 } });
            const engine = createCombatEngine(1, undefined, mockRollFn(10));
            engine.initiateCombat([fighter, createGoblin("e1", { rangeTo: { fighter1: RangeBand.MELEE } })]);

            const actions = engine.getLegalActions("fighter1");
            expect(actions.find(a => a.type === "BARDIC_INSPIRATION")).toBeUndefined();
        });

        it("does not appear when no uses remain", () => {
            const engine = createCombatEngine(1, undefined, mockRollFn(10));
            engine.initiateCombat([
                createBard({ featureUses: { "Bardic Inspiration": 0 } }),
                createFighter(),
                createGoblin(),
            ]);

            const actions = engine.getLegalActions("bard1");
            expect(actions.find(a => a.type === "BARDIC_INSPIRATION")).toBeUndefined();
        });

        it("does not appear when bonus action already used", () => {
            const engine = createCombatEngine(1, undefined, mockRollFn(10));
            engine.initiateCombat([createBard(), createFighter(), createGoblin()]);

            // Use bonus action on inspiration
            engine.submitAction({ type: "BARDIC_INSPIRATION", entityId: "bard1", targetId: "fighter1" });

            const actions = engine.getLegalActions("bard1");
            expect(actions.find(a => a.type === "BARDIC_INSPIRATION")).toBeUndefined();
        });
    });

    describe("granting inspiration", () => {
        it("transfers die to target ally and decrements uses", () => {
            const engine = createCombatEngine(1, undefined, mockRollFn(10));
            engine.initiateCombat([createBard(), createFighter(), createGoblin()]);

            const result = engine.submitAction({ type: "BARDIC_INSPIRATION", entityId: "bard1", targetId: "fighter1" });
            expect(result.success).toBe(true);

            const state = engine.getState();
            const fighter = state.entities.find(e => e.id === "fighter1")!;
            expect(fighter.bardicInspirationDie).toBe("d8"); // level 5 = d8

            const bard = state.entities.find(e => e.id === "bard1")!;
            expect(bard.featureUses["Bardic Inspiration"]).toBe(2);
        });

        it("scales die by bard level: d6 at level 1", () => {
            const engine = createCombatEngine(1, undefined, mockRollFn(10));
            engine.initiateCombat([createBard({ level: 3 }), createFighter(), createGoblin()]);

            engine.submitAction({ type: "BARDIC_INSPIRATION", entityId: "bard1", targetId: "fighter1" });

            const fighter = engine.getState().entities.find(e => e.id === "fighter1")!;
            expect(fighter.bardicInspirationDie).toBe("d6");
        });

        it("scales die by bard level: d10 at level 10", () => {
            const engine = createCombatEngine(1, undefined, mockRollFn(10));
            engine.initiateCombat([createBard({ level: 10 }), createFighter(), createGoblin()]);

            engine.submitAction({ type: "BARDIC_INSPIRATION", entityId: "bard1", targetId: "fighter1" });

            const fighter = engine.getState().entities.find(e => e.id === "fighter1")!;
            expect(fighter.bardicInspirationDie).toBe("d10");
        });

        it("scales die by bard level: d12 at level 15", () => {
            const engine = createCombatEngine(1, undefined, mockRollFn(10));
            engine.initiateCombat([createBard({ level: 15 }), createFighter(), createGoblin()]);

            engine.submitAction({ type: "BARDIC_INSPIRATION", entityId: "bard1", targetId: "fighter1" });

            const fighter = engine.getState().entities.find(e => e.id === "fighter1")!;
            expect(fighter.bardicInspirationDie).toBe("d12");
        });

        it("logs the inspiration grant", () => {
            const engine = createCombatEngine(1, undefined, mockRollFn(10));
            engine.initiateCombat([createBard(), createFighter(), createGoblin()]);

            const result = engine.submitAction({ type: "BARDIC_INSPIRATION", entityId: "bard1", targetId: "fighter1" });
            const actionLog = result.logs.find(l => l.type === "ACTION");
            expect(actionLog).toBeDefined();
            expect(actionLog!.description).toContain("inspires");
            expect(actionLog!.description).toContain("d8");
        });
    });

    describe("auto-use on attack", () => {
        it("adds inspiration die to attack roll and clears it", () => {
            // Inspiration die roll = 4
            const engine = createCombatEngine(1, undefined, sequenceRollFn([4, 7]));
            engine.initiateCombat([
                createFighter({ bardicInspirationDie: "d8" }),
                createGoblin("e1", { rangeTo: { fighter1: RangeBand.MELEE } }),
            ]);

            // Fighter attacks with a provided attack roll (bypasses AWAIT_ATTACK_ROLL)
            // Roll of 14 vs AC 13 would miss, but inspiration die (4) makes it 18 → hit
            const result = engine.submitAction({
                type: "ATTACK",
                attackerId: "fighter1",
                targetId: "e1",
                weaponName: "Longsword",
                attackRoll: 14,
                rawD20: 7,
            });
            expect(result.success).toBe(true);

            // Check inspiration log exists
            const inspLog = result.logs.find(l =>
                l.type === "CUSTOM" && l.description?.includes("Bardic Inspiration")
            );
            expect(inspLog).toBeDefined();
            expect(inspLog!.description).toContain("adds 4");

            // Inspiration die should be cleared
            const fighter = engine.getState().entities.find(e => e.id === "fighter1")!;
            expect(fighter.bardicInspirationDie).toBeUndefined();
        });

        it("does not use inspiration die on natural 20 (crit)", () => {
            const engine = createCombatEngine(1, undefined, mockRollFn(7));
            engine.initiateCombat([
                createFighter({ bardicInspirationDie: "d8" }),
                createGoblin("e1", { rangeTo: { fighter1: RangeBand.MELEE } }),
            ]);

            engine.submitAction({
                type: "ATTACK",
                attackerId: "fighter1",
                targetId: "e1",
                weaponName: "Longsword",
                attackRoll: 27,  // nat 20 + 7 modifier
                rawD20: 20,
            });

            // Inspiration die should still be held (not wasted on a crit)
            const fighter = engine.getState().entities.find(e => e.id === "fighter1")!;
            expect(fighter.bardicInspirationDie).toBe("d8");
        });

        it("does not use inspiration die on natural 1 (fumble)", () => {
            const engine = createCombatEngine(1, undefined, mockRollFn(7));
            engine.initiateCombat([
                createFighter({ bardicInspirationDie: "d8" }),
                createGoblin("e1", { rangeTo: { fighter1: RangeBand.MELEE } }),
            ]);

            engine.submitAction({
                type: "ATTACK",
                attackerId: "fighter1",
                targetId: "e1",
                weaponName: "Longsword",
                attackRoll: 8,  // nat 1 + 7 modifier
                rawD20: 1,
            });

            // Inspiration die should still be held (not wasted on a fumble)
            const fighter = engine.getState().entities.find(e => e.id === "fighter1")!;
            expect(fighter.bardicInspirationDie).toBe("d8");
        });
    });
});

// =============================================================================
// LAY ON HANDS
// =============================================================================

describe("Lay on Hands (Paladin)", () => {
    describe("legal actions", () => {
        it("appears for Paladin with pool remaining and action available", () => {
            const engine = createCombatEngine(1, undefined, mockRollFn(10));
            engine.initiateCombat([
                createPaladin({ initiative: 20, rangeTo: { fighter1: RangeBand.MELEE } }),
                createFighter({ rangeTo: { paladin1: RangeBand.MELEE } }),
                createGoblin(),
            ]);

            const actions = engine.getLegalActions("paladin1");
            const lohActions = actions.filter(a => a.type === "LAY_ON_HANDS");
            // Should include self + fighter (both in melee)
            expect(lohActions.length).toBe(2);
            expect(lohActions.some(a => a.targetId === "paladin1")).toBe(true);
            expect(lohActions.some(a => a.targetId === "fighter1")).toBe(true);
            expect(lohActions[0].resourceCost).toBe("action");
        });

        it("does not appear for non-Paladins", () => {
            const fighter = createFighter({ initiative: 20, featureUses: { "Lay on Hands": 25 } });
            const engine = createCombatEngine(1, undefined, mockRollFn(10));
            engine.initiateCombat([fighter, createGoblin("e1", { rangeTo: { fighter1: RangeBand.MELEE } })]);

            const actions = engine.getLegalActions("fighter1");
            expect(actions.find(a => a.type === "LAY_ON_HANDS")).toBeUndefined();
        });

        it("does not appear when pool is empty", () => {
            const engine = createCombatEngine(1, undefined, mockRollFn(10));
            engine.initiateCombat([
                createPaladin({ initiative: 20, featureUses: { "Lay on Hands": 0 } }),
                createGoblin(),
            ]);

            const actions = engine.getLegalActions("paladin1");
            expect(actions.find(a => a.type === "LAY_ON_HANDS")).toBeUndefined();
        });

        it("does not target allies out of melee range", () => {
            const engine = createCombatEngine(1, undefined, mockRollFn(10));
            engine.initiateCombat([
                createPaladin({ initiative: 20, rangeTo: { fighter1: RangeBand.NEAR } }),
                createFighter({ rangeTo: { paladin1: RangeBand.NEAR } }),
                createGoblin(),
            ]);

            const actions = engine.getLegalActions("paladin1");
            const lohActions = actions.filter(a => a.type === "LAY_ON_HANDS");
            // Only self (fighter is NEAR, not MELEE)
            expect(lohActions.length).toBe(1);
            expect(lohActions[0].targetId).toBe("paladin1");
        });
    });

    describe("healing", () => {
        it("heals correct amount and depletes pool", () => {
            const engine = createCombatEngine(1, undefined, mockRollFn(10));
            engine.initiateCombat([
                createPaladin({ initiative: 20, rangeTo: { fighter1: RangeBand.MELEE } }),
                createFighter({ hp: 25, maxHp: 45, rangeTo: { paladin1: RangeBand.MELEE } }),
                createGoblin(),
            ]);

            const result = engine.submitAction({
                type: "LAY_ON_HANDS",
                entityId: "paladin1",
                targetId: "fighter1",
            });
            expect(result.success).toBe(true);

            const state = engine.getState();
            const fighter = state.entities.find(e => e.id === "fighter1")!;
            // Missing 20 HP, pool is 25 → heals 20
            expect(fighter.hp).toBe(45);

            const paladin = state.entities.find(e => e.id === "paladin1")!;
            expect(paladin.featureUses["Lay on Hands"]).toBe(5); // 25 - 20 = 5
        });

        it("won't overheal past maxHp", () => {
            const engine = createCombatEngine(1, undefined, mockRollFn(10));
            engine.initiateCombat([
                createPaladin({ initiative: 20, rangeTo: { fighter1: RangeBand.MELEE } }),
                createFighter({ hp: 44, maxHp: 45, rangeTo: { paladin1: RangeBand.MELEE } }),
                createGoblin(),
            ]);

            engine.submitAction({
                type: "LAY_ON_HANDS",
                entityId: "paladin1",
                targetId: "fighter1",
            });

            const state = engine.getState();
            const fighter = state.entities.find(e => e.id === "fighter1")!;
            expect(fighter.hp).toBe(45); // capped at max

            const paladin = state.entities.find(e => e.id === "paladin1")!;
            // Only 1 HP was missing, so only 1 deducted from pool
            expect(paladin.featureUses["Lay on Hands"]).toBe(24);
        });

        it("uses entire pool when missing HP exceeds pool", () => {
            const engine = createCombatEngine(1, undefined, mockRollFn(10));
            engine.initiateCombat([
                createPaladin({ initiative: 20, featureUses: { "Lay on Hands": 10 }, rangeTo: { fighter1: RangeBand.MELEE } }),
                createFighter({ hp: 10, maxHp: 45, rangeTo: { paladin1: RangeBand.MELEE } }),
                createGoblin(),
            ]);

            engine.submitAction({
                type: "LAY_ON_HANDS",
                entityId: "paladin1",
                targetId: "fighter1",
            });

            const state = engine.getState();
            const fighter = state.entities.find(e => e.id === "fighter1")!;
            expect(fighter.hp).toBe(20); // 10 + 10

            const paladin = state.entities.find(e => e.id === "paladin1")!;
            expect(paladin.featureUses["Lay on Hands"]).toBe(0);
        });

        it("consumes action", () => {
            const engine = createCombatEngine(1, undefined, mockRollFn(10));
            engine.initiateCombat([
                createPaladin({ initiative: 20, hp: 30, maxHp: 50 }),
                createGoblin(),
            ]);

            engine.submitAction({
                type: "LAY_ON_HANDS",
                entityId: "paladin1",
                targetId: "paladin1",
            });

            const actions = engine.getLegalActions("paladin1");
            // Action used — no more action-cost abilities
            expect(actions.find(a => a.type === "LAY_ON_HANDS")).toBeUndefined();
            expect(actions.find(a => a.type === "ATTACK")).toBeUndefined();
        });

        it("can heal self", () => {
            const engine = createCombatEngine(1, undefined, mockRollFn(10));
            engine.initiateCombat([
                createPaladin({ initiative: 20, hp: 30, maxHp: 50 }),
                createGoblin(),
            ]);

            const result = engine.submitAction({
                type: "LAY_ON_HANDS",
                entityId: "paladin1",
                targetId: "paladin1",
            });
            expect(result.success).toBe(true);

            const paladin = engine.getState().entities.find(e => e.id === "paladin1")!;
            expect(paladin.hp).toBe(50); // healed 20
            expect(paladin.featureUses["Lay on Hands"]).toBe(5); // 25 - 20
        });

        it("revives unconscious ally", () => {
            const engine = createCombatEngine(1, undefined, mockRollFn(10));
            engine.initiateCombat([
                createPaladin({ initiative: 20, rangeTo: { fighter1: RangeBand.MELEE } }),
                createFighter({
                    hp: 0,
                    maxHp: 45,
                    status: "UNCONSCIOUS",
                    rangeTo: { paladin1: RangeBand.MELEE },
                }),
                createGoblin(),
            ]);

            const result = engine.submitAction({
                type: "LAY_ON_HANDS",
                entityId: "paladin1",
                targetId: "fighter1",
            });
            expect(result.success).toBe(true);

            const fighter = engine.getState().entities.find(e => e.id === "fighter1")!;
            expect(fighter.hp).toBe(25); // pool = 25, missing = 45
            expect(fighter.status).toBe("ALIVE");
        });
    });
});
