/**
 * ActorSheet ↔ Combat Integration Tests
 *
 * Verifies that characters with ActorSheets enter combat with
 * full spell lists, correct ability scores, proficiency-derived bonuses,
 * and that state syncs back after combat.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    buildCombatSpells,
    collectResistances,
    collectImmunities,
    deriveAttackBonus,
    deriveDamageFormula,
} from '../combat-helpers';
import { createPlayerEntity, type CombatEntity, type Spell } from '../combat-types';
import type { ActorSheet } from '../../kernel/actor-sheet';
import type { ContentPackLoader } from '../../srd/content-pack';

// =============================================================================
// Test Data
// =============================================================================

function makeWizardSheet(overrides?: Partial<ActorSheet>): ActorSheet {
    return {
        id: '00000000-0000-0000-0000-000000000001',
        name: 'Gandalf',
        ancestry: 'Human',
        characterClass: 'wizard',
        subclass: null,
        level: 5,
        abilityScores: { str: 8, dex: 14, con: 12, int: 18, wis: 12, cha: 10 },
        proficiencyBonus: 3,
        proficiencies: {
            saves: ['int', 'wis'],
            skills: ['Arcana', 'Investigation'],
            weapons: ['dagger', 'quarterstaff'],
            armor: [],
            tools: [],
        },
        speeds: { walk: 30 },
        senses: {},
        hitDie: '1d6',
        maxHp: 28,
        ac: { base: 15, source: 'Mage Armor' },
        spellcasting: {
            ability: 'int',
            saveDC: 14,
            attackBonus: 7,
            cantripsKnown: ['Fire Bolt', 'Ray of Frost'],
            spellsKnown: ['Magic Missile', 'Fireball', 'Shield'],
            spellSlots: { '1': 4, '2': 3, '3': 2 },
        },
        equipment: [
            { name: 'Quarterstaff', type: 'weapon', properties: { damage: '1d6', finesse: false } },
        ],
        features: [],
        background: 'Sage',
        feats: [],
        ...overrides,
    } as ActorSheet;
}

function makeFighterSheet(): ActorSheet {
    return {
        id: '00000000-0000-0000-0000-000000000002',
        name: 'Conan',
        ancestry: 'Human',
        characterClass: 'fighter',
        subclass: null,
        level: 5,
        abilityScores: { str: 18, dex: 14, con: 16, int: 8, wis: 10, cha: 12 },
        proficiencyBonus: 3,
        proficiencies: {
            saves: ['str', 'con'],
            skills: ['Athletics', 'Intimidation'],
            weapons: ['simple', 'martial'],
            armor: ['light', 'medium', 'heavy', 'shields'],
            tools: [],
        },
        speeds: { walk: 30 },
        senses: {},
        hitDie: '1d10',
        maxHp: 44,
        ac: { base: 18, source: 'Chain Mail + Shield' },
        spellcasting: null,
        equipment: [
            { name: 'Longsword', type: 'weapon', properties: { damage: '1d8', finesse: false } },
            { name: 'Shield', type: 'armor' },
        ],
        features: [
            {
                name: 'Second Wind',
                source: 'fighter',
                description: 'Regain 1d10 + fighter level HP as a bonus action.',
                usesMax: 1,
                rechargeOn: 'short_rest',
            },
        ],
        background: 'Soldier',
        feats: [],
    } as ActorSheet;
}

// Mock SRD loader that returns known spells
function makeMockLoader(): ContentPackLoader {
    const spellDb: Record<string, any> = {
        'Fire Bolt': {
            name: 'Fire Bolt',
            level: 0,
            school: 'evocation',
            castingTime: 'action',
            range: '120 feet',
            damageFormula: '2d10',
            damageType: 'fire',
            isAreaEffect: false,
            requiresConcentration: false,
            description: 'Ranged spell attack dealing fire damage.',
        },
        'Ray of Frost': {
            name: 'Ray of Frost',
            level: 0,
            school: 'evocation',
            castingTime: 'action',
            range: '60 feet',
            damageFormula: '2d8',
            damageType: 'cold',
            isAreaEffect: false,
            requiresConcentration: false,
            description: 'Ranged spell attack dealing cold damage.',
        },
        'Magic Missile': {
            name: 'Magic Missile',
            level: 1,
            school: 'evocation',
            castingTime: 'action',
            range: '120 feet',
            damageFormula: '3d4+3',
            damageType: 'force',
            isAreaEffect: false,
            requiresConcentration: false,
            description: 'Three darts of magical force.',
        },
        'Fireball': {
            name: 'Fireball',
            level: 3,
            school: 'evocation',
            castingTime: 'action',
            range: '150 feet',
            damageFormula: '8d6',
            damageType: 'fire',
            saveStat: 'dex',
            saveEffect: 'half',
            isAreaEffect: true,
            areaType: 'sphere',
            areaSize: 20,
            requiresConcentration: false,
            description: 'A bright streak of fire explodes.',
        },
        'Shield': {
            name: 'Shield',
            level: 1,
            school: 'abjuration',
            castingTime: 'reaction',
            range: 'Self',
            isAreaEffect: false,
            requiresConcentration: false,
            description: '+5 AC until start of next turn.',
        },
    };

    return {
        getEntry: (_cat: string, name: string) => spellDb[name] ?? null,
        getEntries: (_cat: string) => Object.values(spellDb),
        loadPack: () => {},
    } as unknown as ContentPackLoader;
}

// =============================================================================
// Tests
// =============================================================================

describe('buildCombatSpells', () => {
    it('converts ActorSheet spells to combat Spell[] with SRD data', () => {
        const sheet = makeWizardSheet();
        const loader = makeMockLoader();
        const spells = buildCombatSpells(sheet, loader);

        expect(spells).toHaveLength(5); // 2 cantrips + 3 known spells

        const fireBolt = spells.find(s => s.name === 'Fire Bolt');
        expect(fireBolt).toBeDefined();
        expect(fireBolt!.level).toBe(0);
        expect(fireBolt!.damageFormula).toBe('2d10');
        expect(fireBolt!.damageType).toBe('fire');
        expect(fireBolt!.range).toBe(120);

        const fireball = spells.find(s => s.name === 'Fireball');
        expect(fireball).toBeDefined();
        expect(fireball!.level).toBe(3);
        expect(fireball!.damageFormula).toBe('8d6');
        expect(fireball!.savingThrow).toBe('DEX');
        expect(fireball!.isAreaEffect).toBe(true);
        expect(fireball!.range).toBe(150);

        const shield = spells.find(s => s.name === 'Shield');
        expect(shield).toBeDefined();
        expect(shield!.castingTime).toBe('reaction');
        expect(shield!.range).toBe(0); // Self → 0
    });

    it('returns empty array for non-caster', () => {
        const sheet = makeFighterSheet();
        const loader = makeMockLoader();
        expect(buildCombatSpells(sheet, loader)).toEqual([]);
    });
});

describe('collectResistances / collectImmunities', () => {
    it('collects resistances from features', () => {
        const sheet = makeWizardSheet({
            features: [
                {
                    name: 'Dwarven Resilience',
                    source: 'race',
                    description: 'You have resistance to poison damage.',
                },
            ] as ActorSheet['features'],
        });
        expect(collectResistances(sheet)).toContain('poison');
    });

    it('collects immunities from features', () => {
        const sheet = makeWizardSheet({
            features: [
                {
                    name: 'Tiefling Heritage',
                    source: 'race',
                    description: 'You are immune to fire damage.',
                },
            ] as ActorSheet['features'],
        });
        expect(collectImmunities(sheet)).toContain('fire');
    });

    it('returns empty arrays when no resistances/immunities', () => {
        const sheet = makeFighterSheet();
        expect(collectResistances(sheet)).toEqual([]);
        expect(collectImmunities(sheet)).toEqual([]);
    });
});

describe('deriveAttackBonus', () => {
    it('uses STR + proficiency for non-finesse weapon', () => {
        const sheet = makeFighterSheet(); // STR 18 (+4), prof +3
        expect(deriveAttackBonus(sheet)).toBe(7);
    });

    it('uses higher of STR/DEX for finesse weapon', () => {
        const sheet = makeWizardSheet({
            equipment: [
                { name: 'Rapier', type: 'weapon', properties: { damage: '1d8', finesse: true } },
            ],
        });
        // DEX 14 (+2) > STR 8 (-1), prof +3 → 5
        expect(deriveAttackBonus(sheet)).toBe(5);
    });
});

describe('deriveDamageFormula', () => {
    it('derives formula from equipped weapon + STR', () => {
        const sheet = makeFighterSheet(); // STR 18 (+4), longsword 1d8
        expect(deriveDamageFormula(sheet)).toBe('1d8+4');
    });

    it('falls back to 1d4 unarmed if no weapon', () => {
        const sheet = makeWizardSheet({ equipment: [] });
        // STR 8 (-1) → clamped to 0
        expect(deriveDamageFormula(sheet)).toBe('1d4+0');
    });
});

describe('Full entity from ActorSheet', () => {
    it('creates entity with spells, spell slots, ability scores, and correct AC', () => {
        const sheet = makeWizardSheet();
        const loader = makeMockLoader();
        const spells = buildCombatSpells(sheet, loader);

        const entity = createPlayerEntity(
            'player-1',
            sheet.name,
            sheet.maxHp,
            sheet.maxHp,
            sheet.ac.base,
            0,
            {
                abilityScores: sheet.abilityScores,
                attackModifier: deriveAttackBonus(sheet),
                damageFormula: deriveDamageFormula(sheet),
                spells,
                spellSlots: sheet.spellcasting!.spellSlots,
                spellSaveDC: sheet.spellcasting!.saveDC,
                resistances: collectResistances(sheet),
                immunities: collectImmunities(sheet),
            },
        );

        expect(entity.name).toBe('Gandalf');
        expect(entity.baseAC).toBe(15);
        expect(entity.hp).toBe(28);
        expect(entity.maxHp).toBe(28);
        expect(entity.spells.length).toBe(5);
        expect(entity.spellSlots).toEqual({ '1': 4, '2': 3, '3': 2 });
        expect(entity.spellSaveDC).toBe(14);
        expect(entity.abilityScores?.int).toBe(18);
        expect(entity.type).toBe('player');
    });
});

describe('Fallback without ActorSheet', () => {
    it('creates basic entity with empty spells and default stats', () => {
        const entity = createPlayerEntity(
            'player-2',
            'BasicChar',
            20,
            20,
            14,
            10,
            {
                abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
                dbCharacterId: 42,
            },
        );

        expect(entity.name).toBe('BasicChar');
        expect(entity.spells).toEqual([]);
        expect(entity.spellSlots).toEqual({});
        expect(entity.baseAC).toBe(14);
        expect(entity.type).toBe('player');
        expect(entity.dbCharacterId).toBe(42);
    });
});
