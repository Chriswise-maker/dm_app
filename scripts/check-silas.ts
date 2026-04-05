import 'dotenv/config';
import { neon } from '@neondatabase/serverless';

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  const rows = await sql`SELECT id, name, "className", level, "actorSheet" IS NOT NULL as has_sheet FROM characters ORDER BY id`;
  for (const r of rows) {
    console.log(`id=${r.id} name=${r.name} class=${r.className || 'NULL'} level=${r.level} sheet=${r.has_sheet}`);
  }
}
main().catch(console.error);
