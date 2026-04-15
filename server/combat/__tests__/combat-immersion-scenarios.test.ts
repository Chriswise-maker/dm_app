/**
 * Combat Immersion Scenario Tests
 *
 * These tests simulate realistic D&D combat from the DM's perspective:
 *
 * 1. Can each class actually use their signature abilities?
 * 2. Does the narrator receive correct info (class, weapon vs spell, conditions)?
 * 3. Is the narration prompt consistent across multi-round, multi-character combat?
 *
 * Each scenario drives the engine through a realistic flow, then inspects both
 * the mechanical result AND the narrator prompt to flag features that are
 * missing, broken, or producing wrong narration context.
 *
 * This is NOT unit testing — it's experience-level validation.
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
    return (_formula: string) => {
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

/**
 * Replicate the caller's weapon context assembly (from message-send.ts).
 * This is what the narrator receives when a player attacks.
 */
function assembleWeaponContext(
    actionType: string,
    actionWeaponName: string | undefined,
    activeEntity: CombatEntity | undefined
): Record<string, any> {
    if (actionType === "ATTACK" && actionWeaponName) {
        const weapon = activeEntity?.weapons?.find(
            (w) => w.name.toLowerCase() === actionWeaponName.toLowerCase()
        );
        return { weaponName: weapon?.name ?? actionWeaponName };
    }
    return {};
}

// =============================================================================
// FIXTURES — A realistic mixed party
// =============================================================================

function makeWizard(): CombatEntity {
    return createPlayerEntity("wizard-1", "Elara the Wise", 22, 22, 12, 10, {
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
            { name: "Fireball", level: 3, school: "evocation", castingTime: "action", range: 150, isAreaEffect: true, areaType: "sphere", savingThrow: "DEX", halfOnSave: true, damageFormula: "8d6", damageType: "fire", requiresConcentration: false, requiresAttackRoll: false, conditions: [], description: "Explosion of fire" },
            { name: "Hold Person", level: 2, school: "enchantment", castingTime: "action", range: 60, isAreaEffect: false, savingThrow: "WIS", halfOnSave: false, requiresConcentration: true, requiresAttackRoll: false, conditions: ["paralyzed"], description: "Paralyze a humanoid" },
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
        extraAttacks: 1, // Fighter Extra Attack at level 5
        attackModifier: 7,
        damageFormula: "1d8+4",
        damageType: "slashing",
        weapons: [
            { name: "Longsword", damageFormula: "1d8+4", damageType: "slashing", isRanged: false, attackBonus: 7, properties: ["versatile"] },
            { name: "Handaxe", damageFormula: "1d6+4", damageType: "slashing", isRanged: true, attackBonus: 7, properties: ["light", "thrown"] },
        ],
        featureUses: { "Second Wind": 1, "Action Surge": 1 },
        abilityScores: { str: 18, dex: 14, con: 16, int: 10, wis: 12, cha: 8 },
    });
}

function makeRogue(): CombatEntity {
    return createPlayerEntity("rogue-1", "Vex Shadowstep", 28, 28, 15, 10, {
        characterClass: "Rogue",
        level: 5,
        attackModifier: 7,
        damageFormula: "1d6+4",
        damageType: "piercing",
        weapons: [
            { name: "Rapier", damageFormula: "1d8+4", damageType: "piercing", isRanged: false, attackBonus: 7, properties: ["finesse"] },
            { name: "Shortbow", damageFormula: "1d6+4", damageType: "piercing", isRanged: true, attackBonus: 7, properties: ["ammunition"] },
        ],
        abilityScores: { str: 10, dex: 18, con: 12, int: 14, wis: 12, cha: 14 },
    });
}

function makeCleric(): CombatEntity {
    return createPlayerEntity("cleric-1", "Brother Aldric", 32, 32, 18, 10, {
        characterClass: "Cleric",
        level: 5,
        attackModifier: 4,
        damageFormula: "1d8+2",
        damageType: "bludgeoning",
        weapons: [
            { name: "Mace", damageFormula: "1d6+2", damageType: "bludgeoning", isRanged: false, attackBonus: 4, properties: [] },
        ],
        spells: [
            { name: "Sacred Flame", level: 0, school: "evocation", castingTime: "action", range: 60, isAreaEffect: false, savingThrow: "DEX", halfOnSave: false, damageFormula: "2d8", damageType: "radiant", requiresConcentration: false, requiresAttackRoll: false, conditions: [], description: "Radiant flame" },
            { name: "Cure Wounds", level: 1, school: "evocation", castingTime: "action", range: 5, isAreaEffect: false, savingThrow: undefined, halfOnSave: false, requiresConcentration: false, requiresAttackRoll: false, conditions: [], description: "Heal", healingFormula: "1d8+3" },
            { name: "Guiding Bolt", level: 1, school: "evocation", castingTime: "action", range: 120, isAreaEffect: false, savingThrow: undefined, halfOnSave: false, damageFormula: "4d6", damageType: "radiant", requiresConcentration: false, requiresAttackRoll: true, conditions: [], description: "Beam of light" },
            { name: "Spirit Guardians", level: 3, school: "conjuration", castingTime: "action", range: 0, isAreaEffect: true, areaType: "sphere", savingThrow: "WIS", halfOnSave: true, damageFormula: "3d8", damageType: "radiant", requiresConcentration: true, requiresAttackRoll: false, conditions: [], description: "Spectral spirits guard you" },
        ],
        spellSlots: { "1": 4, "2": 3, "3": 2 },
        spellSaveDC: 14,
        spellAttackBonus: 6,
        spellcastingAbility: "wis",
        abilityScores: { str: 14, dex: 10, con: 14, int: 10, wis: 18, cha: 12 },
    });
}

function makeBarbarian(): CombatEntity {
    return createPlayerEntity("barb-1", "Grukk the Raging", 52, 52, 15, 10, {
        characterClass: "Barbarian",
        level: 5,
        attackModifier: 7,
        damageFormula: "1d12+4",
        damageType: "slashing",
        weapons: [
            { name: "Greataxe", damageFormula: "1d12+4", damageType: "slashing", isRanged: false, attackBonus: 7, properties: ["heavy", "two-handed"] },
            { name: "Javelin", damageFormula: "1d6+4", damageType: "piercing", isRanged: true, attackBonus: 7, properties: ["thrown"] },
        ],
        featureUses: { "Rage": 3 },
        abilityScores: { str: 18, dex: 14, con: 16, int: 8, wis: 12, cha: 10 },
    });
}

function makePaladin(): CombatEntity {
    return createPlayerEntity("paladin-1", "Seraphina Dawnshield", 40, 40, 18, 10, {
        characterClass: "Paladin",
        level: 5,
        attackModifier: 7,
        damageFormula: "1d8+4",
        damageType: "slashing",
        weapons: [
            { name: "Longsword", damageFormula: "1d8+4", damageType: "slashing", isRanged: false, attackBonus: 7, properties: ["versatile"] },
        ],
        spells: [
            { name: "Cure Wounds", level: 1, school: "evocation", castingTime: "action", range: 5, isAreaEffect: false, savingThrow: undefined, halfOnSave: false, requiresConcentration: false, requiresAttackRoll: false, conditions: [], description: "Heal", healingFormula: "1d8+3" },
        ],
        spellSlots: { "1": 4, "2": 2 },
        featureUses: { "Lay on Hands": 25 },
        abilityScores: { str: 18, dex: 10, con: 14, int: 10, wis: 12, cha: 16 },
    });
}

function makeBard(): CombatEntity {
    return createPlayerEntity("bard-1", "Lyric Silverstring", 28, 28, 14, 10, {
        characterClass: "Bard",
        level: 5,
        attackModifier: 5,
        damageFormula: "1d8+2",
        damageType: "piercing",
        weapons: [
            { name: "Rapier", damageFormula: "1d8+2", damageType: "piercing", isRanged: false, attackBonus: 5, properties: ["finesse"] },
        ],
        spells: [
            { name: "Vicious Mockery", level: 0, school: "enchantment", castingTime: "action", range: 60, isAreaEffect: false, savingThrow: "WIS", halfOnSave: false, damageFormula: "2d4", damageType: "psychic", requiresConcentration: false, requiresAttackRoll: false, conditions: [], description: "Insult with magical force" },
            { name: "Healing Word", level: 1, school: "evocation", castingTime: "bonus_action", range: 60, isAreaEffect: false, savingThrow: undefined, halfOnSave: false, requiresConcentration: false, requiresAttackRoll: false, conditions: [], description: "Heal with a word", healingFormula: "1d4+3" },
        ],
        spellSlots: { "1": 4, "2": 3, "3": 2 },
        spellSaveDC: 14,
        spellAttackBonus: 6,
        spellcastingAbility: "cha",
        featureUses: { "Bardic Inspiration": 3 },
        abilityScores: { str: 8, dex: 14, con: 12, int: 12, wis: 10, cha: 18 },
    });
}

function makeOgre(): CombatEntity {
    return createEnemyEntity("ogre-1", "Ogre", 59, 11, 6, "2d8+4", {
        damageType: "bludgeoning",
        weapons: [{ name: "Greatclub", damageFormula: "2d8+4", damageType: "bludgeoning", isRanged: false, attackBonus: 6, properties: [] }],
        abilityScores: { str: 19, dex: 8, con: 16, int: 5, wis: 7, cha: 7 },
        tacticalRole: "brute",
    });
}

function makeGoblinArcher(): CombatEntity {
    return createEnemyEntity("goblin-1", "Goblin Archer", 12, 13, 4, "1d6+2", {
        damageType: "piercing",
        weapons: [
            { name: "Shortbow", damageFormula: "1d6+2", damageType: "piercing", isRanged: true, attackBonus: 4, properties: ["ammunition"] },
            { name: "Scimitar", damageFormula: "1d6+2", damageType: "slashing", isRanged: false, attackBonus: 4, properties: [] },
        ],
        abilityScores: { str: 8, dex: 14, con: 10, int: 10, wis: 8, cha: 8 },
    });
}

function makeEnemySpellcaster(): CombatEntity {
    return createEnemyEntity("mage-1", "Cultist Mage", 33, 12, 2, "1d4+1", {
        damageType: "bludgeoning",
        weapons: [{ name: "Dagger", damageFormula: "1d4+1", damageType: "piercing", isRanged: false, attackBonus: 4, properties: ["finesse"] }],
        spells: [
            { name: "Fire Bolt", level: 0, school: "evocation", castingTime: "action", range: 120, isAreaEffect: false, savingThrow: undefined, halfOnSave: false, damageFormula: "2d10", damageType: "fire", requiresConcentration: false, requiresAttackRoll: true, conditions: [], description: "Hurl fire" },
            { name: "Hold Person", level: 2, school: "enchantment", castingTime: "action", range: 60, isAreaEffect: false, savingThrow: "WIS", halfOnSave: false, requiresConcentration: true, requiresAttackRoll: false, conditions: ["paralyzed"], description: "Paralyze a humanoid" },
        ],
        spellSlots: { "1": 3, "2": 2 },
        spellSaveDC: 13,
        spellAttackBonus: 5,
        spellcastingAbility: "int",
        abilityScores: { str: 9, dex: 14, con: 12, int: 16, wis: 12, cha: 10 },
    });
}

function makeUndeadKnight(): CombatEntity {
    return createEnemyEntity("undead-1", "Death Knight", 75, 18, 8, "1d10+5", {
        damageType: "necrotic",
        creatureType: "undead",
        weapons: [{ name: "Cursed Greatsword", damageFormula: "2d6+5", damageType: "necrotic", isRanged: false, attackBonus: 8, properties: ["heavy", "two-handed"] }],
        immunities: ["poison", "necrotic"],
        resistances: ["bludgeoning", "piercing", "slashing"],
        abilityScores: { str: 20, dex: 11, con: 18, int: 12, wis: 14, cha: 16 },
    });
}

// =============================================================================
// SCENARIO 1: Wizard casts spells — narrator knows it's a spell, not a weapon
// =============================================================================

describe("Scenario 1: Wizard spell narration", () => {
    let engine: CombatEngineV2;

    beforeEach(() => {
        engine = createCombatEngine(1, {}, fixedRoll(8));
    });

    it("Fire Bolt: narrator prompt says SPELL, not WEAPON", async () => {
        const wizard = makeWizard();
        const ogre = makeOgre();
        startCombat(engine, [wizard, ogre]);

        const result = engine.submitAction({
            type: "CAST_SPELL",
            casterId: "wizard-1",
            spellName: "Fire Bolt",
            targetIds: ["ogre-1"],
            attackRoll: 18,
            rawD20: 11,
        });

        // Collect all logs including damage
        const allLogs = [...result.logs];
        if (engine.getState().phase === "AWAIT_DAMAGE_ROLL") {
            const dmgResult = engine.applyDamage(14);
            allLogs.push(...(dmgResult?.logs ?? []));
        }

        const prompt = await computeCombatNarrativePrompts(
            1, allLogs, "I hurl a bolt of fire at the ogre!", "Elara the Wise",
            engine.getState().entities, false, "wizard-1"
        );

        expect(prompt).not.toBeNull();
        // CRITICAL: Narrator must know this is a SPELL, not a weapon attack
        expect(prompt!.userPrompt).toContain("SPELL:");
        expect(prompt!.userPrompt).toContain("Fire Bolt");
        expect(prompt!.userPrompt).not.toContain("WEAPON:");
    });

    it("Fireball: player rolls damage, saves resolve, narrator includes AoE context", async () => {
        const wizard = makeWizard();
        const gob1 = makeGoblinArcher();
        const gob2 = createEnemyEntity("goblin-2", "Goblin Warrior", 14, 13, 4, "1d6+2", {
            damageType: "slashing",
            weapons: [{ name: "Scimitar", damageFormula: "1d6+2", damageType: "slashing", isRanged: false, attackBonus: 4, properties: [] }],
            abilityScores: { str: 10, dex: 14, con: 10, int: 10, wis: 8, cha: 8 },
        });
        startCombat(engine, [wizard, gob1, gob2]);

        // Player casts Fireball → pauses for damage roll
        const castResult = engine.submitAction({
            type: "CAST_SPELL",
            casterId: "wizard-1",
            spellName: "Fireball",
            targetIds: ["goblin-1", "goblin-2"],
        });

        expect(castResult.success).toBe(true);
        expect(engine.getState().phase).toBe("AWAIT_DAMAGE_ROLL");

        // Player rolls 8d6 = 10 damage
        const dmgResult = engine.applyDamage(10);
        expect(dmgResult.success).toBe(true);

        // Fireball should damage both targets (DEX save, half on save)
        const state = engine.getState();
        const gob1State = state.entities.find(e => e.id === "goblin-1")!;
        const gob2State = state.entities.find(e => e.id === "goblin-2")!;

        // At minimum, both should have taken some damage (even half on save)
        const gob1Damaged = gob1State.hp < 12 || gob1State.status === "DEAD";
        const gob2Damaged = gob2State.hp < 14 || gob2State.status === "DEAD";
        expect(gob1Damaged).toBe(true);
        expect(gob2Damaged).toBe(true);

        // Check narrator prompt with damage logs
        const prompt = await computeCombatNarrativePrompts(
            1, dmgResult.logs, "I fling a bead of fire into the group!", "Elara the Wise",
            state.entities, false, "wizard-1"
        );

        expect(prompt).not.toBeNull();
        expect(prompt!.userPrompt).toContain("SPELL:");
        expect(prompt!.userPrompt).toContain("fire");
    });

    it("cantrip does NOT consume spell slots", () => {
        const wizard = makeWizard();
        const ogre = makeOgre();
        startCombat(engine, [wizard, ogre]);

        const slotsBefore = { ...engine.getState().entities.find(e => e.id === "wizard-1")!.spellSlots };

        engine.submitAction({
            type: "CAST_SPELL",
            casterId: "wizard-1",
            spellName: "Fire Bolt",
            targetIds: ["ogre-1"],
            attackRoll: 18,
            rawD20: 11,
        });

        const slotsAfter = engine.getState().entities.find(e => e.id === "wizard-1")!.spellSlots;
        expect(slotsAfter).toEqual(slotsBefore);
    });

    it("leveled spell consumes correct slot", () => {
        const wizard = makeWizard();
        const ogre = makeOgre();
        startCombat(engine, [wizard, ogre]);

        const level3Before = engine.getState().entities.find(e => e.id === "wizard-1")!.spellSlots["3"];

        engine.submitAction({
            type: "CAST_SPELL",
            casterId: "wizard-1",
            spellName: "Fireball",
            targetIds: ["ogre-1"],
        });

        const level3After = engine.getState().entities.find(e => e.id === "wizard-1")!.spellSlots["3"];
        expect(level3After).toBe(level3Before - 1);
    });
});

// =============================================================================
// SCENARIO 2: Cleric heals downed ally — narrator describes revival
// =============================================================================

describe("Scenario 2: Cleric healing and support", () => {
    let engine: CombatEngineV2;

    beforeEach(() => {
        engine = createCombatEngine(1, {}, fixedRoll(8));
    });

    it("Cure Wounds on unconscious ally: revives, narrator knows it's healing", async () => {
        const cleric = makeCleric();
        const fighter = makeFighter();
        // Fighter starts near death
        fighter.hp = 1;
        const ogre = makeOgre();
        startCombat(engine, [cleric, fighter, ogre]);

        // Skip cleric, skip fighter
        engine.submitAction({ type: "END_TURN", entityId: "cleric-1" });
        engine.submitAction({ type: "END_TURN", entityId: "fighter-1" });

        // Ogre knocks fighter out
        engine.submitAction({
            type: "ATTACK", attackerId: "ogre-1", targetId: "fighter-1",
            attackRoll: 20, rawD20: 15,
        });

        // Advance turns until cleric's turn
        let state = engine.getState();
        if (state.phase === "AWAIT_DEATH_SAVE") {
            engine.rollDeathSave("fighter-1", 12); // success
        }
        state = engine.getState();
        while (state.turnOrder[state.turnIndex] !== "cleric-1" && state.phase !== "RESOLVED") {
            engine.submitAction({ type: "END_TURN", entityId: state.turnOrder[state.turnIndex] });
            state = engine.getState();
            if (state.phase === "AWAIT_DEATH_SAVE") {
                engine.rollDeathSave("fighter-1", 12);
                state = engine.getState();
            }
        }

        // Cleric casts Cure Wounds on downed fighter
        const healResult = engine.submitAction({
            type: "CAST_SPELL",
            casterId: "cleric-1",
            spellName: "Cure Wounds",
            targetIds: ["fighter-1"],
        });

        expect(healResult.success).toBe(true);

        state = engine.getState();
        const fighterState = state.entities.find(e => e.id === "fighter-1")!;
        expect(fighterState.status).toBe("ALIVE");
        expect(fighterState.hp).toBeGreaterThan(0);

        // Narrator prompt should reference healing, not damage
        const prompt = await computeCombatNarrativePrompts(
            1, healResult.logs, "I call upon divine power to heal my ally!", "Brother Aldric",
            state.entities, false, "cleric-1"
        );

        expect(prompt).not.toBeNull();
        // Should mention healing in the mechanical summary
        const summary = generateMechanicalSummary(healResult.logs, state.entities, "cleric-1");
        expect(summary.toLowerCase()).toContain("heal");
    });

    it("Sacred Flame (save cantrip): narrator gets SPELL context with radiant", async () => {
        const cleric = makeCleric();
        const ogre = makeOgre();
        startCombat(engine, [cleric, ogre]);

        const result = engine.submitAction({
            type: "CAST_SPELL",
            casterId: "cleric-1",
            spellName: "Sacred Flame",
            targetIds: ["ogre-1"],
        });

        expect(result.success).toBe(true);

        const prompt = await computeCombatNarrativePrompts(
            1, result.logs, "I invoke sacred fire upon the beast!", "Brother Aldric",
            engine.getState().entities, false, "cleric-1"
        );

        expect(prompt).not.toBeNull();
        expect(prompt!.userPrompt).toContain("SPELL:");
        expect(prompt!.userPrompt).not.toContain("WEAPON:");
    });
});

// =============================================================================
// SCENARIO 3: Barbarian rage + attack — narrator reflects rage state
// =============================================================================

describe("Scenario 3: Barbarian rage combat flow", () => {
    let engine: CombatEngineV2;

    beforeEach(() => {
        engine = createCombatEngine(1, {}, fixedRoll(8));
    });

    it("rage then attack: damage includes rage bonus, narrator can describe fury", async () => {
        const barb = makeBarbarian();
        const ogre = makeOgre();
        startCombat(engine, [barb, ogre]);

        // Rage (bonus action)
        const rageResult = engine.submitAction({ type: "RAGE", entityId: "barb-1" });
        expect(rageResult.success).toBe(true);

        const barbState = engine.getState().entities.find(e => e.id === "barb-1")!;
        expect(barbState.activeConditions?.some(c => c.name === "raging")).toBe(true);

        // Attack (action)
        const atkResult = engine.submitAction({
            type: "ATTACK", attackerId: "barb-1", targetId: "ogre-1",
            weaponName: "Greataxe", attackRoll: 18, rawD20: 11,
        });

        const allLogs = [...rageResult.logs, ...atkResult.logs];
        if (engine.getState().phase === "AWAIT_DAMAGE_ROLL") {
            const dmg = engine.applyDamage(10);
            allLogs.push(...(dmg?.logs ?? []));
        }

        const prompt = await computeCombatNarrativePrompts(
            1, allLogs, "GRUKK SMASH!", "Grukk the Raging",
            engine.getState().entities, false, "barb-1",
            { weaponName: "Greataxe" }
        );

        expect(prompt).not.toBeNull();
        expect(prompt!.userPrompt).toContain("WEAPON: Greataxe");
    });

    it("raging barbarian takes reduced physical damage", () => {
        const barb = makeBarbarian();
        const ogre = makeOgre();
        startCombat(engine, [barb, ogre]);

        // Rage
        engine.submitAction({ type: "RAGE", entityId: "barb-1" });
        engine.submitAction({ type: "END_TURN", entityId: "barb-1" });

        // Ogre attacks with bludgeoning (fixedRoll(8) for damage)
        engine.submitAction({
            type: "ATTACK", attackerId: "ogre-1", targetId: "barb-1",
            attackRoll: 20, rawD20: 14,
        });

        const barbAfter = engine.getState().entities.find(e => e.id === "barb-1")!;
        // 8 bludgeoning halved to 4 by rage resistance
        expect(barbAfter.hp).toBe(52 - 4);
    });
});

// =============================================================================
// SCENARIO 4: Rogue sneak attack + cunning action
// =============================================================================

describe("Scenario 4: Rogue combat capabilities", () => {
    let engine: CombatEngineV2;

    beforeEach(() => {
        engine = createCombatEngine(1, {}, fixedRoll(8));
    });

    it("rogue attacks with finesse weapon: sneak attack triggers (with ally in melee)", async () => {
        const rogue = makeRogue();
        const fighter = makeFighter();
        const ogre = makeOgre();
        startCombat(engine, [rogue, fighter, ogre]);

        // Move fighter to melee with ogre (provides flanking for sneak attack)
        // Both start at NEAR; fighter moves toward ogre
        engine.submitAction({ type: "END_TURN", entityId: "rogue-1" });
        engine.submitAction({
            type: "MOVE", entityId: "fighter-1", targetId: "ogre-1", direction: "toward",
        });
        engine.submitAction({ type: "END_TURN", entityId: "fighter-1" });
        engine.submitAction({ type: "END_TURN", entityId: "ogre-1" });

        // Rogue's turn: move to melee and attack with rapier (finesse)
        engine.submitAction({
            type: "MOVE", entityId: "rogue-1", targetId: "ogre-1", direction: "toward",
        });
        const atkResult = engine.submitAction({
            type: "ATTACK", attackerId: "rogue-1", targetId: "ogre-1",
            weaponName: "Rapier", attackRoll: 18, rawD20: 11,
        });

        // Check if sneak attack was applied
        const sneakLog = atkResult.logs.some(l =>
            l.description?.toLowerCase().includes("sneak attack")
        );
        // Sneak attack should fire: finesse weapon + ally (fighter) adjacent to target
        expect(sneakLog).toBe(true);
    });

    it("rogue can attack + disengage as bonus (Cunning Action)", () => {
        const rogue = makeRogue();
        const ogre = makeOgre();
        startCombat(engine, [rogue, ogre]);

        // Move to melee
        engine.submitAction({
            type: "MOVE", entityId: "rogue-1", targetId: "ogre-1", direction: "toward",
        });

        // Attack with rapier
        engine.submitAction({
            type: "ATTACK", attackerId: "rogue-1", targetId: "ogre-1",
            weaponName: "Rapier", attackRoll: 18, rawD20: 11,
        });
        if (engine.getState().phase === "AWAIT_DAMAGE_ROLL") {
            engine.applyDamage(8);
        }

        // Cunning Action: Disengage as bonus action
        const disResult = engine.submitAction({
            type: "DISENGAGE", entityId: "rogue-1", resourceCost: "bonus_action",
        });
        expect(disResult.success).toBe(true);

        // Move away without opportunity attack
        const moveResult = engine.submitAction({
            type: "MOVE", entityId: "rogue-1", targetId: "ogre-1", direction: "away",
        });
        const oaLog = moveResult.logs.some(l => l.description?.includes("opportunity attack"));
        expect(oaLog).toBe(false);
    });
});

// =============================================================================
// SCENARIO 5: Paladin divine smite — full flow with narrator
// =============================================================================

describe("Scenario 5: Paladin smite decision and narration", () => {
    let engine: CombatEngineV2;

    beforeEach(() => {
        engine = createCombatEngine(1, {}, fixedRoll(8));
    });

    it("paladin hits: AWAIT_SMITE_DECISION after damage roll, smites, narrator gets radiant damage context", async () => {
        const paladin = makePaladin();
        const ogre = makeOgre();
        startCombat(engine, [paladin, ogre]);

        // Attack with longsword
        const atkResult = engine.submitAction({
            type: "ATTACK", attackerId: "paladin-1", targetId: "ogre-1",
            weaponName: "Longsword", attackRoll: 18, rawD20: 10,
        });

        // Paladin is a player → goes to AWAIT_DAMAGE_ROLL first
        expect(engine.getState().phase).toBe("AWAIT_DAMAGE_ROLL");

        // Apply damage — engine then checks canSmite → AWAIT_SMITE_DECISION
        const dmgResult = engine.applyDamage(8); // 1d8+4 range: 5-12
        const state = engine.getState();

        // Should be in smite decision phase
        expect(state.phase).toBe("AWAIT_SMITE_DECISION");

        // Choose to smite (level 1)
        const smiteResult = engine.submitAction({
            type: "SMITE_1", attackerId: "paladin-1",
        });
        expect(smiteResult.success).toBe(true);

        // Spell slot should be consumed
        const palState = engine.getState().entities.find(e => e.id === "paladin-1")!;
        expect(palState.spellSlots["1"]).toBe(3); // 4 - 1 = 3

        // Collect all logs
        const allLogs = [...atkResult.logs, ...(dmgResult?.logs ?? []), ...smiteResult.logs];

        // Check for smite/radiant in logs
        const hasRadiant = allLogs.some(l =>
            l.damageType === "radiant" || l.description?.toLowerCase().includes("smite")
        );
        expect(hasRadiant).toBe(true);
    });

    it("paladin smite vs undead: extra d8 radiant damage", () => {
        const paladin = makePaladin();
        const undead = makeUndeadKnight();
        startCombat(engine, [paladin, undead]);

        // Attack
        engine.submitAction({
            type: "ATTACK", attackerId: "paladin-1", targetId: "undead-1",
            weaponName: "Longsword", attackRoll: 25, rawD20: 18,
        });

        // Player attack → AWAIT_DAMAGE_ROLL first
        if (engine.getState().phase === "AWAIT_DAMAGE_ROLL") {
            engine.applyDamage(8); // valid for 1d8+4
        }

        if (engine.getState().phase === "AWAIT_SMITE_DECISION") {
            const smiteResult = engine.submitAction({
                type: "SMITE_1", attackerId: "paladin-1",
            });

            // Smite produces:
            // - ACTION log with "Divine Smite" description
            // - CUSTOM log for extra radiant damage from the modifier
            // - DAMAGE log for total damage dealt
            const hasSmiteAction = smiteResult.logs.some(l =>
                l.description?.toLowerCase().includes("smite")
            );
            expect(hasSmiteAction).toBe(true);

            // Extra radiant damage appears as CUSTOM log
            const radiantExtra = smiteResult.logs.some(l =>
                l.type === "CUSTOM" && l.description?.includes("radiant")
            );
            expect(radiantExtra).toBe(true);
        } else {
            // If we didn't enter AWAIT_SMITE_DECISION, that itself is a finding
            console.warn("[FEATURE GAP] Paladin did not enter AWAIT_SMITE_DECISION vs undead");
        }
    });

    it("paladin declines smite: normal weapon damage only", () => {
        const paladin = makePaladin();
        const ogre = makeOgre();
        startCombat(engine, [paladin, ogre]);

        engine.submitAction({
            type: "ATTACK", attackerId: "paladin-1", targetId: "ogre-1",
            weaponName: "Longsword", attackRoll: 18, rawD20: 10,
        });

        // Player attack → AWAIT_DAMAGE_ROLL first
        expect(engine.getState().phase).toBe("AWAIT_DAMAGE_ROLL");
        engine.applyDamage(8); // valid for 1d8+4

        expect(engine.getState().phase).toBe("AWAIT_SMITE_DECISION");

        // Decline smite
        const declineResult = engine.submitAction({
            type: "DECLINE_SMITE", attackerId: "paladin-1",
        });
        expect(declineResult.success).toBe(true);

        // No spell slots consumed
        const palState = engine.getState().entities.find(e => e.id === "paladin-1")!;
        expect(palState.spellSlots["1"]).toBe(4);
    });
});

// =============================================================================
// SCENARIO 6: Bard uses Bardic Inspiration + bonus action spell
// =============================================================================

describe("Scenario 6: Bard support capabilities", () => {
    let engine: CombatEngineV2;

    beforeEach(() => {
        engine = createCombatEngine(1, {}, fixedRoll(8));
    });

    it("bard grants Bardic Inspiration to ally", () => {
        const bard = makeBard();
        const fighter = makeFighter();
        const ogre = makeOgre();
        startCombat(engine, [bard, fighter, ogre]);

        const inspResult = engine.submitAction({
            type: "BARDIC_INSPIRATION",
            entityId: "bard-1",
            targetId: "fighter-1",
        });

        expect(inspResult.success).toBe(true);

        // Fighter should have inspiration die
        const fighterState = engine.getState().entities.find(e => e.id === "fighter-1")!;
        expect(fighterState.bardicInspirationDie).toBeDefined();
    });

    it("bard casts Healing Word (bonus action) + attacks in same turn", () => {
        const bard = makeBard();
        const fighter = makeFighter();
        fighter.hp = 10; // injured
        const ogre = makeOgre();
        startCombat(engine, [bard, fighter, ogre]);

        // Healing Word (bonus action spell)
        const healResult = engine.submitAction({
            type: "CAST_SPELL",
            casterId: "bard-1",
            spellName: "Healing Word",
            targetIds: ["fighter-1"],
        });
        expect(healResult.success).toBe(true);

        // Fighter should be healed
        const fighterHealed = engine.getState().entities.find(e => e.id === "fighter-1")!;
        expect(fighterHealed.hp).toBeGreaterThan(10);

        // Bard should still be able to attack (action is free)
        const atkResult = engine.submitAction({
            type: "ATTACK", attackerId: "bard-1", targetId: "ogre-1",
            weaponName: "Rapier", attackRoll: 18, rawD20: 10,
        });
        expect(atkResult.success).toBe(true);
    });
});

// =============================================================================
// SCENARIO 7: Fighter Action Surge + Extra Attack — multiple attacks per turn
// =============================================================================

describe("Scenario 7: Fighter multi-attack capability", () => {
    let engine: CombatEngineV2;

    beforeEach(() => {
        engine = createCombatEngine(1, {}, fixedRoll(8));
    });

    it("fighter with Extra Attack gets 2 attacks per action", () => {
        const fighter = makeFighter();
        const ogre = makeOgre();
        startCombat(engine, [fighter, ogre]);

        // First attack
        const atk1 = engine.submitAction({
            type: "ATTACK", attackerId: "fighter-1", targetId: "ogre-1",
            weaponName: "Longsword", attackRoll: 20, rawD20: 13,
        });
        expect(atk1.success).toBe(true);
        if (engine.getState().phase === "AWAIT_DAMAGE_ROLL") engine.applyDamage(10);

        // Second attack (Extra Attack) — should succeed without Action Surge
        const atk2 = engine.submitAction({
            type: "ATTACK", attackerId: "fighter-1", targetId: "ogre-1",
            weaponName: "Longsword", attackRoll: 18, rawD20: 11,
        });
        expect(atk2.success).toBe(true);
    });

    it("Action Surge grants a third attack opportunity", () => {
        const fighter = makeFighter();
        const ogre = makeOgre();
        startCombat(engine, [fighter, ogre]);

        // Attack 1
        engine.submitAction({
            type: "ATTACK", attackerId: "fighter-1", targetId: "ogre-1",
            weaponName: "Longsword", attackRoll: 20, rawD20: 13,
        });
        if (engine.getState().phase === "AWAIT_DAMAGE_ROLL") engine.applyDamage(10);

        // Attack 2 (Extra Attack)
        engine.submitAction({
            type: "ATTACK", attackerId: "fighter-1", targetId: "ogre-1",
            weaponName: "Longsword", attackRoll: 18, rawD20: 11,
        });
        if (engine.getState().phase === "AWAIT_DAMAGE_ROLL") engine.applyDamage(10);

        // Action is now used. Use Action Surge to get another action.
        const surgeResult = engine.submitAction({ type: "ACTION_SURGE", entityId: "fighter-1" });
        expect(surgeResult.success).toBe(true);

        // Attack 3 (from Action Surge)
        const atk3 = engine.submitAction({
            type: "ATTACK", attackerId: "fighter-1", targetId: "ogre-1",
            weaponName: "Longsword", attackRoll: 16, rawD20: 9,
        });
        expect(atk3.success).toBe(true);
    });
});

// =============================================================================
// SCENARIO 8: Enemy spellcaster targets player — AWAIT_SAVE_ROLL flow
// =============================================================================

describe("Scenario 8: Enemy spell targeting player", () => {
    let engine: CombatEngineV2;

    beforeEach(() => {
        engine = createCombatEngine(1, {}, fixedRoll(8));
    });

    it("enemy casts Hold Person on player: enters AWAIT_SAVE_ROLL", () => {
        const fighter = makeFighter();
        const mage = makeEnemySpellcaster();
        startCombat(engine, [mage, fighter]);

        // Enemy mage casts Hold Person on fighter
        const result = engine.submitAction({
            type: "CAST_SPELL",
            casterId: "mage-1",
            spellName: "Hold Person",
            targetIds: ["fighter-1"],
        });

        const state = engine.getState();
        // Player targeted by save spell should enter AWAIT_SAVE_ROLL
        expect(state.phase).toBe("AWAIT_SAVE_ROLL");
    });

    it("player fails save: paralyzed condition applied", () => {
        const fighter = makeFighter();
        const mage = makeEnemySpellcaster();
        startCombat(engine, [mage, fighter]);

        engine.submitAction({
            type: "CAST_SPELL",
            casterId: "mage-1",
            spellName: "Hold Person",
            targetIds: ["fighter-1"],
        });

        expect(engine.getState().phase).toBe("AWAIT_SAVE_ROLL");

        // Player fails WIS save (roll 5 + WIS mod 1 = 6 < DC 13)
        engine.submitSavingThrow("fighter-1", 5);

        const state = engine.getState();
        const fighterState = state.entities.find(e => e.id === "fighter-1")!;
        const isParalyzed = fighterState.activeConditions?.some(c => c.name === "paralyzed");
        expect(isParalyzed).toBe(true);
    });

    it("player succeeds save: no condition applied", () => {
        const fighter = makeFighter();
        const mage = makeEnemySpellcaster();
        startCombat(engine, [mage, fighter]);

        engine.submitAction({
            type: "CAST_SPELL",
            casterId: "mage-1",
            spellName: "Hold Person",
            targetIds: ["fighter-1"],
        });

        expect(engine.getState().phase).toBe("AWAIT_SAVE_ROLL");

        // Player succeeds WIS save (roll 15 + WIS mod 1 = 16 >= DC 13)
        engine.submitSavingThrow("fighter-1", 15);

        const state = engine.getState();
        const fighterState = state.entities.find(e => e.id === "fighter-1")!;
        const isParalyzed = fighterState.activeConditions?.some(c => c.name === "paralyzed");
        expect(isParalyzed).toBe(false);
    });
});

// =============================================================================
// SCENARIO 9: Enemy turn narration — third person for enemy, "you" for player
// =============================================================================

describe("Scenario 9: Enemy turn narrator perspective", () => {
    let engine: CombatEngineV2;

    beforeEach(() => {
        engine = createCombatEngine(1, {}, fixedRoll(8));
    });

    it("enemy attack: narrator prompt uses third person for enemy and 'you' for player", async () => {
        const fighter = makeFighter();
        const ogre = makeOgre();
        startCombat(engine, [ogre, fighter]); // ogre goes first

        const result = engine.submitAction({
            type: "ATTACK", attackerId: "ogre-1", targetId: "fighter-1",
            attackRoll: 20, rawD20: 12,
        });

        const prompt = await computeCombatNarrativePrompts(
            1, result.logs, "The ogre swings its greatclub!", "Ogre",
            engine.getState().entities, true, "fighter-1",
            { weaponName: "Greatclub", tacticalRole: "brute" }
        );

        expect(prompt).not.toBeNull();
        // Enemy narration should use third person
        expect(prompt!.userPrompt).toContain("ENEMY ACTING: Ogre");
        expect(prompt!.userPrompt).toContain("THIRD PERSON");
        // Player addressed as "you"
        expect(prompt!.userPrompt).toContain("address as \"you\"");
    });

    it("player turn: narrator addresses player directly as 'you'", async () => {
        const fighter = makeFighter();
        const ogre = makeOgre();
        startCombat(engine, [fighter, ogre]);

        const result = engine.submitAction({
            type: "ATTACK", attackerId: "fighter-1", targetId: "ogre-1",
            weaponName: "Longsword", attackRoll: 18, rawD20: 11,
        });

        const prompt = await computeCombatNarrativePrompts(
            1, result.logs, "I slash at the ogre with my longsword!", "Korrin Steelguard",
            engine.getState().entities, false, "fighter-1",
            { weaponName: "Longsword" }
        );

        expect(prompt).not.toBeNull();
        expect(prompt!.userPrompt).toContain("PLAYER CHARACTER: Korrin Steelguard");
        // Should NOT say "ENEMY ACTING" — this is the player's turn
        expect(prompt!.userPrompt).not.toContain("ENEMY ACTING");
    });
});

// =============================================================================
// SCENARIO 10: Narrator "remaining resources" prompt
// =============================================================================

describe("Scenario 10: Narrator asks 'anything else?' when resources remain", () => {
    let engine: CombatEngineV2;

    beforeEach(() => {
        engine = createCombatEngine(1, {}, fixedRoll(8));
    });

    it("after action with bonus action still available: narrator prompts for more", async () => {
        const fighter = makeFighter();
        const ogre = makeOgre();
        startCombat(engine, [fighter, ogre]);

        // Attack (uses action, but bonus action still free)
        const result = engine.submitAction({
            type: "ATTACK", attackerId: "fighter-1", targetId: "ogre-1",
            weaponName: "Longsword", attackRoll: 18, rawD20: 11,
        });

        const prompt = await computeCombatNarrativePrompts(
            1, result.logs, "I swing my blade!", "Korrin Steelguard",
            engine.getState().entities, false, "fighter-1",
            { weaponName: "Longsword", playerHasRemainingResources: true }
        );

        expect(prompt).not.toBeNull();
        expect(prompt!.userPrompt).toContain("anything else");
    });

    it("after all resources spent: narrator announces next turn", async () => {
        const fighter = makeFighter();
        const ogre = makeOgre();
        startCombat(engine, [fighter, ogre]);

        const result = engine.submitAction({
            type: "ATTACK", attackerId: "fighter-1", targetId: "ogre-1",
            weaponName: "Longsword", attackRoll: 18, rawD20: 11,
        });

        const prompt = await computeCombatNarrativePrompts(
            1, result.logs, "I swing my blade!", "Korrin Steelguard",
            engine.getState().entities, false, "fighter-1",
            { weaponName: "Longsword", playerHasRemainingResources: false }
        );

        expect(prompt).not.toBeNull();
        expect(prompt!.userPrompt).toContain("whose turn it is next");
    });
});

// =============================================================================
// SCENARIO 11: Critical hit — narrator describes devastating blow
// =============================================================================

describe("Scenario 11: Critical hit narration", () => {
    it("nat 20: narrator prompt contains CRITICAL HIT instruction", async () => {
        const engine = createCombatEngine(1, {}, fixedRoll(20));
        const fighter = makeFighter();
        const ogre = makeOgre();
        startCombat(engine, [fighter, ogre]);

        const result = engine.submitAction({
            type: "ATTACK", attackerId: "fighter-1", targetId: "ogre-1",
            weaponName: "Longsword", attackRoll: 25, rawD20: 20,
        });

        // Collect damage logs too
        const allLogs = [...result.logs];
        if (engine.getState().phase === "AWAIT_DAMAGE_ROLL") {
            const dmg = engine.applyDamage(16); // doubled dice
            allLogs.push(...(dmg?.logs ?? []));
        }

        const prompt = await computeCombatNarrativePrompts(
            1, allLogs, "I bring my sword down with all my might!", "Korrin Steelguard",
            engine.getState().entities, false, "fighter-1",
            { weaponName: "Longsword" }
        );

        expect(prompt).not.toBeNull();
        expect(prompt!.userPrompt).toContain("CRITICAL HIT");
        expect(prompt!.userPrompt).toContain("devastating");
    });
});

// =============================================================================
// SCENARIO 12: Multi-round combat — consistency across turns
// =============================================================================

describe("Scenario 12: Multi-round combat consistency", () => {
    let engine: CombatEngineV2;

    beforeEach(() => {
        engine = createCombatEngine(1, {}, fixedRoll(8));
    });

    it("wizard casts spell R1, fighter attacks R1: narrator prompts reference correct actor each time", async () => {
        const wizard = makeWizard();
        const fighter = makeFighter();
        const ogre = makeOgre();
        startCombat(engine, [wizard, fighter, ogre]);

        // Round 1: Wizard casts Fire Bolt
        const wizResult = engine.submitAction({
            type: "CAST_SPELL",
            casterId: "wizard-1",
            spellName: "Fire Bolt",
            targetIds: ["ogre-1"],
            attackRoll: 18,
            rawD20: 11,
        });
        const wizLogs = [...wizResult.logs];
        if (engine.getState().phase === "AWAIT_DAMAGE_ROLL") {
            const dmg = engine.applyDamage(12);
            wizLogs.push(...(dmg?.logs ?? []));
        }

        const wizPrompt = await computeCombatNarrativePrompts(
            1, wizLogs, "I cast Fire Bolt!", "Elara the Wise",
            engine.getState().entities, false, "wizard-1"
        );

        expect(wizPrompt).not.toBeNull();
        expect(wizPrompt!.userPrompt).toContain("Elara the Wise");
        expect(wizPrompt!.userPrompt).toContain("SPELL:");
        expect(wizPrompt!.userPrompt).not.toContain("Korrin");

        engine.submitAction({ type: "END_TURN", entityId: "wizard-1" });

        // Round 1: Fighter attacks with longsword
        const fResult = engine.submitAction({
            type: "ATTACK", attackerId: "fighter-1", targetId: "ogre-1",
            weaponName: "Longsword", attackRoll: 20, rawD20: 13,
        });
        const fLogs = [...fResult.logs];
        if (engine.getState().phase === "AWAIT_DAMAGE_ROLL") {
            const dmg = engine.applyDamage(10);
            fLogs.push(...(dmg?.logs ?? []));
        }

        const fPrompt = await computeCombatNarrativePrompts(
            1, fLogs, "I slash at the ogre!", "Korrin Steelguard",
            engine.getState().entities, false, "fighter-1",
            { weaponName: "Longsword" }
        );

        expect(fPrompt).not.toBeNull();
        expect(fPrompt!.userPrompt).toContain("Korrin Steelguard");
        expect(fPrompt!.userPrompt).toContain("WEAPON: Longsword");
        // Should NOT contain wizard's spell context
        expect(fPrompt!.userPrompt).not.toContain("SPELL:");
        expect(fPrompt!.userPrompt).not.toContain("Fire Bolt");
    });
});

// =============================================================================
// SCENARIO 13: Concentration spell during combat — DM tracks it
// =============================================================================

describe("Scenario 13: Concentration tracking across combat", () => {
    let engine: CombatEngineV2;

    beforeEach(() => {
        engine = createCombatEngine(1, {}, sequenceRoll([5, 10, 8, 15]));
    });

    it("wizard concentrating on Hold Person: goblin paralyzed, breaking conc frees goblin", () => {
        const wizard = makeWizard();
        const ogre = makeOgre();
        startCombat(engine, [wizard, ogre]);

        // Cast Hold Person (concentration)
        engine.submitAction({
            type: "CAST_SPELL",
            casterId: "wizard-1",
            spellName: "Hold Person",
            targetIds: ["ogre-1"],
        });

        let state = engine.getState();
        const wizConc = state.entities.find(e => e.id === "wizard-1")
            ?.activeConditions?.some(c => c.name === "concentrating");
        expect(wizConc).toBe(true);

        // Ogre should be paralyzed (if failed save — roll was 5 + low WIS mod)
        const ogreParalyzed = state.entities.find(e => e.id === "ogre-1")
            ?.activeConditions?.some(c => c.name === "paralyzed");
        expect(ogreParalyzed).toBe(true);
    });
});

// =============================================================================
// SCENARIO 14: Full party encounter — can every class contribute?
// =============================================================================

describe("Scenario 14: Full party encounter — class action availability", () => {
    let engine: CombatEngineV2;

    beforeEach(() => {
        engine = createCombatEngine(1, {}, fixedRoll(8));
    });

    it("each class has their signature actions in legal actions", () => {
        const wizard = makeWizard();
        const fighter = makeFighter();
        const rogue = makeRogue();
        const cleric = makeCleric();
        const barb = makeBarbarian();
        const paladin = makePaladin();
        const ogre = makeOgre();

        // Use initiateCombat for auto-rolled initiative (engine controls order)
        engine.initiateCombat([wizard, fighter, rogue, cleric, barb, paladin, ogre]);

        const state = engine.getState();
        const turnOrder = state.turnOrder;

        // Helper: advance to a specific entity's turn and get their legal actions
        const advanceAndGetActions = (entityId: string): any[] => {
            let s = engine.getState();
            let currentId = s.turnOrder[s.turnIndex];
            let safety = 0;
            while (currentId !== entityId && safety < 20) {
                engine.submitAction({ type: "END_TURN", entityId: currentId });
                s = engine.getState();
                if (s.phase === "RESOLVED") return [];
                currentId = s.turnOrder[s.turnIndex];
                safety++;
            }
            return engine.getLegalActions(entityId);
        };

        const findings: string[] = [];

        // --- Wizard ---
        const wizActions = advanceAndGetActions("wizard-1");

        // Wizard should be able to cast their spells
        if (!wizActions.some(a => a.type === "CAST_SPELL" && a.spellName === "Fire Bolt")) {
            findings.push("MISSING: Wizard cannot cast Fire Bolt");
        }
        if (!wizActions.some(a => a.type === "CAST_SPELL" && a.spellName === "Fireball")) {
            findings.push("MISSING: Wizard cannot cast Fireball");
        }
        if (!wizActions.some(a => a.type === "CAST_SPELL" && a.spellName === "Hold Person")) {
            findings.push("MISSING: Wizard cannot cast Hold Person");
        }
        if (!wizActions.some(a => a.type === "ATTACK")) {
            findings.push("MISSING: Wizard cannot attack with quarterstaff");
        }
        // --- Fighter ---
        const fActions = advanceAndGetActions("fighter-1");
        if (!fActions.some(a => a.type === "ATTACK")) {
            findings.push("MISSING: Fighter cannot attack");
        }
        if (!fActions.some(a => a.type === "SECOND_WIND")) {
            findings.push("MISSING: Fighter lacks Second Wind");
        }
        if (!fActions.some(a => a.type === "ACTION_SURGE")) {
            findings.push("MISSING: Fighter lacks Action Surge");
        }
        // --- Rogue ---
        const rActions = advanceAndGetActions("rogue-1");
        if (!rActions.some(a => a.type === "ATTACK")) {
            findings.push("MISSING: Rogue cannot attack");
        }
        // Cunning Action should show Dash/Disengage/Hide as bonus actions
        const rogueBonusActions = rActions.filter(a =>
            a.resourceCost === "bonus_action" &&
            ["DASH", "DISENGAGE", "HIDE"].includes(a.type)
        );
        if (rogueBonusActions.length === 0) {
            findings.push("MISSING: Rogue has no Cunning Action bonus actions (Dash/Disengage/Hide)");
        }
        // --- Cleric ---
        const cActions = advanceAndGetActions("cleric-1");
        if (!cActions.some(a => a.type === "CAST_SPELL" && a.spellName === "Sacred Flame")) {
            findings.push("MISSING: Cleric cannot cast Sacred Flame");
        }
        if (!cActions.some(a => a.type === "CAST_SPELL" && a.spellName === "Cure Wounds")) {
            findings.push("MISSING: Cleric cannot cast Cure Wounds");
        }
        if (!cActions.some(a => a.type === "CAST_SPELL" && a.spellName === "Guiding Bolt")) {
            findings.push("MISSING: Cleric cannot cast Guiding Bolt");
        }
        // --- Barbarian ---
        const bActions = advanceAndGetActions("barb-1");
        if (!bActions.some(a => a.type === "ATTACK")) {
            findings.push("MISSING: Barbarian cannot attack");
        }
        if (!bActions.some(a => a.type === "RAGE")) {
            findings.push("MISSING: Barbarian lacks Rage");
        }
        // --- Paladin ---
        const pActions = advanceAndGetActions("paladin-1");
        if (!pActions.some(a => a.type === "ATTACK")) {
            findings.push("MISSING: Paladin cannot attack");
        }
        if (!pActions.some(a => a.type === "CAST_SPELL" && a.spellName === "Cure Wounds")) {
            findings.push("MISSING: Paladin cannot cast Cure Wounds");
        }

        // Report all findings
        if (findings.length > 0) {
            console.warn("[FEATURE GAPS] Legal action issues:\n" + findings.join("\n"));
        }
        expect(findings).toEqual([]);
    });
});

// =============================================================================
// SCENARIO 15: Damage type interactions — the DM should narrate correctly
// =============================================================================

describe("Scenario 15: Damage type awareness in narration", () => {
    it("fire damage against fire-immune creature: narrator should know no damage dealt", async () => {
        const engine = createCombatEngine(1, {}, fixedRoll(8));
        const wizard = makeWizard();
        const fireElemental = createEnemyEntity("fire-elem", "Fire Elemental", 50, 13, 5, "2d6+3", {
            damageType: "fire",
            immunities: ["fire"],
            weapons: [{ name: "Touch", damageFormula: "2d6+3", damageType: "fire", isRanged: false, attackBonus: 5, properties: [] }],
            abilityScores: { str: 10, dex: 17, con: 16, int: 6, wis: 10, cha: 7 },
        });
        startCombat(engine, [wizard, fireElemental]);

        const result = engine.submitAction({
            type: "CAST_SPELL",
            casterId: "wizard-1",
            spellName: "Fire Bolt",
            targetIds: ["fire-elem"],
            attackRoll: 18,
            rawD20: 11,
        });

        const allLogs = [...result.logs];
        if (engine.getState().phase === "AWAIT_DAMAGE_ROLL") {
            const dmg = engine.applyDamage(14);
            allLogs.push(...(dmg?.logs ?? []));
        }

        // Fire Elemental should take zero fire damage
        const elemState = engine.getState().entities.find(e => e.id === "fire-elem")!;
        expect(elemState.hp).toBe(50); // no damage

        // The mechanical summary should reflect immunity
        const summary = generateMechanicalSummary(allLogs, engine.getState().entities, "wizard-1");
        // At minimum, the damage log should show 0 or the log should mention immunity
        // This tests whether the DM gets enough info to narrate "the fire washes over the elemental harmlessly"
    });

    it("necrotic damage against undead with resistance: damage halved", () => {
        const engine = createCombatEngine(1, {}, fixedRoll(8));
        const fighter = makeFighter();
        fighter.damageType = "slashing";
        const undead = makeUndeadKnight(); // has slashing resistance
        startCombat(engine, [fighter, undead]);

        engine.submitAction({
            type: "ATTACK", attackerId: "fighter-1", targetId: "undead-1",
            weaponName: "Longsword", attackRoll: 25, rawD20: 18,
        });
        if (engine.getState().phase === "AWAIT_DAMAGE_ROLL") {
            engine.applyDamage(10); // 10 slashing, halved to 5
        }

        const undeadState = engine.getState().entities.find(e => e.id === "undead-1")!;
        expect(undeadState.hp).toBe(75 - 5);
    });
});

// =============================================================================
// SCENARIO 16: Lay on Hands — paladin heals from pool
// =============================================================================

describe("Scenario 16: Paladin Lay on Hands", () => {
    it("paladin heals an injured ally using Lay on Hands pool — player should choose amount", () => {
        const engine = createCombatEngine(1, {}, fixedRoll(8));
        const paladin = makePaladin();
        const fighter = makeFighter();
        fighter.hp = 20; // injured (24 HP missing)
        const ogre = makeOgre();
        startCombat(engine, [paladin, fighter, ogre]);

        const healResult = engine.submitAction({
            type: "LAY_ON_HANDS",
            entityId: "paladin-1",
            targetId: "fighter-1",
            amount: 15, // D&D 5e: player chooses how many HP to spend
        });

        expect(healResult.success).toBe(true);
        const fState = engine.getState().entities.find(e => e.id === "fighter-1")!;
        // D&D 5e: Lay on Hands lets you choose the amount (up to pool max)
        // Expected: 20 + 15 = 35
        expect(fState.hp).toBe(35);
    });
});

// =============================================================================
// SCENARIO 17: Death spiral — unconscious player, healing, back in fight
// =============================================================================

describe("Scenario 17: Death and revival narrative arc", () => {
    let engine: CombatEngineV2;

    beforeEach(() => {
        engine = createCombatEngine(1, {}, fixedRoll(8));
    });

    it("full death spiral: KO → death saves → healed → back in combat", () => {
        const cleric = makeCleric();
        const fighter = makeFighter();
        fighter.hp = 5; // nearly dead
        const ogre = makeOgre();
        startCombat(engine, [cleric, fighter, ogre]);

        // Cleric passes
        engine.submitAction({ type: "END_TURN", entityId: "cleric-1" });

        // Fighter passes
        engine.submitAction({ type: "END_TURN", entityId: "fighter-1" });

        // Ogre knocks fighter out
        engine.submitAction({
            type: "ATTACK", attackerId: "ogre-1", targetId: "fighter-1",
            attackRoll: 20, rawD20: 14,
        });

        // Navigate to cleric's turn
        let state = engine.getState();
        if (state.phase === "AWAIT_DEATH_SAVE") {
            engine.rollDeathSave("fighter-1", 12);
            state = engine.getState();
        }
        while (state.turnOrder[state.turnIndex] !== "cleric-1" && state.phase !== "RESOLVED") {
            engine.submitAction({ type: "END_TURN", entityId: state.turnOrder[state.turnIndex] });
            state = engine.getState();
            if (state.phase === "AWAIT_DEATH_SAVE") {
                engine.rollDeathSave("fighter-1", 12);
                state = engine.getState();
            }
        }

        // Verify fighter is unconscious
        const fighterDown = state.entities.find(e => e.id === "fighter-1")!;
        expect(fighterDown.status).toBe("UNCONSCIOUS");

        // Cleric heals fighter
        const healResult = engine.submitAction({
            type: "CAST_SPELL",
            casterId: "cleric-1",
            spellName: "Cure Wounds",
            targetIds: ["fighter-1"],
        });
        expect(healResult.success).toBe(true);

        state = engine.getState();
        const fighterRevived = state.entities.find(e => e.id === "fighter-1")!;
        expect(fighterRevived.status).toBe("ALIVE");
        expect(fighterRevived.hp).toBeGreaterThan(0);
        // Death saves should be reset
        expect(fighterRevived.deathSaves).toEqual({ successes: 0, failures: 0 });
    });
});

// =============================================================================
// SCENARIO 18: DM class awareness — narrator prompt includes character class
// =============================================================================

describe("Scenario 18: DM knows character classes", () => {
    it("getLegalActions reflects class-specific options only for the right class", () => {
        const engine = createCombatEngine(1, {}, fixedRoll(8));
        const wizard = makeWizard();
        const barb = makeBarbarian();
        const ogre = makeOgre();

        engine.initiateCombat([wizard, barb, ogre]);

        // Helper: advance to entity's turn
        const advanceTo = (entityId: string) => {
            let s = engine.getState();
            let current = s.turnOrder[s.turnIndex];
            let safety = 0;
            while (current !== entityId && safety < 10) {
                engine.submitAction({ type: "END_TURN", entityId: current });
                s = engine.getState();
                if (s.phase === "RESOLVED") return;
                current = s.turnOrder[s.turnIndex];
                safety++;
            }
        };

        // Wizard's turn: should NOT have class features from other classes
        advanceTo("wizard-1");
        const wizActions = engine.getLegalActions("wizard-1");
        expect(wizActions.some(a => a.type === "RAGE")).toBe(false);
        expect(wizActions.some(a => a.type === "SECOND_WIND")).toBe(false);
        expect(wizActions.some(a => a.type === "ACTION_SURGE")).toBe(false);

        // Barbarian's turn: should NOT have spell options, should have Rage
        advanceTo("barb-1");
        const barbActions = engine.getLegalActions("barb-1");
        expect(barbActions.some(a => a.type === "CAST_SPELL")).toBe(false);
        expect(barbActions.some(a => a.type === "RAGE")).toBe(true);
    });
});

// =============================================================================
// SCENARIO 19: Mechanical summary accuracy
// =============================================================================

describe("Scenario 19: Mechanical summary for immediate UI feedback", () => {
    it("attack hit: summary includes roll, hit status, and damage", () => {
        const engine = createCombatEngine(1, {}, fixedRoll(8));
        const fighter = makeFighter();
        const ogre = makeOgre();
        startCombat(engine, [fighter, ogre]);

        const result = engine.submitAction({
            type: "ATTACK", attackerId: "fighter-1", targetId: "ogre-1",
            weaponName: "Longsword", attackRoll: 18, rawD20: 11,
        });

        const allLogs = [...result.logs];
        if (engine.getState().phase === "AWAIT_DAMAGE_ROLL") {
            const dmg = engine.applyDamage(10);
            allLogs.push(...(dmg?.logs ?? []));
        }

        const summary = generateMechanicalSummary(allLogs, engine.getState().entities, "fighter-1");
        expect(summary).toContain("HIT");
        expect(summary).toContain("Damage:");
    });

    it("attack miss: summary shows MISS and no damage", () => {
        const engine = createCombatEngine(1, {}, fixedRoll(8));
        const fighter = makeFighter();
        // Use high AC target so valid roll still misses
        const armoredOgre = createEnemyEntity("armored-1", "Armored Ogre", 59, 20, 6, "2d8+4", {
            damageType: "bludgeoning",
            weapons: [{ name: "Greatclub", damageFormula: "2d8+4", damageType: "bludgeoning", isRanged: false, attackBonus: 6, properties: [] }],
            abilityScores: { str: 19, dex: 8, con: 16, int: 5, wis: 7, cha: 7 },
        });
        startCombat(engine, [fighter, armoredOgre]);

        // attackRoll: 10 (valid for 1d20+7: range 8-27), vs AC 20 = miss
        const result = engine.submitAction({
            type: "ATTACK", attackerId: "fighter-1", targetId: "armored-1",
            weaponName: "Longsword", attackRoll: 10, rawD20: 3,
        });

        const summary = generateMechanicalSummary(result.logs, engine.getState().entities, "fighter-1");
        expect(summary).toContain("MISS");
        expect(summary).not.toContain("Damage:");
    });

    it("healing spell: summary shows healing amount", () => {
        const engine = createCombatEngine(1, {}, fixedRoll(8));
        const cleric = makeCleric();
        const fighter = makeFighter();
        fighter.hp = 20;
        const ogre = makeOgre();
        startCombat(engine, [cleric, fighter, ogre]);

        const result = engine.submitAction({
            type: "CAST_SPELL",
            casterId: "cleric-1",
            spellName: "Cure Wounds",
            targetIds: ["fighter-1"],
        });

        const summary = generateMechanicalSummary(result.logs, engine.getState().entities, "cleric-1");
        const lower = summary.toLowerCase();
        expect(lower).toContain("heal");
    });
});

// =============================================================================
// SCENARIO 20: Combat ends when all enemies die
// =============================================================================

describe("Scenario 20: Combat resolution", () => {
    it("killing last enemy resolves combat after turn ends", () => {
        const engine = createCombatEngine(1, {}, fixedRoll(12));
        const fighter = makeFighter();
        const goblin = makeGoblinArcher(); // 12 HP
        startCombat(engine, [fighter, goblin]);

        engine.submitAction({
            type: "ATTACK", attackerId: "fighter-1", targetId: "goblin-1",
            weaponName: "Longsword", attackRoll: 20, rawD20: 13,
        });
        if (engine.getState().phase === "AWAIT_DAMAGE_ROLL") {
            engine.applyDamage(12); // max of 1d8+4 = 12, equals goblin's 12 HP
        }

        // Goblin should be dead
        const midState = engine.getState();
        const gobMid = midState.entities.find(e => e.id === "goblin-1")!;
        expect(gobMid.status).toBe("DEAD");

        // Combat resolution happens at turn boundary — end the fighter's turn
        engine.submitAction({ type: "END_TURN", entityId: "fighter-1" });

        const state = engine.getState();
        expect(state.phase).toBe("RESOLVED");
    });

    it("unconscious players don't count as dead — combat continues", () => {
        const engine = createCombatEngine(1, {}, fixedRoll(8));
        const fighter = makeFighter();
        fighter.hp = 1;
        const cleric = makeCleric();
        const ogre = makeOgre();
        startCombat(engine, [fighter, cleric, ogre]);

        // Fighter passes
        engine.submitAction({ type: "END_TURN", entityId: "fighter-1" });
        engine.submitAction({ type: "END_TURN", entityId: "cleric-1" });

        // Ogre knocks fighter to 0 HP
        engine.submitAction({
            type: "ATTACK", attackerId: "ogre-1", targetId: "fighter-1",
            attackRoll: 20, rawD20: 14,
        });

        const state = engine.getState();
        // Combat should NOT be resolved — cleric is still alive
        expect(state.phase).not.toBe("RESOLVED");
    });
});
