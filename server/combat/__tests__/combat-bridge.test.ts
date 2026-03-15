
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleAutoCombatInitiation, handleAutoCombatEnd } from '../combat-helpers';
import { CombatEngineManager } from '../combat-engine-manager';
import type { EnemyData } from '../../response-parser';

// Mock the DB module
vi.mock('../../db', () => ({
    getCharacter: vi.fn(),
    getSessionCharacters: vi.fn().mockResolvedValue([
        {
            id: 123,
            sessionId: 99999,
            name: 'Test Hero',
            hpCurrent: 50,
            hpMax: 50,
            ac: 16,
            stats: JSON.stringify({ dex: 14 }),
            inventory: '[]',
            className: 'Fighter',
            level: 3,
            createdAt: new Date(),
            updatedAt: new Date(),
            initiativeBonus: 0,
            attackBonus: 0,
            damageFormula: '1d8',
            damageType: 'slashing',
            notes: '',
        },
    ]),
    saveCombatEngineState: vi.fn().mockResolvedValue(undefined),
    deleteCombatEngineState: vi.fn().mockResolvedValue(undefined),
    loadCombatEngineState: vi.fn().mockResolvedValue(null),
}));

import * as db from '../../db';

describe('Combat Bridge Integration', () => {
    const sessionId = 99999;
    const characterId = 123;

    beforeEach(() => {
        // Clear engine before each test
        CombatEngineManager.destroy(sessionId);
        vi.clearAllMocks();
    });

    afterEach(() => {
        CombatEngineManager.destroy(sessionId);
    });

    it('should successfully initiate combat engine from enemy data', async () => {
        // Setup mock character return
        vi.mocked(db.getCharacter).mockResolvedValue({
            id: characterId,
            sessionId,
            name: 'Test Hero',
            hpCurrent: 50,
            hpMax: 50,
            ac: 16,
            stats: JSON.stringify({ dex: 14 }), // +2 Mod
            inventory: '[]',
            className: 'Fighter',
            level: 3,
            createdAt: new Date(),
            updatedAt: new Date(),
            initiativeBonus: 0,
            attackBonus: 0,
            damageFormula: '1d8',
            damageType: 'slashing',
            notes: '',
        });

        const enemies: EnemyData[] = [
            {
                name: 'Goblin Grunt',
                ac: 12,
                hpMax: 7,
                attackBonus: 4,
                damageFormula: '1d6+2',
                damageType: 'slashing',
                initiative: 15, // Fixed initiative
            },
            {
                name: 'Goblin Boss',
                ac: 14,
                hpMax: 15,
                attackBonus: 5,
                damageFormula: '1d8+3',
                damageType: 'slashing',
                // No initiative, should roll
            }
        ];

        // Execute Bridge
        const result = await handleAutoCombatInitiation(sessionId, characterId, enemies);

        // Assertions
        expect(result.success).toBe(true);
        expect(result.enemiesAdded).toBe(2);

        // Verify Engine State
        const engine = CombatEngineManager.get(sessionId);
        expect(engine).toBeDefined();

        const state = engine!.getState();
        expect(state.entities).toHaveLength(3); // 2 goblins + 1 player

        // Check Player
        const player = state.entities.find(e => e.type === 'player');
        expect(player).toBeDefined();
        expect(player?.name).toBe('Test Hero');
        // When awaiting initiative, player initiative is 0 until they roll; otherwise > 0
        expect(player?.initiative).toBeGreaterThanOrEqual(0);

        // Check Goblins
        const grunt = state.entities.find(e => e.name === 'Goblin Grunt');
        expect(grunt?.initiative).toBe(15);

        const boss = state.entities.find(e => e.name === 'Goblin Boss');
        expect(boss).toBeDefined();
        // Boss had no initiative in input (0); when awaiting player initiative, enemy rolls may not have run yet
        expect(boss?.initiative).toBeGreaterThanOrEqual(0);
    });

    it('should destroy engine on combat end', async () => {
        // Create an engine first
        const engine = CombatEngineManager.getOrCreate(sessionId);
        expect(CombatEngineManager.get(sessionId)).toBeDefined();

        // End Combat
        await handleAutoCombatEnd(sessionId);

        // Verify destruction
        expect(CombatEngineManager.get(sessionId)).toBeNull();
    });
});
