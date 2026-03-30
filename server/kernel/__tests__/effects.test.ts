import { describe, it, expect } from 'vitest';
import type { EffectDefinition, EffectInstance } from '../effect-types';
import { getActiveModifiers, tickEffects, resolveConcentration } from '../effect-pipeline';

const rageDefinition: EffectDefinition = {
  id: 'rage',
  name: 'Rage',
  source: 'class_feature',
  duration: { type: 'rounds', value: 10 },
  requiresConcentration: false,
  modifiers: [
    { type: 'damage_resistance', damageType: 'bludgeoning' },
    { type: 'damage_resistance', damageType: 'slashing' },
    { type: 'damage_resistance', damageType: 'piercing' },
    { type: 'extra_damage', formula: '2', damageType: 'melee' },
  ],
};

function makeInstance(overrides: Partial<EffectInstance> = {}): EffectInstance {
  return {
    id: 'inst-1',
    definitionId: 'rage',
    sourceActorId: 'actor-1',
    targetActorId: 'actor-1',
    remainingRounds: 10,
    appliedAtRound: 1,
    ...overrides,
  };
}

describe('Effect pipeline', () => {
  it('collects all active modifiers from effect instances', () => {
    const defs = new Map<string, EffectDefinition>([['rage', rageDefinition]]);
    const instances = [makeInstance()];
    const mods = getActiveModifiers(instances, defs);
    expect(mods).toHaveLength(4);
    expect(mods[0]).toEqual({ type: 'damage_resistance', damageType: 'bludgeoning' });
    expect(mods[3]).toEqual({ type: 'extra_damage', formula: '2', damageType: 'melee' });
  });

  it('decrements duration and filters out expired effects', () => {
    const inst = makeInstance({ remainingRounds: 2 });
    const after1 = tickEffects([inst]);
    expect(after1).toHaveLength(1);
    expect(after1[0].remainingRounds).toBe(1);

    const after2 = tickEffects(after1);
    expect(after2).toHaveLength(0);
  });

  it('replaces concentration effect when a new one is cast', () => {
    const shieldOfFaith: EffectDefinition = {
      id: 'shield-of-faith',
      name: 'Shield of Faith',
      source: 'spell',
      duration: { type: 'minutes', value: 10 },
      requiresConcentration: true,
      modifiers: [{ type: 'ac_bonus', value: 2 }],
    };

    const bless: EffectDefinition = {
      id: 'bless',
      name: 'Bless',
      source: 'spell',
      duration: { type: 'minutes', value: 1 },
      requiresConcentration: true,
      modifiers: [{ type: 'save_bonus', stat: 'all', value: 4 }],
    };

    const defs = new Map<string, EffectDefinition>([
      ['shield-of-faith', shieldOfFaith],
      ['bless', bless],
    ]);

    const instances: EffectInstance[] = [
      makeInstance({ id: 'inst-sof', definitionId: 'shield-of-faith', remainingRounds: null }),
    ];

    const updated = resolveConcentration(instances, defs, bless);
    expect(updated).toHaveLength(0); // Shield of Faith removed
  });

  it('keeps permanent effects (null duration) through ticks', () => {
    const inst = makeInstance({ remainingRounds: null });
    const after1 = tickEffects([inst]);
    expect(after1).toHaveLength(1);
    expect(after1[0].remainingRounds).toBeNull();

    const after2 = tickEffects(after1);
    expect(after2).toHaveLength(1);
    expect(after2[0].remainingRounds).toBeNull();
  });
});
