/**
 * Tests for combat narrator prompt construction.
 *
 * These tests verify that computeCombatNarrativePrompts builds correct
 * prompts from combat logs — the actual data the LLM sees.
 * No LLM calls are made; we inspect the prompt strings directly.
 */

import { describe, it, expect, vi } from 'vitest';

// Mock DB (getUserSettings is called inside computeCombatNarrativePrompts)
vi.mock('../../db', () => ({
  getUserSettings: vi.fn().mockResolvedValue({}),
}));

import { computeCombatNarrativePrompts } from '../combat-narrator';
import type { CombatEntity, CombatLogEntry } from '../combat-types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntity(
  id: string, name: string, type: 'player' | 'enemy',
  overrides?: Partial<CombatEntity>
): CombatEntity {
  return {
    id, name, type,
    hp: 20, maxHp: 20, baseAC: 12,
    status: 'ALIVE', conditions: [], rangeTo: {},
    initiative: 10, initiativeModifier: 0,
    attackModifier: 5, damageFormula: '1d8+3',
    damageType: 'bludgeoning',
    weapons: [{ name: 'Quarterstaff', damageFormula: '1d6+3', damageType: 'bludgeoning', isRanged: false, attackBonus: 5, properties: [] }],
    spells: [],
    spellSlots: {},
    immunities: [], resistances: [], vulnerabilities: [],
    activeConditions: [], activeModifiers: [],
    isEssential: type === 'player',
    movementSteps: 1, maxMovementSteps: 1,
    ...overrides,
  } as CombatEntity;
}

function makeLog(type: string, data: Partial<CombatLogEntry> = {}): CombatLogEntry {
  return {
    id: `log-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
    round: 1,
    turnIndex: 0,
    type: type as any,
    ...data,
  } as CombatLogEntry;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('narrator prompt construction', () => {

  describe('spell attacks (e.g. Fire Bolt)', () => {
    const entities = [
      makeEntity('p1', 'Silas Gravemourn', 'player'),
      makeEntity('e1', 'Zombie', 'enemy'),
    ];

    // This is the log batch that resolveAttackRoll produces for a spell attack hit
    const spellHitLogs: CombatLogEntry[] = [
      makeLog('SPELL_CAST', {
        actorId: 'p1',
        description: 'Silas Gravemourn casts Fire Bolt!',
      }),
      makeLog('ATTACK_ROLL', {
        actorId: 'p1',
        targetId: 'e1',
        roll: { formula: '1d20+5', result: 25, isCritical: true, isFumble: false },
        success: true,
        description: 'Silas Gravemourn rolls spell attack: 20+5=25 vs AC 12 — CRITICAL HIT!',
      }),
      makeLog('DAMAGE', {
        actorId: 'p1',
        targetId: 'e1',
        amount: 13,
        damageType: 'fire',
        description: 'Fire Bolt deals 13 fire damage to Zombie! (7/20 HP)',
      }),
    ];

    it('should say SPELL not WEAPON in ENTITY DETAILS', async () => {
      const result = await computeCombatNarrativePrompts(
        1, spellHitLogs, 'nat 20', 'Silas Gravemourn', entities, false, 'p1'
      );
      expect(result).not.toBeNull();
      // Extract ENTITY DETAILS block from the prompt
      const entityBlock = result!.userPrompt.match(/ENTITY DETAILS:\n([\s\S]*?)\n\n/)?.[1] ?? '';
      expect(entityBlock).toContain('SPELL: Fire Bolt');
      expect(entityBlock).not.toContain('WEAPON');
      expect(entityBlock).toContain('fire damage');
    });

    it('should include CRITICAL HIT when roll is critical', async () => {
      const result = await computeCombatNarrativePrompts(
        1, spellHitLogs, 'nat 20', 'Silas Gravemourn', entities, false, 'p1'
      );
      expect(result!.userPrompt).toContain('CRITICAL HIT');
    });

    it('should format log summary with HIT not MISS', async () => {
      const result = await computeCombatNarrativePrompts(
        1, spellHitLogs, 'nat 20', 'Silas Gravemourn', entities, false, 'p1'
      );
      expect(result!.logSummary).toContain('HIT');
      expect(result!.logSummary).not.toMatch(/\(MISS/);
    });

    it('should include spell name in log summary', async () => {
      const result = await computeCombatNarrativePrompts(
        1, spellHitLogs, 'nat 20', 'Silas Gravemourn', entities, false, 'p1'
      );
      expect(result!.logSummary).toContain('Fire Bolt');
    });

    it('should include fire damage type in log summary', async () => {
      const result = await computeCombatNarrativePrompts(
        1, spellHitLogs, 'nat 20', 'Silas Gravemourn', entities, false, 'p1'
      );
      expect(result!.logSummary).toContain('fire');
    });
  });

  describe('spell attack MISS', () => {
    const entities = [
      makeEntity('p1', 'Silas Gravemourn', 'player'),
      makeEntity('e1', 'Zombie', 'enemy'),
    ];

    const spellMissLogs: CombatLogEntry[] = [
      makeLog('SPELL_CAST', {
        actorId: 'p1',
        description: 'Silas Gravemourn casts Fire Bolt!',
      }),
      makeLog('ATTACK_ROLL', {
        actorId: 'p1',
        targetId: 'e1',
        roll: { formula: '1d20+5', result: 8, isCritical: false, isFumble: false },
        success: false,
        description: 'Silas Gravemourn rolls spell attack: 3+5=8 vs AC 12 — MISS!',
      }),
    ];

    it('should say SPELL not WEAPON even on a miss', async () => {
      const result = await computeCombatNarrativePrompts(
        1, spellMissLogs, 'I hurl fire', 'Silas Gravemourn', entities, false, 'p1'
      );
      const entityBlock = result!.userPrompt.match(/ENTITY DETAILS:\n([\s\S]*?)\n\n/)?.[1] ?? '';
      expect(entityBlock).toContain('SPELL: Fire Bolt');
      expect(entityBlock).not.toContain('WEAPON');
    });

    it('should show MISS in log summary', async () => {
      const result = await computeCombatNarrativePrompts(
        1, spellMissLogs, 'I hurl fire', 'Silas Gravemourn', entities, false, 'p1'
      );
      expect(result!.logSummary).toContain('MISS');
    });
  });

  describe('weapon attacks', () => {
    const entities = [
      makeEntity('p1', 'Thorin', 'player', {
        weapons: [{ name: 'Greataxe', damageFormula: '1d12+4', damageType: 'slashing', isRanged: false, attackBonus: 7, properties: [] }],
        damageType: 'slashing',
      }),
      makeEntity('e1', 'Goblin', 'enemy'),
    ];

    const weaponHitLogs: CombatLogEntry[] = [
      makeLog('ATTACK_ROLL', {
        actorId: 'p1',
        targetId: 'e1',
        roll: { formula: '1d20+7', result: 18, isCritical: false, isFumble: false },
        success: true,
        description: 'Thorin hits Goblin! (18 vs AC 12)',
      }),
      makeLog('DAMAGE', {
        actorId: 'p1',
        targetId: 'e1',
        amount: 10,
        damageType: 'slashing',
        description: 'Thorin deals 10 slashing damage to Goblin! (10/20 HP)',
      }),
    ];

    it('should say WEAPON not SPELL for weapon attacks', async () => {
      const result = await computeCombatNarrativePrompts(
        1, weaponHitLogs, 'I cleave!', 'Thorin', entities, false, 'p1'
      );
      const entityBlock = result!.userPrompt.match(/ENTITY DETAILS:\n([\s\S]*?)\n\n/)?.[1] ?? '';
      expect(entityBlock).toContain('WEAPON: Greataxe');
      expect(entityBlock).toContain('slashing damage');
      expect(entityBlock).not.toContain('SPELL');
    });
  });

  describe('healing spells', () => {
    const entities = [
      makeEntity('p1', 'Cleric', 'player'),
      makeEntity('p2', 'Fighter', 'player', { hp: 5 }),
    ];

    const healLogs: CombatLogEntry[] = [
      makeLog('SPELL_CAST', {
        actorId: 'p1',
        description: 'Cleric casts Cure Wounds!',
      }),
      makeLog('HEALING', {
        actorId: 'p1',
        targetId: 'p2',
        amount: 8,
        description: 'Cure Wounds restores 8 HP to Fighter. (13/20)',
      }),
    ];

    it('should identify as SPELL for healing', async () => {
      const result = await computeCombatNarrativePrompts(
        1, healLogs, 'I heal my friend', 'Cleric', entities, false, 'p1'
      );
      expect(result!.userPrompt).toContain('SPELL: Cure Wounds');
    });
  });

  describe('system prompt', () => {
    it('should use default prompt (not stale custom with {{templates}})', async () => {
      // Mock getUserSettings to return a stale custom prompt with mustache templates
      const db = await import('../../db');
      (db.getUserSettings as any).mockResolvedValueOnce({
        combatNarrationPrompt: 'Actor: {{actorName}} Target: {{targetName}} old broken prompt',
      });

      const logs = [makeLog('DAMAGE', { amount: 5, damageType: 'fire', description: 'hit' })];
      const entities = [makeEntity('p1', 'Hero', 'player'), makeEntity('e1', 'Goblin', 'enemy')];

      const result = await computeCombatNarrativePrompts(
        1, logs, 'attack', 'Hero', entities, false, 'p1'
      );
      expect(result!.systemPrompt).not.toContain('{{');
      expect(result!.systemPrompt).toContain('CHAOS WEAVER');
    });

    it('should allow valid custom prompts without {{templates}}', async () => {
      const db = await import('../../db');
      (db.getUserSettings as any).mockResolvedValueOnce({
        combatNarrationPrompt: 'You are a gritty noir narrator. Keep it dark and moody.',
      });

      const logs = [makeLog('DAMAGE', { amount: 5, damageType: 'fire', description: 'hit' })];
      const entities = [makeEntity('p1', 'Hero', 'player'), makeEntity('e1', 'Goblin', 'enemy')];

      const result = await computeCombatNarrativePrompts(
        1, logs, 'attack', 'Hero', entities, false, 'p1'
      );
      expect(result!.systemPrompt).toContain('gritty noir');
    });
  });

  describe('enemy turn narration', () => {
    const entities = [
      makeEntity('p1', 'Hero', 'player'),
      makeEntity('e1', 'Dragon', 'enemy', { tacticalRole: 'brute' }),
    ];

    const enemyAttackLogs: CombatLogEntry[] = [
      makeLog('ATTACK_ROLL', {
        actorId: 'e1',
        targetId: 'p1',
        roll: { formula: '1d20+8', result: 22, isCritical: false, isFumble: false },
        success: true,
        description: 'Dragon hits Hero! (22 vs AC 15)',
      }),
      makeLog('DAMAGE', {
        actorId: 'e1',
        targetId: 'p1',
        amount: 15,
        damageType: 'piercing',
        description: 'Dragon deals 15 piercing damage to Hero!',
      }),
    ];

    it('should use third person for enemy and second person for player', async () => {
      const result = await computeCombatNarrativePrompts(
        1, enemyAttackLogs, 'The dragon lunges!', 'Dragon', entities, true, 'p1'
      );
      expect(result!.userPrompt).toContain('ENEMY ACTING: Dragon');
      expect(result!.userPrompt).toContain('THIRD PERSON');
      expect(result!.userPrompt).toContain('"you"');
    });
  });
});
