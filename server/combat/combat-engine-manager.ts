/**
 * Combat Engine Manager — Per-Session Engine Instance Management
 * 
 * This module manages CombatEngineV2 instances, ensuring:
 * - Each session has at most one engine instance
 * - Lazy loading from database state
 * - Automatic persistence on mutations
 */

import { CombatEngineV2, createCombatEngine, type RollFn } from "./combat-engine-v2";
import {
    type BattleState,
    type CombatEntity,
    type GameSettings,
    createPlayerEntity,
    createEnemyEntity,
} from "./combat-types";

// ── Deterministic dice for testing ──────────────────────────────────────────
// Set DICE_SEED env var to enable deterministic dice rolls.
// Value is a comma-separated list of roll totals that cycle.
// Example: DICE_SEED=15,10,8 → first roll returns 15, second 10, third 8, fourth 15, ...

function createSeededRollFn(seed: string): RollFn {
    const values = seed.split(",").map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
    if (values.length === 0) throw new Error("DICE_SEED must be comma-separated integers, e.g. DICE_SEED=15,10,8");
    let idx = 0;
    return (_formula: string) => {
        const total = values[idx % values.length];
        idx++;
        return { total, rolls: [total], isCritical: total === 20, isFumble: total === 1 };
    };
}

const seededRollFn: RollFn | null = process.env.DICE_SEED
    ? createSeededRollFn(process.env.DICE_SEED)
    : null;

if (seededRollFn) {
    console.log(`[CombatEngineManager] Deterministic dice active (DICE_SEED=${process.env.DICE_SEED})`);
}

// =============================================================================
// ENGINE MANAGER
// =============================================================================

/**
 * Manages CombatEngineV2 instances per session
 * 
 * Engines are kept in memory for fast access but can be persisted to DB.
 * This is a singleton — import it and use directly.
 */
class CombatEngineManagerClass {
    private engines: Map<number, CombatEngineV2> = new Map();
    private locks: Map<number, Promise<void>> = new Map();
    private runningAILoops: Set<number> = new Set();

    /**
     * Get an existing engine for a session, or return null if none exists
     */
    get(sessionId: number): CombatEngineV2 | null {
        return this.engines.get(sessionId) || null;
    }

    /**
     * Get an existing engine or create a new one
     * If no engine exists, creates a fresh one in IDLE state
     */
    getOrCreate(sessionId: number, settings?: Partial<GameSettings>): CombatEngineV2 {
        let engine = this.engines.get(sessionId);
        if (!engine) {
            engine = createCombatEngine(sessionId, settings, seededRollFn ?? undefined);
            this.engines.set(sessionId, engine);
        }
        return engine;
    }

    /**
     * Load engine state from database
     * If state exists in DB, restores it. Otherwise creates fresh engine.
     */
    async loadFromDb(sessionId: number): Promise<CombatEngineV2> {
        const db = await import("../db");

        // Try to load saved state
        const savedState = await db.loadCombatEngineState(sessionId);

        if (savedState) {
            const engine = createCombatEngine(sessionId, undefined, seededRollFn ?? undefined);
            engine.loadState(savedState);
            this.engines.set(sessionId, engine);
            console.log(`[CombatEngineManager] Loaded engine for session ${sessionId} from DB`);
            return engine;
        }

        // No saved state, return fresh or existing engine
        return this.getOrCreate(sessionId);
    }

    /**
     * Persist engine state to database
     * Call this after mutations to ensure state survives server restarts
     */
    async persist(sessionId: number): Promise<void> {
        const engine = this.engines.get(sessionId);
        if (!engine) {
            console.warn(`[CombatEngineManager] No engine to persist for session ${sessionId}`);
            return;
        }

        const db = await import("../db");
        const stateJson = engine.exportState();
        await db.saveCombatEngineState(sessionId, stateJson);
        console.log(`[CombatEngineManager] Persisted engine state for session ${sessionId}`);
    }

    /**
     * Destroy an engine instance (e.g., when combat ends)
     * Also removes persisted state from database
     */
    async destroy(sessionId: number): Promise<void> {
        this.engines.delete(sessionId);

        const db = await import("../db");
        await db.deleteCombatEngineState(sessionId);
        console.log(`[CombatEngineManager] Destroyed engine for session ${sessionId}`);
    }

    /**
     * Serialize concurrent mutations on the same session to prevent race conditions.
     * Operations are queued and executed one at a time per session.
     */
    async withLock<T>(sessionId: number, fn: () => Promise<T>): Promise<T> {
        const existing = this.locks.get(sessionId) ?? Promise.resolve();
        let resolve!: () => void;
        const next = new Promise<void>(r => { resolve = r; });
        this.locks.set(sessionId, next);
        await existing;
        try {
            return await fn();
        } finally {
            resolve();
            // Clean up lock entry if it's still ours
            if (this.locks.get(sessionId) === next) {
                this.locks.delete(sessionId);
            }
        }
    }

    /**
     * Check if an AI loop is already running for a session (prevents re-entry)
     */
    isAILoopRunning(sessionId: number): boolean {
        return this.runningAILoops.has(sessionId);
    }

    /**
     * Mark an AI loop as running or finished for a session
     */
    setAILoopRunning(sessionId: number, running: boolean): void {
        if (running) {
            this.runningAILoops.add(sessionId);
        } else {
            this.runningAILoops.delete(sessionId);
        }
    }

    /**
     * Check if an engine exists for a session
     */
    has(sessionId: number): boolean {
        return this.engines.has(sessionId);
    }

    /**
     * Get all active session IDs (for debugging)
     */
    getActiveSessionIds(): number[] {
        return Array.from(this.engines.keys());
    }
}

// Export singleton instance
export const CombatEngineManager = new CombatEngineManagerClass();

// =============================================================================
// HELPER: Convert DB Combatants to Engine Entities
// =============================================================================

/**
 * Convert a database combatant to a CombatEntity for the engine
 */
export function dbCombatantToEntity(combatant: {
    id: number;
    name: string;
    type: string;
    characterId: number | null;
    initiative: number;
    ac: number;
    hpCurrent: number;
    hpMax: number;
    attackBonus: number | null;
    damageFormula: string | null;
    damageType: string | null;
}): CombatEntity {
    const isPlayer = combatant.type === "player";

    if (isPlayer) {
        return createPlayerEntity(
            `combatant-${combatant.id}`,
            combatant.name,
            combatant.hpCurrent,
            combatant.hpMax,
            combatant.ac,
            combatant.initiative,
            {
                dbCombatantId: combatant.id,
                dbCharacterId: combatant.characterId ?? undefined,
                attackModifier: combatant.attackBonus ?? 0,
                damageFormula: combatant.damageFormula ?? "1d8",
            }
        );
    } else {
        return createEnemyEntity(
            `combatant-${combatant.id}`,
            combatant.name,
            combatant.hpCurrent,
            combatant.ac,
            combatant.attackBonus ?? 0,
            combatant.damageFormula ?? "1d6",
            {
                initiative: combatant.initiative,
                maxHp: combatant.hpMax,
                damageType: combatant.damageType ?? "slashing",
                dbCombatantId: combatant.id,
            }
        );
    }
}
