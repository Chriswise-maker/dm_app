# Tasks — Phase C: Polish, Speed & Feature Depth

> **Phase B (Rules Kernel & SRD Content) is complete** — all 11 steps done as of ~2026-03-31.
> Phase B task history is preserved below for reference.

---

## Phase C Tasks

### ✅ C0. Real D&D combat foundation — COMPLETE (~2026-04-03)

**Goal:** Characters enter combat with real spells, real weapons, correct proficiencies, and class features.

**What was built:**

1. ✅ **`server/srd/character-builder.ts`** — `buildActorSheet(input, loader)` produces fully-populated ActorSheet from SRD class/race/equipment data. Spell selection heuristics per class, Unarmored Defense, proficiency derivation. 14 tests.
2. ✅ **Wire into character creation** — Both `characters.create` and `characters.generate` call the builder. Spell slot tracker in combat sidebar. Named weapon/spell actions in legal action list. Battlefield snapshot shows class + weapons + spells.
3. ✅ **Spell attack rolls** — Fire Bolt, Eldritch Blast, etc. route through `AWAIT_ATTACK_ROLL` with `isSpellAttack` flag. Enemy spell attacks auto-resolve. Cantrip damage scales with caster level.
4. ✅ **Weapons as first-class array** — `CombatEntity.weapons[]` + `WeaponEntrySchema` populated from ActorSheet equipment via `buildCombatWeapons()`. Named attack actions per weapon. Weapon-specific damage type and attack bonus. Fallback for enemies without SRD data.
5. ✅ **Save proficiencies + proficiency bonus** — `isProficientInSave()` reads `saveProficiencies[]`, `getProficiencyBonus()` reads entity data, `getSpellAttackStat()` uses `spellcastingAbility` from ActorSheet (not hardcoded INT).
6. ✅ **Enemy SRD enrichment** — `enrichEnemyFromSrd()` imports multi-attack counts, named weapon actions, real damage stats, ability scores, and save proficiencies from `monsters.json`.

**Also completed:**
- `characterClass` field on `CombatEntity` — DM sees "[Wizard]" in battlefield snapshot
- `spellcastingAbility` field on `CombatEntity` — spell attacks use correct ability (WIS for Cleric, INT for Wizard, etc.)
- `addPlayer` endpoint now builds full CombatEntity from ActorSheet (was legacy-only)
- Combat narrator: weapon-aware descriptions, critical hit intensity scaling
- Player action parser: context-aware (recent messages resolve "I'll do that" / "yes")
- Question detection in all await-roll phases (damage, save, attack)
- Combat initiation reliability (explicit combat request detection)
- Narration flow: single combined hit+damage narration instead of two separate ones
- axios → native fetch (removed dependency)

**227 tests pass. Zero TypeScript errors.**

> **C2 note:** Steps 5 and part of Step 2 complete C2.0d and all of C2.1 (save proficiencies, Extra Attack from sheet, Unarmored Defense, proficiency bonus). Those items are struck from C2 below.

---

### C1. Tiered models for speed
Use fast/cheap models for structured combat tasks, reserve the main model for storytelling.

| LLM call | Current | Target |
|----------|---------|--------|
| Enemy AI decisions | Main model (~3s) | Fast model (~0.4s) |
| Combat narration | Main model (~3s) | Fast model (~0.7s) |
| Player action parsing | Main model (~2s) | Fast model (~0.3s) |
| DM chat/roleplay | Main model | Keep main model |

- Add a `fastModel` setting in `userSettings` (defaults to provider's fast tier)
- Route enemy AI, combat narration, and action parsing through `fastModel`
- Keep DM narrative and roleplay on the main model
- Target: 3-enemy round drops from ~12-24s to ~3-5s

### C2. PC class features

> **Prerequisite:** C0 must be complete. C0 already delivers C2.0d and all of C2.1 — those are struck below. C2 starts at C2.0a.

With the kernel in place, add features that make characters distinctive. The goal is for class features to flow from `ActorSheet.features` into the combat engine automatically — not hardcoded per class.

#### Scope

Implement these features for the current party composition. Skip Wild Shape, Metamagic, and Channel Divinity — too complex for this phase.

~~**Tier 1 (passive/auto):** Extra Attack (from sheet), proficiency-aware saves, Unarmored Defense~~ ✅ done in C0  
**Tier 2 (simple activated):** Second Wind, Action Surge, Cunning Action  
**Tier 3 (conditional damage):** Sneak Attack, Divine Smite  
**Tier 4 (sustained effects):** Rage  
**Tier 5 (ally-targeted):** Bardic Inspiration, Lay on Hands

---

#### C2.0 — Engine prerequisites

These engine changes are required before any features land. Do these in a single pass.

**a) Wire `extra_damage` modifier into damage application**

`extra_damage` is defined in `ModifierSchema` but never consumed. In `combat-engine-v2.ts`, in `applyWeaponDamage()` (and the spell damage equivalent), after computing base damage: collect all `extra_damage` modifiers from the attacker's `activeModifiers[]`, roll each formula, sum, add to total. This is the foundation for Sneak Attack, Divine Smite, and Rage damage bonus.

**b) Wire `damage_resistance` / `damage_immunity` into damage application**

Currently resistances/immunities come from `CombatEntity.resistances[]` (a string array). Add a second pass: also check `activeModifiers` for `damage_resistance` and `damage_immunity` entries. This is the foundation for Rage's damage reduction.

**c) Condition duration decay at round end**

`ActiveCondition` has a `duration?: number` field but `advanceRound()` never decrements it. At round end, for each entity, decrement `duration` on all `activeConditions` that have one set. Remove conditions where `duration` reaches 0. Emit a log entry per condition removed. This is the foundation for Rage's 10-round limit and any timed buff.

~~**d) Fix `isProficientInSave()` in `combat-adapter.ts`**~~ ✅ done in C0 Step 5

**e) Add `ability_check_advantage` modifier type**

`advantage` modifier currently applies to `"attack" | "save" | "ability_check"`. Rage needs advantage specifically on STR ability checks and STR saves. The existing `advantage` modifier type already supports this — verify `resolveCheck()` correctly applies it when `type === "ability_check"` and `stat === "str"`. Add a test case. No schema change needed if it already works; just confirm and test.

**Done when:** `pnpm test` passes with new test coverage for (a)–(c) and (e). No feature behavior changes, just foundations.

---

#### C2.1 — ✅ Delivered in C0

~~Extra Attack from ActorSheet, Unarmored Defense, Proficiency bonus accuracy~~ — all done in C0 Steps 1, 2, and 5.

**Done when:** Fighter 5 test shows correct extra attacks; Barbarian Unarmored Defense computes correct AC from stats.

---

#### C2.2 — Tier 2: Simple activated features

All three features here are **player-initiated actions** — they surface as legal actions the player can choose. No LLM involvement.

**Second Wind (Fighter)**

- Bonus action. Heal `1d10 + fighter level` HP. Recharges on short rest.
- `ActorSheet.features[]` will have `{ name: "Second Wind", usesMax: 1, rechargeOn: "short_rest" }`.
- Add `"SECOND_WIND"` to the legal action list for fighters when: `bonusActionUsed === false` AND `featureUses["Second Wind"] > 0`.
- On use: consume bonus action, decrement `featureUses["Second Wind"]` in `ActorState`, roll `1d10 + level`, apply healing (capped at `maxHp`), log result.
- Healing mechanic: `applyHealing(entityId, amount)` — add this helper to the combat engine if it doesn't exist (it likely doesn't). HP increases by `amount`, capped at `maxHp`, removes `unconscious` condition if at 0.

**Action Surge (Fighter)**

- Free action (costs nothing, doesn't use action/bonus/reaction). Grants one additional action this turn. Once per short rest.
- `ActorSheet.features[]`: `{ name: "Action Surge", usesMax: 1, rechargeOn: "short_rest" }`.
- Add a `actionSurgeAvailable: boolean` to `TurnResources` (or derive it from `featureUses`).
- Add `"ACTION_SURGE"` to legal actions when: `featureUses["Action Surge"] > 0` AND turn is active.
- On use: decrement `featureUses["Action Surge"]`, set `actionUsed = false` (re-opens the action slot for this turn), log "Fighter surges — one additional action available."
- After surge, next attack/spell/dash etc. consumes the re-opened action normally.

**Cunning Action (Rogue)**

- Lets the rogue use Dash, Disengage, or Hide as a bonus action (instead of an action).
- No new "use" to track — it's a permanent class ability once you have it.
- When building legal actions for a rogue (detected via `characterClass === "Rogue"` on `ActorSheet`), add DASH, DISENGAGE, HIDE to the **bonus action** legal list if `bonusActionUsed === false`, regardless of `actionUsed`.
- These actions already exist as DASH/DISENGAGE — just route them through bonus action cost instead of action cost when the entity has Cunning Action.
- Add `hasCunningAction: boolean` to `CombatEntity` (derived from `ActorSheet` at entity creation).

**Done when:** Each feature appears in the legal action list for the right class, consumes the right resource, and produces the right outcome. Tests for each.

---

#### C2.3 — Tier 3: Conditional damage

Both features trigger *after* a successful attack hit is confirmed, before or during damage application.

**Sneak Attack (Rogue)**

Rules: Once per turn, add `⌈level/2⌉d6` damage to one attack if the rogue has advantage OR an ally is within melee range of the target. Applies to finesse/ranged weapons only.

- Track `sneakAttackUsedThisTurn: boolean` on `TurnResources` (reset at turn start).
- After a hit is confirmed in `resolveAttackRoll()`, check if Sneak Attack applies:
  1. Entity has `characterClass === "Rogue"` (from `ActorSheet` via new field on `CombatEntity`)
  2. Weapon is finesse or ranged (check `attackType` on the pending attack)
  3. `sneakAttackUsedThisTurn === false`
  4. Either: attack had advantage, OR any ally is in MELEE range of the target (check `state.entities`)
- If conditions met: add an `extra_damage` modifier to the pending attack's damage resolution for `⌈level/2⌉d6` piercing. Set `sneakAttackUsedThisTurn = true`.
- Don't prompt the player — apply automatically and narrate it.
- Add level to `CombatEntity` (currently missing; derive from `ActorSheet`).

**Divine Smite (Paladin)**

Rules: After hitting with a melee attack, may expend a spell slot to deal `(1 + slot_level)d8` radiant damage (+1d8 extra vs undead/fiends, max 5d8 total).

- After a hit is confirmed (melee only), if the attacker is a Paladin with spell slots remaining: enter a new phase `AWAIT_SMITE_DECISION`.
- In this phase, the player chooses: smite with slot level 1/2/3 (or decline).
- On smite: consume slot from `ActorState.spellSlotsCurrent`, compute `(slot_level + 1)d8` radiant (check target creature type for +1d8), add as `extra_damage` to the current attack.
- On decline: proceed to damage roll normally.
- `AWAIT_SMITE_DECISION` must be added to `CombatPhase` enum and handled in the legal-actions list.
- The target creature type ("undead", "fiend") needs to come from SRD monster data — add a `creatureType?: string` field to `CombatEntity`, populate from SRD on enemy creation.

**Done when:** Sneak Attack auto-applies with correct dice for rogue level. Divine Smite prompts appear correctly for paladins, consume slots, deal correct damage. Tests for both.

---

#### C2.4 — Tier 4: Sustained effects

**Rage (Barbarian)**

Rules: Bonus action to activate. Lasts 10 rounds (or until can't attack and didn't take damage since last turn — simplified: just use 10-round duration). Grants:
- Advantage on STR checks and STR saves
- Resistance to bludgeoning, piercing, slashing damage
- +2/3/4 bonus to STR-based melee damage (levels 1–8 / 9–15 / 16–20)
- `usesMax` per long rest (2/3/4/unlimited based on level)

Implementation:
- Add `"RAGE"` to legal bonus actions for Barbarians when `bonusActionUsed === false` AND `featureUses["Rage"] > 0` AND not already raging.
- On activation: consume bonus action, decrement `featureUses["Rage"]` in `ActorState`, apply an `ActiveCondition` named `"raging"` with `duration: 10`.
- Apply these modifiers to the entity's `activeModifiers[]` while raging:
  - `{ type: "advantage", appliesTo: "save", stat: "str" }`
  - `{ type: "advantage", appliesTo: "ability_check", stat: "str" }`
  - `{ type: "damage_resistance", damageType: "bludgeoning" }`
  - `{ type: "damage_resistance", damageType: "piercing" }`
  - `{ type: "damage_resistance", damageType: "slashing" }`
  - `{ type: "extra_damage", formula: "+2", damageType: "rage_bonus", condition: "str_melee_only" }` — but this needs a `condition` gate
- The damage bonus is the tricky part: it only applies to STR-based melee attacks. Add an optional `condition` field to the `extra_damage` modifier: `"str_melee_only"` | `"always"`. In `applyWeaponDamage()`, only apply extra_damage modifiers where `condition === "always"` OR (`condition === "str_melee_only"` AND the attack uses STR AND is melee). Add "+2" as a flat bonus (not a dice roll).
- When the `"raging"` condition expires (duration hits 0 via C2.0c): remove the three resistance modifiers and two advantage modifiers from `activeModifiers[]`. Log "Rage ends."

**Done when:** Rage activates, grants correct bonuses, auto-expires after 10 rounds. Resistance halves the right damage types. Tests covering activation, damage application, and expiry.

---

#### C2.5 — Tier 5: Ally-targeted features

**Bardic Inspiration (Bard)**

Rules: Bonus action. Target one ally within 60 feet. They receive a Bardic Inspiration die (d6/d8/d10/d12 based on level). They can use it within 10 minutes (simplified: until end of combat) to add to one attack roll, ability check, or saving throw — declared *after* the roll.

This is the most complex feature because it creates state on another entity.

- Add `bardicInspirationDie?: string` to `CombatEntity` (e.g., `"d8"`). Null means no die held.
- Add `"BARDIC_INSPIRATION"` to legal bonus actions for Bards when `bonusActionUsed === false` AND `featureUses["Bardic Inspiration"] > 0`.
- On use: prompt player to select target ally (new sub-phase `AWAIT_INSPIRATION_TARGET` or just pass target in payload). Consume bonus action, decrement use, set `target.bardicInspirationDie = "d8"` (based on bard level). Log "Bard inspires [name] — they hold a d8."
- When the inspired entity makes an attack roll, save, or ability check: if they have `bardicInspirationDie` set, add `"USE_BARDIC_INSPIRATION"` as a legal action during their turn (or as a reaction/modifier option). On use: roll the die, add to the roll result, clear `bardicInspirationDie`. Log result.
- For simplicity in phase 1: only let them use it on attacks (not saves/checks). Saves/checks can come later.

**Lay on Hands (Paladin)**

Rules: Action. Touch an ally (MELEE range). Heal up to X HP from a pool (Paladin level × 5, replenishes on long rest). Can also cure disease/poison for 5 HP per condition.

- Store pool as `featureUses["Lay on Hands"]` — initialized to `level * 5` in `deriveInitialState()`.
- Add `"LAY_ON_HANDS"` to legal actions for Paladins when `actionUsed === false` AND `featureUses["Lay on Hands"] > 0` AND a valid ally is in MELEE range.
- On use: prompt for heal amount (1 to remaining pool). Consume action, reduce `featureUses` by amount, apply `applyHealing(target, amount)`.
- No need for disease/cure mechanic in phase 1.

**Done when:** Bardic Inspiration transfers die to ally and can be consumed on their next attack. Lay on Hands depletes pool correctly and heals target.

---

#### C2 Dependency order

```
C2.0 (engine prereqs)
  └─ C2.1 (passive)
       └─ C2.2 (simple activated)
            ├─ C2.3 (conditional damage)   ← needs extra_damage from C2.0a
            ├─ C2.4 (Rage)                 ← needs condition decay from C2.0c + extra_damage condition gate
            └─ C2.5 (ally-targeted)        ← needs applyHealing from C2.2
```

#### What's explicitly out of scope for C2

- **Wild Shape** — replaces entity stats entirely; needs a full entity-swap mechanic
- **Metamagic** (Sorcerer) — modifies spell resolution at cast time; complex intercept points
- **Channel Divinity** — highly varied per subclass; defer until subclass system exists
- **Shield / Counterspell** (reactions) — needs an interrupt/reaction phase in the combat loop; defer to C2 follow-up or its own task
- **Monk** features (Flurry of Blows, Stunning Strike, Ki) — deferred; Monk not in current party
- **Warlock** (Eldritch Blast invocations, Hex persistence) — deferred

### C3. Combat sidebar & UI polish
- HP bars with gradient styling and animations
- Turn indicator animations
- Confirm dialog before ending combat
- Responsive/mobile-friendly layout
- Character sheet panel (expandable, shows full `ActorSheet`)
- Spell list reference during combat

### C4. Smarter enemy tactics
Leverage spatial data + kernel state for better AI:
- Ranged enemies maintain FAR/NEAR distance; melee enemies close in
- Enemies target based on threat assessment + spatial opportunity
- Boss monsters use legendary actions and lair actions

### C5. Out-of-combat systems (on the kernel)
- Skill challenges (multi-check structured encounters)
- Travel and exploration mechanics
- Social encounter framework
- Shopping with SRD equipment data

---

## Phase B History (✅ Complete ~2026-03-31)

<!--
  Phase B: 11 steps. All complete.
  Dependency order: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11

  Chat scenarios:
    scripts/scenarios/step-6.json  — SRD tool call test
    scripts/scenarios/step-8.json  — combat with real spells
-->

## ✅ 1. Kernel schemas: ActorSheet + ActorState

Create a new directory `server/kernel/`. This is the rules layer that sits *below* combat — combat becomes a consumer, not the owner of all rules.

**Create `server/kernel/actor-sheet.ts`:**

Define a Zod schema `ActorSheetSchema` for a full character/creature definition. Use `z` from the existing `zod` dependency (Zod 4 — import as `import { z } from 'zod'`).

Fields:
- `id`: string (uuid)
- `name`: string
- `ancestry`: string (e.g. "Half-Elf", "Human")
- `characterClass`: string (e.g. "Wizard") — avoid `class` since it's a reserved word
- `subclass`: string or null (e.g. "Necromancy")
- `level`: number 1–20
- `abilityScores`: object with `str`, `dex`, `con`, `int`, `wis`, `cha` (each number 1–30)
- `proficiencyBonus`: number (derived from level: `Math.floor((level - 1) / 4) + 2`)
- `proficiencies`: object with:
  - `saves`: array of ability stat strings
  - `skills`: string array
  - `weapons`: string array
  - `armor`: string array
  - `tools`: string array
- `speeds`: object with `walk` (required), `fly`, `swim`, `climb`, `burrow` (all optional numbers)
- `senses`: object with `darkvision`, `blindsight`, `tremorsense`, `truesight` (all optional numbers)
- `hitDie`: string (e.g. "d6")
- `maxHp`: number
- `ac`: object with `base` (number) and `source` (string, e.g. "mage_armor")
- `spellcasting`: null or object with:
  - `ability`: ability stat string
  - `saveDC`: number
  - `attackBonus`: number
  - `cantripsKnown`: string array
  - `spellsKnown`: string array (spell names)
  - `spellSlots`: record of number → number (spell level → max slots)
- `equipment`: array of objects with `name` (string), `type` (string), `properties` (optional record)
- `features`: array of objects with `name`, `source`, `description` (strings), `usesMax` (optional number), `rechargeOn` (optional "short_rest" | "long_rest")
- `background`: string or null
- `feats`: string array

Also export a type alias: `type ActorSheet = z.infer<typeof ActorSheetSchema>`

Also export a shared `AbilityStat` type/schema: `z.enum(["str", "dex", "con", "int", "wis", "cha"])`

**Create `server/kernel/actor-state.ts`:**

Define `ActorStateSchema`:
- `actorId`: string
- `hpCurrent`: number
- `hpMax`: number
- `tempHp`: number (default 0)
- `conditions`: array — reuse the `ActiveConditionSchema` from `server/combat/combat-types.ts` (import it)
- `spellSlotsCurrent`: record of number → number (spell level → remaining)
- `hitDiceCurrent`: number
- `featureUses`: record of string → number (feature name → remaining uses)
- `concentration`: null or object with `spellName` (string) and `saveDC` (number)
- `deathSaves`: object with `successes` and `failures` (both number, default 0)
- `exhaustion`: number 0–6 (default 0)

Export type alias `type ActorState = z.infer<typeof ActorStateSchema>`

**Create a helper function `deriveInitialState(sheet: ActorSheet): ActorState`** in `actor-state.ts`:
- Sets `hpCurrent` = `hpMax` = `sheet.maxHp`
- Sets `tempHp` = 0, `conditions` = [], `exhaustion` = 0
- Sets `spellSlotsCurrent` from `sheet.spellcasting.spellSlots` (all full)
- Sets `hitDiceCurrent` = `sheet.level`
- Sets `featureUses` from `sheet.features` (each at `usesMax`)
- Sets `deathSaves` = `{ successes: 0, failures: 0 }`
- Sets `concentration` = null

**Create `server/kernel/index.ts`:**

Barrel export: re-export everything from `actor-sheet.ts` and `actor-state.ts`.

**Create `server/kernel/__tests__/schemas.test.ts`:**

Use Vitest. Tests:

1. **Valid wizard ActorSheet** — Build a sheet matching Silas Gravemourn (level 5 Necromancy Wizard, STR 8, DEX 14, CON 13, INT 15, WIS 12, CHA 10, HP 28, AC 12). Validate it parses without error.
2. **Valid ActorState** — Full HP, 2 first-level slots used (2 of 4 remaining), concentrating on Mage Armor. Validate.
3. **Reject invalid data** — Level 0, negative HP, missing abilityScores. Each should throw a Zod validation error.
4. **deriveInitialState** — Pass the wizard sheet, verify the state has full HP, all spell slots, hit dice = 5, no conditions.

**Done when:** `pnpm check` passes, `pnpm test` passes including the new schema tests. No existing files modified.

## ✅ 2. Effect system: EffectDefinition + EffectInstance + pipeline

Build the effect/modifier system in the kernel. This models buffs, debuffs, spell effects, and class features as typed data.

**Create `server/kernel/effect-types.ts`:**

Import `AbilityStat` from `./actor-sheet`.

Define a discriminated union `ModifierSchema` using `z.discriminatedUnion("type", [...])`:

| type | additional fields |
|------|------------------|
| `stat_bonus` | `stat: AbilityStat`, `value: number` |
| `ac_bonus` | `value: number` |
| `attack_bonus` | `value: number` |
| `save_bonus` | `stat: AbilityStat or "all"`, `value: number` |
| `damage_resistance` | `damageType: string` |
| `damage_immunity` | `damageType: string` |
| `damage_vulnerability` | `damageType: string` |
| `condition_immunity` | `condition: string` |
| `advantage` | `on: "attack" or "save" or "ability_check"`, `stat: AbilityStat` (optional) |
| `disadvantage` | `on: "attack" or "save" or "ability_check"`, `stat: AbilityStat` (optional) |
| `extra_damage` | `formula: string`, `damageType: string` |
| `speed_bonus` | `value: number` |
| `temp_hp` | `value: number` |

Define `EffectDefinitionSchema`:
- `id`: string
- `name`: string
- `source`: enum `"spell" | "class_feature" | "racial_trait" | "item" | "condition" | "feat"`
- `duration`: object with `type`: enum `"instant" | "rounds" | "minutes" | "hours" | "until_dispelled" | "until_rest"` and optional `value: number`
- `requiresConcentration`: boolean (default false)
- `modifiers`: array of `ModifierSchema`

Define `EffectInstanceSchema`:
- `id`: string
- `definitionId`: string (references EffectDefinition.id)
- `sourceActorId`: string
- `targetActorId`: string
- `remainingRounds`: number or null (null = permanent / concentration-based)
- `appliedAtRound`: number

Export types for all schemas.

**Create `server/kernel/effect-pipeline.ts`:**

Pure functions (no side effects, no mutation):

```typescript
// Collect all active modifiers from a set of effect instances
function getActiveModifiers(
  instances: EffectInstance[],
  definitions: Map<string, EffectDefinition>
): Modifier[]

// Decrement durations, return instances that are still active (filter out expired)
function tickEffects(instances: EffectInstance[]): EffectInstance[]

// Check if adding a concentration effect should remove an existing one
function resolveConcentration(
  instances: EffectInstance[],
  definitions: Map<string, EffectDefinition>,
  newDefinition: EffectDefinition
): EffectInstance[]  // returns updated instances (old concentration removed if needed)
```

**Update `server/kernel/index.ts`:** Add exports for effect types and pipeline.

**Create `server/kernel/__tests__/effects.test.ts`:**

1. **Modifier collection** — Create a "Rage" EffectDefinition with `damage_resistance` (bludgeoning, slashing, piercing) and `extra_damage` (+2 melee). Create an instance. Call `getActiveModifiers` → verify 4 modifiers returned.
2. **Duration ticking** — Instance with `remainingRounds: 2` → tick → `remainingRounds: 1` → tick → `remainingRounds: 0` → filtered out.
3. **Concentration replacement** — Actor concentrating on Shield of Faith. Cast Bless (also concentration). `resolveConcentration` → Shield of Faith instance removed, Bless can be added.
4. **Null duration** — Instance with `remainingRounds: null` (permanent effect like a racial trait) → tick → still present.

**Done when:** `pnpm check` passes, `pnpm test` passes. No existing files modified.

## ✅ 3. CheckResolver: unified d20 pipeline

Build a single pure function that resolves any d20-based check in D&D 5e. This will replace the scattered modifier math in the combat engine and skill check resolver.

**Create `server/kernel/check-resolver.ts`:**

```typescript
import { z } from 'zod';
import type { AbilityStat } from './actor-sheet';
import type { Modifier } from './effect-types';

interface CheckInput {
  type: 'attack' | 'save' | 'ability_check' | 'contest';
  // Actor's ability scores:
  abilityScores: { str: number; dex: number; con: number; int: number; wis: number; cha: number };
  proficiencyBonus: number;
  // Which ability applies:
  stat: AbilityStat;
  isProficient: boolean;
  // Active modifiers from effects:
  activeModifiers: Modifier[];
  // Target to beat:
  dc?: number;           // for saves and ability checks
  targetAC?: number;     // for attacks
  // Dice injection (exactly one should be provided):
  preRolledD20?: number; // from visual dice UI
  rollFn?: () => number; // for testing — returns 1-20
  // Context flags from the caller:
  hasAdvantage?: boolean;
  hasDisadvantage?: boolean;
}

interface CheckResult {
  d20Roll: number;
  secondD20?: number;       // shown when advantage/disadvantage applied
  usedAdvantage: boolean;
  usedDisadvantage: boolean;
  abilityMod: number;
  proficiencyMod: number;
  effectBonuses: number;    // sum of matching effect modifiers
  total: number;
  success: boolean;
  isCritical: boolean;      // nat 20
  isFumble: boolean;        // nat 1
}

export function resolveCheck(input: CheckInput): CheckResult
```

Implementation logic:
1. Compute ability modifier: `Math.floor((score - 10) / 2)`
2. Add proficiency bonus if `isProficient`
3. Scan `activeModifiers` for matching bonuses:
   - For `type: 'attack'`: sum `attack_bonus` modifiers
   - For `type: 'save'`: sum `save_bonus` modifiers where `stat` matches or is `"all"`
   - For `type: 'ability_check'`: sum `stat_bonus` modifiers where `stat` matches
4. Scan for `advantage` and `disadvantage` modifiers matching the check type, combine with caller-provided `hasAdvantage`/`hasDisadvantage`. If both advantage and disadvantage present, they cancel → straight roll.
5. Roll d20 (use `preRolledD20` if provided, else `rollFn`, else `Math.ceil(Math.random() * 20)`)
   - With advantage: roll twice, take higher
   - With disadvantage: roll twice, take lower
6. Compute total = d20 + abilityMod + proficiencyMod + effectBonuses
7. Determine success:
   - Attack: nat 20 always hits, nat 1 always misses, otherwise total >= targetAC
   - Save/ability_check: total >= dc
8. Return the full `CheckResult`

Also export a utility: `export function getAbilityMod(score: number): number`

**Create `server/kernel/__tests__/check-resolver.test.ts`:**

All tests use an injectable `rollFn` — no randomness.

1. **Basic attack hit** — STR 16 (+3), proficiency +2, no effects, roll 13 → total 18 vs AC 15 → hit
2. **Basic attack miss** — Same setup, roll 5 → total 10 vs AC 15 → miss
3. **Save success** — DEX 14 (+2), proficient in DEX saves (+2), roll 12 → total 16 vs DC 15 → pass
4. **Save failure** — CON 10 (+0), not proficient, roll 8 → total 8 vs DC 15 → fail
5. **Ability check** — INT 15 (+2), proficient (+2), roll 11 → total 15 vs DC 15 → pass
6. **Effect bonus stacking** — Attack with two `attack_bonus` modifiers (+1 and +2) → both added to total
7. **Advantage** — Roll 8 and 15 (rollFn returns them in sequence) → uses 15
8. **Disadvantage** — Roll 18 and 6 → uses 6
9. **Advantage + disadvantage cancel** — Roll once (straight), not twice
10. **Nat 20 always hits** — Roll 20, target AC 30 → hit, `isCritical: true`
11. **Nat 1 always misses** — Roll 1, target AC 5, +15 modifier → miss, `isFumble: true`
12. **Nat 20/1 on saves don't auto-pass/fail** — D&D 5e 2014 rules: nat 20 on a save is just 20 + mods, not auto-success (unlike attacks)

**Update `server/kernel/index.ts`:** Add CheckResolver exports.

**Done when:** `pnpm check` passes, `pnpm test` passes. CheckResolver handles all standard D&D 5e roll mechanics. No existing files modified — wiring into combat comes in Step 10.

## ✅ 4. SRD data import: download and normalize all categories

Get the 5e SRD data into the project as structured, queryable JSON files.

**Step A — Download the raw data:**

Run `git clone --depth 1 https://github.com/5e-bits/5e-database.git data/raw/5e-database` to get the source data. The JSON files we need are in `data/raw/5e-database/src/`. If git clone doesn't work, use `curl` or `fetch` to download the individual JSON files from the GitHub raw URL.

After downloading, add `data/raw/` to `.gitignore` (raw downloads should not be committed).

**Step B — Create the import script `scripts/import-srd.ts`:**

A Node script (run with `npx tsx scripts/import-srd.ts`) that reads raw 5e-database files and writes normalized JSON to `data/srd-2014/`.

**Normalization targets:**

`data/srd-2014/spells.json` — Array of normalized spell objects:
```typescript
{
  name: string,           // "Fireball"
  level: number,          // 3 (0 for cantrips)
  school: string,         // "evocation"
  castingTime: string,    // "action" | "bonus_action" | "reaction" | "1 minute" | ...
  range: string,          // "150 feet" | "Self" | "Touch"
  components: string[],   // ["V", "S", "M"]
  material?: string,      // material component description
  duration: string,       // "Instantaneous" | "Concentration, up to 1 minute" | ...
  requiresConcentration: boolean,
  ritual: boolean,
  description: string,    // full text description
  damageFormula?: string, // "8d6" (if damage spell)
  damageType?: string,    // "fire"
  healingFormula?: string,// "1d8" (if healing spell)
  saveStat?: string,      // "dex" (if requires save)
  saveEffect?: string,    // "half_damage" | "no_effect" | "special"
  isAreaEffect: boolean,
  areaSize?: string,      // "20-foot radius"
  classes: string[],      // ["sorcerer", "wizard"]
  higherLevels?: string   // scaling description
}
```

`data/srd-2014/monsters.json` — Array of:
```typescript
{
  name: string,           // "Goblin"
  size: string,           // "Small"
  type: string,           // "humanoid"
  alignment: string,      // "neutral evil"
  ac: number,
  acSource?: string,      // "leather armor, shield"
  hp: number,
  hitDie: string,         // "2d6"
  speeds: { walk?: number, fly?: number, swim?: number, climb?: number, burrow?: number },
  abilityScores: { str: number, dex: number, con: number, int: number, wis: number, cha: number },
  saveProficiencies?: string[],
  skillProficiencies?: Record<string, number>,
  damageResistances?: string[],
  damageImmunities?: string[],
  conditionImmunities?: string[],
  senses: Record<string, number | string>,
  languages: string[],
  cr: number,
  xp: number,
  traits?: Array<{ name: string, description: string }>,
  actions: Array<{ name: string, description: string, attackBonus?: number, damageFormula?: string, damageType?: string }>,
  legendaryActions?: Array<{ name: string, description: string }>,
  reactions?: Array<{ name: string, description: string }>
}
```

`data/srd-2014/equipment.json` — Array of:
```typescript
{
  name: string,           // "Longsword"
  category: string,       // "weapon" | "armor" | "adventuring_gear" | "tool"
  subcategory?: string,   // "martial_melee" | "heavy_armor" | "artisans_tools"
  cost: { amount: number, unit: string },
  weight?: number,
  // Weapon fields:
  damage?: { formula: string, type: string },
  properties?: string[],  // ["versatile", "finesse", "light", ...]
  versatileDamage?: string,
  range?: { normal: number, long: number },
  // Armor fields:
  acBase?: number,
  addDexMod?: boolean,
  maxDexBonus?: number,
  strengthReq?: number,
  stealthDisadvantage?: boolean
}
```

`data/srd-2014/classes.json` — Array of:
```typescript
{
  name: string,           // "Wizard"
  hitDie: string,         // "d6"
  saveProficiencies: string[],  // ["int", "wis"]
  skillChoices: string[],       // available skills to pick from
  skillCount: number,           // how many to pick
  weaponProficiencies: string[],
  armorProficiencies: string[],
  spellcasting?: {
    ability: string,      // "int"
    // By level (index 0 = level 1, index 19 = level 20):
    cantripsKnown: number[],
    spellSlots: Record<string, number[]>  // spell level → slots per character level
  },
  features: Array<{ name: string, level: number, description: string }>
}
```

`data/srd-2014/races.json` — Array of:
```typescript
{
  name: string,           // "Human"
  speed: number,          // 30
  size: string,           // "Medium"
  abilityBonuses: Array<{ stat: string, value: number }>,
  traits: Array<{ name: string, description: string }>,
  languages: string[],
  subraces?: Array<{ name: string, abilityBonuses: Array<{ stat: string, value: number }>, traits: Array<{ name: string, description: string }> }>
}
```

**Step C — Create pack metadata:**

`data/srd-2014/pack.json`:
```json
{
  "name": "D&D 5e SRD (2014)",
  "version": "1.0.0",
  "source": "5e-bits/5e-database",
  "categories": ["spells", "monsters", "equipment", "classes", "races"]
}
```

`data/custom/pack.json`:
```json
{
  "name": "Custom / Homebrew",
  "version": "1.0.0",
  "categories": [],
  "overrides": true
}
```

**Step D — Run and validate:**

Run `npx tsx scripts/import-srd.ts` and verify:
- `data/srd-2014/spells.json` has 300+ entries, Fireball has `damageFormula: "8d6"`, `saveStat: "dex"`
- `data/srd-2014/monsters.json` has 300+ entries, Goblin has `ac: 15`, `cr: 0.25`
- `data/srd-2014/equipment.json` has 200+ entries, Longsword has `damage.formula: "1d8"`
- `data/srd-2014/classes.json` has 12 entries, Wizard has `hitDie: "d6"`, spellcasting ability "int"
- `data/srd-2014/races.json` has 9+ entries

**Done when:** Import script runs clean. Normalized JSON files are in `data/srd-2014/`, valid and queryable. `data/raw/` is gitignored. `data/srd-2014/` is committed. `pnpm check` passes.

## ✅ 5. Content pack loader + SRD query layer

Build the runtime layer that loads content packs and lets the app query SRD data.

**Create `server/srd/content-pack.ts`:**

```typescript
import fs from 'fs';
import path from 'path';

interface PackMeta {
  name: string;
  version: string;
  source?: string;
  categories: string[];
  overrides?: boolean;
}

interface ContentPack {
  meta: PackMeta;
  data: Map<string, any[]>;  // category → array of entries
}

export class ContentPackLoader {
  private packs: ContentPack[] = [];

  // Load a pack from a directory (reads pack.json + category files)
  loadPack(packDir: string): void

  // Get all entries for a category, with custom pack entries taking precedence
  // (matching by name — custom entry with same name replaces SRD entry)
  getEntries(category: string): any[]

  // Get a single entry by category + name (exact match first, then case-insensitive)
  getEntry(category: string, name: string): any | null

  // Check if data is loaded
  isLoaded(): boolean
}
```

Initialize at server startup: load `data/srd-2014/` then `data/custom/` (order matters — custom overrides SRD).

**Create `server/srd/srd-query.ts`:**

```typescript
import type { ContentPackLoader } from './content-pack';

// Fuzzy name lookup — tries exact match, then case-insensitive, then includes, then startsWith.
// Returns best match or null.
export function lookupByName(loader: ContentPackLoader, category: string, name: string): any | null

// Filter entries by criteria. All filters are AND-combined.
export function filterEntries(loader: ContentPackLoader, category: string, filters: {
  level?: number;        // for spells
  class?: string;        // spells available to this class
  school?: string;       // spell school
  cr?: { min?: number; max?: number };  // monster CR range
  type?: string;         // monster type, equipment category
}): any[]

// Concise one-paragraph summary for LLM context (not the full description).
// Includes key mechanical info: damage, range, DC, AC, HP, etc.
export function summarizeForLLM(entry: any, category: string): string
```

Keep the fuzzy matching simple — no external library needed. Priority: exact name → case-insensitive exact → case-insensitive startsWith → case-insensitive includes. If multiple matches on includes, prefer shorter names (closer match).

**Create `server/srd/index.ts`:**

Barrel export. Create and export a singleton `srdLoader` that loads packs on first access:

```typescript
let _loader: ContentPackLoader | null = null;

export function getSrdLoader(): ContentPackLoader {
  if (!_loader) {
    _loader = new ContentPackLoader();
    _loader.loadPack(path.resolve(__dirname, '../../data/srd-2014'));
    _loader.loadPack(path.resolve(__dirname, '../../data/custom'));
  }
  return _loader;
}
```

**Create `server/srd/__tests__/srd-query.test.ts`:**

These tests run against the real normalized SRD data committed in Step 4.

1. **Lookup by exact name** — `lookupByName(loader, "spells", "Fireball")` → returns entry with `level: 3`, `damageFormula: "8d6"`
2. **Lookup case-insensitive** — `lookupByName(loader, "spells", "fireball")` → same result
3. **Lookup fuzzy** — `lookupByName(loader, "spells", "fire ball")` → still finds Fireball (includes match)
4. **Lookup monster** — `lookupByName(loader, "monsters", "Goblin")` → `cr: 0.25`, `ac: 15`
5. **Lookup non-existent** — `lookupByName(loader, "spells", "xyzzy")` → null
6. **Filter spells by level + class** — `filterEntries(loader, "spells", { level: 3, class: "wizard" })` → includes Fireball, excludes Cure Wounds
7. **Filter monsters by CR** — `filterEntries(loader, "monsters", { cr: { max: 1 } })` → includes Goblin, excludes anything CR > 1
8. **Custom override** — Write a temp custom pack with a modified "Fireball" (damage "10d6"). Load both packs. `lookupByName("spells", "Fireball")` → returns the custom one with "10d6"
9. **LLM summary** — `summarizeForLLM(fireball, "spells")` → string contains "3rd-level", "evocation", "8d6 fire", "DEX save"

**Done when:** `pnpm check` passes, `pnpm test` passes. SRD data is queryable at runtime. No existing files modified.

## ✅ 6. Wire SRD lookups as LLM tool calls

The DM can now reference real SRD data during chat instead of hallucinating spell stats or monster abilities.

**Modify `server/prompts.ts`:**

Add a new exported constant `SRD_TOOLS` — an array of tool definitions in the format expected by the LLM API. These tools will be passed alongside the chat prompt.

```typescript
export const SRD_TOOLS = [
  {
    name: "lookup_spell",
    description: "Look up a D&D 5e spell by name. Returns level, school, damage, range, components, duration, and description.",
    input_schema: {
      type: "object" as const,
      properties: { name: { type: "string", description: "The spell name to look up" } },
      required: ["name"]
    }
  },
  {
    name: "lookup_monster",
    description: "Look up a monster or creature. Returns AC, HP, stats, attacks, abilities, and CR.",
    input_schema: {
      type: "object" as const,
      properties: { name: { type: "string", description: "The monster name" } },
      required: ["name"]
    }
  },
  {
    name: "lookup_equipment",
    description: "Look up a weapon, armor, or piece of equipment. Returns stats, damage, properties, cost.",
    input_schema: {
      type: "object" as const,
      properties: { name: { type: "string", description: "The item name" } },
      required: ["name"]
    }
  },
  {
    name: "search_srd",
    description: "Search the D&D 5e SRD rules database. Use for general queries like 'all 3rd level wizard spells' or 'CR 5 monsters'.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Search query" },
        category: { type: "string", enum: ["spells", "monsters", "equipment", "classes", "races"] }
      },
      required: ["query"]
    }
  }
];
```

**Modify `server/_core/llm-with-settings.ts`** (or wherever the LLM API call is made for chat messages):

Add support for passing tools to the LLM call. The existing function likely calls the provider SDK (OpenAI, Anthropic, Google). Add an optional `tools` parameter that's forwarded to the API.

**Important:** Different providers format tools differently:
- **Anthropic:** `tools: [{ name, description, input_schema }]` — matches our format above
- **OpenAI:** `tools: [{ type: "function", function: { name, description, parameters } }]` — need to wrap
- **Google:** Similar to OpenAI

Add a small adapter that reformats `SRD_TOOLS` for the active provider.

**Modify `server/message-send.ts`:**

In the out-of-combat chat flow (the section that calls the LLM for regular DM chat), add tool call handling:

1. Import `SRD_TOOLS` from prompts and `getSrdLoader`, `lookupByName`, `filterEntries`, `summarizeForLLM` from `server/srd/`
2. Pass `SRD_TOOLS` as the `tools` parameter in the LLM chat call
3. After the LLM responds, check if the response contains tool use blocks:
   - If yes: extract tool name + arguments
   - Call the matching SRD query function
   - Format the result using `summarizeForLLM`
   - Send the tool result back to the LLM (as a `tool_result` message)
   - Let the LLM generate its final narrative response
4. If no tool use: proceed normally (existing behavior)

**Only add tools to the out-of-combat DM chat path.** Do NOT add tools to:
- Enemy AI decisions (`enemy-ai-controller.ts`)
- Combat narration (`combat-narrator.ts`)
- Action parsing (`player-action-parser.ts`)
- Combat query prompts

These combat paths need to stay fast and focused.

**Handle the tool call loop:** The LLM might make multiple tool calls in one turn (e.g., look up a spell AND a monster). Support up to 3 sequential tool calls before forcing a final response.

**Done when:** `pnpm check` passes, `pnpm test` passes. A player can ask "What does Fireball do?" or "Tell me about goblins" in chat and get a response with accurate SRD data instead of hallucinated stats. The LLM naturally weaves the data into its DM narration.

<!-- Chat success criteria for this step: scripts/scenarios/step-6.json -->

## ✅ 7. DB migration: add actorSheet + actorState columns

Add new columns to store rich character data alongside the existing flat columns.

**Modify `drizzle/schema.ts`:**

In the `characters` table definition (around line 43–63), add two new columns:

```typescript
actorSheet: text("actor_sheet"),   // JSON string of ActorSheetSchema
actorState: text("actor_state"),   // JSON string of ActorStateSchema
```

Use `text` type — the existing `stats` and `inventory` columns use `text` with `JSON.stringify`, so stay consistent.

**Do NOT remove any existing columns.** The old flat columns (`className`, `level`, `hpCurrent`, `hpMax`, `ac`, `stats`, `inventory`, `notes`, `initiativeBonus`, `attackBonus`, `damageFormula`) remain for backwards compatibility.

**Run `pnpm db:push`** to apply the schema change.

**Modify `server/routers.ts` — `characters.create` mutation (~line 145):**

After the existing `db.createCharacter(...)` call succeeds and returns the new character:

1. Import `ActorSheetSchema`, `deriveInitialState` from `server/kernel/`
2. Build a partial ActorSheet from the input data:
   - Map input fields to ActorSheet fields (name, className → characterClass, level, stats → abilityScores, hp, ac)
   - For fields we don't have yet (proficiencies, spellcasting, features, equipment): use sensible defaults or empty arrays
   - Set `proficiencyBonus` from level: `Math.floor((level - 1) / 4) + 2`
   - Set `hitDie` based on class name (wizard → "d6", fighter → "d10", etc. — use a simple lookup map)
   - Leave `spellcasting` as null for now (Step 8 populates this from SRD)
3. Call `deriveInitialState(sheet)` to create the initial state
4. Update the character row: set `actorSheet` = `JSON.stringify(sheet)`, `actorState` = `JSON.stringify(state)`

**Modify `server/routers.ts` — `characters.list` query and `characters.get` (if it exists):**

When returning character data, include `actorSheet` and `actorState` fields in the response. Parse from JSON string if present.

**Modify `server/routers.ts` — `characters.update` mutation:**

When updating a character, also update the corresponding `actorSheet` fields if `actorSheet` exists. For now, just keep the flat columns and actorSheet in sync for the fields they share (HP, AC, stats, level).

**Done when:** `pnpm check` passes, `pnpm test` passes, `pnpm db:push` applies without error. Creating a new character stores both flat columns AND actorSheet/actorState JSON. Existing characters still work (null actorSheet).

## ✅ 8. Migrate existing characters + populate spells from SRD

Backfill existing characters with ActorSheet data and give spellcasters real spell lists.

**Create `scripts/migrate-characters.ts`:**

A one-time migration script (run with `npx tsx scripts/migrate-characters.ts`):

1. Connect to DB using the existing `getDb()` helper or direct postgres connection
2. Fetch all characters that have `actorSheet IS NULL`
3. For each character:
   a. Parse existing `stats` JSON → extract ability scores
   b. Look up the character's class in `data/srd-2014/classes.json` → get:
      - `hitDie`, `saveProficiencies`, `skillChoices`, `weaponProficiencies`, `armorProficiencies`
      - Spellcasting progression (if the class is a spellcaster)
   c. Build an `ActorSheet`:
      - Name, class, level, ability scores from existing data
      - Proficiencies from SRD class data
      - AC from existing `ac` column, source: "unknown" (we don't know what armor they wear)
      - HP from existing `hpMax` column
      - `ancestry`: try to extract from `notes` field, default to "Unknown"
      - `background`: try to extract from `notes` field, default to null
   d. If the class has spellcasting:
      - Compute spell slots from SRD class data at the character's level
      - Pick appropriate spells for the character's class + level from `data/srd-2014/spells.json`
      - **Spell selection heuristic:** For each spell level the character can cast, pick the most commonly used spells for that class. Use this priority list:
        - **Wizard:** Cantrips: Fire Bolt, Mage Hand, Prestidigitation. Level 1: Shield, Magic Missile, Mage Armor, Detect Magic. Level 2: Misty Step, Scorching Ray. Level 3: Fireball, Counterspell, Fly
        - **Cleric:** Cantrips: Sacred Flame, Guidance, Spare the Dying. Level 1: Cure Wounds, Healing Word, Bless, Shield of Faith. Level 2: Spiritual Weapon, Hold Person. Level 3: Spirit Guardians, Revivify
        - **Other casters:** Pick up to `cantripsKnown[level-1]` cantrips and up to `level + spellcasting_ability_mod` prepared spells from available class spells, preferring lower-level and damage/healing spells
      - Populate `spellcasting` block with ability, saveDC, attackBonus, cantrips, spells, slots
   e. Derive `ActorState` from the sheet (using `deriveInitialState`)
      - Override `hpCurrent` with the character's actual current HP (not max)
   f. Save `actorSheet` and `actorState` to the character row

4. Log each character migrated: `"Migrated: Silas Gravemourn (Wizard 5) — 3 cantrips, 8 spells known"`

**Verify Silas Gravemourn specifically:**

After running migration, Silas Gravemourn (character ID 26, session 25) should have:
- `characterClass`: "Wizard", `subclass`: "Necromancy", `level`: 5
- `abilityScores`: `{ str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 }`
- `spellcasting.ability`: "int"
- `spellcasting.saveDC`: 13 (8 + proficiency 3 + INT mod 2)
- `spellcasting.attackBonus`: 5 (proficiency 3 + INT mod 2)
- `spellcasting.spellSlots`: `{ 1: 4, 2: 3, 3: 2 }` (level 5 wizard slots)
- Cantrips and spells populated from the heuristic above

**Modify `server/combat/combat-helpers.ts` — `handleAutoCombatInitiation` (~line 20):**

When creating player entities from session characters:

1. Check if the character has a non-null `actorSheet`
2. If yes, parse it and use it to build a richer `CombatEntity`:
   - Pull `spells[]` from the ActorSheet's spellcasting data, looking up each spell name in SRD for mechanical data (damage formula, save stat, etc.)
   - Pull `spellSlots` from the ActorState's `spellSlotsCurrent`
   - Pull `abilityScores` from ActorSheet
   - Pull `resistances`, `immunities` if any are defined
3. If no actorSheet: fall back to existing behavior (empty spells, basic stats)

This closes the biggest gap from the Phase A audit: players entering combat with no spells.

**Done when:** `pnpm check` passes, `pnpm test` passes. Running `npx tsx scripts/migrate-characters.ts` populates existing characters. Silas Gravemourn has a full ActorSheet with wizard spells. Characters with ActorSheets enter combat with populated spell lists and spell slots.

<!-- Chat success criteria for this step: scripts/scenarios/step-8.json -->

## ✅ 9. Wire combat entity creation to ActorSheet

Deepen the ActorSheet integration in combat. Characters with ActorSheets should get the full benefit of their proficiencies, features, and equipment.

**Modify `server/combat/combat-helpers.ts`:**

Create new helper functions:

```typescript
// Convert ActorSheet spellcasting data to CombatEntity Spell[] format
function buildCombatSpells(
  sheet: ActorSheet,
  srdLoader: ContentPackLoader
): Spell[]

// Collect damage resistances from racial traits, equipment, active effects
function collectResistances(sheet: ActorSheet): string[]

// Collect damage immunities
function collectImmunities(sheet: ActorSheet): string[]

// Derive attack bonus from ActorSheet (for weapon attacks)
function deriveAttackBonus(sheet: ActorSheet): number

// Derive primary damage formula from equipment
function deriveDamageFormula(sheet: ActorSheet): string
```

`buildCombatSpells` should:
1. Iterate over `sheet.spellcasting.cantripsKnown` and `sheet.spellcasting.spellsKnown`
2. For each spell name, look it up in SRD via `lookupByName(srdLoader, "spells", name)`
3. Map to the `Spell` schema from `combat-types.ts`:
   - `name`, `level`, `school`, `castingTime` (map string to enum)
   - `range` (parse "150 feet" → number, "Self" → 0, "Touch" → 5)
   - `damageFormula` from SRD data
   - `savingThrow` (map `saveStat` to the expected format)
   - `requiresConcentration`
   - `isAreaEffect`
4. Return the array of combat-ready Spell objects

**Update `handleAutoCombatInitiation`** to use these helpers when `actorSheet` is available:

```typescript
const playerEntities = characters.map(char => {
  if (char.actorSheet) {
    const sheet = JSON.parse(char.actorSheet) as ActorSheet;
    const state = char.actorState ? JSON.parse(char.actorState) as ActorState : deriveInitialState(sheet);
    return createPlayerEntity(/* ... enriched with sheet data ... */);
  }
  // Existing fallback for characters without ActorSheet
  return createPlayerEntity(/* ... existing logic ... */);
});
```

**Modify `server/combat/combat-helpers.ts` — `syncCombatStateToDb` (~line 136):**

After combat ends, sync state changes back to `actorState`:
1. If the character has an `actorState`, parse it
2. Update `hpCurrent` from the combat entity's final HP
3. Update `spellSlotsCurrent` from the entity's remaining spell slots
4. Serialize and save back to the `actorState` column
5. Keep the existing flat column sync too (backwards compat)

**Create `server/combat/__tests__/actor-sheet-combat.test.ts`:**

1. **Spell population** — Create an ActorSheet for a level 5 wizard with spellcasting. Call `buildCombatSpells`. Verify the resulting Spell[] has correct entries with damage formulas from SRD.
2. **Full entity from ActorSheet** — Build a player entity from an ActorSheet. Verify it has spells, spell slots, ability scores, and correct AC.
3. **Fallback without ActorSheet** — Build a player entity from a character with null actorSheet. Verify existing behavior (empty spells, basic stats).
4. **State sync after combat** — Start combat, cast a spell (deducting a slot), end combat. Verify the actorState reflects the used slot.

**Done when:** `pnpm check` passes, `pnpm test` passes. Characters with ActorSheets enter combat with full spell lists, correct ability scores, and proper proficiency-derived bonuses. State syncs back after combat.

## ✅ 10. Combat engine delegates to CheckResolver

Replace the combat engine's internal modifier calculations with the kernel's CheckResolver. This is a surgical change — the engine's API and observable behavior must not change.

**Create `server/kernel/combat-adapter.ts`:**

Bridge functions that convert between `CombatEntity` format and kernel `CheckInput`:

```typescript
import type { CombatEntity } from '../combat/combat-types';
import type { Modifier, EffectInstance, EffectDefinition } from './effect-types';
import type { AbilityStat } from './actor-sheet';

// Convert a CombatEntity's activeConditions to kernel Modifier[]
export function getEntityModifiers(entity: CombatEntity): Modifier[]

// Derive proficiency bonus from entity (default +2 if not determinable)
export function getProficiencyBonus(entity: CombatEntity): number

// Determine which ability stat applies for an attack
// STR for melee, DEX for ranged. If entity has "finesse" weapon, use higher of STR/DEX
export function getAttackStat(entity: CombatEntity): AbilityStat

// Determine which ability stat applies for a spell attack
export function getSpellAttackStat(entity: CombatEntity): AbilityStat

// Check if entity is proficient in a save
export function isProficientInSave(entity: CombatEntity, stat: AbilityStat): boolean
```

`getEntityModifiers` should map existing conditions to kernel modifiers:
- "dodging" → `{ type: "disadvantage", on: "attack" }` (attacks against this entity have disadvantage) — note: this is from the target's perspective, so the engine needs to query the target's modifiers for incoming attacks
- Active condition "blinded" → `{ type: "disadvantage", on: "attack" }` + attackers get advantage
- Active condition "prone" → melee attackers get advantage, ranged get disadvantage
- Active condition "restrained" → `{ type: "disadvantage", on: "attack" }` + `{ type: "disadvantage", on: "save", stat: "dex" }`
- And so on for other D&D 5e conditions

**Modify `server/combat/combat-engine-v2.ts` — `processAttack` (~line 1993):**

Replace the internal attack modifier calculation with:

```typescript
import { resolveCheck } from '../kernel/check-resolver';
import { getEntityModifiers, getProficiencyBonus, getAttackStat } from '../kernel/combat-adapter';

// In processAttack, where the attack roll is computed:
const attackResult = resolveCheck({
  type: 'attack',
  abilityScores: entity.abilityScores ?? { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
  proficiencyBonus: getProficiencyBonus(entity),
  stat: getAttackStat(entity),
  isProficient: true,
  activeModifiers: getEntityModifiers(entity),
  targetAC: this.computeEffectiveAC(target),
  preRolledD20: preRolledD20,
  rollFn: this.rollFn,
});
```

**IMPORTANT:** Be very careful with this change. The engine currently uses `entity.attackModifier` as a flat bonus. The CheckResolver computes the bonus from ability score + proficiency + effects. These MUST produce the same result for existing entities, or tests will break.

If existing entities have `attackModifier: 5` and `abilityScores: { str: 16 }`, then:
- Old: d20 + 5
- New: d20 + STR mod (3) + proficiency (2) + effects (0) = d20 + 5 ✓

If an entity was created with a pre-computed `attackModifier` that doesn't match this breakdown, the adapter must detect this and fall back to using `attackModifier` directly.

Add a safety check in the adapter:
```typescript
// If entity has an explicit attackModifier AND ability scores that don't
// derive to the same value, use the explicit modifier as an override
```

**Modify `server/combat/combat-engine-v2.ts` — `submitSavingThrow` (~line 2848):**

Replace the save modifier calculation with CheckResolver:
```typescript
const saveResult = resolveCheck({
  type: 'save',
  abilityScores: entity.abilityScores ?? { ... },
  proficiencyBonus: getProficiencyBonus(entity),
  stat: saveStat as AbilityStat,
  isProficient: isProficientInSave(entity, saveStat as AbilityStat),
  activeModifiers: getEntityModifiers(entity),
  dc: saveDC,
  preRolledD20: roll,
});
```

**DO NOT change:**
- The visual dice UI flow (resolveAttackRoll / applyDamage multi-step)
- The state machine transitions
- The action validation in getLegalActions
- The enemy AI or action parser

**Run the full test suite immediately after making changes.** If any test fails:
1. Read the failing test to understand what modifier value it expects
2. Adjust the adapter functions to produce the same result
3. Do NOT change test expectations — the observable behavior must be identical

**Done when:** `pnpm check` passes, ALL existing combat tests pass (107+). Attack rolls and saving throws flow through CheckResolver. No change in observable behavior.

## ✅ 11. Deterministic state ownership + narrative boundary tests

Final integration: make `ActorState` the single source of truth for all mechanical state. The LLM narrates but never determines HP, damage, conditions, slot usage, or resource changes.

**Modify `server/prompts.ts` — Structured Output Wrapper (~line 156):**

Add stronger mechanical boundary language to the system prompt:

```
MECHANICAL BOUNDARY — STRICT:
You MUST NOT specify exact damage numbers, healing amounts, or dice results in your narrative unless the combat engine has already resolved them and provided the numbers in the combat state context.
You MUST NOT deduct spell slots, modify HP, add/remove conditions, or change any mechanical state in your narrative text. The engine handles ALL mechanical state changes.
When a character casts a spell out of combat, describe the narrative effect. The engine will deduct the spell slot and apply mechanical effects.
When you narrate damage, use only the numbers provided by the engine in the combat log — never invent your own.
```

Insert this in the `STRUCTURED_OUTPUT_WRAPPER` before the existing response format instructions.

**Modify `server/message-send.ts` — out-of-combat flow:**

When `gameStateChanges` from the structured LLM response includes HP changes, resource changes, or conditions:
1. If the character has an `actorState`:
   - Parse the actorState
   - Apply the changes (HP delta, condition add/remove, etc.)
   - Serialize and save back
2. Also sync to flat columns (existing behavior)

For spell casting out of combat:
- If `gameStateChanges` indicates a spell was cast AND the character has `actorState`:
  - Deduct the appropriate spell slot from `actorState.spellSlotsCurrent`
  - If the spell requires concentration, update `actorState.concentration`
  - Save back to DB

**Create `server/kernel/__tests__/narrative-boundary.test.ts`:**

These are contract tests verifying the system boundary between LLM output and mechanical state.

1. **HP isolation** — Create a mock scenario where a `gameStateChanges` response includes `{ hpChanges: [{ characterId: 26, delta: -10 }] }`. Verify that:
   - ActorState.hpCurrent is decreased by 10
   - The change came through the structured `gameStateChanges` path, not from parsing narrative text
   - If the LLM narrative says "you take 15 damage" but gameStateChanges says delta -10, the actual HP change is -10 (gameStateChanges wins)

2. **Spell slot deduction** — Mock casting a level 1 spell out of combat. Verify:
   - `actorState.spellSlotsCurrent[1]` decrements by 1
   - If the character has 0 slots remaining, the cast should fail or be flagged

3. **Condition management** — Mock adding "poisoned" via gameStateChanges. Verify:
   - Added to `actorState.conditions`
   - Only the structured change path can add conditions, not narrative text parsing

4. **State roundtrip: combat → rest → combat** — Integration test:
   - Start with a character at full resources
   - Simulate combat that uses spell slots and takes damage (via engine actions)
   - End combat → verify actorState reflects damage and used slots
   - Simulate a long rest → verify actorState restored (HP full, slots full)
   - Start new combat → verify the entity is created from the current actorState

5. **Rest mechanics update actorState** — When a long rest is triggered via chat:
   - `actorState.hpCurrent` → `actorState.hpMax`
   - `actorState.spellSlotsCurrent` → matches `actorSheet.spellcasting.spellSlots`
   - `actorState.hitDiceCurrent` → restored up to half level (rounded up)
   - `actorState.featureUses` → restored for features with `rechargeOn: "long_rest"`
   - `actorState.exhaustion` → decremented by 1 (if > 0)
   - `actorState.concentration` → null
   - `actorState.deathSaves` → reset to `{ successes: 0, failures: 0 }`

**Done when:** `pnpm check` passes, `pnpm test` passes including all narrative boundary tests. ActorState is the canonical source of truth for mechanical state. The LLM narrates but cannot override engine-determined outcomes. State persists correctly across combat, rest, and new combat sessions.
