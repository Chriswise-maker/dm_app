/**
 * Combat Helpers Module
 * Helper functions for automatic combat setup and management
 */

import type { EnemyData } from '../response-parser';
import { CombatEngineManager } from './combat-engine-manager';
import { createPlayerEntity, createEnemyEntity, type CombatEntity, type Spell } from './combat-types';
import { runAILoop, shouldExecuteAI } from './enemy-ai-controller';
import type { ActorSheet } from '../kernel/actor-sheet';
import type { ActorState } from '../kernel/actor-state';
import { getSrdLoader, lookupByName } from '../srd';

/**
 * Handle automatic combat initiation from structured DM response
 * Creates combat engine, adds enemies and player, and starts combat
 * 
 * @param sessionId - The session ID
 * @param characterId - The player character ID
 * @param enemies - Enemy data from LLM response
 * @param userId - The user ID (for LLM settings when running AI loop)
 */
export async function handleAutoCombatInitiation(
    sessionId: number,
    characterId: number,
    enemies: EnemyData[],
    userId: number
): Promise<{ success: boolean; enemiesAdded: number; awaitingInitiative?: boolean; error?: string }> {
    try {
        const db = await import('../db');

        console.log('[AutoCombat] Initiating V2 Combat for session:', sessionId);

        const entities: CombatEntity[] = [];

        // 1. Convert enemies to CombatEntities
        let enemiesAdded = 0;
        for (const enemy of enemies) {
            const entity = createEnemyEntity(
                `enemy-${enemiesAdded + 1}-${Date.now()}`, // Temporary ID, engine might generate better ones if we let it, but factory needs one
                enemy.name,
                enemy.hpMax,
                enemy.ac,
                enemy.attackBonus,
                enemy.damageFormula,
                {
                    damageType: enemy.damageType,
                    initiative: enemy.initiative || 0, // 0 triggers auto-roll in engine
                }
            );
            entities.push(entity);
            enemiesAdded++;
            console.log(`[AutoCombat] Prepared enemy: ${enemy.name}`);
        }

        // 2. Fetch and convert ALL session players to CombatEntities
        // Issue 4 Fix: Query all characters in the session, not just the active one
        const sessionCharacters = await db.getSessionCharacters(sessionId);
        const storedContext = await db.getSessionContext(sessionId);
        const parsedContext = db.parseSessionContext(storedContext);
        const { getCharacterResourceState } = await import('../rest');
        console.log(`[AutoCombat] Found ${sessionCharacters.length} characters in session`);

        for (const character of sessionCharacters) {
            const stats = JSON.parse(character.stats || '{}');
            const dexMod = Math.floor(((stats.dex || 10) - 10) / 2);
            const resourceState = getCharacterResourceState(parsedContext.worldState, character);

            // Build richer entity from ActorSheet if available
            let extraOptions: Partial<CombatEntity> = {
                initiativeModifier: dexMod,
                abilityScores: stats,
                spellSlots: resourceState.spellSlotsCurrent,
                dbCharacterId: character.id,
            };

            if (character.actorSheet) {
                try {
                    const sheet: ActorSheet = JSON.parse(character.actorSheet);
                    const state: ActorState | null = character.actorState
                        ? JSON.parse(character.actorState)
                        : null;

                    // Build combat spells from ActorSheet spellcasting data
                    const combatSpells: Spell[] = [];
                    if (sheet.spellcasting) {
                        const loader = getSrdLoader();
                        const allSpellNames = [
                            ...sheet.spellcasting.cantripsKnown,
                            ...sheet.spellcasting.spellsKnown,
                        ];
                        for (const spellName of allSpellNames) {
                            const srdSpell = lookupByName(loader, 'spells', spellName);
                            if (srdSpell) {
                                combatSpells.push(srdSpellToCombatSpell(srdSpell));
                            }
                        }
                    }

                    extraOptions = {
                        ...extraOptions,
                        abilityScores: sheet.abilityScores,
                        spells: combatSpells,
                        spellSlots: state?.spellSlotsCurrent ?? resourceState.spellSlotsCurrent,
                        spellSaveDC: sheet.spellcasting?.saveDC,
                        resistances: [],
                        immunities: [],
                    };
                } catch (e) {
                    console.warn(`[AutoCombat] Failed to parse actorSheet for ${character.name}:`, e);
                }
            }

            const playerEntity = createPlayerEntity(
                `player-${character.id}`,
                character.name,
                character.hpCurrent,
                character.hpMax,
                character.ac,
                0, // Initiative 0 triggers roll
                extraOptions,
            );
            entities.push(playerEntity);
            console.log(`[AutoCombat] Prepared player: ${character.name} (${character.actorSheet ? 'with ActorSheet' : 'basic'})`);
        }

        // 3. Get Engine and Prepare Combat (may pause for initiative)
        const engine = CombatEngineManager.getOrCreate(sessionId);
        const { awaitingInitiative } = engine.prepareCombat(entities);

        // 4. Persist initial state
        await CombatEngineManager.persist(sessionId);

        if (awaitingInitiative) {
            console.log('[AutoCombat] Combat V2 prepared - awaiting player initiative rolls');
            return { success: true, enemiesAdded, awaitingInitiative: true };
        }

        console.log('[AutoCombat] Combat V2 initiated successfully (no initiative wait)');

        // 5. Trigger AI loop if first turn is an enemy (fire and forget)
        if (shouldExecuteAI(sessionId)) {
            console.log('[AutoCombat] First turn is enemy, triggering AI loop...');
            runAILoop(sessionId, userId).catch(err => {
                console.error('[AutoCombat] AI loop error:', err);
            });
        }

        return { success: true, enemiesAdded, awaitingInitiative: false };

    } catch (error) {
        console.error('[AutoCombat] Failed to initiate combat:', error);
        return {
            success: false,
            enemiesAdded: 0,
            awaitingInitiative: false,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}

/**
 * Convert an SRD spell entry to a CombatEntity Spell.
 */
function srdSpellToCombatSpell(srd: any): Spell {
    // Parse range to a number (feet)
    let range = 30;
    if (typeof srd.range === 'string') {
        const match = srd.range.match(/(\d+)/);
        if (match) range = parseInt(match[1], 10);
        if (srd.range.toLowerCase().includes('self')) range = 0;
        if (srd.range.toLowerCase().includes('touch')) range = 5;
    }

    // Map casting time
    let castingTime: 'action' | 'bonus_action' | 'reaction' = 'action';
    if (typeof srd.castingTime === 'string') {
        if (srd.castingTime.includes('bonus')) castingTime = 'bonus_action';
        else if (srd.castingTime.includes('reaction')) castingTime = 'reaction';
    }

    return {
        name: srd.name,
        level: srd.level ?? 0,
        school: srd.school ?? 'evocation',
        castingTime,
        range,
        isAreaEffect: srd.isAreaEffect ?? false,
        areaType: srd.areaType,
        areaSize: srd.areaSize,
        savingThrow: srd.saveStat ? srd.saveStat.toUpperCase() : undefined,
        halfOnSave: srd.saveEffect === 'half' || (srd.halfOnSave ?? true),
        damageFormula: srd.damageFormula,
        damageType: srd.damageType,
        healingFormula: srd.healingFormula,
        requiresConcentration: srd.requiresConcentration ?? false,
        conditions: [],
        description: srd.description ?? '',
    };
}

/**
 * Handle automatic combat end from structured DM response
 * Destroys the combat engine instance
 */
export async function handleAutoCombatEnd(sessionId: number): Promise<void> {
    try {
        await CombatEngineManager.destroy(sessionId);
        console.log('[AutoCombat] Combat V2 ended for session:', sessionId);
    } catch (error) {
        console.error('[AutoCombat] Failed to end combat:', error);
    }
}

/**
 * Sync the current combat state (HP) back to the character database
 * This ensures the UI stays consistent with the engine's deterministic state
 */
export async function syncCombatStateToDb(sessionId: number): Promise<void> {
    try {
        const engine = CombatEngineManager.get(sessionId);
        if (!engine) return;

        const db = await import('../db');
        const { getCharacterResourceState, setCharacterResourceState } = await import('../rest');
        const state = engine.getState();
        const storedContext = await db.getSessionContext(sessionId);
        const parsedContext = db.parseSessionContext(storedContext);
        let worldState = parsedContext.worldState;

        for (const entity of state.entities) {
            if (entity.type === 'player' && entity.dbCharacterId) {
                console.log(`[Sync] Syncing HP for ${entity.name}: ${entity.hp}/${entity.maxHp}`);
                await db.updateCharacterHP(entity.dbCharacterId, entity.hp);

                const character = await db.getCharacter(entity.dbCharacterId);
                if (character) {
                    const resourceState = getCharacterResourceState(worldState, character);
                    worldState = setCharacterResourceState(worldState, character.id, {
                        ...resourceState,
                        spellSlotsCurrent: Object.keys(entity.spellSlots ?? {}).length > 0
                            ? { ...entity.spellSlots }
                            : resourceState.spellSlotsCurrent,
                    });
                }
            }
        }

        await db.upsertSessionContext(sessionId, {
            ...parsedContext,
            worldState,
        });
    } catch (error) {
        console.error('[Sync] Failed to sync combat state to DB:', error);
    }
}
