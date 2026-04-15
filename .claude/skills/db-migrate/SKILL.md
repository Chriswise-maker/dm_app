---
name: db-migrate
description: Generate and review Drizzle migrations before applying to the database
disable-model-invocation: true
---

# Database Migration

Safely generate and apply Drizzle ORM migrations.

## Steps

1. **Show what changed**: Run `npx drizzle-kit generate` to create the migration SQL.

2. **Review the migration**: Read the generated SQL file in `drizzle/` and explain what it does in plain language:
   - What tables/columns are being added, removed, or altered
   - Whether any data could be lost (dropping columns, changing types)
   - Whether it's safe to run on a live database

3. **Ask for confirmation** before applying. Show the user the SQL and ask "Apply this migration to the database?"

4. **Apply**: Only after user confirms, run `npx drizzle-kit migrate` to apply.

5. **Verify**: Run a quick check that the schema is in sync: `npx drizzle-kit check`
