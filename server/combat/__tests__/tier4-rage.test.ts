/**
 * Tier 4 Class Feature — Rage (Barbarian)
 *
 * Tests: activation, modifiers (resistance, advantage, bonus damage),
 * conditional extra_damage (STR melee only), and expiry via duration decay.
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

function alwaysHitRollFn(damageTotal: number = 7): RollFn {
    return (formula: string) => ({
        total: formula.includes("d20") ? 20 : damageTotal,
        rolls: formula.includes("d20") ? [18] : [damageTotal],
        isCritical: false,
        isFumble: false,
    });
}

function createBarbarian(overrides?: Partial<CombatEntity>): CombatEntity {
    return createPlayerEntity("p1", "Grunk", 45, 55, 14, 20, {
        characterClass: "Barbarian",
        level: 5,
        attackModifier: 7,
        damageFormula: "1d12+4",
        damageType: "slashing",
        featureUses: { Rage: 3 },
        weapons: [{
            name: "Greataxe",
            damageFormula: "1d12+4",
            damageType: "slashing",
            isRanged: false,
            attackBonus: 7,
            properties: [],
        }],
        abilityScores: { str: 18, dex: 14, con: 16, int: 8, wis: 12, cha: 10 },
        ...overrides,
    });
}

function createBarbarianWithJavelin(overrides?: Partial<CombatEntity>): CombatEntity {
    return createPlayerEntity("p1", "Grunk", 45, 55, 14, 20, {
        characterClass: "Barbarian",
        level: 5,
        attackModifier: 7,
        damageFormula: "1d6+4",
        damageType: "piercing",
        featureUses: { Rage: 3 },
        weapons: [
            {
                name: "Greataxe",
                damageFormula: "1d12+4",
                damageType: "slashing",
                isRanged: false,
                attackBonus: 7,
                properties: [],
            },
            {
                name: "Javelin",
                damageFormula: "1d6+4",
                damageType: "piercing",
                isRanged: true,
                attackBonus: 7,
                properties: ["thrown"],
            },
        ],
        abilityScores: { str: 18, dex: 14, con: 16, int: 8, wis: 12, cha: 10 },
        ...overrides,
    });
}

function createGoblin(id = "e1", overrides?: Partial<CombatEntity>): CombatEntity {
    return createEnemyEntity(id, "Goblin", 15, 13, 4, "1d6+2", {
        initiative: 10,
        rangeTo: { p1: RangeBand.MELEE },
        ...overrides,
    });
}

// =============================================================================
// TESTS
// =============================================================================

describe("Rage (Barbarian)", () => {
    describe("activation", () => {
        it("appears in legal actions for Barbarian with uses remaining", () => {
            const engine = createCombatEngine(1, undefined, mockRollFn(10));
            engine.initiateCombat([createBarbarian(), createGoblin()]);

            const actions = engine.getLegalActions("p1");
            const rageAction = actions.find(a => a.type === "RAGE");
            expect(rageAction).toBeDefined();
            expect(rageAction!.resourceCost).toBe("bonus_action");
        });

        it("does not appear for non-Barbarians", () => {
            const fighter = createPlayerEntity("p1", "Fist", 40, 40, 16, 20, {
                characterClass: "Fighter",
                featureUses: { Rage: 3 },
            });
            const engine = createCombatEngine(1, undefined, mockRollFn(10));
            engine.initiateCombat([fighter, createGoblin()]);

            const actions = engine.getLegalActions("p1");
            expect(actions.find(a => a.type === "RAGE")).toBeUndefined();
        });

        it("does not appear when no Rage uses remain", () => {
            const engine = createCombatEngine(1, undefined, mockRollFn(10));
            engine.initiateCombat([createBarbarian({ featureUses: { Rage: 0 } }), createGoblin()]);

            const actions = engine.getLegalActions("p1");
            expect(actions.find(a => a.type === "RAGE")).toBeUndefined();
        });

        it("activates and grants correct modifiers", () => {
            const engine = createCombatEngine(1, undefined, mockRollFn(10));
            engine.initiateCombat([createBarbarian(), createGoblin()]);

            const result = engine.submitAction({ type: "RAGE", entityId: "p1" });
            expect(result.success).toBe(true);

            const state = engine.getState();
            const grunk = state.entities.find(e => e.id === "p1")!;

            // Check condition applied
            expect(grunk.activeConditions.some(c => c.name === "raging")).toBe(true);
            const ragingCond = grunk.activeConditions.find(c => c.name === "raging")!;
            expect(ragingCond.duration).toBe(10);

            // Check modifiers
            const mods = grunk.activeModifiers;
            expect(mods.some(m => m.type === "advantage" && m.on === "save" && m.stat === "str" && m.sourceCondition === "raging")).toBe(true);
            expect(mods.some(m => m.type === "advantage" && m.on === "ability_check" && m.stat === "str" && m.sourceCondition === "raging")).toBe(true);
            expect(mods.some(m => m.type === "damage_resistance" && m.damageType === "bludgeoning" && m.sourceCondition === "raging")).toBe(true);
            expect(mods.some(m => m.type === "damage_resistance" && m.damageType === "piercing" && m.sourceCondition === "raging")).toBe(true);
            expect(mods.some(m => m.type === "damage_resistance" && m.damageType === "slashing" && m.sourceCondition === "raging")).toBe(true);
            expect(mods.some(m => m.type === "extra_damage" && m.formula === "+2" && m.sourceCondition === "raging")).toBe(true);

            // Check feature use decremented
            expect(grunk.featureUses["Rage"]).toBe(2);
        });

        it("consumes bonus action", () => {
            const engine = createCombatEngine(1, undefined, mockRollFn(10));
            engine.initiateCombat([createBarbarian(), createGoblin()]);

            engine.submitAction({ type: "RAGE", entityId: "p1" });

            const actions = engine.getLegalActions("p1");
            // Should not appear again (bonus action used AND already raging)
            expect(actions.find(a => a.type === "RAGE")).toBeUndefined();
        });

        it("does not appear when already raging", () => {
            const engine = createCombatEngine(1, undefined, mockRollFn(10));
            engine.initiateCombat([createBarbarian(), createGoblin()]);

            // Manually add raging condition to isolate the "already raging" check
            engine.applyCondition("p1", { name: "raging", duration: 5 });

            const actions = engine.getLegalActions("p1");
            expect(actions.find(a => a.type === "RAGE")).toBeUndefined();
        });
    });

    describe("rage damage bonus", () => {
        it("+2 applies to STR-based melee attacks", () => {
            const rollFn: RollFn = (formula: string) => {
                if (formula.includes("d20")) {
                    return { total: 20, rolls: [18], isCritical: false, isFumble: false };
                }
                if (formula === "+2") {
                    return { total: 2, rolls: [2], isCritical: false, isFumble: false };
                }
                return { total: 8, rolls: [8], isCritical: false, isFumble: false };
            };

            const engine = createCombatEngine(1, undefined, rollFn);
            engine.initiateCombat([
                createBarbarian(),
                createGoblin("e1", { hp: 50, maxHp: 50, rangeTo: { p1: RangeBand.MELEE } }),
            ]);

            // Activate rage
            engine.submitAction({ type: "RAGE", entityId: "p1" });

            // Melee attack — player provides attack roll, enters AWAIT_DAMAGE_ROLL
            const attackResult = engine.submitAction({
                type: "ATTACK",
                attackerId: "p1",
                targetId: "e1",
                weaponName: "Greataxe",
                isRanged: false,
                attackRoll: 25,
                rawD20: 18,
            });
            expect(attackResult.success).toBe(true);
            expect(attackResult.awaitingDamageRoll).toBe(true);

            // Submit damage roll — this triggers applyWeaponDamage with extra_damage
            const dmgResult = engine.applyDamage(8);
            expect(dmgResult.success).toBe(true);

            const extraDmgLog = dmgResult.logs.find(l =>
                l.description?.includes("Extra") && l.description?.includes("+2")
            );
            expect(extraDmgLog).toBeDefined();
        });

        it("does NOT apply to ranged attacks", () => {
            const rollFn: RollFn = (formula: string) => {
                if (formula.includes("d20")) {
                    return { total: 20, rolls: [18], isCritical: false, isFumble: false };
                }
                if (formula === "+2") {
                    return { total: 2, rolls: [2], isCritical: false, isFumble: false };
                }
                return { total: 6, rolls: [6], isCritical: false, isFumble: false };
            };

            const engine = createCombatEngine(1, undefined, rollFn);
            engine.initiateCombat([
                createBarbarianWithJavelin(),
                createGoblin("e1", { hp: 50, maxHp: 50, rangeTo: { p1: RangeBand.NEAR } }),
            ]);

            // Activate rage
            engine.submitAction({ type: "RAGE", entityId: "p1" });

            // Ranged attack with javelin — enters AWAIT_DAMAGE_ROLL
            const attackResult = engine.submitAction({
                type: "ATTACK",
                attackerId: "p1",
                targetId: "e1",
                weaponName: "Javelin",
                isRanged: true,
                attackRoll: 25,
                rawD20: 18,
            });
            expect(attackResult.success).toBe(true);
            expect(attackResult.awaitingDamageRoll).toBe(true);

            // Submit damage roll
            const dmgResult = engine.applyDamage(6);
            expect(dmgResult.success).toBe(true);

            // Should NOT have extra damage from rage on ranged attack
            const extraDmgLog = dmgResult.logs.find(l =>
                l.description?.includes("Extra") && l.description?.includes("+2")
            );
            expect(extraDmgLog).toBeUndefined();
        });
    });

    describe("damage resistance while raging", () => {
        it("halves bludgeoning, piercing, and slashing damage", () => {
            const rollFn: RollFn = (formula: string) => {
                if (formula.includes("d20")) {
                    return { total: 25, rolls: [20], isCritical: false, isFumble: false };
                }
                return { total: 10, rolls: [10], isCritical: false, isFumble: false };
            };

            const engine = createCombatEngine(1, undefined, rollFn);
            engine.initiateCombat([
                createBarbarian(),
                createGoblin("e1", {
                    hp: 30, maxHp: 30,
                    attackModifier: 10,
                    damageFormula: "1d6+3",
                    damageType: "bludgeoning",
                    rangeTo: { p1: RangeBand.MELEE },
                }),
            ]);

            // Barbarian rages on their turn
            engine.submitAction({ type: "RAGE", entityId: "p1" });
            engine.submitAction({ type: "END_TURN", entityId: "p1" });

            // Goblin attacks barbarian with bludgeoning
            const result = engine.submitAction({
                type: "ATTACK",
                attackerId: "e1",
                targetId: "p1",
                isRanged: false,
                attackRoll: 25,
                rawD20: 20,
            });

            expect(result.success).toBe(true);
            const state = engine.getState();
            const grunk = state.entities.find(e => e.id === "p1")!;
            // 10 damage halved to 5. HP: 45 - 5 = 40
            expect(grunk.hp).toBe(40);
        });
    });

    describe("rage expiry", () => {
        it("expires after 10 rounds; all modifiers removed", () => {
            const engine = createCombatEngine(1, undefined, mockRollFn(10));
            engine.initiateCombat([createBarbarian(), createGoblin()]);

            // Activate rage
            engine.submitAction({ type: "RAGE", entityId: "p1" });
            engine.submitAction({ type: "END_TURN", entityId: "p1" });

            // Simulate 10 rounds: goblin end turn, barbarian end turn
            for (let i = 0; i < 10; i++) {
                engine.submitAction({ type: "END_TURN", entityId: "e1" });
                engine.submitAction({ type: "END_TURN", entityId: "p1" });
            }

            const state = engine.getState();
            const grunk = state.entities.find(e => e.id === "p1")!;

            // Raging condition should be gone
            expect(grunk.activeConditions.some(c => c.name === "raging")).toBe(false);

            // All rage modifiers should be removed
            expect(grunk.activeModifiers.filter(m => m.sourceCondition === "raging")).toHaveLength(0);

            // Check that "Rage ends" was logged
            const rageEndLog = state.log.find(l =>
                l.description?.includes("Rage ends on Grunk")
            );
            expect(rageEndLog).toBeDefined();
        });
    });
});
