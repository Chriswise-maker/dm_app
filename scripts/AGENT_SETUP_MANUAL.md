# Orchestrator Setup Manual — For the Cursor Code Agent

This document tells you exactly what to do to set up the dev-workflow orchestrator
and run Phase B tasks from the project roadmap. Follow the steps in order.
Ask the user to clarify anything marked **[ASK USER]** before proceeding.

---

## What already exists (do not recreate)

These files are already in the repo. Read them before doing anything:

| File | What it is |
|------|-----------|
| `scripts/orchestrate.sh` | The main automation script. Reads a task file, calls Claude Code CLI for each step, runs verification gates, auto-commits on pass, stops on fail. |
| `scripts/chat-test.ts` | Programmatic chat tester. Hits the running dev server's API and checks responses. No browser needed. |
| `scripts/TASKS.md` | **Phase B task file — 11 steps.** This is the real task list the orchestrator runs. |
| `scripts/TASKS.example.md` | The task file format reference with 3 example steps. |
| `scripts/scenarios/step-6.json` | Chat scenario for Step 6 (SRD lookup via LLM tool calls). |
| `scripts/scenarios/step-8.json` | Chat scenario for Step 8 (combat with populated spell lists). |
| `scripts/scenarios/basic-chat.json` | Generic smoke-test scenario. |
| `docs/ROADMAP.md` | The source of truth for what needs to be built. Phase A is complete; Phase B is up next. |
| `docs/phase-b-implementation-plan.md` | Architecture overview, dependency graph, migration strategy for Phase B. |

**Do not modify** `orchestrate.sh` or `chat-test.ts` unless the user explicitly asks.

**Test data:** Session ID `25` (The Shattered Throne), Character ID `26` (Silas Gravemourn, Wizard 5 Necromancy). All chat scenarios use these IDs.

---

## Step 1 — Make the script executable

Run this once:

```bash
chmod +x scripts/orchestrate.sh
```

Verify it works:

```bash
./scripts/orchestrate.sh --dry-run scripts/TASKS.example.md
```

Expected output: prints 3 parsed steps, exits 0. If it errors, read the error message
and fix the underlying issue (usually a missing dependency or wrong working directory).

---

## Step 2 — Verify TASKS.md

`scripts/TASKS.md` already exists with 11 Phase B steps. Do NOT recreate it.

Review it with a dry run:

```bash
./scripts/orchestrate.sh --dry-run scripts/TASKS.md
```

The 11 steps are:
1. Kernel schemas (ActorSheet + ActorState)
2. Effect system (EffectDefinition + pipeline)
3. CheckResolver (unified d20 pipeline)
4. SRD data import (5e-database → normalized JSON)
5. Content pack loader + query layer
6. Wire SRD as LLM tool calls
7. DB migration (actorSheet/actorState columns)
8. Migrate existing characters + spell seeding
9. Wire ActorSheet into combat entities
10. Combat delegates to CheckResolver
11. Deterministic state ownership + narrative boundary tests

See `docs/phase-b-implementation-plan.md` for architecture context.

### Rules for writing good task steps (reference for future phases)

- **One logical unit per step.** A step should be something Claude can finish in a
  single session without needing to ask questions. If it feels large, split it.
- **Reference exact files.** Say "in `server/routers.ts`, find the `submitRoll` handler"
  rather than "find where rolls are submitted."
- **State the acceptance bar.** End each step with what "done" looks like:
  "Tests pass, TypeScript has no errors, the UI shows X."
- **Steps must be independently verifiable.** After each step, `pnpm check` and
  `pnpm test` must both pass. If a step will temporarily break tests, split it.
- **Do not include TODOs or maybes.** Everything in a step body will be sent to
  Claude Code as instructions. Vague language produces vague output.

---

## Step 3 — Create chat scenarios for relevant steps

A chat scenario is a JSON file at `scripts/scenarios/step-N.json`. The orchestrator
automatically runs it as part of the verification gate for step N, after tests pass.

**Only create scenarios for steps that change chat behavior** — i.e. steps that touch
`server/message-send.ts`, `server/routers.ts` message endpoints, combat flow, or
anything that changes what the DM says.

### Scenario file format

```json
{
  "name": "Human-readable name for logs",
  "description": "What this scenario is testing",
  "sessionId": 1,
  "characterId": 1,
  "steps": [
    {
      "message": "The message the player sends",
      "expect": {
        "minLength": 30,
        "combatTriggered": false,
        "contains": ["word that must appear"],
        "notContains": ["word that must NOT appear"]
      }
    }
  ]
}
```

### Assertion fields (all optional)

| Field | Type | What it checks |
|-------|------|---------------|
| `minLength` | number | Response must be at least N characters. Use 30–50 as a baseline "not empty" check. |
| `combatTriggered` | boolean | Whether the message caused combat to start. |
| `contains` | string[] | Each string must appear in the response (case-insensitive). |
| `notContains` | string[] | Each string must NOT appear (catches error messages leaking through). |

### Session and character IDs

All scenarios use **session 25** (The Shattered Throne) and **character 26**
(Silas Gravemourn, Wizard 5 Necromancy). These are already set in the existing
scenario files. If you create new scenarios, use these same IDs.

### Writing good success criteria

**Minimal but meaningful.** Don't try to test exact wording — the LLM varies.
Test structure and behavior:

- Does combat trigger when it should? (`combatTriggered: true/false`)
- Does the response acknowledge the player's action? (`minLength: 50`)
- Does a saving throw response mention the save? (`contains: ["save"]`)
- Does an error NOT leak to the player? (`notContains: ["error", "undefined"]`)

**One scenario per step that touches chat.** Keep each scenario to 2–4 messages.
Long scenarios are slow and hard to debug.

---

## Step 4 — Verify the dry run

```bash
./scripts/orchestrate.sh --dry-run scripts/TASKS.md
```

This prints all 11 parsed steps without executing anything. Confirm with the user
that the steps look right before running for real.

---

## Step 5 — Running the orchestrator for real

### Prerequisites checklist

Before the user runs the orchestrator, confirm:

- [ ] `claude` CLI is installed and authenticated (`claude --version`)
- [ ] `pnpm dev` is running in a separate terminal (required for chat scenarios)
- [ ] `pnpm test` passes on the current branch (`pnpm test`)
- [ ] `pnpm check` passes on the current branch (`pnpm check`)
- [ ] `scripts/TASKS.md` exists and dry-run output looks correct

### Run command

```bash
./scripts/orchestrate.sh scripts/TASKS.md
```

Logs are written to `scripts/logs/`. Each step produces:
- `run_TIMESTAMP.log` — full run log
- `claude_stepN_TIMESTAMP.md` — what Claude Code produced
- `verify_stepN_TIMESTAMP.log` — typecheck + test output
- `chat_stepN_TIMESTAMP.log` — chat scenario output (if applicable)

### If a step fails

The orchestrator stops and prints:
```
STOPPED — Step N failed verification.
  Review: scripts/logs/verify_stepN_...log
  Fix issues, then re-run with: ./scripts/orchestrate.sh --start-at N
```

The user fixes the problem in Cursor, then re-runs with `--start-at N`.

### Skipping chat verification temporarily

If the dev server isn't running and you want to run just the code checks:

```bash
BASE_URL="" ./scripts/orchestrate.sh scripts/TASKS.md
```

The chat scenario will still attempt to run. If the server is down it will fail.
To skip it, temporarily rename or remove the scenario file for that step.

---

## Step 6 — Running the chat harness standalone

Use this to test or debug a specific scenario without running the full orchestrator:

```bash
# Single message test (using Silas Gravemourn / The Shattered Throne)
npx tsx scripts/chat-test.ts --session 25 --character 26 --message "I attack the goblin"

# Run a full scenario
npx tsx scripts/chat-test.ts --scenario scripts/scenarios/step-6.json

# Stream mode (watch tokens arrive in real-time)
npx tsx scripts/chat-test.ts --stream --session 25 --character 26 --message "Hello"

# Preview what the LLM receives (no actual API call)
npx tsx scripts/chat-test.ts --preview --session 25 --character 26
```

The dev server (`pnpm dev`) must be running. Auth is not required — the server
falls back to a local user automatically in development.

---

## File layout after setup

```
scripts/
  orchestrate.sh          ← automation driver
  chat-test.ts            ← chat harness
  TASKS.md                ← Phase B task list (11 steps)
  TASKS.example.md        ← template/reference
  AGENT_SETUP_MANUAL.md   ← this file
  scenarios/
    basic-chat.json       ← generic smoke test
    step-6.json           ← SRD lookup chat scenario
    step-8.json           ← combat with spells chat scenario
  logs/                   ← auto-created when orchestrator runs
docs/
  phase-b-implementation-plan.md  ← architecture + dependency graph
  ROADMAP.md              ← overall roadmap (Phase A done, B next, C later)
```

---

## Common mistakes to avoid

**Don't put `scripts/logs/` in git.** It's auto-created and contains run artifacts.
Add it to `.gitignore` if it isn't already.

**Don't write steps that span multiple commits.** Each step must leave the codebase
in a passing state. If a step is "add the data model AND wire the UI," split it.

**Don't make scenarios too strict.** `contains: ["The goblin attacks"]` will fail
whenever the LLM rephrases. Use `contains: ["goblin"]` or `combatTriggered: true`.

**Don't test LLM creativity.** Scenarios test routing and structure, not quality.
"Did combat trigger?" is testable. "Was the narration vivid?" is not.

**The session/character IDs in scenarios must exist in the database.** Stale IDs
will cause 500 errors that look like chat failures. Verify with the user.
