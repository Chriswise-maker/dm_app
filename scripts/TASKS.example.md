# Orchestrator Task File
<!--
  Format: each step is a ## heading with a number, dot, and title.
  The body below each heading is the full prompt sent to Claude Code.
  HTML comments (like this one) are ignored.

  Usage:
    ./scripts/orchestrate.sh scripts/TASKS.example.md
    ./scripts/orchestrate.sh scripts/TASKS.example.md --dry-run
    ./scripts/orchestrate.sh scripts/TASKS.example.md --start-at 3

  Verification gate (runs automatically after each step):
    1. pnpm check  — TypeScript type errors
    2. pnpm test   — unit/integration tests
    3. scripts/scenarios/step-N.json (if it exists) — live chat test against the dev server

  To use chat verification, have `pnpm dev` running in a separate terminal,
  then drop a step-N.json file in scripts/scenarios/ before kicking off the orchestrator.
-->

## 1. Wire save rolls to the client dice roller

In `client/src/components/CombatSidebar.tsx` (or wherever the dice roller renders),
add handling for `rollType: "save"` pending rolls. Currently only attack, damage,
deathSave, and initiative are handled.

- Check `getState().pendingRolls` for entries with `rollType: "save"`
- Render them in the dice roller UI the same way as other roll types
- When the user rolls, call `submitRoll` with the result
- Add a label showing what save it is (e.g. "DEX Save DC 15")

<!-- Chat success criteria for this step: scripts/scenarios/step-1.json -->

## 2. Route save rolls through submitRoll on the server

In `server/routers.ts`, make sure the `submitRoll` tRPC endpoint routes
`rollType: "save"` to `engine.submitSavingThrow(entityId, rollValue)`.

- Find the submitRoll handler in routers.ts
- Add a `save` case alongside the existing `attack` / `damage` / `deathSave` cases
- Write a unit test in `server/combat/__tests__/` that verifies save rolls resolve correctly

<!-- Chat success criteria for this step: scripts/scenarios/step-2.json -->

## 3. Add integration tests for spell saves

Create `server/combat/__tests__/spell-save-flow.test.ts` that covers:

1. Enemy casts a damage spell targeting a player requiring a save
2. Engine enters AWAIT_SAVE_ROLL phase
3. Player submits their save roll via submitRoll
4. Engine applies damage (full on fail, half on success for damage spells)
5. Turn passes to the next combatant

Use mocked dice (injectable rollFn). Follow patterns from existing combat test files.
