import { describe, it, expect } from 'vitest';
import { ActorSheetSchema, ActorStateSchema, deriveInitialState } from '../index';
import type { ActorSheet } from '../index';
import { randomUUID } from 'crypto';

// Silas Gravemourn — Level 5 Necromancy Wizard
const silasSheet: ActorSheet = {
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
    { name: 'Arcane Recovery', source: 'Wizard', description: 'Recover spell slots on short rest', usesMax: 1, rechargeOn: 'long_rest' },
    { name: 'Grim Harvest', source: 'Necromancy', description: 'Regain HP when killing with spells' },
  ],
  background: 'Sage',
  feats: [],
};

describe('ActorSheetSchema', () => {
  it('validates a complete wizard sheet (Silas Gravemourn)', () => {
    const result = ActorSheetSchema.safeParse(silasSheet);
    expect(result.success).toBe(true);
  });

  it('rejects level 0', () => {
    const result = ActorSheetSchema.safeParse({ ...silasSheet, level: 0 });
    expect(result.success).toBe(false);
  });

  it('rejects negative HP', () => {
    const result = ActorSheetSchema.safeParse({ ...silasSheet, maxHp: -1 });
    expect(result.success).toBe(false);
  });

  it('rejects missing abilityScores', () => {
    const { abilityScores, ...noScores } = silasSheet;
    const result = ActorSheetSchema.safeParse(noScores);
    expect(result.success).toBe(false);
  });

  it('accepts a non-caster with null spellcasting', () => {
    const fighter = { ...silasSheet, characterClass: 'Fighter', spellcasting: null };
    const result = ActorSheetSchema.safeParse(fighter);
    expect(result.success).toBe(true);
  });
});

describe('ActorStateSchema', () => {
  it('validates a valid state', () => {
    const state = {
      actorId: silasSheet.id,
      hpCurrent: 28,
      hpMax: 28,
      tempHp: 0,
      conditions: [],
      spellSlotsCurrent: { '1': 2, '2': 3, '3': 2 },
      hitDiceCurrent: 5,
      featureUses: { 'Arcane Recovery': 0 },
      concentration: { spellName: 'Mage Armor', saveDC: 13 },
      deathSaves: { successes: 0, failures: 0 },
      exhaustion: 0,
    };
    const result = ActorStateSchema.safeParse(state);
    expect(result.success).toBe(true);
  });
});

describe('deriveInitialState', () => {
  it('derives correct initial state from a wizard sheet', () => {
    const state = deriveInitialState(silasSheet);

    expect(state.actorId).toBe(silasSheet.id);
    expect(state.hpCurrent).toBe(28);
    expect(state.hpMax).toBe(28);
    expect(state.tempHp).toBe(0);
    expect(state.conditions).toEqual([]);
    expect(state.spellSlotsCurrent).toEqual({ '1': 4, '2': 3, '3': 2 });
    expect(state.hitDiceCurrent).toBe(5);
    expect(state.featureUses).toEqual({ 'Arcane Recovery': 1 });
    expect(state.concentration).toBeNull();
    expect(state.deathSaves).toEqual({ successes: 0, failures: 0 });
    expect(state.exhaustion).toBe(0);
  });

  it('derives correct state for a non-caster', () => {
    const fighter = { ...silasSheet, spellcasting: null, features: [] };
    const state = deriveInitialState(fighter);

    expect(state.spellSlotsCurrent).toEqual({});
    expect(state.featureUses).toEqual({});
  });
});
