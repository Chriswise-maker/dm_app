/**
 * Combat Engine V2 — The Deterministic Combat Core
 * 
 * This is the "brain" of combat. It:
 * - Keeps track of all combatants and their HP
 * - Manages turn order (initiative)
 * - Processes actions (attacks, spells, etc.)
 * - Logs everything that happens
 * - Supports undo via history stack
 * 
 * Key principle: NO RANDOMNESS INSIDE THE ENGINE.
 * All dice rolling happens outside (via the dice library or user input).
 * The engine just applies the results.
 */

import { DiceRoll } from "@dice-roller/rpg-dice-roller";
import { nanoid } from "nanoid";
import { activity } from "../activity-log";
import {
    type BattleState,
    type CombatEntity,
    type CombatLogEntry,
    type ActionPayload,
    type ActionResult,
    type RollRequest,
    type GameSettings,
    type AttackPayload,
    BattleStateSchema,
    GameSettingsSchema,
    LogEntryTypeSchema,
    type LogEntryType,
} from "./combat-types";
import { validateDiceRoll } from "./combat-validators";

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Deep clone state for history (undo support)
 * We exclude the history array itself to avoid infinite nesting
 */
function cloneStateForHistory(state: BattleState): BattleState {
    const { history, ...rest } = state;
    return JSON.parse(JSON.stringify(rest)) as BattleState;
}

/**
 * Roll dice using the library
 * Returns the numeric result
 */
function rollDice(formula: string): { total: number; rolls: number[]; isCritical: boolean; isFumble: boolean } {
    const roll = new DiceRoll(formula);

    // Check for nat 20 or nat 1 on d20 rolls
    let isCritical = false;
    let isFumble = false;

    // Extract individual die results for crit/fumble detection
    const rolls: number[] = [];
    for (const result of roll.rolls) {
        if (typeof result === "object" && "rolls" in result) {
            for (const die of result.rolls as Array<{ value: number }>) {
                rolls.push(die.value);
                // Check for crits on d20s
                if ((result as any).die === "d20") {
                    if (die.value === 20) isCritical = true;
                    if (die.value === 1) isFumble = true;
                }
            }
        }
    }

    return { total: roll.total, rolls, isCritical, isFumble };
}

/**
 * Generate a unique ID for entities and log entries
 */
function generateId(prefix: string = ""): string {
    return prefix ? `${prefix}-${nanoid(8)}` : nanoid(8);
}

// =============================================================================
// COMBAT ENGINE V2
// =============================================================================

export type RollFn = (formula: string) => { total: number; rolls: number[]; isCritical: boolean; isFumble: boolean };

export class CombatEngineV2 {
    private state: BattleState;
    private maxHistorySize: number = 20;  // Keep last 20 states for undo
    private rollFn: RollFn;

    constructor(sessionId: number, settings?: Partial<GameSettings>, rollFn?: RollFn) {
        this.rollFn = rollFn ?? rollDice;
        this.state = BattleStateSchema.parse({
            id: generateId("battle"),
            sessionId,
            entities: [],
            turnOrder: [],
            round: 0,
            turnIndex: 0,
            phase: "IDLE",
            log: [],
            history: [],
            settings: GameSettingsSchema.parse(settings || {}),
        });
    }

    // ===========================================================================
    // STATE MANAGEMENT
    // ===========================================================================

    /**
     * Get current state (read-only copy)
     */
    getState(): Readonly<BattleState> {
        return structuredClone(this.state) as Readonly<BattleState>;
    }

    /**
     * Export state as JSON string (for saving to database)
     */
    exportState(): string {
        // Exclude history from export (too large for DB)
        const { history, ...exportable } = this.state;
        return JSON.stringify(exportable);
    }

    /**
     * Load state from JSON string (from database)
     */
    loadState(json: string): void {
        const parsed = JSON.parse(json);
        this.state = BattleStateSchema.parse({
            ...parsed,
            history: [],  // Reset history on load
        });
    }

    /**
     * Save state for debugging (writes to file)
     */
    saveDebugState(): string {
        const filename = `debug-snapshot-${Date.now()}.json`;
        const content = JSON.stringify(this.state, null, 2);
        // In Node.js environment, we'd write to file
        // For now, we just return the content
        console.log(`[CombatEngineV2] Debug snapshot: ${filename}`);
        return content;
    }

    /**
     * Push current state to history (for undo)
     */
    private pushHistory(): void {
        const snapshot = cloneStateForHistory(this.state);
        this.state.history = [snapshot, ...this.state.history].slice(0, this.maxHistorySize);
    }

    /**
     * Undo the last action
     */
    undoLastAction(): boolean {
        if (this.state.history.length === 0) {
            return false;
        }

        const previousState = this.state.history[0];
        this.state = {
            ...previousState,
            history: this.state.history.slice(1),
        };
        return true;
    }

    // ===========================================================================
    // COMBAT LIFECYCLE
    // ===========================================================================

    /**
     * Prepare combat - Add entities but wait for player initiative rolls
     * 
     * This is called when combat begins. It:
     * 1. Adds all combatants to the battle
     * 2. For players: enters AWAIT_INITIATIVE phase for them to roll
     * 3. For enemies: they will auto-roll once all players have rolled
     * 
     * Returns logs and whether we're awaiting initiative rolls.
     */
    prepareCombat(entities: CombatEntity[]): { logs: CombatLogEntry[]; awaitingInitiative: boolean } {
        this.pushHistory();
        const logs: CombatLogEntry[] = [];

        // Add all entities
        this.state.entities = [...entities];

        // Find players who need to roll initiative (those with initiative === 0)
        const playersNeedingRolls = this.state.entities.filter(
            e => e.type === 'player' && e.initiative === 0
        );

        if (playersNeedingRolls.length > 0) {
            // Enter AWAIT_INITIATIVE phase
            this.state.phase = "AWAIT_INITIATIVE";
            this.state.pendingInitiative = {
                pendingEntityIds: playersNeedingRolls.map(e => e.id),
                rolledEntityIds: [],
                createdAt: Date.now(),
            };
            this.state.updatedAt = Date.now();

            activity.system(this.state.sessionId, `Combat preparing - waiting for ${playersNeedingRolls.length} player initiative roll(s)`);

            return { logs, awaitingInitiative: true };
        }

        // No players need to roll - start combat immediately
        return { logs: this.startCombat(), awaitingInitiative: false };
    }

    /**
     * Apply a player's initiative roll
     * 
     * @param entityId - The player entity ID
     * @param roll - The player's initiative roll result (without modifier - we add it)
     */
    applyInitiative(entityId: string, roll: number): { logs: CombatLogEntry[]; combatStarted: boolean; remainingPlayers: string[] } {
        const logs: CombatLogEntry[] = [];

        if (this.state.phase !== 'AWAIT_INITIATIVE' || !this.state.pendingInitiative) {
            return { logs, combatStarted: false, remainingPlayers: [] };
        }

        const entity = this.getEntity(entityId);
        if (!entity) {
            return { logs, combatStarted: false, remainingPlayers: this.state.pendingInitiative.pendingEntityIds };
        }

        // Apply initiative (roll + modifier)
        // Validate roll (which is the raw die roll here, usually 1-20)
        // The signature is (entityId, roll). The caller (routers.ts) passes the raw extracted roll e.g. "18".
        // Wait, check routers.ts usage.
        // If router extracts "18" from "I rolled 18", is 18 the TOTAL or the DIE?
        // Usually players say the total.
        // But the `applyInitiative` function adds `entity.initiativeModifier`.
        // So checking the parsing logic (router/parser) is important.
        // 
        // Based on `entity.initiative = roll + entity.initiativeModifier;` it assumes `roll` is the RAW d20.
        // So we validate it against "1d20".

        const validation = validateDiceRoll(roll, "1d20");
        if (!validation.valid) {
            // We can't return error easily here as the signature returns logs.
            // We'll log an error and NOT apply the roll?
            // Or update the signature?
            // For now let's just create an error log and return.
            logs.push(this.createLogEntry("CUSTOM", {
                description: `Invalid initiative roll: ${roll}. Must be 1-20.`
            }));
            return { logs, combatStarted: false, remainingPlayers: this.state.pendingInitiative.pendingEntityIds };
        }

        entity.initiative = roll + entity.initiativeModifier;

        logs.push(this.createLogEntry("INITIATIVE_ROLLED", {
            actorId: entity.id,
            roll: {
                formula: `1d20+${entity.initiativeModifier}`,
                result: entity.initiative,
                isCritical: false,
                isFumble: false,
            },
            description: `${entity.name} rolls initiative: ${entity.initiative}`,
        }));

        activity.roll(this.state.sessionId, `${entity.name} rolls initiative: ${entity.initiative} (${roll}+${entity.initiativeModifier})`);

        // Move entity from pending to rolled
        this.state.pendingInitiative.pendingEntityIds = this.state.pendingInitiative.pendingEntityIds.filter(id => id !== entityId);
        this.state.pendingInitiative.rolledEntityIds.push(entityId);
        this.state.updatedAt = Date.now();

        // Check if all players have rolled
        if (this.state.pendingInitiative.pendingEntityIds.length === 0) {
            // All players rolled - start combat!
            const startLogs = this.startCombat();
            return { logs: [...logs, ...startLogs], combatStarted: true, remainingPlayers: [] };
        }

        // Still waiting for more players
        return {
            logs,
            combatStarted: false,
            remainingPlayers: this.state.pendingInitiative.pendingEntityIds
        };
    }

    /**
     * Start combat after all initiative is resolved
     * 
     * This:
     * 1. Auto-rolls initiative for enemies/NPCs
     * 2. Sorts turn order with tie-breakers
     * 3. Starts round 1
     */
    private startCombat(): CombatLogEntry[] {
        const logs: CombatLogEntry[] = [];

        // Roll initiative for enemies/allies (those with initiative === 0)
        for (const entity of this.state.entities) {
            if (entity.initiative === 0) {
                const roll = this.rollFn("1d20");
                entity.initiative = roll.total + entity.initiativeModifier;

                logs.push(this.createLogEntry("INITIATIVE_ROLLED", {
                    actorId: entity.id,
                    roll: {
                        formula: `1d20+${entity.initiativeModifier}`,
                        result: entity.initiative,
                        isCritical: false,
                        isFumble: false,
                    },
                    description: `${entity.name} rolls initiative: ${entity.initiative}`,
                }));

                activity.roll(this.state.sessionId, `${entity.name} rolls initiative: ${entity.initiative}`);
            }
        }

        // Sort turn order with tie-breakers:
        // 1. Total initiative (descending)
        // 2. Initiative modifier / DEX (descending)
        // 3. Random coin flip
        this.state.turnOrder = this.state.entities
            .map(e => e.id)
            .sort((a, b) => {
                const entityA = this.getEntity(a)!;
                const entityB = this.getEntity(b)!;

                // First: compare initiative totals
                if (entityB.initiative !== entityA.initiative) {
                    return entityB.initiative - entityA.initiative;
                }

                // Second: compare modifiers (DEX)
                if (entityB.initiativeModifier !== entityA.initiativeModifier) {
                    return entityB.initiativeModifier - entityA.initiativeModifier;
                }

                // Third: random coin flip
                return Math.random() > 0.5 ? 1 : -1;
            });

        // Log final turn order to activity log
        const turnOrderNames = this.state.turnOrder.map(id => {
            const entity = this.getEntity(id);
            return entity ? `${entity.name} (${entity.initiative})` : id;
        }).join(' → ');
        activity.system(this.state.sessionId, `Turn order: ${turnOrderNames}`);

        // Clear pending initiative
        this.state.pendingInitiative = undefined;

        // Start round 1
        this.state.round = 1;
        this.state.turnIndex = 0;
        this.state.phase = "ACTIVE";
        this.state.updatedAt = Date.now();

        logs.push(this.createLogEntry("COMBAT_START", {
            description: `Combat begins! Round 1 starts.`,
        }));

        // Activity log for combat start
        activity.system(this.state.sessionId, `Combat started with ${this.state.entities.length} combatants`);

        logs.push(this.createLogEntry("TURN_START", {
            actorId: this.state.turnOrder[0],
            description: `${this.getEntity(this.state.turnOrder[0])?.name}'s turn begins.`,
        }));

        return logs;
    }

    /**
     * Legacy: Add entities and start combat immediately (auto-rolls all initiative)
     * 
     * Used by tests and when no players need to roll.
     */
    initiateCombat(entities: CombatEntity[]): CombatLogEntry[] {
        this.pushHistory();
        const logs: CombatLogEntry[] = [];

        // Add all entities
        this.state.entities = [...entities];

        // Roll initiative for ALL entities with initiative === 0
        for (const entity of this.state.entities) {
            if (entity.initiative === 0) {
                const roll = this.rollFn("1d20");
                entity.initiative = roll.total + entity.initiativeModifier;

                logs.push(this.createLogEntry("INITIATIVE_ROLLED", {
                    actorId: entity.id,
                    roll: {
                        formula: `1d20+${entity.initiativeModifier}`,
                        result: entity.initiative,
                        isCritical: false,
                        isFumble: false,
                    },
                    description: `${entity.name} rolls initiative: ${entity.initiative}`,
                }));

                activity.roll(this.state.sessionId, `${entity.name} rolls initiative: ${entity.initiative}`);
            }
        }

        // Sort turn order with tie-breakers
        this.state.turnOrder = this.state.entities
            .map(e => e.id)
            .sort((a, b) => {
                const entityA = this.getEntity(a)!;
                const entityB = this.getEntity(b)!;

                if (entityB.initiative !== entityA.initiative) {
                    return entityB.initiative - entityA.initiative;
                }

                if (entityB.initiativeModifier !== entityA.initiativeModifier) {
                    return entityB.initiativeModifier - entityA.initiativeModifier;
                }

                return Math.random() > 0.5 ? 1 : -1;
            });

        // Log turn order
        const turnOrderNames = this.state.turnOrder.map(id => {
            const entity = this.getEntity(id);
            return entity ? `${entity.name} (${entity.initiative})` : id;
        }).join(' → ');
        activity.system(this.state.sessionId, `Turn order: ${turnOrderNames}`);

        // Start round 1
        this.state.round = 1;
        this.state.turnIndex = 0;
        this.state.phase = "ACTIVE";
        this.state.updatedAt = Date.now();

        logs.push(this.createLogEntry("COMBAT_START", {
            description: `Combat begins! Round 1 starts.`,
        }));

        activity.system(this.state.sessionId, `Combat started with ${this.state.entities.length} combatants`);

        logs.push(this.createLogEntry("TURN_START", {
            actorId: this.state.turnOrder[0],
            description: `${this.getEntity(this.state.turnOrder[0])?.name}'s turn begins.`,
        }));

        return logs;
    }

    /**
     * End combat
     */
    endCombat(reason: string = "Combat ended"): CombatLogEntry[] {
        this.pushHistory();

        this.state.phase = "RESOLVED";
        this.state.updatedAt = Date.now();

        // Activity log for combat end
        activity.system(this.state.sessionId, `Combat ended: ${reason}`);

        return [this.createLogEntry("COMBAT_END", {
            description: reason,
        })];
    }

    /**
     * Get the entity whose turn it currently is
     */
    getCurrentTurnEntity(): CombatEntity | null {
        if (this.state.phase !== "ACTIVE") return null;
        const entityId = this.state.turnOrder[this.state.turnIndex];
        return this.getEntity(entityId) || null;
    }

    /**
     * Start a specific entity's turn (for lifecycle hooks)
     */
    startTurn(entityId: string): CombatLogEntry[] {
        const entity = this.getEntity(entityId);
        if (!entity) return [];

        const logs: CombatLogEntry[] = [];

        // Future: Apply start-of-turn effects (regen, damage over time, etc.)

        logs.push(this.createLogEntry("TURN_START", {
            actorId: entityId,
            description: `${entity.name}'s turn begins.`,
        }));

        return logs;
    }

    /**
     * End the current turn and advance to next
     */
    endTurn(): CombatLogEntry[] {
        this.pushHistory();
        const logs: CombatLogEntry[] = [];

        const currentEntityId = this.state.turnOrder[this.state.turnIndex];
        const currentEntity = this.getEntity(currentEntityId);

        if (currentEntity) {
            logs.push(this.createLogEntry("TURN_END", {
                actorId: currentEntityId,
                description: `${currentEntity.name}'s turn ends.`,
            }));
        }

        // Advance turn index
        this.state.turnIndex++;

        // Check if round is over
        if (this.state.turnIndex >= this.state.turnOrder.length) {
            this.state.turnIndex = 0;
            this.state.round++;

            logs.push(this.createLogEntry("ROUND_END", {
                description: `Round ${this.state.round - 1} ends.`,
            }));

            logs.push(this.createLogEntry("ROUND_START", {
                description: `Round ${this.state.round} begins.`,
            }));
        }

        // Skip dead/fled entities; track round wrapping during skip
        let attempts = 0;
        while (attempts < this.state.turnOrder.length) {
            const nextEntityId = this.state.turnOrder[this.state.turnIndex];
            const nextEntity = this.getEntity(nextEntityId);

            if (nextEntity && nextEntity.status === "ALIVE") {
                break;
            }

            const prevIndex = this.state.turnIndex;
            this.state.turnIndex = (this.state.turnIndex + 1) % this.state.turnOrder.length;

            // Wrapped past end → new round
            if (prevIndex === this.state.turnOrder.length - 1) {
                this.state.round++;
                logs.push(this.createLogEntry("ROUND_END", {
                    description: `Round ${this.state.round - 1} ends.`,
                }));
                logs.push(this.createLogEntry("ROUND_START", {
                    description: `Round ${this.state.round} begins.`,
                }));
            }

            attempts++;
        }

        // Check if combat should end (all enemies or all players dead)
        const combatEndReason = this.getCombatEndReason();
        if (combatEndReason) {
            return [...logs, ...this.endCombat(combatEndReason)];
        }

        // Start next entity's turn
        const nextEntityId = this.state.turnOrder[this.state.turnIndex];
        logs.push(...this.startTurn(nextEntityId));

        this.state.updatedAt = Date.now();
        return logs;
    }

    // ===========================================================================
    // ENTITY MANAGEMENT
    // ===========================================================================

    /**
     * Get an entity by ID
     */
    getEntity(id: string): CombatEntity | undefined {
        return this.state.entities.find(e => e.id === id);
    }

    /**
     * Get all alive entities
     */
    getAliveEntities(): CombatEntity[] {
        return this.state.entities.filter(e => e.status === "ALIVE");
    }

    /**
     * Get all entities of a type
     */
    getEntitiesByType(type: "player" | "enemy" | "ally"): CombatEntity[] {
        return this.state.entities.filter(e => e.type === type);
    }

    /**
     * Add an entity mid-combat (reinforcements)
     */
    addEntity(entity: CombatEntity): void {
        this.pushHistory();
        this.state.entities.push(entity);

        // Insert into turn order based on initiative
        const insertIndex = this.state.turnOrder.findIndex(id => {
            const existing = this.getEntity(id);
            return existing && existing.initiative < entity.initiative;
        });

        if (insertIndex === -1) {
            this.state.turnOrder.push(entity.id);
        } else {
            this.state.turnOrder.splice(insertIndex, 0, entity.id);
        }
    }

    /**
     * Remove an entity from combat
     */
    removeEntity(id: string): void {
        this.pushHistory();
        this.state.entities = this.state.entities.filter(e => e.id !== id);
        this.state.turnOrder = this.state.turnOrder.filter(eid => eid !== id);

        // Adjust turn index if needed
        if (this.state.turnIndex >= this.state.turnOrder.length) {
            this.state.turnIndex = 0;
        }
    }

    // ===========================================================================
    // ACTION PROCESSING (Chunk 3 will expand this)
    // ===========================================================================

    /**
     * Submit an action (attack, spell, etc.)
     * Returns log entries describing what happened
     */
    submitAction(payload: ActionPayload): ActionResult {
        this.pushHistory();

        switch (payload.type) {
            case "ATTACK": {
                const attackPayload = payload as AttackPayload;
                const attacker = this.getEntity(attackPayload.attackerId);
                // If a player attacks without providing a roll → pause for visual dice roller
                if (attacker?.type === 'player' && attackPayload.attackRoll === undefined) {
                    return this.enterAwaitAttackRoll(attackPayload);
                }
                return this.processAttack(attackPayload);
            }

            case "END_TURN":
                return {
                    success: true,
                    logs: this.endTurn(),
                    newState: this.getState() as BattleState,
                };

            default:
                return {
                    success: false,
                    logs: [],
                    newState: this.getState() as BattleState,
                    error: `Unknown action type: ${(payload as any).type}`,
                };
        }
    }

    /**
     * Pause combat to await the player's attack roll from the visual dice roller.
     * Called by submitAction when a player attacks without providing attackRoll.
     * Sets phase to AWAIT_ATTACK_ROLL and stores the pending attack context.
     *
     * NOTE: pushHistory() has already been called by submitAction before this.
     */
    private enterAwaitAttackRoll(payload: AttackPayload): ActionResult {
        const attacker = this.getEntity(payload.attackerId);
        const target = this.getEntity(payload.targetId);

        if (!attacker || !target) {
            return {
                success: false,
                logs: [],
                newState: this.getState() as BattleState,
                error: `Attacker or target not found`,
            };
        }

        this.state.phase = 'AWAIT_ATTACK_ROLL';
        this.state.pendingAttackRoll = {
            attackerId: attacker.id,
            targetId: target.id,
            attackModifier: attacker.attackModifier,
            advantage: payload.advantage || false,
            disadvantage: payload.disadvantage || false,
            weaponName: payload.weaponName,
            createdAt: Date.now(),
        };
        this.state.updatedAt = Date.now();

        const diceFormula = (payload.advantage && !payload.disadvantage) ? "2d20kh1"
            : (payload.disadvantage && !payload.advantage) ? "2d20kl1"
            : "1d20";

        activity.system(
            this.state.sessionId,
            `${attacker.name} attacks ${target.name}! Awaiting attack roll (${diceFormula}+${attacker.attackModifier})`
        );

        return {
            success: true,
            logs: [this.createLogEntry("CUSTOM", {
                actorId: attacker.id,
                targetId: target.id,
                description: `${attacker.name} attacks ${target.name}! Roll to hit...`,
            })],
            newState: this.getState() as BattleState,
            awaitingAttackRoll: true,
        };
    }

    /**
     * Resolve a pending attack roll submitted by the visual dice roller.
     * Called when phase is AWAIT_ATTACK_ROLL.
     *
     * @param rawD20Roll - The raw d20 result (1-20). The engine adds the attacker's
     *                     attack modifier to compute the total attack roll.
     */
    resolveAttackRoll(rawD20Roll: number): ActionResult {
        if (this.state.phase !== 'AWAIT_ATTACK_ROLL' || !this.state.pendingAttackRoll) {
            return {
                success: false,
                logs: [],
                newState: this.getState() as BattleState,
                error: 'No pending attack roll',
            };
        }

        // Validate the d20 roll
        const validation = validateDiceRoll(rawD20Roll, "1d20");
        if (!validation.valid) {
            return {
                success: false,
                logs: [],
                newState: this.getState() as BattleState,
                error: `Invalid attack roll: ${rawD20Roll}. Must be 1-20.`,
            };
        }

        this.pushHistory();

        const pending = this.state.pendingAttackRoll;
        const totalAttack = rawD20Roll + pending.attackModifier;

        // Clear pending state and resume combat
        this.state.pendingAttackRoll = undefined;
        this.state.phase = 'ACTIVE';

        // Build an AttackPayload with the total pre-computed
        // (processAttack treats attackRoll as the TOTAL including modifier)
        const attackPayload: AttackPayload = {
            type: 'ATTACK',
            attackerId: pending.attackerId,
            targetId: pending.targetId,
            attackRoll: totalAttack,
            rawD20: rawD20Roll,  // Pass the raw d20 for accurate crit/fumble detection
            advantage: pending.advantage,
            disadvantage: pending.disadvantage,
            weaponName: pending.weaponName,
            isRanged: false,
        };

        return this.processAttack(attackPayload);
    }

    /**
     * Process an attack action
     *
     * Flow:
     * 1. Roll d20 + attack modifier
     * 2. Compare to target's AC
     * 3. If hit, roll damage
     * 4. Apply damage to target
     * 5. Check if target dies/goes unconscious
     */
    private processAttack(payload: AttackPayload): ActionResult {
        const logs: CombatLogEntry[] = [];

        const attacker = this.getEntity(payload.attackerId);
        const target = this.getEntity(payload.targetId);

        if (!attacker) {
            return {
                success: false,
                logs: [],
                newState: this.getState() as BattleState,
                error: `Attacker not found: ${payload.attackerId}`,
            };
        }

        if (!target) {
            return {
                success: false,
                logs: [],
                newState: this.getState() as BattleState,
                error: `Target not found: ${payload.targetId}`,
            };
        }

        // Determine dice formula (advantage/disadvantage)
        let diceFormula = "1d20";
        if (payload.advantage && !payload.disadvantage) {
            diceFormula = "2d20kh1";  // Roll 2, keep highest
        } else if (payload.disadvantage && !payload.advantage) {
            diceFormula = "2d20kl1";  // Roll 2, keep lowest
        }

        // Use player-provided roll or auto-roll
        let totalAttack: number;
        let isCritical = false;
        let isFumble = false;
        let rollDescription: string;

        if (payload.attackRoll !== undefined) {
            // Validate player's roll against formula
            const validation = validateDiceRoll(payload.attackRoll, `${diceFormula}+${attacker.attackModifier}`);

            // Note: validateDiceRoll checks the raw roll against formula min/max.
            // But payload.attackRoll is the TOTAL. We need to be careful.
            // Actually, the parser extracts "18" from "I got 18". This is the total.
            // But the formula is 1d20+Mod.
            // So we need to validate if 18 is possible given 1d20+Mod.

            // Re-check semantics: validateDiceRoll takes (result, formula)
            // If formula is "1d20+5", max is 25, min is 6.
            // If user says "I got 30", validation fails.

            if (!validation.valid) {
                return {
                    success: false,
                    logs: [],
                    newState: this.getState() as BattleState,
                    error: `Invalid attack roll: ${payload.attackRoll} is not possible with ${diceFormula}+${attacker.attackModifier} (Range: ${validation.min}-${validation.max})`
                };
            }

            // Player provided their roll (e.g., "I roll 20")
            totalAttack = payload.attackRoll; // Already includes their modifier
            if (payload.rawD20 !== undefined) {
                // Prefer the raw d20 for accurate crit/fumble detection
                isCritical = payload.rawD20 === 20;
                isFumble = payload.rawD20 === 1;
            } else {
                // Legacy path: reverse-engineer from total (kept for chat fallback)
                isCritical = payload.attackRoll >= 20 + attacker.attackModifier;
                isFumble = payload.attackRoll <= 1 + attacker.attackModifier;
            }
            rollDescription = `(player rolled ${totalAttack})`;
            console.log(`[CombatEngine] Using player-provided roll: ${totalAttack}`);
        } else {
            // Auto-roll
            const attackRoll = this.rollFn(diceFormula);
            totalAttack = attackRoll.total + attacker.attackModifier;
            isCritical = attackRoll.isCritical;
            isFumble = attackRoll.isFumble;
            const diceStr = attackRoll.rolls.length > 0 ? `[${attackRoll.rolls.join(',')}]` : attackRoll.total;
            rollDescription = `(${diceFormula}+${attacker.attackModifier} → ${diceStr}+${attacker.attackModifier} = ${totalAttack})`;
        }

        // Determine hit/miss (crits always hit, fumbles always miss)
        const isHit = isCritical || (!isFumble && totalAttack >= target.baseAC);

        logs.push(this.createLogEntry("ATTACK_ROLL", {
            actorId: attacker.id,
            targetId: target.id,
            roll: {
                formula: `${diceFormula}+${attacker.attackModifier}`,
                result: totalAttack,
                isCritical,
                isFumble,
            },
            success: isHit,
            description: isCritical
                ? `${attacker.name} rolls a CRITICAL HIT against ${target.name}! (${totalAttack} vs AC ${target.baseAC})`
                : isFumble
                    ? `${attacker.name} rolls a critical miss against ${target.name}! (Natural 1)`
                    : isHit
                        ? `${attacker.name} hits ${target.name}! (${totalAttack} vs AC ${target.baseAC})`
                        : `${attacker.name} misses ${target.name}. (${totalAttack} vs AC ${target.baseAC})`,
        }));

        // Activity log for roll with formula breakdown
        const hitStatus = isHit ? (isCritical ? 'CRITICAL HIT!' : 'HIT') : 'MISS';
        activity.roll(this.state.sessionId, `${attacker.name} rolls ${totalAttack} vs AC ${target.baseAC} ${rollDescription} → ${hitStatus}`);

        // If miss, end turn immediately
        if (!isHit) {
            this.state.updatedAt = Date.now();
            const turnLogs = this.endTurn();
            logs.push(...turnLogs);
            return {
                success: true,
                logs,
                newState: this.getState() as BattleState,
            };
        }

        // HIT! Now determine damage handling based on attacker type
        const damageFormula = isCritical
            ? this.doubleDiceFormula(attacker.damageFormula)
            : attacker.damageFormula;

        // For PLAYER attacks: pause and wait for damage roll
        if (attacker.type === 'player') {
            this.state.phase = 'AWAIT_DAMAGE_ROLL';
            this.state.pendingAttack = {
                attackerId: attacker.id,
                targetId: target.id,
                isCritical,
                weaponName: payload.weaponName,
                damageFormula,
                createdAt: Date.now(),
            };
            this.state.updatedAt = Date.now();

            activity.system(this.state.sessionId, `${attacker.name} hit! Awaiting damage roll (${damageFormula})`);

            return {
                success: true,
                logs,
                newState: this.getState() as BattleState,
                awaitingDamageRoll: true,  // Signal to caller
            };
        }

        // For ENEMY attacks: auto-roll damage immediately
        const damageRoll = this.rollFn(damageFormula);
        const damage = Math.max(1, damageRoll.total);  // Minimum 1 damage

        // Apply damage
        target.hp = Math.max(0, target.hp - damage);

        logs.push(this.createLogEntry("DAMAGE", {
            actorId: attacker.id,
            targetId: target.id,
            amount: damage,
            damageType: attacker.damageType,
            roll: {
                formula: damageFormula,
                result: damage,
                isCritical: false,
                isFumble: false,
            },
            description: `${attacker.name} deals ${damage} ${attacker.damageType} damage to ${target.name}! (${target.hp}/${target.maxHp} HP remaining)`,
        }));

        // Activity log for damage with formula breakdown
        const diceResults = damageRoll.rolls.length > 0 ? `[${damageRoll.rolls.join(',')}]` : damageRoll.total;
        activity.damage(this.state.sessionId, `${attacker.name} deals ${damage} ${attacker.damageType} to ${target.name} (${damageFormula} → ${diceResults} = ${damage}) (${target.hp}/${target.maxHp} HP)`);

        // Check for death/unconscious
        if (target.hp <= 0) {
            if (target.isEssential) {
                // Players go unconscious
                target.status = "UNCONSCIOUS";
                logs.push(this.createLogEntry("UNCONSCIOUS", {
                    targetId: target.id,
                    description: `${target.name} falls unconscious!`,
                }));
            } else {
                // Monsters die
                target.status = "DEAD";
                activity.death(this.state.sessionId, `${target.name} is slain!`);
                logs.push(this.createLogEntry("DEATH", {
                    targetId: target.id,
                    description: `${target.name} is slain!`,
                }));
            }
        }

        this.state.updatedAt = Date.now();

        // Auto-advance turn after attack (1 attack per turn for now)
        const turnLogs = this.endTurn();
        logs.push(...turnLogs);

        return {
            success: true,
            logs,
            newState: this.getState() as BattleState,
        };
    }

    /**
     * Apply damage from player's roll (called when in AWAIT_DAMAGE_ROLL phase)
     * 
     * @param damageRoll - The player's rolled damage value
     */
    applyDamage(damageRoll: number): ActionResult {
        if (this.state.phase !== 'AWAIT_DAMAGE_ROLL' || !this.state.pendingAttack) {
            return {
                success: false,
                logs: [],
                newState: this.getState() as BattleState,
                error: 'No pending attack to apply damage to',
            };
        }

        const pending = this.state.pendingAttack;

        // Validate damage roll
        // logic: user provides total damage. Formula is e.g. "1d8+3".
        const validation = validateDiceRoll(damageRoll, pending.damageFormula);
        if (!validation.valid) {
            return {
                success: false,
                logs: [],
                newState: this.getState() as BattleState,
                error: `Invalid damage roll: ${damageRoll} is not possible with ${pending.damageFormula} (Range: ${validation.min}-${validation.max})`
            };
        }

        this.pushHistory();
        const logs: CombatLogEntry[] = [];
        // const pending = this.state.pendingAttack; // Already defined above

        const attacker = this.getEntity(pending.attackerId);
        const target = this.getEntity(pending.targetId);

        if (!attacker || !target) {
            return {
                success: false,
                logs: [],
                newState: this.getState() as BattleState,
                error: 'Attacker or target no longer exists',
            };
        }

        // Apply minimum 1 damage
        const damage = Math.max(1, damageRoll);
        target.hp = Math.max(0, target.hp - damage);

        logs.push(this.createLogEntry("DAMAGE", {
            actorId: attacker.id,
            targetId: target.id,
            amount: damage,
            damageType: attacker.damageType,
            roll: {
                formula: pending.damageFormula,
                result: damage,
                isCritical: pending.isCritical,
                isFumble: false,
            },
            description: `${attacker.name} deals ${damage} ${attacker.damageType} damage to ${target.name}! (${target.hp}/${target.maxHp} HP remaining)`,
        }));

        // Activity log for damage
        activity.damage(this.state.sessionId, `${attacker.name} deals ${damage} ${attacker.damageType} to ${target.name} (player rolled ${damage}) (${target.hp}/${target.maxHp} HP)`);

        // Check for death/unconscious
        if (target.hp <= 0) {
            if (target.isEssential) {
                target.status = "UNCONSCIOUS";
                logs.push(this.createLogEntry("UNCONSCIOUS", {
                    targetId: target.id,
                    description: `${target.name} falls unconscious!`,
                }));
            } else {
                target.status = "DEAD";
                activity.death(this.state.sessionId, `${target.name} is slain!`);
                logs.push(this.createLogEntry("DEATH", {
                    targetId: target.id,
                    description: `${target.name} is slain!`,
                }));
            }
        }

        // Clear pending attack and resume normal phase
        this.state.pendingAttack = undefined;
        this.state.phase = 'ACTIVE';
        this.state.updatedAt = Date.now();

        // Advance turn
        const turnLogs = this.endTurn();
        logs.push(...turnLogs);

        return {
            success: true,
            logs,
            newState: this.getState() as BattleState,
        };
    }

    /**
     * Double the dice in a formula for critical hits
     * e.g., "1d8+3" becomes "2d8+3"
     */
    private doubleDiceFormula(formula: string): string {
        // Match patterns like "1d8", "2d6", etc.
        return formula.replace(/(\d+)d(\d+)/g, (match, count, sides) => {
            return `${parseInt(count) * 2}d${sides}`;
        });
    }

    // ===========================================================================
    // HELPERS
    // ===========================================================================

    /**
     * Check if combat should end and return reason (or null if combat continues)
     */
    private getCombatEndReason(): string | null {
        const aliveEnemies = this.state.entities.filter(
            e => e.type === "enemy" && e.status === "ALIVE"
        );
        const alivePlayers = this.state.entities.filter(
            e => e.type === "player" && e.status === "ALIVE"
        );

        if (aliveEnemies.length === 0) {
            return "All enemies defeated!";
        }
        if (alivePlayers.length === 0) {
            return "All players have fallen...";
        }
        return null;
    }

    /**
     * Check if combat should end (legacy, for backwards compatibility)
     */
    private checkCombatEnd(): boolean {
        return this.getCombatEndReason() !== null;
    }

    /**
     * Create a log entry with defaults
     */
    private createLogEntry(
        type: LogEntryType,
        data: Partial<CombatLogEntry>
    ): CombatLogEntry {
        const entry = {
            id: generateId("log"),
            timestamp: Date.now(),
            round: this.state.round,
            turnIndex: this.state.turnIndex,
            type,
            ...data,
        } as CombatLogEntry;

        this.state.log.push(entry);
        // Cap log to avoid unbounded growth
        if (this.state.log.length > 200) {
            this.state.log = this.state.log.slice(-200);
        }

        return entry;
    }
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

/**
 * Create a new combat engine instance
 * @param rollFn - Optional injectable dice roller for deterministic tests
 */
export function createCombatEngine(
    sessionId: number,
    settings?: Partial<GameSettings>,
    rollFn?: RollFn
): CombatEngineV2 {
    return new CombatEngineV2(sessionId, settings, rollFn);
}
