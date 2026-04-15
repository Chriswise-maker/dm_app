/**
 * Combat Conversation Flow Tests
 *
 * Pipeline-level tests that exercise: parsed action → engine → combat logs → narrator prompt.
 *
 * Unlike unit tests that call engine methods directly, these simulate the full conversation
 * flow a player experiences: cast a spell → prompted for attack roll → prompted for damage →
 * narrator gets correct context. Each test prints the combat log and narrator prompt for
 * visual inspection (visible in terminal output on failure).
 *
 * Key bugs these tests expose:
 *  - B1: Spell attacks auto-roll damage instead of prompting the player
 *  - B2: Narrator prompt strips HP info, causing LLM to confuse damage with remaining HP
 *  - B3: Multi-ray spells only process the first target
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock DB before imports
vi.mock("../../db", () => ({
    getUserSettings: vi.fn().mockResolvedValue({}),
}));

import { createCombatEngine, type CombatEngineV2, type RollFn } from "../combat-engine-v2";
import {
    createPlayerEntity,
    createEnemyEntity,
    RangeBand,
    type CombatEntity,
    type CombatLogEntry,
    type BattleState,
} from "../combat-types";
import {
    computeCombatNarrativePrompts,
    generateMechanicalSummary,
} from "../combat-narrator";

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
    return (formula: string) => {
        const val = values[i % values.length];
        i++;
        return { total: val, rolls: [val], isCritical: val === 20, isFumble: val === 1 };
    };
}

/** Start combat with deterministic initiative (entities go in listed order) */
function startCombat(engine: CombatEngineV2, entities: CombatEntity[]): void {
    engine.prepareCombat(entities);
    entities.forEach((e, i) => {
        engine.applyInitiative(e.id, 20 - i);
    });
}

// =============================================================================
// ConversationSimulator — Wires engine + narrator prompt for pipeline testing
// =============================================================================

class ConversationSimulator {
    engine: CombatEngineV2;
    allLogs: CombatLogEntry[] = [];
    lastNarratorPrompt: { systemPrompt: string; userPrompt: string; logSummary: string } | null = null;
    private userId = 1;

    constructor(
        private player: CombatEntity,
        private enemies: CombatEntity[],
        rollFn?: RollFn,
    ) {
        this.engine = createCombatEngine(999, undefined, rollFn);
        startCombat(this.engine, [player, ...enemies]);
    }

    get state(): BattleState {
        return this.engine.getState() as BattleState;
    }

    /** Submit a parsed action (skips LLM parser — action already structured) */
    submitAction(action: any) {
        const result = this.engine.submitAction(action);
        this.allLogs.push(...result.logs);
        return result;
    }

    /** Submit attack roll (when in AWAIT_ATTACK_ROLL phase) */
    submitAttackRoll(rawD20: number) {
        const result = this.engine.resolveAttackRoll(rawD20);
        this.allLogs.push(...result.logs);
        return result;
    }

    /** Submit damage roll (when in AWAIT_DAMAGE_ROLL phase) */
    submitDamageRoll(damage: number) {
        const result = this.engine.applyDamage(damage);
        this.allLogs.push(...result.logs);
        return result;
    }

    /** Submit saving throw (when in AWAIT_SAVE_ROLL phase) */
    submitSavingThrow(entityId: string, roll: number) {
        const result = this.engine.submitSavingThrow(entityId, roll);
        this.allLogs.push(...result.logs);
        return result;
    }

    /** Get narrator prompt for the most recent batch of logs */
    async getNarratorPrompt(logs: CombatLogEntry[], actorName: string, isEnemyTurn = false) {
        const entities = this.state.entities;
        const activePlayerId = isEnemyTurn ? undefined : this.player.id;
        const result = await computeCombatNarrativePrompts(
            this.userId, logs, "test flavor", actorName, entities, isEnemyTurn, activePlayerId
        );
        this.lastNarratorPrompt = result;
        return result;
    }

    // -- Assertion helpers --

    assertPhase(expected: string) {
        expect(this.state.phase).toBe(expected);
    }

    assertEntityHp(entityId: string, hp: number) {
        const entity = this.state.entities.find(e => e.id === entityId);
        expect(entity).toBeDefined();
        expect(entity!.hp).toBe(hp);
    }

    assertLogContains(logs: CombatLogEntry[], type: string, substring?: string) {
        const matching = logs.filter(l => l.type === type);
        expect(matching.length).toBeGreaterThan(0);
        if (substring) {
            const found = matching.some(l => l.description?.includes(substring));
            if (!found) {
                console.log("LOG ENTRIES of type", type, ":");
                matching.forEach(l => console.log("  ", l.description));
            }
            expect(found).toBe(true);
        }
    }

    /** Print full combat log for debugging (shows on test failure) */
    printCombatLog(logs: CombatLogEntry[]) {
        console.log("\n=== COMBAT LOG ===");
        logs.forEach((l, i) => {
            console.log(`  [${i}] ${l.type}: ${l.description || "(no description)"}`);
            if (l.amount !== undefined) console.log(`       amount: ${l.amount}`);
            if (l.damageType) console.log(`       damageType: ${l.damageType}`);
            if (l.roll) console.log(`       roll: ${JSON.stringify(l.roll)}`);
        });
        console.log("=== END LOG ===\n");
    }

    /** Print narrator prompt for debugging */
    printNarratorPrompt(prompt: { systemPrompt: string; userPrompt: string; logSummary: string } | null) {
        if (!prompt) {
            console.log("\n=== NARRATOR: null ===\n");
            return;
        }
        console.log("\n=== NARRATOR PROMPT ===");
        console.log("LOG SUMMARY:\n", prompt.logSummary);
        console.log("USER PROMPT:\n", prompt.userPrompt);
        console.log("=== END NARRATOR ===\n");
    }
}

// =============================================================================
// FIXTURES
// =============================================================================

function makeWizard(): CombatEntity {
    return createPlayerEntity("wizard-1", "Silas Gravemourn", 22, 22, 12, 10, {
        characterClass: "Wizard",
        level: 5,
        attackModifier: 2,
        damageFormula: "1d6+1",
        damageType: "bludgeoning",
        weapons: [
            { name: "Quarterstaff", damageFormula: "1d6+1", damageType: "bludgeoning", isRanged: false, attackBonus: 3, properties: [] },
        ],
        spells: [
            { name: "Fire Bolt", level: 0, school: "evocation", castingTime: "action", range: 120, isAreaEffect: false, savingThrow: undefined, halfOnSave: false, damageFormula: "2d10", damageType: "fire", requiresConcentration: false, requiresAttackRoll: true, conditions: [], description: "Hurl fire" },
            { name: "Scorching Ray", level: 2, school: "evocation", castingTime: "action", range: 120, isAreaEffect: false, savingThrow: undefined, halfOnSave: false, damageFormula: "2d6", damageType: "fire", requiresConcentration: false, requiresAttackRoll: true, conditions: [], description: "3 rays of fire" },
            { name: "Fireball", level: 3, school: "evocation", castingTime: "action", range: 150, isAreaEffect: true, areaType: "sphere", savingThrow: "DEX", halfOnSave: true, damageFormula: "8d6", damageType: "fire", requiresConcentration: false, requiresAttackRoll: false, conditions: [], description: "Explosion of fire" },
            { name: "Guiding Bolt", level: 1, school: "evocation", castingTime: "action", range: 120, isAreaEffect: false, savingThrow: undefined, halfOnSave: false, damageFormula: "4d6", damageType: "radiant", requiresConcentration: false, requiresAttackRoll: true, conditions: [], description: "Bolt of radiant energy" },
            { name: "Hold Person", level: 2, school: "enchantment", castingTime: "action", range: 60, isAreaEffect: false, savingThrow: "WIS", halfOnSave: false, requiresConcentration: true, requiresAttackRoll: false, conditions: ["paralyzed"], description: "Paralyze a humanoid" },
            { name: "Healing Word", level: 1, school: "evocation", castingTime: "bonus_action", range: 60, isAreaEffect: false, savingThrow: undefined, halfOnSave: false, healingFormula: "1d4+4", requiresConcentration: false, requiresAttackRoll: false, conditions: [], description: "Heal an ally" },
            { name: "Shield", level: 1, school: "abjuration", castingTime: "reaction", range: 0, isAreaEffect: false, savingThrow: undefined, halfOnSave: false, requiresConcentration: false, requiresAttackRoll: false, conditions: [], description: "+5 AC until next turn" },
        ],
        spellSlots: { "1": 4, "2": 3, "3": 2 },
        spellSaveDC: 15,
        spellAttackBonus: 7,
        spellcastingAbility: "int",
        abilityScores: { str: 8, dex: 14, con: 12, int: 18, wis: 12, cha: 10 },
    });
}

function makeFighter(): CombatEntity {
    return createPlayerEntity("fighter-1", "Korrin Steelguard", 44, 44, 18, 10, {
        characterClass: "Fighter",
        level: 5,
        attackModifier: 7,
        damageFormula: "1d8+4",
        damageType: "slashing",
        weapons: [
            { name: "Longsword", damageFormula: "1d8+4", damageType: "slashing", isRanged: false, attackBonus: 7, properties: ["versatile"] },
            { name: "Longbow", damageFormula: "1d8+3", damageType: "piercing", isRanged: true, attackBonus: 6, properties: [] },
        ],
        abilityScores: { str: 18, dex: 14, con: 16, int: 10, wis: 12, cha: 8 },
    });
}

function makeGraveThrall(suffix: string, hp = 22): CombatEntity {
    return createEnemyEntity(`thrall-${suffix}`, `Grave Thrall (${suffix})`, hp, 8, 4, "1d6+2", {
        damageType: "slashing",
        weapons: [
            { name: "Rusted Sword", damageFormula: "1d6+2", damageType: "slashing", isRanged: false, attackBonus: 4, properties: [] },
        ],
        abilityScores: { str: 14, dex: 8, con: 12, int: 3, wis: 6, cha: 5 },
    });
}

function makeOgre(): CombatEntity {
    return createEnemyEntity("ogre-1", "Ogre", 59, 11, 6, "2d8+4", {
        damageType: "bludgeoning",
        weapons: [
            { name: "Greatclub", damageFormula: "2d8+4", damageType: "bludgeoning", isRanged: false, attackBonus: 6, properties: [] },
        ],
        abilityScores: { str: 19, dex: 8, con: 16, int: 5, wis: 7, cha: 7 },
    });
}

// =============================================================================
// WEAPON ATTACK TESTS (Scenarios 1-5)
// =============================================================================

describe("Weapon Attacks", () => {

    it("1. Melee attack hit → AWAIT_ATTACK_ROLL → AWAIT_DAMAGE_ROLL → HP reduced", () => {
        const fighter = makeFighter();
        const ogre = makeOgre();
        const sim = new ConversationSimulator(fighter, [ogre]);

        sim.assertPhase("ACTIVE");

        // Player attacks — engine should enter AWAIT_ATTACK_ROLL
        const castResult = sim.submitAction({
            type: "ATTACK",
            attackerId: "fighter-1",
            targetId: "ogre-1",
            weaponName: "Longsword",
        });
        sim.assertPhase("AWAIT_ATTACK_ROLL");

        // Player rolls attack: 15 + 7 = 22 vs AC 11 → hit
        const attackResult = sim.submitAttackRoll(15);
        sim.assertPhase("AWAIT_DAMAGE_ROLL");
        expect(attackResult.awaitingDamageRoll).toBe(true);

        // Player rolls damage: 7
        const damageResult = sim.submitDamageRoll(7);
        sim.assertPhase("ACTIVE"); // turn continues or ends
        sim.assertEntityHp("ogre-1", 59 - 7);

        sim.printCombatLog(damageResult.logs);
    });

    it("2. Melee attack miss → MISS logged, no damage, no damage prompt", async () => {
        const fighter = makeFighter();
        const ogre = makeOgre();
        const sim = new ConversationSimulator(fighter, [ogre]);

        sim.submitAction({
            type: "ATTACK",
            attackerId: "fighter-1",
            targetId: "ogre-1",
            weaponName: "Longsword",
        });
        sim.assertPhase("AWAIT_ATTACK_ROLL");

        // Roll 2 + 7 = 9 vs AC 11 → miss
        const result = sim.submitAttackRoll(2);
        sim.assertEntityHp("ogre-1", 59);
        expect(result.awaitingDamageRoll).toBeFalsy();

        // Attack roll log must indicate miss (description says "misses")
        sim.assertLogContains(result.logs, "ATTACK_ROLL", "misses");
        // The log entry's success field must be false
        const attackLog = result.logs.find(l => l.type === "ATTACK_ROLL");
        expect(attackLog).toBeDefined();
        expect(attackLog!.success).toBe(false);

        // Narrator formatted summary should say MISS so the LLM narrates accordingly
        const prompt = await sim.getNarratorPrompt(result.logs, "Korrin Steelguard");
        expect(prompt).not.toBeNull();
        expect(prompt!.logSummary).toContain("MISS");
    });

    it("3. Ranged attack hit → piercing damage, correct weapon in narrator", async () => {
        const fighter = makeFighter();
        const ogre = makeOgre();
        const sim = new ConversationSimulator(fighter, [ogre]);

        sim.submitAction({
            type: "ATTACK",
            attackerId: "fighter-1",
            targetId: "ogre-1",
            weaponName: "Longbow",
            isRanged: true,
        });
        sim.assertPhase("AWAIT_ATTACK_ROLL");

        // Roll 14 + 6 = 20 vs AC 11 → hit
        sim.submitAttackRoll(14);
        sim.assertPhase("AWAIT_DAMAGE_ROLL");

        // Pending attack should reflect the ranged weapon's damage type
        const pending = sim.state.pendingAttack;
        expect(pending).toBeDefined();
        expect(pending!.damageType).toBe("piercing");

        const damageResult = sim.submitDamageRoll(8);
        sim.assertEntityHp("ogre-1", 59 - 8);
        sim.assertLogContains(damageResult.logs, "DAMAGE", "piercing");

        // Narrator must know it's a Longbow, not default weapon
        const prompt = await sim.getNarratorPrompt(
            [...sim.allLogs.slice(-6)], "Korrin Steelguard"
        );
        expect(prompt).not.toBeNull();
        expect(prompt!.userPrompt).toContain("WEAPON");
    });

    it("4. Critical hit (nat 20) → doubled damage dice", () => {
        const fighter = makeFighter();
        const ogre = makeOgre();
        const sim = new ConversationSimulator(fighter, [ogre]);

        sim.submitAction({
            type: "ATTACK",
            attackerId: "fighter-1",
            targetId: "ogre-1",
            weaponName: "Longsword",
        });
        sim.assertPhase("AWAIT_ATTACK_ROLL");

        // Nat 20
        const result = sim.submitAttackRoll(20);
        sim.assertPhase("AWAIT_DAMAGE_ROLL");

        // On crit, damage formula should be doubled (2d8+4 instead of 1d8+4)
        const pendingAttack = sim.state.pendingAttack;
        expect(pendingAttack).toBeDefined();
        expect(pendingAttack!.isCritical).toBe(true);
        // The engine should double the dice: 1d8+4 → 2d8+4
        expect(pendingAttack!.damageFormula).toContain("2d8");

        // Roll max crit damage
        sim.submitDamageRoll(16 + 4); // 2d8 max (16) + 4
        sim.assertEntityHp("ogre-1", 59 - 20);
    });

    it("5. Critical miss (nat 1) → FUMBLE logged, no damage", () => {
        const fighter = makeFighter();
        const ogre = makeOgre();
        const sim = new ConversationSimulator(fighter, [ogre]);

        sim.submitAction({
            type: "ATTACK",
            attackerId: "fighter-1",
            targetId: "ogre-1",
            weaponName: "Longsword",
        });

        // Nat 1 → fumble, always miss regardless of modifier
        const result = sim.submitAttackRoll(1);
        sim.assertEntityHp("ogre-1", 59);
        expect(result.awaitingDamageRoll).toBeFalsy();

        // Fumble must be logged so narrator can describe the embarrassing miss
        const attackLog = result.logs.find(l => l.type === "ATTACK_ROLL");
        expect(attackLog).toBeDefined();
        expect(attackLog!.roll?.isFumble).toBe(true);
        expect(attackLog!.success).toBe(false);
    });
});

// =============================================================================
// SPELL ATTACK TESTS (Scenarios 6-10)
// =============================================================================

describe("Spell Attacks", () => {

    it("6. Fire Bolt (cantrip) → attack roll → SHOULD prompt for damage roll", () => {
        const wizard = makeWizard();
        const thrall = makeGraveThrall("Soldier");
        const sim = new ConversationSimulator(wizard, [thrall]);

        // Cast Fire Bolt
        const castResult = sim.submitAction({
            type: "CAST_SPELL",
            casterId: "wizard-1",
            spellName: "Fire Bolt",
            targetIds: ["thrall-Soldier"],
        });
        sim.assertPhase("AWAIT_ATTACK_ROLL");
        expect(castResult.awaitingAttackRoll).toBe(true);

        // Roll attack: 14 + 7 = 21 vs AC 8 → hit
        const attackResult = sim.submitAttackRoll(14);

        // After a spell attack hits, the player should be prompted for damage —
        // exactly like weapon attacks. This is the same flow a player experiences.
        sim.assertPhase("AWAIT_DAMAGE_ROLL");
        expect(attackResult.awaitingDamageRoll).toBe(true);

        // Player rolls 2d10 = 12
        sim.submitDamageRoll(12);
        sim.assertEntityHp("thrall-Soldier", 22 - 12);
    });

    it("7. Scorching Ray → attack roll → MUST prompt for damage roll", () => {
        const wizard = makeWizard();
        const thrall = makeGraveThrall("Soldier");
        const sim = new ConversationSimulator(wizard, [thrall]);

        // Cast Scorching Ray
        sim.submitAction({
            type: "CAST_SPELL",
            casterId: "wizard-1",
            spellName: "Scorching Ray",
            targetIds: ["thrall-Soldier"],
        });
        sim.assertPhase("AWAIT_ATTACK_ROLL");

        // Roll attack: 13 + 7 = 20 vs AC 8 → hit
        const attackResult = sim.submitAttackRoll(13);

        // Player must be prompted for damage, not auto-rolled
        sim.assertPhase("AWAIT_DAMAGE_ROLL");
        expect(attackResult.awaitingDamageRoll).toBe(true);

        // Player rolls 2d6 = 7
        sim.submitDamageRoll(7);
        sim.assertEntityHp("thrall-Soldier", 22 - 7);
    });

    it("8. Guiding Bolt → attack roll → damage prompt → radiant damage applied", () => {
        const wizard = makeWizard();
        const thrall = makeGraveThrall("Soldier");
        const sim = new ConversationSimulator(wizard, [thrall]);

        sim.submitAction({
            type: "CAST_SPELL",
            casterId: "wizard-1",
            spellName: "Guiding Bolt",
            targetIds: ["thrall-Soldier"],
        });

        // Roll attack hit: 10 + 7 = 17 vs AC 8 → hit
        const attackResult = sim.submitAttackRoll(10);

        // Should prompt for damage (4d6 radiant)
        sim.assertPhase("AWAIT_DAMAGE_ROLL");
        expect(attackResult.awaitingDamageRoll).toBe(true);

        // Player rolls 4d6 = 14
        const damageResult = sim.submitDamageRoll(14);
        sim.assertEntityHp("thrall-Soldier", 22 - 14);
        sim.assertLogContains(damageResult.logs, "DAMAGE", "radiant");
    });

    it("9. Spell attack miss → no damage", () => {
        const wizard = makeWizard();
        const ogre = makeOgre(); // AC 11
        const sim = new ConversationSimulator(wizard, [ogre]);

        sim.submitAction({
            type: "CAST_SPELL",
            casterId: "wizard-1",
            spellName: "Fire Bolt",
            targetIds: ["ogre-1"],
        });
        sim.assertPhase("AWAIT_ATTACK_ROLL");

        // Roll 1 → fumble, always miss
        const result = sim.submitAttackRoll(1);
        sim.assertEntityHp("ogre-1", 59);

        // Verify miss in logs
        sim.assertLogContains(result.logs, "ATTACK_ROLL", "FUMBLE");
    });

    it("10. Spell critical hit → crit logged, narrator told to describe devastating strike", async () => {
        const wizard = makeWizard();
        const thrall = makeGraveThrall("Soldier");
        const sim = new ConversationSimulator(wizard, [thrall], fixedRoll(10));

        sim.submitAction({
            type: "CAST_SPELL",
            casterId: "wizard-1",
            spellName: "Fire Bolt",
            targetIds: ["thrall-Soldier"],
        });

        // Nat 20 → critical hit
        const result = sim.submitAttackRoll(20);

        // Crit must be logged
        sim.assertLogContains(result.logs, "ATTACK_ROLL", "CRITICAL");

        // Narrator must receive CRITICAL HIT context so it describes a devastating strike
        const prompt = await sim.getNarratorPrompt(result.logs, "Silas Gravemourn");
        expect(prompt).not.toBeNull();
        expect(prompt!.userPrompt).toContain("CRITICAL HIT");
    });
});

// =============================================================================
// SAVE-BASED SPELL TESTS (Scenarios 11-13)
// =============================================================================

describe("Save-based Spells", () => {

    it("11. Fireball → player rolls damage, enemies auto-save", async () => {
        const wizard = makeWizard();
        const thrall1 = makeGraveThrall("Soldier");
        const thrall2 = makeGraveThrall("Priest");
        // Fixed roll of 10: save roll = 10 + DEX mod(-1) = 9 vs DC 15 → FAIL
        const sim = new ConversationSimulator(wizard, [thrall1, thrall2], fixedRoll(10));

        // Player casts Fireball → pauses for damage roll
        const castResult = sim.submitAction({
            type: "CAST_SPELL",
            casterId: "wizard-1",
            spellName: "Fireball",
            targetIds: ["thrall-Soldier", "thrall-Priest"],
        });
        sim.assertPhase("AWAIT_DAMAGE_ROLL");

        // Spell slot should be consumed immediately on cast
        const wizardState = sim.state.entities.find(e => e.id === "wizard-1")!;
        expect(wizardState.spellSlots?.["3"]).toBe(1); // had 2, used 1

        // Player rolls 8d6 = 10 damage
        const dmgResult = sim.submitDamageRoll(10);

        // Both thralls fail DEX save (9 < DC 15), take full damage of 10
        sim.assertEntityHp("thrall-Soldier", 22 - 10);
        sim.assertEntityHp("thrall-Priest", 22 - 10);

        // Logs must contain save attempts and fire damage for both
        sim.assertLogContains(dmgResult.logs, "DAMAGE", "fire");

        // Narrator must mention fire damage and the spell
        const prompt = await sim.getNarratorPrompt(dmgResult.logs, "Silas Gravemourn");
        expect(prompt).not.toBeNull();
        expect(prompt!.logSummary).toContain("fire");
    });

    it("12. Hold Person → failed save → paralyzed, caster concentrating, spell slot used", () => {
        const wizard = makeWizard();
        const thrall = makeGraveThrall("Soldier");
        // Fixed roll of 3: enemy save = 3 + WIS mod (-2) = 1 vs DC 15 → fail
        const sim = new ConversationSimulator(wizard, [thrall], fixedRoll(3));

        const result = sim.submitAction({
            type: "CAST_SPELL",
            casterId: "wizard-1",
            spellName: "Hold Person",
            targetIds: ["thrall-Soldier"],
        });

        // Target must be paralyzed
        const thrallState = sim.state.entities.find(e => e.id === "thrall-Soldier")!;
        const isParalyzed = thrallState.activeConditions?.some(c => c.name === "paralyzed");
        expect(isParalyzed).toBe(true);

        // Caster must be concentrating (Hold Person requires concentration)
        const wizardState = sim.state.entities.find(e => e.id === "wizard-1")!;
        const isConcentrating = wizardState.activeConditions?.some(c => c.name === "concentrating");
        expect(isConcentrating).toBe(true);

        // Spell slot consumed (Hold Person is level 2)
        expect(wizardState.spellSlots?.["2"]).toBe(2); // had 3, used 1
    });

    it("13. Player-targeted save spell → MUST enter AWAIT_SAVE_ROLL, successful save prevents condition", () => {
        // Enemy casts a save spell on the PLAYER — player must roll their own save
        const wizard = makeWizard();
        const ogre = makeOgre();
        const ogreWithSpell = {
            ...ogre,
            spells: [
                { name: "Fear", level: 3, school: "illusion", castingTime: "action" as const, range: 30, isAreaEffect: false, savingThrow: "WIS" as const, halfOnSave: false, requiresConcentration: true, requiresAttackRoll: false, conditions: ["frightened"], description: "Terrifying presence" },
            ],
            spellSlots: { "3": 1 },
            spellSaveDC: 12,
        };

        const sim = new ConversationSimulator(wizard, [ogreWithSpell as unknown as CombatEntity]);

        // End player turn to get to ogre's turn
        sim.submitAction({ type: "END_TURN", entityId: "wizard-1" });

        // Ogre casts Fear on the wizard
        sim.submitAction({
            type: "CAST_SPELL",
            casterId: "ogre-1",
            spellName: "Fear",
            targetIds: ["wizard-1"],
        });

        // Engine MUST enter AWAIT_SAVE_ROLL — player rolls their own save, not auto-resolved
        sim.assertPhase("AWAIT_SAVE_ROLL");

        // Player rolls save: 15 + WIS mod (1) = 16 vs DC 12 → success
        sim.submitSavingThrow("wizard-1", 15);

        // Wizard should NOT be frightened (save succeeded)
        const wizardState = sim.state.entities.find(e => e.id === "wizard-1")!;
        const isFrightened = wizardState.activeConditions?.some(c => c.name === "frightened");
        expect(isFrightened).toBeFalsy();
    });
});

// =============================================================================
// HEALING/UTILITY TESTS (Scenarios 14-16)
// =============================================================================

describe("Healing & Utility", () => {

    it("14. Healing Word → HP restored, spell slot consumed, bonus action used", () => {
        // Start wizard at low HP by giving them less HP in the fixture
        const wizard = createPlayerEntity("wizard-1", "Silas Gravemourn", 10, 22, 12, 10, {
            characterClass: "Wizard",
            level: 5,
            spells: [
                { name: "Healing Word", level: 1, school: "evocation", castingTime: "bonus_action", range: 60, isAreaEffect: false, savingThrow: undefined, halfOnSave: false, healingFormula: "1d4+4", requiresConcentration: false, requiresAttackRoll: false, conditions: [], description: "Heal an ally" },
            ],
            spellSlots: { "1": 4 },
            abilityScores: { str: 8, dex: 14, con: 12, int: 18, wis: 12, cha: 10 },
        });
        const thrall = makeGraveThrall("Soldier");
        // fixedRoll(6): healing = 6
        const sim = new ConversationSimulator(wizard, [thrall], fixedRoll(6));

        // Verify starting HP
        sim.assertEntityHp("wizard-1", 10);

        const result = sim.submitAction({
            type: "CAST_SPELL",
            casterId: "wizard-1",
            spellName: "Healing Word",
            targetIds: ["wizard-1"],
        });

        sim.assertLogContains(result.logs, "HEALING");

        // HP restored by exactly 6 (fixedRoll): 10 + 6 = 16
        sim.assertEntityHp("wizard-1", 16);

        // Spell slot consumed (Healing Word is level 1)
        const wizardState = sim.state.entities.find(e => e.id === "wizard-1")!;
        expect(wizardState.spellSlots?.["1"]).toBe(3); // had 4, used 1

        // Healing Word is bonus action — player should still have their action
        sim.assertPhase("ACTIVE");
    });

    it("16. Concentration → new concentration drops old", () => {
        const wizard = makeWizard();
        const thrall1 = makeGraveThrall("Soldier");
        const thrall2 = makeGraveThrall("Priest");
        const sim = new ConversationSimulator(wizard, [thrall1, thrall2], fixedRoll(3));

        // Cast Hold Person (concentration) on first thrall
        sim.submitAction({
            type: "CAST_SPELL",
            casterId: "wizard-1",
            spellName: "Hold Person",
            targetIds: ["thrall-Soldier"],
        });

        // Verify concentration applied
        const wizardAfterFirst = sim.state.entities.find(e => e.id === "wizard-1")!;
        const isConcentrating = wizardAfterFirst.activeConditions?.some(c => c.name === "concentrating");
        expect(isConcentrating).toBe(true);

        // End turn, cycle back to wizard
        sim.submitAction({ type: "END_TURN", entityId: "wizard-1" });
        // Enemy turns (skip by ending)
        if (sim.state.turnOrder?.[sim.state.currentTurnIndex!] === "thrall-Soldier") {
            sim.submitAction({ type: "END_TURN", entityId: "thrall-Soldier" });
        }
        if (sim.state.turnOrder?.[sim.state.currentTurnIndex!] === "thrall-Priest") {
            sim.submitAction({ type: "END_TURN", entityId: "thrall-Priest" });
        }

        // Cast Hold Person again on second thrall — should drop first concentration
        const result = sim.submitAction({
            type: "CAST_SPELL",
            casterId: "wizard-1",
            spellName: "Hold Person",
            targetIds: ["thrall-Priest"],
        });

        sim.printCombatLog(result.logs);

        // First thrall should no longer be paralyzed — concentration was dropped
        const soldier = sim.state.entities.find(e => e.id === "thrall-Soldier")!;
        const stillParalyzed = soldier.activeConditions?.some(c => c.name === "paralyzed");
        expect(stillParalyzed).toBeFalsy();
    });
});

// =============================================================================
// MULTI-TARGET TESTS (Scenarios 17-18)
// =============================================================================

describe("Multi-target", () => {

    it("17. Fireball hitting 3 enemies → player rolls damage, all take same damage (failed save)", async () => {
        const wizard = makeWizard();
        const thrall1 = makeGraveThrall("Soldier");
        const thrall2 = makeGraveThrall("Priest");
        const thrall3 = makeGraveThrall("Decayed");
        // fixedRoll(8): save roll = 8 + DEX(-1) = 7 vs DC 15 → fail
        const sim = new ConversationSimulator(wizard, [thrall1, thrall2, thrall3], fixedRoll(8));

        // Player casts Fireball → pauses for damage roll
        sim.submitAction({
            type: "CAST_SPELL",
            casterId: "wizard-1",
            spellName: "Fireball",
            targetIds: ["thrall-Soldier", "thrall-Priest", "thrall-Decayed"],
        });
        sim.assertPhase("AWAIT_DAMAGE_ROLL");

        // Player rolls 8d6 = 8 damage
        const dmgResult = sim.submitDamageRoll(8);

        // All three fail DEX save, take full 8 fire damage each
        sim.assertEntityHp("thrall-Soldier", 22 - 8);
        sim.assertEntityHp("thrall-Priest", 22 - 8);
        sim.assertEntityHp("thrall-Decayed", 22 - 8);

        // Damage logs for all three targets
        const damageLogCount = dmgResult.logs.filter(l => l.type === "DAMAGE").length;
        expect(damageLogCount).toBe(3);

        // Narrator prompt should reference the spell
        const prompt = await sim.getNarratorPrompt(dmgResult.logs, "Silas Gravemourn");
        expect(prompt).not.toBeNull();
        expect(prompt!.userPrompt).toContain("SPELL");
        expect(prompt!.userPrompt).toContain("Fireball");
    });

    it("18. Scorching Ray multi-target → all targets must get attack+damage rolls", () => {
        const wizard = makeWizard();
        const thrall1 = makeGraveThrall("Soldier");
        const thrall2 = makeGraveThrall("Priest");
        const sim = new ConversationSimulator(wizard, [thrall1, thrall2]);

        sim.submitAction({
            type: "CAST_SPELL",
            casterId: "wizard-1",
            spellName: "Scorching Ray",
            targetIds: ["thrall-Soldier", "thrall-Priest"],
        });
        sim.assertPhase("AWAIT_ATTACK_ROLL");

        // First ray: attack roll hit → damage roll
        sim.submitAttackRoll(14); // hit vs AC 8

        // After first ray resolves, engine should queue the second ray
        // and enter AWAIT_ATTACK_ROLL again for the next target.
        // With B1 fixed, there would be a AWAIT_DAMAGE_ROLL step first,
        // but even without B1 fix, the second target must still be processed.

        // Resolve any pending damage
        if (sim.state.phase === "AWAIT_DAMAGE_ROLL") {
            sim.submitDamageRoll(7);
        }

        // After first ray fully resolves, second ray should begin
        sim.assertPhase("AWAIT_ATTACK_ROLL");
        expect(sim.state.pendingAttackRoll?.targetId).toBe("thrall-Priest");

        // Second ray: attack + damage
        sim.submitAttackRoll(12); // hit vs AC 8
        if (sim.state.phase === "AWAIT_DAMAGE_ROLL") {
            sim.submitDamageRoll(5);
        }

        // Both targets should have taken damage
        sim.assertEntityHp("thrall-Soldier", 22 - 7);
        sim.assertEntityHp("thrall-Priest", 22 - 5);
    });
});

// =============================================================================
// TURN FLOW TESTS (Scenarios 19-21)
// =============================================================================

describe("Turn Flow", () => {

    it("19. Player ends turn → round advances, combat continues", () => {
        const wizard = makeWizard();
        const thrall = makeGraveThrall("Soldier");
        const sim = new ConversationSimulator(wizard, [thrall], sequenceRoll([15, 5]));

        const initialRound = sim.state.round;

        // End player's turn
        const result = sim.submitAction({ type: "END_TURN", entityId: "wizard-1" });
        expect(result.success).toBe(true);

        // TURN_END log must be emitted
        sim.assertLogContains(result.logs, "TURN_END");

        // Combat should still be active (not resolved — enemies alive)
        const phase = sim.state.phase;
        expect(phase).not.toBe("RESOLVED");
        expect(phase).not.toBe("IDLE");
    });

    it("20. Unconscious player's turn → engine MUST enter AWAIT_DEATH_SAVE", () => {
        // Create wizard at 0 HP, unconscious from the start
        const wizard = createPlayerEntity("wizard-1", "Silas Gravemourn", 0, 22, 12, 20, {
            characterClass: "Wizard",
            level: 5,
            status: "UNCONSCIOUS",
            abilityScores: { str: 8, dex: 14, con: 12, int: 18, wis: 12, cha: 10 },
        });
        const thrall = makeGraveThrall("Soldier");
        // Give wizard high initiative so they go first
        const engine = createCombatEngine(999, undefined, fixedRoll(10));
        engine.prepareCombat([wizard, thrall]);
        engine.applyInitiative("wizard-1", 20);
        engine.applyInitiative("thrall-Soldier", 5);

        // Wizard is unconscious and goes first — their turn should trigger death save
        const state = engine.getState() as BattleState;
        expect(state.phase).toBe("AWAIT_DEATH_SAVE");
    });

    it("21. Healing an unconscious ally restores them to ALIVE", () => {
        const wizard = makeWizard();
        // Create fighter already unconscious at 0 HP
        const fighter = createPlayerEntity("fighter-1", "Korrin Steelguard", 0, 44, 18, 10, {
            characterClass: "Fighter",
            level: 5,
            status: "UNCONSCIOUS",
            abilityScores: { str: 18, dex: 14, con: 16, int: 10, wis: 12, cha: 8 },
        });
        const thrall = makeGraveThrall("Soldier");
        const sim = new ConversationSimulator(wizard, [fighter, thrall], fixedRoll(6));

        // Wizard casts Healing Word on unconscious fighter
        const result = sim.submitAction({
            type: "CAST_SPELL",
            casterId: "wizard-1",
            spellName: "Healing Word",
            targetIds: ["fighter-1"],
        });

        sim.assertLogContains(result.logs, "HEALING");

        // Fighter must be restored: HP > 0 and status ALIVE
        const fighterAfter = sim.state.entities.find(e => e.id === "fighter-1")!;
        expect(fighterAfter.hp).toBeGreaterThan(0);
        expect(fighterAfter.hp).toBe(6); // healed exactly 6 from 0
        expect(fighterAfter.status).toBe("ALIVE");
    });
});

// =============================================================================
// INITIATIVE TESTS
// =============================================================================

describe("Initiative", () => {

    it("22. Initiative for already-rolled character should not block remaining players", () => {
        // Create entities with initiative=0 so they need to roll
        const wizard = createPlayerEntity("wizard-1", "Silas", 22, 22, 12, 0, {
            abilityScores: { str: 8, dex: 14, con: 12, int: 18, wis: 12, cha: 10 },
        });
        const fighter = createPlayerEntity("fighter-1", "Korrin", 44, 44, 18, 0, {
            abilityScores: { str: 18, dex: 14, con: 16, int: 10, wis: 12, cha: 8 },
        });
        const thrall = makeGraveThrall("Soldier");

        const engine = createCombatEngine(999);
        engine.prepareCombat([wizard, fighter, thrall]);

        // Verify both players are pending
        const pending = engine.getState().pendingInitiative;
        expect(pending).toBeDefined();
        expect(pending!.pendingEntityIds).toContain("wizard-1");
        expect(pending!.pendingEntityIds).toContain("fighter-1");

        // Wizard rolls initiative
        const result1 = engine.applyInitiative("wizard-1", 15);
        expect(result1.combatStarted).toBe(false);
        expect(result1.remainingPlayers).toContain("fighter-1");

        // Wizard tries to roll AGAIN (simulating user typing from wrong character)
        const result2 = engine.applyInitiative("wizard-1", 12);
        // Should still report fighter as remaining
        expect(result2.remainingPlayers).toContain("fighter-1");
        expect(result2.combatStarted).toBe(false);

        // Fighter rolls — combat should start
        const result3 = engine.applyInitiative("fighter-1", 10);
        expect(result3.combatStarted).toBe(true);
    });

    it("23. All players must roll before combat starts", () => {
        const wizard = createPlayerEntity("wizard-1", "Silas", 22, 22, 12, 0, {
            abilityScores: { str: 8, dex: 14, con: 12, int: 18, wis: 12, cha: 10 },
        });
        const fighter = createPlayerEntity("fighter-1", "Korrin", 44, 44, 18, 0, {
            abilityScores: { str: 18, dex: 14, con: 16, int: 10, wis: 12, cha: 8 },
        });
        const thrall = makeGraveThrall("Soldier");

        const engine = createCombatEngine(999);
        engine.prepareCombat([wizard, fighter, thrall]);

        expect(engine.getState().phase).toBe("AWAIT_INITIATIVE");

        // Only wizard rolls
        engine.applyInitiative("wizard-1", 18);
        expect(engine.getState().phase).toBe("AWAIT_INITIATIVE");

        // Fighter rolls — now all players done, combat starts
        engine.applyInitiative("fighter-1", 12);
        expect(engine.getState().phase).toBe("ACTIVE");
    });
});

// =============================================================================
// NARRATOR PROMPT VERIFICATION
// =============================================================================

describe("Narrator Prompt Quality", () => {

    it("Damage log summary MUST include HP status so narrator doesn't confuse damage with remaining HP", async () => {
        const wizard = makeWizard();
        const thrall = makeGraveThrall("Soldier");
        const sim = new ConversationSimulator(wizard, [thrall]);

        // Cast Fire Bolt → attack roll → damage roll (full flow with B1 fixed)
        sim.submitAction({
            type: "CAST_SPELL",
            casterId: "wizard-1",
            spellName: "Fire Bolt",
            targetIds: ["thrall-Soldier"],
        });
        sim.submitAttackRoll(14); // hit
        const damageResult = sim.submitDamageRoll(7); // 2d10 = 7

        // Get narrator prompt from the damage resolution logs
        const prompt = await sim.getNarratorPrompt(damageResult.logs, "Silas Gravemourn");
        expect(prompt).not.toBeNull();

        // The narrator LLM sees the logSummary. It MUST include "X/Y HP"
        // so the LLM doesn't confuse the damage number with remaining HP.
        expect(prompt!.logSummary).toMatch(/\d+\/\d+\s*HP/);
    });

    it("Weapon attack narrator prompt MUST include weapon name and type", async () => {
        const fighter = makeFighter();
        const ogre = makeOgre();
        const sim = new ConversationSimulator(fighter, [ogre]);

        sim.submitAction({
            type: "ATTACK",
            attackerId: "fighter-1",
            targetId: "ogre-1",
            weaponName: "Longsword",
        });
        sim.submitAttackRoll(15);

        const logs = sim.allLogs.slice(-5);
        const prompt = await sim.getNarratorPrompt(logs, "Korrin Steelguard");
        expect(prompt).not.toBeNull();

        // Narrator must know the weapon so it describes a sword slash, not a generic "attack"
        expect(prompt!.userPrompt).toContain("WEAPON");
        expect(prompt!.userPrompt).toContain("Longsword");
        expect(prompt!.userPrompt).toContain("slashing");
    });

    it("Spell attack narrator prompt MUST include spell name and damage type, not weapon", async () => {
        const wizard = makeWizard();
        const thrall = makeGraveThrall("Soldier");
        const sim = new ConversationSimulator(wizard, [thrall], fixedRoll(7));

        sim.submitAction({
            type: "CAST_SPELL",
            casterId: "wizard-1",
            spellName: "Fire Bolt",
            targetIds: ["thrall-Soldier"],
        });
        const result = sim.submitAttackRoll(14);

        const prompt = await sim.getNarratorPrompt(result.logs, "Silas Gravemourn");
        expect(prompt).not.toBeNull();

        // Narrator MUST know this is a spell — otherwise it narrates a sword swing
        expect(prompt!.userPrompt).toContain("SPELL");
        expect(prompt!.userPrompt).toContain("Fire Bolt");
        expect(prompt!.userPrompt).toContain("fire");
        // ENTITY DETAILS section must say SPELL, not WEAPON
        // (the template instructions mention "WEAPON" generically, so we check the details block)
        expect(prompt!.userPrompt).toContain("SPELL: Fire Bolt");
        expect(prompt!.userPrompt).not.toContain("WEAPON: ");
    });
});
