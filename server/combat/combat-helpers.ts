/**
 * Combat Helpers Module
 * Helper functions for automatic combat setup and management
 */

import type { EnemyData } from '../response-parser';
import { CombatEngineManager } from './combat-engine-manager';
import { createPlayerEntity, createEnemyEntity, type CombatEntity, type Spell, type WeaponEntry } from './combat-types';
import { runAILoop, shouldExecuteAI } from './enemy-ai-controller';
import type { ActorSheet } from '../kernel/actor-sheet';
import type { ActorState } from '../kernel/actor-state';
import { deriveInitialState } from '../kernel/actor-state';
import { getSrdLoader, lookupByName } from '../srd';
import type { ContentPackLoader } from '../srd/content-pack';

// =============================================================================
// ActorSheet → CombatEntity helpers
// =============================================================================

export interface BuildCombatSpellsResult {
    spells: Spell[];
    /** Spell names that failed SRD lookup and used a fallback instead. */
    fallbackSpells: string[];
}

/**
 * Convert ActorSheet spellcasting data to CombatEntity Spell[] format.
 * Looks up each spell in the SRD to get damage formulas, save info, etc.
 * Spells that fail SRD lookup get a minimal fallback so they remain castable.
 */
export function buildCombatSpells(
    sheet: ActorSheet,
    srdLoader: ContentPackLoader,
): BuildCombatSpellsResult {
    if (!sheet.spellcasting) return { spells: [], fallbackSpells: [] };

    const cantripSet = new Set(sheet.spellcasting.cantripsKnown.map(n => n.toLowerCase()));
    const spells: Spell[] = [];
    const fallbackSpells: string[] = [];
    const allNames = [
        ...sheet.spellcasting.cantripsKnown,
        ...sheet.spellcasting.spellsKnown,
    ];
    for (const name of allNames) {
        const srd = lookupByName(srdLoader, 'spells', name);
        if (srd) {
            spells.push(srdSpellToCombatSpell(srd, sheet.level));
        } else {
            console.warn(`[buildCombatSpells] SRD lookup failed for "${name}" — using fallback spell`);
            const isCantrip = cantripSet.has(name.toLowerCase());
            spells.push(buildFallbackSpell(name, isCantrip));
            fallbackSpells.push(name);
        }
    }
    return { spells, fallbackSpells };
}

/**
 * Create a minimal Spell when SRD data is unavailable.
 * Ensures the spell is still present in CombatEntity.spells[] and castable.
 */
function buildFallbackSpell(name: string, isCantrip: boolean): Spell {
    return {
        name,
        level: isCantrip ? 0 : 1,
        school: 'evocation',
        castingTime: 'action',
        range: 60,
        isAreaEffect: false,
        halfOnSave: true,
        damageFormula: isCantrip ? '1d10' : '1d6',
        damageType: 'magical',
        requiresConcentration: false,
        requiresAttackRoll: true,
        conditions: [],
        description: `${name} (SRD data unavailable — using fallback)`,
    };
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
export function deriveDamageFormula(sheet: ActorSheet, loader?: ContentPackLoader): string {
    const strMod = Math.floor((sheet.abilityScores.str - 10) / 2);
    const dexMod = Math.floor((sheet.abilityScores.dex - 10) / 2);

    const weapon = sheet.equipment.find(e => e.type === 'weapon');
    if (!weapon) return `1d4+${Math.max(strMod, 0)}`;

    const srd = loader ? lookupByName(loader, 'equipment', weapon.name) : null;
    const baseDie = srd?.damage?.formula
        ?? (typeof weapon.properties?.damage === 'string' ? weapon.properties.damage : null)
        ?? '1d4';

    const srdProps: string[] = srd?.properties ?? [];
    const hasFinesse = srdProps.includes('finesse') || weapon.properties?.finesse === true;
    const isRanged = srd?.subcategory?.includes('ranged') || weapon.properties?.ranged === true;

    let abilityMod: number;
    if (hasFinesse) {
        abilityMod = Math.max(strMod, dexMod);
    } else if (isRanged) {
        abilityMod = dexMod;
    } else {
        abilityMod = strMod;
    }

    return abilityMod >= 0 ? `${baseDie}+${abilityMod}` : `${baseDie}${abilityMod}`;
}

/**
 * Build WeaponEntry[] from ActorSheet equipment using SRD data.
 */
export function buildCombatWeapons(sheet: ActorSheet, loader: ContentPackLoader): WeaponEntry[] {
    const weapons: WeaponEntry[] = [];
    const strMod = Math.floor((sheet.abilityScores.str - 10) / 2);
    const dexMod = Math.floor((sheet.abilityScores.dex - 10) / 2);

    for (const item of sheet.equipment) {
        if (item.type !== 'weapon') continue;

        const srd = lookupByName(loader, 'equipment', item.name);
        const formula = srd?.damage?.formula ?? (item.properties?.damage as string) ?? '1d4';
        const damageType = srd?.damage?.type ?? (item.properties?.damageType as string) ?? 'bludgeoning';
        const srdProps: string[] = srd?.properties ?? [];
        const isFinesse = srdProps.includes('finesse') || item.properties?.finesse === true;
        const isRanged = srd?.subcategory?.includes('ranged') || item.properties?.ranged === true;

        let abilityMod: number;
        if (isFinesse) {
            abilityMod = Math.max(strMod, dexMod);
        } else if (isRanged) {
            abilityMod = dexMod;
        } else {
            abilityMod = strMod;
        }

        const attackBonus = abilityMod + sheet.proficiencyBonus;
        const dmgMod = abilityMod >= 0 ? `+${abilityMod}` : `${abilityMod}`;
        const damageFormula = `${formula}${dmgMod}`;

        weapons.push({
            name: item.name,
            damageFormula,
            damageType,
            isRanged: isRanged || false,
            attackBonus,
            properties: srdProps,
        });
    }

    return weapons;
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
            // Enrich with SRD data (real damage stats, multi-attack, etc.)
            enrichEnemyFromSrd(entity, getSrdLoader());

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
                characterClass: character.className || undefined,
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
                    const { spells: combatSpells, fallbackSpells } = buildCombatSpells(sheet, loader);
                    if (fallbackSpells.length > 0) {
                        console.warn(`[AutoCombat] ${character.name}: ${fallbackSpells.length} spell(s) used fallback (SRD miss): ${fallbackSpells.join(', ')}`);
                    }
                    console.log(`[AutoCombat] ${character.name}: loaded ${combatSpells.length} combat spells: ${combatSpells.map(s => s.name).join(', ')}`);
                    const dexModSheet = Math.floor((sheet.abilityScores.dex - 10) / 2);

                    const combatWeapons = buildCombatWeapons(sheet, loader);

                    extraOptions = {
                        ...extraOptions,
                        characterClass: sheet.characterClass,
                        level: sheet.level,
                        abilityScores: sheet.abilityScores,
                        initiativeModifier: dexModSheet,
                        attackModifier: deriveAttackBonus(sheet),
                        damageFormula: deriveDamageFormula(sheet, loader),
                        damageType: combatWeapons[0]?.damageType ?? 'bludgeoning',
                        spells: combatSpells,
                        spellSlots: state.spellSlotsCurrent,
                        spellSaveDC: sheet.spellcasting?.saveDC,
                        spellAttackBonus: sheet.spellcasting?.attackBonus,
                        spellcastingAbility: sheet.spellcasting?.ability,
                        weapons: combatWeapons,
                        saveProficiencies: sheet.proficiencies.saves,
                        proficiencyBonus: sheet.proficiencyBonus,
                        resistances: collectResistances(sheet),
                        immunities: collectImmunities(sheet),
                        featureUses: state.featureUses,
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
 * Spells that require a spell attack roll (vs. AC) instead of a saving throw.
 */
const SPELL_ATTACK_ROLL_NAMES = new Set([
    'Acid Arrow', 'Chill Touch', 'Eldritch Blast', 'Fire Bolt',
    'Flame Blade', 'Guiding Bolt', 'Inflict Wounds', 'Produce Flame',
    'Ray of Frost', 'Scorching Ray', 'Shocking Grasp', 'Spiritual Weapon',
    'Vampiric Touch',
]);

/**
 * Cantrip damage scales with caster level.
 * Tiers: 1-4 = base, 5-10 = 2x dice, 11-16 = 3x dice, 17+ = 4x dice.
 */
const CANTRIP_DAMAGE: Record<string, string[]> = {
    'Fire Bolt':       ['1d10', '2d10', '3d10', '4d10'],
    'Eldritch Blast':  ['1d10', '1d10', '1d10', '1d10'], // extra beams, not dice
    'Ray of Frost':    ['1d8',  '2d8',  '3d8',  '4d8'],
    'Sacred Flame':    ['1d8',  '2d8',  '3d8',  '4d8'],
    'Chill Touch':     ['1d8',  '2d8',  '3d8',  '4d8'],
    'Shocking Grasp':  ['1d8',  '2d8',  '3d8',  '4d8'],
    'Produce Flame':   ['1d8',  '2d8',  '3d8',  '4d8'],
    'Vicious Mockery': ['1d4',  '2d4',  '3d4',  '4d4'],
    'Acid Splash':     ['1d6',  '2d6',  '3d6',  '4d6'],
};

function getCantripDamageTier(casterLevel: number): number {
    if (casterLevel >= 17) return 3;
    if (casterLevel >= 11) return 2;
    if (casterLevel >= 5) return 1;
    return 0;
}

/**
 * Convert an SRD spell entry to a CombatEntity Spell.
 * @param casterLevel — Used for cantrip damage scaling. Defaults to 1.
 */
function srdSpellToCombatSpell(srd: any, casterLevel: number = 1): Spell {
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

    const requiresAttackRoll = SPELL_ATTACK_ROLL_NAMES.has(srd.name);

    // Scale cantrip damage by caster level
    let damageFormula = srd.damageFormula;
    if (srd.level === 0 && CANTRIP_DAMAGE[srd.name]) {
        const tier = getCantripDamageTier(casterLevel);
        damageFormula = CANTRIP_DAMAGE[srd.name][tier];
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
        damageFormula,
        damageType: srd.damageType,
        healingFormula: srd.healingFormula,
        requiresConcentration: srd.requiresConcentration ?? false,
        requiresAttackRoll,
        conditions: [],
        description: srd.description ?? '',
    };
}

/**
 * Enrich an enemy CombatEntity with SRD monster data.
 * Imports multi-attack counts, real damage stats, and save proficiencies.
 * No-op if monster not found in SRD.
 */
export function enrichEnemyFromSrd(entity: CombatEntity, loader: ContentPackLoader): void {
    const srd = lookupByName(loader, 'monsters', entity.name);
    if (!srd) return;

    // Parse Multiattack for attack count
    const multiattack = srd.actions?.find((a: any) => a.name === 'Multiattack');
    if (multiattack?.description) {
        const countWords: Record<string, number> = {
            one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
        };
        const desc = multiattack.description.toLowerCase();
        for (const [word, count] of Object.entries(countWords)) {
            if (desc.includes(word)) {
                entity.extraAttacks = count - 1;
                break;
            }
        }
    }

    // Collect non-Multiattack attack actions as WeaponEntries
    const attackActions = (srd.actions ?? []).filter(
        (a: any) => a.name !== 'Multiattack' && a.attackBonus != null
    );

    if (attackActions.length > 0) {
        entity.weapons = attackActions.map((a: any) => ({
            name: a.name,
            damageFormula: a.damageFormula ?? entity.damageFormula,
            damageType: a.damageType ?? entity.damageType,
            isRanged: a.description?.toLowerCase().includes('ranged') ?? false,
            attackBonus: a.attackBonus,
            properties: [],
        }));

        // First action's stats override entity defaults
        const primary = attackActions[0];
        if (primary.damageFormula) entity.damageFormula = primary.damageFormula;
        if (primary.attackBonus != null) entity.attackModifier = primary.attackBonus;
        if (primary.damageType) entity.damageType = primary.damageType;
    }

    // Copy save proficiencies if present
    if (srd.saveProficiencies?.length) {
        entity.saveProficiencies = srd.saveProficiencies;
    }

    // Copy ability scores if present
    if (srd.abilityScores) {
        entity.abilityScores = srd.abilityScores;
    }

    // Copy creature type (e.g. "undead", "fiend", "dragon") for Divine Smite bonus
    if (srd.type) {
        entity.creatureType = srd.type;
    }
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
                            if (Object.keys(entity.featureUses ?? {}).length > 0) {
                                actorState.featureUses = { ...entity.featureUses };
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
