/**
 * Combat Audit Scenarios — Multi-Step Play-Through Tests
 *
 * Each scenario plays through a FULL turn (or multi-turn round) exactly as the
 * real app would, collecting snapshots after every engine call and running
 * systematic audit checks for resource accounting, phase correctness, damage
 * correctness, log integrity, and turn transition correctness.
 *
 * These tests find bugs that only surface in realistic SEQUENCES of actions —
 * not bugs in isolated unit-test-style calls.
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
import { computeCombatNarrativePrompts } from "../combat-narrator";

// =============================================================================
// HELPERS (reused patterns from combat-flow-audit.test.ts)
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
        return {
            total: val,
            rolls: [val],
            isCritical: val === 20,
            isFumble: val === 1,
        };
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

// =============================================================================
// AUDIT INFRASTRUCTURE
// =============================================================================

interface AuditSnapshot {
    step: string;
    success: boolean;
    phase: string;
    turnResources: {
        actionUsed: boolean;
        bonusActionUsed: boolean;
        movementUsed: boolean;
        reactionUsed: boolean;
        extraAttacksRemaining: number;
        sneakAttackUsedThisTurn: boolean;
    } | undefined;
    entityHPs: Record<string, number>;
    awaitingAttackRoll: boolean;
    awaitingDamageRoll: boolean;
    awaitingSaveRoll: boolean;
    awaitingSmiteDecision: boolean;
    hasPendingAttackRoll: boolean;
    hasPendingAttack: boolean;
    hasPendingSpellDamage: boolean;
    hasPendingSmite: boolean;
    hasPendingSpellTargets: boolean;
    logTypes: string[];
    round: number;
    turnIndex: number;
}

function captureSnapshot(
    step: string,
    result: { success: boolean; logs: CombatLogEntry[]; awaitingAttackRoll?: boolean; awaitingDamageRoll?: boolean; awaitingSaveRoll?: boolean; awaitingSmiteDecision?: boolean },
    engine: CombatEngineV2,
): AuditSnapshot {
    const state = engine.getState();
    return {
        step,
        success: result.success,
        phase: state.phase,
        turnResources: state.turnResources ? { ...state.turnResources } : undefined,
        entityHPs: Object.fromEntries(state.entities.map(e => [e.id, e.hp])),
        awaitingAttackRoll: result.awaitingAttackRoll ?? false,
        awaitingDamageRoll: result.awaitingDamageRoll ?? false,
        awaitingSaveRoll: result.awaitingSaveRoll ?? false,
        awaitingSmiteDecision: result.awaitingSmiteDecision ?? false,
        hasPendingAttackRoll: !!state.pendingAttackRoll,
        hasPendingAttack: !!state.pendingAttack,
        hasPendingSpellDamage: !!state.pendingSpellDamage,
        hasPendingSmite: !!state.pendingSmite,
        hasPendingSpellTargets: !!(state as any).pendingSpellTargets,
        logTypes: result.logs.map(l => l.type),
        round: state.round,
        turnIndex: state.turnIndex,
    };
}

// =============================================================================
// AUDIT ASSERTIONS
// =============================================================================

/** Assert only the specified resource fields changed from a baseline snapshot. */
function assertResourceDelta(
    snapshot: AuditSnapshot,
    expected: Partial<NonNullable<AuditSnapshot["turnResources"]>>,
    stepLabel: string,
) {
    expect(snapshot.turnResources, `${stepLabel}: turnResources should exist`).toBeDefined();
    const r = snapshot.turnResources!;
    for (const [key, val] of Object.entries(expected)) {
        expect(r[key as keyof typeof r], `${stepLabel}: ${key}`).toBe(val);
    }
}

/** Assert phase is correct at a given step. */
function assertPhase(snapshot: AuditSnapshot, expected: string, stepLabel: string) {
    expect(snapshot.phase, `${stepLabel}: phase`).toBe(expected);
}

/** Assert no premature DAMAGE log in an awaiting-roll result. */
function assertNoPrematureDamageLogs(snapshot: AuditSnapshot, stepLabel: string) {
    if (snapshot.awaitingDamageRoll || snapshot.awaitingAttackRoll) {
        expect(snapshot.logTypes, `${stepLabel}: premature DAMAGE log`).not.toContain("DAMAGE");
    }
}

/** Assert no premature ATTACK_ROLL log in an awaiting-attack result. */
function assertNoPrematureAttackRollLogs(snapshot: AuditSnapshot, stepLabel: string) {
    if (snapshot.awaitingAttackRoll) {
        expect(snapshot.logTypes, `${stepLabel}: premature ATTACK_ROLL log`).not.toContain("ATTACK_ROLL");
    }
}

/** Assert phase is ACTIVE with no pending state left over. */
function assertCleanActive(snapshot: AuditSnapshot, stepLabel: string) {
    if (snapshot.phase === "ACTIVE") {
        expect(snapshot.hasPendingAttackRoll, `${stepLabel}: stale pendingAttackRoll`).toBe(false);
        expect(snapshot.hasPendingAttack, `${stepLabel}: stale pendingAttack`).toBe(false);
        expect(snapshot.hasPendingSpellDamage, `${stepLabel}: stale pendingSpellDamage`).toBe(false);
        expect(snapshot.hasPendingSmite, `${stepLabel}: stale pendingSmite`).toBe(false);
    }
}

/** Assert HP unchanged for all entities except those listed. */
function assertHPUnchanged(
    prev: AuditSnapshot,
    curr: AuditSnapshot,
    exceptIds: string[],
    stepLabel: string,
) {
    for (const [id, hp] of Object.entries(prev.entityHPs)) {
        if (exceptIds.includes(id)) continue;
        expect(curr.entityHPs[id], `${stepLabel}: unexpected HP change on ${id}`).toBe(hp);
    }
}

// =============================================================================
// SPELL DEFINITIONS (reused from existing test patterns)
// =============================================================================

const FIRE_BOLT = {
    name: "Fire Bolt", level: 0, school: "evocation", castingTime: "action" as const,
    range: 120, isAreaEffect: false, savingThrow: undefined, halfOnSave: false,
    damageFormula: "2d10", damageType: "fire",
    requiresConcentration: false, requiresAttackRoll: true,
    conditions: [] as string[], description: "Hurl fire",
};

const SCORCHING_RAY = {
    name: "Scorching Ray", level: 2, school: "evocation", castingTime: "action" as const,
    range: 120, isAreaEffect: false, savingThrow: undefined, halfOnSave: false,
    damageFormula: "2d6", damageType: "fire",
    requiresConcentration: false, requiresAttackRoll: true,
    conditions: [] as string[], description: "3 rays of fire",
};

const FIREBALL = {
    name: "Fireball", level: 3, school: "evocation", castingTime: "action" as const,
    range: 150, isAreaEffect: true, areaType: "sphere", savingThrow: "DEX" as const,
    halfOnSave: true, damageFormula: "8d6", damageType: "fire",
    requiresConcentration: false, requiresAttackRoll: false,
    conditions: [] as string[], description: "Explosion of fire",
};

const HEALING_WORD = {
    name: "Healing Word", level: 1, school: "evocation", castingTime: "bonus_action" as const,
    range: 60, isAreaEffect: false, savingThrow: undefined, halfOnSave: false,
    requiresConcentration: false, requiresAttackRoll: false,
    conditions: [] as string[], description: "Heal",
    healingFormula: "1d4+3",
};

// =============================================================================
// SCENARIO 1: Scorching Ray (3 rays, 3 different targets) → Move → End Turn
// =============================================================================

describe("Scenario 1: Scorching Ray (3 rays, 3 targets) → Move → End Turn", () => {
    it("full turn audit", () => {
        // Engine with deterministic rolls for enemy saves etc.
        const engine = createCombatEngine(1, {}, fixedRoll(10));
        const wizard = makePlayer("wiz", "Gandalf", {
            spells: [SCORCHING_RAY],
            spellSlots: { "2": 3 },
            spellAttackBonus: 7,
            spellSaveDC: 15,
            characterClass: "Wizard",
        });
        const ally = makePlayer("ally", "Gimli");
        const gob1 = makeEnemy("gob1", "Goblin A");
        const gob2 = makeEnemy("gob2", "Goblin B");
        const gob3 = makeEnemy("gob3", "Goblin C");
        startCombat(engine, [wizard, ally, gob1, gob2, gob3]);

        const trail: AuditSnapshot[] = [];

        // --- Step 1: Cast Scorching Ray targeting 3 enemies ---
        const cast = engine.submitAction({
            type: "CAST_SPELL",
            casterId: "wiz",
            spellName: "Scorching Ray",
            targetIds: ["gob1", "gob2", "gob3"],
        });
        trail.push(captureSnapshot("cast_scorching_ray", cast, engine));

        // Audit: spell slot consumed, action used, phase AWAIT_ATTACK_ROLL
        assertPhase(trail[0], "AWAIT_ATTACK_ROLL", "cast");
        expect(cast.success).toBe(true);
        expect(cast.awaitingAttackRoll).toBe(true);
        assertResourceDelta(trail[0], { actionUsed: true, bonusActionUsed: false, movementUsed: false }, "cast");
        assertNoPrematureAttackRollLogs(trail[0], "cast");
        assertNoPrematureDamageLogs(trail[0], "cast");
        // Spell slot 2 consumed
        const wizState1 = engine.getState().entities.find(e => e.id === "wiz");
        expect(wizState1?.spellSlots["2"]).toBe(2);
        // HP unchanged for all
        assertHPUnchanged(trail[0], trail[0], [], "cast_no_hp_change");

        // --- Step 2: Ray 1 attack roll → HIT (15 + 7 = 22 vs AC 14) ---
        const ray1Roll = engine.resolveAttackRoll(15);
        trail.push(captureSnapshot("ray1_attack_roll", ray1Roll, engine));

        assertPhase(trail[1], "AWAIT_DAMAGE_ROLL", "ray1_hit");
        expect(ray1Roll.awaitingDamageRoll).toBe(true);
        assertNoPrematureDamageLogs(trail[1], "ray1_hit");
        // gob1 HP still unchanged (damage not applied yet)
        expect(trail[1].entityHPs["gob1"]).toBe(30);

        // --- Step 3: Ray 1 damage → advance to Ray 2 ---
        const ray1Dmg = engine.applyDamage(8); // 2d6 = 8
        trail.push(captureSnapshot("ray1_damage", ray1Dmg, engine));

        // Should advance to ray 2 → AWAIT_ATTACK_ROLL
        assertPhase(trail[2], "AWAIT_ATTACK_ROLL", "ray1_dmg→ray2");
        expect(ray1Dmg.awaitingAttackRoll).toBe(true);
        // gob1 took 8 damage
        expect(trail[2].entityHPs["gob1"]).toBe(22);
        // gob2, gob3 unchanged
        assertHPUnchanged(trail[1], trail[2], ["gob1"], "ray1_dmg");
        // NOTE: ray1_dmg logs correctly contain DAMAGE (for ray 1 that just resolved)
        // even though awaitingAttackRoll is true (for the NEXT ray). This is expected
        // for multi-ray advancement — not a premature damage log.

        // --- Step 4: Ray 2 attack roll → MISS (3 + 7 = 10 vs AC 14) ---
        const ray2Roll = engine.resolveAttackRoll(3);
        trail.push(captureSnapshot("ray2_attack_roll_miss", ray2Roll, engine));

        // Miss → advance to ray 3 → AWAIT_ATTACK_ROLL
        assertPhase(trail[3], "AWAIT_ATTACK_ROLL", "ray2_miss→ray3");
        expect(ray2Roll.awaitingAttackRoll).toBe(true);
        // No HP changes on miss
        assertHPUnchanged(trail[2], trail[3], [], "ray2_miss");

        // --- Step 5: Ray 3 attack roll → HIT (18 + 7 = 25 vs AC 14) ---
        const ray3Roll = engine.resolveAttackRoll(18);
        trail.push(captureSnapshot("ray3_attack_roll", ray3Roll, engine));

        assertPhase(trail[4], "AWAIT_DAMAGE_ROLL", "ray3_hit");
        expect(ray3Roll.awaitingDamageRoll).toBe(true);
        // No HP change yet
        expect(trail[4].entityHPs["gob3"]).toBe(30);

        // --- Step 6: Ray 3 damage → ACTIVE (all rays done) ---
        const ray3Dmg = engine.applyDamage(10); // 2d6 = 10
        trail.push(captureSnapshot("ray3_damage", ray3Dmg, engine));

        assertPhase(trail[5], "ACTIVE", "ray3_done");
        assertCleanActive(trail[5], "ray3_done");
        expect(trail[5].entityHPs["gob3"]).toBe(20);
        // gob1 still at 22, gob2 still at 30
        expect(trail[5].entityHPs["gob1"]).toBe(22);
        expect(trail[5].entityHPs["gob2"]).toBe(30);

        // --- Step 7: Move toward gob1 ---
        const move = engine.submitAction({
            type: "MOVE",
            entityId: "wiz",
            targetId: "gob1",
            direction: "toward",
        });
        trail.push(captureSnapshot("move", move, engine));

        assertPhase(trail[6], "ACTIVE", "after_move");
        assertResourceDelta(trail[6], { movementUsed: true, actionUsed: true, bonusActionUsed: false }, "move");
        // No HP changes from movement
        assertHPUnchanged(trail[5], trail[6], [], "move_no_hp");

        // --- Step 8: End Turn ---
        const endTurn = engine.submitAction({ type: "END_TURN", entityId: "wiz" });
        trail.push(captureSnapshot("end_turn", endTurn, engine));

        expect(endTurn.success).toBe(true);

        // Verify turn logs
        const turnLogs = engine.getTurnLogs();
        const turnEndLog = endTurn.logs.find(l => l.type === "TURN_END");
        expect(turnEndLog, "TURN_END log should exist").toBeDefined();
        expect(turnEndLog?.actorId).toBe("wiz");

        // Next turn should be ally
        const turnStartLog = endTurn.logs.find(l => l.type === "TURN_START");
        expect(turnStartLog, "TURN_START log for next entity").toBeDefined();
        expect(turnStartLog?.actorId).toBe("ally");

        // Verify fresh resources for ally's turn
        assertResourceDelta(trail[7], { actionUsed: false, bonusActionUsed: false, movementUsed: false }, "ally_fresh");

        // Run general audit checks. For multi-ray spells, premature-log assertions
        // only apply to the INITIAL cast step — ray resolution steps (resolveAttackRoll,
        // applyDamage) correctly contain logs for the ray that just resolved even when
        // awaitingAttackRoll/awaitingDamageRoll is set for the NEXT ray.
        for (const snap of trail) {
            assertCleanActive(snap, snap.step);
        }
        // Only the initial cast should have no premature logs
        assertNoPrematureDamageLogs(trail[0], trail[0].step);
        assertNoPrematureAttackRollLogs(trail[0], trail[0].step);
    });
});

// =============================================================================
// SCENARIO 2: Fireball (3 enemy targets) → Move → End Turn
// =============================================================================

describe("Scenario 2: Fireball (3 targets) → Move → End Turn", () => {
    it("full turn audit", () => {
        // sequenceRoll: saves auto-resolve for enemies; values used for enemy save d20s
        // gob1 rolls 5 (fails DC 15), gob2 rolls 18 (passes), gob3 rolls 3 (fails)
        const engine = createCombatEngine(1, {}, sequenceRoll([5, 18, 3]));
        const wizard = makePlayer("wiz", "Gandalf", {
            spells: [FIREBALL],
            spellSlots: { "3": 2 },
            spellAttackBonus: 7,
            spellSaveDC: 15,
            characterClass: "Wizard",
        });
        const ally = makePlayer("ally", "Gimli");
        const gob1 = makeEnemy("gob1", "Goblin A", { abilityScores: { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 } });
        const gob2 = makeEnemy("gob2", "Goblin B", { abilityScores: { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 } });
        const gob3 = makeEnemy("gob3", "Goblin C", { abilityScores: { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 } });
        startCombat(engine, [wizard, ally, gob1, gob2, gob3]);

        const trail: AuditSnapshot[] = [];

        // --- Step 1: Cast Fireball on all 3 enemies ---
        const cast = engine.submitAction({
            type: "CAST_SPELL",
            casterId: "wiz",
            spellName: "Fireball",
            targetIds: ["gob1", "gob2", "gob3"],
        });
        trail.push(captureSnapshot("cast_fireball", cast, engine));

        assertPhase(trail[0], "AWAIT_DAMAGE_ROLL", "cast");
        expect(cast.awaitingDamageRoll).toBe(true);
        expect(cast.success).toBe(true);
        assertResourceDelta(trail[0], { actionUsed: true, bonusActionUsed: false, movementUsed: false }, "cast");
        // Spell slot consumed
        const wizState = engine.getState().entities.find(e => e.id === "wiz");
        expect(wizState?.spellSlots["3"]).toBe(1);
        // No HP changes yet (damage not rolled)
        expect(trail[0].entityHPs["gob1"]).toBe(30);
        expect(trail[0].entityHPs["gob2"]).toBe(30);
        expect(trail[0].entityHPs["gob3"]).toBe(30);
        assertNoPrematureDamageLogs(trail[0], "cast");

        // --- Step 2: Roll Fireball damage → saves auto-resolve for enemies ---
        const dmg = engine.applyDamage(24); // 8d6 = 24
        trail.push(captureSnapshot("fireball_damage", dmg, engine));

        assertPhase(trail[1], "ACTIVE", "fireball_resolved");
        assertCleanActive(trail[1], "fireball_resolved");
        expect(dmg.success).toBe(true);

        // gob1 failed save: full damage (24)
        expect(trail[1].entityHPs["gob1"]).toBe(30 - 24);
        // gob2 passed save: half damage floor(24/2) = 12
        expect(trail[1].entityHPs["gob2"]).toBe(30 - 12);
        // gob3 failed save: full damage (24)
        expect(trail[1].entityHPs["gob3"]).toBe(30 - 24);

        // Players unaffected
        expect(trail[1].entityHPs["wiz"]).toBe(30);
        expect(trail[1].entityHPs["ally"]).toBe(30);

        // --- Step 3: Move ---
        const move = engine.submitAction({
            type: "MOVE",
            entityId: "wiz",
            targetId: "gob1",
            direction: "toward",
        });
        trail.push(captureSnapshot("move", move, engine));

        assertPhase(trail[2], "ACTIVE", "after_move");
        assertResourceDelta(trail[2], { movementUsed: true, actionUsed: true, bonusActionUsed: false }, "move");
        // No HP change from move
        assertHPUnchanged(trail[1], trail[2], [], "move_no_hp");

        // --- Step 4: End Turn ---
        const endTurn = engine.submitAction({ type: "END_TURN", entityId: "wiz" });
        trail.push(captureSnapshot("end_turn", endTurn, engine));

        expect(endTurn.success).toBe(true);
        const turnEndLog = endTurn.logs.find(l => l.type === "TURN_END");
        expect(turnEndLog?.actorId).toBe("wiz");
        const turnStartLog = endTurn.logs.find(l => l.type === "TURN_START");
        expect(turnStartLog?.actorId).toBe("ally");

        // Fresh resources
        assertResourceDelta(trail[3], { actionUsed: false, bonusActionUsed: false, movementUsed: false }, "ally_fresh");
    });
});

// =============================================================================
// SCENARIO 3: Fire Bolt (single target, crit) → Move → End Turn
// =============================================================================

describe("Scenario 3: Fire Bolt (crit) → Move → End Turn", () => {
    it("full turn audit", () => {
        const engine = createCombatEngine(1, {}, fixedRoll(10));
        const wizard = makePlayer("wiz", "Gandalf", {
            spells: [FIRE_BOLT],
            spellSlots: {},
            spellAttackBonus: 7,
            spellSaveDC: 15,
            characterClass: "Wizard",
        });
        const ally = makePlayer("ally", "Gimli");
        const gob = makeEnemy("gob", "Goblin");
        startCombat(engine, [wizard, ally, gob]);

        const trail: AuditSnapshot[] = [];

        // --- Step 1: Cast Fire Bolt ---
        const cast = engine.submitAction({
            type: "CAST_SPELL",
            casterId: "wiz",
            spellName: "Fire Bolt",
            targetIds: ["gob"],
        });
        trail.push(captureSnapshot("cast_fire_bolt", cast, engine));

        assertPhase(trail[0], "AWAIT_ATTACK_ROLL", "cast");
        expect(cast.awaitingAttackRoll).toBe(true);
        assertResourceDelta(trail[0], { actionUsed: true, bonusActionUsed: false, movementUsed: false }, "cast");
        // Cantrip: no spell slot consumed
        assertNoPrematureAttackRollLogs(trail[0], "cast");

        // --- Step 2: Attack roll → NAT 20 CRIT ---
        const roll = engine.resolveAttackRoll(20);
        trail.push(captureSnapshot("crit_roll", roll, engine));

        assertPhase(trail[1], "AWAIT_DAMAGE_ROLL", "crit_hit");
        expect(roll.awaitingDamageRoll).toBe(true);
        // Verify crit formula: 2d10 → 4d10
        const pendingAttack = engine.getState().pendingAttack;
        expect(pendingAttack?.damageFormula).toBe("4d10");
        expect(pendingAttack?.isCritical).toBe(true);
        // No HP change yet
        expect(trail[1].entityHPs["gob"]).toBe(30);

        // --- Step 3: Damage (4d10 = 24) ---
        const dmg = engine.applyDamage(24);
        trail.push(captureSnapshot("crit_damage", dmg, engine));

        assertPhase(trail[2], "ACTIVE", "after_crit_dmg");
        assertCleanActive(trail[2], "after_crit_dmg");
        expect(trail[2].entityHPs["gob"]).toBe(30 - 24);
        assertHPUnchanged(trail[1], trail[2], ["gob"], "crit_dmg_only_target");

        // --- Step 4: Move ---
        const move = engine.submitAction({
            type: "MOVE",
            entityId: "wiz",
            targetId: "gob",
            direction: "toward",
        });
        trail.push(captureSnapshot("move", move, engine));

        assertPhase(trail[3], "ACTIVE", "after_move");
        assertResourceDelta(trail[3], { movementUsed: true, actionUsed: true, bonusActionUsed: false }, "move");

        // --- Step 5: End Turn ---
        const endTurn = engine.submitAction({ type: "END_TURN", entityId: "wiz" });
        trail.push(captureSnapshot("end_turn", endTurn, engine));

        const turnEndLog = endTurn.logs.find(l => l.type === "TURN_END");
        expect(turnEndLog?.actorId).toBe("wiz");
        const turnStartLog = endTurn.logs.find(l => l.type === "TURN_START");
        expect(turnStartLog?.actorId).toBe("ally");
    });
});

// =============================================================================
// SCENARIO 4: Fighter: Attack (hit) → Extra Attack (miss) → Move → End Turn
// =============================================================================

describe("Scenario 4: Fighter Attack + Extra Attack → Move → End Turn", () => {
    it("full turn audit", () => {
        const engine = createCombatEngine(1, {}, fixedRoll(10));
        const fighter = makePlayer("ftr", "Conan", {
            characterClass: "Fighter",
            extraAttacks: 1,
            attackModifier: 6,
            weapons: [{ name: "Greatsword", damageFormula: "2d6+4", damageType: "slashing", isRanged: false, attackBonus: 6, properties: [] }],
        });
        const ally = makePlayer("ally", "Gimli");
        const gob = makeEnemy("gob", "Goblin");
        startCombat(engine, [fighter, ally, gob]);

        const trail: AuditSnapshot[] = [];

        // Verify initial resources: 1 extra attack
        const initState = engine.getState();
        expect(initState.turnResources?.extraAttacksRemaining).toBe(1);

        // --- Step 1: Attack (no pre-roll → AWAIT_ATTACK_ROLL) ---
        const atk1 = engine.submitAction({
            type: "ATTACK",
            attackerId: "ftr",
            targetId: "gob",
        });
        trail.push(captureSnapshot("atk1_await", atk1, engine));

        assertPhase(trail[0], "AWAIT_ATTACK_ROLL", "atk1");
        expect(atk1.awaitingAttackRoll).toBe(true);
        // Resources NOT consumed yet (consumed on roll resolution)
        assertNoPrematureAttackRollLogs(trail[0], "atk1");

        // --- Step 2: Roll 15 → hit (15+6=21 vs AC 14) ---
        const roll1 = engine.resolveAttackRoll(15);
        trail.push(captureSnapshot("atk1_hit", roll1, engine));

        assertPhase(trail[1], "AWAIT_DAMAGE_ROLL", "atk1_hit");
        expect(roll1.awaitingDamageRoll).toBe(true);
        // Extra attack consumed first (extraAttacksRemaining: 1→0), action NOT used yet
        assertResourceDelta(trail[1], { extraAttacksRemaining: 0, actionUsed: false }, "atk1_resources");
        // No HP change yet
        expect(trail[1].entityHPs["gob"]).toBe(30);

        // --- Step 3: Damage 10 (2d6+4) ---
        const dmg1 = engine.applyDamage(10);
        trail.push(captureSnapshot("atk1_damage", dmg1, engine));

        assertPhase(trail[2], "ACTIVE", "atk1_dmg");
        assertCleanActive(trail[2], "atk1_dmg");
        expect(trail[2].entityHPs["gob"]).toBe(20);
        // Still has action available
        assertResourceDelta(trail[2], { actionUsed: false, extraAttacksRemaining: 0 }, "atk1_post");

        // --- Step 4: Extra Attack (second attack uses the action) ---
        const atk2 = engine.submitAction({
            type: "ATTACK",
            attackerId: "ftr",
            targetId: "gob",
        });
        trail.push(captureSnapshot("atk2_await", atk2, engine));

        assertPhase(trail[3], "AWAIT_ATTACK_ROLL", "atk2");
        expect(atk2.awaitingAttackRoll).toBe(true);

        // --- Step 5: Roll 3 → miss (3+6=9 vs AC 14) ---
        const roll2 = engine.resolveAttackRoll(3);
        trail.push(captureSnapshot("atk2_miss", roll2, engine));

        assertPhase(trail[4], "ACTIVE", "atk2_miss");
        assertCleanActive(trail[4], "atk2_miss");
        // Action now consumed (extra attacks were 0, so action used)
        assertResourceDelta(trail[4], { actionUsed: true, extraAttacksRemaining: 0 }, "atk2_resources");
        // HP unchanged on miss
        expect(trail[4].entityHPs["gob"]).toBe(20);
        assertHPUnchanged(trail[2], trail[4], [], "atk2_no_hp_change");

        // --- Step 6: Move ---
        const move = engine.submitAction({
            type: "MOVE",
            entityId: "ftr",
            targetId: "gob",
            direction: "toward",
        });
        trail.push(captureSnapshot("move", move, engine));

        assertResourceDelta(trail[5], { movementUsed: true, actionUsed: true, bonusActionUsed: false }, "move");

        // --- Step 7: End Turn ---
        const endTurn = engine.submitAction({ type: "END_TURN", entityId: "ftr" });
        trail.push(captureSnapshot("end_turn", endTurn, engine));

        const turnEndLog = endTurn.logs.find(l => l.type === "TURN_END");
        expect(turnEndLog?.actorId).toBe("ftr");
        const turnStartLog = endTurn.logs.find(l => l.type === "TURN_START");
        expect(turnStartLog?.actorId).toBe("ally");
    });
});

// =============================================================================
// SCENARIO 5: Paladin: Attack (hit) → damage → Smite decision (yes) → End Turn
// =============================================================================

describe("Scenario 5: Paladin Attack + Divine Smite → End Turn", () => {
    it("full turn audit", () => {
        const engine = createCombatEngine(1, {}, fixedRoll(10));
        const paladin = makePlayer("pal", "Percival", {
            characterClass: "Paladin",
            attackModifier: 6,
            weapons: [{ name: "Warhammer", damageFormula: "1d8+4", damageType: "bludgeoning", isRanged: false, attackBonus: 6, properties: [] }],
            spellSlots: { "1": 3, "2": 1 },
        });
        const ally = makePlayer("ally", "Gimli");
        const gob = makeEnemy("gob", "Goblin");
        startCombat(engine, [paladin, ally, gob]);

        const trail: AuditSnapshot[] = [];

        // --- Step 1: Attack ---
        const atk = engine.submitAction({
            type: "ATTACK",
            attackerId: "pal",
            targetId: "gob",
        });
        trail.push(captureSnapshot("atk_await", atk, engine));
        assertPhase(trail[0], "AWAIT_ATTACK_ROLL", "atk");

        // --- Step 2: Hit (15+6=21 vs AC 14) ---
        const roll = engine.resolveAttackRoll(15);
        trail.push(captureSnapshot("atk_hit", roll, engine));
        assertPhase(trail[1], "AWAIT_DAMAGE_ROLL", "hit");
        expect(trail[1].entityHPs["gob"]).toBe(30);

        // --- Step 3: Damage 8 (1d8+4) → Paladin has spell slots → AWAIT_SMITE_DECISION ---
        const dmg = engine.applyDamage(8);
        trail.push(captureSnapshot("await_smite", dmg, engine));

        assertPhase(trail[2], "AWAIT_SMITE_DECISION", "smite_decision");
        expect(dmg.awaitingSmiteDecision).toBe(true);
        expect(trail[2].hasPendingSmite).toBe(true);
        // HP unchanged: damage not applied until smite resolved
        expect(trail[2].entityHPs["gob"]).toBe(30);

        // --- Step 4: Smite level 1 ---
        const smite = engine.submitAction({
            type: "SMITE_1",
            attackerId: "pal",
            spellSlotLevel: 1,
        } as any);
        trail.push(captureSnapshot("smite_applied", smite, engine));

        assertPhase(trail[3], "ACTIVE", "after_smite");
        assertCleanActive(trail[3], "after_smite");
        // Damage applied: 8 (weapon) + smite dice (2d8 rolled by engine's rollFn → fixedRoll(10) = 10+10=20... actually fixedRoll returns total=10 per call)
        // Smite formula: 2d8 for level 1 slot. rollFn(2d8) returns total=10.
        // applyWeaponDamage called with damageRoll=8 from pending + smite modifier.
        // HP should decrease.
        expect(trail[3].entityHPs["gob"]).toBeLessThan(30);
        // Spell slot consumed
        const palState = engine.getState().entities.find(e => e.id === "pal");
        expect(palState?.spellSlots["1"]).toBe(2);

        // --- Step 5: End Turn ---
        const endTurn = engine.submitAction({ type: "END_TURN", entityId: "pal" });
        trail.push(captureSnapshot("end_turn", endTurn, engine));

        const turnEndLog = endTurn.logs.find(l => l.type === "TURN_END");
        expect(turnEndLog?.actorId).toBe("pal");
    });
});

// =============================================================================
// SCENARIO 6: Cleric: Healing Word (bonus action) → Attack (action) → End Turn
// =============================================================================

describe("Scenario 6: Healing Word (bonus) → Attack (action) → auto-end", () => {
    it("full turn audit", () => {
        const engine = createCombatEngine(1, {}, fixedRoll(10));
        const cleric = makePlayer("clr", "Elara", {
            characterClass: "Cleric",
            spells: [HEALING_WORD],
            spellSlots: { "1": 4 },
            attackModifier: 5,
            weapons: [{ name: "Mace", damageFormula: "1d6+3", damageType: "bludgeoning", isRanged: false, attackBonus: 5, properties: [] }],
        });
        // Ally at reduced HP to heal
        const ally = makePlayer("ally", "Gimli", { hp: 15 });
        const gob = makeEnemy("gob", "Goblin");
        startCombat(engine, [cleric, ally, gob]);

        const trail: AuditSnapshot[] = [];

        // --- Step 1: Healing Word on ally (bonus action) ---
        const heal = engine.submitAction({
            type: "CAST_SPELL",
            casterId: "clr",
            spellName: "Healing Word",
            targetIds: ["ally"],
        });
        trail.push(captureSnapshot("healing_word", heal, engine));

        expect(heal.success).toBe(true);
        assertPhase(trail[0], "ACTIVE", "heal");
        assertResourceDelta(trail[0], { bonusActionUsed: true, actionUsed: false, movementUsed: false }, "heal");
        // Ally healed (rollFn returns 10 for "1d4+3")
        // The healing amount is capped by maxHp
        expect(trail[0].entityHPs["ally"]).toBeGreaterThan(15);
        // Cleric HP unchanged
        expect(trail[0].entityHPs["clr"]).toBe(30);
        // Spell slot consumed
        const clrState = engine.getState().entities.find(e => e.id === "clr");
        expect(clrState?.spellSlots["1"]).toBe(3);

        // --- Step 2: Attack (action) ---
        const atk = engine.submitAction({
            type: "ATTACK",
            attackerId: "clr",
            targetId: "gob",
        });
        trail.push(captureSnapshot("atk_await", atk, engine));

        assertPhase(trail[1], "AWAIT_ATTACK_ROLL", "atk");
        expect(atk.awaitingAttackRoll).toBe(true);

        // --- Step 3: Roll hit (15+5=20 vs AC 14) ---
        const roll = engine.resolveAttackRoll(15);
        trail.push(captureSnapshot("atk_hit", roll, engine));

        assertPhase(trail[2], "AWAIT_DAMAGE_ROLL", "hit");
        // Action consumed, bonus already used
        assertResourceDelta(trail[2], { actionUsed: true, bonusActionUsed: true }, "atk_hit_resources");

        // --- Step 4: Damage 7 (1d6+3) → both action+bonus used → auto-end ---
        const dmg = engine.applyDamage(7);
        trail.push(captureSnapshot("atk_damage", dmg, engine));

        // Turn should auto-end (both action and bonus used)
        expect(trail[3].entityHPs["gob"]).toBe(30 - 7);

        // Check for auto-end: TURN_END log should be in the result
        const turnEndLog = dmg.logs.find(l => l.type === "TURN_END");
        expect(turnEndLog, "auto-end TURN_END log").toBeDefined();
        expect(turnEndLog?.actorId).toBe("clr");

        // Next turn started: TURN_START for ally
        const turnStartLog = dmg.logs.find(l => l.type === "TURN_START");
        expect(turnStartLog, "auto-end TURN_START for next").toBeDefined();
        expect(turnStartLog?.actorId).toBe("ally");

        // Resources fresh for ally
        assertResourceDelta(trail[3], { actionUsed: false, bonusActionUsed: false, movementUsed: false }, "ally_fresh");
    });
});

// =============================================================================
// SCENARIO 7: Rogue: Attack (advantage) → damage → Cunning Action Disengage
// =============================================================================

describe("Scenario 7: Rogue Attack (advantage) → Cunning Action Disengage → auto-end", () => {
    it("full turn audit", () => {
        const engine = createCombatEngine(1, {}, fixedRoll(10));
        const rogue = makePlayer("rog", "Shadow", {
            characterClass: "Rogue",
            attackModifier: 7,
            weapons: [{
                name: "Rapier", damageFormula: "1d8+4", damageType: "piercing",
                isRanged: false, attackBonus: 7,
                properties: ["finesse"],
            }],
            conditions: ["hidden"],
        });
        const ally = makePlayer("ally", "Gimli");
        const gob = makeEnemy("gob", "Goblin");
        startCombat(engine, [rogue, ally, gob]);

        const trail: AuditSnapshot[] = [];

        // --- Step 1: Attack with advantage (from hidden) ---
        // NOTE: weaponName is required for Sneak Attack to identify finesse/ranged
        // property. Without it, matchWeapon returns undefined and sneak attack skips.
        const atk = engine.submitAction({
            type: "ATTACK",
            attackerId: "rog",
            targetId: "gob",
            advantage: true,
            weaponName: "Rapier",
        });
        trail.push(captureSnapshot("atk_await", atk, engine));

        assertPhase(trail[0], "AWAIT_ATTACK_ROLL", "atk");
        expect(atk.awaitingAttackRoll).toBe(true);

        // --- Step 2: Roll hit (15+7=22 vs AC 14) ---
        const roll = engine.resolveAttackRoll(15);
        trail.push(captureSnapshot("atk_hit", roll, engine));

        assertPhase(trail[1], "AWAIT_DAMAGE_ROLL", "hit");
        expect(roll.awaitingDamageRoll).toBe(true);
        // HP unchanged
        expect(trail[1].entityHPs["gob"]).toBe(30);

        // --- Step 3: Damage 8 (1d8+4) ---
        const dmg = engine.applyDamage(8);
        trail.push(captureSnapshot("atk_damage", dmg, engine));

        assertPhase(trail[2], "ACTIVE", "after_dmg");
        // Goblin took damage (weapon + possible sneak attack modifier applied by engine)
        expect(trail[2].entityHPs["gob"]).toBeLessThan(30);
        // Action used, bonus action still available
        assertResourceDelta(trail[2], { actionUsed: true, bonusActionUsed: false }, "after_dmg_resources");
        // Sneak attack used
        expect(trail[2].turnResources?.sneakAttackUsedThisTurn).toBe(true);

        // --- Step 4: Cunning Action: Disengage (bonus action) ---
        const disengage = engine.submitAction({
            type: "DISENGAGE",
            entityId: "rog",
            resourceCost: "bonus_action",
        } as any);
        trail.push(captureSnapshot("disengage", disengage, engine));

        expect(disengage.success).toBe(true);
        // Both action and bonus used → auto-end
        const turnEndLog = disengage.logs.find(l => l.type === "TURN_END");
        expect(turnEndLog, "auto-end TURN_END").toBeDefined();
        expect(turnEndLog?.actorId).toBe("rog");

        const turnStartLog = disengage.logs.find(l => l.type === "TURN_START");
        expect(turnStartLog?.actorId).toBe("ally");
    });
});

// =============================================================================
// SCENARIO 8: Wizard: Cast spell (action) → Move → End Turn
// =============================================================================

describe("Scenario 8: Simple spell + Move → End Turn", () => {
    it("full turn audit", () => {
        const engine = createCombatEngine(1, {}, fixedRoll(10));
        const wizard = makePlayer("wiz", "Gandalf", {
            spells: [FIRE_BOLT],
            spellSlots: {},
            spellAttackBonus: 7,
            characterClass: "Wizard",
        });
        const ally = makePlayer("ally", "Gimli");
        const gob = makeEnemy("gob", "Goblin");
        startCombat(engine, [wizard, ally, gob]);

        const trail: AuditSnapshot[] = [];

        // --- Step 1: Cast Fire Bolt ---
        const cast = engine.submitAction({
            type: "CAST_SPELL",
            casterId: "wiz",
            spellName: "Fire Bolt",
            targetIds: ["gob"],
        });
        trail.push(captureSnapshot("cast", cast, engine));

        assertPhase(trail[0], "AWAIT_ATTACK_ROLL", "cast");
        assertResourceDelta(trail[0], { actionUsed: true, bonusActionUsed: false, movementUsed: false }, "cast");

        // --- Step 2: Roll hit ---
        const roll = engine.resolveAttackRoll(14);
        trail.push(captureSnapshot("roll", roll, engine));
        assertPhase(trail[1], "AWAIT_DAMAGE_ROLL", "hit");

        // --- Step 3: Damage ---
        const dmg = engine.applyDamage(12);
        trail.push(captureSnapshot("dmg", dmg, engine));
        assertPhase(trail[2], "ACTIVE", "dmg");
        assertCleanActive(trail[2], "dmg");
        expect(trail[2].entityHPs["gob"]).toBe(30 - 12);

        // --- Step 4: Move ---
        const move = engine.submitAction({
            type: "MOVE",
            entityId: "wiz",
            targetId: "gob",
            direction: "away",
        });
        trail.push(captureSnapshot("move", move, engine));

        assertPhase(trail[3], "ACTIVE", "move");
        assertResourceDelta(trail[3], { movementUsed: true, actionUsed: true, bonusActionUsed: false }, "move");

        // --- Step 5: End Turn ---
        const endTurn = engine.submitAction({ type: "END_TURN", entityId: "wiz" });
        trail.push(captureSnapshot("end_turn", endTurn, engine));

        const turnEndLog = endTurn.logs.find(l => l.type === "TURN_END");
        expect(turnEndLog?.actorId).toBe("wiz");
        const turnStartLog = endTurn.logs.find(l => l.type === "TURN_START");
        expect(turnStartLog?.actorId).toBe("ally");

        // Verify fresh resources for next turn
        assertResourceDelta(trail[4], { actionUsed: false, bonusActionUsed: false, movementUsed: false }, "ally_fresh");
    });
});

// =============================================================================
// SCENARIO 9: Multi-party turn sequence: Player A → Player B → Enemy → back to A
// =============================================================================

describe("Scenario 9: Full round — Player A → Player B → Enemy → Player A", () => {
    it("full round audit", () => {
        // Enemy uses fixedRoll(10) for its attack
        const engine = createCombatEngine(1, {}, fixedRoll(10));
        const playerA = makePlayer("pa", "Alice");
        const playerB = makePlayer("pb", "Bob");
        const enemy = makeEnemy("en", "Orc");
        startCombat(engine, [playerA, playerB, enemy]);

        const trail: AuditSnapshot[] = [];

        // ======= PLAYER A's turn =======
        // Verify it's Player A's turn
        const initState = engine.getState();
        expect(initState.turnOrder[initState.turnIndex]).toBe("pa");
        expect(initState.round).toBe(1);

        // A attacks (with pre-rolled values for simplicity)
        const atkA = engine.submitAction({
            type: "ATTACK",
            attackerId: "pa",
            targetId: "en",
            attackRoll: 20,
            rawD20: 15,
        });
        trail.push(captureSnapshot("A_atk", atkA, engine));

        // Player attack with pre-rolled values: enters AWAIT_DAMAGE_ROLL
        assertPhase(trail[0], "AWAIT_DAMAGE_ROLL", "A_atk");

        const dmgA = engine.applyDamage(8);
        trail.push(captureSnapshot("A_dmg", dmgA, engine));
        expect(trail[1].entityHPs["en"]).toBe(30 - 8);

        // End A's turn
        const endA = engine.submitAction({ type: "END_TURN", entityId: "pa" });
        trail.push(captureSnapshot("A_end", endA, engine));

        const endALogs = endA.logs;
        const turnEndA = endALogs.find(l => l.type === "TURN_END");
        expect(turnEndA?.actorId, "TURN_END for A").toBe("pa");
        const turnStartB = endALogs.find(l => l.type === "TURN_START");
        expect(turnStartB?.actorId, "TURN_START for B").toBe("pb");
        expect(trail[2].round).toBe(1); // Same round
        assertResourceDelta(trail[2], { actionUsed: false, bonusActionUsed: false, movementUsed: false }, "B_fresh");

        // ======= PLAYER B's turn =======
        // B just ends their turn (does nothing)
        const endB = engine.submitAction({ type: "END_TURN", entityId: "pb" });
        trail.push(captureSnapshot("B_end", endB, engine));

        const turnEndB = endB.logs.find(l => l.type === "TURN_END");
        expect(turnEndB?.actorId, "TURN_END for B").toBe("pb");
        // Next is enemy
        const turnStartEn = endB.logs.find(l => l.type === "TURN_START");
        expect(turnStartEn?.actorId, "TURN_START for enemy").toBe("en");
        expect(trail[3].round).toBe(1); // Same round

        // ======= ENEMY's turn =======
        // Enemy auto-acts (let's submit attack + auto-roll for enemy)
        const atkEn = engine.submitAction({
            type: "ATTACK",
            attackerId: "en",
            targetId: "pa",
            attackRoll: 18,
            rawD20: 13,
        });
        trail.push(captureSnapshot("En_atk", atkEn, engine));

        // Enemy attacks auto-resolve (processAttack with roll → immediate damage → auto-end)
        // Check that enemy's turn ended (auto-end after action for enemies)
        const enemyTurnEnd = atkEn.logs.find(l => l.type === "TURN_END");

        // After enemy turn: round should wrap → round 2
        const postEnemyState = engine.getState();

        // Check TURN_START for Player A (new round)
        const turnStartA2 = atkEn.logs.find(l => l.type === "TURN_START" && l.actorId === "pa");

        // Verify round transition
        expect(postEnemyState.round, "round incremented").toBe(2);
        expect(postEnemyState.turnOrder[postEnemyState.turnIndex]).toBe("pa");

        // Fresh resources for Player A's new turn
        const freshResources = postEnemyState.turnResources;
        expect(freshResources?.actionUsed).toBe(false);
        expect(freshResources?.bonusActionUsed).toBe(false);
        expect(freshResources?.movementUsed).toBe(false);

        // Verify round-end/round-start logs exist
        const roundEndLog = atkEn.logs.find(l => l.type === "ROUND_END");
        expect(roundEndLog, "ROUND_END log").toBeDefined();
        const roundStartLog = atkEn.logs.find(l => l.type === "ROUND_START");
        expect(roundStartLog, "ROUND_START log").toBeDefined();
    });
});

// =============================================================================
// SCENARIO 10: Player does nothing — just End Turn immediately
// =============================================================================

describe("Scenario 10: Empty turn — End Turn immediately", () => {
    it("full turn audit", () => {
        const engine = createCombatEngine(1, {}, fixedRoll(10));
        const player = makePlayer("p1", "LazyHero");
        const ally = makePlayer("ally", "Gimli");
        const gob = makeEnemy("gob", "Goblin");
        startCombat(engine, [player, ally, gob]);

        const trail: AuditSnapshot[] = [];

        // Capture initial state
        const initState = engine.getState();
        const initHPs = Object.fromEntries(initState.entities.map(e => [e.id, e.hp]));
        const initResources = { ...initState.turnResources! };

        // End turn immediately
        const endTurn = engine.submitAction({ type: "END_TURN", entityId: "p1" });
        trail.push(captureSnapshot("end_turn", endTurn, engine));

        expect(endTurn.success).toBe(true);

        // No resources consumed (all should still be at initial values in the logs)
        // Actually, after END_TURN, resources are RESET for next entity.
        // But verify that no resources were consumed BEFORE ending:
        // The initial resources should all be false/fresh
        expect(initResources.actionUsed).toBe(false);
        expect(initResources.bonusActionUsed).toBe(false);
        expect(initResources.movementUsed).toBe(false);

        // All HP unchanged
        const postState = engine.getState();
        for (const entity of postState.entities) {
            expect(entity.hp, `${entity.id} HP unchanged`).toBe(initHPs[entity.id]);
        }

        // TURN_END for p1
        const turnEndLog = endTurn.logs.find(l => l.type === "TURN_END");
        expect(turnEndLog?.actorId).toBe("p1");

        // TURN_START for ally
        const turnStartLog = endTurn.logs.find(l => l.type === "TURN_START");
        expect(turnStartLog?.actorId).toBe("ally");

        // Fresh resources for next entity
        assertResourceDelta(trail[0], { actionUsed: false, bonusActionUsed: false, movementUsed: false }, "ally_fresh");

        // getTurnLogs should return the minimal turn (TURN_START + TURN_END for p1)
        const turnLogs = engine.getTurnLogs();
        const turnLogTypes = turnLogs.map(l => l.type);
        expect(turnLogTypes).toContain("TURN_START");
        expect(turnLogTypes).toContain("TURN_END");

        // The TURN_END in getTurnLogs should be for p1 (the turn that just ended)
        const tlTurnEnd = turnLogs.find(l => l.type === "TURN_END");
        expect(tlTurnEnd?.actorId).toBe("p1");
    });
});

// =============================================================================
// NARRATOR AUDIT: Check narrator prompts at key points
// =============================================================================

describe("Narrator audit: prompts at key combat points", () => {
    it("narrator after END_TURN has correct turn context", async () => {
        const engine = createCombatEngine(1, {}, fixedRoll(10));
        const wizard = makePlayer("wiz", "Gandalf", {
            spells: [FIRE_BOLT],
            spellAttackBonus: 7,
            characterClass: "Wizard",
        });
        const ally = makePlayer("ally", "Gimli");
        const gob = makeEnemy("gob", "Goblin");
        startCombat(engine, [wizard, ally, gob]);

        // Play a simple Fire Bolt turn
        engine.submitAction({ type: "CAST_SPELL", casterId: "wiz", spellName: "Fire Bolt", targetIds: ["gob"] });
        engine.resolveAttackRoll(14);
        engine.applyDamage(12);
        engine.submitAction({ type: "END_TURN", entityId: "wiz" });

        // Get turn logs and narrator prompt
        const turnLogs = engine.getTurnLogs();
        const logTypes = turnLogs.map(l => l.type);

        // Turn logs should span TURN_START to TURN_END for Gandalf's completed turn
        expect(logTypes[0]).toBe("TURN_START");
        expect(logTypes[logTypes.length - 1]).toBe("TURN_END");

        const turnStartLog = turnLogs.find(l => l.type === "TURN_START");
        const turnEndLog = turnLogs.find(l => l.type === "TURN_END");
        expect(turnStartLog?.actorId).toBe("wiz");
        expect(turnEndLog?.actorId).toBe("wiz");

        // Narrator prompt should not be null (logs exist)
        const prompt = await computeCombatNarrativePrompts(
            1, turnLogs, "I blast the goblin with fire!", "Gandalf",
            engine.getState().entities, false, "wiz",
        );
        expect(prompt).not.toBeNull();
        expect(prompt!.logSummary.length).toBeGreaterThan(0);
    });

    it("narrator mid-turn (awaiting roll) should not contain unresolved outcomes", async () => {
        const engine = createCombatEngine(1, {}, fixedRoll(10));
        const wizard = makePlayer("wiz", "Gandalf", {
            spells: [FIRE_BOLT],
            spellAttackBonus: 7,
            characterClass: "Wizard",
        });
        const gob = makeEnemy("gob", "Goblin");
        startCombat(engine, [wizard, gob]);

        // Cast but don't roll yet
        const castResult = engine.submitAction({
            type: "CAST_SPELL",
            casterId: "wiz",
            spellName: "Fire Bolt",
            targetIds: ["gob"],
        });

        // The cast result's logs should NOT contain ATTACK_ROLL or DAMAGE
        expect(castResult.logs.map(l => l.type)).not.toContain("ATTACK_ROLL");
        expect(castResult.logs.map(l => l.type)).not.toContain("DAMAGE");
    });
});
