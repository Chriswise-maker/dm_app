/**
 * Tier 3 Class Features — Sneak Attack (Rogue) and Divine Smite (Paladin)
 */

import { describe, it, expect } from "vitest";
import { CombatEngineV2, createCombatEngine, type RollFn } from "../combat-engine-v2";
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

/** A roll fn that always hits (total 20) and never crits */
function alwaysHitRollFn(damageTotal: number = 7): RollFn {
    return (formula: string) => ({
        total: formula.includes("d20") ? 20 : damageTotal,
        rolls: formula.includes("d20") ? [18] : [damageTotal],
        isCritical: false,
        isFumble: false,
    });
}

function createRogue(overrides?: Partial<CombatEntity>): CombatEntity {
    return createPlayerEntity("p1", "Shadow", 30, 40, 15, 20, {
        characterClass: "Rogue",
        level: 5,
        attackModifier: 7,
        damageFormula: "1d6+4",
        weapons: [{
            name: "Shortsword",
            damageFormula: "1d6+4",
            damageType: "piercing",
            isRanged: false,
            attackBonus: 7,
            properties: ["finesse", "light"],
        }],
        ...overrides,
    });
}

function createRogueWithBow(overrides?: Partial<CombatEntity>): CombatEntity {
    return createPlayerEntity("p1", "Shadow", 30, 40, 15, 20, {
        characterClass: "Rogue",
        level: 3,
        attackModifier: 6,
        damageFormula: "1d8+3",
        weapons: [{
            name: "Shortbow",
            damageFormula: "1d6+3",
            damageType: "piercing",
            isRanged: true,
            attackBonus: 6,
            properties: [],
        }],
        ...overrides,
    });
}

function createPaladin(overrides?: Partial<CombatEntity>): CombatEntity {
    return createPlayerEntity("p1", "Aldric", 40, 52, 18, 20, {
        characterClass: "Paladin",
        level: 5,
        attackModifier: 7,
        damageFormula: "1d8+4",
        weapons: [{
            name: "Longsword",
            damageFormula: "1d8+4",
            damageType: "slashing",
            isRanged: false,
            attackBonus: 7,
            properties: [],
        }],
        spellSlots: { "1": 4, "2": 2 },
        ...overrides,
    });
}

function createGoblin(overrides?: Partial<CombatEntity>): CombatEntity {
    return createEnemyEntity("e1", "Goblin", 12, 13, 4, "1d6+2", {
        initiative: 5,
        ...overrides,
    });
}

function createAlly(overrides?: Partial<CombatEntity>): CombatEntity {
    return createPlayerEntity("p2", "Tank", 40, 50, 18, 15, {
        characterClass: "Fighter",
        level: 5,
        attackModifier: 7,
        damageFormula: "1d8+4",
        ...overrides,
    });
}

// =============================================================================
// SNEAK ATTACK
// =============================================================================

describe("Sneak Attack", () => {
    it("auto-applies with correct dice count based on rogue level", () => {
        // Level 5 rogue: ceil(5/2) = 3d6
        const engine = createCombatEngine(1, undefined, alwaysHitRollFn(7));
        const rogue = createRogue({ level: 5 });
        const ally = createAlly();
        const goblin = createGoblin();
        engine.initiateCombat([rogue, ally, goblin]);

        // Place ally in melee with goblin for sneak attack condition
        const state = engine.getState();
        const allyEntity = state.entities.find(e => e.id === "p2")!;
        const goblinEntity = state.entities.find(e => e.id === "e1")!;

        // Set ally in melee range of goblin
        engine.getEntity("p2")!.rangeTo["e1"] = RangeBand.MELEE;
        engine.getEntity("e1")!.rangeTo["p2"] = RangeBand.MELEE;

        // Attack with finesse weapon
        const result = engine.submitAction({
            type: "ATTACK",
            attackerId: "p1",
            targetId: "e1",
            weaponName: "Shortsword",
            attackRoll: 20,
            rawD20: 18,
        });

        expect(result.success).toBe(true);
        // Should have sneak attack log
        const sneakLog = result.logs.find(l =>
            l.description?.includes("Sneak Attack") && l.description?.includes("3d6")
        );
        expect(sneakLog).toBeDefined();

        // Turn resources should mark sneak attack used
        const updatedState = engine.getState();
        expect(updatedState.turnResources?.sneakAttackUsedThisTurn).toBe(true);
    });

    it("doesn't apply on second attack in same turn", () => {
        const engine = createCombatEngine(1, undefined, alwaysHitRollFn(7));
        const rogue = createRogue({ level: 3, extraAttacks: 1 });
        const ally = createAlly();
        const goblin = createGoblin({ hp: 50, maxHp: 50 });
        engine.initiateCombat([rogue, ally, goblin]);

        engine.getEntity("p2")!.rangeTo["e1"] = RangeBand.MELEE;
        engine.getEntity("e1")!.rangeTo["p2"] = RangeBand.MELEE;

        // First attack — should get sneak attack
        const result1 = engine.submitAction({
            type: "ATTACK",
            attackerId: "p1",
            targetId: "e1",
            weaponName: "Shortsword",
            attackRoll: 20,
            rawD20: 18,
        });
        expect(result1.success).toBe(true);
        // Phase is AWAIT_DAMAGE_ROLL — apply damage
        engine.applyDamage(8);

        // Second attack — should NOT get sneak attack
        const result2 = engine.submitAction({
            type: "ATTACK",
            attackerId: "p1",
            targetId: "e1",
            weaponName: "Shortsword",
            attackRoll: 20,
            rawD20: 18,
        });
        expect(result2.success).toBe(true);
        const sneakLog2 = result2.logs.find(l =>
            l.description?.includes("Sneak Attack")
        );
        expect(sneakLog2).toBeUndefined();
    });

    it("requires finesse or ranged weapon", () => {
        const engine = createCombatEngine(1, undefined, alwaysHitRollFn(7));
        // Rogue with a non-finesse weapon (e.g. club)
        const rogue = createRogue({
            weapons: [{
                name: "Club",
                damageFormula: "1d4+2",
                damageType: "bludgeoning",
                isRanged: false,
                attackBonus: 5,
                properties: [],  // no finesse!
            }],
        });
        const ally = createAlly();
        const goblin = createGoblin();
        engine.initiateCombat([rogue, ally, goblin]);

        engine.getEntity("p2")!.rangeTo["e1"] = RangeBand.MELEE;
        engine.getEntity("e1")!.rangeTo["p2"] = RangeBand.MELEE;

        const result = engine.submitAction({
            type: "ATTACK",
            attackerId: "p1",
            targetId: "e1",
            weaponName: "Club",
            attackRoll: 20,
            rawD20: 18,
        });
        expect(result.success).toBe(true);
        const sneakLog = result.logs.find(l =>
            l.description?.includes("Sneak Attack")
        );
        expect(sneakLog).toBeUndefined();
    });

    it("applies with advantage even without ally in melee", () => {
        const engine = createCombatEngine(1, undefined, alwaysHitRollFn(7));
        const rogue = createRogue({ level: 1 }); // ceil(1/2) = 1d6
        const goblin = createGoblin();
        engine.initiateCombat([rogue, goblin]);

        // Attack with advantage (no ally needed)
        const result = engine.submitAction({
            type: "ATTACK",
            attackerId: "p1",
            targetId: "e1",
            weaponName: "Shortsword",
            attackRoll: 20,
            rawD20: 18,
            advantage: true,
        });
        expect(result.success).toBe(true);
        const sneakLog = result.logs.find(l =>
            l.description?.includes("Sneak Attack") && l.description?.includes("1d6")
        );
        expect(sneakLog).toBeDefined();
    });

    it("applies with ranged weapon when ally is in melee", () => {
        const engine = createCombatEngine(1, undefined, alwaysHitRollFn(7));
        const rogue = createRogueWithBow({ level: 3 }); // ceil(3/2) = 2d6
        const ally = createAlly();
        const goblin = createGoblin();
        engine.initiateCombat([rogue, ally, goblin]);

        engine.getEntity("p2")!.rangeTo["e1"] = RangeBand.MELEE;
        engine.getEntity("e1")!.rangeTo["p2"] = RangeBand.MELEE;
        engine.getEntity("p1")!.rangeTo["e1"] = RangeBand.NEAR;
        engine.getEntity("e1")!.rangeTo["p1"] = RangeBand.NEAR;

        const result = engine.submitAction({
            type: "ATTACK",
            attackerId: "p1",
            targetId: "e1",
            weaponName: "Shortbow",
            isRanged: true,
            attackRoll: 20,
            rawD20: 18,
        });
        expect(result.success).toBe(true);
        const sneakLog = result.logs.find(l =>
            l.description?.includes("Sneak Attack") && l.description?.includes("2d6")
        );
        expect(sneakLog).toBeDefined();
    });

    it("does not apply without advantage AND without ally in melee", () => {
        const engine = createCombatEngine(1, undefined, alwaysHitRollFn(7));
        const rogue = createRogue();
        const goblin = createGoblin();
        engine.initiateCombat([rogue, goblin]);

        // No ally, no advantage
        const result = engine.submitAction({
            type: "ATTACK",
            attackerId: "p1",
            targetId: "e1",
            weaponName: "Shortsword",
            attackRoll: 20,
            rawD20: 18,
        });
        expect(result.success).toBe(true);
        const sneakLog = result.logs.find(l =>
            l.description?.includes("Sneak Attack")
        );
        expect(sneakLog).toBeUndefined();
    });
});

// =============================================================================
// DIVINE SMITE
// =============================================================================

describe("Divine Smite", () => {
    it("enters AWAIT_SMITE_DECISION phase for Paladin after melee hit", () => {
        const engine = createCombatEngine(1, undefined, alwaysHitRollFn(8));
        const paladin = createPaladin();
        const goblin = createGoblin();
        engine.initiateCombat([paladin, goblin]);

        // Attack (player) → AWAIT_DAMAGE_ROLL
        engine.submitAction({
            type: "ATTACK",
            attackerId: "p1",
            targetId: "e1",
            weaponName: "Longsword",
            attackRoll: 20,
            rawD20: 18,
        });

        // Apply damage → should enter AWAIT_SMITE_DECISION
        const result = engine.applyDamage(8);
        expect(result.success).toBe(true);
        expect(result.awaitingSmiteDecision).toBe(true);

        const state = engine.getState();
        expect(state.phase).toBe("AWAIT_SMITE_DECISION");
        expect(state.pendingSmite).toBeDefined();
    });

    it("presents smite legal actions for available slot levels", () => {
        const engine = createCombatEngine(1, undefined, alwaysHitRollFn(8));
        const paladin = createPaladin({ spellSlots: { "1": 2, "2": 0, "3": 0 } });
        const goblin = createGoblin();
        engine.initiateCombat([paladin, goblin]);

        engine.submitAction({
            type: "ATTACK",
            attackerId: "p1",
            targetId: "e1",
            weaponName: "Longsword",
            attackRoll: 20,
            rawD20: 18,
        });
        engine.applyDamage(8);

        const actions = engine.getLegalActions("p1");
        // Should have SMITE_1 (has slots) and DECLINE_SMITE
        expect(actions.find(a => a.type === "SMITE_1")).toBeDefined();
        expect(actions.find(a => a.type === "SMITE_2")).toBeUndefined(); // no level 2 slots
        expect(actions.find(a => a.type === "DECLINE_SMITE")).toBeDefined();
    });

    it("consumes correct spell slot and deals correct damage", () => {
        // Use a roll fn that returns predictable smite damage
        let callCount = 0;
        const trackingRollFn: RollFn = (formula: string) => {
            callCount++;
            // For attack rolls return high, for damage rolls return formula-based
            if (formula.includes("d20")) {
                return { total: 20, rolls: [18], isCritical: false, isFumble: false };
            }
            // For 2d8 smite (level 1 slot: 1+1=2d8) return 10
            if (formula.includes("d8") && !formula.includes("+")) {
                return { total: 10, rolls: [5, 5], isCritical: false, isFumble: false };
            }
            // For weapon damage
            return { total: 8, rolls: [4], isCritical: false, isFumble: false };
        };

        const engine = createCombatEngine(1, undefined, trackingRollFn);
        const paladin = createPaladin({ spellSlots: { "1": 2, "2": 1 } });
        const goblin = createGoblin({ hp: 50, maxHp: 50 });
        engine.initiateCombat([paladin, goblin]);

        // Attack → AWAIT_DAMAGE_ROLL
        engine.submitAction({
            type: "ATTACK",
            attackerId: "p1",
            targetId: "e1",
            weaponName: "Longsword",
            attackRoll: 20,
            rawD20: 18,
        });

        // Apply damage → AWAIT_SMITE_DECISION
        engine.applyDamage(8);

        // Choose SMITE_1
        const result = engine.submitAction({
            type: "SMITE_1",
            entityId: "p1",
        });

        expect(result.success).toBe(true);

        // Check spell slot consumed
        const state = engine.getState();
        const paladinEntity = state.entities.find(e => e.id === "p1")!;
        expect(paladinEntity.spellSlots["1"]).toBe(1); // Was 2, now 1

        // Check smite log
        const smiteLog = result.logs.find(l =>
            l.description?.includes("Divine Smite") && l.description?.includes("2d8")
        );
        expect(smiteLog).toBeDefined();

        // Phase should return to ACTIVE
        expect(state.phase).toBe("ACTIVE");
    });

    it("bonus d8 applies vs undead target", () => {
        const engine = createCombatEngine(1, undefined, alwaysHitRollFn(8));
        const paladin = createPaladin({ spellSlots: { "1": 2 } });
        const zombie = createGoblin({
            id: "e1",
            name: "Zombie",
            creatureType: "undead",
            hp: 50,
            maxHp: 50,
        });
        engine.initiateCombat([paladin, zombie]);

        engine.submitAction({
            type: "ATTACK",
            attackerId: "p1",
            targetId: "e1",
            weaponName: "Longsword",
            attackRoll: 20,
            rawD20: 18,
        });
        engine.applyDamage(8);

        // Legal actions should show the +1d8 bonus in the dice count
        const actions = engine.getLegalActions("p1");
        const smite1 = actions.find(a => a.type === "SMITE_1");
        expect(smite1).toBeDefined();
        // Level 1: 1+1=2d8, +1 for undead = 3d8
        expect(smite1!.description).toContain("3d8");

        // Smite and verify log has bonus note
        const result = engine.submitAction({
            type: "SMITE_1",
            entityId: "p1",
        });
        expect(result.success).toBe(true);
        const smiteLog = result.logs.find(l =>
            l.description?.includes("Divine Smite") && l.description?.includes("3d8")
        );
        expect(smiteLog).toBeDefined();
        expect(smiteLog!.description).toContain("undead");
    });

    it("decline smite applies normal damage without smite bonus", () => {
        const engine = createCombatEngine(1, undefined, alwaysHitRollFn(8));
        const paladin = createPaladin();
        const goblin = createGoblin({ hp: 50, maxHp: 50 });
        engine.initiateCombat([paladin, goblin]);

        engine.submitAction({
            type: "ATTACK",
            attackerId: "p1",
            targetId: "e1",
            weaponName: "Longsword",
            attackRoll: 20,
            rawD20: 18,
        });
        engine.applyDamage(8);

        const result = engine.submitAction({
            type: "DECLINE_SMITE",
            entityId: "p1",
        });

        expect(result.success).toBe(true);
        // Should NOT have smite log
        const smiteLog = result.logs.find(l =>
            l.description?.includes("Divine Smite")
        );
        expect(smiteLog).toBeUndefined();

        // Spell slots unchanged
        const state = engine.getState();
        const paladinEntity = state.entities.find(e => e.id === "p1")!;
        expect(paladinEntity.spellSlots["1"]).toBe(4);

        // Phase back to ACTIVE
        expect(state.phase).toBe("ACTIVE");
    });

    it("does not trigger for ranged attacks", () => {
        const engine = createCombatEngine(1, undefined, alwaysHitRollFn(8));
        const paladin = createPaladin({
            weapons: [{
                name: "Javelin",
                damageFormula: "1d6+4",
                damageType: "piercing",
                isRanged: true,
                attackBonus: 7,
                properties: ["thrown"],
            }],
        });
        const goblin = createGoblin({ hp: 50, maxHp: 50 });
        engine.initiateCombat([paladin, goblin]);

        engine.getEntity("p1")!.rangeTo["e1"] = RangeBand.NEAR;
        engine.getEntity("e1")!.rangeTo["p1"] = RangeBand.NEAR;

        engine.submitAction({
            type: "ATTACK",
            attackerId: "p1",
            targetId: "e1",
            weaponName: "Javelin",
            isRanged: true,
            attackRoll: 20,
            rawD20: 18,
        });

        // Apply damage — should NOT enter AWAIT_SMITE_DECISION
        const result = engine.applyDamage(8);
        expect(result.success).toBe(true);
        expect(result.awaitingSmiteDecision).toBeUndefined();

        const state = engine.getState();
        expect(state.phase).toBe("ACTIVE");
    });

    it("does not trigger when Paladin has no spell slots", () => {
        const engine = createCombatEngine(1, undefined, alwaysHitRollFn(8));
        const paladin = createPaladin({ spellSlots: {} });
        const goblin = createGoblin({ hp: 50, maxHp: 50 });
        engine.initiateCombat([paladin, goblin]);

        engine.submitAction({
            type: "ATTACK",
            attackerId: "p1",
            targetId: "e1",
            weaponName: "Longsword",
            attackRoll: 20,
            rawD20: 18,
        });

        const result = engine.applyDamage(8);
        expect(result.success).toBe(true);
        expect(result.awaitingSmiteDecision).toBeUndefined();
        expect(engine.getState().phase).toBe("ACTIVE");
    });
});
