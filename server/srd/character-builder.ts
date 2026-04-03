/**
 * Character Builder — SRD-driven ActorSheet construction.
 *
 * Pure function that takes minimal character inputs and returns a fully-populated
 * ActorSheet by reading SRD data (classes, spells, equipment, races).
 */

import crypto from 'crypto';
import { ActorSheetSchema, type ActorSheet, type AbilityStat } from '../kernel/actor-sheet';
import { lookupByName, filterEntries } from './srd-query';
import type { ContentPackLoader } from './content-pack';

// =============================================================================
// Public API
// =============================================================================

export interface CharacterBuildInput {
  id?: string;
  name: string;
  characterClass: string;
  ancestry: string;
  level: number;
  abilityScores: Record<AbilityStat, number>;
  hpMax: number;
  ac: number;
  acSource?: string;
  background?: string | null;
  subclass?: string | null;
  spellChoices?: { cantrips?: string[]; spells?: string[] };
}

export function buildActorSheet(input: CharacterBuildInput, loader: ContentPackLoader): ActorSheet {
  // Normalize class name: strip subclass info in parens (e.g. "Wizard (Necromancy)" → "Wizard")
  const baseClassName = input.characterClass.replace(/\s*\(.*\)/, '').trim();
  const className = baseClassName.toLowerCase();
  const srdClass = lookupByName(loader, 'classes', baseClassName);
  const profBonus = getProficiencyBonus(input.level);

  const proficiencies = deriveProficiencies(srdClass);
  const spellcasting = deriveSpellcasting(srdClass, className, input.level, input.abilityScores, loader, input.spellChoices);
  const features = deriveFeatures(srdClass, className, input.level);
  const equipment = deriveEquipment(className, loader);
  const speeds = deriveSpeeds(input.ancestry, loader);
  const senses = deriveSenses(input.ancestry, loader);
  const hitDie = srdClass?.hitDie ?? HIT_DIE_MAP[className] ?? 'd8';

  // Check for Unarmored Defense
  const ac = deriveAC(input, features);

  const sheet: ActorSheet = ActorSheetSchema.parse({
    id: input.id ?? crypto.randomUUID(),
    name: input.name,
    ancestry: input.ancestry || 'Unknown',
    characterClass: input.characterClass,
    subclass: input.subclass ?? null,
    level: input.level,
    abilityScores: input.abilityScores,
    proficiencyBonus: profBonus,
    proficiencies,
    speeds,
    senses,
    hitDie,
    maxHp: input.hpMax,
    ac,
    spellcasting,
    equipment,
    features,
    background: input.background ?? null,
    feats: [],
  });

  return sheet;
}

// =============================================================================
// Constants
// =============================================================================

const HIT_DIE_MAP: Record<string, string> = {
  barbarian: 'd12', fighter: 'd10', paladin: 'd10', ranger: 'd10',
  bard: 'd8', cleric: 'd8', druid: 'd8', monk: 'd8', rogue: 'd8', warlock: 'd8',
  sorcerer: 'd6', wizard: 'd6',
};

const SPELLCASTING_ABILITY: Record<string, AbilityStat> = {
  wizard: 'int',
  cleric: 'wis',
  druid: 'wis',
  bard: 'cha',
  sorcerer: 'cha',
  warlock: 'cha',
  paladin: 'cha',
  ranger: 'wis',
};

const SPELL_PRIORITY: Record<string, Record<number, string[]>> = {
  wizard: {
    0: ['Fire Bolt', 'Mage Hand', 'Prestidigitation'],
    1: ['Shield', 'Magic Missile', 'Mage Armor', 'Detect Magic'],
    2: ['Misty Step', 'Scorching Ray'],
    3: ['Fireball', 'Counterspell', 'Fly'],
    4: ['Greater Invisibility', 'Dimension Door'],
    5: ['Wall of Force', 'Cone of Cold'],
  },
  cleric: {
    0: ['Sacred Flame', 'Guidance', 'Spare the Dying'],
    1: ['Cure Wounds', 'Healing Word', 'Bless', 'Shield of Faith'],
    2: ['Spiritual Weapon', 'Hold Person'],
    3: ['Spirit Guardians', 'Revivify'],
    4: ['Guardian of Faith', 'Banishment'],
    5: ['Mass Cure Wounds', 'Flame Strike'],
  },
  bard: {
    0: ['Vicious Mockery', 'Minor Illusion'],
    1: ['Healing Word', 'Dissonant Whispers', 'Faerie Fire', 'Thunderwave'],
    2: ['Hold Person', 'Shatter'],
    3: ['Hypnotic Pattern', 'Dispel Magic'],
  },
  druid: {
    0: ['Produce Flame', 'Shillelagh'],
    1: ['Cure Wounds', 'Entangle', 'Thunderwave', 'Faerie Fire'],
    2: ['Moonbeam', 'Hold Person'],
    3: ['Call Lightning', 'Dispel Magic'],
  },
  sorcerer: {
    0: ['Fire Bolt', 'Ray of Frost', 'Prestidigitation'],
    1: ['Shield', 'Magic Missile', 'Mage Armor', 'Chromatic Orb'],
    2: ['Scorching Ray', 'Misty Step'],
    3: ['Fireball', 'Counterspell', 'Fly'],
  },
  warlock: {
    0: ['Eldritch Blast', 'Minor Illusion'],
    1: ['Hex', 'Hellish Rebuke', 'Armor of Agathys'],
    2: ['Hold Person', 'Misty Step'],
    3: ['Counterspell', 'Hunger of Hadar'],
  },
  paladin: {
    1: ['Shield of Faith', 'Thunderous Smite', 'Cure Wounds', 'Bless'],
    2: ['Branding Smite', 'Find Steed'],
    3: ['Revivify', 'Dispel Magic'],
  },
  ranger: {
    1: ['Hunter\'s Mark', 'Cure Wounds', 'Goodberry', 'Ensnaring Strike'],
    2: ['Pass Without Trace', 'Spike Growth'],
    3: ['Conjure Animals', 'Lightning Arrow'],
  },
};

const CLASS_STARTING_WEAPONS: Record<string, string[]> = {
  barbarian: ['Greataxe', 'Handaxe'],
  bard:      ['Rapier', 'Dagger'],
  cleric:    ['Mace'],
  druid:     ['Quarterstaff'],
  fighter:   ['Longsword'],
  monk:      ['Shortsword', 'Quarterstaff'],
  paladin:   ['Longsword'],
  ranger:    ['Longbow', 'Shortsword'],
  rogue:     ['Rapier', 'Shortbow'],
  sorcerer:  ['Dagger'],
  warlock:   ['Crossbow, light', 'Dagger'],
  wizard:    ['Quarterstaff', 'Dagger'],
};

// =============================================================================
// Helpers
// =============================================================================

function getProficiencyBonus(level: number): number {
  return Math.floor((level - 1) / 4) + 2;
}

function abilityMod(score: number): number {
  return Math.floor((score - 10) / 2);
}

function deriveProficiencies(srdClass: any): ActorSheet['proficiencies'] {
  if (!srdClass) {
    return { saves: [], skills: [], weapons: [], armor: [], tools: [] };
  }
  return {
    saves: (srdClass.saveProficiencies ?? []) as AbilityStat[],
    skills: (srdClass.skillChoices ?? []).slice(0, srdClass.skillCount ?? 2),
    weapons: srdClass.weaponProficiencies ?? [],
    armor: srdClass.armorProficiencies ?? [],
    tools: [],
  };
}

function deriveSpellcasting(
  srdClass: any,
  className: string,
  level: number,
  abilityScores: Record<AbilityStat, number>,
  loader: ContentPackLoader,
  spellChoices?: { cantrips?: string[]; spells?: string[] },
): ActorSheet['spellcasting'] {
  if (!srdClass?.spellcasting) return null;

  const ability = (srdClass.spellcasting.ability ?? SPELLCASTING_ABILITY[className] ?? 'int') as AbilityStat;
  const mod = abilityMod(abilityScores[ability]);
  const profBonus = getProficiencyBonus(level);
  const saveDC = 8 + profBonus + mod;
  const attackBonus = profBonus + mod;

  const spellSlots = getSpellSlots(srdClass, level);
  const maxSpellLevel = Math.max(0, ...Object.keys(spellSlots).map(Number));
  const cantripsKnownCount = srdClass.spellcasting.cantripsKnown?.[level - 1] ?? 3;

  let cantrips: string[];
  let spells: string[];

  if (spellChoices) {
    cantrips = spellChoices.cantrips ?? [];
    spells = spellChoices.spells ?? [];
  } else {
    const picked = pickSpells(className, level, abilityScores[ability], srdClass, maxSpellLevel, cantripsKnownCount, loader);
    cantrips = picked.cantrips;
    spells = picked.spells;
  }

  return {
    ability,
    saveDC,
    attackBonus,
    cantripsKnown: cantrips,
    spellsKnown: spells,
    spellSlots,
  };
}

function getSpellSlots(srdClass: any, level: number): Record<string, number> {
  if (!srdClass.spellcasting?.spellSlots) return {};
  const slots: Record<string, number> = {};
  for (const [slotLevel, progression] of Object.entries(srdClass.spellcasting.spellSlots)) {
    const arr = progression as number[];
    const count = arr[level - 1] ?? 0;
    if (count > 0) {
      slots[slotLevel] = count;
    }
  }
  return slots;
}

function pickSpells(
  className: string,
  level: number,
  abilityScore: number,
  srdClass: any,
  maxSpellLevel: number,
  cantripsKnownCount: number,
  loader: ContentPackLoader,
): { cantrips: string[]; spells: string[] } {
  const priority = SPELL_PRIORITY[className];

  if (priority) {
    const cantrips = (priority[0] ?? []).slice(0, cantripsKnownCount);
    const spells: string[] = [];
    for (let sl = 1; sl <= maxSpellLevel; sl++) {
      spells.push(...(priority[sl] ?? []));
    }
    return { cantrips, spells };
  }

  // Generic caster: pick from SRD spells for this class
  const classSpells = filterEntries(loader, 'spells', { class: className });

  const cantrips = classSpells
    .filter((s: any) => s.level === 0)
    .slice(0, cantripsKnownCount)
    .map((s: any) => s.name);

  const maxPrepared = Math.max(1, level + abilityMod(abilityScore));

  const leveled = classSpells
    .filter((s: any) => s.level >= 1 && s.level <= maxSpellLevel)
    .sort((a: any, b: any) => {
      if (a.level !== b.level) return a.level - b.level;
      const aScore = (a.damageFormula ? 1 : 0) + (a.healingFormula ? 1 : 0);
      const bScore = (b.damageFormula ? 1 : 0) + (b.healingFormula ? 1 : 0);
      return bScore - aScore;
    })
    .slice(0, maxPrepared)
    .map((s: any) => s.name);

  return { cantrips, spells: leveled };
}

function deriveFeatures(srdClass: any, className: string, level: number): ActorSheet['features'] {
  if (!srdClass?.features) return [];
  return srdClass.features
    .filter((f: any) => f.level <= level)
    .map((f: any) => ({
      name: f.name,
      source: className.charAt(0).toUpperCase() + className.slice(1),
      description: f.description ?? '',
      ...(f.usesMax != null ? { usesMax: f.usesMax } : {}),
      ...(f.rechargeOn ? { rechargeOn: f.rechargeOn } : {}),
    }));
}

function deriveEquipment(className: string, loader: ContentPackLoader): ActorSheet['equipment'] {
  const weaponNames = CLASS_STARTING_WEAPONS[className] ?? [];
  const equipment: ActorSheet['equipment'] = [];

  for (const name of weaponNames) {
    const srd = lookupByName(loader, 'equipment', name);
    if (srd) {
      equipment.push({
        name: srd.name,
        type: 'weapon',
        properties: {
          damage: srd.damage?.formula,
          damageType: srd.damage?.type,
          ...(srd.properties?.includes('finesse') ? { finesse: true } : {}),
          ...(srd.properties?.includes('thrown') ? { thrown: true } : {}),
          ...(srd.properties?.includes('versatile') ? { versatile: true } : {}),
          ...(srd.properties?.includes('light') ? { light: true } : {}),
          ...(srd.properties?.includes('two-handed') ? { 'two-handed': true } : {}),
          ...(srd.properties?.includes('heavy') ? { heavy: true } : {}),
          ...(srd.subcategory?.includes('ranged') ? { ranged: true } : {}),
        },
      });
    } else {
      // Fallback: include weapon by name even if not in SRD
      equipment.push({ name, type: 'weapon' });
    }
  }

  return equipment;
}

function deriveSpeeds(ancestry: string, loader: ContentPackLoader): ActorSheet['speeds'] {
  if (!ancestry || ancestry === 'Unknown') return { walk: 30 };
  const race = lookupByName(loader, 'races', ancestry);
  if (race?.speed) return { walk: race.speed };
  return { walk: 30 };
}

function deriveSenses(ancestry: string, loader: ContentPackLoader): ActorSheet['senses'] {
  if (!ancestry || ancestry === 'Unknown') return {};
  const race = lookupByName(loader, 'races', ancestry);
  if (!race?.traits) return {};

  for (const trait of race.traits) {
    if (trait.name === 'Darkvision' || trait.name === 'Superior Darkvision') {
      const match = trait.description?.match(/(\d+)\s*feet/);
      if (match) return { darkvision: parseInt(match[1], 10) };
      return { darkvision: 60 };
    }
  }
  return {};
}

function deriveAC(
  input: CharacterBuildInput,
  features: ActorSheet['features'],
): ActorSheet['ac'] {
  // Check for Unarmored Defense (Barbarian/Monk)
  const hasUnarmoredDefense = features.some(f => f.name === 'Unarmored Defense');
  if (hasUnarmoredDefense) {
    const className = input.characterClass.toLowerCase();
    const dexMod = abilityMod(input.abilityScores.dex);
    if (className === 'barbarian') {
      const conMod = abilityMod(input.abilityScores.con);
      const unarmoredAC = 10 + dexMod + conMod;
      return { base: Math.max(unarmoredAC, input.ac), source: 'unarmored_defense' };
    }
    if (className === 'monk') {
      const wisMod = abilityMod(input.abilityScores.wis);
      const unarmoredAC = 10 + dexMod + wisMod;
      return { base: Math.max(unarmoredAC, input.ac), source: 'unarmored_defense' };
    }
  }

  return { base: input.ac, source: input.acSource ?? 'equipment' };
}
