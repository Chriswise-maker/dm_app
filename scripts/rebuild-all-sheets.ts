/**
 * Rebuild all character ActorSheets using the new SRD-driven character builder.
 * Run with: npx tsx scripts/rebuild-all-sheets.ts
 */
import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import path from 'path';
import { fileURLToPath } from 'url';
import { eq } from 'drizzle-orm';
import { characters } from '../drizzle/schema.js';
import { deriveInitialState } from '../server/kernel/actor-state.js';
import { buildActorSheet } from '../server/srd/character-builder.js';
import { ContentPackLoader } from '../server/srd/content-pack.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const loader = new ContentPackLoader();
loader.loadPack(path.resolve(__dirname, '../data/srd-2014'));
loader.loadPack(path.resolve(__dirname, '../data/custom'));

const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
const db = drizzle(sql);

const rows = await db.select().from(characters);
console.log(`Found ${rows.length} characters to rebuild.\n`);

for (const char of rows) {
  const stats = JSON.parse(char.stats || '{"str":10,"dex":10,"con":10,"int":10,"wis":10,"cha":10}');

  // Extract ancestry from existing sheet or notes
  let ancestry = 'Unknown';
  if (char.actorSheet) {
    try {
      const existing = JSON.parse(char.actorSheet);
      if (existing.ancestry && existing.ancestry !== '') ancestry = existing.ancestry;
    } catch {}
  }

  let background: string | null = null;
  if (char.actorSheet) {
    try {
      const existing = JSON.parse(char.actorSheet);
      if (existing.background) background = existing.background;
    } catch {}
  }

  try {
    const sheet = buildActorSheet({
      name: char.name,
      characterClass: char.className,
      ancestry,
      level: char.level,
      abilityScores: stats,
      hpMax: char.hpMax,
      ac: char.ac,
      background,
    }, loader);

    // Derive fresh state, preserve current HP
    const state = deriveInitialState(sheet);
    state.hpCurrent = char.hpCurrent;
    state.hpMax = char.hpMax;

    // Preserve existing spell slot usage if available
    if (char.actorState) {
      try {
        const oldState = JSON.parse(char.actorState);
        if (oldState.spellSlotsCurrent) {
          // Merge: use existing current slots if they're lower than max (character already used some)
          for (const [level, maxSlots] of Object.entries(sheet.spellcasting?.spellSlots ?? {})) {
            const usedSlots = oldState.spellSlotsCurrent[level];
            if (usedSlots !== undefined && usedSlots < (maxSlots as number)) {
              state.spellSlotsCurrent[level] = usedSlots;
            }
          }
        }
      } catch {}
    }

    await db.update(characters)
      .set({
        actorSheet: JSON.stringify(sheet),
        actorState: JSON.stringify(state),
        updatedAt: new Date(),
      })
      .where(eq(characters.id, char.id));

    const spellInfo = sheet.spellcasting
      ? ` — ${sheet.spellcasting.cantripsKnown.length} cantrips, ${sheet.spellcasting.spellsKnown.length} spells`
      : ' — no spellcasting';
    const weaponInfo = sheet.equipment.filter(e => e.type === 'weapon').map(e => e.name).join(', ');
    console.log(`Rebuilt: ${char.name} (${char.className} ${char.level})${spellInfo} | weapons: ${weaponInfo || 'none'}`);
  } catch (err) {
    console.error(`FAILED: ${char.name} (${char.className} ${char.level}):`, err);
  }
}

console.log(`\nDone. ${rows.length} characters rebuilt.`);
await sql.end();
