# Character sheet UI (client)

## Overview

The full character sheet lives under `client/src/components/character-sheet/`. It is driven by kernel types shared with the server:

- **`ActorSheet`** (`server/kernel/actor-sheet.ts`) — static build data (class, proficiencies, equipment, spellcasting, features).
- **`ActorState`** (`server/kernel/actor-state.ts`) — runtime state (HP, temp HP, slots, feature uses, conditions, gold, etc.).

`tRPC` `characters.list` parses `stats`, `inventory`, `actorSheet`, and `actorState` so the React tree receives objects, not raw JSON strings.

## Component map

| File | Role |
|------|------|
| `CharacterSheet.tsx` | Orchestrator: picks `actorState` HP over flat DB columns when present; AC from sheet when present; legacy fallbacks when `actorSheet` is missing. |
| `IdentityHeader.tsx` | Name, ancestry, class/subclass, level, background, proficiency bonus. |
| `VitalityDefense.tsx` | HP bar, temp HP, AC + source, hit dice; HP adjust buttons. |
| `StatusBar.tsx` | Conditions, concentration, exhaustion, death saves — **hidden** when all are empty. |
| `AbilityScores.tsx` | Six abilities, save mods, initiative, passive Perception. |
| `SkillsSection.tsx` | All 18 skills; modifiers from `useCharacterDerived`. |
| `SpellcastingSection.tsx` | DC, attack bonus, slot dots, cantrips/spells — only if `sheet.spellcasting` is set. |
| `EquipmentSection.tsx` | Renders when `sheet.equipment.length > 0`; gold from `state.gold`. |
| `FeaturesSection.tsx` | Class features + uses; feats list. |
| `MovementSenses.tsx` | Speeds and senses. |
| `ProficienciesSection.tsx` | Weapon/armor/tool lines. |
| `shared/*` | `CollapsibleSection`, `ResourceDots`, `AdjustButtons`. |

## Derived values

`hooks/useCharacterDerived.ts` computes modifiers, skill totals, passive Perception, and initiative from `ActorSheet`. Skill proficiency matching **normalizes** skill names (spaces / underscores / hyphens) so values like `sleight_of_hand` still match the UI’s `"Sleight of Hand"` row.

## Server mutations

| Mutation | Used by UI today | Notes |
|----------|------------------|-------|
| `characters.updateHP` | **Yes** — `CharacterPanel` HP buttons | Updates `characters.hpCurrent` **and** merges `hpCurrent` into `actorState` when `actorState` exists (see `server/db.ts` `updateCharacterHP`). Keeps the sheet display (`state.hpCurrent` preferred) aligned with the flat column and list cards. |
| `characters.updateState` | **Not wired** in `CharacterPanel` yet | Supports `hpCurrent`, `tempHp`, `spellSlotsCurrent`, `hitDiceCurrent`, `featureUses`, `exhaustion`, `gold`, `deathSaves`, `concentration`. **Does not** include `conditions` in the Zod input — add if the UI needs to edit conditions from the panel. Requires existing `actorState` or throws. |

## Integration notes

1. **HP display priority** — `CharacterSheet` uses `state?.hpCurrent ?? character.hpCurrent`. Without syncing `actorState` on manual HP changes, the sheet could show stale HP while the list showed the column value; `updateCharacterHP` now updates both.

2. **Feature uses display** — Remaining uses default to **`usesMax`** when the key is missing (safer than showing `0/max` for migrated or partial data).

3. **Equipment section** — If `equipment` is empty but legacy `inventory` exists, only the legacy block in `formatCharacterSheet` (server prompts) shows items; the rich **Equipment** section does not render until `actorSheet.equipment` is populated.

4. **Typecheck** — Client imports types from `server/kernel/*`; `pnpm check` must include both trees (it does).

## Verification

```bash
pnpm check
pnpm test
pnpm dev   # open a session with a generated character (actorSheet + actorState)
```
