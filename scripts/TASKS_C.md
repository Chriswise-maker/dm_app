# Phase C — Speed, Class Features & Polish
<!--
  Run with:
    ./scripts/orchestrate.sh scripts/TASKS_C.md
    ./scripts/orchestrate.sh scripts/TASKS_C.md --dry-run
    ./scripts/orchestrate.sh scripts/TASKS_C.md --start-at 3

  C0 is complete. This file covers C1–C5.
  Dependency order: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11

  Verification gate (automatic after each step):
    1. pnpm check  — TypeScript type errors
    2. pnpm test   — unit/integration tests
-->

## 1. Tiered models — fastModel setting and LLM routing

**Goal:** Add a `fastModel` user setting and a `invokeFastLLM` helper so combat subsystems (enemy AI, narration, action parsing) can use a cheap/fast model while DM chat stays on the main model.

**Database:**
- In `drizzle/schema.ts`, add a `fastModel` column to `userSettings` — `varchar("fastModel", { length: 100 })`, nullable, no default.
- Run `pnpm db:push` to apply the migration.

**LLM layer:**
- In `server/llm-with-settings.ts`, add an exported function `invokeFastLLMWithSettings(userId, params)`. It works exactly like `invokeLLMWithSettings` but reads `settings.fastModel` instead of `settings.llmModel`. If `fastModel` is null/empty, fall back to the provider's fast default: `{ openai: "gpt-4o-mini", anthropic: "claude-haiku-4-5-20251001", google: "gemini-2.0-flash-lite" }`. The primary user is on Anthropic, so `claude-haiku-4-5-20251001` is the key default.
- Also add `invokeFastLLMWithSettingsStream(userId, params)` — same pattern for streaming.

**Settings UI:**
- In `client/src/components/SettingsDialog.tsx`, add a "Fast model (combat)" text input below the existing model input. Bind it to `fastModel`. Show placeholder text like "Auto (provider default)".

**Routing:**
- In `server/combat/enemy-ai-controller.ts`, find where it calls `invokeLLMWithSettings` — change to `invokeFastLLMWithSettings`.
- In `server/combat/combat-narrator.ts`, find where it calls `invokeLLMWithSettings` or `invokeLLMWithSettingsStream` — change to the fast variants.
- In `server/combat/player-action-parser.ts`, find where it calls `invokeLLMWithSettings` — change to `invokeFastLLMWithSettings`.
- Do NOT change `server/message-send.ts` or `server/prompts.ts` — DM chat stays on the main model.

**Tests:**
- Add a test in a new file `server/__tests__/llm-fast-routing.test.ts` that mocks `getUserSettings` and verifies:
  1. When `fastModel` is set, `invokeFastLLMWithSettings` uses that model.
  2. When `fastModel` is null, it falls back to the provider's fast default.

**Done when:** `pnpm check` and `pnpm test` pass. The three combat LLM call sites use the fast model path. Settings UI shows the new field.

## 2. Engine prereqs — extra_damage modifiers in damage application

**Goal:** Wire the `extra_damage` modifier type into actual damage computation. This is the foundation for Sneak Attack, Divine Smite, and Rage.

`extra_damage` is defined in `ModifierSchema` (in `server/combat/combat-types.ts` or `server/kernel/`) but never consumed during damage application.

**Implementation:**
- In `server/combat/combat-engine-v2.ts`, find `applyWeaponDamage()` (or the function that computes final damage after a hit). After computing base weapon damage: collect all `extra_damage` modifiers from the attacker's `activeModifiers[]`. For each, roll the `formula` string using the dice roller (e.g. `"2d6"`, `"+2"`). Sum all extra damage. Add to the total damage dealt.
- Do the same in the spell damage equivalent path if one exists.
- Log each extra damage source in the combat log (e.g. "Sneak Attack adds 7 damage").

**Tests:**
- In `server/combat/__tests__/`, add tests that:
  1. An entity with an `extra_damage` modifier deals increased damage on a weapon hit.
  2. Multiple `extra_damage` modifiers stack additively.
  3. An entity with no `extra_damage` modifiers deals normal damage (regression).

**Done when:** `pnpm check` and `pnpm test` pass with new test coverage for extra_damage application.

## 3. Engine prereqs — damage_resistance, damage_immunity, and condition duration decay

**Goal:** Wire `damage_resistance` and `damage_immunity` from `activeModifiers` into damage application. Implement condition duration decay at round end.

**Damage resistance/immunity from modifiers:**
- Currently `CombatEntity.resistances[]` (a string array) is checked. Add a second pass: also check `activeModifiers` for `damage_resistance` and `damage_immunity` entries matching the incoming damage type.
- Resistance halves damage (round down). Immunity negates it. Don't double-apply if both `resistances[]` and a modifier grant the same resistance.

**Condition duration decay:**
- `ActiveCondition` has a `duration?: number` field but `advanceRound()` never decrements it.
- At round end (in `advanceRound()` or wherever the round counter ticks), for each entity: decrement `duration` on all `activeConditions` that have `duration` set (not undefined). Remove conditions where `duration` reaches 0. Emit a combat log entry per condition removed (e.g. "Rage ends on [name]").
- When a condition expires, also remove any `activeModifiers` that were associated with it. To link them: add an optional `sourceCondition?: string` field to the modifier type. When removing a condition by name, also remove all modifiers with `sourceCondition` matching that name.

**Ability check advantage verification:**
- The existing `advantage` modifier type supports `appliesTo: "ability_check"` with a `stat` field. Verify `resolveCheck()` (in `server/kernel/check-resolver.ts` or equivalent) correctly applies advantage when `type === "advantage"`, `appliesTo === "ability_check"`, `stat === "str"`. If it already works, just add a test case confirming it. If not, fix it.

**Tests:**
- Damage resistance from modifier halves matching damage type.
- Damage immunity from modifier negates matching damage type.
- Condition with `duration: 3` expires after 3 rounds; associated modifiers are cleaned up.
- Advantage on STR ability checks applies correctly.

**Done when:** `pnpm check` and `pnpm test` pass with new coverage for resistance/immunity modifiers, condition decay, and ability check advantage.

## 4. Tier 2 features — Second Wind, Action Surge, Cunning Action

**Goal:** Implement three player-initiated combat features that surface as legal actions.

**Prerequisites (create if missing):**
- `applyHealing(entityId, amount)` helper in the combat engine: increases HP by `amount`, capped at `maxHp`. If entity was at 0 HP with `unconscious` condition, remove the condition. Log the healing.
- `featureUses` tracking on `CombatEntity` or `ActorState` within combat — a `Record<string, number>` mapping feature name to remaining uses. Initialize from `ActorSheet.features[].usesMax` when building the combat entity.

**Second Wind (Fighter):**
- Bonus action. Heals `1d10 + fighter level` HP. Once per short rest.
- Add `"SECOND_WIND"` to the legal action list for entities where `characterClass === "Fighter"` AND `bonusActionUsed === false` AND `featureUses["Second Wind"] > 0`.
- On use: consume bonus action, decrement `featureUses["Second Wind"]`, roll `1d10 + level`, apply healing (capped at `maxHp`), log result.

**Action Surge (Fighter):**
- Free action (costs nothing). Grants one additional action this turn. Once per short rest.
- Add `"ACTION_SURGE"` to legal actions when `characterClass === "Fighter"` AND `featureUses["Action Surge"] > 0` AND turn is active.
- On use: decrement `featureUses["Action Surge"]`, set `actionUsed = false` (re-opens the action slot), log "Fighter surges — one additional action available."

**Cunning Action (Rogue):**
- Permanent class ability. Lets rogue use Dash, Disengage, or Hide as a bonus action.
- When building legal actions for a rogue: if `bonusActionUsed === false`, add DASH, DISENGAGE, HIDE to the bonus action list.
- These should consume the bonus action (not the regular action).

**Tests for each:**
- Second Wind appears for Fighter, heals correct amount, disappears after use.
- Action Surge re-opens the action slot, disappears after use.
- Cunning Action appears for Rogue as bonus actions, consumes bonus action not regular action.

**Done when:** `pnpm check` and `pnpm test` pass. Each feature appears in the legal action list for the right class, consumes the right resource, and produces the right outcome.

## 5. Tier 3 features — Sneak Attack and Divine Smite

**Goal:** Implement two conditional damage features that trigger after a successful attack hit.

**Sneak Attack (Rogue):**
- Once per turn, add `ceil(level/2)d6` damage to one attack if: (a) rogue has advantage on the attack, OR (b) an ally is within melee range of the target. Only applies to finesse or ranged weapons.
- Track `sneakAttackUsedThisTurn: boolean` on turn resources (reset at turn start).
- After a hit is confirmed in the attack resolution flow, check conditions automatically. If met: add an `extra_damage` modifier for `ceil(level/2)d6`, set `sneakAttackUsedThisTurn = true`. Don't prompt the player — auto-apply and narrate.
- Add `level` to `CombatEntity` if not already present (derive from `ActorSheet`).
- Check weapon type via `attackType` or weapon properties for "finesse" or "ranged".

**Divine Smite (Paladin):**
- After hitting with a melee attack, Paladin may expend a spell slot to deal `(slot_level + 1)d8` radiant damage. +1d8 vs undead/fiends. Max 5d8 total.
- After a melee hit is confirmed for a Paladin with spell slots remaining: enter a new phase `AWAIT_SMITE_DECISION`.
- Add `AWAIT_SMITE_DECISION` to the `CombatPhase` enum.
- In this phase, present legal actions: `SMITE_1`, `SMITE_2`, `SMITE_3` (for each available slot level), and `DECLINE_SMITE`.
- On smite: consume the spell slot from `ActorState.spellSlotsCurrent`, compute damage dice, check target's `creatureType` for "undead"/"fiend" bonus. Apply as `extra_damage`.
- On decline: proceed to normal damage.
- Add `creatureType?: string` field to `CombatEntity`, populated from SRD monster data during enemy creation.

**Tests:**
- Sneak Attack auto-applies with correct dice count based on rogue level.
- Sneak Attack doesn't apply on second attack in same turn.
- Sneak Attack requires finesse/ranged weapon.
- Divine Smite phase appears for Paladin after melee hit.
- Divine Smite consumes correct spell slot and deals correct damage.
- Divine Smite bonus d8 applies vs undead target.

**Done when:** `pnpm check` and `pnpm test` pass with full test coverage for both features.

## 6. Tier 4 feature — Rage (Barbarian)

**Goal:** Implement Rage as a sustained-effect bonus action with damage resistance, STR advantage, and bonus melee damage.

**Activation:**
- Add `"RAGE"` to legal bonus actions for Barbarians when `bonusActionUsed === false` AND `featureUses["Rage"] > 0` AND entity does not already have the `"raging"` condition.
- On use: consume bonus action, decrement `featureUses["Rage"]`, apply an `ActiveCondition` named `"raging"` with `duration: 10`.

**Modifiers while raging (add to `activeModifiers[]` with `sourceCondition: "raging"`):**
- `{ type: "advantage", appliesTo: "save", stat: "str" }`
- `{ type: "advantage", appliesTo: "ability_check", stat: "str" }`
- `{ type: "damage_resistance", damageType: "bludgeoning" }`
- `{ type: "damage_resistance", damageType: "piercing" }`
- `{ type: "damage_resistance", damageType: "slashing" }`
- `{ type: "extra_damage", formula: "+2", condition: "str_melee_only" }` — the rage damage bonus

**Conditional extra_damage:**
- Add an optional `condition?: string` field to the `extra_damage` modifier type if not present.
- In `applyWeaponDamage()`, only apply extra_damage modifiers where `condition` is undefined/`"always"` OR (`condition === "str_melee_only"` AND the attack uses STR AND is melee).

**Expiry:**
- When the `"raging"` condition expires via duration decay (Step 3): all modifiers with `sourceCondition: "raging"` are automatically removed. Log "Rage ends on [name]."

**Tests:**
- Rage activates, grants correct modifiers.
- Rage damage bonus (+2) only applies to STR-based melee attacks, not ranged.
- Resistance halves bludgeoning/piercing/slashing damage while raging.
- Rage expires after 10 rounds; all modifiers removed.

**Done when:** `pnpm check` and `pnpm test` pass. Rage is fully functional with activation, bonuses, resistance, and expiry.

## 7. Tier 5 features — Bardic Inspiration and Lay on Hands

**Goal:** Implement two ally-targeted features.

**Bardic Inspiration (Bard):**
- Bonus action. Target one ally. They receive a Bardic Inspiration die (d6 at levels 1–4, d8 at 5–9, d10 at 10–14, d12 at 15+). They can add it to one attack roll before end of combat.
- Add `bardicInspirationDie?: string` to `CombatEntity` (e.g. `"d8"`). Null = no die.
- Add `"BARDIC_INSPIRATION"` to legal bonus actions for Bards when `bonusActionUsed === false` AND `featureUses["Bardic Inspiration"] > 0`.
- On use: need to select a target ally. Options:
  - Add a sub-phase `AWAIT_INSPIRATION_TARGET` where legal actions are the ally entity IDs, OR
  - Accept a `targetId` in the action payload.
- Set `target.bardicInspirationDie = "d8"` (based on bard level). Log "Bard inspires [name] — they hold a d8."
- When an inspired entity makes an attack roll: if they have `bardicInspirationDie`, after the roll, automatically roll the die and add it to the result. Clear `bardicInspirationDie`. Log the bonus. (Simplification: auto-use on first attack rather than player choice.)

**Lay on Hands (Paladin):**
- Action. Touch one ally in melee range. Heal up to X HP from a pool of `paladin_level * 5` (replenishes on long rest).
- Store pool as `featureUses["Lay on Hands"]` initialized to `level * 5`.
- Add `"LAY_ON_HANDS"` to legal actions for Paladins when `actionUsed === false` AND `featureUses["Lay on Hands"] > 0` AND a valid ally is in melee range.
- On use: heal the target for `min(pool_remaining, target_missing_hp)` using `applyHealing()`. Deduct from `featureUses`. Consume action.

**Tests:**
- Bardic Inspiration transfers die to ally, consumed on their next attack, adds to roll.
- Lay on Hands heals correct amount, depletes pool, consumes action.
- Lay on Hands won't overheal past maxHp.

**Done when:** `pnpm check` and `pnpm test` pass with full test coverage for both features.

## 8. Combat sidebar UI polish

**Goal:** Improve the combat sidebar with better HP display, turn indicators, and UX.

- **HP bars:** Add gradient-styled HP bars to each combatant in the sidebar. Green → yellow → red based on HP percentage. Animate transitions when HP changes.
- **Turn indicator:** Highlight the active combatant with a visual indicator (border, glow, or background). Animate the transition between turns.
- **End combat confirmation:** Add a confirm dialog before ending combat (currently it's a single click). Use a shadcn AlertDialog.
- **Character sheet panel:** Add an expandable panel per character that shows their full `ActorSheet` data — ability scores, proficiencies, spells, equipment, features. Use a collapsible/accordion from shadcn.
- **Spell list reference:** During combat, show the caster's available spells (with slot counts) in their expanded panel. Mark used slots visually.
- **Feature uses display:** Show remaining uses of class features (Second Wind 1/1, Rage 2/3, etc.) in the combat sidebar per entity.

Use existing shadcn/ui components. Don't modify the ui/ component files directly — compose them.

**Done when:** `pnpm check` and `pnpm test` pass (no new tests needed for pure UI, but no regressions). The sidebar looks polished with HP bars, turn indicators, and expandable character details.

## 9. Smarter enemy tactics

**Goal:** Make enemy AI spatially and tactically aware.

**Spatial awareness:**
- Ranged enemies (those whose primary attack is ranged) should prefer FAR/NEAR positions and avoid melee range.
- Melee enemies should close distance to targets and prefer MELEE range.
- In `server/combat/enemy-ai-controller.ts`, when scoring possible actions, factor in the enemy's weapon range preferences. A ranged goblin archer should DASH away if cornered in melee. A melee orc should DASH toward a distant caster.

**Threat assessment:**
- Enemies should prefer targeting: (a) low-HP targets, (b) concentration casters, (c) high-damage-dealers, in roughly that priority order.
- Add a simple threat scoring function: `scoreThreat(target, allEntities)` that returns a number. Factor in current HP ratio, whether they're concentrating, and their damage output (approximated from weapon damage dice).

**Multi-enemy coordination:**
- When multiple enemies act in a round, they shouldn't all pile on the same target. After one enemy targets someone, reduce that target's threat score slightly for the next enemy's decision.

**Tests:**
- Update `server/combat/__tests__/enemy-ai-scoring.test.ts` with cases:
  - Ranged enemy prefers to move away from melee.
  - Melee enemy prefers to close distance.
  - Low-HP target scores higher threat.
  - Concentration caster scores higher threat.

**Done when:** `pnpm check` and `pnpm test` pass. Enemy AI makes noticeably better tactical decisions.

## 10. Out-of-combat: skill challenges and shopping

**Goal:** Add structured skill challenge encounters and SRD equipment shopping.

**Skill challenges:**
- A skill challenge is a structured encounter where the party must accumulate N successes before M failures using skill checks.
- Add a `skill-challenge.ts` module in `server/` (or extend `server/skill-check.ts`).
- Data model: `{ name, description, dc, successesNeeded, failuresAllowed, currentSuccesses, currentFailures, allowedSkills[], completedChecks[] }`.
- The DM can initiate a skill challenge via chat (detected by LLM tool call or explicit command).
- Each player contributes a skill check. Track successes/failures. End when threshold is met.
- Store active skill challenge in session context.

**Shopping:**
- Add a `shopping` tRPC endpoint or extend the existing session/message flow.
- When the DM describes a shop, the LLM can call `lookup_equipment` to find items and prices from SRD data.
- Present equipment to the player with prices. Player can buy/sell.
- Track gold in `ActorState` — add a `gold: number` field if not present.
- Deduct gold on purchase, add equipment to `ActorSheet.equipment[]`.

**Tests:**
- Skill challenge: successes accumulate, fails accumulate, correct outcome when threshold hit.
- Shopping: gold deducted, equipment added, insufficient gold rejected.

**Done when:** `pnpm check` and `pnpm test` pass. Both systems are functional with test coverage.

## 11. Out-of-combat: travel, exploration, and social encounters

**Goal:** Add lightweight frameworks for travel, exploration, and social encounters.

**Travel and exploration:**
- Add a `travel.ts` module in `server/`.
- Travel has: destination, distance, pace (fast/normal/slow), random encounter chance.
- Fast pace: -5 passive Perception, cover more ground. Slow pace: can stealth, cover less.
- At intervals, roll for random encounters using a simple table. If triggered, the DM narrates and may initiate combat or a skill challenge.
- Track travel progress in session context.

**Social encounters:**
- A social encounter is a structured interaction with an NPC where the outcome depends on skill checks and roleplay.
- Add `social-encounter.ts` in `server/`.
- Data model: `{ npcName, disposition (hostile/neutral/friendly), dc, approachesUsed[], outcome }`.
- Players can attempt Persuasion, Intimidation, Deception, etc. Each shifts disposition.
- The DM (LLM) narrates NPC reactions based on check results and disposition changes.
- After N interactions or a critical success/failure, resolve the encounter.

**Tests:**
- Travel: encounter roll triggers at correct intervals, pace modifiers apply.
- Social: disposition shifts based on check results, resolves at threshold.

**Done when:** `pnpm check` and `pnpm test` pass. All three out-of-combat systems are functional.
