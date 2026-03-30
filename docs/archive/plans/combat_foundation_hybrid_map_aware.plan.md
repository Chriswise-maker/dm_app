---
name: Combat Foundation - Hybrid Map-Aware
overview: Foundation plan for evolving the D&D 5e AI DM into a theater-of-mind-first, hybrid spatial, rules-backed system with a shared rules kernel and broader PC feature support.
isProject: false
---

# Combat Foundation Plan - Hybrid Map-Aware

## Summary

The combat rework is strong enough to keep, but it is not yet a complete foundation for the target product. The biggest current gaps are:

- The current docs overstate completeness: player spell saves exist in the engine but are not fully wired through the public UI/router in `routers.ts`.
- Movement, range, cover, engagement, Ready triggers, and opportunity attacks are only partially modeled in `combat-engine-v2.ts`, so "full action economy" is not yet truly DM-grade.
- Character state is too thin for "most PC features" in or out of combat: the current schema in `schema.ts` stores basic stats and inventory text, but not a canonical rules profile.

Direction locked for this plan:

- 2014 5e first
- hybrid spatial model, theater-of-mind primary
- SRD content pack plus custom overlays
- shared rules kernel, with combat as the first consumer

## Must Do Now

### 1. Close the current combat truth gaps

- Wire `AWAIT_SAVE_ROLL` end-to-end: `getState` must emit a save-type pending roll, the client dice roller must support it, and `submitRoll` must route it to `submitSavingThrow`.
- Stop advertising mechanics that are only placeholders. Either implement or temporarily gate:
  - `READY` trigger resolution
  - `OPPORTUNITY_ATTACK`
  - movement/range enforcement for `DASH` and `DISENGAGE`
- Add explicit tests for spell saves, ready/reaction timing, and movement-triggered reactions before calling the engine feature-complete.

### 2. Introduce a shared rules kernel

Build a shared layer below combat, instead of continuing to add mechanics directly into `CombatEntity` and ad hoc condition strings.

Required kernel concepts:

- `RulesContent`: canonical normalized rules objects with stable IDs, source pack, version, and category
- `ActorSheet`: structured character/creature definition with ancestry/class/build, proficiencies, spells, equipment, senses, speeds, resources, and feature references
- `ActorState`: current HP, temp HP, conditions, resource usage, concentration, inventory state, rest state, and active effect instances
- `EffectDefinition` and `EffectInstance`: typed modifiers and triggers for "while raging," "advantage on STR checks," "+10 movement," "once per short rest," and similar mechanics
- `CheckResolver`: one deterministic resolution pipeline for attacks, saves, ability checks, contests, and passive checks
- `SpatialState`: theater-of-mind-first battle positioning with engagement/range/cover/zone facts, plus optional exact coordinates later

Design rule:

- Combat becomes one consumer of this kernel, not the owner of all rules logic.

### 3. Make SRD a content pack, not the schema

Use the SRD integration prompt as an ingestion phase, but not as the architecture.

Implementation shape:

- Import `5e-database` into a normalized local `srd-2014` content pack
- Add a `custom` content pack/overlay format from day one for homebrew, missing official-like content, and future off-SRD features
- Keep raw imported JSON for traceability, but run the app against normalized internal records
- Build one lookup/query layer used by both:
  - LLM tool calls
  - deterministic rules/kernel consumers

This avoids coupling the app to raw `5e-database` shapes and keeps the door open for a future licensed compendium importer.

### 4. Replace LLM-extracted mechanics with deterministic state ownership

Mechanical truth should not depend on narrative extraction.

- HP, inventory, conditions, resources, spell slots, rests, and feature uses must live in structured state owned by the rules layer.
- LLM context extraction can continue to enrich world facts, relationships, locations, and plot state, but not be the primary source of mechanical truth.
- Character persistence should move toward one canonical rules profile JSON plus derived UI fields, rather than scattered scalar columns plus free-text inventory.

### 5. Define the hybrid spatial model now

Required spatial facts:

- who is engaged with whom
- reach and melee adjacency
- range bands
- cover and line-of-effect flags
- zones and area membership
- speeds and movement modes

Primary UX:

- players still speak naturally
- DM still narrates spatially
- engine stores enough structure to enforce movement, reach, AoEs, reactions, stealth exposure, and later optional map coordinates

## Can Add Later

- Broader PC feature coverage after the kernel exists: Sneak Attack, Rage, Bardic Inspiration, Action Surge, Divine Smite, Wild Shape, Shield, Counterspell, and similar mechanics
- Optional exact map/grid UI layered on top of `SpatialState`
- Better enemy tactics once spatial and trigger data becomes reliable
- Richer out-of-combat systems on the same kernel: skill challenges, travel, stealth, social checks, rests, downtime, crafting
- Future licensed compendium adapter, if broader official coverage is ever needed beyond SRD plus custom overlays

## Test Plan

- Contract tests for `submitRoll` covering `initiative`, `attack`, `damage`, `deathSave`, and `save`
- Regression tests for `READY`, reactions, opportunity attacks, and movement-triggered events
- Import and normalization tests for SRD pack records and custom overlay precedence
- Actor/resource/effect tests for spell slots, rest resets, concentration, feature uses, and condition duration
- Sync tests ensuring combat state, actor state, and persisted character state cannot drift
- Narrative boundary tests verifying the LLM never becomes the source of mechanical outcomes

## Assumptions

- Baseline rules target is 2014 5e
- The product remains theater-of-mind first, not grid-first
- SRD/Open5e is seed data only; internal schema is canonical
- Custom, homebrew, and off-SRD content are first-class from the start
- The LLM continues to parse intent and narrate outcomes, but deterministic systems own all mechanics
