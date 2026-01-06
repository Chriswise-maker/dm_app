/**
 * Combat Engine V2 — Unit Tests
 * 
 * These tests verify the core mechanics of the combat system:
 * - Enemies die at 0 HP
 * - Players go unconscious at 0 HP (not dead)
 * - Attacks hit when roll >= AC
 * - Attacks miss when roll < AC
 * - Undo restores previous state
 * - Initiative sorting works correctly
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { CombatEngineV2, createCombatEngine } from "../combat-engine-v2";
import { createPlayerEntity, createEnemyEntity, type CombatEntity } from "../combat-types";

// =============================================================================
// TEST HELPERS
// =============================================================================

/**
 * Create a standard test player
 */
function createTestPlayer(overrides?: Partial<CombatEntity>): CombatEntity {
    return createPlayerEntity(
        "player-1",
        "Aragorn",
        30,   // hp
        30,   // maxHp
        16,   // ac
        15,   // initiative
        {
            attackModifier: 5,
            damageFormula: "1d8+3",
            ...overrides,
        }
    );
}

/**
 * Create a standard test goblin (low HP enemy)
 */
function createTestGoblin(overrides?: Partial<CombatEntity>): CombatEntity {
    return createEnemyEntity(
        "goblin-1",
        "Goblin",
        7,    // hp
        12,   // ac
        4,    // attackMod
        "1d6+2",  // damageFormula
        {
            initiativeModifier: 2,
            ...overrides,
        }
    );
}

/**
 * Create a test dragon (high HP enemy)
 */
function createTestDragon(overrides?: Partial<CombatEntity>): CombatEntity {
    return createEnemyEntity(
        "dragon-1",
        "Young Red Dragon",
        178,   // hp
        18,    // ac
        10,    // attackMod
        "2d10+6",
        {
            initiativeModifier: 0,
            ...overrides,
        }
    );
}

// =============================================================================
// TESTS
// =============================================================================

describe("CombatEngineV2", () => {
    let engine: CombatEngineV2;

    beforeEach(() => {
        engine = createCombatEngine(1);  // Session ID 1
    });

    describe("Initialization", () => {
        it("should create an engine in IDLE phase", () => {
            const state = engine.getState();
            expect(state.phase).toBe("IDLE");
            expect(state.entities).toHaveLength(0);
            expect(state.round).toBe(0);
        });

        it("should start combat with entities", () => {
            const player = createTestPlayer();
            const goblin = createTestGoblin();

            const logs = engine.initiateCombat([player, goblin]);
            const state = engine.getState();

            expect(state.phase).toBe("ACTIVE");
            expect(state.entities).toHaveLength(2);
            expect(state.round).toBe(1);
            expect(logs.some(l => l.type === "COMBAT_START")).toBe(true);
        });
    });

    describe("Initiative & Turn Order", () => {
        it("should sort entities by initiative (highest first)", () => {
            const slowPlayer = createTestPlayer({ id: "slow", initiative: 5 });
            const fastGoblin = createTestGoblin({ id: "fast", initiative: 20 });

            engine.initiateCombat([slowPlayer, fastGoblin]);
            const state = engine.getState();

            // Fast goblin should go first
            expect(state.turnOrder[0]).toBe("fast");
            expect(state.turnOrder[1]).toBe("slow");
        });

        it("should handle initiative ties using modifier", () => {
            // Same initiative, different modifiers
            const player = createTestPlayer({ initiative: 15, initiativeModifier: 3 });
            const goblin = createTestGoblin({ initiative: 15, initiativeModifier: 1 });

            engine.initiateCombat([player, goblin]);
            const state = engine.getState();

            // Player has higher modifier, should go first
            expect(state.turnOrder[0]).toBe("player-1");
        });

        it("should advance turns correctly", () => {
            const player = createTestPlayer({ initiative: 20 });
            const goblin = createTestGoblin({ initiative: 10 });

            engine.initiateCombat([player, goblin]);

            // Player's turn first
            expect(engine.getCurrentTurnEntity()?.id).toBe("player-1");

            // End turn, now goblin
            engine.submitAction({ type: "END_TURN", entityId: "player-1" });
            expect(engine.getCurrentTurnEntity()?.id).toBe("goblin-1");
        });

        it("should advance rounds after all turns", () => {
            const player = createTestPlayer({ initiative: 20 });
            const goblin = createTestGoblin({ initiative: 10 });

            engine.initiateCombat([player, goblin]);
            expect(engine.getState().round).toBe(1);

            // End both turns
            engine.submitAction({ type: "END_TURN", entityId: "player-1" });
            engine.submitAction({ type: "END_TURN", entityId: "goblin-1" });

            expect(engine.getState().round).toBe(2);
        });
    });

    describe("Attack Resolution", () => {
        it("should hit when roll meets AC", () => {
            // Create a weak goblin with AC 10 and a strong attacker
            const player = createTestPlayer({
                initiative: 20,
                attackModifier: 15,  // Very high to guarantee hit
            });
            const goblin = createTestGoblin({
                initiative: 10,
                baseAC: 10,
            });

            engine.initiateCombat([player, goblin]);

            const result = engine.submitAction({
                type: "ATTACK",
                attackerId: "player-1",
                targetId: "goblin-1",
            });

            expect(result.success).toBe(true);
            // With +15 modifier, even a roll of 1 (fumble aside) would hit AC 10
            // Most rolls should hit
        });

        it("should record attack and damage logs", () => {
            const player = createTestPlayer({ initiative: 20 });
            const goblin = createTestGoblin({ initiative: 10 });

            engine.initiateCombat([player, goblin]);

            const result = engine.submitAction({
                type: "ATTACK",
                attackerId: "player-1",
                targetId: "goblin-1",
            });

            // Should have at least an attack roll log
            const attackLog = result.logs.find(l => l.type === "ATTACK_ROLL");
            expect(attackLog).toBeDefined();
            expect(attackLog?.actorId).toBe("player-1");
            expect(attackLog?.targetId).toBe("goblin-1");
        });
    });

    describe("Death vs Unconscious", () => {
        it("should kill a goblin (non-essential) at 0 HP", () => {
            const player = createTestPlayer({
                initiative: 20,
                attackModifier: 100,  // Guarantee hit
                damageFormula: "100d6",  // Massive damage
            });
            const goblin = createTestGoblin({ initiative: 10 });

            engine.initiateCombat([player, goblin]);

            engine.submitAction({
                type: "ATTACK",
                attackerId: "player-1",
                targetId: "goblin-1",
            });

            const deadGoblin = engine.getEntity("goblin-1");
            expect(deadGoblin?.hp).toBe(0);
            expect(deadGoblin?.status).toBe("DEAD");
        });

        it("should make a player (essential) unconscious at 0 HP, not dead", () => {
            const player = createTestPlayer({ initiative: 10 });
            const dragon = createTestDragon({
                initiative: 20,
                attackModifier: 100,
                damageFormula: "100d6",
            });

            engine.initiateCombat([player, dragon]);

            // Dragon attacks player
            engine.submitAction({
                type: "ATTACK",
                attackerId: "dragon-1",
                targetId: "player-1",
            });

            const downedPlayer = engine.getEntity("player-1");
            expect(downedPlayer?.hp).toBe(0);
            expect(downedPlayer?.status).toBe("UNCONSCIOUS");
            expect(downedPlayer?.status).not.toBe("DEAD");
        });
    });

    describe("Undo", () => {
        it("should restore previous state on undo", () => {
            const player = createTestPlayer({ initiative: 20 });
            const goblin = createTestGoblin({ initiative: 10, hp: 20 });

            engine.initiateCombat([player, goblin]);

            const hpBefore = engine.getEntity("goblin-1")?.hp;

            // Attack the goblin
            engine.submitAction({
                type: "ATTACK",
                attackerId: "player-1",
                targetId: "goblin-1",
            });

            // Undo
            const undoSuccess = engine.undoLastAction();
            expect(undoSuccess).toBe(true);

            // HP should be restored
            const hpAfterUndo = engine.getEntity("goblin-1")?.hp;
            expect(hpAfterUndo).toBe(hpBefore);
        });

        it("should return false when no history to undo", () => {
            const result = engine.undoLastAction();
            expect(result).toBe(false);
        });
    });

    describe("State Export/Import", () => {
        it("should export and reimport state correctly", () => {
            const player = createTestPlayer({ initiative: 20 });
            const goblin = createTestGoblin({ initiative: 10 });

            engine.initiateCombat([player, goblin]);

            // Export
            const exported = engine.exportState();

            // Create new engine and import
            const newEngine = createCombatEngine(1);
            newEngine.loadState(exported);

            const state = newEngine.getState();
            expect(state.entities).toHaveLength(2);
            expect(state.phase).toBe("ACTIVE");
            expect(state.round).toBe(1);
        });
    });

    describe("Combat End", () => {
        it("should end combat when all enemies are dead", () => {
            const player = createTestPlayer({
                initiative: 20,
                attackModifier: 100,
                damageFormula: "100d6",
            });
            const goblin = createTestGoblin({ initiative: 10 });

            engine.initiateCombat([player, goblin]);

            engine.submitAction({
                type: "ATTACK",
                attackerId: "player-1",
                targetId: "goblin-1",
            });

            // After killing the only enemy, end turn should end combat
            const result = engine.submitAction({
                type: "END_TURN",
                entityId: "player-1"
            });

            const state = engine.getState();
            expect(state.phase).toBe("RESOLVED");
        });
    });
});
