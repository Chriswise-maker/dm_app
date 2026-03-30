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
import { deriveInitialState } from '../kernel/actor-state';
import { getSrdLoader, lookupByName } from '../srd';
import type { ContentPackLoader } from '../srd/content-pack';

// =============================================================================
// ActorSheet → CombatEntity helpers
// =============================================================================

/**
 * Convert ActorSheet spellcasting data to CombatEntity Spell[] format.
 * Looks up each spell in the SRD to get damage formulas, save info, etc.
 */
export function buildCombatSpells(
    sheet: ActorSheet,
    srdLoader: ContentPackLoader,
): Spell[] {
    if (!sheet.spellcasting) return [];

    const spells: Spell[] = [];
    const allNames = [
        ...sheet.spellcasting.cantripsKnown,
        ...sheet.spellcasting.spellsKnown,
    ];
    for (const name of allNames) {
        const srd = lookupByName(srdLoader, 'spells', name);
        if (srd) {
            spells.push(srdSpellToCombatSpell(srd));
        }
    }
    return spells;
}

/** Resistance keywords to scan for in features/equipment. */
const DAMAGE_TYPES = [
    'acid', 'bludgeoning', 'cold', 'fire', 'force', 'lightning',
    'necrotic', 'piercing', 'poison', 'psychic', 'radiant', 'slashing', 'thunder',
];

function scanForDamageTypes(text: string, keyword: string): string[] {
    const lower = text.toLowerCase();
    if (!lower.includes(keyword)) return [];
    return DAMAGE_TYPES.filter(dt => lower.includes(dt));
}

/**
 * Collect damage resistances from racial traits, features, and equipment.
 */
export function collectResistances(sheet: ActorSheet): string[] {
    const resistances = new Set<string>();
    for (const feat of sheet.features) {
        for (const dt of scanForDamageTypes(feat.description, 'resistance')) {
            resistances.add(dt);
        }
    }
    for (const item of sheet.equipment) {
        const props = item.properties ?? {};
        if (typeof props.resistances === 'string') {
            for (const dt of scanForDamageTypes(props.resistances, 'resistance')) {
                resistances.add(dt);
            }
        }
    }
    return Array.from(resistances);
}

/**
 * Collect damage immunities from features and equipment.
 */
export function collectImmunities(sheet: ActorSheet): string[] {
    const immunities = new Set<string>();
    for (const feat of sheet.features) {
        for (const dt of scanForDamageTypes(feat.description, 'immun')) {
            immunities.add(dt);
        }
    }
    for (const item of sheet.equipment) {
        const props = item.properties ?? {};
        if (typeof props.immunities === 'string') {
            for (const dt of scanForDamageTypes(props.immunities, 'immun')) {
                immunities.add(dt);
            }
        }
    }
    return Array.from(immunities);
}

/**
 * Derive weapon attack bonus from ActorSheet.
 * Uses STR for melee (or DEX if finesse/higher), plus proficiency bonus.
 */
export function deriveAttackBonus(sheet: ActorSheet): number {
    const strMod = Math.floor((sheet.abilityScores.str - 10) / 2);
    const dexMod = Math.floor((sheet.abilityScores.dex - 10) / 2);

    // Check if character has a finesse weapon
    const hasFinesse = sheet.equipment.some(e =>
        e.properties && typeof e.properties.finesse === 'boolean' && e.properties.finesse
    );

    const abilityMod = hasFinesse ? Math.max(strMod, dexMod) : strMod;
    return abilityMod + sheet.proficiencyBonus;
}

/**
 * Derive primary damage formula from equipped weapon.
 * Falls back to "1d4" (unarmed) if no weapon found.
 */
export function deriveDamageFormula(sheet: ActorSheet): string {
    const strMod = Math.floor((sheet.abilityScores.str - 10) / 2);
    const dexMod = Math.floor((sheet.abilityScores.dex - 10) / 2);

    // Find first weapon in equipment
    const weapon = sheet.equipment.find(e => e.type === 'weapon');
    if (!weapon || !weapon.properties) return `1d4+${Math.max(strMod, 0)}`;

    const baseDie = typeof weapon.properties.damage === 'string'
        ? weapon.properties.damage
        : '1d8';

    const hasFinesse = weapon.properties.finesse === true;
    const abilityMod = hasFinesse ? Math.max(strMod, dexMod) : strMod;

    return abilityMod >= 0 ? `${baseDie}+${abilityMod}` : `${baseDie}${abilityMod}`;
}

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
                    const state: ActorState = character.actorState
                        ? JSON.parse(character.actorState)
                        : deriveInitialState(sheet);

                    const loader = getSrdLoader();
                    const combatSpells = buildCombatSpells(sheet, loader);
                    const dexModSheet = Math.floor((sheet.abilityScores.dex - 10) / 2);

                    extraOptions = {
                        ...extraOptions,
                        abilityScores: sheet.abilityScores,
                        initiativeModifier: dexModSheet,
                        attackModifier: deriveAttackBonus(sheet),
                        damageFormula: deriveDamageFormula(sheet),
                        spells: combatSpells,
                        spellSlots: state.spellSlotsCurrent,
                        spellSaveDC: sheet.spellcasting?.saveDC,
                        resistances: collectResistances(sheet),
                        immunities: collectImmunities(sheet),
                    };
                } catch (e) {
                    console.warn(`[AutoCombat] Failed to parse actorSheet for ${character.name}:`, e);
                }
            }

            // When ActorSheet is available, prefer its AC and state HP
            const useSheet = character.actorSheet != null;
            let hp = character.hpCurrent;
            let maxHp = character.hpMax;
            let ac = character.ac;
            if (useSheet && extraOptions.abilityScores) {
                try {
                    const sheet: ActorSheet = JSON.parse(character.actorSheet!);
                    const state: ActorState = character.actorState
                        ? JSON.parse(character.actorState)
                        : deriveInitialState(sheet);
                    hp = state.hpCurrent;
                    maxHp = state.hpMax;
                    ac = sheet.ac.base;
                } catch { /* already warned above */ }
            }

            const playerEntity = createPlayerEntity(
                `player-${character.id}`,
                character.name,
                hp,
                maxHp,
                ac,
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
                    // Sync actorState if character has one
                    if (character.actorState) {
                        try {
                            const actorState: ActorState = JSON.parse(character.actorState);
                            actorState.hpCurrent = entity.hp;
                            if (Object.keys(entity.spellSlots ?? {}).length > 0) {
                                actorState.spellSlotsCurrent = { ...entity.spellSlots };
                            }
                            await db.updateCharacter(entity.dbCharacterId, {
                                actorState: JSON.stringify(actorState),
                            });
                            console.log(`[Sync] Updated actorState for ${entity.name}`);
                        } catch (e) {
                            console.warn(`[Sync] Failed to update actorState for ${entity.name}:`, e);
                        }
                    }

                    // Backwards compat: also sync to worldState resource tracking
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
