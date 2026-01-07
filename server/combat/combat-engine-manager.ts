/**
 * Combat Engine Manager — Per-Session Engine Instance Management
 * 
 * This module manages CombatEngineV2 instances, ensuring:
 * - Each session has at most one engine instance
 * - Lazy loading from database state
 * - Automatic persistence on mutations
 */

import { CombatEngineV2, createCombatEngine } from "./combat-engine-v2";
import {
    type BattleState,
    type CombatEntity,
    type GameSettings,
    createPlayerEntity,
    createEnemyEntity,
} from "./combat-types";

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
            engine = createCombatEngine(sessionId, settings);
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
            const engine = createCombatEngine(sessionId);
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
