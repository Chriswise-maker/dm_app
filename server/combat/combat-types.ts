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
    "AWAIT_DAMAGE_ROLL",
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

    // Conditions (future: poisoned, frightened, etc.)
    conditions: z.array(z.string()).default([]),

    // Position relative to others
    rangeTo: z.record(z.string(), z.nativeEnum(RangeBand)).default({}),

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
 * Action Types — What kinds of things can you do on your turn?
 */
export const ActionTypeSchema = z.enum([
    "ATTACK",
    "CAST_SPELL",    // Future
    "DASH",          // Move double distance
    "DISENGAGE",     // Move without opportunity attacks
    "DODGE",         // Disadvantage on attacks against you
    "HELP",          // Give ally advantage
    "HIDE",          // Stealth
    "READY",         // Prepare a reaction
    "USE_ITEM",      // Future
    "END_TURN",      // Skip remaining actions
]);
export type ActionType = z.infer<typeof ActionTypeSchema>;

/**
 * Attack Payload — Details of an attack action
 */
export const AttackPayloadSchema = z.object({
    type: z.literal("ATTACK"),
    attackerId: z.string(),
    targetId: z.string(),
    weaponName: z.string().optional(),
    isRanged: z.boolean().default(false),
    advantage: z.boolean().default(false),
    disadvantage: z.boolean().default(false),
    /** Optional: Player-provided attack roll (if they rolled themselves) */
    attackRoll: z.number().int().optional(),
});
export type AttackPayload = z.infer<typeof AttackPayloadSchema>;

/**
 * End Turn Payload — Explicitly end your turn
 */
export const EndTurnPayloadSchema = z.object({
    type: z.literal("END_TURN"),
    entityId: z.string(),
});
export type EndTurnPayload = z.infer<typeof EndTurnPayloadSchema>;

/**
 * Union of all action payloads
 */
export const ActionPayloadSchema = z.discriminatedUnion("type", [
    AttackPayloadSchema,
    EndTurnPayloadSchema,
    // Future: CastSpellPayloadSchema, DashPayloadSchema, etc.
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
    weaponName: z.string().optional(),
    damageFormula: z.string(),      // Expected damage formula (e.g., "1d8+3")
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

    // Gameplay options
    autoCritDamage: z.boolean().default(true),  // Auto-max crit damage?
    allowNegativeHP: z.boolean().default(false),

    // Debug options
    debugMode: z.boolean().default(false),
});
export type GameSettings = z.infer<typeof GameSettingsSchema>;

export type BattleState = {
    id: string;
    sessionId: number;
    entities: CombatEntity[];
    turnOrder: string[];
    round: number;
    turnIndex: number;
    phase: CombatPhase;
    log: CombatLogEntry[];
    pendingRoll?: RollRequest;
    pendingAttack?: PendingAttack;  // When waiting for damage roll
    pendingInitiative?: PendingInitiative;  // When waiting for player initiative rolls
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

    // Pending roll
    pendingRoll: RollRequestSchema.optional(),

    // Pending attack (waiting for damage roll)
    pendingAttack: PendingAttackSchema.optional(),

    // Pending initiative (waiting for player initiative rolls)
    pendingInitiative: PendingInitiativeSchema.optional(),

    // History stack
    history: z.array(BattleStateSchema).default([]),

    // Settings
    settings: GameSettingsSchema.default({
        aiModels: { minionTier: "gpt-4o-mini", bossTier: "gpt-4o" },
        autoCritDamage: true,
        allowNegativeHP: false,
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
 * Result of submitting an action to the engine
 */
export interface ActionResult {
    success: boolean;
    logs: CombatLogEntry[];
    newState: BattleState;
    error?: string;
    awaitingDamageRoll?: boolean;  // True if waiting for player to roll damage
}

/**
 * Entity with computed stats (after applying modifiers)
 * 
 * These are the "hook methods" mentioned in the constraints.
 * The base CombatEntity has raw stats; this interface adds
 * functions to compute context-aware stats.
 */
export interface CombatEntityWithHooks extends CombatEntity {
    getAC: (context?: AttackContext) => number;
    getAttackModifier: (context?: AttackContext) => number;
    getSavingThrow: (ability: string) => number;
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
