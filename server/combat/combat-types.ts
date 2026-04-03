/**
 * Combat Engine V2 — Type Definitions
 * 
 * This file defines the "vocabulary" for the combat system:
 * - What is a combatant? (CombatEntity)
 * - What does a battle look like? (BattleState)
 * - What events can happen? (CombatLogEntry)
 * - What actions can players/enemies take? (ActionPayload)
 * 
 * These are RUNTIME types for the engine's state machine.
 * They map to (but are separate from) the database schemas.
 */

import { z } from "zod";
import { ModifierSchema } from "../kernel/effect-types";

// =============================================================================
// ENUMS & CONSTANTS
// =============================================================================

/**
 * Range Bands — How far apart combatants are (no grid needed)
 * 
 * Instead of tracking exact positions on a map, we use simple distance bands:
 * - MELEE: Close enough to hit with a sword (5 feet)
 * - NEAR: Within a short dash or bow shot (30 feet)
 * - FAR: Across the room, need to run (60 feet)
 */
export enum RangeBand {
    MELEE = 5,
    NEAR = 30,
    FAR = 60,
}

/**
 * Combat Phases — What the engine is currently doing
 * 
 * - IDLE: No combat happening
 * - AWAIT_INITIATIVE: Combat starting, waiting for player initiative rolls
 * - ACTIVE: Someone's turn, waiting for action
 * - AWAIT_ROLL: Paused, waiting for user to roll dice (3D dice UI)
 * - AWAIT_DAMAGE_ROLL: Hit confirmed, waiting for damage roll from player
 * - RESOLVED: Combat ended (all enemies dead or fled)
 */
export const CombatPhaseSchema = z.enum([
    "IDLE",
    "AWAIT_INITIATIVE",
    "ACTIVE",
    "AWAIT_ROLL",
    "AWAIT_ATTACK_ROLL",
    "AWAIT_DAMAGE_ROLL",
    "AWAIT_SAVE_ROLL",     // Paused for a player's saving throw against a spell
    "AWAIT_DEATH_SAVE",   // Paused for an unconscious player's death saving throw
    "AWAIT_SMITE_DECISION", // Paladin hit with melee — choose smite level or decline
    "RESOLVED",
]);
export type CombatPhase = z.infer<typeof CombatPhaseSchema>;

/**
 * Entity Status — Is the combatant alive, dead, or somewhere in between?
 */
export const EntityStatusSchema = z.enum([
    "ALIVE",
    "UNCONSCIOUS",  // Players at 0 HP (can be healed)
    "DEAD",         // Monsters at 0 HP (removed from combat)
    "FLED",         // Escaped combat
]);
export type EntityStatus = z.infer<typeof EntityStatusSchema>;

// =============================================================================
// CONDITIONS — D&D 5e status conditions with duration tracking
// =============================================================================

/**
 * Active Condition — A D&D 5e status condition applied to an entity.
 *
 * Distinct from the legacy `conditions: string[]` array (used for internal
 * engine flags like "dodging", "helped_by:…", "readied:…"). This schema
 * is for proper D&D conditions that have mechanical effects and durations.
 */
export const ActiveConditionSchema = z.object({
    name: z.enum([
        "blinded",
        "charmed",
        "deafened",
        "frightened",
        "grappled",
        "incapacitated",
        "invisible",
        "paralyzed",
        "petrified",
        "poisoned",
        "prone",
        "restrained",
        "stunned",
        "unconscious",
        "concentrating",
        "raging",
    ]),
    sourceId: z.string().optional(),          // who applied it
    duration: z.number().int().optional(),    // rounds remaining (undefined = permanent)
    appliedAtRound: z.number().int(),
});
export type ActiveCondition = z.infer<typeof ActiveConditionSchema>;

// =============================================================================
// SPELL SCHEMA (Stage 6)
// =============================================================================

export const SpellSchema = z.object({
    name: z.string(),
    level: z.number().int().min(0).max(9),   // 0 = cantrip
    school: z.string().default("evocation"),
    castingTime: z.enum(['action', 'bonus_action', 'reaction']).default('action'),
    range: z.number().int().default(30),      // feet
    isAreaEffect: z.boolean().default(false),
    areaType: z.enum(['sphere', 'cone', 'line', 'cube']).optional(),
    areaSize: z.number().int().optional(),    // radius/length in feet
    savingThrow: z.enum(['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA']).optional(),
    halfOnSave: z.boolean().default(true),    // true = half damage on successful save
    damageFormula: z.string().optional(),     // e.g. "8d6" for Fireball
    damageType: z.string().optional(),        // "fire", "cold", etc.
    healingFormula: z.string().optional(),    // e.g. "2d4+4" for Cure Wounds
    requiresConcentration: z.boolean().default(false),
    requiresAttackRoll: z.boolean().default(false),
    conditions: z.array(z.string()).default([]), // conditions to apply on hit
    description: z.string().default(''),
});
export type Spell = z.infer<typeof SpellSchema>;

// =============================================================================
// WEAPON ENTRY — A single weapon available to a combatant
// =============================================================================

export const WeaponEntrySchema = z.object({
    name: z.string(),
    damageFormula: z.string(),
    damageType: z.string(),
    isRanged: z.boolean().default(false),
    attackBonus: z.number().int(),
    properties: z.array(z.string()).default([]),  // "finesse", "thrown", "versatile", etc.
});
export type WeaponEntry = z.infer<typeof WeaponEntrySchema>;

// =============================================================================
// COMBAT ENTITY — A single combatant (player or monster)
// =============================================================================

/**
 * Attack Context — Information about an attack being made
 * 
 * Used by hook functions to calculate situational modifiers.
 * Example: A wolf gets +2 to hit if an ally is adjacent (Pack Tactics)
 */
export const AttackContextSchema = z.object({
    attackerId: z.string(),
    targetId: z.string(),
    isRanged: z.boolean().default(false),
    range: z.nativeEnum(RangeBand).optional(),
    hasAdvantage: z.boolean().default(false),
    hasDisadvantage: z.boolean().default(false),
});
export type AttackContext = z.infer<typeof AttackContextSchema>;

/**
 * Combat Entity — One participant in combat
 * 
 * This is the core unit of the engine. It represents a player character,
 * an enemy monster, or an NPC ally.
 * 
 * Key design decision: Stats are METHODS not PROPERTIES.
 * Why? Because D&D has tons of situational modifiers:
 * - "You have +2 AC against ranged attacks" (Shield spell)
 * - "You have advantage on attacks against frightened creatures"
 * 
 * So instead of `entity.ac`, we use `entity.getAC(context)`.
 */
export const CombatEntitySchema = z.object({
    // Identity
    id: z.string(),
    name: z.string(),
    type: z.enum(["player", "enemy", "ally"]),
    characterClass: z.string().optional(),

    // Core stats (base values)
    hp: z.number().int(),
    maxHp: z.number().int().positive(),
    baseAC: z.number().int().default(10),

    // Initiative (turn order)
    initiative: z.number().int().default(0),
    initiativeModifier: z.number().int().default(0),  // DEX mod

    // Attack capabilities
    attackModifier: z.number().int().default(0),      // To-hit bonus
    damageFormula: z.string().default("1d4"),          // e.g., "1d8+3"
    damageType: z.string().default("bludgeoning"),     // slashing, fire, etc.

    // Special flags
    isEssential: z.boolean().default(false),  // true = unconscious at 0 HP, false = dead
    status: EntityStatusSchema.default("ALIVE"),

    // Internal engine flags ("dodging", "helped_by:…", "readied:…", etc.)
    conditions: z.array(z.string()).default([]),

    // D&D 5e status conditions with mechanical effects (Stage 5)
    activeConditions: z.array(ActiveConditionSchema).default([]),

    // Active modifiers from class features, spells, items, etc. (e.g. Sneak Attack, Rage, Divine Smite)
    activeModifiers: z.array(ModifierSchema).default([]),

    // Death saving throws (only relevant when isEssential entity is UNCONSCIOUS)
    deathSaves: z.object({
        successes: z.number().int().default(0),
        failures: z.number().int().default(0),
    }).default({ successes: 0, failures: 0 }),

    // Damage resistances, immunities, and vulnerabilities
    // Each entry is a damage type string (e.g. "fire", "bludgeoning")
    resistances: z.array(z.string()).default([]),
    immunities: z.array(z.string()).default([]),
    vulnerabilities: z.array(z.string()).default([]),

    // Temporary hit points (absorbed before real HP)
    tempHp: z.number().int().default(0),

    // Spellcasting (Stage 6)
    spells: z.array(SpellSchema).default([]),
    spellSlots: z.record(z.string(), z.number().int()).default({}), // { "1": 4, "2": 3 }
    spellSaveDC: z.number().int().optional(),
    spellAttackBonus: z.number().int().optional(),
    spellcastingAbility: z.enum(['str', 'dex', 'con', 'int', 'wis', 'cha']).optional(),
    abilityScores: z.object({
        str: z.number().int().default(10),
        dex: z.number().int().default(10),
        con: z.number().int().default(10),
        int: z.number().int().default(10),
        wis: z.number().int().default(10),
        cha: z.number().int().default(10),
    }).optional(),

    // Tactical metadata (for enemy AI prompts)
    tacticalRole: z.enum(['brute', 'skirmisher', 'controller', 'sniper', 'beast', 'minion']).optional(),
    isRanged: z.boolean().optional().default(false),
    preferredRange: z.nativeEnum(RangeBand).optional(),

    // Position relative to others
    rangeTo: z.record(z.string(), z.nativeEnum(RangeBand)).default({}),

    // Named weapons available for attack actions
    weapons: z.array(WeaponEntrySchema).default([]),

    // Save proficiencies (e.g. ['str','con'] for Fighter)
    saveProficiencies: z.array(z.string()).default([]),
    // Proficiency bonus (derived from level)
    proficiencyBonus: z.number().int().optional(),

    // Extra Attack: number of additional attacks per Attack action (Fighter 5+, etc.)
    extraAttacks: z.number().int().default(0),

    // Character level (for level-scaling features like Second Wind: 1d10 + level)
    level: z.number().int().min(1).max(20).optional(),

    // Creature type for monsters (e.g. "undead", "fiend", "dragon") — populated from SRD
    creatureType: z.string().optional(),

    // Feature uses remaining (e.g. { "Second Wind": 1, "Action Surge": 1 })
    featureUses: z.record(z.string(), z.number().int()).default({}),

    // Link to database (for persistence)
    dbCombatantId: z.number().int().optional(),
    dbCharacterId: z.number().int().optional(),
});
export type CombatEntity = z.infer<typeof CombatEntitySchema>;

// =============================================================================
// COMBAT LOG — What happened during combat
// =============================================================================

/**
 * Log Entry Types — Categories of combat events
 */
export const LogEntryTypeSchema = z.enum([
    "COMBAT_START",
    "COMBAT_END",
    "ROUND_START",
    "ROUND_END",
    "TURN_START",
    "TURN_END",
    "INITIATIVE_ROLLED",
    "ATTACK_ROLL",
    "DAMAGE",
    "HEALING",
    "DEATH",
    "UNCONSCIOUS",
    "CONDITION_APPLIED",
    "CONDITION_REMOVED",
    "MOVEMENT",
    "ACTION",          // Generic log for non-attack actions (Dodge, Dash, Help, etc.)
    "SPELL_CAST",
    "CUSTOM",
]);
export type LogEntryType = z.infer<typeof LogEntryTypeSchema>;

/**
 * Combat Log Entry — A single event in combat
 * 
 * Every time something happens (attack, damage, death), we create
 * a log entry. This serves two purposes:
 * 1. History: We can show "what happened last round"
 * 2. Narrative: The LLM uses these to generate flavor text
 */
export const CombatLogEntrySchema = z.object({
    id: z.string(),
    timestamp: z.number(),  // Unix ms
    round: z.number().int(),
    turnIndex: z.number().int(),

    type: LogEntryTypeSchema,
    actorId: z.string().optional(),
    targetId: z.string().optional(),

    // Roll details (if applicable)
    roll: z.object({
        formula: z.string(),        // "1d20+5"
        result: z.number().int(),   // 18
        isCritical: z.boolean().default(false),
        isFumble: z.boolean().default(false),
    }).optional(),

    // Damage/healing details
    amount: z.number().int().optional(),
    damageType: z.string().optional(),

    // Outcome summary
    success: z.boolean().optional(),
    description: z.string().optional(),
});
export type CombatLogEntry = z.infer<typeof CombatLogEntrySchema>;

// =============================================================================
// ACTION PAYLOADS — What the player/AI wants to do
// =============================================================================

/**
 * D&D 5e Action Economy
 *
 * Each turn a combatant gets:
 *   - 1 Action  (Attack, Dash, Disengage, Dodge, Help, Hide, Ready, Use Item, Cast Spell)
 *   - 1 Bonus Action  (only if a class feature / feat / spell grants one)
 *   - Movement  (up to speed; theater-of-mind = range band shifts)
 *   - 1 Reaction per round  (Opportunity Attack, Shield spell, etc.)
 *   - 1 Free Object Interaction  (draw/sheathe weapon, open a door)
 *
 * Some features let you use an Action-type ability as a Bonus Action instead
 * (e.g. Rogue Cunning Action: Dash/Disengage/Hide as bonus action).
 * The `resourceCost` field on a payload controls which resource it consumes.
 */

/**
 * Resource Cost — Which turn resource an action consumes
 */
export const ResourceCostSchema = z.enum([
    "action",
    "bonus_action",
    "reaction",
    "movement",
    "free",         // Free object interaction, speaking
    "none",         // END_TURN consumes nothing
]);
export type ResourceCost = z.infer<typeof ResourceCostSchema>;

/**
 * Action Types — All combat-relevant actions
 *
 * Standard Actions (consume Action):
 *   ATTACK        — Melee or ranged weapon attack
 *   DASH          — Double your movement this turn
 *   DISENGAGE     — Your movement doesn't provoke opportunity attacks
 *   DODGE         — Attacks against you have disadvantage; DEX saves with advantage
 *   HELP          — Give one ally advantage on their next attack or ability check
 *   HIDE          — Make a Stealth check to become hidden
 *   READY         — Prepare an action to trigger on a condition (uses reaction to fire)
 *   USE_ITEM      — Drink a potion, activate a magic item, etc.
 *   CAST_SPELL    — (Stage 6) Cast a spell using a spell slot
 *
 * Reactions (consume Reaction, 1/round not 1/turn):
 *   OPPORTUNITY_ATTACK — Strike a creature leaving your reach
 *
 * Meta:
 *   END_TURN      — Forfeit remaining resources and end your turn
 */
export const ActionTypeSchema = z.enum([
    // Standard Actions (consume Action by default)
    "ATTACK",
    "CAST_SPELL",           // Stage 6
    "MOVE",                 // Uses the movement resource, not the action
    "DASH",
    "DISENGAGE",
    "DODGE",
    "HEAL",
    "HELP",
    "HIDE",
    "READY",
    "USE_ITEM",
    // Class features
    "SECOND_WIND",          // Fighter: bonus action, heal 1d10+level, 1/short rest
    "ACTION_SURGE",         // Fighter: free, grants additional action, 1/short rest
    // Divine Smite (Paladin)
    "SMITE_1",              // Paladin: expend level 1 slot for (1+1)d8 radiant
    "SMITE_2",              // Paladin: expend level 2 slot for (2+1)d8 radiant
    "SMITE_3",              // Paladin: expend level 3 slot for (3+1)d8 radiant
    "DECLINE_SMITE",        // Paladin: skip smite, proceed with normal damage
    // Barbarian
    "RAGE",                 // Barbarian: bonus action, grants rage bonuses, uses/long rest
    // Reactions (consume Reaction)
    "OPPORTUNITY_ATTACK",
    // Meta
    "END_TURN",
]);
export type ActionType = z.infer<typeof ActionTypeSchema>;

/**
 * Default resource cost for each action type.
 * Class features can override (e.g. Rogue Cunning Action → Dash as bonus_action).
 */
export const ACTION_DEFAULT_COST: Record<ActionType, ResourceCost> = {
    ATTACK:             "action",
    CAST_SPELL:         "action",       // some spells are bonus_action; spell schema will override
    MOVE:               "movement",
    DASH:               "action",
    DISENGAGE:          "action",
    DODGE:              "action",
    HEAL:               "action",
    HELP:               "action",
    HIDE:               "action",
    READY:              "action",
    USE_ITEM:           "action",
    SECOND_WIND:        "bonus_action",
    ACTION_SURGE:       "free",
    SMITE_1:            "free",
    SMITE_2:            "free",
    SMITE_3:            "free",
    DECLINE_SMITE:      "free",
    RAGE:               "bonus_action",
    OPPORTUNITY_ATTACK: "reaction",
    END_TURN:           "none",
};

// =============================================================================
// PAYLOAD SCHEMAS — One per action type
// =============================================================================

/**
 * Attack Payload — Melee or ranged weapon attack
 */
export const AttackPayloadSchema = z.object({
    type: z.literal("ATTACK"),
    attackerId: z.string(),
    targetId: z.string(),
    weaponName: z.string().optional(),
    isRanged: z.boolean().default(false),
    advantage: z.boolean().default(false),
    disadvantage: z.boolean().default(false),
    /** Optional: Player-provided attack roll total (raw d20 + modifier) */
    attackRoll: z.number().int().optional(),
    /** Optional: The raw d20 value (1-20) for accurate crit/fumble detection */
    rawD20: z.number().int().min(1).max(20).optional(),
    /** Override default resource cost (e.g. for Extra Attack consuming no additional action) */
    resourceCost: ResourceCostSchema.optional(),
});
export type AttackPayload = z.infer<typeof AttackPayloadSchema>;

/**
 * Dodge Payload — Take the Dodge action
 * Until your next turn: attacks against you have disadvantage,
 * and you make DEX saving throws with advantage.
 */
export const DodgePayloadSchema = z.object({
    type: z.literal("DODGE"),
    entityId: z.string(),
    resourceCost: ResourceCostSchema.optional(),
});
export type DodgePayload = z.infer<typeof DodgePayloadSchema>;

/**
 * Dash Payload — Take the Dash action
 * Gain extra movement equal to your speed for this turn.
 * Theater-of-mind: allows an additional range band shift.
 */
export const DashPayloadSchema = z.object({
    type: z.literal("DASH"),
    entityId: z.string(),
    resourceCost: ResourceCostSchema.optional(),
});
export type DashPayload = z.infer<typeof DashPayloadSchema>;

/**
 * Move Payload — Shift relative distance bands without using your action.
 * `toward` closes distance by one band, `away` opens it by one band.
 */
export const MovePayloadSchema = z.object({
    type: z.literal("MOVE"),
    entityId: z.string(),
    targetId: z.string(),
    direction: z.enum(["toward", "away"]),
    resourceCost: ResourceCostSchema.optional(),
});
export type MovePayload = z.infer<typeof MovePayloadSchema>;

/**
 * Disengage Payload — Take the Disengage action
 * Your movement doesn't provoke opportunity attacks for the rest of the turn.
 */
export const DisengagePayloadSchema = z.object({
    type: z.literal("DISENGAGE"),
    entityId: z.string(),
    resourceCost: ResourceCostSchema.optional(),
});
export type DisengagePayload = z.infer<typeof DisengagePayloadSchema>;

/**
 * Help Payload — Take the Help action
 * Choose an ally: the next attack roll that ally makes against `targetId`
 * has advantage, or the ally gets advantage on their next ability check.
 */
export const HelpPayloadSchema = z.object({
    type: z.literal("HELP"),
    entityId: z.string(),           // Who is helping
    allyId: z.string(),             // Who receives the advantage
    targetId: z.string().optional(), // Enemy to grant advantage against (for attacks)
    resourceCost: ResourceCostSchema.optional(),
});
export type HelpPayload = z.infer<typeof HelpPayloadSchema>;

/**
 * Hide Payload ��� Take the Hide action
 * Make a Stealth check. If successful, you are hidden (unseen attacker advantage, etc.).
 */
export const HidePayloadSchema = z.object({
    type: z.literal("HIDE"),
    entityId: z.string(),
    resourceCost: ResourceCostSchema.optional(),
});
export type HidePayload = z.infer<typeof HidePayloadSchema>;

/**
 * Ready Payload — Prepare an action with a trigger condition
 * Uses your action now; fires via your reaction when the trigger occurs.
 */
export const ReadyPayloadSchema = z.object({
    type: z.literal("READY"),
    entityId: z.string(),
    /** Natural-language trigger: "when the goblin moves within 5 feet" */
    trigger: z.string(),
    /** The action to take when triggered */
    readiedAction: z.enum(["ATTACK", "CAST_SPELL", "DASH", "DISENGAGE", "DODGE", "USE_ITEM"]),
    targetId: z.string().optional(),
    resourceCost: ResourceCostSchema.optional(),
});
export type ReadyPayload = z.infer<typeof ReadyPayloadSchema>;

/**
 * Use Item Payload — Use an object (potion, magic item, etc.)
 */
export const UseItemPayloadSchema = z.object({
    type: z.literal("USE_ITEM"),
    entityId: z.string(),
    itemName: z.string(),
    targetId: z.string().optional(), // e.g. pour a potion on an ally
    resourceCost: ResourceCostSchema.optional(),
});
export type UseItemPayload = z.infer<typeof UseItemPayloadSchema>;

/**
 * Opportunity Attack Payload — Reaction: strike a creature leaving your reach
 */
export const OpportunityAttackPayloadSchema = z.object({
    type: z.literal("OPPORTUNITY_ATTACK"),
    attackerId: z.string(),
    targetId: z.string(),
    weaponName: z.string().optional(),
    resourceCost: ResourceCostSchema.optional(),
});
export type OpportunityAttackPayload = z.infer<typeof OpportunityAttackPayloadSchema>;

/**
 * Heal Payload — Restore hit points to a target (potion, spell, etc.)
 * Uses the Action resource by default (e.g. drinking/administering a potion).
 */
export const HealPayloadSchema = z.object({
    type: z.literal("HEAL"),
    entityId: z.string(),            // Who is performing the healing
    targetId: z.string(),            // Who is being healed
    amount: z.number().int().positive(), // HP to restore
    resourceCost: ResourceCostSchema.optional(),
});
export type HealPayload = z.infer<typeof HealPayloadSchema>;

/**
 * Second Wind Payload — Fighter class feature: heal 1d10 + fighter level as a bonus action
 */
export const SecondWindPayloadSchema = z.object({
    type: z.literal("SECOND_WIND"),
    entityId: z.string(),
    resourceCost: ResourceCostSchema.optional(),
});
export type SecondWindPayload = z.infer<typeof SecondWindPayloadSchema>;

/**
 * Action Surge Payload — Fighter class feature: gain one additional action this turn
 */
export const ActionSurgePayloadSchema = z.object({
    type: z.literal("ACTION_SURGE"),
    entityId: z.string(),
    resourceCost: ResourceCostSchema.optional(),
});
export type ActionSurgePayload = z.infer<typeof ActionSurgePayloadSchema>;

/**
 * Rage Payload — Barbarian enters rage as a bonus action
 */
export const RagePayloadSchema = z.object({
    type: z.literal("RAGE"),
    entityId: z.string(),
    resourceCost: ResourceCostSchema.optional(),
});
export type RagePayload = z.infer<typeof RagePayloadSchema>;

/**
 * Divine Smite Payload — Paladin expends a spell slot after a melee hit
 */
export const SmitePayloadSchema = z.object({
    type: z.enum(["SMITE_1", "SMITE_2", "SMITE_3"]),
    entityId: z.string(),
});
export type SmitePayload = z.infer<typeof SmitePayloadSchema>;

/**
 * Decline Smite Payload — Paladin skips smite, proceeds with normal damage
 */
export const DeclineSmitePayloadSchema = z.object({
    type: z.literal("DECLINE_SMITE"),
    entityId: z.string(),
});
export type DeclineSmitePayload = z.infer<typeof DeclineSmitePayloadSchema>;

/**
 * End Turn Payload — Explicitly end your turn
 */
export const EndTurnPayloadSchema = z.object({
    type: z.literal("END_TURN"),
    entityId: z.string(),
});
export type EndTurnPayload = z.infer<typeof EndTurnPayloadSchema>;

/**
 * Cast Spell Payload — Cast a spell using a spell slot
 * castingTime on the spell overrides the default action cost.
 */
export const CastSpellPayloadSchema = z.object({
    type: z.literal("CAST_SPELL"),
    casterId: z.string(),
    spellName: z.string(),
    targetIds: z.array(z.string()).default([]), // empty = self or pure area
    spellSlotLevel: z.number().int().min(0).max(9).optional(), // for upcasting; defaults to spell.level
    resourceCost: ResourceCostSchema.optional(),
});
export type CastSpellPayload = z.infer<typeof CastSpellPayloadSchema>;

/**
 * Pending Spell Save — Stored when waiting for a PLAYER to roll a saving throw
 * against an enemy spell (enemy saves are auto-resolved by the engine).
 */
export const PendingSpellSaveSchema = z.object({
    casterId: z.string(),
    spellName: z.string(),
    spellSaveDC: z.number().int(),
    saveStat: z.enum(['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA']),
    halfOnSave: z.boolean().default(true),
    damageFormula: z.string().optional(),
    damageType: z.string().optional(),
    conditions: z.array(z.string()).default([]),
    // Which player targets still need to roll (processed one at a time)
    pendingTargetIds: z.array(z.string()),
    createdAt: z.number().default(() => Date.now()),
});
export type PendingSpellSave = z.infer<typeof PendingSpellSaveSchema>;

/**
 * Union of all action payloads the engine accepts
 */
export const ActionPayloadSchema = z.discriminatedUnion("type", [
    AttackPayloadSchema,
    MovePayloadSchema,
    DodgePayloadSchema,
    DashPayloadSchema,
    DisengagePayloadSchema,
    HealPayloadSchema,
    HelpPayloadSchema,
    HidePayloadSchema,
    ReadyPayloadSchema,
    UseItemPayloadSchema,
    SecondWindPayloadSchema,
    ActionSurgePayloadSchema,
    RagePayloadSchema,
    SmitePayloadSchema,
    DeclineSmitePayloadSchema,
    OpportunityAttackPayloadSchema,
    EndTurnPayloadSchema,
    CastSpellPayloadSchema,
]);
export type ActionPayload = z.infer<typeof ActionPayloadSchema>;

// =============================================================================
// BATTLE STATE — The complete state of combat at any moment
// =============================================================================

/**
 * Roll Request — When we need the user to roll dice
 * 
 * The engine pauses and sends this to the frontend.
 * Frontend shows 3D dice, user rolls, result comes back.
 */
export const RollRequestSchema = z.object({
    id: z.string(),
    formula: z.string(),        // "1d20+5"
    purpose: z.string(),        // "Attack roll against Goblin"
    entityId: z.string(),       // Who's rolling
    createdAt: z.number(),      // Timestamp
});
export type RollRequest = z.infer<typeof RollRequestSchema>;

/**
 * Pending Attack — Stored when waiting for player's damage roll
 * 
 * After a successful attack roll, the engine enters AWAIT_DAMAGE_ROLL phase
 * and stores this so we know who hit whom and whether it was a crit.
 */
export const PendingAttackSchema = z.object({
    attackerId: z.string(),
    targetId: z.string(),
    isCritical: z.boolean(),
    isRanged: z.boolean().default(false),
    weaponName: z.string().optional(),
    damageFormula: z.string(),      // Expected damage formula (e.g., "1d8+3")
    damageType: z.string().optional(), // e.g., "piercing", "slashing", "bludgeoning"
    createdAt: z.number(),
});
export type PendingAttack = z.infer<typeof PendingAttackSchema>;

/**
 * Pending Initiative — Stored when waiting for player initiative rolls
 *
 * After combat is triggered, the engine enters AWAIT_INITIATIVE phase
 * and tracks which players still need to roll.
 */
export const PendingInitiativeSchema = z.object({
    pendingEntityIds: z.array(z.string()),  // Players who haven't rolled yet
    rolledEntityIds: z.array(z.string()),   // Players who have rolled
    createdAt: z.number(),
});
export type PendingInitiative = z.infer<typeof PendingInitiativeSchema>;

/**
 * Pending Attack Roll — Stored when waiting for player's attack roll from visual dice.
 *
 * After a player initiates an attack without providing a roll,
 * the engine enters AWAIT_ATTACK_ROLL and stores this context
 * so it can resume processing when the dice result arrives.
 */
export const PendingAttackRollSchema = z.object({
    attackerId: z.string(),
    targetId: z.string(),
    attackModifier: z.number(),
    advantage: z.boolean().default(false),
    disadvantage: z.boolean().default(false),
    weaponName: z.string().optional(),
    isSpellAttack: z.boolean().default(false),
    spellName: z.string().optional(),
    createdAt: z.number(),
});
export type PendingAttackRoll = z.infer<typeof PendingAttackRollSchema>;

/**
 * Pending Smite Decision — Stored when a Paladin hits with melee and has spell slots.
 * The engine enters AWAIT_SMITE_DECISION and stores this context.
 */
export const PendingSmiteSchema = z.object({
    attackerId: z.string(),
    targetId: z.string(),
    isCritical: z.boolean(),
    isRanged: z.boolean().default(false),
    weaponName: z.string().optional(),
    damageFormula: z.string(),
    damageType: z.string().optional(),
    damageRoll: z.number().int(),  // Already-rolled damage value from player
    createdAt: z.number(),
});
export type PendingSmite = z.infer<typeof PendingSmiteSchema>;

/**
 * Game Settings — Configuration for the combat engine
 * 
 * Can be changed at runtime via UI in the future.
 */
export const GameSettingsSchema = z.object({
    // AI model routing (for future: simple enemies use cheap model)
    aiModels: z.object({
        minionTier: z.string().default("gpt-4o-mini"),
        bossTier: z.string().default("gpt-4o"),
    }).default({ minionTier: "gpt-4o-mini", bossTier: "gpt-4o" }),

    // Debug options
    debugMode: z.boolean().default(false),
});
export type GameSettings = z.infer<typeof GameSettingsSchema>;

/**
 * Turn Resources — Tracks what actions are available this turn (D&D 5e action economy)
 *
 * Each turn, a combatant gets: 1 Action, 1 Bonus Action, Movement, 1 Reaction (per round).
 * Extra Attack (Fighter 5+, etc.) grants additional attacks when taking the Attack action.
 */
export const TurnResourcesSchema = z.object({
    actionUsed: z.boolean().default(false),
    bonusActionUsed: z.boolean().default(false),
    movementUsed: z.boolean().default(false),
    reactionUsed: z.boolean().default(false),
    extraAttacksRemaining: z.number().int().default(0), // Fighter Extra Attack, etc.
    sneakAttackUsedThisTurn: z.boolean().default(false), // Rogue: once per turn
});
export type TurnResources = z.infer<typeof TurnResourcesSchema>;

export type BattleState = {
    id: string;
    sessionId: number;
    entities: CombatEntity[];
    turnOrder: string[];
    round: number;
    turnIndex: number;
    phase: CombatPhase;
    log: CombatLogEntry[];
    turnResources?: TurnResources;        // Current turn's remaining resources
    pendingRoll?: RollRequest;
    pendingAttack?: PendingAttack;        // When waiting for damage roll
    pendingInitiative?: PendingInitiative; // When waiting for player initiative rolls
    pendingAttackRoll?: PendingAttackRoll; // When waiting for player attack roll from visual dice
    pendingSpellSave?: PendingSpellSave;  // When waiting for player saving throw against a spell
    pendingSmite?: PendingSmite;          // When waiting for Paladin's smite decision
    history: BattleState[];
    settings: GameSettings;
    createdAt: number;
    updatedAt: number;
};

export const BattleStateSchema: z.ZodType<BattleState> = z.lazy(() => z.object({
    // Identity
    id: z.string(),
    sessionId: z.number().int(),

    // Combatants
    entities: z.array(CombatEntitySchema),
    turnOrder: z.array(z.string()),

    // Turn tracking
    round: z.number().int().default(1),
    turnIndex: z.number().int().default(0),
    phase: CombatPhaseSchema.default("IDLE"),

    // Event log
    log: z.array(CombatLogEntrySchema).default([]),

    // Action economy — current turn's remaining resources
    turnResources: TurnResourcesSchema.optional(),

    // Pending roll
    pendingRoll: RollRequestSchema.optional(),

    // Pending attack (waiting for damage roll)
    pendingAttack: PendingAttackSchema.optional(),

    // Pending initiative (waiting for player initiative rolls)
    pendingInitiative: PendingInitiativeSchema.optional(),

    // Pending attack roll (waiting for player's d20 from visual dice roller)
    pendingAttackRoll: PendingAttackRollSchema.optional(),

    // Pending spell save (waiting for player's saving throw against a spell)
    pendingSpellSave: PendingSpellSaveSchema.optional(),

    // Pending smite decision (Paladin choosing whether to smite after melee hit)
    pendingSmite: PendingSmiteSchema.optional(),

    // History stack
    history: z.array(BattleStateSchema).default([]),

    // Settings
    settings: GameSettingsSchema.default({
        aiModels: { minionTier: "gpt-4o-mini", bossTier: "gpt-4o" },
        debugMode: false,
    }),

    // Timestamps
    createdAt: z.number().default(() => Date.now()),
    updatedAt: z.number().default(() => Date.now()),
}));

// =============================================================================
// HELPER TYPES
// =============================================================================

/**
 * Legal Action — A single action an entity can legally take right now
 *
 * Used by the UI to show available actions and by enemy AI to constrain choices.
 */
export interface LegalAction {
    type: ActionType;
    targetId?: string;
    targetName?: string;
    weaponName?: string;
    spellName?: string;
    direction?: "toward" | "away";
    description: string;
    resourceCost: ResourceCost;  // Which turn resource this action would consume
}

/**
 * Result of submitting an action to the engine
 */
export interface ActionResult {
    success: boolean;
    logs: CombatLogEntry[];
    newState: BattleState;
    error?: string;
    awaitingDamageRoll?: boolean;  // True if waiting for player to roll damage
    awaitingAttackRoll?: boolean;  // True if waiting for player to roll attack (visual dice)
    awaitingSaveRoll?: boolean;    // True if waiting for player's saving throw
    awaitingSmiteDecision?: boolean; // True if Paladin can choose to smite
}

// =============================================================================
// FACTORY FUNCTIONS (for creating entities)
// =============================================================================

/**
 * Create a default player entity from database character
 */
export function createPlayerEntity(
    id: string,
    name: string,
    hp: number,
    maxHp: number,
    ac: number,
    initiative: number,
    options?: Partial<CombatEntity>
): CombatEntity {
    return CombatEntitySchema.parse({
        id,
        name,
        type: "player",
        hp,
        maxHp,
        baseAC: ac,
        initiative,
        isEssential: true,  // Players don't die outright
        ...options,
    });
}

/**
 * Create a default enemy entity
 */
export function createEnemyEntity(
    id: string,
    name: string,
    hp: number,
    ac: number,
    attackMod: number,
    damageFormula: string,
    options?: Partial<CombatEntity>
): CombatEntity {
    return CombatEntitySchema.parse({
        id,
        name,
        type: "enemy",
        hp,
        maxHp: hp,
        baseAC: ac,
        attackModifier: attackMod,
        damageFormula,
        isEssential: false,  // Enemies die at 0 HP
        ...options,
    });
}
