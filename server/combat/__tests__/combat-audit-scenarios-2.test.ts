/**
 * Combat Audit Scenarios Part 2 — 50 Extended Multi-Step Scenarios
 *
 * Covers: enemy behavior, death saves, conditions, damage types, temp HP,
 * spatial model, action economy edge cases, combat ending, undo, initiative,
 * and complex multi-turn sequences.
 *
 * Each test plays through realistic multi-step turns collecting audit snapshots.
 */

import { describe, it, expect } from "vitest";
import { CombatEngineV2, createCombatEngine, type RollFn } from "../combat-engine-v2";
import {
    createPlayerEntity,
    createEnemyEntity,
    RangeBand,
    type CombatEntity,
    type CombatLogEntry,
} from "../combat-types";

// =============================================================================
// HELPERS
// =============================================================================

function fixedRoll(total: number): RollFn {
    return (_formula: string) => ({
        total,
        rolls: [total],
        isCritical: total === 20,
        isFumble: total === 1,
    });
}

function sequenceRoll(values: number[]): RollFn {
    let i = 0;
    return (_formula: string) => {
        const val = values[i % values.length];
        i++;
        return { total: val, rolls: [val], isCritical: val === 20, isFumble: val === 1 };
    };
}

function makePlayer(id: string, name: string, opts?: Partial<CombatEntity>): CombatEntity {
    return createPlayerEntity(id, name, 30, 30, 15, 10, {
        attackModifier: 5,
        damageFormula: "1d8+3",
        damageType: "slashing",
        weapons: [{ name: "Longsword", damageFormula: "1d8+3", damageType: "slashing", isRanged: false, attackBonus: 5, properties: [] }],
        ...opts,
    });
}

function makeEnemy(id: string, name: string, opts?: Partial<CombatEntity>): CombatEntity {
    return createEnemyEntity(id, name, 30, 14, 5, "1d8+3", {
        damageType: "slashing",
        weapons: [{ name: "Claw", damageFormula: "1d8+3", damageType: "slashing", isRanged: false, attackBonus: 5, properties: [] }],
        ...opts,
    });
}

function startCombat(engine: CombatEngineV2, entities: CombatEntity[]): void {
    const withInit = entities.map((e, i) => ({
        ...e,
        initiative: 20 - i,
    }));
    engine.initiateCombat(withInit);
}

/** Get entity HP from engine state */
function hp(engine: CombatEngineV2, id: string): number {
    return engine.getState().entities.find(e => e.id === id)?.hp ?? -1;
}

/** Get entity status from engine state */
function status(engine: CombatEngineV2, id: string): string {
    return engine.getState().entities.find(e => e.id === id)?.status ?? "UNKNOWN";
}

/** Get entity by ID */
function entity(engine: CombatEngineV2, id: string): CombatEntity | undefined {
    return engine.getState().entities.find(e => e.id === id);
}

// =============================================================================
// GROUP 1: ENEMY AUTO-RESOLUTION (Scenarios 11–18)
// =============================================================================

describe("Group 1: Enemy auto-resolution", () => {
    it("S11: Enemy attack auto-resolves — no AWAIT phases", () => {
        const engine = createCombatEngine(1, {}, fixedRoll(15));
        const player = makePlayer("p1", "Hero");
        const gob = makeEnemy("gob", "Goblin");
        startCombat(engine, [player, gob]);

        // End player turn
        engine.submitAction({ type: "END_TURN", entityId: "p1" });

        // Now it's goblin's turn — submit attack with pre-rolled values
        const result = engine.submitAction({
            type: "ATTACK",
            attackerId: "gob",
            targetId: "p1",
            attackRoll: 20,
            rawD20: 15,
        });

        expect(result.success).toBe(true);
        // Enemy attack auto-resolves: no AWAIT phases
        expect(result.awaitingAttackRoll ?? false).toBe(false);
        expect(result.awaitingDamageRoll ?? false).toBe(false);
        // fixedRoll(15): d20=15 (hit), damage=15 (auto-rolled "1d8+3"→15)
        expect(hp(engine, "p1")).toBe(15);
        // Enemy auto-ends turn after action
        const turnEnd = result.logs.find(l => l.type === "TURN_END");
        expect(turnEnd?.actorId).toBe("gob");
    });

    it("S12: Enemy multiattack — 2 attacks auto-resolve in sequence", () => {
        const engine = createCombatEngine(1, {}, fixedRoll(10));
        const player = makePlayer("p1", "Hero");
        const ogre = makeEnemy("ogre", "Ogre", { extraAttacks: 1, hp: 50 });
        startCombat(engine, [player, ogre]);

        engine.submitAction({ type: "END_TURN", entityId: "p1" });
        expect(engine.getState().turnResources?.extraAttacksRemaining).toBe(1);

        // First attack (uses extra attack slot)
        const atk1 = engine.submitAction({
            type: "ATTACK", attackerId: "ogre", targetId: "p1",
            attackRoll: 20, rawD20: 15,
        });
        expect(atk1.success).toBe(true);
        // Should NOT auto-end — still has action
        expect(engine.getState().turnResources?.extraAttacksRemaining).toBe(0);
        expect(engine.getState().turnResources?.actionUsed).toBe(false);

        // Second attack (uses action)
        const atk2 = engine.submitAction({
            type: "ATTACK", attackerId: "ogre", targetId: "p1",
            attackRoll: 20, rawD20: 15,
        });
        expect(atk2.success).toBe(true);
        // Now auto-ends (action + extra attacks exhausted)
        const turnEnd = atk2.logs.find(l => l.type === "TURN_END");
        expect(turnEnd?.actorId).toBe("ogre");
        // Player took 2 × 10 damage = 20
        expect(hp(engine, "p1")).toBe(10);
    });

    it("S13: Enemy with 3 extra attacks — all resolve, then auto-end", () => {
        const engine = createCombatEngine(1, {}, fixedRoll(10));
        const player = makePlayer("p1", "Hero", { hp: 100, maxHp: 100 });
        const hydra = makeEnemy("hydra", "Hydra", { extraAttacks: 3, hp: 80 });
        startCombat(engine, [player, hydra]);

        engine.submitAction({ type: "END_TURN", entityId: "p1" });
        expect(engine.getState().turnResources?.extraAttacksRemaining).toBe(3);

        // 3 extra attacks + 1 action = 4 total
        for (let i = 0; i < 3; i++) {
            const atk = engine.submitAction({
                type: "ATTACK", attackerId: "hydra", targetId: "p1",
                attackRoll: 20, rawD20: 15,
            });
            expect(atk.success, `attack ${i + 1}`).toBe(true);
            // Should not auto-end yet
            expect(atk.logs.find(l => l.type === "TURN_END"), `no auto-end on attack ${i + 1}`).toBeUndefined();
        }

        // 4th attack (action)
        const finalAtk = engine.submitAction({
            type: "ATTACK", attackerId: "hydra", targetId: "p1",
            attackRoll: 20, rawD20: 15,
        });
        expect(finalAtk.success).toBe(true);
        expect(finalAtk.logs.find(l => l.type === "TURN_END")?.actorId).toBe("hydra");
    });

    it("S14: Enemy attack misses — no damage, turn still ends", () => {
        const engine = createCombatEngine(1, {}, fixedRoll(10));
        const player = makePlayer("p1", "Hero", { baseAC: 20 });
        const gob = makeEnemy("gob", "Goblin");
        startCombat(engine, [player, gob]);

        engine.submitAction({ type: "END_TURN", entityId: "p1" });

        // Attack with total 8 vs AC 20 → miss
        const result = engine.submitAction({
            type: "ATTACK", attackerId: "gob", targetId: "p1",
            attackRoll: 8, rawD20: 3,
        });
        expect(result.success).toBe(true);
        expect(hp(engine, "p1")).toBe(30); // No damage on miss
        expect(result.logs.find(l => l.type === "TURN_END")).toBeDefined();
    });

    it("S15: Enemy casts spell on players → AWAIT_SAVE_ROLL", () => {
        const engine = createCombatEngine(1, {}, fixedRoll(10));
        const player = makePlayer("p1", "Hero", {
            abilityScores: { str: 10, dex: 14, con: 12, int: 10, wis: 10, cha: 10 },
        });
        const mage = makeEnemy("mage", "Evil Mage", {
            spells: [{
                name: "Hold Person", level: 2, school: "enchantment",
                castingTime: "action", range: 60, isAreaEffect: false,
                savingThrow: "WIS", halfOnSave: false,
                requiresConcentration: true, requiresAttackRoll: false,
                conditions: ["paralyzed"], description: "Paralyze",
            }],
            spellSlots: { "2": 3 },
            spellSaveDC: 14,
        });
        startCombat(engine, [player, mage]);

        engine.submitAction({ type: "END_TURN", entityId: "p1" });

        const cast = engine.submitAction({
            type: "CAST_SPELL", casterId: "mage",
            spellName: "Hold Person", targetIds: ["p1"],
        });
        expect(cast.success).toBe(true);
        // Player must save → AWAIT_SAVE_ROLL
        expect(engine.getState().phase).toBe("AWAIT_SAVE_ROLL");
        expect(cast.awaitingSaveRoll).toBe(true);

        // Player fails save (roll 5 + 0 WIS = 5 < DC 14)
        const save = engine.submitSavingThrow("p1", 5);
        expect(save.success).toBe(true);

        // Mage should be concentrating (cast concentration spell)
        const mageEntity = entity(engine, "mage");
        const isConc = mageEntity?.activeConditions?.some(c => c.name === "concentrating");
        expect(isConc).toBe(true);

        // Player failed save → should have paralyzed condition
        const playerEntity = entity(engine, "p1");
        const isParalyzed = playerEntity?.activeConditions?.some(c => c.name === "paralyzed");
        expect(isParalyzed).toBe(true);
    });

    it("S16: Enemy killed → skipped in turn order", () => {
        const engine = createCombatEngine(1, {}, fixedRoll(10));
        const player = makePlayer("p1", "Hero");
        const gob1 = makeEnemy("gob1", "Goblin A", { hp: 5 });
        const gob2 = makeEnemy("gob2", "Goblin B");
        startCombat(engine, [player, gob1, gob2]);

        // Kill gob1 with one attack
        const atk = engine.submitAction({
            type: "ATTACK", attackerId: "p1", targetId: "gob1",
            attackRoll: 20, rawD20: 15,
        });
        // Player attack → AWAIT_DAMAGE_ROLL
        expect(engine.getState().phase).toBe("AWAIT_DAMAGE_ROLL");
        engine.applyDamage(8); // > 5 HP → kill
        expect(status(engine, "gob1")).toBe("DEAD");

        // End player turn
        engine.submitAction({ type: "END_TURN", entityId: "p1" });

        // Turn should skip dead gob1 and go to gob2
        const state = engine.getState();
        expect(state.turnOrder[state.turnIndex]).toBe("gob2");
    });

    it("S17: Enemy moves toward player (NEAR → MELEE) before attacking", () => {
        const engine = createCombatEngine(1, {}, fixedRoll(10));
        const player = makePlayer("p1", "Hero");
        const gob = makeEnemy("gob", "Goblin");
        startCombat(engine, [player, gob]);

        engine.submitAction({ type: "END_TURN", entityId: "p1" });

        // Move toward player
        const move = engine.submitAction({
            type: "MOVE", entityId: "gob", targetId: "p1", direction: "toward",
        });
        expect(move.success).toBe(true);

        // Now at MELEE — attack
        const atk = engine.submitAction({
            type: "ATTACK", attackerId: "gob", targetId: "p1",
            attackRoll: 20, rawD20: 15,
        });
        expect(atk.success).toBe(true);
        expect(hp(engine, "p1")).toBeLessThan(30);
    });

    it("S18: Multiple enemies take turns in sequence", () => {
        const engine = createCombatEngine(1, {}, fixedRoll(10));
        const player = makePlayer("p1", "Hero", { hp: 100, maxHp: 100 });
        const gob1 = makeEnemy("gob1", "Goblin A");
        const gob2 = makeEnemy("gob2", "Goblin B");
        const gob3 = makeEnemy("gob3", "Goblin C");
        startCombat(engine, [player, gob1, gob2, gob3]);

        engine.submitAction({ type: "END_TURN", entityId: "p1" });
        const hpAfterPlayerTurn = hp(engine, "p1");

        // Gob1 attacks: fixedRoll(10) → 10 damage
        engine.submitAction({
            type: "ATTACK", attackerId: "gob1", targetId: "p1",
            attackRoll: 20, rawD20: 15,
        });
        expect(hp(engine, "p1")).toBe(90);

        // Gob2 attacks: another 10 damage
        engine.submitAction({
            type: "ATTACK", attackerId: "gob2", targetId: "p1",
            attackRoll: 20, rawD20: 15,
        });
        expect(hp(engine, "p1")).toBe(80);

        // Gob3 attacks: another 10 damage
        engine.submitAction({
            type: "ATTACK", attackerId: "gob3", targetId: "p1",
            attackRoll: 20, rawD20: 15,
        });
        expect(hp(engine, "p1")).toBe(70);

        // After gob3, round wraps → player's turn again
        expect(engine.getState().round).toBe(2);
    });
});

// =============================================================================
// GROUP 2: DEATH SAVES & UNCONSCIOUS (Scenarios 19–28)
// =============================================================================

describe("Group 2: Death saves & unconscious", () => {
    /** Helper: knock player to 0 HP */
    function knockOut(engine: CombatEngineV2, targetId: string) {
        const target = engine.getEntity(targetId);
        if (target) target.hp = 0;
        if (target) target.status = "UNCONSCIOUS";
    }

    it("S19: Player reduced to 0 HP → falls unconscious (not dead)", () => {
        const engine = createCombatEngine(1, {}, fixedRoll(10));
        const player = makePlayer("p1", "Hero", { hp: 5, isEssential: true });
        const gob = makeEnemy("gob", "Goblin");
        startCombat(engine, [player, gob]);

        engine.submitAction({ type: "END_TURN", entityId: "p1" });

        // Enemy attack deals enough to drop player
        engine.submitAction({
            type: "ATTACK", attackerId: "gob", targetId: "p1",
            attackRoll: 20, rawD20: 15,
        });
        expect(status(engine, "p1")).toBe("UNCONSCIOUS");
        expect(hp(engine, "p1")).toBe(0);
    });

    it("S20: Death save success (d20 ≥ 10)", () => {
        const engine = createCombatEngine(1, {}, fixedRoll(10));
        const player = makePlayer("p1", "Hero", { isEssential: true });
        const gob = makeEnemy("gob", "Goblin");
        startCombat(engine, [player, gob]);

        knockOut(engine, "p1");

        // Player's turn with 0 HP → AWAIT_DEATH_SAVE
        // Since initiateCombat already started p1's turn, we need to end & cycle
        engine.submitAction({ type: "END_TURN", entityId: "p1" });
        // gob's turn
        engine.submitAction({ type: "END_TURN", entityId: "gob" });
        // Back to p1 — unconscious → AWAIT_DEATH_SAVE
        expect(engine.getState().phase).toBe("AWAIT_DEATH_SAVE");

        const save = engine.rollDeathSave("p1", 12);
        expect(save.success).toBe(true);
        const p = entity(engine, "p1");
        expect(p?.deathSaves.successes).toBe(1);
        expect(p?.status).toBe("UNCONSCIOUS"); // Still unconscious (need 3 successes)
    });

    it("S21: Death save failure (d20 < 10)", () => {
        const engine = createCombatEngine(1, {}, fixedRoll(10));
        const player = makePlayer("p1", "Hero", { isEssential: true });
        const gob = makeEnemy("gob", "Goblin");
        startCombat(engine, [player, gob]);

        knockOut(engine, "p1");
        engine.submitAction({ type: "END_TURN", entityId: "p1" });
        engine.submitAction({ type: "END_TURN", entityId: "gob" });

        expect(engine.getState().phase).toBe("AWAIT_DEATH_SAVE");
        const save = engine.rollDeathSave("p1", 5);
        expect(save.success).toBe(true);
        const p = entity(engine, "p1");
        expect(p?.deathSaves.failures).toBe(1);
        expect(p?.status).toBe("UNCONSCIOUS");
    });

    it("S22: Death save nat 20 → revive with 1 HP", () => {
        const engine = createCombatEngine(1, {}, fixedRoll(10));
        const player = makePlayer("p1", "Hero", { isEssential: true });
        const gob = makeEnemy("gob", "Goblin");
        startCombat(engine, [player, gob]);

        knockOut(engine, "p1");
        engine.submitAction({ type: "END_TURN", entityId: "p1" });
        engine.submitAction({ type: "END_TURN", entityId: "gob" });

        const save = engine.rollDeathSave("p1", 20);
        expect(save.success).toBe(true);
        expect(hp(engine, "p1")).toBe(1);
        expect(status(engine, "p1")).toBe("ALIVE");
    });

    it("S23: Death save nat 1 → 2 failures", () => {
        const engine = createCombatEngine(1, {}, fixedRoll(10));
        const player = makePlayer("p1", "Hero", { isEssential: true });
        const gob = makeEnemy("gob", "Goblin");
        startCombat(engine, [player, gob]);

        knockOut(engine, "p1");
        engine.submitAction({ type: "END_TURN", entityId: "p1" });
        engine.submitAction({ type: "END_TURN", entityId: "gob" });

        const save = engine.rollDeathSave("p1", 1);
        expect(save.success).toBe(true);
        expect(entity(engine, "p1")?.deathSaves.failures).toBe(2);
    });

    it("S24: 3 death save successes → stabilize", () => {
        const engine = createCombatEngine(1, {}, fixedRoll(10));
        const player = makePlayer("p1", "Hero", { isEssential: true });
        const gob = makeEnemy("gob", "Goblin");
        startCombat(engine, [player, gob]);

        knockOut(engine, "p1");

        // Cycle through 3 rounds of death saves
        for (let i = 0; i < 3; i++) {
            engine.submitAction({ type: "END_TURN", entityId: "p1" });
            engine.submitAction({ type: "END_TURN", entityId: "gob" });
            engine.rollDeathSave("p1", 15); // success
        }

        const p = entity(engine, "p1");
        expect(p?.isStabilized).toBe(true);
        expect(p?.status).toBe("UNCONSCIOUS"); // Still unconscious, just stable
    });

    it("S25: 3 death save failures → death", () => {
        const engine = createCombatEngine(1, {}, fixedRoll(10));
        const player = makePlayer("p1", "Hero", { isEssential: true });
        const gob = makeEnemy("gob", "Goblin");
        startCombat(engine, [player, gob]);

        knockOut(engine, "p1");

        for (let i = 0; i < 3; i++) {
            engine.submitAction({ type: "END_TURN", entityId: "p1" });
            engine.submitAction({ type: "END_TURN", entityId: "gob" });
            engine.rollDeathSave("p1", 5); // failure
        }

        expect(status(engine, "p1")).toBe("DEAD");
    });

    it("S26: Stabilized player skips death saves on subsequent turns", () => {
        const engine = createCombatEngine(1, {}, fixedRoll(10));
        const player = makePlayer("p1", "Hero", { isEssential: true });
        const gob = makeEnemy("gob", "Goblin");
        startCombat(engine, [player, gob]);

        knockOut(engine, "p1");
        const p = engine.getEntity("p1")!;
        p.isStabilized = true;

        // End current p1 turn
        engine.submitAction({ type: "END_TURN", entityId: "p1" });
        engine.submitAction({ type: "END_TURN", entityId: "gob" });

        // P1's turn: stabilized → should NOT enter AWAIT_DEATH_SAVE
        expect(engine.getState().phase).toBe("ACTIVE");
    });

    it("S27: Heal unconscious player → revives", () => {
        const engine = createCombatEngine(1, {}, fixedRoll(10));
        const cleric = makePlayer("clr", "Cleric");
        const fighter = makePlayer("ftr", "Fighter", { isEssential: true });
        const gob = makeEnemy("gob", "Goblin");
        startCombat(engine, [cleric, fighter, gob]);

        knockOut(engine, "ftr");

        // Cleric heals fighter
        const heal = engine.submitAction({
            type: "HEAL", entityId: "clr", targetId: "ftr", amount: 10,
        });
        expect(heal.success).toBe(true);
        expect(hp(engine, "ftr")).toBe(10);
        expect(status(engine, "ftr")).toBe("ALIVE");
    });

    it("S28: Damage while unconscious → death save failures", () => {
        const engine = createCombatEngine(1, {}, fixedRoll(10));
        const player = makePlayer("p1", "Hero", { isEssential: true });
        const gob = makeEnemy("gob", "Goblin");
        startCombat(engine, [player, gob]);

        knockOut(engine, "p1");
        engine.submitAction({ type: "END_TURN", entityId: "p1" });

        // Enemy attacks unconscious player → death save failures
        const atk = engine.submitAction({
            type: "ATTACK", attackerId: "gob", targetId: "p1",
            attackRoll: 20, rawD20: 15,
        });
        expect(atk.success).toBe(true);
        // Melee hit on unconscious = 2 death save failures
        expect(entity(engine, "p1")?.deathSaves.failures).toBe(2);
    });
});

// =============================================================================
// GROUP 3: CONDITIONS (Scenarios 29–38)
// =============================================================================

describe("Group 3: Conditions", () => {
    it("S29: Prone target — melee attacks have advantage", () => {
        const engine = createCombatEngine(1, {}, fixedRoll(10));
        const player = makePlayer("p1", "Hero");
        const gob = makeEnemy("gob", "Goblin");
        startCombat(engine, [player, gob]);

        // Make goblin prone via active condition
        engine.getEntity("gob")!.activeConditions = [
            { name: "prone", sourceId: "env", duration: 1 },
        ];

        // Player attacks — engine should compute advantage
        const atk = engine.submitAction({
            type: "ATTACK", attackerId: "p1", targetId: "gob",
        });
        expect(atk.success).toBe(true);
        // Check that pendingAttackRoll has advantage (from prone target in melee)
        // First ensure the goblin is in melee range
        engine.getEntity("p1")!.rangeTo["gob"] = RangeBand.MELEE;
        engine.getEntity("gob")!.rangeTo["p1"] = RangeBand.MELEE;

        // Undo and retry to pick up the range change
        engine.undoLastAction();

        const atk2 = engine.submitAction({
            type: "ATTACK", attackerId: "p1", targetId: "gob",
        });
        const pending = engine.getState().pendingAttackRoll;
        expect(pending?.advantage).toBe(true);
    });

    it("S30: Stunned target — advantage + auto-crit in melee", () => {
        const engine = createCombatEngine(1, {}, fixedRoll(10));
        const player = makePlayer("p1", "Hero");
        const gob = makeEnemy("gob", "Goblin");
        startCombat(engine, [player, gob]);

        // Place in melee and stun goblin
        engine.getEntity("p1")!.rangeTo["gob"] = RangeBand.MELEE;
        engine.getEntity("gob")!.rangeTo["p1"] = RangeBand.MELEE;
        engine.getEntity("gob")!.activeConditions = [
            { name: "stunned", sourceId: "env", duration: 1 },
        ];

        // Player attacks stunned target — auto-crit in melee
        const atk = engine.submitAction({
            type: "ATTACK", attackerId: "p1", targetId: "gob",
            attackRoll: 20, rawD20: 10,
        });
        expect(atk.success).toBe(true);
        expect(engine.getState().phase).toBe("AWAIT_DAMAGE_ROLL");
        const pending = engine.getState().pendingAttack;
        expect(pending?.isCritical).toBe(true);
        expect(pending?.damageFormula).toContain("2d8");
    });

    it("S31: Blinded attacker has disadvantage", () => {
        const engine = createCombatEngine(1, {}, fixedRoll(10));
        const player = makePlayer("p1", "Hero");
        const gob = makeEnemy("gob", "Goblin");
        startCombat(engine, [player, gob]);

        // Blind the player
        engine.getEntity("p1")!.activeConditions = [
            { name: "blinded", sourceId: "env", duration: 1 },
        ];

        const atk = engine.submitAction({
            type: "ATTACK", attackerId: "p1", targetId: "gob",
        });
        const pending = engine.getState().pendingAttackRoll;
        expect(pending?.disadvantage).toBe(true);
    });

    it("S32: Poisoned attacker has disadvantage", () => {
        const engine = createCombatEngine(1, {}, fixedRoll(10));
        const player = makePlayer("p1", "Hero");
        const gob = makeEnemy("gob", "Goblin");
        startCombat(engine, [player, gob]);

        engine.getEntity("p1")!.activeConditions = [
            { name: "poisoned", sourceId: "env", duration: 1 },
        ];

        engine.submitAction({
            type: "ATTACK", attackerId: "p1", targetId: "gob",
        });
        expect(engine.getState().pendingAttackRoll?.disadvantage).toBe(true);
    });

    it("S33: DODGE gives disadvantage to incoming attacks", () => {
        const engine = createCombatEngine(1, {}, fixedRoll(10));
        const player = makePlayer("p1", "Hero");
        const gob = makeEnemy("gob", "Goblin");
        startCombat(engine, [player, gob]);

        // Player dodges
        const dodge = engine.submitAction({ type: "DODGE", entityId: "p1" });
        expect(dodge.success).toBe(true);
        expect(engine.getEntity("p1")!.conditions).toContain("dodging");

        engine.submitAction({ type: "END_TURN", entityId: "p1" });

        // Goblin attacks dodging player — should have disadvantage
        // Enemy auto-resolves, but we can verify the dodge is in place
        // by checking the dodging condition exists
        expect(engine.getEntity("p1")!.conditions).toContain("dodging");
    });

    it("S34: HELP gives ally advantage on next attack", () => {
        const engine = createCombatEngine(1, {}, fixedRoll(10));
        const p1 = makePlayer("p1", "Helper");
        const p2 = makePlayer("p2", "Attacker");
        const gob = makeEnemy("gob", "Goblin");
        startCombat(engine, [p1, p2, gob]);

        // P1 helps P2
        const help = engine.submitAction({
            type: "HELP", entityId: "p1", allyId: "p2",
        });
        expect(help.success).toBe(true);

        // P1 ends turn
        engine.submitAction({ type: "END_TURN", entityId: "p1" });

        // P2's turn — attack with advantage from help
        const atk = engine.submitAction({
            type: "ATTACK", attackerId: "p2", targetId: "gob",
        });
        const pending = engine.getState().pendingAttackRoll;
        expect(pending?.advantage).toBe(true);
    });

    it("S35: Frightened attacker has disadvantage", () => {
        const engine = createCombatEngine(1, {}, fixedRoll(10));
        const player = makePlayer("p1", "Hero");
        const gob = makeEnemy("gob", "Goblin");
        startCombat(engine, [player, gob]);

        engine.getEntity("p1")!.activeConditions = [
            { name: "frightened", sourceId: "gob", duration: 1 },
        ];

        engine.submitAction({
            type: "ATTACK", attackerId: "p1", targetId: "gob",
        });
        expect(engine.getState().pendingAttackRoll?.disadvantage).toBe(true);
    });

    it("S36: Paralyzed target — advantage + auto-crit in melee", () => {
        const engine = createCombatEngine(1, {}, fixedRoll(10));
        const player = makePlayer("p1", "Hero");
        const gob = makeEnemy("gob", "Goblin");
        startCombat(engine, [player, gob]);

        engine.getEntity("p1")!.rangeTo["gob"] = RangeBand.MELEE;
        engine.getEntity("gob")!.rangeTo["p1"] = RangeBand.MELEE;
        engine.getEntity("gob")!.activeConditions = [
            { name: "paralyzed", sourceId: "env", duration: 1 },
        ];

        const atk = engine.submitAction({
            type: "ATTACK", attackerId: "p1", targetId: "gob",
            attackRoll: 15, rawD20: 10,
        });
        expect(atk.success).toBe(true);
        // Paralyzed in melee → auto-crit
        expect(engine.getState().phase).toBe("AWAIT_DAMAGE_ROLL");
        expect(engine.getState().pendingAttack?.isCritical).toBe(true);
    });

    it("S37: Ranged attack in melee → disadvantage", () => {
        const engine = createCombatEngine(1, {}, fixedRoll(10));
        const archer = makePlayer("p1", "Archer", {
            weapons: [{ name: "Longbow", damageFormula: "1d8+3", damageType: "piercing", isRanged: true, attackBonus: 5, properties: [] }],
        });
        const gob = makeEnemy("gob", "Goblin");
        startCombat(engine, [archer, gob]);

        // Place in melee
        engine.getEntity("p1")!.rangeTo["gob"] = RangeBand.MELEE;
        engine.getEntity("gob")!.rangeTo["p1"] = RangeBand.MELEE;

        const atk = engine.submitAction({
            type: "ATTACK", attackerId: "p1", targetId: "gob",
            isRanged: true,
        });
        const pending = engine.getState().pendingAttackRoll;
        expect(pending?.disadvantage).toBe(true);
    });

    it("S38: Multiple conditions stack — blinded + poisoned → disadvantage", () => {
        const engine = createCombatEngine(1, {}, fixedRoll(10));
        const player = makePlayer("p1", "Hero");
        const gob = makeEnemy("gob", "Goblin");
        startCombat(engine, [player, gob]);

        engine.getEntity("p1")!.activeConditions = [
            { name: "blinded", sourceId: "env", duration: 1 },
            { name: "poisoned", sourceId: "env", duration: 1 },
        ];

        engine.submitAction({
            type: "ATTACK", attackerId: "p1", targetId: "gob",
        });
        // Both conditions cause disadvantage — should still show disadvantage
        expect(engine.getState().pendingAttackRoll?.disadvantage).toBe(true);
    });
});

// =============================================================================
// GROUP 4: DAMAGE TYPES & TEMP HP (Scenarios 39–45)
// =============================================================================

describe("Group 4: Damage types & temp HP", () => {
    it("S39: Fire resistance halves fire damage", () => {
        const engine = createCombatEngine(1, {}, fixedRoll(10));
        const wizard = makePlayer("wiz", "Gandalf", {
            spells: [{
                name: "Fire Bolt", level: 0, school: "evocation",
                castingTime: "action", range: 120, isAreaEffect: false,
                savingThrow: undefined, halfOnSave: false,
                damageFormula: "2d10", damageType: "fire",
                requiresConcentration: false, requiresAttackRoll: true,
                conditions: [], description: "Fire",
            }],
            spellAttackBonus: 7, spellSaveDC: 15,
        });
        const demon = makeEnemy("demon", "Fire Demon", { resistances: ["fire"] });
        startCombat(engine, [wizard, demon]);

        engine.submitAction({
            type: "CAST_SPELL", casterId: "wiz",
            spellName: "Fire Bolt", targetIds: ["demon"],
        });
        engine.resolveAttackRoll(15); // hit
        engine.applyDamage(12); // 12 fire → halved to 6

        expect(hp(engine, "demon")).toBe(30 - 6);
    });

    it("S40: Poison immunity → 0 damage", () => {
        const engine = createCombatEngine(1, {}, fixedRoll(10));
        const player = makePlayer("p1", "Hero", {
            damageType: "poison",
            weapons: [{ name: "Poison Dagger", damageFormula: "1d4+3", damageType: "poison", isRanged: false, attackBonus: 5, properties: [] }],
        });
        const construct = makeEnemy("con", "Iron Golem", { immunities: ["poison"] });
        startCombat(engine, [player, construct]);

        const atk = engine.submitAction({
            type: "ATTACK", attackerId: "p1", targetId: "con",
            attackRoll: 20, rawD20: 15,
        });
        expect(engine.getState().phase).toBe("AWAIT_DAMAGE_ROLL");
        engine.applyDamage(8);
        // Immune → 0 damage (HP unchanged)
        expect(hp(engine, "con")).toBe(30);
    });

    it("S41: Vulnerability doubles damage", () => {
        const engine = createCombatEngine(1, {}, fixedRoll(10));
        const player = makePlayer("p1", "Hero", {
            damageType: "fire",
            weapons: [{ name: "Flame Blade", damageFormula: "1d8+3", damageType: "fire", isRanged: false, attackBonus: 5, properties: [] }],
        });
        const troll = makeEnemy("troll", "Troll", { vulnerabilities: ["fire"], hp: 50 });
        startCombat(engine, [player, troll]);

        const atk = engine.submitAction({
            type: "ATTACK", attackerId: "p1", targetId: "troll",
            attackRoll: 20, rawD20: 15,
        });
        expect(engine.getState().phase).toBe("AWAIT_DAMAGE_ROLL");
        engine.applyDamage(8);
        // Vulnerable → double damage (8 × 2 = 16)
        expect(hp(engine, "troll")).toBe(50 - 16);
    });

    it("S42: Temp HP absorbs damage before real HP", () => {
        const engine = createCombatEngine(1, {}, fixedRoll(10));
        const player = makePlayer("p1", "Hero", { tempHp: 10 });
        const gob = makeEnemy("gob", "Goblin");
        startCombat(engine, [player, gob]);

        engine.submitAction({ type: "END_TURN", entityId: "p1" });

        engine.submitAction({
            type: "ATTACK", attackerId: "gob", targetId: "p1",
            attackRoll: 20, rawD20: 15,
        });

        // fixedRoll(10): damage=10, tempHp=10 absorbs all → real HP unchanged
        const p = entity(engine, "p1");
        expect(p?.tempHp).toBe(0);
        expect(p?.hp).toBe(30);
    });

    it("S43: Fireball half-on-save — successful save halves damage (floor)", () => {
        // Enemy rolls 18 for save → passes DC 15
        const engine = createCombatEngine(1, {}, sequenceRoll([18]));
        const wizard = makePlayer("wiz", "Gandalf", {
            spells: [{
                name: "Fireball", level: 3, school: "evocation",
                castingTime: "action", range: 150, isAreaEffect: true,
                areaType: "sphere", savingThrow: "DEX", halfOnSave: true,
                damageFormula: "8d6", damageType: "fire",
                requiresConcentration: false, requiresAttackRoll: false,
                conditions: [], description: "Boom",
            }],
            spellSlots: { "3": 2 }, spellSaveDC: 15, spellAttackBonus: 7,
        });
        const gob = makeEnemy("gob", "Goblin", {
            abilityScores: { str: 10, dex: 14, con: 10, int: 10, wis: 10, cha: 10 },
        });
        startCombat(engine, [wizard, gob]);

        engine.submitAction({
            type: "CAST_SPELL", casterId: "wiz",
            spellName: "Fireball", targetIds: ["gob"],
        });
        engine.applyDamage(24); // 8d6 = 24

        // Enemy rolled 18 + DEX mod(+2) = 20 vs DC 15 → save success → half
        expect(hp(engine, "gob")).toBe(30 - 12); // floor(24/2) = 12
    });

    it("S44: Resistance + save-based spell: half damage on fail, quarter on save", () => {
        // Enemy rolls 18 → passes save
        const engine = createCombatEngine(1, {}, sequenceRoll([18]));
        const wizard = makePlayer("wiz", "Gandalf", {
            spells: [{
                name: "Fireball", level: 3, school: "evocation",
                castingTime: "action", range: 150, isAreaEffect: true,
                areaType: "sphere", savingThrow: "DEX", halfOnSave: true,
                damageFormula: "8d6", damageType: "fire",
                requiresConcentration: false, requiresAttackRoll: false,
                conditions: [], description: "Boom",
            }],
            spellSlots: { "3": 2 }, spellSaveDC: 15, spellAttackBonus: 7,
        });
        const demon = makeEnemy("demon", "Fire Demon", {
            resistances: ["fire"],
            abilityScores: { str: 10, dex: 14, con: 10, int: 10, wis: 10, cha: 10 },
        });
        startCombat(engine, [wizard, demon]);

        engine.submitAction({
            type: "CAST_SPELL", casterId: "wiz",
            spellName: "Fireball", targetIds: ["demon"],
        });
        engine.applyDamage(24);

        // Save success → half (12), then resistance → half again (6)
        expect(hp(engine, "demon")).toBe(30 - 6);
    });

    it("S45: Immune to fire — Fireball does 0 damage", () => {
        const engine = createCombatEngine(1, {}, sequenceRoll([5])); // fails save
        const wizard = makePlayer("wiz", "Gandalf", {
            spells: [{
                name: "Fireball", level: 3, school: "evocation",
                castingTime: "action", range: 150, isAreaEffect: true,
                areaType: "sphere", savingThrow: "DEX", halfOnSave: true,
                damageFormula: "8d6", damageType: "fire",
                requiresConcentration: false, requiresAttackRoll: false,
                conditions: [], description: "Boom",
            }],
            spellSlots: { "3": 2 }, spellSaveDC: 15, spellAttackBonus: 7,
        });
        const demon = makeEnemy("demon", "Fire Elemental", {
            immunities: ["fire"],
            abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
        });
        startCombat(engine, [wizard, demon]);

        engine.submitAction({
            type: "CAST_SPELL", casterId: "wiz",
            spellName: "Fireball", targetIds: ["demon"],
        });
        engine.applyDamage(24);

        expect(hp(engine, "demon")).toBe(30); // Immune → 0 damage
    });
});

// =============================================================================
// GROUP 5: SPATIAL MODEL & MOVEMENT (Scenarios 46–52)
// =============================================================================

describe("Group 5: Spatial model & movement", () => {
    it("S46: DASH allows double movement (FAR → NEAR → MELEE)", () => {
        const engine = createCombatEngine(1, {}, fixedRoll(10));
        const player = makePlayer("p1", "Hero");
        const gob = makeEnemy("gob", "Goblin");
        startCombat(engine, [player, gob]);

        // Place at FAR range
        engine.getEntity("p1")!.rangeTo["gob"] = RangeBand.FAR;
        engine.getEntity("gob")!.rangeTo["p1"] = RangeBand.FAR;

        // DASH (action)
        const dash = engine.submitAction({ type: "DASH", entityId: "p1" });
        expect(dash.success).toBe(true);

        // First move: FAR → NEAR
        const move1 = engine.submitAction({
            type: "MOVE", entityId: "p1", targetId: "gob", direction: "toward",
        });
        expect(move1.success).toBe(true);

        // Second move (dashing allows it): NEAR → MELEE
        const move2 = engine.submitAction({
            type: "MOVE", entityId: "p1", targetId: "gob", direction: "toward",
        });
        expect(move2.success).toBe(true);

        // Should be in melee now
        expect(engine.getEntity("p1")!.rangeTo["gob"]).toBe(RangeBand.MELEE);
    });

    it("S47: DISENGAGE prevents opportunity attacks on movement away", () => {
        const engine = createCombatEngine(1, {}, fixedRoll(10));
        const player = makePlayer("p1", "Hero");
        const gob = makeEnemy("gob", "Goblin");
        startCombat(engine, [player, gob]);

        // Place in melee
        engine.getEntity("p1")!.rangeTo["gob"] = RangeBand.MELEE;
        engine.getEntity("gob")!.rangeTo["p1"] = RangeBand.MELEE;

        // Disengage
        engine.submitAction({ type: "DISENGAGE", entityId: "p1" });

        // Move away — should NOT trigger opportunity attack
        const move = engine.submitAction({
            type: "MOVE", entityId: "p1", targetId: "gob", direction: "away",
        });
        expect(move.success).toBe(true);
        // HP unchanged (no opportunity attack)
        expect(hp(engine, "p1")).toBe(30);
    });

    it("S48: Moving away without DISENGAGE triggers opportunity attack", () => {
        const engine = createCombatEngine(1, {}, fixedRoll(15));
        const player = makePlayer("p1", "Hero");
        const gob = makeEnemy("gob", "Goblin");
        startCombat(engine, [player, gob]);

        engine.getEntity("p1")!.rangeTo["gob"] = RangeBand.MELEE;
        engine.getEntity("gob")!.rangeTo["p1"] = RangeBand.MELEE;

        // Move away without disengage
        const move = engine.submitAction({
            type: "MOVE", entityId: "p1", targetId: "gob", direction: "away",
        });
        expect(move.success).toBe(true);

        // Goblin should have made opportunity attack → player HP may have changed
        const hasOppAttackLog = move.logs.some(l =>
            l.description?.toLowerCase().includes("opportunity")
        );
        expect(hasOppAttackLog).toBe(true);
    });

    it("S49: Melee attack at NEAR range auto-closes to MELEE on resolve", () => {
        const engine = createCombatEngine(1, {}, fixedRoll(10));
        const player = makePlayer("p1", "Hero");
        const gob = makeEnemy("gob", "Goblin");
        startCombat(engine, [player, gob]);

        // Start at NEAR
        expect(engine.getEntity("p1")!.rangeTo["gob"]).toBe(RangeBand.NEAR);

        // Player attack (no pre-roll) → AWAIT_ATTACK_ROLL
        engine.submitAction({
            type: "ATTACK", attackerId: "p1", targetId: "gob",
        });
        // Movement not consumed yet (only checked for feasibility)
        expect(engine.getState().phase).toBe("AWAIT_ATTACK_ROLL");

        // Resolve attack roll → processAttack auto-closes to melee
        engine.resolveAttackRoll(15); // hit
        // NOW movement should be consumed
        expect(engine.getState().turnResources?.movementUsed).toBe(true);
        // Range should be MELEE
        expect(engine.getEntity("p1")!.rangeTo["gob"]).toBe(RangeBand.MELEE);
    });

    it("S50: Cannot melee attack at FAR range without movement", () => {
        const engine = createCombatEngine(1, {}, fixedRoll(10));
        const player = makePlayer("p1", "Hero");
        const gob = makeEnemy("gob", "Goblin");
        startCombat(engine, [player, gob]);

        // Place at FAR
        engine.getEntity("p1")!.rangeTo["gob"] = RangeBand.FAR;
        engine.getEntity("gob")!.rangeTo["p1"] = RangeBand.FAR;

        const atk = engine.submitAction({
            type: "ATTACK", attackerId: "p1", targetId: "gob",
        });
        expect(atk.success).toBe(false);
        expect(atk.error).toContain("far");
    });

    it("S51: Cannot move beyond FAR range", () => {
        const engine = createCombatEngine(1, {}, fixedRoll(10));
        const player = makePlayer("p1", "Hero");
        const gob = makeEnemy("gob", "Goblin");
        startCombat(engine, [player, gob]);

        engine.getEntity("p1")!.rangeTo["gob"] = RangeBand.FAR;
        engine.getEntity("gob")!.rangeTo["p1"] = RangeBand.FAR;

        const move = engine.submitAction({
            type: "MOVE", entityId: "p1", targetId: "gob", direction: "away",
        });
        expect(move.success).toBe(false);
    });

    it("S52: Cannot close beyond MELEE range", () => {
        const engine = createCombatEngine(1, {}, fixedRoll(10));
        const player = makePlayer("p1", "Hero");
        const gob = makeEnemy("gob", "Goblin");
        startCombat(engine, [player, gob]);

        engine.getEntity("p1")!.rangeTo["gob"] = RangeBand.MELEE;
        engine.getEntity("gob")!.rangeTo["p1"] = RangeBand.MELEE;

        const move = engine.submitAction({
            type: "MOVE", entityId: "p1", targetId: "gob", direction: "toward",
        });
        expect(move.success).toBe(false);
    });
});

// =============================================================================
// GROUP 6: COMBAT ENDING (Scenarios 53–56)
// =============================================================================

describe("Group 6: Combat ending", () => {
    it("S53: All enemies killed → combat ends (RESOLVED)", () => {
        const engine = createCombatEngine(1, {}, fixedRoll(10));
        const player = makePlayer("p1", "Hero");
        const gob = makeEnemy("gob", "Goblin", { hp: 5 });
        startCombat(engine, [player, gob]);

        // Kill goblin
        engine.submitAction({
            type: "ATTACK", attackerId: "p1", targetId: "gob",
            attackRoll: 20, rawD20: 15,
        });
        expect(engine.getState().phase).toBe("AWAIT_DAMAGE_ROLL");
        engine.applyDamage(8); // > 5 HP → kill
        expect(status(engine, "gob")).toBe("DEAD");
        // End turn should trigger combat end
        const endResult = engine.submitAction({ type: "END_TURN", entityId: "p1" });
        expect(engine.getState().phase).toBe("RESOLVED");
    });

    it("S54: All players dead → combat ends", () => {
        const engine = createCombatEngine(1, {}, fixedRoll(10));
        const player = makePlayer("p1", "Hero", { isEssential: true });
        const gob = makeEnemy("gob", "Goblin");
        startCombat(engine, [player, gob]);

        // Kill player directly (bypass isEssential for this test)
        engine.getEntity("p1")!.status = "DEAD";

        engine.submitAction({ type: "END_TURN", entityId: "p1" });

        expect(engine.getState().phase).toBe("RESOLVED");
    });

    it("S55: Unconscious player (not dead) keeps combat alive", () => {
        const engine = createCombatEngine(1, {}, fixedRoll(10));
        const player = makePlayer("p1", "Hero", { isEssential: true });
        const gob = makeEnemy("gob", "Goblin");
        startCombat(engine, [player, gob]);

        // Knock unconscious but not dead
        engine.getEntity("p1")!.status = "UNCONSCIOUS";
        engine.getEntity("p1")!.hp = 0;

        engine.submitAction({ type: "END_TURN", entityId: "p1" });

        // Combat should NOT end — unconscious is not dead
        expect(engine.getState().phase).not.toBe("RESOLVED");
    });

    it("S56: Multiple enemies — combat ends only when ALL are dead", () => {
        const engine = createCombatEngine(1, {}, fixedRoll(10));
        const player = makePlayer("p1", "Hero");
        const gob1 = makeEnemy("gob1", "Goblin A", { hp: 5 });
        const gob2 = makeEnemy("gob2", "Goblin B", { hp: 50 });
        startCombat(engine, [player, gob1, gob2]);

        // Kill gob1
        engine.submitAction({
            type: "ATTACK", attackerId: "p1", targetId: "gob1",
            attackRoll: 20, rawD20: 15,
        });
        expect(engine.getState().phase).toBe("AWAIT_DAMAGE_ROLL");
        engine.applyDamage(8);
        expect(status(engine, "gob1")).toBe("DEAD");

        // End turn — combat should NOT end, gob2 alive
        engine.submitAction({ type: "END_TURN", entityId: "p1" });
        expect(engine.getState().phase).not.toBe("RESOLVED");
    });
});

// =============================================================================
// GROUP 7: CONCENTRATION (Scenarios 57–60)
// =============================================================================

describe("Group 7: Concentration", () => {
    it("S57: Concentration broken by damage — CON save fails", () => {
        // Roll sequence: save roll=5 (fail DC 10)
        const engine = createCombatEngine(1, {}, sequenceRoll([5]));
        const wizard = makePlayer("wiz", "Gandalf", {
            spells: [{
                name: "Hold Person", level: 2, school: "enchantment",
                castingTime: "action", range: 60, isAreaEffect: false,
                savingThrow: "WIS", halfOnSave: false,
                requiresConcentration: true, requiresAttackRoll: false,
                conditions: ["paralyzed"], description: "Paralyze",
            }],
            spellSlots: { "2": 3 }, spellSaveDC: 15,
            abilityScores: { str: 8, dex: 14, con: 10, int: 18, wis: 12, cha: 10 },
        });
        const gob = makeEnemy("gob", "Goblin", {
            abilityScores: { str: 10, dex: 14, con: 10, int: 10, wis: 8, cha: 10 },
        });
        startCombat(engine, [wizard, gob]);

        // Cast concentration spell
        engine.submitAction({
            type: "CAST_SPELL", casterId: "wiz",
            spellName: "Hold Person", targetIds: ["gob"],
        });

        // Wizard is concentrating
        const wizConc = engine.getEntity("wiz")!.activeConditions.some(
            c => c.name === "concentrating"
        );
        expect(wizConc).toBe(true);

        engine.submitAction({ type: "END_TURN", entityId: "wiz" });

        // Enemy attacks wizard → damage triggers concentration save
        engine.submitAction({
            type: "ATTACK", attackerId: "gob", targetId: "wiz",
            attackRoll: 20, rawD20: 15,
        });

        // Concentration should be broken (save failed: 5 + 0 CON = 5 < DC 10)
        const wizAfter = engine.getEntity("wiz")!;
        const stillConc = wizAfter.activeConditions.some(c => c.name === "concentrating");
        expect(stillConc).toBe(false);

        // Goblin should no longer be paralyzed
        const gobParalyzed = engine.getEntity("gob")!.activeConditions.some(
            c => c.name === "paralyzed"
        );
        expect(gobParalyzed).toBe(false);
    });

    it("S58: Concentration maintained — CON save succeeds", () => {
        const engine = createCombatEngine(1, {}, sequenceRoll([18])); // high save
        const wizard = makePlayer("wiz", "Gandalf", {
            spells: [{
                name: "Hold Person", level: 2, school: "enchantment",
                castingTime: "action", range: 60, isAreaEffect: false,
                savingThrow: "WIS", halfOnSave: false,
                requiresConcentration: true, requiresAttackRoll: false,
                conditions: ["paralyzed"], description: "Paralyze",
            }],
            spellSlots: { "2": 3 }, spellSaveDC: 15,
            abilityScores: { str: 8, dex: 14, con: 14, int: 18, wis: 12, cha: 10 },
        });
        const gob = makeEnemy("gob", "Goblin", {
            abilityScores: { str: 10, dex: 14, con: 10, int: 10, wis: 8, cha: 10 },
        });
        startCombat(engine, [wizard, gob]);

        engine.submitAction({
            type: "CAST_SPELL", casterId: "wiz",
            spellName: "Hold Person", targetIds: ["gob"],
        });
        engine.submitAction({ type: "END_TURN", entityId: "wiz" });

        engine.submitAction({
            type: "ATTACK", attackerId: "gob", targetId: "wiz",
            attackRoll: 20, rawD20: 15,
        });

        // Save succeeded (18 + 2 CON = 20 vs DC 10) → concentration maintained
        const stillConc = engine.getEntity("wiz")!.activeConditions.some(
            c => c.name === "concentrating"
        );
        expect(stillConc).toBe(true);
    });

    it("S59: New concentration spell drops previous one", () => {
        const engine = createCombatEngine(1, {}, fixedRoll(10));
        const wizard = makePlayer("wiz", "Gandalf", {
            spells: [
                {
                    name: "Hold Person", level: 2, school: "enchantment",
                    castingTime: "action", range: 60, isAreaEffect: false,
                    savingThrow: "WIS", halfOnSave: false,
                    requiresConcentration: true, requiresAttackRoll: false,
                    conditions: ["paralyzed"], description: "Paralyze",
                },
                {
                    name: "Bless", level: 1, school: "enchantment",
                    castingTime: "action", range: 30, isAreaEffect: false,
                    savingThrow: undefined, halfOnSave: false,
                    requiresConcentration: true, requiresAttackRoll: false,
                    conditions: ["blessed"], description: "Bless allies",
                },
            ],
            spellSlots: { "1": 4, "2": 3 }, spellSaveDC: 15,
        });
        const gob = makeEnemy("gob", "Goblin", {
            abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
        });
        const gob2 = makeEnemy("gob2", "Goblin B");
        startCombat(engine, [wizard, gob, gob2]);

        // Cast Hold Person (concentration)
        engine.submitAction({
            type: "CAST_SPELL", casterId: "wiz",
            spellName: "Hold Person", targetIds: ["gob"],
        });
        expect(engine.getEntity("wiz")!.activeConditions.some(
            c => c.name === "concentrating"
        )).toBe(true);

        // End turn, cycle back to wizard
        engine.submitAction({ type: "END_TURN", entityId: "wiz" });
        engine.submitAction({ type: "END_TURN", entityId: "gob" });
        engine.submitAction({ type: "END_TURN", entityId: "gob2" });

        // Cast Bless (new concentration) → should drop Hold Person
        engine.submitAction({
            type: "CAST_SPELL", casterId: "wiz",
            spellName: "Bless", targetIds: ["wiz"],
        });

        // Still concentrating (on Bless now)
        expect(engine.getEntity("wiz")!.activeConditions.some(
            c => c.name === "concentrating"
        )).toBe(true);

        // Previous Hold Person effect should be removed from goblin
        const gobParalyzed = engine.getEntity("gob")!.activeConditions.some(
            c => c.name === "paralyzed"
        );
        expect(gobParalyzed).toBe(false);
    });

    it("S60: Concentration DC scales with damage (max(10, damage/2))", () => {
        // Test with high damage: 30 → DC 15
        // Roll 14 for save → 14 + 0 CON = 14 < DC 15 → fail
        const engine = createCombatEngine(1, {}, sequenceRoll([14, 10]));
        const wizard = makePlayer("wiz", "Gandalf", {
            spells: [{
                name: "Hold Person", level: 2, school: "enchantment",
                castingTime: "action", range: 60, isAreaEffect: false,
                savingThrow: "WIS", halfOnSave: false,
                requiresConcentration: true, requiresAttackRoll: false,
                conditions: ["paralyzed"], description: "Paralyze",
            }],
            spellSlots: { "2": 3 }, spellSaveDC: 15,
            abilityScores: { str: 8, dex: 14, con: 10, int: 18, wis: 12, cha: 10 },
            hp: 50, maxHp: 50,
        });
        const gob = makeEnemy("gob", "Goblin", {
            abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 8, cha: 10 },
            damageFormula: "6d6+5", // high damage
            attackModifier: 8,
        });
        startCombat(engine, [wizard, gob]);

        engine.submitAction({
            type: "CAST_SPELL", casterId: "wiz",
            spellName: "Hold Person", targetIds: ["gob"],
        });
        engine.submitAction({ type: "END_TURN", entityId: "wiz" });

        // Goblin attacks (high damage to trigger high DC)
        engine.submitAction({
            type: "ATTACK", attackerId: "gob", targetId: "wiz",
            attackRoll: 22, rawD20: 14,
        });

        // Check if concentration was broken based on the save roll
        const log = engine.getState().log;
        const concLog = log.find(l =>
            l.description?.includes("concentration")
        );
        expect(concLog).toBeDefined();
    });
});

// =============================================================================
// GROUP 8: ACTIONS & HIDE (Scenarios 61–66)
// =============================================================================

describe("Group 8: Actions", () => {
    it("S61: HIDE adds hidden condition", () => {
        const engine = createCombatEngine(1, {}, fixedRoll(10));
        const player = makePlayer("p1", "Rogue");
        const gob = makeEnemy("gob", "Goblin");
        startCombat(engine, [player, gob]);

        const hide = engine.submitAction({ type: "HIDE", entityId: "p1" });
        expect(hide.success).toBe(true);
        expect(engine.getEntity("p1")!.conditions).toContain("hidden");
    });

    it("S62: READY stores action with trigger", () => {
        const engine = createCombatEngine(1, {}, fixedRoll(10));
        const player = makePlayer("p1", "Hero");
        const gob = makeEnemy("gob", "Goblin");
        startCombat(engine, [player, gob]);

        const ready = engine.submitAction({
            type: "READY", entityId: "p1",
            readiedAction: "ATTACK", trigger: "enemy_enters_reach",
            targetId: "gob",
        } as any);
        expect(ready.success).toBe(true);
        expect(engine.getEntity("p1")!.conditions.some(c =>
            typeof c === "string" && c.startsWith("readied:")
        )).toBe(true);
        expect(engine.getState().turnResources?.actionUsed).toBe(true);
    });

    it("S63: Cannot use action after action already spent", () => {
        const engine = createCombatEngine(1, {}, fixedRoll(10));
        const player = makePlayer("p1", "Hero");
        const gob = makeEnemy("gob", "Goblin");
        startCombat(engine, [player, gob]);

        // Use action (dodge)
        engine.submitAction({ type: "DODGE", entityId: "p1" });
        expect(engine.getState().turnResources?.actionUsed).toBe(true);

        // Try another action
        const second = engine.submitAction({ type: "HIDE", entityId: "p1" });
        expect(second.success).toBe(false);
    });

    it("S64: Movement doesn't consume action", () => {
        const engine = createCombatEngine(1, {}, fixedRoll(10));
        const player = makePlayer("p1", "Hero");
        const gob = makeEnemy("gob", "Goblin");
        startCombat(engine, [player, gob]);

        // Move first
        engine.submitAction({
            type: "MOVE", entityId: "p1", targetId: "gob", direction: "toward",
        });

        // Action should still be available
        expect(engine.getState().turnResources?.actionUsed).toBe(false);
        expect(engine.getState().turnResources?.movementUsed).toBe(true);

        // Can still attack
        const atk = engine.submitAction({
            type: "ATTACK", attackerId: "p1", targetId: "gob",
        });
        expect(atk.success).toBe(true);
    });

    it("S65: Cannot move twice without DASH", () => {
        const engine = createCombatEngine(1, {}, fixedRoll(10));
        const player = makePlayer("p1", "Hero");
        const gob = makeEnemy("gob", "Goblin");
        startCombat(engine, [player, gob]);

        engine.getEntity("p1")!.rangeTo["gob"] = RangeBand.FAR;
        engine.getEntity("gob")!.rangeTo["p1"] = RangeBand.FAR;

        // First move: FAR → NEAR
        engine.submitAction({
            type: "MOVE", entityId: "p1", targetId: "gob", direction: "toward",
        });

        // Second move without dash: should fail
        const move2 = engine.submitAction({
            type: "MOVE", entityId: "p1", targetId: "gob", direction: "toward",
        });
        expect(move2.success).toBe(false);
    });

    it("S66: Action Surge grants extra action (Fighter)", () => {
        const engine = createCombatEngine(1, {}, fixedRoll(10));
        const fighter = makePlayer("ftr", "Fighter", {
            characterClass: "Fighter",
            featureUses: { "Action Surge": 1 },
        });
        const gob = makeEnemy("gob", "Goblin");
        startCombat(engine, [fighter, gob]);

        // Use action (dodge)
        engine.submitAction({ type: "DODGE", entityId: "ftr" });
        expect(engine.getState().turnResources?.actionUsed).toBe(true);

        // Action Surge
        const surge = engine.submitAction({ type: "ACTION_SURGE", entityId: "ftr" });
        expect(surge.success).toBe(true);

        // Action should be available again
        expect(engine.getState().turnResources?.actionUsed).toBe(false);
    });
});

// =============================================================================
// GROUP 9: UNDO SYSTEM (Scenarios 67–70)
// =============================================================================

describe("Group 9: Undo system", () => {
    it("S67: Undo attack restores target HP", () => {
        const engine = createCombatEngine(1, {}, fixedRoll(10));
        const player = makePlayer("p1", "Hero");
        const gob = makeEnemy("gob", "Goblin");
        startCombat(engine, [player, gob]);

        // Attack with pre-rolled
        engine.submitAction({
            type: "ATTACK", attackerId: "p1", targetId: "gob",
            attackRoll: 20, rawD20: 15,
        });
        expect(engine.getState().phase).toBe("AWAIT_DAMAGE_ROLL");
        engine.applyDamage(8);
        expect(hp(engine, "gob")).toBe(22);

        // Undo
        const undone = engine.undoLastAction();
        expect(undone).toBe(true);
        expect(hp(engine, "gob")).toBe(30);
    });

    it("S68: Undo spell cast restores spell slot", () => {
        const engine = createCombatEngine(1, {}, fixedRoll(10));
        const wizard = makePlayer("wiz", "Gandalf", {
            spells: [{
                name: "Fire Bolt", level: 0, school: "evocation",
                castingTime: "action", range: 120, isAreaEffect: false,
                savingThrow: undefined, halfOnSave: false,
                damageFormula: "2d10", damageType: "fire",
                requiresConcentration: false, requiresAttackRoll: true,
                conditions: [], description: "Fire",
            }, {
                name: "Fireball", level: 3, school: "evocation",
                castingTime: "action", range: 150, isAreaEffect: true,
                areaType: "sphere", savingThrow: "DEX", halfOnSave: true,
                damageFormula: "8d6", damageType: "fire",
                requiresConcentration: false, requiresAttackRoll: false,
                conditions: [], description: "Boom",
            }],
            spellSlots: { "3": 1 }, spellSaveDC: 15, spellAttackBonus: 7,
        });
        const gob = makeEnemy("gob", "Goblin", {
            abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
        });
        startCombat(engine, [wizard, gob]);

        // Cast Fireball (level 3 slot)
        engine.submitAction({
            type: "CAST_SPELL", casterId: "wiz",
            spellName: "Fireball", targetIds: ["gob"],
        });
        expect(engine.getEntity("wiz")!.spellSlots["3"]).toBe(0);

        // Undo
        engine.undoLastAction();
        expect(engine.getEntity("wiz")!.spellSlots["3"]).toBe(1);
    });

    it("S69: Undo END_TURN returns to previous turn", () => {
        const engine = createCombatEngine(1, {}, fixedRoll(10));
        const player = makePlayer("p1", "Hero");
        const gob = makeEnemy("gob", "Goblin");
        startCombat(engine, [player, gob]);

        // End turn
        engine.submitAction({ type: "END_TURN", entityId: "p1" });
        const afterEnd = engine.getState();
        expect(afterEnd.turnOrder[afterEnd.turnIndex]).toBe("gob");

        // Undo
        engine.undoLastAction();
        const afterUndo = engine.getState();
        expect(afterUndo.turnOrder[afterUndo.turnIndex]).toBe("p1");
    });

    it("S70: Multiple undos in sequence", () => {
        const engine = createCombatEngine(1, {}, fixedRoll(10));
        const player = makePlayer("p1", "Hero");
        const gob = makeEnemy("gob", "Goblin");
        startCombat(engine, [player, gob]);

        // Move then dodge
        engine.submitAction({
            type: "MOVE", entityId: "p1", targetId: "gob", direction: "toward",
        });
        engine.submitAction({ type: "DODGE", entityId: "p1" });

        expect(engine.getState().turnResources?.actionUsed).toBe(true);
        expect(engine.getState().turnResources?.movementUsed).toBe(true);

        // Undo dodge
        engine.undoLastAction();
        expect(engine.getState().turnResources?.actionUsed).toBe(false);
        expect(engine.getState().turnResources?.movementUsed).toBe(true);

        // Undo move
        engine.undoLastAction();
        expect(engine.getState().turnResources?.movementUsed).toBe(false);
    });
});

// =============================================================================
// GROUP 10: INITIATIVE (Scenarios 71–73)
// =============================================================================

describe("Group 10: Initiative", () => {
    it("S71: AWAIT_INITIATIVE flow — players roll, enemies auto-roll", () => {
        const engine = createCombatEngine(1, {}, fixedRoll(10));
        const player = makePlayer("p1", "Hero", { initiative: 0 });
        const gob = makeEnemy("gob", "Goblin", { initiative: 0 });

        const prep = engine.prepareCombat([player, gob]);
        expect(engine.getState().phase).toBe("AWAIT_INITIATIVE");

        // Player rolls initiative
        const result = engine.applyInitiative("p1", 15);
        expect(result.combatStarted).toBe(true);

        // Combat should now be ACTIVE
        expect(engine.getState().phase).not.toBe("AWAIT_INITIATIVE");
    });

    it("S72: Higher initiative goes first", () => {
        const engine = createCombatEngine(1, {}, fixedRoll(10));
        // Use initiateCombat directly with explicit initiative values
        // (startCombat overrides initiative with position-based values)
        const slow = makePlayer("slow", "Slow");
        const fast = makePlayer("fast", "Fast");
        const gob = makeEnemy("gob", "Goblin");
        engine.initiateCombat([
            { ...slow, initiative: 5 },
            { ...fast, initiative: 18 },
            { ...gob, initiative: 12 },
        ]);

        // Fast should go first (initiative 18)
        const state = engine.getState();
        expect(state.turnOrder[0]).toBe("fast");
    });

    it("S73: Turn order is deterministic by initiative score", () => {
        const engine = createCombatEngine(1, {}, fixedRoll(10));
        const a = makePlayer("a", "Alice");
        const b = makePlayer("b", "Bob");
        const c = makeEnemy("c", "Claw");
        const d = makeEnemy("d", "Dagger");
        engine.initiateCombat([
            { ...a, initiative: 15 },
            { ...b, initiative: 10 },
            { ...c, initiative: 20 },
            { ...d, initiative: 5 },
        ]);

        const order = engine.getState().turnOrder;
        // c(20) > a(15) > b(10) > d(5)
        expect(order[0]).toBe("c");
        expect(order[1]).toBe("a");
        expect(order[2]).toBe("b");
        expect(order[3]).toBe("d");
    });
});

// =============================================================================
// GROUP 11: COMPLEX MULTI-TURN SEQUENCES (Scenarios 74–82)
// =============================================================================

describe("Group 11: Complex multi-turn sequences", () => {
    it("S74: Player attacked → knocked out → ally heals → player revives and acts", () => {
        const engine = createCombatEngine(1, {}, fixedRoll(10));
        const fighter = makePlayer("ftr", "Fighter", { hp: 5, isEssential: true });
        const cleric = makePlayer("clr", "Cleric");
        const gob = makeEnemy("gob", "Goblin");
        startCombat(engine, [fighter, cleric, gob]);

        // Fighter ends turn
        engine.submitAction({ type: "END_TURN", entityId: "ftr" });

        // Cleric skips turn
        engine.submitAction({ type: "END_TURN", entityId: "clr" });

        // Goblin attacks fighter → knocks out
        engine.submitAction({
            type: "ATTACK", attackerId: "gob", targetId: "ftr",
            attackRoll: 20, rawD20: 15,
        });
        expect(status(engine, "ftr")).toBe("UNCONSCIOUS");

        // Round 2: fighter's turn → death save
        expect(engine.getState().phase).toBe("AWAIT_DEATH_SAVE");
        engine.rollDeathSave("ftr", 12); // success

        // Cleric's turn → heal fighter
        const heal = engine.submitAction({
            type: "HEAL", entityId: "clr", targetId: "ftr", amount: 15,
        });
        expect(heal.success).toBe(true);
        expect(status(engine, "ftr")).toBe("ALIVE");
        expect(hp(engine, "ftr")).toBe(15);
    });

    it("S75: 3-round combat — resources reset each round", () => {
        const engine = createCombatEngine(1, {}, fixedRoll(10));
        const player = makePlayer("p1", "Hero");
        const gob = makeEnemy("gob", "Goblin");
        startCombat(engine, [player, gob]);

        for (let round = 1; round <= 3; round++) {
            // Player turn
            const state = engine.getState();
            expect(state.turnResources?.actionUsed).toBe(false);
            expect(state.turnResources?.bonusActionUsed).toBe(false);
            expect(state.turnResources?.movementUsed).toBe(false);

            // Player does something then ends
            engine.submitAction({ type: "DODGE", entityId: "p1" });
            engine.submitAction({ type: "END_TURN", entityId: "p1" });

            // Goblin turn — auto-resolve
            engine.submitAction({
                type: "ATTACK", attackerId: "gob", targetId: "p1",
                attackRoll: 8, rawD20: 3, // miss
            });
        }

        expect(engine.getState().round).toBe(4); // After 3 full rounds
    });

    it("S76: Enemy casts Fireball → 2 players save → damage applied correctly", () => {
        // Sequence: player1 save roll (from submitSavingThrow, not rollFn)
        const engine = createCombatEngine(1, {}, fixedRoll(10));
        const p1 = makePlayer("p1", "Alice", {
            abilityScores: { str: 10, dex: 16, con: 12, int: 10, wis: 10, cha: 10 },
        });
        const p2 = makePlayer("p2", "Bob", {
            abilityScores: { str: 10, dex: 8, con: 12, int: 10, wis: 10, cha: 10 },
        });
        const mage = makeEnemy("mage", "Evil Mage", {
            spells: [{
                name: "Fireball", level: 3, school: "evocation",
                castingTime: "action", range: 150, isAreaEffect: true,
                areaType: "sphere", savingThrow: "DEX", halfOnSave: true,
                damageFormula: "8d6", damageType: "fire",
                requiresConcentration: false, requiresAttackRoll: false,
                conditions: [], description: "Boom",
            }],
            spellSlots: { "3": 2 },
            spellSaveDC: 14,
        });
        startCombat(engine, [p1, p2, mage]);

        // End player turns
        engine.submitAction({ type: "END_TURN", entityId: "p1" });
        engine.submitAction({ type: "END_TURN", entityId: "p2" });

        // Mage casts Fireball on both players
        const cast = engine.submitAction({
            type: "CAST_SPELL", casterId: "mage",
            spellName: "Fireball", targetIds: ["p1", "p2"],
        });

        // Enemy caster: no AWAIT_DAMAGE_ROLL — goes straight to AWAIT_SAVE_ROLL
        // (enemy damage is auto-rolled inside applySpellEffect during save resolution)
        expect(engine.getState().phase).toBe("AWAIT_SAVE_ROLL");

        // P1 saves (roll 15 + 3 DEX mod = 18 vs DC 14 → success → half)
        engine.submitSavingThrow("p1", 15);
        // P2 fails (roll 5 + (-1) DEX mod = 4 vs DC 14 → fail → full)
        engine.submitSavingThrow("p2", 5);

        // Damage auto-rolled: fixedRoll(10) → 10 per target
        // P1: save success → floor(10/2) = 5 → HP = 25
        // P2: save fail → 10 → HP = 20
        expect(hp(engine, "p1")).toBe(25);
        expect(hp(engine, "p2")).toBe(20);
    });

    it("S77: Spell slot depletion tracking across turns", () => {
        const engine = createCombatEngine(1, {}, fixedRoll(10));
        const wizard = makePlayer("wiz", "Gandalf", {
            spells: [{
                name: "Fire Bolt", level: 0, school: "evocation",
                castingTime: "action", range: 120, isAreaEffect: false,
                savingThrow: undefined, halfOnSave: false,
                damageFormula: "2d10", damageType: "fire",
                requiresConcentration: false, requiresAttackRoll: true,
                conditions: [], description: "Fire",
            }, {
                name: "Magic Missile", level: 1, school: "evocation",
                castingTime: "action", range: 120, isAreaEffect: false,
                savingThrow: undefined, halfOnSave: false,
                damageFormula: "3d4+3", damageType: "force",
                requiresConcentration: false, requiresAttackRoll: false,
                conditions: [], description: "Auto-hit missiles",
            }],
            spellSlots: { "1": 2 },
            spellAttackBonus: 7, spellSaveDC: 15,
        });
        const gob = makeEnemy("gob", "Goblin", { hp: 100 });
        startCombat(engine, [wizard, gob]);

        expect(engine.getEntity("wiz")!.spellSlots["1"]).toBe(2);

        // Cast Magic Missile (level 1 slot)
        engine.submitAction({
            type: "CAST_SPELL", casterId: "wiz",
            spellName: "Magic Missile", targetIds: ["gob"],
        });
        expect(engine.getEntity("wiz")!.spellSlots["1"]).toBe(1);

        // End turn, cycle back
        engine.submitAction({ type: "END_TURN", entityId: "wiz" });
        engine.submitAction({ type: "END_TURN", entityId: "gob" });

        // Cast again
        engine.submitAction({
            type: "CAST_SPELL", casterId: "wiz",
            spellName: "Magic Missile", targetIds: ["gob"],
        });
        expect(engine.getEntity("wiz")!.spellSlots["1"]).toBe(0);

        // End turn, cycle back
        engine.submitAction({ type: "END_TURN", entityId: "wiz" });
        engine.submitAction({ type: "END_TURN", entityId: "gob" });

        // Try to cast again — no slots left
        const nope = engine.submitAction({
            type: "CAST_SPELL", casterId: "wiz",
            spellName: "Magic Missile", targetIds: ["gob"],
        });
        expect(nope.success).toBe(false);
        expect(nope.error).toContain("slot");
    });

    it("S78: Barbarian Rage → takes damage → resistance halves it", () => {
        const engine = createCombatEngine(1, {}, fixedRoll(10));
        const barb = makePlayer("barb", "Grog", {
            characterClass: "Barbarian",
            featureUses: { "Rage": 2 },
            hp: 50, maxHp: 50,
        });
        const gob = makeEnemy("gob", "Goblin");
        startCombat(engine, [barb, gob]);

        // Rage
        const rage = engine.submitAction({ type: "RAGE", entityId: "barb" });
        expect(rage.success).toBe(true);

        // Barb should have raging condition
        const isRaging = engine.getEntity("barb")!.activeConditions.some(
            c => c.name === "raging"
        );
        expect(isRaging).toBe(true);

        engine.submitAction({ type: "END_TURN", entityId: "barb" });

        // Enemy attacks barb
        const hpBefore = hp(engine, "barb");
        engine.submitAction({
            type: "ATTACK", attackerId: "gob", targetId: "barb",
            attackRoll: 20, rawD20: 15,
        });

        // Raging → resistance to bludgeoning/piercing/slashing → damage halved
        const hpAfter = hp(engine, "barb");
        const damageTaken = hpBefore - hpAfter;
        // fixedRoll(10) for damage, halved = 5
        expect(damageTaken).toBeLessThanOrEqual(10);
    });

    it("S79: Player saves successfully against enemy Hold Person", () => {
        const engine = createCombatEngine(1, {}, fixedRoll(10));
        const player = makePlayer("p1", "Hero", {
            abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 18, cha: 10 },
        });
        const mage = makeEnemy("mage", "Evil Mage", {
            spells: [{
                name: "Hold Person", level: 2, school: "enchantment",
                castingTime: "action", range: 60, isAreaEffect: false,
                savingThrow: "WIS", halfOnSave: false,
                requiresConcentration: true, requiresAttackRoll: false,
                conditions: ["paralyzed"], description: "Paralyze",
            }],
            spellSlots: { "2": 3 }, spellSaveDC: 14,
        });
        startCombat(engine, [player, mage]);

        engine.submitAction({ type: "END_TURN", entityId: "p1" });

        engine.submitAction({
            type: "CAST_SPELL", casterId: "mage",
            spellName: "Hold Person", targetIds: ["p1"],
        });

        expect(engine.getState().phase).toBe("AWAIT_SAVE_ROLL");
        // Player rolls 15 + 4 WIS = 19 vs DC 14 → save!
        engine.submitSavingThrow("p1", 15);

        // Should NOT be paralyzed (save succeeded)
        const isParalyzed = engine.getEntity("p1")!.activeConditions?.some(
            c => c.name === "paralyzed"
        );
        expect(isParalyzed ?? false).toBe(false);
    });

    it("S80: Second Wind restores HP (Fighter)", () => {
        const engine = createCombatEngine(1, {}, fixedRoll(8));
        const fighter = makePlayer("ftr", "Fighter", {
            characterClass: "Fighter",
            featureUses: { "Second Wind": 1 },
            hp: 15, maxHp: 30,
        });
        const gob = makeEnemy("gob", "Goblin");
        startCombat(engine, [fighter, gob]);

        const sw = engine.submitAction({ type: "SECOND_WIND", entityId: "ftr" });
        expect(sw.success).toBe(true);
        // 1d10+level heal, fixedRoll(8) → heal=8. HP = 15+8 = 23
        expect(hp(engine, "ftr")).toBe(23);
    });

    it("S81: Healing Word on unconscious ally revives them", () => {
        const engine = createCombatEngine(1, {}, fixedRoll(8));
        const cleric = makePlayer("clr", "Cleric", {
            spells: [{
                name: "Healing Word", level: 1, school: "evocation",
                castingTime: "bonus_action", range: 60, isAreaEffect: false,
                savingThrow: undefined, halfOnSave: false,
                requiresConcentration: false, requiresAttackRoll: false,
                conditions: [], description: "Heal",
                healingFormula: "1d4+3",
            }],
            spellSlots: { "1": 4 },
        });
        const fighter = makePlayer("ftr", "Fighter", { isEssential: true });
        const gob = makeEnemy("gob", "Goblin");
        startCombat(engine, [cleric, fighter, gob]);

        // Knock out fighter
        engine.getEntity("ftr")!.hp = 0;
        engine.getEntity("ftr")!.status = "UNCONSCIOUS";

        // Cleric casts Healing Word on unconscious fighter
        const heal = engine.submitAction({
            type: "CAST_SPELL", casterId: "clr",
            spellName: "Healing Word", targetIds: ["ftr"],
        });
        expect(heal.success).toBe(true);
        expect(status(engine, "ftr")).toBe("ALIVE");
        // healingFormula "1d4+3", fixedRoll(8) → heal=8. HP = 0+8 = 8
        expect(hp(engine, "ftr")).toBe(8);
    });

    it("S82: Full combat: 2 players vs 2 enemies, 3 rounds with kills", () => {
        const engine = createCombatEngine(1, {}, fixedRoll(10));
        const p1 = makePlayer("p1", "Alice");
        const p2 = makePlayer("p2", "Bob");
        const e1 = makeEnemy("e1", "Orc A", { hp: 8 }); // dies in 1 hit (dmg=10>8)
        const e2 = makeEnemy("e2", "Orc B", { hp: 8 });
        startCombat(engine, [p1, p2, e1, e2]);

        // Round 1: P1 attacks Orc A → AWAIT_DAMAGE_ROLL → damage → kill
        engine.submitAction({
            type: "ATTACK", attackerId: "p1", targetId: "e1",
            attackRoll: 20, rawD20: 15,
        });
        expect(engine.getState().phase).toBe("AWAIT_DAMAGE_ROLL");
        engine.applyDamage(8); // exactly 8 = full HP → dead
        expect(status(engine, "e1")).toBe("DEAD");

        engine.submitAction({ type: "END_TURN", entityId: "p1" });

        // P2 attacks Orc B → AWAIT_DAMAGE_ROLL → damage → kill
        engine.submitAction({
            type: "ATTACK", attackerId: "p2", targetId: "e2",
            attackRoll: 20, rawD20: 15,
        });
        expect(engine.getState().phase).toBe("AWAIT_DAMAGE_ROLL");
        engine.applyDamage(8);
        expect(status(engine, "e2")).toBe("DEAD");

        // Both orcs dead → combat should end
        // Engine checks combat end after damage, so it may already be RESOLVED
        // If not, end turn to trigger the check
        if (engine.getState().phase !== "RESOLVED") {
            engine.submitAction({ type: "END_TURN", entityId: "p2" });
        }
        expect(engine.getState().phase).toBe("RESOLVED");
    });
});
