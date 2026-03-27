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
server/         → Game logic (routers.ts, db.ts, prompts.ts, message-send.ts)
shared/         → Shared types + constants (client ↔ server)
drizzle/        → DB schema (schema.ts) + migrations
docs/           → Design docs, plans, fix logs
```

## Key Patterns
- **tRPC end-to-end type safety** — schema in `drizzle/schema.ts`, types flow through tRPC to React Query hooks. No manual API types.
- **Path aliases** — `@/` maps to `client/src/`, `@shared/` maps to `shared/`
- **UI components** — shadcn/ui in `client/src/components/ui/`. Don't modify these directly.
- **LLM abstraction** — `server/_core/llm-with-settings.ts` picks provider from user settings. All LLM calls go through this.
- **Combat is a state machine** — see `docs/combat/COMBAT_ENGINE.md`. Deterministic engine, undo support, LLM only for enemy AI decisions.
- **Main router** — `server/routers.ts` (~1640 lines) contains all tRPC endpoints. Sub-routers: auth, sessions, characters, messages, settings, combatV2, tts.

## Conventions
- Zod for all runtime validation (combat types, tRPC inputs)
- `@dice-roller/rpg-dice-roller` for dice notation (e.g. `2d20kh1`, `4d6dl1`)
- In-memory combat instances per session via `CombatEngineManager`
- Combat state persisted to DB on end/save, loaded on reconnect
- Chat streaming via `/api/stream` (HTTP chunked), not WebSocket

## Database
PostgreSQL with Drizzle ORM. Tables: users, sessions, characters, messages, userSettings, sessionContext, combatState, combatants. Schema at `drizzle/schema.ts`.

## Testing
Combat engine has the primary test suite at `server/combat/__tests__/`. Tests use Vitest. Mock dice when testing combat logic.
