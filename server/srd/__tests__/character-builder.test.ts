import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import { ContentPackLoader } from '../content-pack';
import { buildActorSheet, type CharacterBuildInput } from '../character-builder';

const SRD_DIR = path.resolve(__dirname, '../../../data/srd-2014');

describe('character-builder', () => {
  let loader: ContentPackLoader;

  beforeAll(() => {
    loader = new ContentPackLoader();
    loader.loadPack(SRD_DIR);
  });

  function buildInput(overrides: Partial<CharacterBuildInput>): CharacterBuildInput {
    return {
      name: 'Test Character',
      characterClass: 'Fighter',
      ancestry: 'Human',
      level: 1,
      abilityScores: { str: 15, dex: 13, con: 14, int: 10, wis: 12, cha: 8 },
      hpMax: 12,
      ac: 16,
      ...overrides,
    };
  }

  describe('Wizard level 5', () => {
    it('has INT/WIS save proficiencies', () => {
      const sheet = buildActorSheet(buildInput({
        name: 'Gandalf',
        characterClass: 'Wizard',
        level: 5,
        abilityScores: { str: 8, dex: 14, con: 12, int: 18, wis: 12, cha: 10 },
        hpMax: 28,
        ac: 12,
      }), loader);

      expect(sheet.proficiencies.saves).toContain('int');
      expect(sheet.proficiencies.saves).toContain('wis');
    });

    it('has correct spell slots {1:4, 2:3, 3:2}', () => {
      const sheet = buildActorSheet(buildInput({
        characterClass: 'Wizard',
        level: 5,
        abilityScores: { str: 8, dex: 14, con: 12, int: 18, wis: 12, cha: 10 },
        hpMax: 28,
        ac: 12,
      }), loader);

      expect(sheet.spellcasting).not.toBeNull();
      expect(sheet.spellcasting!.spellSlots).toEqual({ '1': 4, '2': 3, '3': 2 });
    });

    it('has Quarterstaff in equipment', () => {
      const sheet = buildActorSheet(buildInput({
        characterClass: 'Wizard',
        level: 5,
        abilityScores: { str: 8, dex: 14, con: 12, int: 18, wis: 12, cha: 10 },
        hpMax: 28,
        ac: 12,
      }), loader);

      expect(sheet.equipment.some(e => e.name === 'Quarterstaff')).toBe(true);
    });

    it('has non-empty cantripsKnown', () => {
      const sheet = buildActorSheet(buildInput({
        characterClass: 'Wizard',
        level: 5,
        abilityScores: { str: 8, dex: 14, con: 12, int: 18, wis: 12, cha: 10 },
        hpMax: 28,
        ac: 12,
      }), loader);

      expect(sheet.spellcasting!.cantripsKnown.length).toBeGreaterThan(0);
      expect(sheet.spellcasting!.cantripsKnown).toContain('Fire Bolt');
    });

    it('has Fireball in spellsKnown at level 5', () => {
      const sheet = buildActorSheet(buildInput({
        characterClass: 'Wizard',
        level: 5,
        abilityScores: { str: 8, dex: 14, con: 12, int: 18, wis: 12, cha: 10 },
        hpMax: 28,
        ac: 12,
      }), loader);

      expect(sheet.spellcasting!.spellsKnown).toContain('Fireball');
    });

    it('computes correct saveDC and attackBonus', () => {
      const sheet = buildActorSheet(buildInput({
        characterClass: 'Wizard',
        level: 5,
        abilityScores: { str: 8, dex: 14, con: 12, int: 18, wis: 12, cha: 10 },
        hpMax: 28,
        ac: 12,
      }), loader);

      // profBonus=3, INT mod=+4 → saveDC=8+3+4=15, attackBonus=3+4=7
      expect(sheet.spellcasting!.saveDC).toBe(15);
      expect(sheet.spellcasting!.attackBonus).toBe(7);
    });
  });

  describe('Fighter level 3', () => {
    it('has no spellcasting', () => {
      const sheet = buildActorSheet(buildInput({
        characterClass: 'Fighter',
        level: 3,
      }), loader);

      expect(sheet.spellcasting).toBeNull();
    });

    it('has STR/CON save proficiencies', () => {
      const sheet = buildActorSheet(buildInput({
        characterClass: 'Fighter',
        level: 3,
      }), loader);

      expect(sheet.proficiencies.saves).toContain('str');
      expect(sheet.proficiencies.saves).toContain('con');
    });

    it('has Longsword in equipment', () => {
      const sheet = buildActorSheet(buildInput({
        characterClass: 'Fighter',
        level: 3,
      }), loader);

      expect(sheet.equipment.some(e => e.name === 'Longsword')).toBe(true);
    });

    it('does NOT have Extra Attack at level 3', () => {
      const sheet = buildActorSheet(buildInput({
        characterClass: 'Fighter',
        level: 3,
      }), loader);

      expect(sheet.features.some(f => f.name === 'Extra Attack')).toBe(false);
    });

    it('has Extra Attack at level 5', () => {
      const sheet = buildActorSheet(buildInput({
        characterClass: 'Fighter',
        level: 5,
        hpMax: 40,
      }), loader);

      expect(sheet.features.some(f => f.name === 'Extra Attack')).toBe(true);
    });
  });

  describe('Rogue level 5', () => {
    it('has Sneak Attack in features', () => {
      const sheet = buildActorSheet(buildInput({
        characterClass: 'Rogue',
        level: 5,
        abilityScores: { str: 10, dex: 16, con: 12, int: 13, wis: 10, cha: 14 },
        hpMax: 33,
        ac: 15,
      }), loader);

      expect(sheet.features.some(f => f.name === 'Sneak Attack')).toBe(true);
    });

    it('has Rapier in equipment', () => {
      const sheet = buildActorSheet(buildInput({
        characterClass: 'Rogue',
        level: 5,
        abilityScores: { str: 10, dex: 16, con: 12, int: 13, wis: 10, cha: 14 },
        hpMax: 33,
        ac: 15,
      }), loader);

      expect(sheet.equipment.some(e => e.name === 'Rapier')).toBe(true);
    });

    it('has DEX in save proficiencies', () => {
      const sheet = buildActorSheet(buildInput({
        characterClass: 'Rogue',
        level: 5,
        abilityScores: { str: 10, dex: 16, con: 12, int: 13, wis: 10, cha: 14 },
        hpMax: 33,
        ac: 15,
      }), loader);

      expect(sheet.proficiencies.saves).toContain('dex');
    });
  });

  describe('Barbarian Unarmored Defense', () => {
    it('computes AC from 10 + DEX + CON', () => {
      const sheet = buildActorSheet(buildInput({
        characterClass: 'Barbarian',
        level: 1,
        abilityScores: { str: 16, dex: 14, con: 14, int: 8, wis: 12, cha: 10 },
        hpMax: 14,
        ac: 10, // input AC is lower than unarmored
      }), loader);

      // 10 + DEX(+2) + CON(+2) = 14
      expect(sheet.ac.base).toBe(14);
      expect(sheet.ac.source).toBe('unarmored_defense');
    });
  });

  describe('spell choices override', () => {
    it('uses provided spellChoices instead of defaults', () => {
      const sheet = buildActorSheet(buildInput({
        characterClass: 'Wizard',
        level: 5,
        abilityScores: { str: 8, dex: 14, con: 12, int: 18, wis: 12, cha: 10 },
        hpMax: 28,
        ac: 12,
        spellChoices: {
          cantrips: ['Ray of Frost'],
          spells: ['Burning Hands'],
        },
      }), loader);

      expect(sheet.spellcasting!.cantripsKnown).toEqual(['Ray of Frost']);
      expect(sheet.spellcasting!.spellsKnown).toEqual(['Burning Hands']);
    });
  });

  describe('proficiency bonus', () => {
    it('is 2 at level 1', () => {
      const sheet = buildActorSheet(buildInput({ level: 1 }), loader);
      expect(sheet.proficiencyBonus).toBe(2);
    });

    it('is 3 at level 5', () => {
      const sheet = buildActorSheet(buildInput({ level: 5, hpMax: 40 }), loader);
      expect(sheet.proficiencyBonus).toBe(3);
    });

    it('is 4 at level 9', () => {
      const sheet = buildActorSheet(buildInput({ level: 9, hpMax: 70 }), loader);
      expect(sheet.proficiencyBonus).toBe(4);
    });
  });

  describe('Dwarf ancestry', () => {
    it('has walk speed 25', () => {
      const sheet = buildActorSheet(buildInput({ ancestry: 'Dwarf' }), loader);
      expect(sheet.speeds.walk).toBe(25);
    });

    it('has darkvision', () => {
      const sheet = buildActorSheet(buildInput({ ancestry: 'Dwarf' }), loader);
      expect(sheet.senses.darkvision).toBe(60);
    });
  });
});
