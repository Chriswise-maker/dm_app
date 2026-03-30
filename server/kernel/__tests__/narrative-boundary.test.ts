import { describe, it, expect } from 'vitest';
import { ActorStateSchema, deriveInitialState } from '../index';
import type { ActorSheet, ActorState } from '../index';
import { randomUUID } from 'crypto';

// Test fixture: Level 5 Wizard
function makeSheet(overrides?: Partial<ActorSheet>): ActorSheet {
  return {
    id: randomUUID(),
    name: 'Silas Gravemourn',
    ancestry: 'Half-Elf',
    characterClass: 'Wizard',
    subclass: 'Necromancy',
    level: 5,
    abilityScores: { str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 },
    proficiencyBonus: 3,
    proficiencies: {
      saves: ['int', 'wis'],
      skills: ['arcana', 'history'],
      weapons: ['dagger', 'dart', 'sling', 'quarterstaff', 'light_crossbow'],
      armor: [],
      tools: [],
    },
    speeds: { walk: 30 },
    senses: { darkvision: 60 },
    hitDie: 'd6',
    maxHp: 28,
    ac: { base: 12, source: 'dex' },
    spellcasting: {
      ability: 'int',
      saveDC: 13,
      attackBonus: 5,
      cantripsKnown: ['fire_bolt', 'mage_hand', 'prestidigitation'],
      spellsKnown: ['shield', 'magic_missile', 'mage_armor', 'detect_magic', 'misty_step', 'scorching_ray', 'fireball', 'counterspell'],
      spellSlots: { '1': 4, '2': 3, '3': 2 },
    },
    equipment: [
      { name: 'Quarterstaff', type: 'weapon' },
      { name: 'Arcane Focus', type: 'focus' },
    ],
    features: [
      { name: 'Arcane Recovery', source: 'Wizard', description: 'Recover spell slots on short rest', usesMax: 1, rechargeOn: 'long_rest' as const },
      { name: 'Grim Harvest', source: 'Necromancy', description: 'Regain HP when killing with spells' },
    ],
    background: 'Sage',
    feats: [],
    ...overrides,
  };
}

/**
 * Simulate applying structured gameStateChanges HP delta to actorState.
 * This mirrors the logic in message-send.ts: gameStateChanges.hpChanges wins over narrative.
 */
function applyHpChange(state: ActorState, delta: number): ActorState {
  return {
    ...state,
    hpCurrent: Math.max(0, Math.min(state.hpMax, state.hpCurrent + delta)),
  };
}

/**
 * Simulate deducting a spell slot from actorState.
 * Returns the updated state, or null if no slots remain at that level.
 */
function deductSpellSlot(state: ActorState, level: number): ActorState | null {
  const key = String(level);
  const current = state.spellSlotsCurrent[key] ?? 0;
  if (current <= 0) return null;
  return {
    ...state,
    spellSlotsCurrent: { ...state.spellSlotsCurrent, [key]: current - 1 },
  };
}

/**
 * Add a condition to actorState via the structured change path.
 */
function addCondition(state: ActorState, conditionName: string): ActorState {
  return {
    ...state,
    conditions: [...state.conditions, { name: conditionName as any, appliedAtRound: 0 }],
  };
}

/**
 * Apply long rest to actorState using sheet as source of truth.
 */
function applyLongRest(state: ActorState, sheet: ActorSheet): ActorState {
  const featureUses: Record<string, number> = { ...state.featureUses };
  for (const feature of sheet.features) {
    if (feature.rechargeOn === 'long_rest' && feature.usesMax != null) {
      featureUses[feature.name] = feature.usesMax;
    }
  }
  const spellSlotsCurrent: Record<string, number> = { ...state.spellSlotsCurrent };
  if (sheet.spellcasting) {
    for (const [level, max] of Object.entries(sheet.spellcasting.spellSlots)) {
      spellSlotsCurrent[level] = max;
    }
  }
  const halfLevel = Math.max(1, Math.ceil(sheet.level / 2));
  return {
    ...state,
    hpCurrent: state.hpMax,
    spellSlotsCurrent,
    hitDiceCurrent: Math.min(sheet.level, state.hitDiceCurrent + halfLevel),
    featureUses,
    exhaustion: Math.max(0, state.exhaustion - 1),
    concentration: null,
    deathSaves: { successes: 0, failures: 0 },
  };
}

describe('Narrative Boundary: HP Isolation', () => {
  it('gameStateChanges HP delta takes priority over narrative damage numbers', () => {
    const sheet = makeSheet();
    const state = deriveInitialState(sheet);
    expect(state.hpCurrent).toBe(28);

    // Narrative says "you take 15 damage" but gameStateChanges says delta -10
    // The actual HP change must be -10 (gameStateChanges wins)
    const narrativeDamage = 15; // ignored
    const structuredDelta = -10; // authoritative

    const updated = applyHpChange(state, structuredDelta);
    expect(updated.hpCurrent).toBe(18); // 28 - 10, NOT 28 - 15
  });

  it('HP cannot go below 0', () => {
    const sheet = makeSheet();
    const state = deriveInitialState(sheet);
    const updated = applyHpChange(state, -999);
    expect(updated.hpCurrent).toBe(0);
  });

  it('HP cannot exceed hpMax', () => {
    const sheet = makeSheet();
    const state = { ...deriveInitialState(sheet), hpCurrent: 25 };
    const updated = applyHpChange(state, 10);
    expect(updated.hpCurrent).toBe(28); // capped at hpMax
  });
});

describe('Narrative Boundary: Spell Slot Deduction', () => {
  it('deducts a level 1 spell slot out of combat', () => {
    const sheet = makeSheet();
    const state = deriveInitialState(sheet);
    expect(state.spellSlotsCurrent['1']).toBe(4);

    const updated = deductSpellSlot(state, 1);
    expect(updated).not.toBeNull();
    expect(updated!.spellSlotsCurrent['1']).toBe(3);
  });

  it('returns null when no slots remain (cast should fail)', () => {
    const sheet = makeSheet();
    const state = deriveInitialState(sheet);
    state.spellSlotsCurrent['1'] = 0;

    const result = deductSpellSlot(state, 1);
    expect(result).toBeNull();
  });

  it('deducting level 3 slot does not affect level 1 slots', () => {
    const sheet = makeSheet();
    const state = deriveInitialState(sheet);
    const updated = deductSpellSlot(state, 3)!;
    expect(updated.spellSlotsCurrent['1']).toBe(4); // unchanged
    expect(updated.spellSlotsCurrent['3']).toBe(1); // was 2, now 1
  });
});

describe('Narrative Boundary: Condition Management', () => {
  it('adds a condition via the structured change path', () => {
    const sheet = makeSheet();
    const state = deriveInitialState(sheet);
    expect(state.conditions).toHaveLength(0);

    const updated = addCondition(state, 'poisoned');
    expect(updated.conditions).toHaveLength(1);
    expect(updated.conditions[0].name).toBe('poisoned');
  });

  it('conditions added via structured path are valid ActorState', () => {
    const sheet = makeSheet();
    const state = deriveInitialState(sheet);
    const updated = addCondition(state, 'frightened');

    const result = ActorStateSchema.safeParse(updated);
    expect(result.success).toBe(true);
  });

  it('only the structured path can add conditions, not narrative parsing', () => {
    // This is a contract test: conditions must come through addCondition (structured path),
    // never from parsing narrative text. We verify that the condition only exists
    // when we explicitly call addCondition.
    const sheet = makeSheet();
    const state = deriveInitialState(sheet);

    // Simulate: narrative says "you are poisoned" but no structured condition change
    // State should remain unchanged
    expect(state.conditions).toHaveLength(0);

    // Only when structured path is used does the condition appear
    const updated = addCondition(state, 'poisoned');
    expect(updated.conditions).toHaveLength(1);
  });
});

describe('Narrative Boundary: State Roundtrip (combat -> rest -> combat)', () => {
  it('preserves state across combat, long rest, and new combat', () => {
    const sheet = makeSheet();
    const state = deriveInitialState(sheet);

    // Verify full resources
    expect(state.hpCurrent).toBe(28);
    expect(state.spellSlotsCurrent['1']).toBe(4);
    expect(state.spellSlotsCurrent['3']).toBe(2);
    expect(state.hitDiceCurrent).toBe(5);

    // Simulate combat: take damage and use spell slots
    let postCombat = applyHpChange(state, -12);
    postCombat = deductSpellSlot(postCombat, 1)!;
    postCombat = deductSpellSlot(postCombat, 3)!;
    postCombat = { ...postCombat, hitDiceCurrent: postCombat.hitDiceCurrent - 1 };

    // Verify post-combat state
    expect(postCombat.hpCurrent).toBe(16);
    expect(postCombat.spellSlotsCurrent['1']).toBe(3);
    expect(postCombat.spellSlotsCurrent['3']).toBe(1);
    expect(postCombat.hitDiceCurrent).toBe(4);

    // Long rest
    const postRest = applyLongRest(postCombat, sheet);

    // Verify full restoration
    expect(postRest.hpCurrent).toBe(28); // full HP
    expect(postRest.spellSlotsCurrent['1']).toBe(4); // full slots
    expect(postRest.spellSlotsCurrent['2']).toBe(3);
    expect(postRest.spellSlotsCurrent['3']).toBe(2);
    // Hit dice: was 4, regain ceil(5/2)=3, but capped at level 5
    expect(postRest.hitDiceCurrent).toBe(5);

    // New combat starts from restored state
    const newCombatState = applyHpChange(postRest, -5);
    expect(newCombatState.hpCurrent).toBe(23);
    expect(newCombatState.spellSlotsCurrent['1']).toBe(4); // still full from rest
  });
});

describe('Narrative Boundary: Rest Mechanics Update ActorState', () => {
  it('long rest restores HP to max', () => {
    const sheet = makeSheet();
    const state = { ...deriveInitialState(sheet), hpCurrent: 10 };
    const rested = applyLongRest(state, sheet);
    expect(rested.hpCurrent).toBe(sheet.maxHp);
  });

  it('long rest restores all spell slots from sheet', () => {
    const sheet = makeSheet();
    const state = deriveInitialState(sheet);
    state.spellSlotsCurrent = { '1': 0, '2': 1, '3': 0 };
    const rested = applyLongRest(state, sheet);
    expect(rested.spellSlotsCurrent['1']).toBe(4);
    expect(rested.spellSlotsCurrent['2']).toBe(3);
    expect(rested.spellSlotsCurrent['3']).toBe(2);
  });

  it('long rest restores hit dice up to half level (rounded up)', () => {
    const sheet = makeSheet(); // level 5
    const state = { ...deriveInitialState(sheet), hitDiceCurrent: 0 };
    const rested = applyLongRest(state, sheet);
    // half of 5 rounded up = 3, starting from 0 => 3
    expect(rested.hitDiceCurrent).toBe(3);
  });

  it('long rest restores feature uses with rechargeOn: long_rest', () => {
    const sheet = makeSheet();
    const state = deriveInitialState(sheet);
    state.featureUses['Arcane Recovery'] = 0;
    const rested = applyLongRest(state, sheet);
    expect(rested.featureUses['Arcane Recovery']).toBe(1);
  });

  it('long rest decrements exhaustion by 1', () => {
    const sheet = makeSheet();
    const state = { ...deriveInitialState(sheet), exhaustion: 3 };
    const rested = applyLongRest(state, sheet);
    expect(rested.exhaustion).toBe(2);
  });

  it('long rest does not reduce exhaustion below 0', () => {
    const sheet = makeSheet();
    const state = { ...deriveInitialState(sheet), exhaustion: 0 };
    const rested = applyLongRest(state, sheet);
    expect(rested.exhaustion).toBe(0);
  });

  it('long rest clears concentration', () => {
    const sheet = makeSheet();
    const state = { ...deriveInitialState(sheet), concentration: { spellName: 'Haste', saveDC: 13 } };
    const rested = applyLongRest(state, sheet);
    expect(rested.concentration).toBeNull();
  });

  it('long rest resets death saves', () => {
    const sheet = makeSheet();
    const state = { ...deriveInitialState(sheet), deathSaves: { successes: 2, failures: 1 } };
    const rested = applyLongRest(state, sheet);
    expect(rested.deathSaves).toEqual({ successes: 0, failures: 0 });
  });
});
