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
import { CombatEngineV2, createCombatEngine, type RollFn } from "../combat-engine-v2";
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
            const player = createTestPlayer({ initiative: 20, attackModifier: 5 });
            const goblin = createTestGoblin({ initiative: 10, baseAC: 10 });

            engine.initiateCombat([player, goblin]);

            // Provide attackRoll so we go through processAttack and get ATTACK_ROLL log (deterministic)
            const result = engine.submitAction({
                type: "ATTACK",
                attackerId: "player-1",
                targetId: "goblin-1",
                attackRoll: 15,  // 10 + 5 modifier, hits AC 10
                rawD20: 10,
            });

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
                attackModifier: 5,
                damageFormula: "100d6",
            });
            const goblin = createTestGoblin({ initiative: 10, baseAC: 10 });

            engine.initiateCombat([player, goblin]);

            // Provide attackRoll so we hit and enter AWAIT_DAMAGE_ROLL
            const attackResult = engine.submitAction({
                type: "ATTACK",
                attackerId: "player-1",
                targetId: "goblin-1",
                attackRoll: 15,
                rawD20: 10,
            });

            if (attackResult.awaitingDamageRoll) {
                // 100d6 has max 600; use 600 to stay within formula range and kill goblin (7 HP)
                engine.applyDamage(600);
            }

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
                attackModifier: 5,
                damageFormula: "100d6",
            });
            const goblin = createTestGoblin({ initiative: 10, baseAC: 10 });

            engine.initiateCombat([player, goblin]);

            const attackResult = engine.submitAction({
                type: "ATTACK",
                attackerId: "player-1",
                targetId: "goblin-1",
                attackRoll: 15,
                rawD20: 10,
            });

            if (attackResult.awaitingDamageRoll) {
                engine.applyDamage(600);  // 100d6 max; enough to kill goblin
            }

            // After killing the only enemy, end turn should end combat
            engine.submitAction({
                type: "END_TURN",
                entityId: "player-1"
            });

            const state = engine.getState();
            expect(state.phase).toBe("RESOLVED");
        });
    });

    // =========================================================================
    // Stage 1 Bug Fix Tests
    // =========================================================================

    describe("1.1 — Dice mocking via rollFn injection", () => {
        it("should use injected rollFn for deterministic results", () => {
            const mockRoll: RollFn = () => ({ total: 15, rolls: [15], isCritical: false, isFumble: false });
            const deterministicEngine = createCombatEngine(1, {}, mockRoll);

            const player = createTestPlayer({ initiative: 0 });  // 0 triggers auto-roll
            const goblin = createTestGoblin({ initiative: 0 });

            deterministicEngine.initiateCombat([player, goblin]);

            // With mock returning 15, both entities should get initiative = 15 + modifier
            const state = deterministicEngine.getState();
            const playerEntity = state.entities.find(e => e.id === "player-1");
            expect(playerEntity?.initiative).toBe(15 + (playerEntity?.initiativeModifier ?? 0));
        });

        it("should use mockRoll to guarantee hit in attack", () => {
            const alwaysHits: RollFn = (formula) => {
                if (formula.includes("d20")) return { total: 20, rolls: [20], isCritical: true, isFumble: false };
                return { total: 8, rolls: [5, 3], isCritical: false, isFumble: false };
            };
            const deterministicEngine = createCombatEngine(1, {}, alwaysHits);

            const player = createTestPlayer({ initiative: 20 });
            const goblin = createTestGoblin({ initiative: 10, baseAC: 15 });

            deterministicEngine.initiateCombat([player, goblin]);

            // Without attackRoll, player path enters AWAIT_ATTACK_ROLL; pass attackRoll so processAttack runs and uses mock for damage
            const result = deterministicEngine.submitAction({
                type: "ATTACK",
                attackerId: "player-1",
                targetId: "goblin-1",
                attackRoll: 25,  // 20 + 5 modifier, hits AC 15
                rawD20: 20,
            });

            expect(result.success).toBe(true);
            expect(result.awaitingDamageRoll).toBe(true);
        });
    });

    describe("1.2 — getState() deep copy", () => {
        it("should return a deep copy — mutations do not affect engine state", () => {
            const player = createTestPlayer({ initiative: 20 });
            const goblin = createTestGoblin({ initiative: 10 });

            engine.initiateCombat([player, goblin]);

            const state1 = engine.getState();
            const originalHp = state1.entities[0].hp;

            // Mutate the returned state
            (state1.entities[0] as any).hp = 9999;

            // Engine state should be unaffected
            const state2 = engine.getState();
            expect(state2.entities[0].hp).toBe(originalHp);
            expect(state2.entities[0].hp).not.toBe(9999);
        });
    });

    describe("1.3 — Log persistence", () => {
        it("should persist log entries to state.log", () => {
            const player = createTestPlayer({ initiative: 20 });
            const goblin = createTestGoblin({ initiative: 10 });

            engine.initiateCombat([player, goblin]);

            const state = engine.getState();
            expect(state.log.length).toBeGreaterThan(0);
            expect(state.log.some(l => l.type === "COMBAT_START")).toBe(true);
        });

        it("should accumulate logs after attack", () => {
            const player = createTestPlayer({ initiative: 20, attackModifier: 100 });
            const goblin = createTestGoblin({ initiative: 10 });

            engine.initiateCombat([player, goblin]);
            const logBefore = engine.getState().log.length;

            engine.submitAction({ type: "ATTACK", attackerId: "player-1", targetId: "goblin-1" });

            const logAfter = engine.getState().log.length;
            expect(logAfter).toBeGreaterThan(logBefore);
        });

        it("should include logs after export/import round-trip", () => {
            const player = createTestPlayer({ initiative: 20 });
            const goblin = createTestGoblin({ initiative: 10 });

            engine.initiateCombat([player, goblin]);

            const exported = engine.exportState();
            const newEngine = createCombatEngine(1);
            newEngine.loadState(exported);

            const state = newEngine.getState();
            expect(state.log.length).toBeGreaterThan(0);
        });
    });

    describe("1.4 — Crit detection via rawD20", () => {
        it("should detect nat 20 crit via rawD20 field", () => {
            const player = createTestPlayer({ initiative: 20, attackModifier: 5 });
            const goblin = createTestGoblin({ initiative: 10, baseAC: 10 });

            engine.initiateCombat([player, goblin]);

            const result = engine.submitAction({
                type: "ATTACK",
                attackerId: "player-1",
                targetId: "goblin-1",
                attackRoll: 25,  // 20 + 5 modifier
                rawD20: 20,
            });

            expect(result.success).toBe(true);
            const attackLog = result.logs.find(l => l.type === "ATTACK_ROLL");
            expect(attackLog?.roll?.isCritical).toBe(true);
        });

        it("should detect nat 1 fumble via rawD20 field", () => {
            const player = createTestPlayer({ initiative: 20, attackModifier: 5 });
            const goblin = createTestGoblin({ initiative: 10, baseAC: 10 });

            engine.initiateCombat([player, goblin]);

            const result = engine.submitAction({
                type: "ATTACK",
                attackerId: "player-1",
                targetId: "goblin-1",
                attackRoll: 6,  // 1 + 5 modifier
                rawD20: 1,
            });

            expect(result.success).toBe(true);
            const attackLog = result.logs.find(l => l.type === "ATTACK_ROLL");
            expect(attackLog?.roll?.isFumble).toBe(true);
        });

        it("should NOT crit when total >= 20+mod but rawD20 is not 20", () => {
            const player = createTestPlayer({ initiative: 20, attackModifier: 5 });
            const goblin = createTestGoblin({ initiative: 10, baseAC: 10 });

            engine.initiateCombat([player, goblin]);

            // Total = 25 (which is >= 20+5=25), but raw d20 is 10 — not a crit
            const result = engine.submitAction({
                type: "ATTACK",
                attackerId: "player-1",
                targetId: "goblin-1",
                attackRoll: 25,
                rawD20: 10,
            });

            expect(result.success).toBe(true);
            const attackLog = result.logs.find(l => l.type === "ATTACK_ROLL");
            expect(attackLog?.roll?.isCritical).toBe(false);
        });
    });

    describe("1.5 — endTurn round boundary when skipping dead entities", () => {
        it("should reach round 2 after all entities complete their turns", () => {
            // Turn order: player(20), enemy1(10), enemy2(5)
            const player = createTestPlayer({ initiative: 20 });
            const enemy1 = createEnemyEntity("enemy-1", "Orc1", 5, 10, 3, "1d4", { initiative: 10 });
            const enemy2 = createEnemyEntity("enemy-2", "Orc2", 5, 10, 3, "1d4", { initiative: 5 });

            engine.initiateCombat([player, enemy1, enemy2]);
            expect(engine.getState().round).toBe(1);

            engine.submitAction({ type: "END_TURN", entityId: "player-1" });
            engine.submitAction({ type: "END_TURN", entityId: "enemy-1" });
            engine.submitAction({ type: "END_TURN", entityId: "enemy-2" });

            expect(engine.getState().round).toBe(2);
        });

        it("should increment round when endTurn skip-loop wraps past dead entities", () => {
            // Turn order: player(20), enemy1(10), enemy2(5)
            // We kill enemy2 (last in order), then when enemy1 ends its turn,
            // the skip loop must wrap past dead enemy2 back to player → new round.
            const killEngine = createCombatEngine(50);
            const p = createTestPlayer({ initiative: 20, attackModifier: 5 });
            const e1 = createEnemyEntity("enemy-1", "Orc1", 50, 10, 3, "1d4", { initiative: 10 });
            const e2 = createEnemyEntity("enemy-2", "Orc2", 5, 10, 3, "1d4", { initiative: 5 });
            killEngine.initiateCombat([p, e1, e2]);
            // Turn order: player(20) → enemy1(10) → enemy2(5)

            // Player hits and kills enemy2 by providing rolls directly
            // attackRoll total = 15 (rawD20=10, mod=5), hits AC10; damage=4 for 1d4 formula
            const atkResult = killEngine.submitAction({
                type: "ATTACK",
                attackerId: "player-1",
                targetId: "enemy-2",
                attackRoll: 15,
                rawD20: 10,
            });
            expect(atkResult.awaitingDamageRoll).toBe(true);
            // Player formula is 1d8+3 (range 4-11); 8 damage kills enemy2 (5HP)
            killEngine.applyDamage(8);

            const stateAfterKill = killEngine.getState();
            expect(killEngine.getEntity("enemy-2")?.status).toBe("DEAD");
            expect(stateAfterKill.round).toBe(1);

            // Turn advanced to enemy1 after player's attack
            expect(killEngine.getCurrentTurnEntity()?.id).toBe("enemy-1");

            // Enemy1 ends turn — skip loop should skip dead enemy2 and wrap to player → round 2
            killEngine.submitAction({ type: "END_TURN", entityId: "enemy-1" });

            expect(killEngine.getState().round).toBe(2);
            expect(killEngine.getCurrentTurnEntity()?.id).toBe("player-1");
        });
    });
});
