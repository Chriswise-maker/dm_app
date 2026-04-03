/**
 * Spell Attack Roll Tests
 *
 * Verifies that attack-roll spells (Fire Bolt, Guiding Bolt, etc.)
 * correctly route through AWAIT_ATTACK_ROLL for players and auto-resolve for enemies.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CombatEngineV2 } from '../combat-engine-v2';
import { createPlayerEntity, createEnemyEntity, type CombatEntity, type Spell } from '../combat-types';

function makeDiceRollFn(results: number[]) {
    let i = 0;
    return (formula: string) => {
        const val = results[i] ?? results[results.length - 1];
        i++;
        return { total: val, rolls: [val], formula, isCritical: val === 20, isFumble: val === 1 };
    };
}

function makeFireBoltSpell(): Spell {
    return {
        name: 'Fire Bolt',
        level: 0,
        school: 'evocation',
        castingTime: 'action',
        range: 120,
        isAreaEffect: false,
        halfOnSave: true,
        damageFormula: '2d10',
        damageType: 'fire',
        requiresConcentration: false,
        requiresAttackRoll: true,
        conditions: [],
        description: 'A bolt of fire.',
    };
}

function makeGuidingBoltSpell(): Spell {
    return {
        name: 'Guiding Bolt',
        level: 1,
        school: 'evocation',
        castingTime: 'action',
        range: 120,
        isAreaEffect: false,
        halfOnSave: true,
        damageFormula: '4d6',
        damageType: 'radiant',
        requiresConcentration: false,
        requiresAttackRoll: true,
        conditions: [],
        description: 'A flash of light.',
    };
}

describe('Spell Attack Rolls', () => {
    let engine: CombatEngineV2;
    let player: CombatEntity;
    let enemy: CombatEntity;

    beforeEach(() => {
        player = createPlayerEntity('player-1', 'Wizard', 28, 28, 12, 15, {
            spells: [makeFireBoltSpell(), makeGuidingBoltSpell()],
            spellSlots: { '1': 4 },
            spellSaveDC: 15,
            spellAttackBonus: 7,
            abilityScores: { str: 8, dex: 14, con: 12, int: 18, wis: 12, cha: 10 },
        });

        enemy = createEnemyEntity('goblin-1', 'Goblin', 7, 15, 4, '1d6+2', {
            spells: [makeFireBoltSpell()],
            spellSlots: {},
            spellSaveDC: 13,
            spellAttackBonus: 5,
            abilityScores: { str: 8, dex: 14, con: 10, int: 10, wis: 8, cha: 8 },
        });

        engine = new CombatEngineV2(1);
    });

    it('player Fire Bolt enters AWAIT_ATTACK_ROLL phase', () => {
        // Initiative rolls: player 15, goblin 10
        engine = new CombatEngineV2(1, undefined, makeDiceRollFn([15, 10]));
        engine.prepareCombat([player, enemy]);

        const result = engine.submitAction({
            type: 'CAST_SPELL',
            casterId: 'player-1',
            spellName: 'Fire Bolt',
            targetIds: ['goblin-1'],
        });

        expect(result.success).toBe(true);
        const state = engine.getState();
        expect(state.phase).toBe('AWAIT_ATTACK_ROLL');
        expect(state.pendingAttackRoll).toBeDefined();
        expect(state.pendingAttackRoll!.isSpellAttack).toBe(true);
        expect(state.pendingAttackRoll!.spellName).toBe('Fire Bolt');
        expect(state.pendingAttackRoll!.attackModifier).toBe(7);
    });

    it('resolveAttackRoll with hit applies spell damage', () => {
        // Dice: init player=15, init goblin=10, then spell damage=14
        engine = new CombatEngineV2(1, undefined, makeDiceRollFn([15, 10, 14]));
        engine.prepareCombat([player, enemy]);

        engine.submitAction({
            type: 'CAST_SPELL',
            casterId: 'player-1',
            spellName: 'Fire Bolt',
            targetIds: ['goblin-1'],
        });

        // Roll 18 on d20 → 18+7=25 vs AC 15 → hit
        const result = engine.resolveAttackRoll(18);

        expect(result.success).toBe(true);
        const state = engine.getState();
        expect(state.phase).not.toBe('AWAIT_ATTACK_ROLL');
        // Goblin should have taken damage
        const goblin = state.entities.find(e => e.id === 'goblin-1')!;
        expect(goblin.hp).toBeLessThan(7);
    });

    it('resolveAttackRoll with miss does no damage', () => {
        engine = new CombatEngineV2(1, undefined, makeDiceRollFn([15, 10]));
        engine.prepareCombat([player, enemy]);

        engine.submitAction({
            type: 'CAST_SPELL',
            casterId: 'player-1',
            spellName: 'Fire Bolt',
            targetIds: ['goblin-1'],
        });

        // Roll 2 on d20 → 2+7=9 vs AC 15 → miss
        const result = engine.resolveAttackRoll(2);

        expect(result.success).toBe(true);
        const state = engine.getState();
        const goblin = state.entities.find(e => e.id === 'goblin-1')!;
        expect(goblin.hp).toBe(7); // No damage
    });

    it('enemy spell attack auto-resolves without phase pause', () => {
        // Give enemy higher fixed initiative so they go first
        const fastEnemy = { ...enemy, initiative: 20 };
        const slowPlayer = { ...player, initiative: 5 };
        // Dice: attack d20=18, damage=14
        engine = new CombatEngineV2(1, undefined, makeDiceRollFn([18, 14]));
        engine.prepareCombat([slowPlayer, fastEnemy]);

        // It's the enemy's turn (higher initiative)
        const state = engine.getState();
        expect(state.turnOrder[state.turnIndex]).toBe('goblin-1');

        const result = engine.submitAction({
            type: 'CAST_SPELL',
            casterId: 'goblin-1',
            spellName: 'Fire Bolt',
            targetIds: ['player-1'],
        });

        expect(result.success).toBe(true);
        // Should NOT enter AWAIT_ATTACK_ROLL — enemy auto-resolves
        const stateAfter = engine.getState();
        expect(stateAfter.phase).not.toBe('AWAIT_ATTACK_ROLL');
        // Player should have taken damage (18+5=23 vs AC 12 = hit)
        const playerAfter = stateAfter.entities.find(e => e.id === 'player-1')!;
        expect(playerAfter.hp).toBeLessThan(28);
    });

    it('Guiding Bolt consumes a spell slot', () => {
        engine = new CombatEngineV2(1, undefined, makeDiceRollFn([15, 10]));
        engine.prepareCombat([player, enemy]);

        engine.submitAction({
            type: 'CAST_SPELL',
            casterId: 'player-1',
            spellName: 'Guiding Bolt',
            targetIds: ['goblin-1'],
        });

        // Check slot was consumed
        const state = engine.getState();
        const playerEntity = state.entities.find(e => e.id === 'player-1')!;
        expect(playerEntity.spellSlots['1']).toBe(3); // Was 4, now 3
    });
});
