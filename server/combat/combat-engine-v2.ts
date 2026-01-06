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
} from "./combat-types";

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
                if (result.die === "d20") {
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

export class CombatEngineV2 {
    private state: BattleState;
    private maxHistorySize: number = 20;  // Keep last 20 states for undo

    constructor(sessionId: number, settings?: Partial<GameSettings>) {
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
        return { ...this.state };
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
     * Add entities and start combat
     * 
     * This is called when combat begins. It:
     * 1. Adds all combatants to the battle
     * 2. Rolls initiative for each
     * 3. Sorts turn order with tie-breakers
     * 4. Starts round 1
     */
    initiateCombat(entities: CombatEntity[]): CombatLogEntry[] {
        this.pushHistory();
        const logs: CombatLogEntry[] = [];

        // Add all entities
        this.state.entities = [...entities];

        // Roll initiative for each entity
        for (const entity of this.state.entities) {
            if (entity.initiative === 0) {
                const roll = rollDice("1d20");
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

        // Start round 1
        this.state.round = 1;
        this.state.turnIndex = 0;
        this.state.phase = "ACTIVE";
        this.state.updatedAt = Date.now();

        logs.push(this.createLogEntry("COMBAT_START", {
            description: `Combat begins! Round 1 starts.`,
        }));

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

        // Skip dead/fled entities
        let attempts = 0;
        while (attempts < this.state.turnOrder.length) {
            const nextEntityId = this.state.turnOrder[this.state.turnIndex];
            const nextEntity = this.getEntity(nextEntityId);

            if (nextEntity && nextEntity.status === "ALIVE") {
                break;
            }

            this.state.turnIndex = (this.state.turnIndex + 1) % this.state.turnOrder.length;
            attempts++;
        }

        // Check if combat should end (all enemies or all players dead)
        if (this.checkCombatEnd()) {
            return [...logs, ...this.endCombat("All enemies defeated!")];
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
            case "ATTACK":
                return this.processAttack(payload as AttackPayload);

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

        // Roll attack
        const attackRoll = rollDice(diceFormula);
        const totalAttack = attackRoll.total + attacker.attackModifier;
        const isCritical = attackRoll.isCritical;
        const isFumble = attackRoll.isFumble;

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

        // If hit, roll and apply damage
        if (isHit) {
            // Double dice on crit (not modifier)
            const damageFormula = isCritical
                ? this.doubleDiceFormula(attacker.damageFormula)
                : attacker.damageFormula;

            const damageRoll = rollDice(damageFormula);
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
                    logs.push(this.createLogEntry("DEATH", {
                        targetId: target.id,
                        description: `${target.name} is slain!`,
                    }));
                }
            }
        }

        this.state.updatedAt = Date.now();

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
     * Check if combat should end
     */
    private checkCombatEnd(): boolean {
        const aliveEnemies = this.state.entities.filter(
            e => e.type === "enemy" && e.status === "ALIVE"
        );
        const alivePlayers = this.state.entities.filter(
            e => e.type === "player" && e.status === "ALIVE"
        );

        return aliveEnemies.length === 0 || alivePlayers.length === 0;
    }

    /**
     * Create a log entry with defaults
     */
    private createLogEntry(
        type: typeof LogEntryTypeSchema._type,
        data: Partial<CombatLogEntry>
    ): CombatLogEntry {
        return {
            id: generateId("log"),
            timestamp: Date.now(),
            round: this.state.round,
            turnIndex: this.state.turnIndex,
            type,
            ...data,
        } as CombatLogEntry;
    }
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

/**
 * Create a new combat engine instance
 */
export function createCombatEngine(
    sessionId: number,
    settings?: Partial<GameSettings>
): CombatEngineV2 {
    return new CombatEngineV2(sessionId, settings);
}
