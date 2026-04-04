/**
 * Tests for enemy AI target scoring logic
 */

import { describe, it, expect } from 'vitest';
import { scoreTargets, scoreThreat, scoreAction } from '../enemy-ai-controller';
import { RangeBand } from '../combat-types';
import type { CombatEntity, BattleState, LegalAction } from '../combat-types';

function createEntity(
  id: string,
  type: 'player' | 'enemy',
  hp: number,
  maxHp: number,
  status: 'ALIVE' | 'UNCONSCIOUS' | 'DEAD' = 'ALIVE',
  overrides?: Partial<CombatEntity>
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
    activeConditions: [],
    rangeTo: {},
    ...overrides,
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

describe('scoreThreat', () => {
  it('should score low-HP targets higher', () => {
    const wounded = createEntity('p1', 'player', 3, 20);   // 15% HP
    const healthy = createEntity('p2', 'player', 18, 20);  // 90% HP
    const all = [wounded, healthy];

    expect(scoreThreat(wounded, all)).toBeGreaterThan(scoreThreat(healthy, all));
  });

  it('should score concentration casters higher', () => {
    const caster = createEntity('p1', 'player', 15, 20, 'ALIVE', {
      activeConditions: [{ name: 'concentrating', appliedAtRound: 1 }],
    });
    const nonCaster = createEntity('p2', 'player', 15, 20);
    const all = [caster, nonCaster];

    expect(scoreThreat(caster, all)).toBeGreaterThan(scoreThreat(nonCaster, all));
  });

  it('should score high-damage dealers higher', () => {
    const bigHitter = createEntity('p1', 'player', 15, 20, 'ALIVE', {
      damageFormula: '2d10+5',
    });
    const lightHitter = createEntity('p2', 'player', 15, 20, 'ALIVE', {
      damageFormula: '1d4+1',
    });
    const all = [bigHitter, lightHitter];

    expect(scoreThreat(bigHitter, all)).toBeGreaterThan(scoreThreat(lightHitter, all));
  });
});

describe('scoreAction — spatial awareness', () => {
  it('should prefer ranged enemy moving away from melee', () => {
    const rangedEnemy = createEntity('e1', 'enemy', 10, 10, 'ALIVE', {
      isRanged: true,
      rangeTo: { p1: RangeBand.MELEE },
    });
    const player = createEntity('p1', 'player', 20, 20);
    const state = createState([rangedEnemy, player]);

    const moveAway: LegalAction = {
      type: 'MOVE', targetId: 'p1', direction: 'away',
      description: 'Move away from p1', resourceCost: 'movement',
    } as LegalAction;
    const moveToward: LegalAction = {
      type: 'MOVE', targetId: 'p1', direction: 'toward',
      description: 'Move toward p1', resourceCost: 'movement',
    } as LegalAction;

    expect(scoreAction(rangedEnemy, moveAway, state)).toBeGreaterThan(
      scoreAction(rangedEnemy, moveToward, state)
    );
  });

  it('should prefer melee enemy closing distance', () => {
    const meleeEnemy = createEntity('e1', 'enemy', 10, 10, 'ALIVE', {
      isRanged: false,
      rangeTo: { p1: RangeBand.FAR },
    });
    const player = createEntity('p1', 'player', 20, 20);
    const state = createState([meleeEnemy, player]);

    const moveToward: LegalAction = {
      type: 'MOVE', targetId: 'p1', direction: 'toward',
      description: 'Move toward p1', resourceCost: 'movement',
    } as LegalAction;
    const moveAway: LegalAction = {
      type: 'MOVE', targetId: 'p1', direction: 'away',
      description: 'Move away from p1', resourceCost: 'movement',
    } as LegalAction;

    expect(scoreAction(meleeEnemy, moveToward, state)).toBeGreaterThan(
      scoreAction(meleeEnemy, moveAway, state)
    );
  });

  it('should recommend DASH for ranged enemy stuck in melee', () => {
    const rangedEnemy = createEntity('e1', 'enemy', 10, 10, 'ALIVE', {
      isRanged: true,
      rangeTo: { p1: RangeBand.MELEE },
    });
    const player = createEntity('p1', 'player', 20, 20);
    const state = createState([rangedEnemy, player]);

    const dash: LegalAction = {
      type: 'DASH', description: 'Dash — double your movement this turn',
      resourceCost: 'action',
    } as LegalAction;

    expect(scoreAction(rangedEnemy, dash, state)).toBeGreaterThan(0);
  });

  it('should recommend DASH for melee enemy when all targets are far', () => {
    const meleeEnemy = createEntity('e1', 'enemy', 10, 10, 'ALIVE', {
      isRanged: false,
      rangeTo: { p1: RangeBand.FAR },
    });
    const player = createEntity('p1', 'player', 20, 20);
    const state = createState([meleeEnemy, player]);

    const dash: LegalAction = {
      type: 'DASH', description: 'Dash — double your movement this turn',
      resourceCost: 'action',
    } as LegalAction;

    expect(scoreAction(meleeEnemy, dash, state)).toBeGreaterThan(0);
  });
});
