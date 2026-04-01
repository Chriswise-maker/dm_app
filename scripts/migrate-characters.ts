/**
 * One-time migration: backfill existing characters with ActorSheet + ActorState data.
 * Run with: npx tsx scripts/migrate-characters.ts
 */
import 'dotenv/config';
import { eq, isNull } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { characters } from '../drizzle/schema.js';
import { deriveInitialState } from '../server/kernel/actor-state.js';
import type { ActorSheet } from '../server/kernel/actor-sheet.js';
import type { AbilityStat } from '../server/kernel/actor-sheet.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------------------------------------------------------------------------
// SRD data
// ---------------------------------------------------------------------------

const classesData: any[] = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../data/srd-2014/classes.json'), 'utf-8'),
);
const spellsData: any[] = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../data/srd-2014/spells.json'), 'utf-8'),
);

// ---------------------------------------------------------------------------
// Spell selection heuristics (per the task spec)
// ---------------------------------------------------------------------------

const SPELL_PRIORITY: Record<string, Record<number, string[]>> = {
  wizard: {
    0: ['Fire Bolt', 'Mage Hand', 'Prestidigitation'],
    1: ['Shield', 'Magic Missile', 'Mage Armor', 'Detect Magic'],
    2: ['Misty Step', 'Scorching Ray'],
    3: ['Fireball', 'Counterspell', 'Fly'],
  },
  cleric: {
    0: ['Sacred Flame', 'Guidance', 'Spare the Dying'],
    1: ['Cure Wounds', 'Healing Word', 'Bless', 'Shield of Faith'],
    2: ['Spiritual Weapon', 'Hold Person'],
    3: ['Spirit Guardians', 'Revivify'],
  },
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

function getProficiencyBonus(level: number): number {
  if (level <= 4) return 2;
  if (level <= 8) return 3;
  if (level <= 12) return 4;
  if (level <= 16) return 5;
  return 6;
}

function abilityMod(score: number): number {
  return Math.floor((score - 10) / 2);
}

function findSrdClass(className: string): any | null {
  const lower = className.toLowerCase();
  return classesData.find((c) => c.name.toLowerCase() === lower) ?? null;
}

function findSrdSpell(name: string): any | null {
  const lower = name.toLowerCase();
  return spellsData.find((s: any) => s.name.toLowerCase() === lower) ?? null;
}

/**
 * Get spell slots for a given class at a given level from SRD data.
 */
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

/**
 * Pick spells for a caster using the heuristic priority lists.
 */
function pickSpells(
  className: string,
  level: number,
  abilityScore: number,
  srdClass: any,
): { cantrips: string[]; spells: string[] } {
  const lower = className.toLowerCase();
  const priority = SPELL_PRIORITY[lower];
  const cantripsKnownCount = srdClass.spellcasting?.cantripsKnown?.[level - 1] ?? 3;

  if (priority) {
    // Use priority list for wizard/cleric
    const cantrips = (priority[0] ?? []).slice(0, cantripsKnownCount);
    const spells: string[] = [];
    // Get max spell level this class can cast at this level
    const slots = getSpellSlots(srdClass, level);
    const maxSpellLevel = Math.max(0, ...Object.keys(slots).map(Number));
    for (let sl = 1; sl <= maxSpellLevel; sl++) {
      const available = priority[sl] ?? [];
      spells.push(...available);
    }
    return { cantrips, spells };
  }

  // Generic caster: pick from SRD spells for this class
  const classSpells = spellsData.filter(
    (s: any) => Array.isArray(s.classes) && s.classes.some((c: string) => c.toLowerCase() === lower),
  );

  const cantrips = classSpells
    .filter((s: any) => s.level === 0)
    .slice(0, cantripsKnownCount)
    .map((s: any) => s.name);

  const maxPrepared = level + abilityMod(abilityScore);
  const slots = getSpellSlots(srdClass, level);
  const maxSpellLevel = Math.max(0, ...Object.keys(slots).map(Number));

  // Prefer lower-level, damage/healing spells
  const leveled = classSpells
    .filter((s: any) => s.level >= 1 && s.level <= maxSpellLevel)
    .sort((a: any, b: any) => {
      // Prefer lower level
      if (a.level !== b.level) return a.level - b.level;
      // Prefer damage/healing spells
      const aScore = (a.damageFormula ? 1 : 0) + (a.healingFormula ? 1 : 0);
      const bScore = (b.damageFormula ? 1 : 0) + (b.healingFormula ? 1 : 0);
      return bScore - aScore;
    })
    .slice(0, Math.max(1, maxPrepared))
    .map((s: any) => s.name);

  return { cantrips, spells: leveled };
}

/**
 * Try to extract ancestry/background from character notes.
 */
function extractFromNotes(notes: string | null): { ancestry: string; background: string | null } {
  if (!notes) return { ancestry: 'Unknown', background: null };

  const ancestries = [
    'Human', 'Elf', 'Half-Elf', 'Dwarf', 'Halfling', 'Gnome',
    'Half-Orc', 'Tiefling', 'Dragonborn', 'Aasimar',
  ];
  const lower = notes.toLowerCase();
  const foundAncestry = ancestries.find((a) => lower.includes(a.toLowerCase()));

  const backgrounds = [
    'Acolyte', 'Charlatan', 'Criminal', 'Entertainer', 'Folk Hero',
    'Guild Artisan', 'Hermit', 'Noble', 'Outlander', 'Sage',
    'Sailor', 'Soldier', 'Urchin',
  ];
  const foundBackground = backgrounds.find((b) => lower.includes(b.toLowerCase()));

  return {
    ancestry: foundAncestry ?? 'Unknown',
    background: foundBackground ?? null,
  };
}

// ---------------------------------------------------------------------------
// Main migration
// ---------------------------------------------------------------------------

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL not set');
    process.exit(1);
  }

  const sql = postgres(url, { max: 1 });
  const db = drizzle(sql);

  // Fetch characters with no actorSheet
  const rows = await db
    .select()
    .from(characters)
    .where(isNull(characters.actorSheet));

  console.log(`Found ${rows.length} characters to migrate.\n`);

  for (const char of rows) {
    const stats = JSON.parse(char.stats || '{"str":10,"dex":10,"con":10,"int":10,"wis":10,"cha":10}');
    const srdClass = findSrdClass(char.className);
    const profBonus = getProficiencyBonus(char.level);
    const { ancestry, background } = extractFromNotes(char.notes);

    // Try to extract subclass from notes
    let subclass: string | null = null;
    if (char.notes) {
      // Look for common subclass patterns like "School of Necromancy" or "Necromancy"
      const subclassMatch = char.notes.match(
        /(?:School of |Circle of |College of |Oath of |Way of )?(\w+(?:\s\w+)?)\s*(?:subclass|archetype)/i,
      );
      if (subclassMatch) subclass = subclassMatch[1];
      // Also check for known subclass names directly
      const knownSubclasses = [
        'Necromancy', 'Evocation', 'Abjuration', 'Divination', 'Conjuration',
        'Transmutation', 'Illusion', 'Enchantment',
        'Life', 'Light', 'Tempest', 'War', 'Knowledge', 'Nature', 'Trickery',
        'Champion', 'Battle Master', 'Eldritch Knight',
        'Thief', 'Assassin', 'Arcane Trickster',
        'Hunter', 'Beast Master',
        'Berserker', 'Totem Warrior',
        'Open Hand', 'Shadow', 'Four Elements',
        'Devotion', 'Ancients', 'Vengeance',
        'Draconic', 'Wild Magic',
        'Fiend', 'Archfey', 'Great Old One',
        'Lore', 'Valor',
        'Land', 'Moon',
      ];
      if (!subclass) {
        const lower = (char.notes ?? '').toLowerCase();
        const found = knownSubclasses.find((s) => lower.includes(s.toLowerCase()));
        if (found) subclass = found;
      }
    }

    // Build spellcasting block
    let spellcasting: ActorSheet['spellcasting'] = null;
    let spellLog = '';

    if (srdClass?.spellcasting) {
      const ability = srdClass.spellcasting.ability as AbilityStat;
      const abilityScore = stats[ability] ?? 10;
      const mod = abilityMod(abilityScore);
      const saveDC = 8 + profBonus + mod;
      const attackBonus = profBonus + mod;
      const spellSlots = getSpellSlots(srdClass, char.level);
      const { cantrips, spells } = pickSpells(char.className, char.level, abilityScore, srdClass);

      spellcasting = {
        ability,
        saveDC,
        attackBonus,
        cantripsKnown: cantrips,
        spellsKnown: spells,
        spellSlots,
      };
      spellLog = ` — ${cantrips.length} cantrips, ${spells.length} spells known`;
    }

    // Build ActorSheet
    const sheetId = crypto.randomUUID();
    const sheet: ActorSheet = {
      id: sheetId,
      name: char.name,
      ancestry,
      characterClass: char.className,
      subclass,
      level: char.level,
      abilityScores: {
        str: stats.str ?? 10,
        dex: stats.dex ?? 10,
        con: stats.con ?? 10,
        int: stats.int ?? 10,
        wis: stats.wis ?? 10,
        cha: stats.cha ?? 10,
      },
      proficiencyBonus: profBonus,
      proficiencies: {
        saves: (srdClass?.saveProficiencies ?? []) as AbilityStat[],
        skills: (srdClass?.skillChoices ?? []).slice(0, srdClass?.skillCount ?? 2),
        weapons: srdClass?.weaponProficiencies ?? [],
        armor: srdClass?.armorProficiencies ?? [],
        tools: [],
      },
      speeds: { walk: 30 },
      senses: {},
      hitDie: srdClass?.hitDie ?? 'd8',
      maxHp: char.hpMax,
      ac: { base: char.ac, source: 'unknown' },
      spellcasting,
      equipment: [],
      features: (srdClass?.features ?? [])
        .filter((f: any) => f.level <= char.level)
        .map((f: any) => ({
          name: f.name,
          source: char.className,
          description: f.description,
        })),
      background,
      feats: [],
    };

    // Derive state, then override hpCurrent with actual value
    const state = deriveInitialState(sheet);
    state.hpCurrent = char.hpCurrent;
    state.hpMax = char.hpMax;

    // Persist
    await db
      .update(characters)
      .set({
        actorSheet: JSON.stringify(sheet),
        actorState: JSON.stringify(state),
        updatedAt: new Date(),
      })
      .where(eq(characters.id, char.id));

    console.log(`Migrated: ${char.name} (${char.className} ${char.level})${spellLog}`);
  }

  console.log(`\nDone. ${rows.length} characters migrated.`);
  await sql.end();
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
