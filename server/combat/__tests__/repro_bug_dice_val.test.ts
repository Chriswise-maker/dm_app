
import { describe, it, expect, beforeEach } from "vitest";
import { CombatEngineV2, createCombatEngine } from "../combat-engine-v2";
import { createPlayerEntity, createEnemyEntity } from "../combat-types";

describe("CombatEngineV2 - Dice Validation Repro", () => {
    let engine: CombatEngineV2;

    beforeEach(() => {
        engine = createCombatEngine(1);
    });

    it("REPRO: should fail when applying damage greater than max possible roll", () => {
        // Player with 1d4 damage
        const player = createPlayerEntity(
            "player-1", "Hero", 20, 20, 15, 10,
            { damageFormula: "1d4" }
        );
        const goblin = createEnemyEntity(
            "goblin-1", "Goblin", 10, 12, 1, "1d4", { initiative: 5 }
        );

        engine.initiateCombat([player, goblin]);

        // Hit the goblin
        const result = engine.submitAction({
            type: "ATTACK",
            attackerId: "player-1",
            targetId: "goblin-1",
            attackRoll: 20, // Crit to guarantee hit
            isRanged: false,       // Required prop
            advantage: false,      // Required prop
            disadvantage: false    // Required prop
        });

        // Should be waiting for damage
        expect(result.awaitingDamageRoll).toBe(true);

        // Apply IMPOSSIBLE damage for 1d4 (Max 4) or 2d4 (Crit Max 8)
        // 100 is definitely impossible
        const damageResult = engine.applyDamage(100);

        // EXPECTED FIX: success should be false
        console.log("Damage Result:", JSON.stringify(damageResult, null, 2));

        expect(damageResult.success).toBe(false);
        expect(damageResult.error).toContain("Invalid damage roll");
    });

    it("REPRO: should fail when applying initiative greater than 20 (before mod)", () => {
        const player = createPlayerEntity(
            "player-1", "Hero", 20, 20, 15, 0, // 0 init triggers roll
            { initiativeModifier: 2 }
        );

        // Prepare combat (waits for initiative)
        const { awaitingInitiative } = engine.prepareCombat([player]);
        expect(awaitingInitiative).toBe(true);

        // Apply IMPOSSIBLE initiative roll (e.g. 25 on d20)
        // engine.applyInitiative signature: (entityId, roll)
        // The engine adds the modifier. So passing 25 means roll was 25.
        // D20 max is 20.

        const result = engine.applyInitiative("player-1", 25);

        // If it accepted it, the entity initiative would be 25 + 2 = 27
        const entity = engine.getEntity("player-1");

        // EXPECTED FIX: Initiative shouldn't update to 27
        expect(entity?.initiative).not.toBe(27);
    });
});
