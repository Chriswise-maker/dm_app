# Phase B: Rules Kernel & SRD Content — Implementation Plan

> **STATUS: ✅ COMPLETE (~2026-03-31)** — All 11 steps implemented. Preserved as historical reference.

> **Purpose:** Architecture overview and dependency graph for Phase B. The step-by-step task list for a coding agent lives in [`scripts/TASKS.md`](../scripts/TASKS.md).
>
> **Prerequisites:** Phase A complete (save rolls, spatial model, skill checks, rest mechanics). See [ROADMAP.md](ROADMAP.md) for full context.
>
> **Last updated:** 2026-03-30

---

## Goal

Make the game *actually know D&D* instead of the LLM improvising rules. Build a rules kernel that sits below the combat engine, import the 5e SRD as structured data, give characters real spell lists and class features, and make the engine — not the LLM — the source of truth for all mechanical state.

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────┐
│                    Chat / UI Layer                     │
│         (React, tRPC, message-send.ts, prompts.ts)    │
├──────────────────────────────────────────────────────┤
│              Combat Engine V2  (consumer)              │
│  (combat-engine-v2.ts — state machine, turns, phases) │
├──────────────────────────────────────────────────────┤
│                   ▼ delegates to ▼                    │
├──────────────────────────────────────────────────────┤
│                 Rules Kernel  (NEW)                    │
│  ┌─────────────┐ ┌──────────────┐ ┌───────────────┐  │
│  │ ActorSheet  │ │ EffectSystem │ │ CheckResolver │  │
│  │ ActorState  │ │ Definition   │ │ (d20 pipeline)│  │
│  │             │ │ Instance     │ │               │  │
│  └─────────────┘ └──────────────┘ └───────────────┘  │
├──────────────────────────────────────────────────────┤
│                SRD Content Layer  (NEW)                │
│  ┌──────────────┐ ┌────────────┐ ┌────────────────┐  │
│  │ Content Pack │ │ Query Layer│ │ LLM Tool Calls │  │
│  │ srd-2014/    │ │ lookup,    │ │ lookup_spell,  │  │
│  │ custom/      │ │ filter,    │ │ lookup_monster │  │
│  └──────────────┘ │ fuzzy      │ └────────────────┘  │
│                    └────────────┘                      │
└──────────────────────────────────────────────────────┘
```

**Key principle:** Combat Engine V2 keeps working as-is. Kernel modules are introduced alongside it. One mechanic at a time, combat delegates to the kernel instead of its internal logic. No big-bang rewrite.

---

## New Directory Structure

```
server/
  kernel/                          ← NEW: rules kernel
    actor-sheet.ts                 ActorSheet Zod schema
    actor-state.ts                 ActorState Zod schema
    effect-types.ts                EffectDefinition + EffectInstance schemas
    effect-pipeline.ts             Apply/remove/tick effects
    check-resolver.ts              Unified d20 roll pipeline
    combat-adapter.ts              Bridge CombatEntity ↔ kernel types
    index.ts                       Barrel export
    __tests__/
      schemas.test.ts
      effects.test.ts
      check-resolver.test.ts
      narrative-boundary.test.ts
  srd/                             ← NEW: SRD content layer
    content-pack.ts                Pack loader
    srd-query.ts                   Lookup + filter functions
    index.ts                       Barrel export, singleton loader
    __tests__/
      srd-query.test.ts
data/
  srd-2014/                        ← NEW: normalized SRD data
    pack.json                      Pack metadata
    spells.json                    ~320 spells
    monsters.json                  ~300 monsters
    equipment.json                 Weapons, armor, gear
    classes.json                   12 classes with features + spell progression
    races.json                     9 races with traits
  custom/                          ← NEW: homebrew overlay (empty by default)
    pack.json
scripts/
  import-srd.ts                    ← NEW: one-time SRD import script
  migrate-characters.ts            ← NEW: backfill existing characters to ActorSheet
```

---

## Dependency Graph

```
Step 1: Kernel schemas (ActorSheet + ActorState)     ─── no deps
Step 2: Effect system (EffectDefinition + pipeline)  ─── depends on Step 1
Step 3: CheckResolver (unified d20 pipeline)         ─── depends on Steps 1, 2
Step 4: SRD data import                              ─── no deps (parallel with 1-3)
Step 5: Content pack loader + query layer            ─── depends on Step 4
Step 6: Wire SRD as LLM tool calls                   ─── depends on Step 5
Step 7: DB migration (actorSheet/actorState columns) ─── depends on Step 1
Step 8: Migrate characters + spell seeding           ─── depends on Steps 5, 7
Step 9: Wire ActorSheet into combat entities         ─── depends on Step 8
Step 10: Combat delegates to CheckResolver           ─── depends on Steps 3, 9
Step 11: Deterministic state ownership + tests       ─── depends on Steps 9, 10
```

**Recommended execution order:** 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11

Steps 1-3 (kernel) and 4-6 (SRD) are independent tracks that converge at Step 8. However, the task file runs them sequentially because the orchestrator processes steps in order.

**Parallelization opportunity:** If running manually in Cursor, steps 4-5 can be done in parallel with steps 1-3 by a second agent.

---

## Migration Strategy

### Characters (Step 7-8)

- Add `actorSheet` and `actorState` text columns to the `characters` table
- **Keep all existing flat columns** (`className`, `level`, `hpCurrent`, `stats`, etc.)
- Read paths prefer `actorSheet`/`actorState` when present, fall back to flat columns
- One-time migration script backfills existing characters
- New characters get both formats (flat columns for compatibility + ActorSheet/ActorState)
- Flat columns can be dropped in a future cleanup pass once all code uses ActorSheet

### Combat Engine (Steps 9-10)

- Engine's public API does not change
- Internal modifier math delegates to CheckResolver via adapter functions
- `CombatEntity` format stays the same — adapters bridge to kernel types
- All 107+ existing tests must continue to pass with identical behavior
- Entity creation enriched when ActorSheet is available, falls back otherwise

### LLM Boundary (Step 11)

- LLM prompt updated to explicitly forbid mechanical outcome determination
- `ActorState` becomes canonical for HP, spell slots, conditions, resources
- `gameStateChanges` in structured output still handled, but applied to ActorState
- Narrative boundary tests verify the contract

---

## Risk Notes

| Risk | Mitigation |
|------|-----------|
| SRD import produces inconsistent data | Validation tests against known entries (Fireball, Goblin, Longsword) |
| CheckResolver changes combat behavior | Adapter layer ensures identical math; all existing tests must pass unchanged |
| LLM tool calls slow down chat | Tools only added to out-of-combat chat, not combat narration/AI/parser |
| Migration breaks existing characters | Flat columns preserved; ActorSheet is additive, not replacement |
| Steps too large for one agent session | Each step scoped to ~200-400 new lines + ~50-100 lines of changes |

---

## Test Strategy

| Step | Test type | What's verified |
|------|-----------|----------------|
| 1 | Schema validation | ActorSheet/ActorState accept valid data, reject invalid |
| 2 | Unit tests | Effect apply/remove/tick, modifier stacking, concentration |
| 3 | Unit tests | All d20 roll types, advantage/disadvantage, proficiency, crits |
| 4 | Import validation | Normalized JSON matches expected structure for known entries |
| 5 | Query tests | Fuzzy lookup, category filter, custom overrides SRD |
| 6 | Chat scenario | "What does Fireball do?" returns real SRD data |
| 7 | DB migration | `pnpm db:push` succeeds, new columns present |
| 8 | Migration + integration | Silas Gravemourn gets ActorSheet with real spells |
| 9 | Integration | Combat entities from ActorSheet have populated spells/resistances |
| 10 | Regression | All 107+ existing combat tests pass with identical behavior |
| 11 | Contract tests | LLM never determines mechanical outcomes; ActorState roundtrips |

---

## Reference Files

| File | Lines | Role in Phase B |
|------|-------|----------------|
| `server/combat/combat-types.ts` | 859 | CombatEntity type — kernel must be compatible |
| `server/combat/combat-engine-v2.ts` | 3,006 | Delegates to kernel in Steps 9-10 |
| `server/combat/combat-helpers.ts` | 173 | Entity creation refactored in Steps 8-9 |
| `server/routers.ts` | 1,891 | Character endpoints updated in Step 7 |
| `server/message-send.ts` | 1,085 | Tool call handling in Step 6, state ownership in Step 11 |
| `server/prompts.ts` | 719 | Tool definitions in Step 6, boundary prompts in Step 11 |
| `drizzle/schema.ts` | 197 | DB migration in Step 7 |

---

## Existing Gaps Addressed

From the Phase A audit (2026-03-30):

| Gap | Fixed in |
|-----|---------|
| `CAST_SPELL` works but players have no spells seeded | Step 8 (spell seeding from SRD) |
| `USE_ITEM` effects are placeholder-only | Step 9 (equipment with mechanical effects from ActorSheet) |
| `HEAL` not exposed via parser/getLegalActions | Step 9 (with proper class feature tracking) |
| LLM improvises rules it shouldn't | Step 11 (deterministic state ownership) |
