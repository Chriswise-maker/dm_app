/**
 * DM Knowledge Scenario Tests
 *
 * Verifies that the LLM DM receives correct, complete information in every
 * game context — so it can roleplay as a knowledgeable Dungeon Master.
 *
 * Tests are organized by game phase:
 *   A. Character sheet completeness (does the DM know who the player is?)
 *   B. Campaign context (does the DM know the world?)
 *   C. Combat prompts (does the DM get the right battlefield info?)
 *   D. Skill check narration (does the DM see the roll, DC, and result?)
 *   E. Rest mechanics (does the DM narrate resource recovery?)
 *   F. Combat narrator edge cases (killing blow, unconsciousness, death saves)
 *   G. Social encounters (disposition tracking)
 *   H. Shopping (item transactions)
 *
 * No LLM calls — all tests inspect prompt strings and formatted output.
 */

import { describe, it, expect, vi } from "vitest";

// Mock DB for narrator tests
vi.mock("../db", () => ({
    getUserSettings: vi.fn().mockResolvedValue({}),
}));

import {
    formatCharacterSheet,
    buildChatUserPrompt,
    buildCombatQueryPrompt,
    buildBattlefieldSnapshot,
    buildDMPrompt,
} from "../prompts";
import { resolveSkillCheck } from "../skill-check";
import {
    resolveShortRest,
    resolveLongRest,
    buildDefaultResourceState,
    detectHitDiceToSpend,
} from "../rest";
import { createCombatEngine, type RollFn } from "../combat/combat-engine-v2";
import {
    createPlayerEntity,
    createEnemyEntity,
    BattleStateSchema,
    RangeBand,
    type CombatEntity,
} from "../combat/combat-types";
import {
    computeCombatNarrativePrompts,
    generateMechanicalSummary,
    generateInitiativeNarrative,
} from "../combat/combat-narrator";

// =============================================================================
// FIXTURES
// =============================================================================

/** A rich character with actorSheet — what a real DB row looks like */
function createRichCharacter() {
    return {
        id: 1,
        sessionId: 77,
        name: "Thorin Oakenshield",
        className: "Fighter",
        level: 5,
        hpCurrent: 38,
        hpMax: 44,
        ac: 18,
        stats: JSON.stringify({ str: 18, dex: 12, con: 16, int: 10, wis: 14, cha: 8 }),
        inventory: JSON.stringify(["longsword", "shield", "chain mail", "explorer's pack"]),
        notes: "A dwarven warrior on a quest to reclaim his homeland.",
        actorSheet: JSON.stringify({
            characterClass: "Fighter",
            ancestry: "Dwarf",
            subclass: "Champion",
            background: "Soldier",
            level: 5,
            feats: ["Great Weapon Master"],
            abilityScores: { str: 18, dex: 12, con: 16, int: 10, wis: 14, cha: 8 },
            proficiencyBonus: 3,
            ac: { base: 18, source: "chain_mail_and_shield" },
            speeds: { walk: 25 },
            senses: { darkvision: 60 },
            hitDie: "d10",
            proficiencies: {
                saves: ["STR", "CON"],
                skills: ["Athletics", "Perception", "Intimidation"],
                weapons: ["simple", "martial"],
                armor: ["light", "medium", "heavy", "shields"],
                tools: ["Smith's tools"],
            },
            equipment: [
                { name: "Longsword", type: "weapon", properties: { damage: "1d8+4", damageType: "slashing" } },
                { name: "Shield", type: "armor", properties: {} },
                { name: "Chain Mail", type: "armor", properties: {} },
            ],
            spellcasting: null,
            features: [
                { name: "Second Wind", description: "Regain 1d10+level HP as bonus action", usesMax: 1, rechargeOn: "short_rest" },
                { name: "Action Surge", description: "Take an extra action", usesMax: 1, rechargeOn: "short_rest" },
                { name: "Extra Attack", description: "Attack twice per Attack action", usesMax: null, rechargeOn: null },
            ],
        }),
        actorState: JSON.stringify({
            hpCurrent: 38,
            hpMax: 44,
            tempHp: 0,
            hitDiceCurrent: 4,
            spellSlotsCurrent: {},
            featureUses: { "Second Wind": 1, "Action Surge": 0 },
            gold: 150,
            conditions: [],
            concentration: null,
            exhaustion: 0,
        }),
    } as any;
}

/** A spellcaster character */
function createWizardCharacter() {
    return {
        id: 2,
        sessionId: 77,
        name: "Elara Starweaver",
        className: "Wizard",
        level: 5,
        hpCurrent: 22,
        hpMax: 26,
        ac: 12,
        stats: JSON.stringify({ str: 8, dex: 14, con: 12, int: 18, wis: 12, cha: 10 }),
        inventory: JSON.stringify(["quarterstaff", "spellbook", "component pouch"]),
        notes: "An elven wizard studying ancient magic.",
        actorSheet: JSON.stringify({
            characterClass: "Wizard",
            ancestry: "Elf",
            subclass: "School of Evocation",
            background: "Sage",
            level: 5,
            feats: [],
            abilityScores: { str: 8, dex: 14, con: 12, int: 18, wis: 12, cha: 10 },
            proficiencyBonus: 3,
            ac: { base: 12, source: "mage_armor" },
            speeds: { walk: 30 },
            senses: { darkvision: 60 },
            hitDie: "d6",
            proficiencies: {
                saves: ["INT", "WIS"],
                skills: ["Arcana", "History", "Investigation"],
                weapons: ["daggers", "darts", "slings", "quarterstaffs", "light crossbows"],
                armor: [],
                tools: [],
            },
            equipment: [
                { name: "Quarterstaff", type: "weapon", properties: { damage: "1d6+0", damageType: "bludgeoning" } },
            ],
            spellcasting: {
                ability: "int",
                saveDC: 15,
                attackBonus: 7,
                cantripsKnown: ["Fire Bolt", "Prestidigitation", "Mage Hand"],
                spellsKnown: ["Shield", "Magic Missile", "Fireball", "Counterspell", "Hold Person"],
                spellSlots: { "1": 4, "2": 3, "3": 2 },
            },
            features: [
                { name: "Arcane Recovery", description: "Recover spell slots on short rest", usesMax: 1, rechargeOn: "long_rest" },
                { name: "Sculpt Spells", description: "Protect allies from evocation spells", usesMax: null, rechargeOn: null },
            ],
        }),
        actorState: JSON.stringify({
            hpCurrent: 22,
            hpMax: 26,
            tempHp: 0,
            hitDiceCurrent: 5,
            spellSlotsCurrent: { "1": 2, "2": 3, "3": 1 },
            featureUses: { "Arcane Recovery": 0 },
            gold: 75,
            conditions: [],
            concentration: { spellName: "Hold Person", targetId: "enemy-2" },
            exhaustion: 0,
        }),
    } as any;
}

function createSession() {
    return {
        id: 77,
        userId: 1,
        name: "The Lost Mine",
        currentSummary: "The party defeated the goblin ambush on the road and followed the trail to Cragmaw Cave. They rescued Sildar Hallwinter and learned that Gundren Rockseeker was taken to Cragmaw Castle.",
        narrativePrompt: "A classic D&D adventure in the Sword Coast. Tone: heroic fantasy with moments of dark peril.",
    } as any;
}

function createContext() {
    return {
        npcs: [
            { name: "Sildar Hallwinter", description: "Human warrior, ally of Gundren", disposition: "friendly" },
            { name: "King Grol", description: "Bugbear chief of Cragmaw Castle", disposition: "hostile" },
            { name: "Barthen", description: "Merchant in Phandalin", disposition: "neutral" },
        ],
        locations: [
            { name: "Cragmaw Cave", description: "A goblin hideout in the hills" },
            { name: "Phandalin", description: "A small frontier town" },
        ],
        plotPoints: [
            { summary: "Gundren Rockseeker has been kidnapped", importance: "high", resolved: false },
            { summary: "Goblin ambush was set by the Cragmaw tribe", importance: "medium", resolved: true },
        ],
        items: [
            { name: "Map to Wave Echo Cave", description: "Shows the location of a lost mine", location: "with Gundren" },
        ],
        quests: [
            { name: "Rescue Gundren", description: "Find and free Gundren from Cragmaw Castle", progress: "in_progress" },
            { name: "Deliver supplies to Barthen", description: "Bring a wagon of supplies", progress: "completed" },
        ],
    };
}

// =============================================================================
// A. CHARACTER SHEET — Does the DM know who the player is?
// =============================================================================

describe("A. Character sheet completeness in DM prompt", () => {
    it("includes class, level, ancestry, subclass, and background", () => {
        const sheet = formatCharacterSheet(createRichCharacter());
        expect(sheet).toContain("Class: Fighter Level 5");
        expect(sheet).toContain("Ancestry: Dwarf");
        expect(sheet).toContain("Subclass: Champion");
        expect(sheet).toContain("Background: Soldier");
    });

    it("includes all six ability scores with modifiers", () => {
        const sheet = formatCharacterSheet(createRichCharacter());
        expect(sheet).toContain("STR 18(+4)");
        expect(sheet).toContain("DEX 12(+1)");
        expect(sheet).toContain("CON 16(+3)");
        expect(sheet).toContain("INT 10(+0)");
        expect(sheet).toContain("WIS 14(+2)");
        expect(sheet).toContain("CHA 8(-1)");
    });

    it("shows current HP from actorState (not just DB max)", () => {
        const sheet = formatCharacterSheet(createRichCharacter());
        expect(sheet).toContain("HP: 38/44");
    });

    it("includes AC with source", () => {
        const sheet = formatCharacterSheet(createRichCharacter());
        expect(sheet).toContain("AC: 18 (chain_mail_and_shield)");
    });

    it("lists proficiencies (saves, skills, weapons, armor, tools)", () => {
        const sheet = formatCharacterSheet(createRichCharacter());
        expect(sheet).toContain("Saves: STR, CON");
        expect(sheet).toContain("Skills: Athletics, Perception, Intimidation");
        expect(sheet).toContain("Weapons: simple, martial");
        expect(sheet).toContain("Armor: light, medium, heavy, shields");
        expect(sheet).toContain("Tools: Smith's tools");
    });

    it("lists weapons with damage formulas and types", () => {
        const sheet = formatCharacterSheet(createRichCharacter());
        expect(sheet).toContain("Longsword");
        expect(sheet).toContain("slashing");
    });

    it("includes class features with remaining uses", () => {
        const sheet = formatCharacterSheet(createRichCharacter());
        // Second Wind: 1 use remaining, Action Surge: 0 remaining
        expect(sheet).toContain("Second Wind (1/1");
        expect(sheet).toContain("Action Surge (0/1");
    });

    it("includes feats", () => {
        const sheet = formatCharacterSheet(createRichCharacter());
        expect(sheet).toContain("Feats: Great Weapon Master");
    });

    it("shows darkvision and movement speed", () => {
        const sheet = formatCharacterSheet(createRichCharacter());
        expect(sheet).toContain("Darkvision 60 ft");
        expect(sheet).toContain("Walk 25 ft");
    });

    it("shows passive perception (10 + WIS mod + prof if skilled)", () => {
        const sheet = formatCharacterSheet(createRichCharacter());
        // WIS 14 = +2 mod, Perception is proficient, prof bonus = +3 → 10+2+3 = 15
        expect(sheet).toContain("Passive Perception: 15");
    });

    it("shows gold from actorState", () => {
        const sheet = formatCharacterSheet(createRichCharacter());
        expect(sheet).toContain("Gold: 150");
    });

    it("shows hit dice remaining", () => {
        const sheet = formatCharacterSheet(createRichCharacter());
        expect(sheet).toContain("Hit Dice: 4/5 (d10)");
    });

    it("shows character notes", () => {
        const sheet = formatCharacterSheet(createRichCharacter());
        expect(sheet).toContain("A dwarven warrior on a quest");
    });
});

describe("A2. Spellcaster sheet — DM knows spells and slots", () => {
    it("includes spell save DC and attack bonus", () => {
        const sheet = formatCharacterSheet(createWizardCharacter());
        expect(sheet).toContain("Spell Save DC: 15");
        expect(sheet).toContain("Attack Bonus: +7");
    });

    it("lists cantrips", () => {
        const sheet = formatCharacterSheet(createWizardCharacter());
        expect(sheet).toContain("Cantrips: Fire Bolt, Prestidigitation, Mage Hand");
    });

    it("lists prepared spells", () => {
        const sheet = formatCharacterSheet(createWizardCharacter());
        expect(sheet).toContain("Spells Prepared:");
        expect(sheet).toContain("Fireball");
        expect(sheet).toContain("Hold Person");
        expect(sheet).toContain("Shield");
    });

    it("shows current spell slots (from actorState, not max)", () => {
        const sheet = formatCharacterSheet(createWizardCharacter());
        // L1: 2/4, L2: 3/3, L3: 1/2
        expect(sheet).toContain("L1: 2/4");
        expect(sheet).toContain("L3: 1/2");
    });

    it("shows active concentration", () => {
        const sheet = formatCharacterSheet(createWizardCharacter());
        expect(sheet).toContain("Concentrating on: Hold Person");
    });
});

// =============================================================================
// B. CAMPAIGN CONTEXT — Does the DM know the world?
// =============================================================================

describe("B. Campaign context in DM prompt", () => {
    it("includes NPCs with disposition", () => {
        const prompt = buildChatUserPrompt(
            createRichCharacter(), createSession(), [], createContext(),
            undefined, [], "I look around the town"
        );
        expect(prompt).toContain("Sildar Hallwinter");
        expect(prompt).toContain("friendly");
        expect(prompt).toContain("King Grol");
        expect(prompt).toContain("hostile");
    });

    it("includes visited locations", () => {
        const prompt = buildChatUserPrompt(
            createRichCharacter(), createSession(), [], createContext(),
            undefined, [], "Where have we been?"
        );
        expect(prompt).toContain("Cragmaw Cave");
        expect(prompt).toContain("Phandalin");
    });

    it("includes active (unresolved) plot points only", () => {
        const prompt = buildChatUserPrompt(
            createRichCharacter(), createSession(), [], createContext(),
            undefined, [], "What do we know?"
        );
        // Active plot point
        expect(prompt).toContain("Gundren Rockseeker has been kidnapped");
        // Resolved plot point should be filtered
        expect(prompt).not.toContain("Goblin ambush was set by the Cragmaw tribe");
    });

    it("includes active quests (filters completed)", () => {
        const prompt = buildChatUserPrompt(
            createRichCharacter(), createSession(), [], createContext(),
            undefined, [], "What quests do we have?"
        );
        expect(prompt).toContain("Rescue Gundren");
        expect(prompt).toContain("in_progress");
        // Completed quest filtered
        expect(prompt).not.toContain("Deliver supplies to Barthen");
    });

    it("includes session summary for continuity", () => {
        const prompt = buildChatUserPrompt(
            createRichCharacter(), createSession(), [], createContext(),
            undefined, [], "What happened last time?"
        );
        expect(prompt).toContain("rescued Sildar Hallwinter");
        expect(prompt).toContain("Cragmaw Castle");
    });

    it("includes notable items", () => {
        const prompt = buildChatUserPrompt(
            createRichCharacter(), createSession(), [], createContext(),
            undefined, [], "What items do we have?"
        );
        expect(prompt).toContain("Map to Wave Echo Cave");
    });

    it("includes recent messages for conversation flow", () => {
        const messages = [
            { characterName: "DM", content: "You arrive at the cave entrance. Torchlight flickers within." },
            { characterName: "Thorin", content: "I ready my sword and listen for sounds." },
        ] as any[];

        const prompt = buildChatUserPrompt(
            createRichCharacter(), createSession(), messages, createContext(),
            undefined, [], "I enter the cave"
        );
        expect(prompt).toContain("DM: You arrive at the cave entrance");
        expect(prompt).toContain("Thorin: I ready my sword");
    });

    it("includes the player's current action", () => {
        const prompt = buildChatUserPrompt(
            createRichCharacter(), createSession(), [], createContext(),
            undefined, [], "I search the room for traps"
        );
        expect(prompt).toContain("Thorin Oakenshield: I search the room for traps");
    });
});

// =============================================================================
// C. COMBAT CONTEXT — Does the DM get battlefield info?
// =============================================================================

describe("C. Combat battlefield in DM prompt", () => {
    function createBattleState() {
        const thorin = createPlayerEntity("player-1", "Thorin", 38, 44, 18, 15, { dbCharacterId: 1 });
        const goblin = createEnemyEntity("enemy-1", "Goblin Boss", 21, 15, 5, "1d6+2", { initiative: 8 });
        thorin.rangeTo[goblin.id] = RangeBand.NEAR;
        goblin.rangeTo[thorin.id] = RangeBand.NEAR;

        return BattleStateSchema.parse({
            id: "battle-1", sessionId: 77,
            entities: [thorin, goblin],
            turnOrder: [thorin.id, goblin.id],
            round: 1, turnIndex: 0, phase: "ACTIVE",
            log: [], history: [],
            settings: { aiModels: { minionTier: "gpt-4o-mini", bossTier: "gpt-4o" }, debugMode: false },
            createdAt: 1, updatedAt: 1,
        });
    }

    it("V2 battle state injects battlefield snapshot into chat prompt", () => {
        const prompt = buildChatUserPrompt(
            createRichCharacter(), createSession(), [], {},
            undefined, [], "I attack the goblin!",
            createBattleState()
        );
        expect(prompt).toContain("[COMBAT ENGINE V2 - ACTIVE]");
        expect(prompt).toContain("Goblin Boss");
        expect(prompt).toContain("near");
    });

    it("battlefield snapshot shows initiative order and round", () => {
        const snapshot = buildBattlefieldSnapshot(createBattleState(), "player-1");
        expect(snapshot).toContain("Round: 1");
        expect(snapshot).toContain("Thorin");
        expect(snapshot).toContain("Goblin Boss");
    });

    it("combat query prompt includes turn resources and available actions", () => {
        const prompt = buildCombatQueryPrompt({
            battleState: createBattleState(),
            focusEntityId: "player-1",
            characterSheetText: "Name: Thorin\nClass: Fighter Level 5",
            resourceStatus: "**Action** (available), **Bonus Action** (available)",
            actionList: "• **ATTACK** — Melee attack with Longsword\n• **SECOND_WIND** — Heal 1d10+5",
            question: "What can I do on my turn?",
        });
        expect(prompt).toContain("ATTACK");
        expect(prompt).toContain("SECOND_WIND");
        expect(prompt).toContain("Action** (available)");
        expect(prompt).toContain("What can I do on my turn?");
    });
});

// =============================================================================
// D. SKILL CHECK — Does the DM see the full roll breakdown?
// =============================================================================

describe("D. Skill check narration", () => {
    const baseInput = {
        characterName: "Thorin",
        stats: { str: 18, dex: 12, con: 16, int: 10, wis: 14, cha: 8 },
        level: 5,
        proficientSkills: ["athletics", "perception", "intimidation"] as any[],
    };

    it("proficient skill check: summary shows roll + modifier + proficiency = total vs DC", () => {
        const result = resolveSkillCheck({
            ...baseInput,
            dc: 15,
            skill: "Athletics",
            rawRoll: 12,
        });
        // STR 18 = +4 mod, prof bonus = +3, total = 12+4+3 = 19
        expect(result.summary).toContain("12 + 4 + 3 = **19** vs DC 15");
        expect(result.summary).toContain("**Success**");
        expect(result.total).toBe(19);
    });

    it("non-proficient skill: no proficiency bonus in summary", () => {
        const result = resolveSkillCheck({
            ...baseInput,
            dc: 15,
            skill: "Arcana",
            rawRoll: 10,
        });
        // INT 10 = +0 mod, not proficient, total = 10+0 = 10
        expect(result.summary).toContain("10 + 0 = **10** vs DC 15");
        expect(result.summary).toContain("**Failure**");
    });

    it("negative modifier displayed correctly", () => {
        const result = resolveSkillCheck({
            ...baseInput,
            dc: 12,
            skill: "Persuasion", // CHA-based
            rawRoll: 14,
        });
        // CHA 8 = -1 mod, not proficient, total = 14-1 = 13
        expect(result.summary).toContain("14 - 1 = **13** vs DC 12");
        expect(result.summary).toContain("**Success**");
    });

    it("advantage: uses 2d20kh1 formula", () => {
        const result = resolveSkillCheck({
            ...baseInput,
            dc: 15,
            skill: "Perception",
            advantage: true,
            rawRoll: 17,
        });
        expect(result.formula).toBe("2d20kh1");
    });

    it("disadvantage: uses 2d20kl1 formula", () => {
        const result = resolveSkillCheck({
            ...baseInput,
            dc: 15,
            skill: "Stealth",
            disadvantage: true,
            rawRoll: 5,
        });
        expect(result.formula).toBe("2d20kl1");
    });

    it("raw ability check (no skill): labels as 'STR check' etc", () => {
        const result = resolveSkillCheck({
            ...baseInput,
            dc: 20,
            ability: "str",
            rawRoll: 15,
        });
        expect(result.summary).toContain("STR check");
    });
});

// =============================================================================
// E. REST — Does the DM narrate resource recovery?
// =============================================================================

describe("E. Rest narration", () => {
    const fighter = {
        name: "Thorin",
        className: "Fighter",
        level: 5,
        hpCurrent: 25,
        hpMax: 44,
        stats: JSON.stringify({ str: 18, dex: 12, con: 16, int: 10, wis: 14, cha: 8 }),
    };

    it("short rest: summary shows hit dice spent and HP recovered", () => {
        const resources = buildDefaultResourceState(fighter as any);
        const result = resolveShortRest(fighter as any, resources, {
            hitDiceToSpend: 2,
            rollFn: () => ({ total: 6 } as any),
        });
        // 2 hit dice × (6 + CON mod 3) = 18 HP recovered
        expect(result.summary).toContain("Thorin takes a short rest");
        expect(result.summary).toContain("spends 2 hit dice");
        expect(result.summary).toContain("recovers");
        expect(result.healed).toBe(18);
        expect(result.hpAfter).toBe(43); // 25+18=43 (capped at 44)
    });

    it("short rest at full HP: no dice spent", () => {
        const fullHpFighter = { ...fighter, hpCurrent: 44 };
        const resources = buildDefaultResourceState(fullHpFighter as any);
        const result = resolveShortRest(fullHpFighter as any, resources, {
            hitDiceToSpend: 2,
        });
        expect(result.hitDiceSpent).toBe(0);
        expect(result.summary).toContain("spends no hit dice");
    });

    it("long rest: full HP, all spell slots, hit dice recovery", () => {
        const wizard = {
            name: "Elara",
            className: "Wizard",
            level: 5,
            hpCurrent: 10,
            hpMax: 26,
            stats: JSON.stringify({ str: 8, dex: 14, con: 12, int: 18, wis: 12, cha: 10 }),
        };
        const resources = {
            ...buildDefaultResourceState(wizard as any),
            spellSlotsCurrent: { "1": 0, "2": 1, "3": 0 },
            hitDiceRemaining: 2,
        };
        const result = resolveLongRest(wizard as any, resources);

        expect(result.hpAfter).toBe(26); // full HP
        expect(result.resourceState.spellSlotsCurrent).toEqual(result.resourceState.spellSlotsMax);
        expect(result.hitDiceRecovered).toBe(2); // floor(5/2) = 2
        expect(result.summary).toContain("full HP");
        expect(result.summary).toContain("spell slots");
    });

    it("detectHitDiceToSpend parses 'spend 2 hit dice'", () => {
        expect(detectHitDiceToSpend("I want to spend 2 hit dice")).toBe(2);
        expect(detectHitDiceToSpend("spend three hit dice please")).toBe(3);
        expect(detectHitDiceToSpend("I take a short rest")).toBeUndefined();
    });
});

// =============================================================================
// F. COMBAT NARRATOR — Edge cases for dramatic moments
// =============================================================================

describe("F. Combat narrator edge cases", () => {
    function fixedRoll(total: number): RollFn {
        return () => ({ total, rolls: [total], isCritical: total === 20, isFumble: total === 1 });
    }

    function startCombat(engine: any, entities: CombatEntity[]) {
        engine.prepareCombat(entities);
        entities.forEach((e, i) => engine.applyInitiative(e.id, 20 - i));
    }

    it("killing blow: DEATH log reaches narrator with 'killed' message", async () => {
        const engine = createCombatEngine(1, {}, fixedRoll(8));
        const fighter = createPlayerEntity("f1", "Thorin", 44, 44, 18, 10, {
            attackModifier: 7, damageFormula: "1d8+4", damageType: "slashing",
            weapons: [{ name: "Longsword", damageFormula: "1d8+4", damageType: "slashing", isRanged: false, attackBonus: 7, properties: [] }],
        });
        const goblin = createEnemyEntity("gob", "Goblin", 5, 12, 3, "1d6+1", {
            damageType: "slashing",
        });
        startCombat(engine, [fighter, goblin]);

        // Attack that kills
        const result = engine.submitAction({
            type: "ATTACK", attackerId: "f1", targetId: "gob",
            weaponName: "Longsword", attackRoll: 20, rawD20: 13,
        });
        const allLogs = [...result.logs];
        if (engine.getState().phase === "AWAIT_DAMAGE_ROLL") {
            const dmg = engine.applyDamage(8); // 8 > 5 HP → dead
            allLogs.push(...(dmg?.logs ?? []));
        }

        const summary = generateMechanicalSummary(allLogs, engine.getState().entities, "f1");
        expect(summary.toLowerCase()).toContain("killed");
    });

    it("player unconscious: UNCONSCIOUS log reaches narrator", async () => {
        const engine = createCombatEngine(1, {}, fixedRoll(8));
        const fighter = createPlayerEntity("f1", "Thorin", 3, 44, 18, 10, {
            attackModifier: 7, damageFormula: "1d8+4",
        });
        const ogre = createEnemyEntity("ogre", "Ogre", 50, 11, 6, "2d8+4", {
            damageType: "bludgeoning",
        });
        startCombat(engine, [ogre, fighter]); // ogre first

        const result = engine.submitAction({
            type: "ATTACK", attackerId: "ogre", targetId: "f1",
            attackRoll: 20, rawD20: 14,
        });
        // Enemy auto-resolves damage

        const summary = generateMechanicalSummary(result.logs, engine.getState().entities, "f1");
        expect(summary.toLowerCase()).toContain("unconscious");
    });

    it("initiative narrative: lists all entities in order with initiative values", () => {
        const entities = [
            createPlayerEntity("f1", "Thorin", 44, 44, 18, 18, {}),
            createPlayerEntity("w1", "Elara", 26, 26, 12, 12, {}),
            createEnemyEntity("g1", "Goblin Boss", 21, 15, 5, "1d6+2", {}),
        ];
        // Set initiative values
        entities[0].initiative = 18;
        entities[1].initiative = 12;
        entities[2].initiative = 8;

        const narrative = generateInitiativeNarrative(entities, ["f1", "w1", "g1"]);

        expect(narrative).toContain("Initiative rolled!");
        expect(narrative).toContain("Thorin");
        expect(narrative).toContain("Elara");
        expect(narrative).toContain("Goblin Boss");
        expect(narrative).toContain("→"); // turn order arrows
        expect(narrative).toContain("Thorin's turn!"); // first entity announcement
    });

    it("healing log: shows HP restored", () => {
        const engine = createCombatEngine(1, {}, fixedRoll(8));
        const cleric = createPlayerEntity("c1", "Aldric", 32, 32, 18, 10, {
            characterClass: "Cleric",
            spells: [{
                name: "Cure Wounds", level: 1, school: "evocation", castingTime: "action",
                range: 5, isAreaEffect: false, savingThrow: undefined, halfOnSave: false,
                requiresConcentration: false, requiresAttackRoll: false,
                conditions: [], description: "Heal", healingFormula: "1d8+3",
            }],
            spellSlots: { "1": 4 }, spellSaveDC: 14,
        });
        const fighter = createPlayerEntity("f1", "Thorin", 20, 44, 18, 10, {});
        const goblin = createEnemyEntity("gob", "Goblin", 10, 12, 3, "1d6+1", {});
        startCombat(engine, [cleric, fighter, goblin]);

        const result = engine.submitAction({
            type: "CAST_SPELL", casterId: "c1", spellName: "Cure Wounds", targetIds: ["f1"],
        });

        const summary = generateMechanicalSummary(result.logs, engine.getState().entities, "c1");
        expect(summary.toLowerCase()).toContain("heal");
    });

    it("enemy attack: narrator prompt uses correct perspective (third person enemy, 'you' for player)", async () => {
        const engine = createCombatEngine(1, {}, fixedRoll(8));
        const fighter = createPlayerEntity("f1", "Thorin", 44, 44, 18, 10, {});
        const ogre = createEnemyEntity("ogre", "Ogre", 50, 11, 6, "2d8+4", {
            damageType: "bludgeoning",
            weapons: [{ name: "Greatclub", damageFormula: "2d8+4", damageType: "bludgeoning", isRanged: false, attackBonus: 6, properties: [] }],
        });
        startCombat(engine, [ogre, fighter]);

        const result = engine.submitAction({
            type: "ATTACK", attackerId: "ogre", targetId: "f1",
            attackRoll: 20, rawD20: 14,
        });

        const prompt = await computeCombatNarrativePrompts(
            1, result.logs, "The ogre swings its club!", "Ogre",
            engine.getState().entities, true, "f1",
            { weaponName: "Greatclub" }
        );

        expect(prompt).not.toBeNull();
        // "you" refers to the player; ogre described in third person
        expect(prompt!.userPrompt).toContain("ENEMY ACTING: Ogre");
        expect(prompt!.userPrompt).toContain('address as "you"');
        expect(prompt!.userPrompt).toContain("WEAPON: Greatclub");
    });

    it("condition applied via spell: narrator receives condition info in logs", () => {
        const engine = createCombatEngine(1, {}, fixedRoll(5)); // low roll = enemy fails save
        const wizard = createPlayerEntity("w1", "Elara", 26, 26, 12, 10, {
            spells: [{
                name: "Hold Person", level: 2, school: "enchantment", castingTime: "action",
                range: 60, isAreaEffect: false, savingThrow: "WIS", halfOnSave: false,
                requiresConcentration: true, requiresAttackRoll: false,
                conditions: ["paralyzed"], description: "Paralyze",
            }],
            spellSlots: { "2": 3 }, spellSaveDC: 15,
        });
        const goblin = createEnemyEntity("gob", "Goblin", 10, 12, 3, "1d6+1", {
            abilityScores: { str: 8, dex: 14, con: 10, int: 10, wis: 8, cha: 8 },
        });
        startCombat(engine, [wizard, goblin]);

        const result = engine.submitAction({
            type: "CAST_SPELL", casterId: "w1", spellName: "Hold Person", targetIds: ["gob"],
        });

        const summary = generateMechanicalSummary(result.logs, engine.getState().entities, "w1");
        // Should mention the spell and the condition
        expect(summary.toLowerCase()).toContain("hold person");
        // The goblin should be paralyzed
        const gob = engine.getState().entities.find(e => e.id === "gob")!;
        expect(gob.activeConditions?.some(c => c.name === "paralyzed")).toBe(true);
    });
});

// =============================================================================
// G. SYSTEM PROMPT — Campaign tone and DM personality
// =============================================================================

describe("G. DM system prompt", () => {
    it("system prompt contains DM role identity", () => {
        const prompt = buildDMPrompt();
        expect(prompt.toLowerCase()).toContain("dungeon master");
    });

    it("system prompt includes campaign narrative when provided", () => {
        const prompt = buildDMPrompt(null, "A dark, gothic horror campaign set in Barovia.");
        expect(prompt).toContain("gothic horror");
        expect(prompt).toContain("Barovia");
        expect(prompt).toContain("CAMPAIGN NARRATIVE");
    });
});

// =============================================================================
// H. EDGE CASE: Empty or missing data
// =============================================================================

describe("H. Graceful handling of missing data", () => {
    it("character with no actorSheet: falls back to DB columns", () => {
        const bareChar = {
            id: 1, sessionId: 1,
            name: "Generic Hero",
            className: "Fighter",
            level: 1,
            hpCurrent: 10, hpMax: 10, ac: 15,
            stats: JSON.stringify({ str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 8 }),
            inventory: JSON.stringify(["sword", "shield"]),
            notes: "",
        } as any;

        const sheet = formatCharacterSheet(bareChar);
        expect(sheet).toContain("Class: Fighter Level 1");
        expect(sheet).toContain("HP: 10/10");
        expect(sheet).toContain("AC: 15");
        expect(sheet).toContain("STR 16");
        expect(sheet).toContain("Inventory: sword, shield");
    });

    it("empty campaign context: shows 'None' placeholders", () => {
        const prompt = buildChatUserPrompt(
            createRichCharacter(), createSession(), [],
            { npcs: [], locations: [], plotPoints: [], items: [], quests: [] },
            undefined, [], "hello"
        );
        expect(prompt).toContain("None encountered yet");
        expect(prompt).toContain("None visited yet");
        expect(prompt).toContain("None established yet");
        expect(prompt).toContain("None active");
    });

    it("no recent messages: prompt still valid", () => {
        const prompt = buildChatUserPrompt(
            createRichCharacter(), createSession(), [], {},
            undefined, [], "I look around"
        );
        expect(prompt).toContain("[CURRENT ACTION]");
        expect(prompt).toContain("I look around");
    });
});
