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
    type LegalAction,
    type RollRequest,
    type GameSettings,
    type AttackPayload,
    type TurnResources,
    type ResourceCost,
    type DodgePayload,
    type DashPayload,
    type DisengagePayload,
    type HealPayload,
    type HelpPayload,
    type HidePayload,
    type ReadyPayload,
    type UseItemPayload,
    type ActiveCondition,
    type CastSpellPayload,
    type Spell,
    type PendingSpellSave,
    ACTION_DEFAULT_COST,
    TurnResourcesSchema,
    BattleStateSchema,
    GameSettingsSchema,
    LogEntryTypeSchema,
    type LogEntryType,
    SpellSchema,
    PendingSpellSaveSchema,
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
            for (const die of result.rolls as Array<{ value: number; useInTotal?: boolean }>) {
                rolls.push(die.value);
                // Only count crits/fumbles on kept dice (useInTotal is false for kh/kl dropped dice)
                const isKept = die.useInTotal !== false;
                if (isKept && (result as any).sides === 20) {
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

        // Initialize turn resources for the first entity
        const firstEntity = this.getEntity(this.state.turnOrder[0]);
        if (firstEntity) {
            this.initTurnResources(firstEntity);
        }

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

        // Initialize turn resources for the first entity
        const firstEntity = this.getEntity(this.state.turnOrder[0]);
        if (firstEntity) {
            this.initTurnResources(firstEntity);
        }

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
        if (this.state.phase !== "ACTIVE" && this.state.phase !== "AWAIT_DEATH_SAVE") return null;
        const entityId = this.state.turnOrder[this.state.turnIndex];
        return this.getEntity(entityId) || null;
    }

    /**
     * Get legal actions for an entity.
     * Returns an empty array if it's not this entity's turn or combat isn't active.
     */
    getLegalActions(entityId: string): LegalAction[] {
        if (this.state.phase !== "ACTIVE") return [];

        const currentTurnEntityId = this.state.turnOrder[this.state.turnIndex];
        if (currentTurnEntityId !== entityId) return [];

        const entity = this.getEntity(entityId);
        if (!entity || entity.status !== "ALIVE") return [];

        const r = this.state.turnResources;
        const hasAction = r ? !r.actionUsed || r.extraAttacksRemaining > 0 : true;
        const hasFullAction = r ? !r.actionUsed : true; // Not consumed by extra attacks
        // const hasBonusAction = r ? !r.bonusActionUsed : true; // Future: bonus action abilities

        const actions: LegalAction[] = [];

        // Valid targets (alive enemies from this entity's perspective)
        const validTargets = this.state.entities.filter(e =>
            e.id !== entityId &&
            e.status === "ALIVE" &&
            ((entity.type === "player" && (e.type === "enemy")) ||
             (entity.type === "enemy" && (e.type === "player" || e.type === "ally")) ||
             (entity.type === "ally" && (e.type === "enemy")))
        );

        // Allies (for Help action targeting)
        const allies = this.state.entities.filter(e =>
            e.id !== entityId &&
            e.status === "ALIVE" &&
            ((entity.type === "player" && (e.type === "player" || e.type === "ally")) ||
             (entity.type === "enemy" && e.type === "enemy") ||
             (entity.type === "ally" && (e.type === "player" || e.type === "ally")))
        );

        // --- Actions requiring the Action resource ---

        if (hasAction) {
            // ATTACK — one per valid target
            for (const target of validTargets) {
                actions.push({
                    type: "ATTACK",
                    targetId: target.id,
                    targetName: target.name,
                    weaponName: entity.damageFormula,
                    description: `Attack ${target.name}`,
                    resourceCost: "action",
                });
            }
        }

        if (hasFullAction) {
            // DODGE
            actions.push({
                type: "DODGE",
                description: "Dodge — attacks against you have disadvantage until next turn",
                resourceCost: "action",
            });

            // DASH
            actions.push({
                type: "DASH",
                description: "Dash — double your movement this turn",
                resourceCost: "action",
            });

            // DISENGAGE
            actions.push({
                type: "DISENGAGE",
                description: "Disengage — move without provoking opportunity attacks",
                resourceCost: "action",
            });

            // HELP — one per ally (only if there are allies AND enemies)
            if (validTargets.length > 0) {
                for (const ally of allies) {
                    actions.push({
                        type: "HELP",
                        targetId: ally.id,
                        targetName: ally.name,
                        description: `Help ${ally.name} — give them advantage on their next attack`,
                        resourceCost: "action",
                    });
                }
            }

            // HIDE
            actions.push({
                type: "HIDE",
                description: "Hide — make a Stealth check to become hidden",
                resourceCost: "action",
            });

            // READY (simplified — trigger details come from player input)
            actions.push({
                type: "READY",
                description: "Ready — prepare an action with a trigger condition",
                resourceCost: "action",
            });

            // USE_ITEM (always available as an option, specific items come from player input)
            actions.push({
                type: "USE_ITEM",
                description: "Use an item — drink a potion, activate a magic item, etc.",
                resourceCost: "action",
            });
        }

        if (hasFullAction || (this.state.turnResources ? !this.state.turnResources.bonusActionUsed : true)) {
            // CAST_SPELL — one per castable spell (has slot, action available)
            for (const spell of entity.spells) {
                const slotLevel = spell.level;
                const hasBonusAction = this.state.turnResources ? !this.state.turnResources.bonusActionUsed : true;
                const hasRequiredResource = spell.castingTime === 'bonus_action' ? hasBonusAction : hasFullAction;
                if (!hasRequiredResource) continue;

                // Check slot availability (cantrips always available)
                if (slotLevel > 0) {
                    const slotsAvailable = entity.spellSlots[String(slotLevel)] ?? 0;
                    if (slotsAvailable <= 0) continue;
                }

                if (spell.isAreaEffect) {
                    // Area spells — all valid targets at once
                    actions.push({
                        type: "CAST_SPELL",
                        spellName: spell.name,
                        description: `Cast ${spell.name} (area, ${spell.castingTime})`,
                        resourceCost: spell.castingTime === 'bonus_action' ? 'bonus_action' : 'action',
                    });
                } else if (spell.healingFormula) {
                    // Healing spells — can target self or allies
                    const healTargets = [entity, ...this.state.entities.filter(e =>
                        e.id !== entity.id &&
                        (e.type === 'player' || e.type === 'ally') &&
                        (e.status === 'ALIVE' || e.status === 'UNCONSCIOUS')
                    )];
                    for (const t of healTargets) {
                        actions.push({
                            type: "CAST_SPELL",
                            spellName: spell.name,
                            targetId: t.id,
                            targetName: t.name,
                            description: `Cast ${spell.name} on ${t.name}`,
                            resourceCost: spell.castingTime === 'bonus_action' ? 'bonus_action' : 'action',
                        });
                    }
                } else {
                    // Damage/effect spells — target enemies
                    for (const target of validTargets) {
                        actions.push({
                            type: "CAST_SPELL",
                            spellName: spell.name,
                            targetId: target.id,
                            targetName: target.name,
                            description: `Cast ${spell.name} at ${target.name}`,
                            resourceCost: spell.castingTime === 'bonus_action' ? 'bonus_action' : 'action',
                        });
                    }
                }
            }
        }

        // Always include END_TURN
        actions.push({
            type: "END_TURN",
            description: "End your turn",
            resourceCost: "none",
        });

        return actions;
    }

    /**
     * Start a specific entity's turn (for lifecycle hooks)
     */
    startTurn(entityId: string): CombatLogEntry[] {
        const entity = this.getEntity(entityId);
        if (!entity) return [];

        const logs: CombatLogEntry[] = [];

        // Initialize turn resources (D&D 5e action economy)
        this.initTurnResources(entity);

        // Tick durations on active D&D conditions (Stage 5)
        logs.push(...this.tickConditions(entityId));

        // Clear turn-scoped internal flags from this entity's previous turn
        entity.conditions = entity.conditions.filter(c =>
            c !== "dodging" && c !== "disengaging" && c !== "hidden"
        );
        // Clear readied action conditions (they expire if not triggered)
        entity.conditions = entity.conditions.filter(c => !c.startsWith("readied:"));
        // Clear "helped_by" conditions on any entity that was helped by someone whose turn ended
        // (Help advantage lasts until the start of the helper's next turn)
        for (const e of this.state.entities) {
            e.conditions = e.conditions.filter(c => !c.startsWith(`helped_by:${entityId}`));
        }

        logs.push(this.createLogEntry("TURN_START", {
            actorId: entityId,
            description: `${entity.name}'s turn begins.`,
        }));

        // Death saving throws: unconscious essential entities must roll at the start of their turn
        if (entity.status === 'UNCONSCIOUS' && entity.isEssential) {
            this.state.phase = 'AWAIT_DEATH_SAVE';
            this.state.updatedAt = Date.now();
            logs.push(this.createLogEntry("CUSTOM", {
                actorId: entityId,
                description: `${entity.name} must make a death saving throw!`,
            }));
            activity.system(this.state.sessionId, `${entity.name} must make a death save`);
        }

        return logs;
    }

    /**
     * Initialize turn resources for an entity at the start of their turn.
     * In D&D 5e each turn grants: 1 Action, 1 Bonus Action, Movement, and
     * the Reaction refreshes at the start of your turn.
     */
    private initTurnResources(entity: CombatEntity): void {
        this.state.turnResources = TurnResourcesSchema.parse({
            actionUsed: false,
            bonusActionUsed: false,
            movementUsed: false,
            reactionUsed: false,
            // Extra Attack: set from entity's extraAttacks field (Fighter 5+, multiattack enemies, etc.)
            extraAttacksRemaining: entity.extraAttacks ?? 0,
        });
    }

    /**
     * Consume a turn resource. Returns true if the resource was available.
     */
    private consumeResource(cost: ResourceCost): boolean {
        if (!this.state.turnResources) return false;
        const r = this.state.turnResources;

        switch (cost) {
            case "action":
                if (r.actionUsed) return false;
                r.actionUsed = true;
                return true;
            case "bonus_action":
                if (r.bonusActionUsed) return false;
                r.bonusActionUsed = true;
                return true;
            case "reaction":
                if (r.reactionUsed) return false;
                r.reactionUsed = true;
                return true;
            case "movement":
                if (r.movementUsed) return false;
                r.movementUsed = true;
                return true;
            case "free":
            case "none":
                return true;
        }
    }

    /**
     * Check if turn should auto-end because all resources are exhausted.
     * For enemies: always auto-end after their action (no multi-action UI).
     * For players: auto-end only when action + bonus action are both used
     * and no extra attacks remain.
     */
    private autoEndTurnIfExhausted(entity: CombatEntity): CombatLogEntry[] {
        // Enemies auto-end after their action, UNLESS they still have attacks remaining.
        // An enemy with extraAttacks uses extra slots first (keeping actionUsed = false),
        // then the main action. Only end the turn when both are exhausted.
        if (entity.type === "enemy") {
            const r = this.state.turnResources;
            if (r && (r.extraAttacksRemaining > 0 || !r.actionUsed)) return [];
            return this.endTurn();
        }

        const r = this.state.turnResources;
        if (!r) return this.endTurn();

        // Player still has resources — don't auto-end
        // Check all resource types: action, bonus action, extra attacks
        if (!r.actionUsed || r.extraAttacksRemaining > 0) return [];
        if (!r.bonusActionUsed) return [];

        // All resources spent — auto-end
        return this.endTurn();
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

            // An entity gets a turn if ALIVE, or if UNCONSCIOUS + essential (needs death saves)
            const needsTurn = nextEntity && (
                nextEntity.status === "ALIVE" ||
                (nextEntity.status === "UNCONSCIOUS" && nextEntity.isEssential)
            );
            if (needsTurn) break;

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

            case "DODGE":
                return this.processDodge(payload as DodgePayload);

            case "DASH":
                return this.processDash(payload as DashPayload);

            case "DISENGAGE":
                return this.processDisengage(payload as DisengagePayload);

            case "HEAL":
                return this.processHeal(payload as HealPayload);

            case "HELP":
                return this.processHelp(payload as HelpPayload);

            case "HIDE":
                return this.processHide(payload as HidePayload);

            case "READY":
                return this.processReady(payload as ReadyPayload);

            case "USE_ITEM":
                return this.processUseItem(payload as UseItemPayload);

            case "CAST_SPELL":
                return this.processCastSpell(payload as CastSpellPayload);

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
                    error: `Action not yet implemented: ${(payload as any).type}`,
                };
        }
    }

    // ===========================================================================
    // ACTION HANDLERS — D&D 5e standard actions
    // ===========================================================================

    /**
     * Dodge — Until your next turn, attacks against you have disadvantage
     * and you make DEX saves with advantage. Requires you can see the attacker.
     * Consumes: Action (or Bonus Action via Rogue Cunning Action, Monk, etc.)
     */
    private processDodge(payload: DodgePayload): ActionResult {
        const entity = this.getEntity(payload.entityId);
        if (!entity) return this.actionError(`Entity not found: ${payload.entityId}`);

        const cost = payload.resourceCost ?? ACTION_DEFAULT_COST.DODGE;
        if (!this.consumeResource(cost)) {
            return this.actionError(`No ${cost} available for Dodge`);
        }

        // Mark entity as dodging (will be checked by processAttack in Stage 5 conditions)
        if (!entity.conditions.includes("dodging")) {
            entity.conditions.push("dodging");
        }

        const logs: CombatLogEntry[] = [];
        logs.push(this.createLogEntry("ACTION", {
            actorId: entity.id,
            description: `${entity.name} takes the Dodge action. Attacks against them have disadvantage until their next turn.`,
        }));

        activity.system(this.state.sessionId, `${entity.name} takes the Dodge action`);
        this.state.updatedAt = Date.now();

        const turnLogs = this.autoEndTurnIfExhausted(entity);
        logs.push(...turnLogs);

        return { success: true, logs, newState: this.getState() as BattleState };
    }

    /**
     * Dash — Gain extra movement equal to your speed for this turn.
     * Theater-of-mind: allows an additional range band shift this turn.
     * Consumes: Action (or Bonus Action via Rogue Cunning Action, Monk Step of the Wind)
     */
    private processDash(payload: DashPayload): ActionResult {
        const entity = this.getEntity(payload.entityId);
        if (!entity) return this.actionError(`Entity not found: ${payload.entityId}`);

        const cost = payload.resourceCost ?? ACTION_DEFAULT_COST.DASH;
        if (!this.consumeResource(cost)) {
            return this.actionError(`No ${cost} available for Dash`);
        }

        // In theater-of-mind, "Dash" means the entity can move an extra range band.
        // The movement system (range bands) will check this flag.
        // For now we just log it — range band movement is a future enhancement.
        const logs: CombatLogEntry[] = [];
        logs.push(this.createLogEntry("ACTION", {
            actorId: entity.id,
            description: `${entity.name} takes the Dash action, doubling their movement this turn.`,
        }));

        activity.system(this.state.sessionId, `${entity.name} takes the Dash action`);
        this.state.updatedAt = Date.now();

        const turnLogs = this.autoEndTurnIfExhausted(entity);
        logs.push(...turnLogs);

        return { success: true, logs, newState: this.getState() as BattleState };
    }

    /**
     * Disengage — Your movement doesn't provoke opportunity attacks for the rest of the turn.
     * Consumes: Action (or Bonus Action via Rogue Cunning Action, Monk Step of the Wind)
     */
    private processDisengage(payload: DisengagePayload): ActionResult {
        const entity = this.getEntity(payload.entityId);
        if (!entity) return this.actionError(`Entity not found: ${payload.entityId}`);

        const cost = payload.resourceCost ?? ACTION_DEFAULT_COST.DISENGAGE;
        if (!this.consumeResource(cost)) {
            return this.actionError(`No ${cost} available for Disengage`);
        }

        if (!entity.conditions.includes("disengaging")) {
            entity.conditions.push("disengaging");
        }

        const logs: CombatLogEntry[] = [];
        logs.push(this.createLogEntry("ACTION", {
            actorId: entity.id,
            description: `${entity.name} takes the Disengage action. Their movement won't provoke opportunity attacks this turn.`,
        }));

        activity.system(this.state.sessionId, `${entity.name} takes the Disengage action`);
        this.state.updatedAt = Date.now();

        const turnLogs = this.autoEndTurnIfExhausted(entity);
        logs.push(...turnLogs);

        return { success: true, logs, newState: this.getState() as BattleState };
    }

    /**
     * Help — Give one ally advantage on their next attack roll against a target,
     * or advantage on their next ability check.
     * Consumes: Action
     */
    private processHelp(payload: HelpPayload): ActionResult {
        const entity = this.getEntity(payload.entityId);
        if (!entity) return this.actionError(`Entity not found: ${payload.entityId}`);

        const ally = this.getEntity(payload.allyId);
        if (!ally) return this.actionError(`Ally not found: ${payload.allyId}`);

        const cost = payload.resourceCost ?? ACTION_DEFAULT_COST.HELP;
        if (!this.consumeResource(cost)) {
            return this.actionError(`No ${cost} available for Help`);
        }

        // Mark the ally as having "helped" advantage for their next attack.
        // The condition includes the target restriction if provided.
        // Format: "helped_by:<helperId>[:against:<targetId>]"
        const helpCondition = payload.targetId
            ? `helped_by:${entity.id}:against:${payload.targetId}`
            : `helped_by:${entity.id}`;
        if (!ally.conditions.includes(helpCondition)) {
            ally.conditions.push(helpCondition);
        }

        const targetEntity = payload.targetId ? this.getEntity(payload.targetId) : null;
        const targetDesc = targetEntity ? ` against ${targetEntity.name}` : '';

        const logs: CombatLogEntry[] = [];
        logs.push(this.createLogEntry("ACTION", {
            actorId: entity.id,
            targetId: payload.allyId,
            description: `${entity.name} takes the Help action, giving ${ally.name} advantage on their next attack${targetDesc}.`,
        }));

        activity.system(this.state.sessionId, `${entity.name} helps ${ally.name}${targetDesc}`);
        this.state.updatedAt = Date.now();

        const turnLogs = this.autoEndTurnIfExhausted(entity);
        logs.push(...turnLogs);

        return { success: true, logs, newState: this.getState() as BattleState };
    }

    /**
     * Hide — Make a Stealth check to become hidden.
     * Consumes: Action (or Bonus Action via Rogue Cunning Action)
     */
    private processHide(payload: HidePayload): ActionResult {
        const entity = this.getEntity(payload.entityId);
        if (!entity) return this.actionError(`Entity not found: ${payload.entityId}`);

        const cost = payload.resourceCost ?? ACTION_DEFAULT_COST.HIDE;
        if (!this.consumeResource(cost)) {
            return this.actionError(`No ${cost} available for Hide`);
        }

        // In a full implementation, this would require a Stealth check vs enemies' passive Perception.
        // For now, mark hidden and let the narrative describe it.
        if (!entity.conditions.includes("hidden")) {
            entity.conditions.push("hidden");
        }

        const logs: CombatLogEntry[] = [];
        logs.push(this.createLogEntry("ACTION", {
            actorId: entity.id,
            description: `${entity.name} takes the Hide action, attempting to conceal themselves.`,
        }));

        activity.system(this.state.sessionId, `${entity.name} takes the Hide action`);
        this.state.updatedAt = Date.now();

        const turnLogs = this.autoEndTurnIfExhausted(entity);
        logs.push(...turnLogs);

        return { success: true, logs, newState: this.getState() as BattleState };
    }

    /**
     * Ready — Prepare an action with a trigger. Uses your action now;
     * the readied action fires as a reaction when the trigger occurs.
     * Consumes: Action (and will consume Reaction when triggered)
     */
    private processReady(payload: ReadyPayload): ActionResult {
        const entity = this.getEntity(payload.entityId);
        if (!entity) return this.actionError(`Entity not found: ${payload.entityId}`);

        const cost = payload.resourceCost ?? ACTION_DEFAULT_COST.READY;
        if (!this.consumeResource(cost)) {
            return this.actionError(`No ${cost} available for Ready`);
        }

        // Store the readied action as a condition string for the trigger system.
        // Format: "readied:<action>:<trigger>[:target:<targetId>]"
        const readyCondition = payload.targetId
            ? `readied:${payload.readiedAction}:${payload.trigger}:target:${payload.targetId}`
            : `readied:${payload.readiedAction}:${payload.trigger}`;
        entity.conditions = entity.conditions.filter(c => !c.startsWith("readied:"));
        entity.conditions.push(readyCondition);

        const logs: CombatLogEntry[] = [];
        logs.push(this.createLogEntry("ACTION", {
            actorId: entity.id,
            description: `${entity.name} readies a ${payload.readiedAction} action: "${payload.trigger}"`,
        }));

        activity.system(this.state.sessionId, `${entity.name} readies ${payload.readiedAction}: "${payload.trigger}"`);
        this.state.updatedAt = Date.now();

        const turnLogs = this.autoEndTurnIfExhausted(entity);
        logs.push(...turnLogs);

        return { success: true, logs, newState: this.getState() as BattleState };
    }

    /**
     * Use Item — Drink a potion, activate a magic item, etc.
     * Consumes: Action
     */
    private processUseItem(payload: UseItemPayload): ActionResult {
        const entity = this.getEntity(payload.entityId);
        if (!entity) return this.actionError(`Entity not found: ${payload.entityId}`);

        const cost = payload.resourceCost ?? ACTION_DEFAULT_COST.USE_ITEM;
        if (!this.consumeResource(cost)) {
            return this.actionError(`No ${cost} available for Use Item`);
        }

        // Item effects are not modeled yet — just log the action for the narrator.
        // Future: look up item from inventory and apply its effect.
        const target = payload.targetId ? this.getEntity(payload.targetId) : null;
        const targetDesc = target ? ` on ${target.name}` : '';

        const logs: CombatLogEntry[] = [];
        logs.push(this.createLogEntry("ACTION", {
            actorId: entity.id,
            targetId: payload.targetId,
            description: `${entity.name} uses ${payload.itemName}${targetDesc}.`,
        }));

        activity.system(this.state.sessionId, `${entity.name} uses ${payload.itemName}${targetDesc}`);
        this.state.updatedAt = Date.now();

        const turnLogs = this.autoEndTurnIfExhausted(entity);
        logs.push(...turnLogs);

        return { success: true, logs, newState: this.getState() as BattleState };
    }

    /**
     * Helper: return a standard error ActionResult
     */
    private actionError(error: string): ActionResult {
        return {
            success: false,
            logs: [],
            newState: this.getState() as BattleState,
            error,
        };
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

        // Engine-level dodge check: if target has 'dodging' internal flag, force disadvantage
        const targetIsDodging = target.conditions?.some?.(
            (c: any) => (typeof c === 'string' ? c === 'dodging' : c.name === 'dodging')
        ) ?? false;
        // Active condition disadvantage (Stage 5)
        const attackerCondDisadv = this.hasActiveCondition(attacker.id, 'blinded')
            || this.hasActiveCondition(attacker.id, 'poisoned')
            || this.hasActiveCondition(attacker.id, 'frightened')
            || (this.hasActiveCondition(attacker.id, 'prone') && payload.isRanged);
        const targetCondAdv = this.hasActiveCondition(target.id, 'stunned')
            || this.hasActiveCondition(target.id, 'paralyzed')
            || (!payload.isRanged && this.hasActiveCondition(target.id, 'prone'));
        const effectiveDisadvantage = (payload.disadvantage || false) || targetIsDodging || attackerCondDisadv;
        const effectiveAdvantage = (payload.advantage || false) || this.hasActiveCondition(attacker.id, 'invisible') || targetCondAdv;

        this.state.phase = 'AWAIT_ATTACK_ROLL';
        this.state.pendingAttackRoll = {
            attackerId: attacker.id,
            targetId: target.id,
            attackModifier: attacker.attackModifier,
            advantage: effectiveAdvantage,
            disadvantage: effectiveDisadvantage,
            weaponName: payload.weaponName,
            createdAt: Date.now(),
        };
        this.state.updatedAt = Date.now();

        const diceFormula = (effectiveAdvantage && !effectiveDisadvantage) ? "2d20kh1"
            : (effectiveDisadvantage && !effectiveAdvantage) ? "2d20kl1"
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

        // Engine-level dodge check: if target has 'dodging' internal flag, force disadvantage
        const targetDodging = target.conditions?.some?.(
            (c: any) => (typeof c === 'string' ? c === 'dodging' : c.name === 'dodging')
        ) ?? false;

        // Active condition effects on attacker (Stage 5)
        const attackerBlinded = this.hasActiveCondition(attacker.id, 'blinded');
        const attackerPoisoned = this.hasActiveCondition(attacker.id, 'poisoned');
        const attackerFrightened = this.hasActiveCondition(attacker.id, 'frightened');
        const attackerInvisible = this.hasActiveCondition(attacker.id, 'invisible');
        // Prone attacker: ranged attacks have disadvantage, melee attacks unaffected as attacker
        const attackerProne = this.hasActiveCondition(attacker.id, 'prone') && payload.isRanged;

        // Active condition effects on target (Stage 5)
        // Prone target: melee attacks have advantage, ranged attacks have disadvantage
        const targetProne = this.hasActiveCondition(target.id, 'prone');
        const targetProneAdv = targetProne && !payload.isRanged;
        const targetProneDisadv = targetProne && payload.isRanged;
        // Stunned/paralyzed: attacks against them have advantage; auto-crit if within 5ft (melee)
        const targetStunned = this.hasActiveCondition(target.id, 'stunned');
        const targetParalyzed = this.hasActiveCondition(target.id, 'paralyzed');
        const targetIncapacitated = targetStunned || targetParalyzed;

        const hasDisadvantage = (payload.disadvantage || false) || targetDodging
            || attackerBlinded || attackerPoisoned || attackerFrightened || attackerProne
            || targetProneDisadv;
        const hasAdvantage = (payload.advantage || false) || attackerInvisible
            || targetProneAdv || targetIncapacitated;

        // Auto-crit: attacks against stunned/paralyzed within 5ft (melee) always crit
        const forceAutoCrit = targetIncapacitated && !payload.isRanged;

        // Determine dice formula (advantage/disadvantage)
        let diceFormula = "1d20";
        if (hasAdvantage && !hasDisadvantage) {
            diceFormula = "2d20kh1";  // Roll 2, keep highest
        } else if (hasDisadvantage && !hasAdvantage) {
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

        // Auto-crit overrides normal roll (stunned/paralyzed target in melee)
        if (forceAutoCrit) {
            isCritical = true;
            isFumble = false;
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

        // Consume the action resource (or extra attack slot)
        if (this.state.turnResources) {
            if (this.state.turnResources.extraAttacksRemaining > 0) {
                this.state.turnResources.extraAttacksRemaining--;
            } else {
                this.consumeResource(payload.resourceCost ?? "action");
            }
        }

        // If miss, mark action used and check auto-end (no longer force-ends turn)
        if (!isHit) {
            this.state.updatedAt = Date.now();
            const turnLogs = this.autoEndTurnIfExhausted(attacker);
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
        const rawDamage = Math.max(1, damageRoll.total);  // Minimum 1 before modifiers

        // Apply damage modifiers: immunity > resistance > vulnerability (Stage 5)
        const dt = attacker.damageType;
        let damage: number;
        if (target.immunities.includes(dt)) {
            damage = 0;
        } else {
            damage = rawDamage;
            if (target.vulnerabilities.includes(dt)) damage *= 2;
            if (target.resistances.includes(dt)) damage = Math.floor(damage / 2);
        }

        // Auto-fail death save if target is already unconscious and takes damage (Stage 5)
        if (target.status === 'UNCONSCIOUS' && target.isEssential && damage > 0) {
            // Melee = 2 failures, ranged = 1 failure
            const deathFailures = payload.isRanged ? 1 : 2;
            target.deathSaves.failures += deathFailures;
            logs.push(this.createLogEntry("CUSTOM", {
                targetId: target.id,
                description: `${target.name} takes damage while unconscious — ${deathFailures} death save failure(s)! (${target.deathSaves.failures}/3)`,
            }));
            if (target.deathSaves.failures >= 3) {
                target.status = 'DEAD';
                activity.death(this.state.sessionId, `${target.name} dies from death save failures`);
                logs.push(this.createLogEntry("DEATH", {
                    targetId: target.id,
                    description: `${target.name} dies from accumulated death save failures.`,
                }));
            }
        }

        // Absorb damage through tempHp first (Stage 5)
        if (target.tempHp > 0) {
            const absorbed = Math.min(target.tempHp, damage);
            target.tempHp -= absorbed;
            damage -= absorbed;
        }

        // Apply remaining damage to HP
        target.hp = Math.max(0, target.hp - damage);

        if (damage > 0) {
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

            // Concentration check (Stage 6) — if target is concentrating, they must save
            logs.push(...this.checkConcentrationSave(target.id, damage));
        } else if (target.immunities.includes(dt)) {
            logs.push(this.createLogEntry("CUSTOM", {
                targetId: target.id,
                description: `${target.name} is immune to ${dt} damage!`,
            }));
        }

        // Check for death/unconscious (only for entities that weren't already unconscious)
        if (target.hp <= 0 && target.status === 'ALIVE') {
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

        // Check if turn should auto-end (enemies: always; players: only when exhausted)
        const turnLogs = this.autoEndTurnIfExhausted(attacker);
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

        // Apply damage modifiers: immunity > resistance > vulnerability (Stage 5)
        const rawDamage = Math.max(1, damageRoll);
        const dt = attacker.damageType;
        let damage: number;
        if (target.immunities.includes(dt)) {
            damage = 0;
        } else {
            damage = rawDamage;
            if (target.vulnerabilities.includes(dt)) damage *= 2;
            if (target.resistances.includes(dt)) damage = Math.floor(damage / 2);
        }

        // Auto-fail death save if target is already unconscious and takes damage (Stage 5)
        if (target.status === 'UNCONSCIOUS' && target.isEssential && damage > 0) {
            target.deathSaves.failures += 1; // player attacks assume ranged/5ft-ambiguous → 1 failure
            logs.push(this.createLogEntry("CUSTOM", {
                targetId: target.id,
                description: `${target.name} takes damage while unconscious — 1 death save failure! (${target.deathSaves.failures}/3)`,
            }));
            if (target.deathSaves.failures >= 3) {
                target.status = 'DEAD';
                activity.death(this.state.sessionId, `${target.name} dies from death save failures`);
                logs.push(this.createLogEntry("DEATH", {
                    targetId: target.id,
                    description: `${target.name} dies from accumulated death save failures.`,
                }));
            }
        }

        // Absorb damage through tempHp first (Stage 5)
        if (target.tempHp > 0) {
            const absorbed = Math.min(target.tempHp, damage);
            target.tempHp -= absorbed;
            damage -= absorbed;
        }

        target.hp = Math.max(0, target.hp - damage);

        if (damage > 0) {
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

            activity.damage(this.state.sessionId, `${attacker.name} deals ${damage} ${attacker.damageType} to ${target.name} (player rolled ${rawDamage}) (${target.hp}/${target.maxHp} HP)`);

            // Concentration check (Stage 6) — if target is concentrating, they must save
            logs.push(...this.checkConcentrationSave(target.id, damage));
        } else if (target.immunities.includes(dt)) {
            logs.push(this.createLogEntry("CUSTOM", {
                targetId: target.id,
                description: `${target.name} is immune to ${dt} damage!`,
            }));
        }

        // Check for death/unconscious (only for entities that weren't already unconscious)
        if (target.hp <= 0 && target.status === 'ALIVE') {
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

        // Check if turn should auto-end
        const turnLogs = this.autoEndTurnIfExhausted(attacker);
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
        // Combat ends when ALL players are DEAD or FLED — not merely unconscious.
        // UNCONSCIOUS players still roll death saves, so they keep a spot in combat.
        const activePlayers = this.state.entities.filter(
            e => e.type === "player" && e.status !== "DEAD" && e.status !== "FLED"
        );

        if (aliveEnemies.length === 0) {
            return "All enemies defeated!";
        }
        if (activePlayers.length === 0) {
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

    // ===========================================================================
    // CONDITION HELPERS (Stage 5)
    // ===========================================================================

    /** Returns true if the entity has the named active condition. */
    hasActiveCondition(entityId: string, name: ActiveCondition['name']): boolean {
        const entity = this.getEntity(entityId);
        return entity?.activeConditions?.some(c => c.name === name) ?? false;
    }

    /** Apply a D&D condition to an entity. No-op if already applied. */
    applyCondition(entityId: string, condition: Omit<ActiveCondition, 'appliedAtRound'>): CombatLogEntry {
        const entity = this.getEntity(entityId);
        if (!entity) return this.createLogEntry("CUSTOM", { description: `Entity ${entityId} not found` });

        if (!entity.activeConditions.some(c => c.name === condition.name)) {
            entity.activeConditions.push({ ...condition, appliedAtRound: this.state.round });
        }

        const entry = this.createLogEntry("CONDITION_APPLIED", {
            actorId: condition.sourceId,
            targetId: entityId,
            description: `${entity.name} gains the ${condition.name} condition.`,
        });
        activity.system(this.state.sessionId, `${entity.name} gains ${condition.name}`);
        return entry;
    }

    /** Remove a named condition from an entity. */
    removeCondition(entityId: string, name: ActiveCondition['name']): CombatLogEntry {
        const entity = this.getEntity(entityId);
        if (!entity) return this.createLogEntry("CUSTOM", { description: `Entity ${entityId} not found` });

        entity.activeConditions = entity.activeConditions.filter(c => c.name !== name);

        const entry = this.createLogEntry("CONDITION_REMOVED", {
            targetId: entityId,
            description: `${entity.name} is no longer ${name}.`,
        });
        activity.system(this.state.sessionId, `${entity.name} loses ${name}`);
        return entry;
    }

    /** Decrement duration on all conditions and remove expired ones. */
    private tickConditions(entityId: string): CombatLogEntry[] {
        const entity = this.getEntity(entityId);
        if (!entity || entity.activeConditions.length === 0) return [];

        const logs: CombatLogEntry[] = [];
        const remaining: ActiveCondition[] = [];

        for (const cond of entity.activeConditions) {
            if (cond.duration === undefined) {
                remaining.push(cond); // permanent — keep it
                continue;
            }
            const newDuration = cond.duration - 1;
            if (newDuration <= 0) {
                logs.push(this.createLogEntry("CONDITION_REMOVED", {
                    targetId: entityId,
                    description: `${entity.name} is no longer ${cond.name}.`,
                }));
            } else {
                remaining.push({ ...cond, duration: newDuration });
            }
        }

        entity.activeConditions = remaining;
        return logs;
    }

    // ===========================================================================
    // DEATH SAVING THROWS (Stage 5)
    // ===========================================================================

    /**
     * Resolve a death saving throw for an unconscious essential entity.
     * - Nat 20: regain 1 HP and become ALIVE, clear death saves
     * - >= 10: success (3 successes = stable, no more saves needed)
     * - < 10: failure (3 failures = DEAD)
     * - Nat 1: 2 failures
     *
     * @param entityId - The unconscious entity rolling
     * @param roll - The raw d20 value (1–20)
     */
    rollDeathSave(entityId: string, roll: number): ActionResult {
        if (this.state.phase !== 'AWAIT_DEATH_SAVE') {
            return this.actionError('Not in AWAIT_DEATH_SAVE phase');
        }

        const entity = this.getEntity(entityId);
        if (!entity) return this.actionError(`Entity not found: ${entityId}`);
        if (entity.status !== 'UNCONSCIOUS') return this.actionError(`${entity.name} is not unconscious`);

        this.pushHistory();
        const logs: CombatLogEntry[] = [];

        if (roll === 20) {
            // Nat 20: revive with 1 HP
            entity.hp = 1;
            entity.status = 'ALIVE';
            entity.deathSaves = { successes: 0, failures: 0 };
            logs.push(this.createLogEntry("CUSTOM", {
                actorId: entityId,
                description: `${entity.name} rolls a NATURAL 20 on their death save and regains consciousness with 1 HP!`,
            }));
            activity.system(this.state.sessionId, `${entity.name} nat 20 death save — revived!`);
        } else if (roll === 1) {
            // Nat 1: 2 failures
            entity.deathSaves.failures += 2;
            logs.push(this.createLogEntry("CUSTOM", {
                actorId: entityId,
                roll: { formula: '1d20', result: 1, isCritical: false, isFumble: true },
                description: `${entity.name} rolls a 1 on their death save — 2 failures! (${entity.deathSaves.failures}/3)`,
            }));
        } else if (roll >= 10) {
            // Success
            entity.deathSaves.successes += 1;
            if (entity.deathSaves.successes >= 3) {
                // Stable — no more death saves needed (stays unconscious but won't die)
                entity.deathSaves = { successes: 0, failures: 0 };
                logs.push(this.createLogEntry("CUSTOM", {
                    actorId: entityId,
                    description: `${entity.name} stabilizes! They remain unconscious but are no longer in danger.`,
                }));
                activity.system(this.state.sessionId, `${entity.name} stabilized`);
            } else {
                logs.push(this.createLogEntry("CUSTOM", {
                    actorId: entityId,
                    roll: { formula: '1d20', result: roll, isCritical: false, isFumble: false },
                    description: `${entity.name} succeeds on their death save. (${entity.deathSaves.successes}/3 successes)`,
                }));
            }
        } else {
            // Failure
            entity.deathSaves.failures += 1;
            if (entity.deathSaves.failures >= 3) {
                entity.status = 'DEAD';
                logs.push(this.createLogEntry("DEATH", {
                    targetId: entityId,
                    description: `${entity.name} fails their third death save and dies.`,
                }));
                activity.death(this.state.sessionId, `${entity.name} dies from death save failures`);
            } else {
                logs.push(this.createLogEntry("CUSTOM", {
                    actorId: entityId,
                    roll: { formula: '1d20', result: roll, isCritical: false, isFumble: false },
                    description: `${entity.name} fails their death save. (${entity.deathSaves.failures}/3 failures)`,
                }));
            }
        }

        // Resume to ACTIVE phase and end turn (death save uses the turn)
        this.state.phase = 'ACTIVE';
        this.state.updatedAt = Date.now();
        const turnLogs = this.endTurn();
        logs.push(...turnLogs);

        return { success: true, logs, newState: this.getState() as BattleState };
    }

    // ===========================================================================
    // HEALING (Stage 5)
    // ===========================================================================

    /**
     * Apply healing to a target. Restores HP up to maxHp.
     * Revives UNCONSCIOUS essential entities if HP > 0.
     */
    private processHeal(payload: HealPayload): ActionResult {
        const healer = this.getEntity(payload.entityId);
        if (!healer) return this.actionError(`Entity not found: ${payload.entityId}`);

        const target = this.getEntity(payload.targetId);
        if (!target) return this.actionError(`Target not found: ${payload.targetId}`);

        const cost = payload.resourceCost ?? ACTION_DEFAULT_COST.HEAL;
        if (!this.consumeResource(cost)) {
            return this.actionError(`No ${cost} available for Heal`);
        }

        const logs: CombatLogEntry[] = [];
        const oldHp = target.hp;
        target.hp = Math.min(target.maxHp, target.hp + payload.amount);
        const actual = target.hp - oldHp;

        logs.push(this.createLogEntry("HEALING", {
            actorId: healer.id,
            targetId: target.id,
            amount: actual,
            description: `${healer.name} heals ${target.name} for ${actual} HP. (${target.hp}/${target.maxHp})`,
        }));

        activity.system(this.state.sessionId, `${healer.name} heals ${target.name} for ${actual} HP`);

        // Revive unconscious essential entity
        if (target.status === 'UNCONSCIOUS' && target.hp > 0 && target.isEssential) {
            target.status = 'ALIVE';
            target.deathSaves = { successes: 0, failures: 0 };
            logs.push(this.createLogEntry("CUSTOM", {
                targetId: target.id,
                description: `${target.name} regains consciousness!`,
            }));
            activity.system(this.state.sessionId, `${target.name} revived by healing`);
        }

        this.state.updatedAt = Date.now();
        const turnLogs = this.autoEndTurnIfExhausted(healer);
        logs.push(...turnLogs);

        return { success: true, logs, newState: this.getState() as BattleState };
    }

    // ===========================================================================
    // SPELLCASTING (Stage 6)
    // ===========================================================================

    /**
     * Cast a spell — deduct slot, apply damage/healing/conditions to targets.
     * Enemy saving throws are auto-resolved. Player saving throws enter AWAIT_SAVE_ROLL.
     */
    private processCastSpell(payload: CastSpellPayload): ActionResult {
        const caster = this.getEntity(payload.casterId);
        if (!caster) return this.actionError(`Caster not found: ${payload.casterId}`);

        // Find the spell
        const spell = caster.spells.find(s => s.name.toLowerCase() === payload.spellName.toLowerCase());
        if (!spell) return this.actionError(`${caster.name} does not know spell: ${payload.spellName}`);

        // Determine slot level to use
        const slotLevel = payload.spellSlotLevel ?? spell.level;

        // Cantrips (level 0) don't use spell slots
        if (slotLevel > 0) {
            const slotsAvailable = caster.spellSlots[String(slotLevel)] ?? 0;
            if (slotsAvailable <= 0) {
                return this.actionError(`No level ${slotLevel} spell slots remaining`);
            }
            caster.spellSlots[String(slotLevel)] = slotsAvailable - 1;
        }

        // Consume action resource (spell's castingTime overrides default)
        const cost = payload.resourceCost ?? (spell.castingTime === 'bonus_action' ? 'bonus_action' : 'action');
        if (!this.consumeResource(cost)) {
            // Refund the slot we just consumed
            if (slotLevel > 0) caster.spellSlots[String(slotLevel)]++;
            return this.actionError(`No ${cost} available for casting ${spell.name}`);
        }

        const logs: CombatLogEntry[] = [];

        // Handle concentration: drop previous concentration, apply new
        if (spell.requiresConcentration) {
            if (this.hasActiveCondition(caster.id, 'concentrating')) {
                logs.push(this.removeCondition(caster.id, 'concentrating'));
            }
            logs.push(this.applyCondition(caster.id, {
                name: 'concentrating',
                sourceId: caster.id,
                duration: undefined, // concentration lasts until broken
            }));
        }

        logs.push(this.createLogEntry("SPELL_CAST", {
            actorId: caster.id,
            description: `${caster.name} casts ${spell.name}!`,
        }));
        activity.system(this.state.sessionId, `${caster.name} casts ${spell.name} (slot ${slotLevel})`);

        // Resolve targets (area spells can have multiple targets)
        const targetIds = payload.targetIds;

        // If spell has no effect (no damage, no healing, no conditions), just log and end
        if (!spell.damageFormula && !spell.healingFormula && spell.conditions.length === 0) {
            this.state.updatedAt = Date.now();
            const turnLogs = this.autoEndTurnIfExhausted(caster);
            logs.push(...turnLogs);
            return { success: true, logs, newState: this.getState() as BattleState };
        }

        // Healing spell: apply immediately (no saves)
        if (spell.healingFormula) {
            for (const targetId of targetIds) {
                const target = this.getEntity(targetId);
                if (!target) continue;
                const healRoll = this.rollFn(spell.healingFormula);
                const oldHp = target.hp;
                target.hp = Math.min(target.maxHp, target.hp + healRoll.total);
                const healed = target.hp - oldHp;
                if (target.status === 'UNCONSCIOUS' && target.hp > 0 && target.isEssential) {
                    target.status = 'ALIVE';
                    target.deathSaves = { successes: 0, failures: 0 };
                }
                logs.push(this.createLogEntry("HEALING", {
                    actorId: caster.id,
                    targetId,
                    amount: healed,
                    description: `${spell.name} restores ${healed} HP to ${target.name}. (${target.hp}/${target.maxHp})`,
                }));
            }
            this.state.updatedAt = Date.now();
            const turnLogs = this.autoEndTurnIfExhausted(caster);
            logs.push(...turnLogs);
            return { success: true, logs, newState: this.getState() as BattleState };
        }

        // Damage/condition spell — check if saving throw required
        if (!spell.savingThrow) {
            // No save: apply full damage and conditions to all targets
            for (const targetId of targetIds) {
                logs.push(...this.applySpellEffect(caster, spell, targetId, false));
            }
            this.state.updatedAt = Date.now();
            const turnLogs = this.autoEndTurnIfExhausted(caster);
            logs.push(...turnLogs);
            return { success: true, logs, newState: this.getState() as BattleState };
        }

        // Saving throw required
        // - Enemy targets: auto-resolve the save now
        // - Player targets: enter AWAIT_SAVE_ROLL phase (one at a time)

        const enemyTargets = targetIds.filter(id => {
            const e = this.getEntity(id);
            return e && e.type === 'enemy';
        });
        const playerTargets = targetIds.filter(id => {
            const e = this.getEntity(id);
            return e && e.type === 'player';
        });

        const saveDC = caster.spellSaveDC ?? 13;

        // Auto-resolve enemy saves
        for (const targetId of enemyTargets) {
            const target = this.getEntity(targetId);
            if (!target) continue;

            const saveMod = this.getAbilityMod(target, spell.savingThrow!);
            const saveRoll = this.rollFn("1d20");
            const total = saveRoll.total + saveMod;
            const saveSuccess = total >= saveDC;

            logs.push(this.createLogEntry("ACTION", {
                actorId: targetId,
                description: `${target.name} rolls a ${spell.savingThrow} saving throw: ${saveRoll.total}+${saveMod}=${total} vs DC ${saveDC} — ${saveSuccess ? 'SUCCESS' : 'FAILURE'}!`,
            }));

            logs.push(...this.applySpellEffect(caster, spell, targetId, saveSuccess));
        }

        // Player saves: enter AWAIT_SAVE_ROLL if there are player targets
        if (playerTargets.length > 0) {
            this.state.pendingSpellSave = PendingSpellSaveSchema.parse({
                casterId: caster.id,
                spellName: spell.name,
                spellSaveDC: saveDC,
                saveStat: spell.savingThrow!,
                halfOnSave: spell.halfOnSave,
                damageFormula: spell.damageFormula,
                damageType: spell.damageType,
                conditions: spell.conditions,
                pendingTargetIds: playerTargets,
            });
            this.state.phase = 'AWAIT_SAVE_ROLL';
            this.state.updatedAt = Date.now();

            const firstTarget = this.getEntity(playerTargets[0]);
            logs.push(this.createLogEntry("ACTION", {
                description: `${firstTarget?.name ?? 'Player'} must make a DC ${saveDC} ${spell.savingThrow} saving throw!`,
            }));

            return {
                success: true,
                logs,
                newState: this.getState() as BattleState,
                awaitingSaveRoll: true,
            };
        }

        this.state.updatedAt = Date.now();
        const turnLogs = this.autoEndTurnIfExhausted(caster);
        logs.push(...turnLogs);
        return { success: true, logs, newState: this.getState() as BattleState };
    }

    /**
     * Apply spell damage/conditions to a single target, respecting save result.
     * @param saveSuccess - true if target succeeded on saving throw (halves damage if spell.halfOnSave)
     */
    private applySpellEffect(caster: CombatEntity, spell: Spell, targetId: string, saveSuccess: boolean): CombatLogEntry[] {
        const logs: CombatLogEntry[] = [];
        const target = this.getEntity(targetId);
        if (!target || target.status === 'DEAD') return logs;

        // Apply damage
        if (spell.damageFormula) {
            const rawRoll = this.rollFn(spell.damageFormula);
            const dt = spell.damageType ?? 'force';
            let damage: number;

            if (target.immunities.includes(dt)) {
                damage = 0;
                logs.push(this.createLogEntry("CUSTOM", {
                    targetId,
                    description: `${target.name} is immune to ${dt} damage!`,
                }));
            } else {
                damage = rawRoll.total;
                if (saveSuccess && spell.halfOnSave) damage = Math.floor(damage / 2);
                if (target.vulnerabilities.includes(dt)) damage *= 2;
                if (target.resistances.includes(dt)) damage = Math.floor(damage / 2);

                // Absorb through tempHp
                if (target.tempHp > 0) {
                    const absorbed = Math.min(target.tempHp, damage);
                    target.tempHp -= absorbed;
                    damage -= absorbed;
                }

                target.hp = Math.max(0, target.hp - damage);

                if (damage > 0) {
                    logs.push(this.createLogEntry("DAMAGE", {
                        actorId: caster.id,
                        targetId,
                        amount: damage,
                        damageType: dt,
                        description: `${spell.name} deals ${damage} ${dt} damage to ${target.name}${saveSuccess ? ' (save halved)' : ''}! (${target.hp}/${target.maxHp} HP)`,
                    }));
                    activity.damage(this.state.sessionId, `${spell.name} deals ${damage} ${dt} to ${target.name} (${target.hp}/${target.maxHp} HP)`);

                    // Concentration check if target is concentrating
                    logs.push(...this.checkConcentrationSave(targetId, damage));
                }

                // Death/unconscious check
                if (target.hp <= 0 && target.status === 'ALIVE') {
                    if (target.isEssential) {
                        target.status = 'UNCONSCIOUS';
                        logs.push(this.createLogEntry("UNCONSCIOUS", {
                            targetId,
                            description: `${target.name} falls unconscious!`,
                        }));
                    } else {
                        target.status = 'DEAD';
                        activity.death(this.state.sessionId, `${target.name} is slain by ${spell.name}!`);
                        logs.push(this.createLogEntry("DEATH", {
                            targetId,
                            description: `${target.name} is slain by ${spell.name}!`,
                        }));
                    }
                }
            }
        }

        // Apply conditions
        for (const condName of spell.conditions) {
            // Only apply valid condition names (from ActiveConditionSchema)
            const validConditions = ['blinded','charmed','deafened','frightened','grappled','incapacitated','invisible','paralyzed','petrified','poisoned','prone','restrained','stunned','unconscious','concentrating'];
            if (validConditions.includes(condName) && !saveSuccess) {
                logs.push(this.applyCondition(targetId, {
                    name: condName as ActiveCondition['name'],
                    sourceId: caster.id,
                    duration: 1,
                }));
            }
        }

        return logs;
    }

    /**
     * Submit a player's saving throw roll against a pending spell.
     * @param entityId - The player entity rolling the save
     * @param roll - Raw d20 value (engine adds ability modifier)
     */
    submitSavingThrow(entityId: string, roll: number): ActionResult {
        if (this.state.phase !== 'AWAIT_SAVE_ROLL' || !this.state.pendingSpellSave) {
            return this.actionError('Not awaiting a saving throw');
        }

        const pending = this.state.pendingSpellSave;
        if (!pending.pendingTargetIds.includes(entityId)) {
            return this.actionError(`${entityId} does not need to roll a save`);
        }

        const target = this.getEntity(entityId);
        if (!target) return this.actionError(`Entity not found: ${entityId}`);

        const caster = this.getEntity(pending.casterId);

        this.pushHistory();
        const logs: CombatLogEntry[] = [];

        // Calculate save total
        const saveMod = this.getAbilityModById(entityId, pending.saveStat);
        const total = roll + saveMod;
        const saveSuccess = total >= pending.spellSaveDC;

        logs.push(this.createLogEntry("ACTION", {
            actorId: entityId,
            description: `${target.name} rolls a ${pending.saveStat} save: ${roll}+${saveMod}=${total} vs DC ${pending.spellSaveDC} — ${saveSuccess ? 'SUCCESS' : 'FAILURE'}!`,
        }));

        // Apply spell effect to this target
        if (pending.damageFormula || pending.conditions.length > 0) {
            // Build a minimal Spell object for applySpellEffect
            const spellForEffect = SpellSchema.parse({
                name: pending.spellName,
                halfOnSave: pending.halfOnSave,
                damageFormula: pending.damageFormula,
                damageType: pending.damageType,
                conditions: pending.conditions,
            });
            logs.push(...this.applySpellEffect(caster ?? { id: pending.casterId, name: 'spell' } as CombatEntity, spellForEffect, entityId, saveSuccess));
        }

        // Remove this target from pending
        pending.pendingTargetIds = pending.pendingTargetIds.filter(id => id !== entityId);

        if (pending.pendingTargetIds.length > 0) {
            // More players need to save
            const nextTarget = this.getEntity(pending.pendingTargetIds[0]);
            logs.push(this.createLogEntry("ACTION", {
                description: `${nextTarget?.name ?? 'Next player'} must make a DC ${pending.spellSaveDC} ${pending.saveStat} saving throw!`,
            }));
            this.state.updatedAt = Date.now();
            return { success: true, logs, newState: this.getState() as BattleState, awaitingSaveRoll: true };
        }

        // All saves done — return to ACTIVE
        this.state.pendingSpellSave = undefined;
        this.state.phase = 'ACTIVE';
        this.state.updatedAt = Date.now();

        const currentTurnEntity = this.getEntity(this.state.turnOrder[this.state.turnIndex]);
        if (currentTurnEntity) {
            const turnLogs = this.autoEndTurnIfExhausted(currentTurnEntity);
            logs.push(...turnLogs);
        }

        return { success: true, logs, newState: this.getState() as BattleState };
    }

    /**
     * Check if an entity needs a concentration saving throw after taking damage.
     * DC = max(10, damage / 2). Auto-rolled CON save. Drops concentration on failure.
     */
    private checkConcentrationSave(entityId: string, damage: number): CombatLogEntry[] {
        if (!this.hasActiveCondition(entityId, 'concentrating')) return [];

        const dc = Math.max(10, Math.floor(damage / 2));
        const entity = this.getEntity(entityId);
        if (!entity) return [];

        const conMod = this.getAbilityModById(entityId, 'CON');
        const saveRoll = this.rollFn("1d20");
        const total = saveRoll.total + conMod;
        const success = total >= dc;

        const logs: CombatLogEntry[] = [];
        logs.push(this.createLogEntry("ACTION", {
            actorId: entityId,
            description: `${entity.name} makes a concentration check: ${saveRoll.total}+${conMod}=${total} vs DC ${dc} — ${success ? 'maintained!' : 'CONCENTRATION BROKEN!'}`,
        }));

        if (!success) {
            logs.push(this.removeCondition(entityId, 'concentrating'));
            activity.system(this.state.sessionId, `${entity.name} loses concentration`);
        }

        return logs;
    }

    /**
     * Get ability score modifier for an entity by stat name.
     */
    private getAbilityModById(entityId: string, stat: 'STR' | 'DEX' | 'CON' | 'INT' | 'WIS' | 'CHA'): number {
        const entity = this.getEntity(entityId);
        return entity ? this.getAbilityMod(entity, stat) : 0;
    }

    /**
     * Get ability score modifier for an entity (D&D 5e formula: floor((score - 10) / 2))
     */
    private getAbilityMod(entity: CombatEntity, stat: 'STR' | 'DEX' | 'CON' | 'INT' | 'WIS' | 'CHA'): number {
        const scores = entity.abilityScores;
        if (!scores) return 0;
        const scoreMap = { STR: scores.str, DEX: scores.dex, CON: scores.con, INT: scores.int, WIS: scores.wis, CHA: scores.cha };
        const score = scoreMap[stat] ?? 10;
        return Math.floor((score - 10) / 2);
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
