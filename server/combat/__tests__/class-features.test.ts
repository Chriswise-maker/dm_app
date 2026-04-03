/**
 * Class Features — Tier 2 Tests
 *
 * Second Wind (Fighter), Action Surge (Fighter), Cunning Action (Rogue)
 */

import { describe, it, expect, beforeEach } from "vitest";
import { CombatEngineV2, createCombatEngine, type RollFn } from "../combat-engine-v2";
import { createPlayerEntity, createEnemyEntity, type CombatEntity } from "../combat-types";

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

function createFighter(overrides?: Partial<CombatEntity>): CombatEntity {
    return createPlayerEntity("p1", "Kael", 30, 50, 18, 20, {
        characterClass: "Fighter",
        level: 5,
        featureUses: { "Second Wind": 1, "Action Surge": 1 },
        attackModifier: 7,
        damageFormula: "1d8+4",
        ...overrides,
    });
}

function createRogue(overrides?: Partial<CombatEntity>): CombatEntity {
    return createPlayerEntity("p1", "Shadow", 25, 35, 15, 18, {
        characterClass: "Rogue",
        level: 3,
        attackModifier: 6,
        damageFormula: "1d6+4",
        ...overrides,
    });
}

function createGoblin(overrides?: Partial<CombatEntity>): CombatEntity {
    return createEnemyEntity("e1", "Goblin", 12, 13, 4, "1d6+2", {
        initiative: 5,
        ...overrides,
    });
}

// =============================================================================
// SECOND WIND
// =============================================================================

describe("Second Wind", () => {
    it("appears in legal actions for a Fighter with uses remaining", () => {
        const engine = createCombatEngine(1);
        const fighter = createFighter();
        const goblin = createGoblin();
        engine.initiateCombat([fighter, goblin]);

        const actions = engine.getLegalActions("p1");
        const sw = actions.find(a => a.type === "SECOND_WIND");
        expect(sw).toBeDefined();
        expect(sw!.resourceCost).toBe("bonus_action");
        expect(sw!.description).toContain("1d10+5");
    });

    it("does not appear for a non-Fighter", () => {
        const engine = createCombatEngine(1);
        const rogue = createRogue();
        const goblin = createGoblin();
        engine.initiateCombat([rogue, goblin]);

        const actions = engine.getLegalActions("p1");
        expect(actions.find(a => a.type === "SECOND_WIND")).toBeUndefined();
    });

    it("does not appear when uses are 0", () => {
        const engine = createCombatEngine(1);
        const fighter = createFighter({ featureUses: { "Second Wind": 0, "Action Surge": 1 } });
        const goblin = createGoblin();
        engine.initiateCombat([fighter, goblin]);

        const actions = engine.getLegalActions("p1");
        expect(actions.find(a => a.type === "SECOND_WIND")).toBeUndefined();
    });

    it("heals the correct amount (1d10 + level), capped at maxHp", () => {
        // Roll returns 8, level 5 → total = 13
        const engine = createCombatEngine(1, undefined, mockRollFn(13));
        const fighter = createFighter({ hp: 30, maxHp: 50 });
        const goblin = createGoblin();
        engine.initiateCombat([fighter, goblin]);

        const result = engine.submitAction({ type: "SECOND_WIND", entityId: "p1" });
        expect(result.success).toBe(true);

        const state = engine.getState();
        const entity = state.entities.find(e => e.id === "p1")!;
        expect(entity.hp).toBe(43); // 30 + 13
    });

    it("caps healing at maxHp", () => {
        const engine = createCombatEngine(1, undefined, mockRollFn(13));
        const fighter = createFighter({ hp: 45, maxHp: 50 });
        const goblin = createGoblin();
        engine.initiateCombat([fighter, goblin]);

        const result = engine.submitAction({ type: "SECOND_WIND", entityId: "p1" });
        expect(result.success).toBe(true);

        const state = engine.getState();
        const entity = state.entities.find(e => e.id === "p1")!;
        expect(entity.hp).toBe(50); // Capped at max
    });

    it("consumes the bonus action and decrements featureUses", () => {
        const engine = createCombatEngine(1, undefined, mockRollFn(8));
        const fighter = createFighter();
        const goblin = createGoblin();
        engine.initiateCombat([fighter, goblin]);

        engine.submitAction({ type: "SECOND_WIND", entityId: "p1" });

        // Feature use consumed
        const state = engine.getState();
        const entity = state.entities.find(e => e.id === "p1")!;
        expect(entity.featureUses["Second Wind"]).toBe(0);

        // Bonus action consumed — Second Wind should not appear again
        const actions = engine.getLegalActions("p1");
        expect(actions.find(a => a.type === "SECOND_WIND")).toBeUndefined();
    });

    it("disappears from legal actions after use (feature uses exhausted)", () => {
        const engine = createCombatEngine(1, undefined, mockRollFn(8));
        const fighter = createFighter();
        const goblin = createGoblin();
        engine.initiateCombat([fighter, goblin]);

        // Use Second Wind
        engine.submitAction({ type: "SECOND_WIND", entityId: "p1" });

        // End turn and come back (simulate round advancing)
        engine.submitAction({ type: "END_TURN", entityId: "p1" });
        // Goblin's turn — end it
        engine.submitAction({ type: "END_TURN", entityId: "e1" });

        // Back to Fighter's turn — Second Wind should be gone (0 uses)
        const actions = engine.getLegalActions("p1");
        expect(actions.find(a => a.type === "SECOND_WIND")).toBeUndefined();
    });

    it("does not appear when bonus action is already used", () => {
        const engine = createCombatEngine(1, undefined, mockRollFn(8));
        const fighter = createFighter({
            // Give the fighter a bonus action spell to consume
            spells: [{
                name: "Healing Word",
                level: 1,
                school: "evocation",
                castingTime: "bonus_action",
                range: 60,
                isAreaEffect: false,
                halfOnSave: false,
                damageFormula: undefined,
                damageType: undefined,
                healingFormula: "1d4+3",
                requiresConcentration: false,
                requiresAttackRoll: false,
                conditions: [],
                description: "Heal a creature",
            }],
            spellSlots: { "1": 2 },
            spellSaveDC: 13,
            spellAttackBonus: 5,
            spellcastingAbility: "wis",
        });
        const goblin = createGoblin();
        engine.initiateCombat([fighter, goblin]);

        // Manually consume bonus action via the turn resources
        const state = engine.getState();
        // Use a Cast Spell that costs bonus action to consume it
        // Instead, just submit an action that uses the bonus action.
        // We can directly test by checking after consuming bonus action:
        // Cast Healing Word on self (bonus action spell)
        engine.submitAction({
            type: "CAST_SPELL",
            casterId: "p1",
            spellName: "Healing Word",
            targetIds: ["p1"],
        });

        const actions = engine.getLegalActions("p1");
        expect(actions.find(a => a.type === "SECOND_WIND")).toBeUndefined();
    });
});

// =============================================================================
// ACTION SURGE
// =============================================================================

describe("Action Surge", () => {
    it("appears in legal actions for a Fighter with uses remaining", () => {
        const engine = createCombatEngine(1);
        const fighter = createFighter();
        const goblin = createGoblin();
        engine.initiateCombat([fighter, goblin]);

        const actions = engine.getLegalActions("p1");
        const as = actions.find(a => a.type === "ACTION_SURGE");
        expect(as).toBeDefined();
        expect(as!.resourceCost).toBe("free");
    });

    it("does not appear for a non-Fighter", () => {
        const engine = createCombatEngine(1);
        const rogue = createRogue();
        const goblin = createGoblin();
        engine.initiateCombat([rogue, goblin]);

        const actions = engine.getLegalActions("p1");
        expect(actions.find(a => a.type === "ACTION_SURGE")).toBeUndefined();
    });

    it("does not appear when uses are 0", () => {
        const engine = createCombatEngine(1);
        const fighter = createFighter({ featureUses: { "Second Wind": 1, "Action Surge": 0 } });
        const goblin = createGoblin();
        engine.initiateCombat([fighter, goblin]);

        const actions = engine.getLegalActions("p1");
        expect(actions.find(a => a.type === "ACTION_SURGE")).toBeUndefined();
    });

    it("re-opens the action slot after use", () => {
        const engine = createCombatEngine(1, undefined, mockRollFn(15));
        const fighter = createFighter();
        const goblin = createGoblin();
        engine.initiateCombat([fighter, goblin]);

        // Use the action (Dodge consumes the action)
        engine.submitAction({ type: "DODGE", entityId: "p1" });

        // Verify action is consumed — no DODGE in legal actions
        let actions = engine.getLegalActions("p1");
        expect(actions.find(a => a.type === "DODGE")).toBeUndefined();

        // Use Action Surge — should re-open the action
        const result = engine.submitAction({ type: "ACTION_SURGE", entityId: "p1" });
        expect(result.success).toBe(true);
        expect(result.logs.some(l => l.description?.includes("surges"))).toBe(true);

        // Now DODGE (and other full actions) should be available again
        actions = engine.getLegalActions("p1");
        expect(actions.find(a => a.type === "DODGE")).toBeDefined();
    });

    it("decrements featureUses and disappears after use", () => {
        const engine = createCombatEngine(1);
        const fighter = createFighter();
        const goblin = createGoblin();
        engine.initiateCombat([fighter, goblin]);

        engine.submitAction({ type: "ACTION_SURGE", entityId: "p1" });

        const state = engine.getState();
        const entity = state.entities.find(e => e.id === "p1")!;
        expect(entity.featureUses["Action Surge"]).toBe(0);

        const actions = engine.getLegalActions("p1");
        expect(actions.find(a => a.type === "ACTION_SURGE")).toBeUndefined();
    });

    it("logs the correct message", () => {
        const engine = createCombatEngine(1);
        const fighter = createFighter();
        const goblin = createGoblin();
        engine.initiateCombat([fighter, goblin]);

        const result = engine.submitAction({ type: "ACTION_SURGE", entityId: "p1" });
        expect(result.logs.some(l =>
            l.description === "Kael surges — one additional action available."
        )).toBe(true);
    });
});

// =============================================================================
// CUNNING ACTION
// =============================================================================

describe("Cunning Action", () => {
    it("adds Dash, Disengage, Hide as bonus actions for a Rogue", () => {
        const engine = createCombatEngine(1);
        const rogue = createRogue();
        const goblin = createGoblin();
        engine.initiateCombat([rogue, goblin]);

        const actions = engine.getLegalActions("p1");

        const cunningDash = actions.find(a => a.type === "DASH" && a.resourceCost === "bonus_action");
        const cunningDisengage = actions.find(a => a.type === "DISENGAGE" && a.resourceCost === "bonus_action");
        const cunningHide = actions.find(a => a.type === "HIDE" && a.resourceCost === "bonus_action");

        expect(cunningDash).toBeDefined();
        expect(cunningDash!.description).toContain("Cunning Action");
        expect(cunningDisengage).toBeDefined();
        expect(cunningDisengage!.description).toContain("Cunning Action");
        expect(cunningHide).toBeDefined();
        expect(cunningHide!.description).toContain("Cunning Action");
    });

    it("does not appear for a non-Rogue", () => {
        const engine = createCombatEngine(1);
        const fighter = createFighter();
        const goblin = createGoblin();
        engine.initiateCombat([fighter, goblin]);

        const actions = engine.getLegalActions("p1");
        const cunningActions = actions.filter(a =>
            a.resourceCost === "bonus_action" &&
            ["DASH", "DISENGAGE", "HIDE"].includes(a.type)
        );
        expect(cunningActions).toHaveLength(0);
    });

    it("consumes the bonus action, not the regular action", () => {
        const engine = createCombatEngine(1, undefined, mockRollFn(10));
        const rogue = createRogue();
        const goblin = createGoblin();
        engine.initiateCombat([rogue, goblin]);

        // Use Cunning Action: Dash (bonus action)
        const result = engine.submitAction({
            type: "DASH",
            entityId: "p1",
            resourceCost: "bonus_action",
        });
        expect(result.success).toBe(true);

        // Regular action should still be available (DODGE, ATTACK, etc.)
        const actions = engine.getLegalActions("p1");
        expect(actions.find(a => a.type === "DODGE" && a.resourceCost === "action")).toBeDefined();

        // But bonus action Cunning Actions should be gone
        const cunningActions = actions.filter(a =>
            a.resourceCost === "bonus_action" &&
            ["DASH", "DISENGAGE", "HIDE"].includes(a.type)
        );
        expect(cunningActions).toHaveLength(0);
    });

    it("disappears when bonus action is already used", () => {
        const engine = createCombatEngine(1, undefined, mockRollFn(10));
        const rogue = createRogue();
        const goblin = createGoblin();
        engine.initiateCombat([rogue, goblin]);

        // Use Cunning Action: Hide (bonus action)
        engine.submitAction({
            type: "HIDE",
            entityId: "p1",
            resourceCost: "bonus_action",
        });

        const actions = engine.getLegalActions("p1");
        const cunningActions = actions.filter(a =>
            a.resourceCost === "bonus_action" &&
            ["DASH", "DISENGAGE", "HIDE"].includes(a.type)
        );
        expect(cunningActions).toHaveLength(0);
    });

    it("Rogue still has regular action Dash/Disengage/Hide available", () => {
        const engine = createCombatEngine(1);
        const rogue = createRogue();
        const goblin = createGoblin();
        engine.initiateCombat([rogue, goblin]);

        const actions = engine.getLegalActions("p1");

        // Should have BOTH regular action versions AND bonus action versions
        const regularDash = actions.find(a => a.type === "DASH" && a.resourceCost === "action");
        const bonusDash = actions.find(a => a.type === "DASH" && a.resourceCost === "bonus_action");
        expect(regularDash).toBeDefined();
        expect(bonusDash).toBeDefined();
    });
});
