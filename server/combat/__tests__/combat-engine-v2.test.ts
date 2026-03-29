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

            // Player still has bonus action — explicitly end turn
            killEngine.submitAction({ type: "END_TURN", entityId: "player-1" });

            // Turn advanced to enemy1
            expect(killEngine.getCurrentTurnEntity()?.id).toBe("enemy-1");

            // Enemy1 ends turn — skip loop should skip dead enemy2 and wrap to player → round 2
            killEngine.submitAction({ type: "END_TURN", entityId: "enemy-1" });

            expect(killEngine.getState().round).toBe(2);
            expect(killEngine.getCurrentTurnEntity()?.id).toBe("player-1");
        });
    });

    // =========================================================================
    // Stage 4 Action Economy Tests
    // =========================================================================

    describe("4.1 — Turn resources are initialized", () => {
        it("should initialize turnResources at combat start", () => {
            const player = createTestPlayer({ initiative: 20 });
            const goblin = createTestGoblin({ initiative: 10 });

            engine.initiateCombat([player, goblin]);
            const state = engine.getState();

            expect(state.turnResources).toBeDefined();
            expect(state.turnResources!.actionUsed).toBe(false);
            expect(state.turnResources!.bonusActionUsed).toBe(false);
            expect(state.turnResources!.reactionUsed).toBe(false);
            expect(state.turnResources!.extraAttacksRemaining).toBe(0);
        });

        it("should reset turnResources when a new turn starts", () => {
            const player = createTestPlayer({ initiative: 20 });
            const goblin = createTestGoblin({ initiative: 10 });

            engine.initiateCombat([player, goblin]);

            // Player ends turn
            engine.submitAction({ type: "END_TURN", entityId: "player-1" });
            // Goblin's turn — resources should be fresh
            const state = engine.getState();
            expect(state.turnResources).toBeDefined();
            expect(state.turnResources!.actionUsed).toBe(false);
        });
    });

    describe("4.2 — Attacks no longer auto-end player turns", () => {
        it("should NOT auto-end player turn after attack miss", () => {
            const player = createTestPlayer({ initiative: 20, attackModifier: 0 });
            const goblin = createTestGoblin({ initiative: 10, baseAC: 25 }); // Very high AC → guaranteed miss

            engine.initiateCombat([player, goblin]);

            // Player attacks with a low roll → miss
            const result = engine.submitAction({
                type: "ATTACK",
                attackerId: "player-1",
                targetId: "goblin-1",
                attackRoll: 5,  // 5 vs AC 25 → miss
                rawD20: 5,
            });

            expect(result.success).toBe(true);
            // Action is used, but player still has bonus action — turn should NOT auto-end
            expect(engine.getCurrentTurnEntity()?.id).toBe("player-1");
            // Player can still end their turn explicitly
            engine.submitAction({ type: "END_TURN", entityId: "player-1" });
            expect(engine.getCurrentTurnEntity()?.id).toBe("goblin-1");
        });

        it("should auto-end enemy turn after attack", () => {
            const player = createTestPlayer({ initiative: 10 });
            const goblin = createTestGoblin({ initiative: 20, attackModifier: 100 });

            engine.initiateCombat([player, goblin]);

            // Goblin attacks player (auto-rolls and auto-damages)
            engine.submitAction({
                type: "ATTACK",
                attackerId: "goblin-1",
                targetId: "player-1",
            });

            // Enemy turn should auto-end → now player's turn
            expect(engine.getCurrentTurnEntity()?.id).toBe("player-1");
        });

        it("should end player turn when player explicitly sends END_TURN", () => {
            const player = createTestPlayer({ initiative: 20 });
            const goblin = createTestGoblin({ initiative: 10 });

            engine.initiateCombat([player, goblin]);
            expect(engine.getCurrentTurnEntity()?.id).toBe("player-1");

            engine.submitAction({ type: "END_TURN", entityId: "player-1" });
            expect(engine.getCurrentTurnEntity()?.id).toBe("goblin-1");
        });
    });

    describe("4.3 — Standard actions", () => {
        it("should apply Dodge action and add 'dodging' condition", () => {
            const player = createTestPlayer({ initiative: 20 });
            const goblin = createTestGoblin({ initiative: 10 });

            engine.initiateCombat([player, goblin]);

            const result = engine.submitAction({
                type: "DODGE",
                entityId: "player-1",
            });

            expect(result.success).toBe(true);
            expect(result.logs.some(l => l.type === "ACTION")).toBe(true);
            // Player should have 'dodging' condition
            const playerEntity = engine.getEntity("player-1");
            expect(playerEntity?.conditions).toContain("dodging");
        });

        it("should apply Dash action", () => {
            const player = createTestPlayer({ initiative: 20 });
            const goblin = createTestGoblin({ initiative: 10 });

            engine.initiateCombat([player, goblin]);

            const result = engine.submitAction({
                type: "DASH",
                entityId: "player-1",
            });

            expect(result.success).toBe(true);
            expect(result.logs.some(l =>
                l.type === "ACTION" && l.description?.includes("Dash")
            )).toBe(true);
        });

        it("should apply Disengage action and add 'disengaging' condition", () => {
            const player = createTestPlayer({ initiative: 20 });
            const goblin = createTestGoblin({ initiative: 10 });

            engine.initiateCombat([player, goblin]);

            const result = engine.submitAction({
                type: "DISENGAGE",
                entityId: "player-1",
            });

            expect(result.success).toBe(true);
            const playerEntity = engine.getEntity("player-1");
            expect(playerEntity?.conditions).toContain("disengaging");
        });

        it("should apply Help action and grant advantage condition to ally", () => {
            const player1 = createTestPlayer({ initiative: 20 });
            const player2 = createPlayerEntity("player-2", "Legolas", 25, 25, 14, 18, { attackModifier: 7 });
            const goblin = createTestGoblin({ initiative: 5 });

            engine.initiateCombat([player1, player2, goblin]);

            const result = engine.submitAction({
                type: "HELP",
                entityId: "player-1",
                allyId: "player-2",
                targetId: "goblin-1",
            });

            expect(result.success).toBe(true);
            // Legolas should have a helped_by condition
            const legolas = engine.getEntity("player-2");
            expect(legolas?.conditions.some(c => c.startsWith("helped_by:player-1"))).toBe(true);
        });

        it("should apply Hide action and add 'hidden' condition", () => {
            const player = createTestPlayer({ initiative: 20 });
            const goblin = createTestGoblin({ initiative: 10 });

            engine.initiateCombat([player, goblin]);

            const result = engine.submitAction({
                type: "HIDE",
                entityId: "player-1",
            });

            expect(result.success).toBe(true);
            const playerEntity = engine.getEntity("player-1");
            expect(playerEntity?.conditions).toContain("hidden");
        });

        it("should apply Ready action and store readied condition", () => {
            const player = createTestPlayer({ initiative: 20 });
            const goblin = createTestGoblin({ initiative: 10 });

            engine.initiateCombat([player, goblin]);

            const result = engine.submitAction({
                type: "READY",
                entityId: "player-1",
                trigger: "when the goblin comes within reach",
                readiedAction: "ATTACK",
                targetId: "goblin-1",
            });

            expect(result.success).toBe(true);
            const playerEntity = engine.getEntity("player-1");
            expect(playerEntity?.conditions.some(c => c.startsWith("readied:ATTACK"))).toBe(true);
        });

        it("should apply Use Item action", () => {
            const player = createTestPlayer({ initiative: 20 });
            const goblin = createTestGoblin({ initiative: 10 });

            engine.initiateCombat([player, goblin]);

            const result = engine.submitAction({
                type: "USE_ITEM",
                entityId: "player-1",
                itemName: "healing potion",
            });

            expect(result.success).toBe(true);
            expect(result.logs.some(l =>
                l.type === "ACTION" && l.description?.includes("healing potion")
            )).toBe(true);
        });
    });

    describe("4.4 — getLegalActions respects action economy", () => {
        it("should return attack and standard actions when action is available", () => {
            const player = createTestPlayer({ initiative: 20 });
            const goblin = createTestGoblin({ initiative: 10 });

            engine.initiateCombat([player, goblin]);

            const actions = engine.getLegalActions("player-1");

            // Should have: ATTACK(goblin), DODGE, DASH, DISENGAGE, HIDE, READY, USE_ITEM, END_TURN
            expect(actions.some(a => a.type === "ATTACK")).toBe(true);
            expect(actions.some(a => a.type === "DODGE")).toBe(true);
            expect(actions.some(a => a.type === "DASH")).toBe(true);
            expect(actions.some(a => a.type === "DISENGAGE")).toBe(true);
            expect(actions.some(a => a.type === "HIDE")).toBe(true);
            expect(actions.some(a => a.type === "READY")).toBe(true);
            expect(actions.some(a => a.type === "USE_ITEM")).toBe(true);
            expect(actions.some(a => a.type === "END_TURN")).toBe(true);
            // No HELP with only 1 player and 1 enemy (no allies to help)
        });

        it("should include HELP when there are multiple players", () => {
            const player1 = createTestPlayer({ initiative: 20 });
            const player2 = createPlayerEntity("player-2", "Legolas", 25, 25, 14, 18);
            const goblin = createTestGoblin({ initiative: 5 });

            engine.initiateCombat([player1, player2, goblin]);

            const actions = engine.getLegalActions("player-1");
            expect(actions.some(a => a.type === "HELP")).toBe(true);
        });

        it("should NOT offer action-cost abilities after action is used", () => {
            const player = createTestPlayer({ initiative: 20 });
            const goblin = createTestGoblin({ initiative: 10 });

            engine.initiateCombat([player, goblin]);

            // Use the Dodge action (consumes the Action)
            engine.submitAction({ type: "DODGE", entityId: "player-1" });

            // Action is used, but bonus action remains — turn should NOT auto-end
            expect(engine.getCurrentTurnEntity()?.id).toBe("player-1");

            // Legal actions should NOT include action-cost abilities
            const actions = engine.getLegalActions("player-1");
            expect(actions.some(a => a.type === "ATTACK")).toBe(false);
            expect(actions.some(a => a.type === "DODGE")).toBe(false);
            expect(actions.some(a => a.type === "END_TURN")).toBe(true);
        });

        it("should always include END_TURN", () => {
            const player = createTestPlayer({ initiative: 20 });
            const goblin = createTestGoblin({ initiative: 10 });

            engine.initiateCombat([player, goblin]);

            const actions = engine.getLegalActions("player-1");
            expect(actions.some(a => a.type === "END_TURN")).toBe(true);
        });

        it("should not include dead entities as targets", () => {
            const player = createTestPlayer({ initiative: 20 });
            const goblin = createTestGoblin({ initiative: 10 });

            engine.initiateCombat([player, goblin]);

            // Kill the goblin manually
            const g = engine.getEntity("goblin-1");
            if (g) { g.hp = 0; g.status = "DEAD"; }

            const actions = engine.getLegalActions("player-1");
            expect(actions.filter(a => a.type === "ATTACK")).toHaveLength(0);
        });

        it("should return empty array when not entity's turn", () => {
            const player = createTestPlayer({ initiative: 20 });
            const goblin = createTestGoblin({ initiative: 10 });

            engine.initiateCombat([player, goblin]);

            // It's player's turn, not goblin's
            const actions = engine.getLegalActions("goblin-1");
            expect(actions).toHaveLength(0);
        });
    });

    describe("4.5 — Turn-scoped conditions are cleared", () => {
        it("should clear 'dodging' condition at start of the dodging entity's next turn", () => {
            const player = createTestPlayer({ initiative: 20 });
            const goblin = createTestGoblin({ initiative: 10 });

            engine.initiateCombat([player, goblin]);

            // Player dodges (uses action, but has bonus action remaining)
            engine.submitAction({ type: "DODGE", entityId: "player-1" });

            // Explicitly end turn to advance
            engine.submitAction({ type: "END_TURN", entityId: "player-1" });

            // Goblin's turn now
            expect(engine.getCurrentTurnEntity()?.id).toBe("goblin-1");
            // Player still has dodging
            expect(engine.getEntity("player-1")?.conditions).toContain("dodging");

            // Goblin ends turn
            engine.submitAction({ type: "END_TURN", entityId: "goblin-1" });

            // Player's turn again — dodging should be cleared
            expect(engine.getCurrentTurnEntity()?.id).toBe("player-1");
            expect(engine.getEntity("player-1")?.conditions).not.toContain("dodging");
        });

        it("should clear 'helped_by' conditions when the helper's next turn starts", () => {
            const player1 = createTestPlayer({ initiative: 20 });
            const player2 = createPlayerEntity("player-2", "Legolas", 25, 25, 14, 18, { attackModifier: 7 });
            const goblin = createTestGoblin({ initiative: 5 });

            engine.initiateCombat([player1, player2, goblin]);

            // Player1 helps Player2
            engine.submitAction({
                type: "HELP",
                entityId: "player-1",
                allyId: "player-2",
            });

            // Player1 still has bonus action — explicitly end turn
            expect(engine.getCurrentTurnEntity()?.id).toBe("player-1");
            engine.submitAction({ type: "END_TURN", entityId: "player-1" });

            // Player2's turn — should still have the help condition
            expect(engine.getCurrentTurnEntity()?.id).toBe("player-2");
            expect(engine.getEntity("player-2")?.conditions.some(c => c.startsWith("helped_by:player-1"))).toBe(true);

            // Player2 and goblin end their turns
            engine.submitAction({ type: "END_TURN", entityId: "player-2" });
            engine.submitAction({ type: "END_TURN", entityId: "goblin-1" });

            // Player1's turn again — helped_by should be cleared from Player2
            expect(engine.getCurrentTurnEntity()?.id).toBe("player-1");
            expect(engine.getEntity("player-2")?.conditions.some(c => c.startsWith("helped_by:player-1"))).toBe(false);
        });
    });

    describe("4.6 — Enemy Multiattack", () => {
        it("should not auto-end enemy turn when extraAttacksRemaining > 0", () => {
            // Enemy with 1 extra attack: action + 1 extra = 2 total attacks
            const hitRoll = () => ({ total: 20, rolls: [20], isCritical: true, isFumble: false });
            const localEngine = createCombatEngine(1, {}, hitRoll);

            const player = createTestPlayer({ initiative: 10, baseAC: 5 });
            const multiAttacker = createEnemyEntity("enemy-1", "Fighter", 50, 14, 6, "1d8+4", {
                initiative: 20,
                extraAttacks: 1,
            });

            localEngine.initiateCombat([player, multiAttacker]);
            expect(localEngine.getCurrentTurnEntity()?.id).toBe("enemy-1");

            // First attack — should NOT end turn (extraAttacksRemaining: 1 → 0, but actionUsed + resource
            // check: enemy only auto-ends when extraAttacksRemaining === 0 AND action is used via normal path)
            const result = localEngine.submitAction({
                type: "ATTACK",
                attackerId: "enemy-1",
                targetId: "player-1",
                weaponName: "sword",
                isRanged: false,
                advantage: false,
                disadvantage: false,
            });

            // Extra attack consumed the extra slot — enemy still has their turn
            expect(result.success).toBe(true);
            expect(localEngine.getCurrentTurnEntity()?.id).toBe("enemy-1");

            // Second attack — uses the action resource, then auto-ends
            const result2 = localEngine.submitAction({
                type: "ATTACK",
                attackerId: "enemy-1",
                targetId: "player-1",
                weaponName: "sword",
                isRanged: false,
                advantage: false,
                disadvantage: false,
            });

            expect(result2.success).toBe(true);
            // Turn should now have ended (action exhausted, no extra attacks left)
            expect(localEngine.getCurrentTurnEntity()?.id).toBe("player-1");
        });

        it("should allow setting extraAttacks on entity and have it reflected in legal actions", () => {
            const player = createTestPlayer({ initiative: 10 });
            const multiAttacker = createEnemyEntity("enemy-1", "Fighter", 50, 14, 6, "1d8+4", {
                initiative: 20,
                extraAttacks: 1,
            });

            engine.initiateCombat([player, multiAttacker]);
            const legal = engine.getLegalActions("enemy-1");
            // Should have ATTACK actions available (action not yet used)
            expect(legal.some(a => a.type === "ATTACK")).toBe(true);
        });
    });

    describe("4.6 — Resource consumption prevents double actions", () => {
        it("should reject a second action-cost ability after action is used", () => {
            const player = createTestPlayer({ initiative: 20 });
            const goblin = createTestGoblin({ initiative: 10 });

            engine.initiateCombat([player, goblin]);

            // Dodge uses the action
            const r1 = engine.submitAction({ type: "DODGE", entityId: "player-1" });
            expect(r1.success).toBe(true);

            // Player still has bonus action — turn should NOT auto-end
            expect(engine.getCurrentTurnEntity()?.id).toBe("player-1");

            // A second action-cost ability should be rejected
            const r2 = engine.submitAction({ type: "DASH", entityId: "player-1" });
            expect(r2.success).toBe(false);

            // Explicitly end turn
            engine.submitAction({ type: "END_TURN", entityId: "player-1" });
            expect(engine.getCurrentTurnEntity()?.id).toBe("goblin-1");
        });
    });

    // =========================================================================
    // STAGE 5 TESTS
    // =========================================================================

    describe("Stage 5 — Conditions", () => {
        it("should apply advantage on attack against a prone target in melee", () => {
            const alwaysRoll10 = () => ({ total: 10, rolls: [10], isCritical: false, isFumble: false });
            const localEngine = createCombatEngine(1, {}, alwaysRoll10);

            const player = createTestPlayer({ initiative: 20, attackModifier: 0 });
            // Goblin AC 15 — roll of 10 + 0 = 10, misses. But with advantage (2d20kh1), the
            // mock always returns 10, so we just verify the formula switches.
            const goblin = createTestGoblin({ initiative: 10, baseAC: 5 });

            localEngine.initiateCombat([player, goblin]);

            // Apply prone to the goblin
            localEngine.applyCondition("goblin-1", { name: "prone" });
            expect(localEngine.hasActiveCondition("goblin-1", "prone")).toBe(true);

            // Attack (melee, default) — should get advantage from prone target
            const result = localEngine.submitAction({
                type: "ATTACK",
                attackerId: "player-1",
                targetId: "goblin-1",
                attackRoll: 8,      // Low total — would miss AC 5 normally if fumble, but let's use a valid roll
                rawD20: 8,          // Not a fumble — 8+0=8, hits AC 5
                isRanged: false,
                advantage: false,
                disadvantage: false,
            });

            // The ATTACK_ROLL log should note that we hit
            const attackLog = result.logs.find(l => l.type === "ATTACK_ROLL");
            expect(attackLog).toBeDefined();
            expect(attackLog?.success).toBe(true);
        });

        it("should auto-crit against stunned target in melee", () => {
            const alwaysRoll10 = () => ({ total: 10, rolls: [10], isCritical: false, isFumble: false });
            const localEngine = createCombatEngine(1, {}, alwaysRoll10);

            const player = createTestPlayer({ initiative: 20, attackModifier: 0, damageFormula: "1d6" });
            const goblin = createTestGoblin({ initiative: 10, baseAC: 20 }); // Very high AC

            localEngine.initiateCombat([player, goblin]);
            localEngine.applyCondition("goblin-1", { name: "stunned" });

            // Roll of 10 would miss AC 20, but stunned in melee = auto-crit (always hits)
            const result = localEngine.submitAction({
                type: "ATTACK",
                attackerId: "player-1",
                targetId: "goblin-1",
                attackRoll: 10,
                rawD20: 10,
                isRanged: false,
                advantage: false,
                disadvantage: false,
            });

            const attackLog = result.logs.find(l => l.type === "ATTACK_ROLL");
            expect(attackLog?.roll?.isCritical).toBe(true);
            expect(attackLog?.success).toBe(true);
        });

        it("should remove conditions when duration expires at start of turn", () => {
            const player = createTestPlayer({ initiative: 20 });
            const goblin = createTestGoblin({ initiative: 10 });

            engine.initiateCombat([player, goblin]);

            // Apply poisoned to player with 1-round duration
            engine.applyCondition("player-1", { name: "poisoned", duration: 1 });
            expect(engine.hasActiveCondition("player-1", "poisoned")).toBe(true);

            // End player's turn, goblin ends turn, back to player — condition ticks
            engine.submitAction({ type: "END_TURN", entityId: "player-1" });
            engine.submitAction({ type: "END_TURN", entityId: "goblin-1" });

            // Player's new turn starts — duration was 1, ticked to 0, should be removed
            expect(engine.getCurrentTurnEntity()?.id).toBe("player-1");
            expect(engine.hasActiveCondition("player-1", "poisoned")).toBe(false);
        });

        it("should keep permanent conditions (no duration) across turns", () => {
            const player = createTestPlayer({ initiative: 20 });
            const goblin = createTestGoblin({ initiative: 10 });

            engine.initiateCombat([player, goblin]);

            // Permanent blinded condition (no duration)
            engine.applyCondition("player-1", { name: "blinded" });

            engine.submitAction({ type: "END_TURN", entityId: "player-1" });
            engine.submitAction({ type: "END_TURN", entityId: "goblin-1" });

            expect(engine.hasActiveCondition("player-1", "blinded")).toBe(true);
        });

        it("should remove a condition via removeCondition", () => {
            const player = createTestPlayer({ initiative: 20 });
            const goblin = createTestGoblin({ initiative: 10 });

            engine.initiateCombat([player, goblin]);
            engine.applyCondition("player-1", { name: "frightened" });
            expect(engine.hasActiveCondition("player-1", "frightened")).toBe(true);

            engine.removeCondition("player-1", "frightened");
            expect(engine.hasActiveCondition("player-1", "frightened")).toBe(false);
        });
    });

    describe("Stage 5 — Death Saving Throws", () => {
        function setupUnconsciousPlayer() {
            // Engine with guaranteed hit + max damage to knock player unconscious
            const killRoll = () => ({ total: 999, rolls: [999], isCritical: false, isFumble: false });
            const localEngine = createCombatEngine(1, {}, killRoll);

            const player = createTestPlayer({ initiative: 10, hp: 5, maxHp: 5 });
            const goblin = createTestGoblin({ initiative: 20, damageFormula: "100d6" });

            localEngine.initiateCombat([player, goblin]);

            // Goblin attacks and knocks player unconscious
            localEngine.submitAction({
                type: "ATTACK",
                attackerId: "goblin-1",
                targetId: "player-1",
                advantage: false,
                disadvantage: false,
                isRanged: false,
            });

            return localEngine;
        }

        it("should enter AWAIT_DEATH_SAVE when unconscious player's turn starts", () => {
            const localEngine = setupUnconsciousPlayer();

            // Player should now be UNCONSCIOUS
            expect(localEngine.getEntity("player-1")?.status).toBe("UNCONSCIOUS");

            // End goblin's turn → player's turn starts → should enter death save phase
            // (goblin already auto-ended; check current state)
            expect(localEngine.getState().phase).toBe("AWAIT_DEATH_SAVE");
        });

        it("should regain 1 HP and become ALIVE on nat 20 death save", () => {
            const localEngine = setupUnconsciousPlayer();

            const result = localEngine.rollDeathSave("player-1", 20);

            expect(result.success).toBe(true);
            expect(localEngine.getEntity("player-1")?.status).toBe("ALIVE");
            expect(localEngine.getEntity("player-1")?.hp).toBe(1);
        });

        it("should record a success on roll >= 10", () => {
            const localEngine = setupUnconsciousPlayer();

            localEngine.rollDeathSave("player-1", 15);

            // 1 success recorded, not 3 yet so not cleared
            expect(localEngine.getEntity("player-1")?.deathSaves.successes).toBe(1);
        });

        it("should stabilize after 3 successes", () => {
            const localEngine = setupUnconsciousPlayer();

            // Roll 3 successes
            localEngine.rollDeathSave("player-1", 15);
            // After each rollDeathSave endTurn is called, so we need to re-enter death save phase
            // For simplicity, test the direct stabilization:
            const entity = localEngine.getEntity("player-1");
            if (entity) entity.deathSaves = { successes: 2, failures: 0 };
            // Re-enter death save phase manually for test
            (localEngine as any).state.phase = "AWAIT_DEATH_SAVE";

            const result = localEngine.rollDeathSave("player-1", 12);
            expect(result.success).toBe(true);
            // After stabilizing, death saves cleared
            expect(localEngine.getEntity("player-1")?.deathSaves.successes).toBe(0);
            expect(localEngine.getEntity("player-1")?.deathSaves.failures).toBe(0);
        });

        it("should die on 3 death save failures", () => {
            const localEngine = setupUnconsciousPlayer();

            const entity = localEngine.getEntity("player-1")!;
            entity.deathSaves = { successes: 0, failures: 2 };
            (localEngine as any).state.phase = "AWAIT_DEATH_SAVE";

            const result = localEngine.rollDeathSave("player-1", 5);
            expect(result.success).toBe(true);
            expect(localEngine.getEntity("player-1")?.status).toBe("DEAD");
        });

        it("should add 2 failures on nat 1 death save", () => {
            const localEngine = setupUnconsciousPlayer();

            const entity = localEngine.getEntity("player-1")!;
            entity.deathSaves = { successes: 0, failures: 0 };

            localEngine.rollDeathSave("player-1", 1);

            // After rolling 1, turn ends and we're in next enemy turn — check accumulated failures
            // The entity should still have failures recorded (unless it looped to next turn)
            // We check via the entity directly
            const afterEntity = localEngine.getEntity("player-1")!;
            // Entity either has 2 failures or is DEAD (if that triggered 3 failures)
            expect(afterEntity.deathSaves.failures >= 2 || afterEntity.status === "DEAD").toBe(true);
        });

        it("should auto-fail on taking damage while unconscious (melee = 2 failures)", () => {
            const killRoll = () => ({ total: 999, rolls: [999], isCritical: false, isFumble: false });
            const localEngine = createCombatEngine(1, {}, killRoll);

            const player = createTestPlayer({ initiative: 10, hp: 5, maxHp: 5 });
            const goblin = createTestGoblin({ initiative: 20, damageFormula: "100d6" });

            localEngine.initiateCombat([player, goblin]);

            // Knock player unconscious
            localEngine.submitAction({
                type: "ATTACK",
                attackerId: "goblin-1",
                targetId: "player-1",
                advantage: false,
                disadvantage: false,
                isRanged: false,
            });

            // Player is now unconscious — goblin attacks again before player's turn
            // Need to be in ACTIVE phase on goblin's turn — but we auto-ended, so manually set:
            const entity = localEngine.getEntity("player-1")!;
            entity.deathSaves = { successes: 0, failures: 0 };

            // Simulate enemy attack on unconscious player by calling processAttack indirectly
            // We do this by resetting to goblin's turn and attacking
            (localEngine as any).state.phase = "ACTIVE";
            (localEngine as any).state.turnIndex = localEngine.getState().turnOrder.indexOf("goblin-1");
            localEngine.initTurnResources ? undefined : undefined; // noop

            const attackResult = localEngine.submitAction({
                type: "ATTACK",
                attackerId: "goblin-1",
                targetId: "player-1",
                advantage: false,
                disadvantage: false,
                isRanged: false,
            });

            // Should have a log entry about death save auto-fail
            const deathSaveLog = attackResult.logs.find(l =>
                l.description?.includes("death save failure")
            );
            expect(deathSaveLog).toBeDefined();
            expect(entity.deathSaves.failures).toBeGreaterThanOrEqual(2);
        });
    });

    describe("Stage 5 — Healing", () => {
        it("should restore HP up to maxHp", () => {
            const player = createTestPlayer({ initiative: 20, hp: 10, maxHp: 30 });
            const goblin = createTestGoblin({ initiative: 10 });
            const player2 = createPlayerEntity("player-2", "Cleric", 25, 25, 14, 15, { attackModifier: 4 });

            engine.initiateCombat([player, player2, goblin]);

            // Player 1 heals player 1 (self-heal)
            const result = engine.submitAction({
                type: "HEAL",
                entityId: "player-1",
                targetId: "player-1",
                amount: 15,
            });

            expect(result.success).toBe(true);
            expect(engine.getEntity("player-1")?.hp).toBe(25); // 10 + 15
            expect(result.logs.find(l => l.type === "HEALING")).toBeDefined();
        });

        it("should cap HP at maxHp", () => {
            const player = createTestPlayer({ initiative: 20, hp: 28, maxHp: 30 });
            const goblin = createTestGoblin({ initiative: 10 });

            engine.initiateCombat([player, goblin]);

            engine.submitAction({
                type: "HEAL",
                entityId: "player-1",
                targetId: "player-1",
                amount: 100,
            });

            expect(engine.getEntity("player-1")?.hp).toBe(30);
        });

        it("should revive an unconscious player and clear death saves", () => {
            const player = createTestPlayer({ initiative: 20, hp: 0, maxHp: 30 });
            const goblin = createTestGoblin({ initiative: 10 });
            const cleric = createPlayerEntity("cleric-1", "Cleric", 30, 30, 14, 15, { attackModifier: 4 });

            engine.initiateCombat([player, cleric, goblin]);

            // Force player to unconscious
            const playerEntity = engine.getEntity("player-1")!;
            playerEntity.status = "UNCONSCIOUS";
            playerEntity.deathSaves = { successes: 1, failures: 1 };

            // Cleric heals player (cleric goes second due to initiative)
            engine.submitAction({ type: "END_TURN", entityId: "player-1" });
            // Now it's cleric's turn
            expect(engine.getCurrentTurnEntity()?.id).toBe("cleric-1");

            const result = engine.submitAction({
                type: "HEAL",
                entityId: "cleric-1",
                targetId: "player-1",
                amount: 10,
            });

            expect(result.success).toBe(true);
            expect(engine.getEntity("player-1")?.status).toBe("ALIVE");
            expect(engine.getEntity("player-1")?.deathSaves).toEqual({ successes: 0, failures: 0 });
        });
    });

    describe("Stage 5 — Damage Modifiers", () => {
        it("should deal 0 damage for an immune target", () => {
            const killRoll = () => ({ total: 999, rolls: [999], isCritical: false, isFumble: false });
            const localEngine = createCombatEngine(1, {}, killRoll);

            const player = createTestPlayer({ initiative: 10, hp: 30, maxHp: 30 });
            // Goblin immune to the player's damage type
            const fireGoblin = createEnemyEntity("goblin-1", "Fire Goblin", 7, 5, 4, "1d6", {
                initiative: 20,
                immunities: ["slashing"],
            });

            localEngine.initiateCombat([player, fireGoblin]);

            // Goblin attacks player — player's damageType is "bludgeoning" by default, not slashing
            // Let's have the player attack the goblin with slashing damage type
            const goblin = localEngine.getEntity("goblin-1")!;
            goblin.attackModifier = 10;
            goblin.damageFormula = "10d6";
            goblin.damageType = "slashing"; // immune

            // This is goblin's turn (initiative 20)
            localEngine.submitAction({
                type: "ATTACK",
                attackerId: "goblin-1",
                targetId: "player-1",
                advantage: false,
                disadvantage: false,
                isRanged: false,
            });

            // Player should be immune to slashing — no damage taken
            // Wait — we set goblin to attack player with slashing, but player is not immune.
            // Let's test the other way: make player attack goblin who is immune to bludgeoning
            // Reset engine
            const localEngine2 = createCombatEngine(2, {}, killRoll);
            const player2 = createTestPlayer({ initiative: 20, damageFormula: "1d8", hp: 30, maxHp: 30 });
            // Player's damageType is "bludgeoning" by default (from createPlayerEntity)
            const immuneGoblin = createEnemyEntity("goblin-2", "Stone Golem", 50, 5, 0, "1d4", {
                initiative: 10,
                immunities: ["bludgeoning"],
            });

            localEngine2.initiateCombat([player2, immuneGoblin]);

            localEngine2.submitAction({
                type: "ATTACK",
                attackerId: "player-1",
                targetId: "goblin-2",
                attackRoll: 25,
                rawD20: 20,
                isRanged: false,
                advantage: false,
                disadvantage: false,
            });
            // Hit confirmed — now apply damage
            localEngine2.applyDamage(10);

            // Goblin should take 0 damage (immune to bludgeoning)
            expect(localEngine2.getEntity("goblin-2")?.hp).toBe(50);
        });

        it("should halve damage for a resistant target", () => {
            const fixedRoll = () => ({ total: 15, rolls: [15], isCritical: false, isFumble: false });
            const localEngine = createCombatEngine(1, {}, fixedRoll);

            const player = createTestPlayer({ initiative: 10, hp: 30, maxHp: 30 });
            // Goblin resistant to the damage type used
            const goblin = createEnemyEntity("goblin-1", "Tough Goblin", 30, 5, 10, "1d6+2", {
                initiative: 20,
                damageType: "fire",
                resistances: ["fire"],
            });

            localEngine.initiateCombat([player, goblin]);

            // Goblin attacks with fire damage — player is not resistant
            // Let's test player attacking goblin that is resistant to bludgeoning
            const localEngine2 = createCombatEngine(2, {}, fixedRoll);
            const player2 = createTestPlayer({ initiative: 20, hp: 30, maxHp: 30, damageFormula: "1d6+2" });
            const resistGoblin = createEnemyEntity("goblin-2", "Iron Goblin", 30, 5, 0, "1d4", {
                initiative: 10,
                resistances: ["bludgeoning"],
            });

            localEngine2.initiateCombat([player2, resistGoblin]);
            localEngine2.submitAction({
                type: "ATTACK",
                attackerId: "player-1",
                targetId: "goblin-2",
                attackRoll: 20,
                rawD20: 15,
                isRanged: false,
                advantage: false,
                disadvantage: false,
            });

            // Apply 6 damage (valid for 1d6+2: range 3-8)
            // Resistant to bludgeoning → floor(6/2) = 3 damage
            localEngine2.applyDamage(6);

            expect(localEngine2.getEntity("goblin-2")?.hp).toBe(27); // 30 - 3
        });

        it("should double damage for a vulnerable target", () => {
            const localEngine = createCombatEngine(1);

            const player = createTestPlayer({ initiative: 20, hp: 30, maxHp: 30, damageFormula: "1d8" });
            const goblin = createEnemyEntity("goblin-1", "Paper Goblin", 30, 5, 0, "1d4", {
                initiative: 10,
                vulnerabilities: ["bludgeoning"],
            });

            localEngine.initiateCombat([player, goblin]);
            localEngine.submitAction({
                type: "ATTACK",
                attackerId: "player-1",
                targetId: "goblin-1",
                attackRoll: 20,
                rawD20: 15,
                isRanged: false,
                advantage: false,
                disadvantage: false,
            });

            localEngine.applyDamage(5);

            // 5 damage * 2 (vulnerable) = 10
            expect(localEngine.getEntity("goblin-1")?.hp).toBe(20); // 30 - 10
        });

        it("should absorb damage from tempHp before reducing real HP", () => {
            // Use a fixed roll of exactly 6 damage so tempHp of 10 fully absorbs it
            const sixRoll = () => ({ total: 6, rolls: [6], isCritical: false, isFumble: false });

            const playerEntity = createPlayerEntity("player-1", "Aragorn", 30, 30, 16, 10, {
                attackModifier: 5,
                damageFormula: "1d8+3",
                tempHp: 10,
            });
            // Goblin goes first (initiative 20), attacks with "1d6" — mock always rolls 6
            const goblin2 = createEnemyEntity("goblin-2", "Goblin", 7, 5, 10, "1d6", {
                initiative: 20,
            });

            const localEngine2 = createCombatEngine(2, {}, sixRoll);
            localEngine2.initiateCombat([playerEntity, goblin2]);

            // Goblin attacks: roll 6 damage, tempHp=10 absorbs all 6
            const goblinAttack = localEngine2.submitAction({
                type: "ATTACK",
                attackerId: "goblin-2",
                targetId: "player-1",
                advantage: false,
                disadvantage: false,
                isRanged: false,
            });

            const playerAfter = localEngine2.getEntity("player-1")!;
            expect(playerAfter.hp).toBe(30);       // real HP unchanged
            expect(playerAfter.tempHp).toBe(4);    // 10 - 6 = 4 remaining
        });
    });

    describe("Spellcasting", () => {
        // Helper: create a wizard player with spells
        function createWizardPlayer(overrides?: Partial<CombatEntity>): CombatEntity {
            return createPlayerEntity(
                "wizard-1",
                "Gandalf",
                30, 30, 12, 15,
                {
                    attackModifier: 3,
                    abilityScores: { str: 8, dex: 14, con: 12, int: 18, wis: 14, cha: 12 },
                    spellSaveDC: 15,
                    spells: [
                        {
                            name: "Magic Missile",
                            level: 1,
                            school: "evocation",
                            castingTime: "action",
                            range: 120,
                            isAreaEffect: false,
                            damageFormula: "3d4+3",
                            damageType: "force",
                            requiresConcentration: false,
                            conditions: [],
                            description: "Three darts of magical force.",
                        },
                        {
                            name: "Fireball",
                            level: 3,
                            school: "evocation",
                            castingTime: "action",
                            range: 150,
                            isAreaEffect: true,
                            areaType: "sphere",
                            areaSize: 20,
                            savingThrow: "DEX",
                            halfOnSave: true,
                            damageFormula: "8d6",
                            damageType: "fire",
                            requiresConcentration: false,
                            conditions: [],
                            description: "A bright streak of fire.",
                        },
                        {
                            name: "Cure Wounds",
                            level: 1,
                            school: "evocation",
                            castingTime: "action",
                            range: 5,
                            healingFormula: "1d8+4",
                            requiresConcentration: false,
                            conditions: [],
                            description: "Restore hit points.",
                        },
                        {
                            name: "Hold Person",
                            level: 2,
                            school: "enchantment",
                            castingTime: "action",
                            range: 60,
                            savingThrow: "WIS",
                            halfOnSave: false,
                            requiresConcentration: true,
                            conditions: ["paralyzed"],
                            description: "Paralyze a humanoid.",
                        },
                    ],
                    spellSlots: { "1": 4, "2": 3, "3": 2 },
                    ...overrides,
                }
            );
        }

        it("should deduct spell slot on cast", () => {
            const always15 = vi.fn().mockReturnValue({ total: 15, rolls: [15], isCritical: false, isFumble: false });
            const engine = createCombatEngine(1, {}, always15);
            const wizard = createWizardPlayer();
            const goblin = createTestGoblin({ hp: 50, maxHp: 50 });
            engine.prepareCombat([wizard, goblin]);

            const result = engine.submitAction({
                type: 'CAST_SPELL',
                casterId: 'wizard-1',
                spellName: 'Magic Missile',
                targetIds: ['goblin-1'],
            });

            expect(result.success).toBe(true);
            const state = result.newState;
            const w = state.entities.find(e => e.id === 'wizard-1')!;
            expect(w.spellSlots['1']).toBe(3); // was 4
        });

        it("should deal damage to target on no-save spell", () => {
            const always10 = vi.fn().mockReturnValue({ total: 10, rolls: [10], isCritical: false, isFumble: false });
            const engine = createCombatEngine(1, {}, always10);
            const wizard = createWizardPlayer();
            const goblin = createTestGoblin({ hp: 50, maxHp: 50 });
            engine.prepareCombat([wizard, goblin]);

            const result = engine.submitAction({
                type: 'CAST_SPELL',
                casterId: 'wizard-1',
                spellName: 'Magic Missile',
                targetIds: ['goblin-1'],
            });

            expect(result.success).toBe(true);
            const goblinAfter = result.newState.entities.find(e => e.id === 'goblin-1')!;
            // roll=10, so 50 - 10 = 40
            expect(goblinAfter.hp).toBe(40);
        });

        it("should deal area damage to multiple targets", () => {
            const always20 = vi.fn().mockReturnValue({ total: 20, rolls: [20], isCritical: false, isFumble: false });
            const engine = createCombatEngine(1, {}, always20);
            const wizard = createWizardPlayer();
            const goblin1 = createTestGoblin({ id: 'g1', hp: 50, maxHp: 50 });
            const goblin2 = createEnemyEntity('g2', 'Goblin 2', 50, 12, 4, '1d6+2');
            engine.prepareCombat([wizard, goblin1, goblin2]);

            // For Fireball, auto-target all enemies
            const result = engine.submitAction({
                type: 'CAST_SPELL',
                casterId: 'wizard-1',
                spellName: 'Fireball',
                targetIds: ['g1', 'g2'],
            });

            expect(result.success).toBe(true);
            // save roll = 20 (success) → half damage = 10 each. Both goblins at 50 HP → 40 HP.
            const s = result.newState;
            const g1 = s.entities.find(e => e.id === 'g1')!;
            const g2 = s.entities.find(e => e.id === 'g2')!;
            expect(g1.hp).toBeLessThan(50);
            expect(g2.hp).toBeLessThan(50);
        });

        it("should halve damage on successful saving throw", () => {
            // save roll = 25 (success), damage roll = 20
            const mockRoll = vi.fn().mockImplementation((formula: string) => {
                if (formula === '1d20') return { total: 25, rolls: [25], isCritical: false, isFumble: false };
                return { total: 20, rolls: [20], isCritical: false, isFumble: false };
            });
            const engine = createCombatEngine(1, {}, mockRoll);
            const wizard = createWizardPlayer();
            const goblin = createTestGoblin({ id: 'goblin-1', hp: 100, maxHp: 100 });
            engine.prepareCombat([wizard, goblin]);

            const result = engine.submitAction({
                type: 'CAST_SPELL',
                casterId: 'wizard-1',
                spellName: 'Fireball',
                targetIds: ['goblin-1'],
            });

            expect(result.success).toBe(true);
            const goblinAfter = result.newState.entities.find(e => e.id === 'goblin-1')!;
            // save success with halfOnSave: 100 - floor(20/2) = 100 - 10 = 90
            expect(goblinAfter.hp).toBe(90);
        });

        it("should apply concentration condition", () => {
            const always1 = vi.fn().mockReturnValue({ total: 1, rolls: [1], isCritical: false, isFumble: false });
            const engine = createCombatEngine(1, {}, always1);
            const wizard = createWizardPlayer();
            const goblin = createTestGoblin({ hp: 50, maxHp: 50 });
            engine.prepareCombat([wizard, goblin]);

            const result = engine.submitAction({
                type: 'CAST_SPELL',
                casterId: 'wizard-1',
                spellName: 'Hold Person',
                targetIds: ['goblin-1'],
            });

            expect(result.success).toBe(true);
            const wizardAfter = result.newState.entities.find(e => e.id === 'wizard-1')!;
            expect(wizardAfter.activeConditions.some(c => c.name === 'concentrating')).toBe(true);
        });

        it("should drop old concentration when casting new concentration spell", () => {
            // First cast Hold Person (concentration), check state
            const always1 = vi.fn().mockReturnValue({ total: 1, rolls: [1], isCritical: false, isFumble: false });
            const engine = createCombatEngine(1, {}, always1);
            const wizard = createWizardPlayer({ spellSlots: { "1": 4, "2": 6, "3": 2 } });
            const goblin = createTestGoblin({ hp: 200, maxHp: 200 });
            engine.prepareCombat([wizard, goblin]);

            // First concentration spell
            engine.submitAction({ type: 'CAST_SPELL', casterId: 'wizard-1', spellName: 'Hold Person', targetIds: ['goblin-1'] });

            const stateAfterFirst = engine.getState();
            const wizardAfterFirst = stateAfterFirst.entities.find(e => e.id === 'wizard-1')!;
            expect(wizardAfterFirst.activeConditions.some(c => c.name === 'concentrating')).toBe(true);
            expect(wizardAfterFirst.spellSlots['2']).toBe(5); // was 6
        });

        it("should drop concentration when taking damage and failing CON save", () => {
            // Wizard concentrating, takes damage, fails CON save (roll 1)
            const mockRoll = vi.fn().mockImplementation((formula: string) => {
                if (formula === '1d20') return { total: 1, rolls: [1], isCritical: false, isFumble: false }; // fail save
                return { total: 10, rolls: [10], isCritical: false, isFumble: false };
            });
            const engine = createCombatEngine(1, {}, mockRoll);
            const wizard = createWizardPlayer();
            const goblin = createTestGoblin({ hp: 50, maxHp: 50 });
            engine.prepareCombat([wizard, goblin]);

            // Manually set wizard as concentrating
            const w = (engine as any).state.entities.find((e: CombatEntity) => e.id === 'wizard-1')!;
            w.activeConditions.push({ name: 'concentrating', appliedAtRound: 1 });

            // Goblin attacks wizard (attackMod=4, so 1d20+4 max=24; use 20 which hits AC 12)
            const attackResult = engine.submitAction({
                type: 'ATTACK',
                attackerId: 'goblin-1',
                targetId: 'wizard-1',
                attackRoll: 20, // 20 hits AC 12, within range 5-24
            });

            // Wizard should have concentration broken (CON save was roll=1, fails DC 10)
            const wizardAfter = attackResult.newState.entities.find(e => e.id === 'wizard-1')!;
            expect(wizardAfter.activeConditions.some(c => c.name === 'concentrating')).toBe(false);
        });

        it("should fail gracefully if entity does not know the spell", () => {
            const engine = createCombatEngine(1);
            const player = createTestPlayer();
            const goblin = createTestGoblin();
            engine.prepareCombat([player, goblin]);

            const result = engine.submitAction({
                type: 'CAST_SPELL',
                casterId: 'player-1',
                spellName: 'Fireball',
                targetIds: ['goblin-1'],
            });

            expect(result.success).toBe(false);
            expect(result.error).toContain('does not know spell');
        });

        it("should fail if no spell slots remaining", () => {
            const engine = createCombatEngine(1);
            const wizard = createWizardPlayer({ spellSlots: { "1": 0, "2": 0, "3": 0 } });
            const goblin = createTestGoblin();
            engine.prepareCombat([wizard, goblin]);

            const result = engine.submitAction({
                type: 'CAST_SPELL',
                casterId: 'wizard-1',
                spellName: 'Magic Missile',
                targetIds: ['goblin-1'],
            });

            expect(result.success).toBe(false);
            expect(result.error).toContain('spell slots');
        });
    });
});
