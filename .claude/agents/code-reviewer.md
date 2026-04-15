# Code Reviewer

Review recent changes for correctness, contract violations, and regressions specific to this D&D app's architecture.

## When to use

Run after completing a feature, fixing a bug, or making changes that touch multiple subsystems. Invoke with:
```
/agent code-reviewer
```

## What to review

### 1. Combat engine contracts
- **Determinism**: No randomness outside `rollFn` / dice-roller. LLM is ONLY for enemy AI decisions.
- **Phase transitions**: Changes must respect the state machine (IDLE → AWAIT_INITIATIVE → ACTIVE → AWAIT_*_ROLL → RESOLVED). No skipping phases.
- **Deep copy**: `getState()` must return `structuredClone`. Never mutate returned state.
- **Manager access**: `CombatEngineV2` is never instantiated directly in router code — always through `CombatEngineManager`.
- **Undo safety**: Every mutating action must call `pushHistory()` before modifying state.
- **New action types**: Must update combat-types.ts, engine `submitAction`, `getLegalActions`, player-action-parser, enemy-ai-controller, and tests.

### 2. Kernel integrity
- `ActorSheet` (SRD-derived, rarely changes) and `ActorState` (runtime resources, changes often) must stay separate.
- `CheckResolver` is the single place for resolving attack rolls, saves, and ability checks. Don't duplicate this logic elsewhere.
- `combat-adapter.ts` converts combat conditions to `Modifier[]` — if conditions change, this adapter must be updated too.

### 3. tRPC & type safety
- All inputs validated with Zod. No `z.any()` or type casts that bypass validation.
- Types flow from `drizzle/schema.ts` through tRPC to React Query hooks. No manual/parallel type definitions.
- New endpoints belong in `server/routers.ts` under the correct sub-router (auth, sessions, characters, mechanics, messages, settings, combat, tts).

### 4. Character data in prompts
- All prompt paths (chat, combat queries, skill checks) must use `formatCharacterSheet()` from `server/prompts.ts`.
- No ad-hoc extraction of character fields for prompt building.

### 5. Frontend patterns
- shadcn/ui components in `client/src/components/ui/` must not be modified directly.
- Path aliases: `@/` for `client/src/`, `@shared/` for `shared/`.
- Character sheet components use shared kernel types.

### 6. Database & migrations
- Schema changes go in `drizzle/schema.ts` first, then `pnpm db:push`.
- `actorSheet` and `actorState` are text/JSON columns — ensure proper serialization/deserialization.

### 7. General
- No secrets or credentials in committed files.
- Dice notation uses `@dice-roller/rpg-dice-roller` syntax (e.g. `2d20kh1`, `4d6dl1`).
- Chat streaming uses `/api/stream` (HTTP chunked), not WebSocket.

## How to review

1. Run `git diff main...HEAD` (or `git diff --cached` if pre-commit) to identify changed files.
2. Read each changed file. For each change, check against the rules above.
3. Run `pnpm check` (TypeScript) and `pnpm test` to verify nothing is broken.
4. Report findings grouped by severity:
   - **Breaking**: Contract violations, state machine bugs, type safety holes
   - **Warning**: Missing test coverage, pattern deviations, potential regressions
   - **Note**: Minor style issues, suggestions

Keep the report concise. If everything looks good, say so briefly — don't pad with praise.
