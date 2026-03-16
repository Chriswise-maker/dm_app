/**
 * Tests for enemy AI target scoring logic
 */

import { describe, it, expect } from 'vitest';
import { scoreTargets } from '../enemy-ai-controller';
import type { CombatEntity, BattleState } from '../combat-types';

function createEntity(
  id: string,
  type: 'player' | 'enemy',
  hp: number,
  maxHp: number,
  status: 'ALIVE' | 'UNCONSCIOUS' | 'DEAD' = 'ALIVE'
): CombatEntity {
  return {
    id,
    name: id,
    type,
    hp,
    maxHp,
    baseAC: 12,
    status,
    conditions: [],
    rangeTo: {},
  } as CombatEntity;
}

function createState(entities: CombatEntity[]): BattleState {
  return {
    id: 'battle-1',
    sessionId: 1,
    entities,
    turnOrder: entities.map((e) => e.id),
    round: 1,
    turnIndex: 0,
    phase: 'ACTIVE',
    log: [],
    history: [],
    settings: { aiModels: { minionTier: 'gpt-4o-mini', bossTier: 'gpt-4o' }, debugMode: false },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  } as BattleState;
}

describe('scoreTargets', () => {
  it('should rank low-HP targets higher', () => {
    const enemy = createEntity('e1', 'enemy', 10, 10);
    const state = createState([
      enemy,
      createEntity('p1', 'player', 25, 30), // 83%
      createEntity('p2', 'player', 3, 20),  // 15% - wounded
      createEntity('p3', 'player', 10, 15), // 67%
    ]);

    const ranked = scoreTargets(enemy, state);
    expect(ranked.map((t) => t.id)).toEqual(['p2', 'p3', 'p1']);
  });

  it('should rank unconscious targets last (exclude when ALIVE targets exist)', () => {
    const enemy = createEntity('e1', 'enemy', 10, 10);
    const state = createState([
      enemy,
      createEntity('p1', 'player', 0, 30, 'UNCONSCIOUS'),
      createEntity('p2', 'player', 5, 20),
    ]);

    const ranked = scoreTargets(enemy, state);
    // Only ALIVE targets when any exist; p1 (unconscious) is excluded
    expect(ranked.map((t) => t.id)).toEqual(['p2']);
  });

  it('should handle single target', () => {
    const enemy = createEntity('e1', 'enemy', 10, 10);
    const state = createState([
      enemy,
      createEntity('p1', 'player', 10, 20),
    ]);

    const ranked = scoreTargets(enemy, state);
    expect(ranked).toHaveLength(1);
    expect(ranked[0].id).toBe('p1');
  });

  it('should include unconscious only when no ALIVE targets remain', () => {
    const enemy = createEntity('e1', 'enemy', 10, 10);
    const state = createState([
      enemy,
      createEntity('p1', 'player', 0, 30, 'UNCONSCIOUS'),
      createEntity('p2', 'player', 0, 20, 'UNCONSCIOUS'),
    ]);

    const ranked = scoreTargets(enemy, state);
    expect(ranked.length).toBe(2);
    expect(ranked.every((t) => t.status === 'UNCONSCIOUS')).toBe(true);
  });

  it('should exclude dead and fled entities', () => {
    const enemy = createEntity('e1', 'enemy', 10, 10);
    const p1 = createEntity('p1', 'player', 10, 20);
    const p2 = createEntity('p2', 'player', 0, 20, 'DEAD');
    const p3 = createEntity('p3', 'player', 0, 20, 'FLED');
    const state = createState([enemy, p1, p2, p3]);

    const ranked = scoreTargets(enemy, state);
    expect(ranked).toHaveLength(1);
    expect(ranked[0].id).toBe('p1');
  });
});
