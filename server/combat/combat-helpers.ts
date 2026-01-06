/**
 * Combat Helpers Module
 * Helper functions for automatic combat setup and management
 */

import type { EnemyData } from '../response-parser';

/**
 * Handle automatic combat initiation from structured DM response
 * Creates combat state, adds enemies, adds player, and sorts initiative
 */
export async function handleAutoCombatInitiation(
    sessionId: number,
    characterId: number,
    enemies: EnemyData[]
): Promise<{ success: boolean; enemiesAdded: number; error?: string }> {
    try {
        const db = await import('../db');
        const { DiceRoller } = await import('./dice-roller');

        // 1. Create or reset combat state
        const state = await db.createCombatState(sessionId);
        console.log('[AutoCombat] Created combat state:', state.id);

        // 2. Add each enemy with initiative
        let enemiesAdded = 0;
        for (const enemy of enemies) {
            // Use provided initiative or roll
            const initiative = enemy.initiative ?? DiceRoller.roll('1d20');

            await db.addCombatant({
                sessionId,
                combatStateId: state.id,
                name: enemy.name,
                type: 'enemy',
                characterId: null,
                initiative,
                ac: enemy.ac,
                hpCurrent: enemy.hpMax,
                hpMax: enemy.hpMax,
                attackBonus: enemy.attackBonus,
                damageFormula: enemy.damageFormula,
                damageType: enemy.damageType,
                specialAbilities: null,
                position: null,
            });

            console.log(`[AutoCombat] Added enemy: ${enemy.name} (Init: ${initiative})`);
            enemiesAdded++;
        }

        // 3. Add player character with rolled initiative
        const character = await db.getCharacter(characterId);
        if (character) {
            const stats = JSON.parse(character.stats || '{}');
            const dexMod = Math.floor((stats.dex || 10 - 10) / 2);
            const playerInitiative = DiceRoller.roll('1d20') + dexMod;

            await db.addCombatant({
                sessionId,
                combatStateId: state.id,
                name: character.name,
                type: 'player',
                characterId: character.id,
                initiative: playerInitiative,
                ac: character.ac,
                hpCurrent: character.hpCurrent,
                hpMax: character.hpMax,
                attackBonus: null,
                damageFormula: null,
                damageType: null,
                specialAbilities: null,
                position: null,
            });

            console.log(`[AutoCombat] Added player: ${character.name} (Init: ${playerInitiative})`);
        }

        // 4. Sort combatants by initiative (handled by sortCombatantsByInitiative if it exists, or manually)
        // The combat.sortInitiative mutation will be called by the client after receiving the response

        return { success: true, enemiesAdded };

    } catch (error) {
        console.error('[AutoCombat] Failed to initiate combat:', error);
        return {
            success: false,
            enemiesAdded: 0,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}

/**
 * Handle automatic combat end from structured DM response
 * Cleans up combat state
 */
export async function handleAutoCombatEnd(sessionId: number): Promise<void> {
    try {
        const db = await import('../db');
        await db.deleteCombatState(sessionId);
        console.log('[AutoCombat] Combat ended for session:', sessionId);
    } catch (error) {
        console.error('[AutoCombat] Failed to end combat:', error);
    }
}
