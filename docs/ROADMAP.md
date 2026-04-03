# D&D AI DM App — Roadmap

> **Last updated:** 2026-04-03
> **Direction:** 2014 5e, theater-of-mind first, SRD + homebrew, LLM narrates / engine decides
> **Archived docs:** [`docs/archive/`](archive/) — all prior plans and phase docs preserved there

---

## What's Done

The app is playable today for local play (one screen, multiple characters). The combat engine went through a 6-stage rework, and the core app features are functional.

### Combat Engine Rework (Stages 1–6) — All Complete

| Stage | What was built | Key details |
|-------|---------------|-------------|
| **Stage 1: Bug Fixes & Hardening** | Made the existing engine reliable | Dice mocking via injectable `rollFn`, deep copy state (`structuredClone`), log persistence (capped at 200), crit/fumble detection fix (`rawD20`), round boundary skip fix, `submitRoll` validation, concurrency lock (`CombatEngineManager.withLock`), error handling for failed rolls |
| **Stage 2: Smarter Enemies** | Enemies that make tactical decisions | Target scoring system (prioritize wounded/low-AC/casters), enriched entity data for AI context, narrator multi-player "you" fix, UNKNOWN parser fix, narrative consistency across multi-entity turns |
| **Stage 3: Legal Action Architecture** | Engine tells you what you can do | `getLegalActions(entityId)` — returns only valid actions given current state. Enemy AI constrained to legal choices. Legal actions exposed in `getState` for UI consumption |
| **Stage 4: Action Economy** | Full D&D turn structure | Turn resource tracking (action/bonus/reaction/movement), stopped auto-ending turns. Added: Dodge, Dash, Disengage, Help, Hide, Ready, Use Item, Opportunity Attack. Parser + AI updated. Action point tracker in sidebar |
| **Stage 5: Conditions, Death Saves & Healing** | D&D status effects and death mechanics | Active conditions with duration ticking (blinded, prone, stunned, etc.), death save state machine (3 successes/failures, nat 20 revive, nat 1 = 2 failures), HEAL action, damage resistance/immunity/vulnerability, temp HP absorption |
| **Stage 6: Spellcasting** | Spells that work mechanically | `SpellSchema` with full metadata, `CAST_SPELL` action, `AWAIT_SAVE_ROLL` phase for player saves, concentration tracking with CON save on damage, spell slot deduction, cantrips, area effects with multi-target, wired into legal actions + parser + enemy AI |

### App Features — Complete

| Feature | Status | What exists |
|---------|--------|-------------|
| Visual dice roller | Done | Animated dice UI in combat sidebar for initiative, attack, damage, death save, and save rolls. Manual chat entry as fallback |
| Streaming narration | Done | SSE streaming via `POST /api/chat/stream`, paced reveal at ~48 chars/sec, stick-to-bottom auto-scroll, plain text during stream → markdown after done |
| Character creation | Done | Manual form (name, class, level, stats, HP, AC, inventory) + AI character generator that matches campaign tone |
| Campaign/sessions | Done | Create campaigns with AI-generated worlds/prologues, persistent chat history, automatic context extraction (NPCs, locations, plot points) |
| Combat initiation | Done | NLP attack detection from chat triggers combat automatically, enemies generated from narrative with stats, initiative rolled for all combatants |
| Combat sidebar | Done | Turn order, HP display, current actor highlight, legal actions on player turn, undo button, end combat |
| Settings | Done | Multi-provider LLM config (OpenAI, Anthropic, Google), API key management, custom prompt overrides |
| Chat interface | Done | Message history, streaming display, combat integration, context viewer (debug mode) |

### Architecture Established

- **Deterministic engine** — dice injected via `rollFn`, LLM only decides *what* to do, engine resolves outcomes
- **Zod as source of truth** — all combat types in `combat-types.ts`, flows through tRPC to frontend
- **Deep copy state** — `getState()` returns `structuredClone`, immutable from consumer side
- **History stack** — full undo support, `pushHistory()` before every mutation
- **Singleton manager** — one `CombatEngineV2` per session via `CombatEngineManager`
- **Concurrency lock** — per-session operation serialization prevents race conditions
- **Test suite** — 227 tests across 22 files (combat engine, kernel, SRD, skill checks, rest mechanics, narrative boundary, character builder, spell attacks)

**Reference:** [COMBAT_ENGINE.md](combat/COMBAT_ENGINE.md) for full technical details, [manual.md](manual.md) for player-facing reference.

---

## The Roadmap

Three phases, each one making the game noticeably better. Each phase is playable on its own — no phase requires completing a later one.

---

### ✅ Phase A: Close Gaps & Add Spatial Awareness — COMPLETE (~2026-03-30)

**Goal:** Fix the things that are half-built, and give combat a sense of *where things are* without needing a grid.

| Task | What was built | Key files |
|------|---------------|-----------|
| **A1. Save rolls end-to-end** | `getState` emits `pendingRoll` for `AWAIT_SAVE_ROLL` phase; dice roller handles `rollType: "save"`; `submitRoll` routes to `submitSavingThrow` | `routers.ts`, `combat-engine-v2.ts`, `DiceRoller.tsx` |
| **A2. Gated placeholder mechanics** | `READY` trigger fires on movement/turn events; `OPPORTUNITY_ATTACK` wired to leaving melee without `DISENGAGE`; `DASH`/`DISENGAGE` update spatial state | `combat-engine-v2.ts` |
| **A3. Tests for gaps** | Spell save end-to-end, ready trigger resolution, spatial movement reactions | `server/combat/__tests__/phase-a-mechanics.test.ts` |
| **A4. Out-of-combat skill checks** | `resolveSkillCheck()` — d20 + modifier + proficiency vs DC, advantage/disadvantage, 18-skill map; `mechanics.skillCheck` tRPC endpoint | `server/skill-check.ts`, `routers.ts` |
| **A5. Hybrid spatial model** | `RangeBand` enum (MELEE=5ft / NEAR=30ft / FAR=60ft+); per-entity `rangeTo` map on `CombatEntity`; MOVE shifts bands; OA triggers on melee exit | `combat-types.ts`, `combat-engine-v2.ts` |
| **A6. Basic rest mechanics** | Short rest (hit dice spending, HP recovery, Warlock pact slots); long rest (full HP, all spell slots, hit dice recovery); class-specific hit die + spell slot tables | `server/rest.ts`, `routers.ts` |

**Implementation plan (historical):** [phase-a-implementation-plan.md](phase-a-implementation-plan.md)

---

### ✅ Phase B: Rules Kernel & SRD Content — COMPLETE (~2026-03-31)

**Goal:** Build the foundation that makes the game *actually know D&D* instead of the LLM improvising rules.

| Task | What was built | Key files |
|------|---------------|-----------|
| **B1. Kernel schemas** | `ActorSheetSchema` (static character definition) + `ActorStateSchema` (runtime state); `deriveInitialState()` helper | `server/kernel/actor-sheet.ts`, `actor-state.ts` |
| **B2. Effect system** | `EffectDefinition` + `EffectInstance` schemas; `getActiveModifiers()`, `tickEffects()`, `resolveConcentration()` pipeline | `server/kernel/effect-types.ts`, `effect-pipeline.ts` |
| **B3. CheckResolver** | Single deterministic pipeline for attack rolls, saves, ability checks, contests; advantage/disadvantage; condition modifiers; used by both combat and out-of-combat | `server/kernel/check-resolver.ts`, `combat-adapter.ts` |
| **B4. SRD data import** | [`5e-database`](https://github.com/5e-bits/5e-database) imported and normalized into `data/srd-2014/` (spells 407KB, monsters 642KB, classes 161KB, equipment 46KB, races 12KB) | `scripts/import-srd.ts`, `data/srd-2014/` |
| **B5. Content pack loader** | `ContentPackLoader` with `srd-2014` + `custom` pack support; custom overrides SRD; `lookupByName()`, `filterEntries()`, `summarizeForLLM()` | `server/srd/content-pack.ts`, `srd-query.ts`, `index.ts` |
| **B6. LLM tool calls** | `lookup_spell`, `lookup_monster`, `lookup_equipment`, `search_srd` wired as OpenAI function-calling tools in the DM chat loop | `server/prompts.ts`, `message-send.ts` |
| **B7. DB migration** | `actorSheet` + `actorState` text columns added to `characters` table | `drizzle/0004_far_unus.sql`, `drizzle/schema.ts` |
| **B8. Character migration** | Backfill script converts existing character rows to `ActorSheet` + `ActorState` | `scripts/migrate-characters.ts` |
| **B9. Combat engine wiring** | Combat engine delegates to `kernel/check-resolver.ts` for attack/save resolution; `combat-adapter.ts` bridges `CombatEntity` ↔ kernel types | `combat-engine-v2.ts`, `server/kernel/combat-adapter.ts` |
| **B10-11. Deterministic state ownership** | `ActorState` is source of truth for HP/slots/conditions; narrative boundary enforced in system prompt + tests | `server/kernel/__tests__/narrative-boundary.test.ts`, `server/prompts.ts` |

**Implementation plan (historical):** [phase-b-implementation-plan.md](phase-b-implementation-plan.md)

---

### 🚧 Phase C: Polish, Speed & Feature Depth — CURRENT PHASE

**Goal:** Make it feel good, run fast, and support the class features that make D&D characters distinctive.

**Why last:** These are all "better" not "necessary." The game is playable and mechanically sound after Phase B. Phase C is about depth and polish.

#### ✅ C0. Real D&D combat foundation — COMPLETE (~2026-04-03)
Characters now enter combat with real spells, real weapons, correct proficiencies, and class awareness. SRD-driven `buildActorSheet()` wired into both creation endpoints. DM sees character class, spell list, and weapon list in battlefield context. Save proficiencies, proficiency bonus, and spellcasting ability all use real data.

#### C1. Tiered models for speed
Use fast/cheap models for structured combat tasks, reserve the main model for storytelling.

| LLM call | Current | Better fit |
|----------|---------|------------|
| Enemy AI decisions | Main model (~3s) | Fast model (~0.4s) |
| Combat narration | Main model (~3s) | Fast model (~0.7s) |
| Player action parsing | Main model (~2s) | Fast model (~0.3s) |
| DM chat/roleplay | Main model | Keep main model |

Impact: 3-enemy combat round drops from ~12-24s of LLM time to ~3-5s.

#### C2. PC class features
With the kernel in place, add the features that make characters feel unique:

- **Martial:** Extra Attack, Action Surge, Sneak Attack, Rage, Unarmored Defense
- **Caster:** Divine Smite, Channel Divinity, Wild Shape, Metamagic
- **Universal:** Bardic Inspiration, Shield/Counterspell (reactions), Second Wind, Lay on Hands

Each as an `EffectDefinition` in the kernel — not hardcoded in the combat engine.

#### C3. Combat sidebar & UI polish
- HP bars with gradient styling and animations
- Turn indicator animations
- Confirm dialog before ending combat
- Responsive/mobile-friendly layout
- Character sheet panel (expandable, shows full `ActorSheet` data)
- Spell list reference during combat

#### C4. Smarter enemy tactics
With spatial data and the kernel providing reliable state:
- Enemies use positioning (ranged enemies stay at distance, melee close in)
- Enemies target based on threat assessment + spatial opportunity
- Enemies use terrain/cover when available
- Boss monsters use legendary actions and lair actions

#### C5. Out-of-combat systems (on the kernel)
- Skill challenges (multi-check structured encounters)
- Travel and exploration mechanics
- Social encounter framework
- Downtime and crafting (basic)
- Shopping with SRD equipment data

---

## Not On The Roadmap (Intentionally)

These are real features but not planned for the foreseeable future:

- **Multiplayer/remote play** — would need auth, session sharing, real-time sync. Major architectural change. Currently single-screen local play only.
- **Grid/map UI** — the spatial model supports optional coordinates later, but no grid visualization is planned. Theater-of-mind is the product.
- **Multi-system support** — research docs exist in archive (Shadowrun, CoC, GURPS). Not pursuing. 5e only.
- **Licensed compendium import** — SRD + custom homebrew covers the need. Official content beyond SRD is a licensing question, not a technical one.

---

## Principles

1. **Playable at every step.** No phase that breaks the game to make it better later.
2. **Engine decides, LLM narrates.** Mechanical outcomes are deterministic. The LLM handles intent parsing, storytelling, and enemy decision-making.
3. **Theater-of-mind first.** Spatial awareness enriches narration, not replaces it.
4. **Fun over fidelity.** 5e as a strong backbone, not a straitjacket. Homebrew and house rules are first-class.
5. **Start small, prove the pattern.** Build `CheckResolver` first, not the entire kernel. Add engagement tracking first, not full spatial simulation.

---

## Test Strategy

| Area | Test type |
|------|-----------|
| Save rolls, ready, reactions | Contract tests on `submitRoll` |
| SRD import + custom overlays | Import/normalization tests |
| Actor resources, effects, conditions | Kernel unit tests |
| Combat ↔ actor state sync | Integration tests (no drift) |
| LLM never owns mechanics | Narrative boundary tests |
| Spatial model | Engagement, range, cover unit tests |
| Check resolution | Deterministic pipeline tests (attack, save, ability, contest) |

---

## Archive

All prior planning documents are preserved in [`docs/archive/`](archive/):

| Document | What it was |
|----------|-------------|
| `archive/plans/combat_engine_rework_2f498f2e.plan.md` | Original 7-stage combat rework plan (Stages 1-6 done) |
| `archive/plans/combat_foundation_hybrid_map_aware.plan.md` | Hybrid spatial + rules kernel design doc |
| `archive/combat/phase-5-roadmap.md` | Phase 5 status tracker |
| `archive/combat/phase-6-ui-polish.md` | UI polish + streaming + tiered models plan |
| `archive/combat/phase-1-4-completed.md` | Phase 1-4 completion notes |
| `archive/combat/phase-5-1-visual-dice-prompt.md` | Visual dice roller implementation spec |
| `archive/combat/design-narrative-combat.md` | "Initiative is King" design philosophy |
| `archive/dnd-srd-integration-prompt.md` | SRD data ingestion task spec |
| `archive/research/architecture-comparison.md` | Multi-RPG siloed vs modular comparison |
| `archive/research/multi-system-adaptability.md` | Multi-system engine research |
