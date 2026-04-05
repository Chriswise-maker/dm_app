# D&D Dungeon Master App

Full-stack D&D campaign management app with AI-powered narration and deterministic combat.

## Tech Stack
- **Frontend:** React 19, Vite 7, TailwindCSS 4, shadcn/ui, Wouter (router), TanStack Query
- **Backend:** Express, tRPC 11, Zod 4
- **Database:** PostgreSQL via Drizzle ORM
- **LLM:** OpenAI, Anthropic, Google Gemini (multi-provider, user-configurable)
- **Testing:** Vitest
- **Package Manager:** pnpm

## Commands
- `pnpm dev` — Start dev server (port 3000)
- `pnpm build` — Production build (Vite + esbuild)
- `pnpm test` — Run all tests
- `pnpm test -- server/combat/` — Run combat tests only
- `pnpm check` — TypeScript type check
- `pnpm db:push` — Generate + apply DB migrations
- `pnpm format` — Prettier format

## Architecture
```
client/src/     → React frontend (pages, components, hooks, lib)
server/_core/   → Server infra (Express, tRPC setup, auth, LLM clients)
server/combat/  → Combat engine V2 (state machine, enemy AI, dice)
server/kernel/  → Rules kernel (ActorSheet, ActorState, CheckResolver, effects)
server/srd/     → SRD content loader + query API (lookup_spell, lookup_monster, etc.)
server/         → Game logic (routers.ts, db.ts, prompts.ts, message-send.ts, skill-check.ts, rest.ts)
shared/         → Shared types + constants (client ↔ server)
data/srd-2014/  → Normalized SRD JSON (spells 407KB, monsters 642KB, classes, equipment, races)
drizzle/        → DB schema (schema.ts) + migrations
docs/           → Design docs, plans, fix logs
```

## Key Patterns
- **tRPC end-to-end type safety** — schema in `drizzle/schema.ts`, types flow through tRPC to React Query hooks. No manual API types.
- **Path aliases** — `@/` maps to `client/src/`, `@shared/` maps to `shared/`
- **UI components** — shadcn/ui in `client/src/components/ui/`. Don't modify these directly.
- **LLM abstraction** — `server/_core/llm-with-settings.ts` picks provider from user settings. All LLM calls go through this.
- **Combat is a state machine** — see `docs/combat/COMBAT_ENGINE.md`. Deterministic engine, undo support, LLM only for enemy AI decisions.
- **Main router** — `server/routers.ts` (~2000 lines) contains all tRPC endpoints. Sub-routers: auth, sessions, characters, mechanics, messages, settings, combat, tts.
- **SRD tools** — `lookup_spell`, `lookup_monster`, `lookup_equipment`, `search_srd` wired as LLM tool calls in the DM chat loop (`server/prompts.ts`, `server/message-send.ts`).
- **Character data in prompts** — `formatCharacterSheet()` in `server/prompts.ts` is the single canonical formatter. It merges DB columns, `actorSheet` (rich SRD data), and `actorState` (runtime resources) into one text block. All prompt paths (chat, combat queries, skill checks) should use this instead of ad-hoc field extraction.
- **Character sheet UI** — `client/src/components/character-sheet/` uses shared kernel types; see `docs/CHARACTER_SHEET_UI.md` for component map, mutations (`updateHP` / `updateState`), and integration notes.

## Conventions
- Zod for all runtime validation (combat types, tRPC inputs)
- `@dice-roller/rpg-dice-roller` for dice notation (e.g. `2d20kh1`, `4d6dl1`)
- In-memory combat instances per session via `CombatEngineManager`
- Combat state persisted to DB on end/save, loaded on reconnect
- Chat streaming via `/api/stream` (HTTP chunked), not WebSocket

## Database
PostgreSQL with Drizzle ORM. Tables: users, sessions, characters, messages, userSettings, sessionContext, combatState, combatants. Schema at `drizzle/schema.ts`.

Characters now have `actorSheet` (text/JSON) and `actorState` (text/JSON) columns storing `ActorSheet` and `ActorState` kernel types.

## Testing
227 tests across 22 files. Run with Vitest. Mock dice when testing combat logic.

Key test areas:
- `server/combat/__tests__/` — combat engine (76 tests), phase-a mechanics, legal actions, enemy AI, actor-sheet-combat
- `server/kernel/__tests__/` — schemas, check-resolver, effects, narrative-boundary (50 tests)
- `server/srd/__tests__/` — SRD lookup and filtering
- `server/skill-check.test.ts`, `server/rest.test.ts` — out-of-combat mechanics
