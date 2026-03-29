/**
 * Legal Actions — Unit Tests
 *
 * Tests for getLegalActions(entityId) which returns the set of actions
 * an entity can legally perform on their turn.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { CombatEngineV2, createCombatEngine } from "../combat-engine-v2";
import { createPlayerEntity, createEnemyEntity, type CombatEntity } from "../combat-types";

// =============================================================================
// TEST HELPERS
// =============================================================================

function createTestPlayer(overrides?: Partial<CombatEntity>): CombatEntity {
    return createPlayerEntity(
        "p1",
        "Aragorn",
        30, 30, 16, 20,
        { attackModifier: 5, damageFormula: "1d8+3", ...overrides }
    );
}

function createTestPlayer2(overrides?: Partial<CombatEntity>): CombatEntity {
    return createPlayerEntity(
        "p2",
        "Elara",
        20, 20, 13, 15,
        { attackModifier: 3, damageFormula: "1d6+2", ...overrides }
    );
}

function createTestGoblin(overrides?: Partial<CombatEntity>): CombatEntity {
    return createEnemyEntity(
        "e1",
        "Goblin",
        7, 12, 4, "1d6+2",
        { initiativeModifier: 2, initiative: 10, ...overrides }
    );
}

function createTestGoblin2(overrides?: Partial<CombatEntity>): CombatEntity {
    return createEnemyEntity(
        "e2",
        "Goblin Scout",
        7, 13, 3, "1d4+1",
        { initiativeModifier: 3, initiative: 5, ...overrides }
    );
}

// =============================================================================
// TESTS
// =============================================================================

describe("getLegalActions", () => {
    let engine: CombatEngineV2;

    beforeEach(() => {
        engine = createCombatEngine(1);
    });

    it("should return attack actions for each alive enemy", () => {
        const player = createTestPlayer();
        const goblin1 = createTestGoblin();
        const goblin2 = createTestGoblin2();

        engine.initiateCombat([player, goblin1, goblin2]);

        // Player has highest initiative (20), so it's their turn
        const actions = engine.getLegalActions("p1");

        const attacks = actions.filter(a => a.type === "ATTACK");
        expect(attacks).toHaveLength(2);
        expect(attacks.map(a => a.targetId).sort()).toEqual(["e1", "e2"]);
    });

    it("should always include END_TURN", () => {
        const player = createTestPlayer();
        const goblin = createTestGoblin();

        engine.initiateCombat([player, goblin]);

        const actions = engine.getLegalActions("p1");
        const endTurn = actions.filter(a => a.type === "END_TURN");
        expect(endTurn).toHaveLength(1);
        expect(endTurn[0].description).toBe("End your turn");
    });

    it("should return empty array when not entity's turn", () => {
        const player = createTestPlayer(); // initiative 20
        const goblin = createTestGoblin(); // initiative 10

        engine.initiateCombat([player, goblin]);

        // It's the player's turn, not the goblin's
        const actions = engine.getLegalActions("e1");
        expect(actions).toHaveLength(0);
    });

    it("should not include dead entities as targets", () => {
        const player = createTestPlayer();
        const goblin1 = createTestGoblin();
        const goblin2 = createTestGoblin2({ status: "DEAD", hp: 0 });

        engine.initiateCombat([player, goblin1, goblin2]);

        const actions = engine.getLegalActions("p1");
        const attacks = actions.filter(a => a.type === "ATTACK");

        expect(attacks).toHaveLength(1);
        expect(attacks[0].targetId).toBe("e1");
    });

    it("should not include self as target", () => {
        const player = createTestPlayer();
        const goblin = createTestGoblin();

        engine.initiateCombat([player, goblin]);

        const actions = engine.getLegalActions("p1");
        const selfTarget = actions.find(a => a.targetId === "p1");
        expect(selfTarget).toBeUndefined();
    });

    it("should return empty array when combat is not ACTIVE", () => {
        const player = createTestPlayer();
        const goblin = createTestGoblin();

        // Engine is still IDLE (no combat started)
        const actions = engine.getLegalActions("p1");
        expect(actions).toHaveLength(0);
    });

    it("should not include fled entities as targets", () => {
        const player = createTestPlayer();
        const goblin1 = createTestGoblin();
        const goblin2 = createTestGoblin2({ status: "FLED" });

        engine.initiateCombat([player, goblin1, goblin2]);

        const actions = engine.getLegalActions("p1");
        const attacks = actions.filter(a => a.type === "ATTACK");

        expect(attacks).toHaveLength(1);
        expect(attacks[0].targetId).toBe("e1");
    });

    it("should return correct actions for enemy targeting players", () => {
        const player1 = createTestPlayer();
        const player2 = createTestPlayer2();
        const goblin = createTestGoblin({ initiative: 25 }); // Goes first

        engine.initiateCombat([player1, player2, goblin]);

        const actions = engine.getLegalActions("e1");
        const attacks = actions.filter(a => a.type === "ATTACK");

        expect(attacks).toHaveLength(2);
        expect(attacks.map(a => a.targetId).sort()).toEqual(["p1", "p2"]);
    });

    it("should include target names and descriptions", () => {
        const player = createTestPlayer();
        const goblin = createTestGoblin();

        engine.initiateCombat([player, goblin]);

        const actions = engine.getLegalActions("p1");
        const attack = actions.find(a => a.type === "ATTACK");

        expect(attack).toBeDefined();
        expect(attack!.targetName).toBe("Goblin");
        expect(attack!.description).toBe("Attack Goblin");
    });

    it("should not let players attack other players", () => {
        const player1 = createTestPlayer();
        const player2 = createTestPlayer2();
        const goblin = createTestGoblin();

        engine.initiateCombat([player1, player2, goblin]);

        const actions = engine.getLegalActions("p1");
        const attacks = actions.filter(a => a.type === "ATTACK");

        // Should only target enemies, not the other player
        expect(attacks).toHaveLength(1);
        expect(attacks[0].targetId).toBe("e1");
    });

    it("should not let enemies attack other enemies", () => {
        const player = createTestPlayer();
        const goblin1 = createTestGoblin({ initiative: 25 }); // Goes first
        const goblin2 = createTestGoblin2();

        engine.initiateCombat([player, goblin1, goblin2]);

        const actions = engine.getLegalActions("e1");
        const attacks = actions.filter(a => a.type === "ATTACK");

        // Should only target the player, not the other goblin
        expect(attacks).toHaveLength(1);
        expect(attacks[0].targetId).toBe("p1");
    });
});
