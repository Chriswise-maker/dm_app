# D&D AI DM App — Roadmap

> **Last updated:** 2026-03-29
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
- **Test suite** — 107 tests across combat engine, UI behavior, legal actions, narration

**Reference:** [COMBAT_ENGINE.md](combat/COMBAT_ENGINE.md) for full technical details, [manual.md](manual.md) for player-facing reference.

---

## The Roadmap

Three phases, each one making the game noticeably better. Each phase is playable on its own — no phase requires completing a later one.

---

### Phase A: Close Gaps & Add Spatial Awareness

**Goal:** Fix the things that are half-built, and give combat a sense of *where things are* without needing a grid.

**Why first:** These are the smallest changes with the biggest feel improvement. Combat starts respecting positioning and the UI stops promising things the engine can't deliver.

#### A1. Wire save rolls end-to-end
- `getState` must emit save-type pending rolls to the client
- Client dice roller must handle `rollType: "save"` (currently only attack/damage/deathSave/initiative)
- `submitRoll` must route save rolls to `submitSavingThrow` in the engine

#### A2. Gate or implement placeholder mechanics
Currently advertised but not enforced:
- `READY` trigger resolution — either implement trigger firing when conditions are met, or remove from legal actions until it works
- `OPPORTUNITY_ATTACK` — wire to movement events (requires A5 spatial model)
- `DASH` / `DISENGAGE` — need spatial context to mean anything; gate until A5

#### A3. Add tests for the gaps
- Spell save end-to-end (player targeted by enemy spell, rolls save, damage applied correctly)
- Ready action: set trigger, trigger fires, action resolves
- Movement-triggered reactions (once spatial model exists)

#### A4. Out-of-combat skill checks
- Add a skill check resolver: d20 + ability modifier + proficiency vs DC
- Wire into the chat flow so the DM can call for checks mechanically (not just narratively)
- Support advantage/disadvantage
- Keep it simple — no complex skill challenge framework, just "roll a check"

#### A5. Hybrid spatial model (theater-of-mind)
Start with just enough structure to make positioning matter:

**Tier 1 (implement now):**
- **Engagement:** who is in melee with whom
- **Range bands:** melee / close (30ft) / far (60ft+)
- Track per-entity, update on movement actions

**Tier 2 (add when Tier 1 is solid):**
- Reach and melee adjacency (for polearms, etc.)
- Cover flags (half/three-quarters/full)
- Zone/area membership (for ongoing AoE effects)
- Movement speeds and modes (walk, fly, swim)

**Design rule:** Players still speak naturally ("I run to the goblin and attack"). The engine tracks the spatial consequences. The DM narrates positioning. No grid required.

#### A6. Basic rest mechanics
- Short rest: spend hit dice to heal, recover some class resources
- Long rest: full HP, recover spell slots, reset daily features
- Wire into chat flow ("we take a long rest")
- Persist resource state across rests

---

### Phase B: Rules Kernel & SRD Content

**Goal:** Build the foundation that makes the game *actually know D&D* instead of the LLM improvising rules.

**Why second:** This is the big architectural lift. It needs Phase A's spatial model and gap fixes as a stable base. Once this exists, every future feature becomes easier to build correctly.

#### B1. Shared rules kernel
A layer that sits *below* combat, not inside it. Combat becomes one consumer, not the owner of all rules.

**Core concepts to build:**

| Concept | What it does |
|---------|-------------|
| `ActorSheet` | Full character/creature definition — ancestry, class, level, proficiencies, spells known, equipment, senses, speeds, feature references |
| `ActorState` | Current runtime state — HP, temp HP, conditions, resource usage (spell slots, hit dice, feature uses), concentration, rest state |
| `EffectDefinition` | Typed modifier: "while raging: resistance to bludgeoning, +2 melee damage" with duration, trigger, and resource cost |
| `EffectInstance` | Active instance of an effect on a specific actor, with remaining duration and source tracking |
| `CheckResolver` | One deterministic pipeline for: attack rolls, saving throws, ability checks, contested checks, passive checks. Applies advantage/disadvantage, modifiers, proficiency, conditions. Used by combat AND out-of-combat |
| `SpatialState` | The hybrid model from Phase A, formalized as a kernel concept |

**Migration strategy:** Combat engine V2 keeps working as-is. Kernel modules are introduced alongside it. One mechanic at a time, combat delegates to the kernel instead of its internal logic. No big-bang rewrite.

#### B2. SRD as a content pack
Import the D&D 5e SRD as structured, queryable local data.

- Import [`5e-database`](https://github.com/5e-bits/5e-database) JSON into a normalized `srd-2014` content pack
- Add a `custom` content pack format from day one (homebrew, missing content, house rules)
- Build one lookup/query layer:
  - Look up by name (fuzzy match): "fireball", "goblin", "longsword"
  - Filter by category: "all 3rd-level wizard spells", "CR 5 or lower monsters"
  - Return structured data for the engine OR concise summaries for LLM context
- Wire as LLM tool calls: `lookup_spell`, `lookup_monster`, `lookup_class`, `lookup_equipment`, `search_srd`
- Keep raw imported JSON for traceability; app runs against normalized internal records
- Custom pack overrides SRD (homebrew takes precedence)

#### B3. Rich character state
Move from "name + stats + text inventory" to a real character profile.

- Characters stored as `ActorSheet` (kernel concept from B1)
- Class features, racial traits, spell lists, equipment with mechanical effects
- Proficiencies (skills, saves, tools, weapons, armor)
- Background and feat support
- Character creation UI updated to support the richer model
- Migration path for existing characters (backfill from current schema)

#### B4. Deterministic state ownership
The LLM stops being the source of truth for mechanics.

- HP, inventory, conditions, resources, spell slots, rests, and feature uses live in structured `ActorState`
- LLM context extraction continues for: world facts, NPC relationships, locations, plot state, quest progress
- Character persistence becomes one canonical `ActorSheet` JSON + derived UI, not scattered columns + free-text
- Add "narrative boundary" tests: verify the LLM never determines mechanical outcomes (damage, healing, slot usage, etc.)

---

### Phase C: Polish, Speed & Feature Depth

**Goal:** Make it feel good, run fast, and support the class features that make D&D characters distinctive.

**Why last:** These are all "better" not "necessary." The game is playable and mechanically sound after Phase B. Phase C is about depth and polish.

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
