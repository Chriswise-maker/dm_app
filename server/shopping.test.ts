import { describe, expect, it } from 'vitest';
import { buyItem, sellItem, getGoldCost } from './shopping';
import type { ActorSheet } from './kernel/actor-sheet';
import type { ActorState } from './kernel/actor-state';
import type { SrdEquipmentEntry } from './shopping';

function makeSheet(equipment: ActorSheet['equipment'] = []): ActorSheet {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    name: 'TestChar',
    ancestry: 'Human',
    characterClass: 'Fighter',
    subclass: null,
    level: 5,
    abilityScores: { str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 8 },
    proficiencyBonus: 3,
    proficiencies: { saves: ['str', 'con'], skills: [], weapons: [], armor: [], tools: [] },
    speeds: { walk: 30 },
    senses: {},
    hitDie: 'd10',
    maxHp: 44,
    ac: { base: 16, source: 'Chain Mail' },
    spellcasting: null,
    equipment,
    features: [],
    background: null,
    feats: [],
  };
}

function makeState(gold: number): ActorState {
  return {
    actorId: '00000000-0000-0000-0000-000000000001',
    hpCurrent: 44,
    hpMax: 44,
    tempHp: 0,
    conditions: [],
    spellSlotsCurrent: {},
    hitDiceCurrent: 5,
    featureUses: {},
    concentration: null,
    deathSaves: { successes: 0, failures: 0 },
    exhaustion: 0,
    gold,
  };
}

const longsword: SrdEquipmentEntry = {
  name: 'Longsword',
  category: 'weapon',
  subcategory: 'martial_melee',
  cost: { amount: 15, unit: 'gp' },
  weight: 3,
  damage: { formula: '1d8', type: 'slashing' },
  properties: ['versatile'],
};

const dagger: SrdEquipmentEntry = {
  name: 'Dagger',
  category: 'weapon',
  cost: { amount: 2, unit: 'gp' },
  weight: 1,
  damage: { formula: '1d4', type: 'piercing' },
  properties: ['finesse', 'light', 'thrown'],
};

const cheapItem: SrdEquipmentEntry = {
  name: 'Torch',
  category: 'adventuring_gear',
  cost: { amount: 1, unit: 'cp' },
  weight: 1,
};

describe('shopping', () => {
  describe('getGoldCost', () => {
    it('converts gp', () => {
      expect(getGoldCost(longsword)).toBe(15);
    });

    it('converts cp to gp', () => {
      expect(getGoldCost(cheapItem)).toBeCloseTo(0.01);
    });

    it('returns 0 for no cost', () => {
      expect(getGoldCost({ name: 'Free', category: 'weapon' })).toBe(0);
    });
  });

  describe('buyItem', () => {
    it('deducts gold and returns item on purchase', () => {
      const sheet = makeSheet();
      const state = makeState(100);
      const result = buyItem(sheet, state, longsword);

      expect(result.success).toBe(true);
      expect(result.goldAfter).toBe(85);
      expect(result.cost).toBe(15);
      expect(result.item.name).toBe('Longsword');
      expect(result.item.type).toBe('weapon');
    });

    it('rejects purchase with insufficient gold', () => {
      const sheet = makeSheet();
      const state = makeState(5);
      const result = buyItem(sheet, state, longsword);

      expect(result.success).toBe(false);
      expect(result.goldAfter).toBe(5);
      expect(result.error).toContain('Not enough gold');
    });

    it('handles exact gold amount', () => {
      const sheet = makeSheet();
      const state = makeState(15);
      const result = buyItem(sheet, state, longsword);

      expect(result.success).toBe(true);
      expect(result.goldAfter).toBe(0);
    });

    it('handles sub-gp costs correctly', () => {
      const sheet = makeSheet();
      const state = makeState(1);
      const result = buyItem(sheet, state, cheapItem);

      expect(result.success).toBe(true);
      expect(result.goldAfter).toBeCloseTo(0.99);
    });
  });

  describe('sellItem', () => {
    it('sells item for half SRD price', () => {
      const sheet = makeSheet([{ name: 'Longsword', type: 'weapon' }]);
      const state = makeState(10);
      const result = sellItem(sheet, state, 'Longsword', longsword);

      expect(result.success).toBe(true);
      expect(result.refund).toBe(7.5);
      expect(result.goldAfter).toBe(17.5);
    });

    it('sells for 0 gold when no SRD entry', () => {
      const sheet = makeSheet([{ name: 'Mystery Sword', type: 'weapon' }]);
      const state = makeState(10);
      const result = sellItem(sheet, state, 'Mystery Sword');

      expect(result.success).toBe(true);
      expect(result.refund).toBe(0);
      expect(result.goldAfter).toBe(10);
    });

    it('rejects selling item not in equipment', () => {
      const sheet = makeSheet([]);
      const state = makeState(10);
      const result = sellItem(sheet, state, 'Longsword', longsword);

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('case-insensitive item matching', () => {
      const sheet = makeSheet([{ name: 'Dagger', type: 'weapon' }]);
      const state = makeState(10);
      const result = sellItem(sheet, state, 'dagger', dagger);

      expect(result.success).toBe(true);
      expect(result.refund).toBe(1);
    });
  });
});
