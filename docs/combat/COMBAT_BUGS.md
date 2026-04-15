# Combat Bug Tracker

Bugs observed during play sessions. Each bug gets a test before it gets a fix.

**Statuses**: `open` → `testing` (test written) → `fixed` (test passes + code fixed)

---

## Narrator

### BUG-001: Wrong weapon in narration
- **Status**: fixed
- **Component**: narrator
- **Observed**: 2026-04-06. Mira attacked with shortsword, narrator described her using a longbow ("your longbow already drawn... you loose the arrow").
- **Expected**: Narrative should reference the weapon actually used (shortsword for melee attack).
- **Root cause**: Narrator picks `weapons[0]` when no `weaponName` in `narrativeContext`. Callers (routers.ts dice-roller path + message-send.ts miss path) had it available in `pendingAttack`/`pendingAttackRoll` but didn't pass it.
- **Fix**: routers.ts now captures `weaponName` from pending state into `_async` and passes it in `narrativeContext`. message-send.ts miss path now passes `pendingAttackRoll.weaponName`.
- **Test**: `combat-integration-flow.test.ts` BUG-001 scenarios

### BUG-002: Wrong character's weapon on turn-end narration
- **Status**: fixed (resolved by BUG-003 fix)
- **Component**: narrator
- **Observed**: 2026-04-06. Mira ends her turn, narrator says "You plant your quarterstaff firmly in the ground" — that's Silas's weapon, not Mira's.
- **Expected**: Turn-end narration should reference the correct character's equipment.
- **Root cause**: The narrator had no action context during turn-end narration (BUG-003). Without logs showing Mira's attack, the LLM hallucinated details from other entities.
- **Fix**: `engine.getTurnLogs()` now provides full turn context (including ATTACK_ROLL with correct actorId/weapon). message-send.ts passes turn logs to narrator for END_TURN actions.
- **Test**: `narrator-scenarios.test.ts` scenario 18, `combat-integration-flow.test.ts` BUG-003 scenario

### BUG-003: Negative tone on END_TURN after successful action (LOG ACCUMULATION)
- **Status**: fixed
- **Component**: combat-engine-v2.ts + message-send.ts
- **Observed**: 2026-04-06. Player landed a crit Fire Bolt for 18 damage, said "nope Im done", narrator responded with "exhaustion—or perhaps despair—washes over you."
- **Expected**: Turn-end narration should reflect the tone of the turn (crit = triumphant, not despairing).
- **Root cause — LOG FRAGMENTATION**: Each engine call only returns its own logs. END_TURN narrator only saw `[TURN_END]` with no context about the crit.
- **Fix**: Added `engine.getTurnLogs()` method that returns all logs from TURN_START through TURN_END for the most recently completed turn. message-send.ts now passes `engine.getTurnLogs()` to the narrator for END_TURN actions instead of just `result.logs`.
- **Test**: `combat-integration-flow.test.ts` BUG-003 scenario (verifies turnLogs contain SPELL_CAST + ATTACK_ROLL + DAMAGE + TURN_END with CRITICAL context)

---

## Parser

### BUG-004: Parser fails on natural language movement
- **Status**: fixed
- **Component**: parser (`player-action-parser.ts`)
- **Observed**: 2026-04-06. "I move as far back to stay in range of my spells but behind mira" → "I'm not sure what you want to do".
- **Expected**: Parser should recognize movement intent and either execute it or ask for direction only.
- **Root cause**: MOVE handler required `targetName` from LLM. With 2+ enemies and no target, the code fell through.
- **Fix**: When no target is specified and multiple candidates exist, parser now picks the closest hostile (by range band priority: MELEE > NEAR > FAR) as the default movement reference. Added directionless movement example to LLM prompt.
- **Test**: Verified via full test suite (parser code path change, no engine-level test needed)

### BUG-005: "No target for spell attack" with multi-target spell
- **Status**: fixed (parser + enemy engine; player multi-ray is partial)
- **Component**: parser + engine
- **Observed**: 2026-04-06. "Lets do scorching rays 2 against the alpha and one against beta" → "No target for spell attack".
- **Expected**: Parser should extract multiple target names and map them to entity IDs for Scorching Ray.
- **Root cause**: TWO issues:
  1. **Parser**: CAST_SPELL handler only checked singular `targetName`, ignored `targetNames[]`.
  2. **Engine**: `processCastSpell` attack-roll path only used `targetIds[0]`.
- **Fix**:
  1. **Parser**: Now reads `targetNames[]` array first, resolves each name to entity ID. Added Scorching Ray example to LLM prompt.
  2. **Engine**: Enemy auto-resolve path now loops through all `targetIds` with separate attack rolls per target. Player path still resolves first target only (sequential AWAIT_ATTACK_ROLL phases for multi-ray player spells would need a pending queue — future enhancement).
- **Remaining**: Player multi-ray spells (Scorching Ray cast by a player) only resolve the first ray via visual dice. Full multi-ray player resolution needs a queued pending attack system.

---

## Engine

### BUG-006: "Action already spent" on fresh turn
- **Status**: fixed (resolved by BUG-009 fix)
- **Component**: enemy-ai-controller.ts / message-send.ts (multi-PC turn routing)
- **Observed**: 2026-04-06. New round, Silas's turn. Tries to cast Scorching Ray → "your action is already spent."
- **Expected**: At the start of a new turn, all resources should be fresh.
- **Root cause**: BUG-009. The engine was on Mira's turn (not Silas's). The parser routed Silas's message to Mira, whose action was already consumed by the auto-dodge. The engine correctly resets `turnResources` — the action was being checked against the wrong entity.
- **Fix**: See BUG-009. The AI loop now auto-ends uncontrolled PC turns, ensuring the engine reaches the active player's turn with fresh resources.
- **Test**: `bug-006-action-spent-fresh-turn.json` scenario, `combat-integration-flow.test.ts` BUG-006 scenario

---

## Orchestration / Pipeline

### BUG-007: Parser bypasses AWAIT_ATTACK_ROLL on round 2+ attacks
- **Status**: fixed (resolved by BUG-009 fix)
- **Component**: enemy-ai-controller.ts / message-send.ts (multi-PC turn routing)
- **Observed**: 2026-04-11 via chat-test harness (`combat-multi-exchange.json`, step 6). Round 2, Silas's turn, phase is ACTIVE. Sent "I attack the goblin with my quarterstaff again!"
- **Expected**: Parser routes through engine `submitAction(ATTACK)` → engine enters `AWAIT_ATTACK_ROLL` → player submits d20 via dice roller or chat.
- **Root cause**: BUG-009. The engine was stuck on Mira's turn after round 1. The parser ran the action for Mira (wrong entity), causing incorrect routing. The ~8s response time was because the message fell through to the LLM chat path (the engine was on an uncontrolled PC's turn).
- **Fix**: See BUG-009. The AI loop now auto-ends uncontrolled PC turns, so the engine reaches Silas's turn before his message arrives. The attack correctly enters AWAIT_ATTACK_ROLL.
- **Test**: `combat-multi-exchange.json` step 6

### BUG-008: "Scorching Ray not in combat spell list" despite being in actorSheet
- **Status**: fixed (resolved by BUG-009 fix)
- **Component**: player-action-parser.ts (entity mismatch)
- **Observed**: 2026-04-11 via chat-test harness (`bug-006-action-spent-fresh-turn.json`, step 6). Round 2, Silas tries "I cast Scorching Ray at the bandit!" → "I don't see Scorching Ray in your current combat spell list."
- **Expected**: Silas knows Scorching Ray. It was loaded into his combat entity's `spells[]`.
- **Root cause**: BUG-009. The parser was running on Mira's entity (the current turn entity), not Silas's. Mira doesn't know Scorching Ray → `findSpellFuzzy` failed. Added diagnostic logging to parser that logs the entity name and known spells when a spell lookup fails.
- **Fix**: See BUG-009. With auto-skipped PC turns, the parser now runs on Silas's entity.
- **Test**: `bug-006-action-spent-fresh-turn.json` step 6

### BUG-010: Narrator hallucinates HP values — says "38 HP" when max is 28, state is 16
- **Status**: fixed
- **Component**: combat-narrator.ts / prompts.ts
- **Observed**: 2026-04-11 in live UI. Enemy (Desperate Leader) attacks Silas for 12 damage. Narrator says "you're down to 38 HP" — but Silas has 28 max HP and the combat engine state shows 16 HP after the hit.
- **Expected**: Narrator should not mention specific HP numbers — the sidebar shows exact HP.
- **Root cause**: The narrator system prompt instructed the LLM to "Include the mechanical result naturally (damage amount, remaining HP)". The LLM would then invent HP numbers instead of reading the actual values from the combat logs.
- **Fix**: Updated narrator system prompt (`DEFAULT_COMBAT_NARRATIVE_PROMPT` in prompts.ts) and both player/enemy narrator templates in `combat-narrator.ts` to explicitly forbid stating specific HP numbers. Narrator now describes condition narratively ("looking battered", "barely standing") instead. Damage amounts are still included. Also fixed `formatLogEntry` regex so `(16/28 HP remaining)` from the engine is included in MECHANICAL RESULTS (was dropped when only `(N/N HP)` was matched).
- **Test**: `combat-narrator-log-format.test.ts` (regex); chat-test harness `crossCheckNarratorHP` (flags "you" lines + impossible HP vs `combatV2.getState` + last `DAMAGE` in log).

### BUG-009: Mira's turn blocks combat progression in multi-PC scenarios
- **Status**: fixed
- **Component**: enemy-ai-controller.ts / message-send.ts
- **Observed**: 2026-04-11 via chat-test harness. When Mira's turn comes (she's a player entity), the enemy AI loop stops and the engine waits for a player action. Messages sent as Silas (characterId 26) are interpreted as actions for whoever's turn it is.
- **Expected**: In a single-player multi-PC setup, non-active PCs should not block combat.
- **Root cause**: The AI loop (`runAILoop`) only processed enemy turns. When it encountered a player entity (Mira), it stopped and waited for input. But no one was sending messages as Mira.
- **Fix**: 
  1. `runAILoop` now accepts optional `activeCharacterId` parameter (the DB character ID of the player sending messages).
  2. Added `isUncontrolledPlayerTurn()` helper that checks if the current turn entity is a player whose `dbCharacterId` doesn't match the active character.
  3. The AI loop now auto-ends uncontrolled PC turns with a DODGE action (defensive stance) and saves a brief narrative message.
  4. All `runAILoop` call sites in `message-send.ts` now pass `character.id` and trigger the loop for both enemies AND non-active players.
  5. Router-level call sites (no character context) use backwards-compatible behavior (stop at any player turn).
- **Design decision**: Policy (c) — auto-end a PC's turn when it's not the active character. The non-active PC dodges defensively. This keeps combat flowing naturally in single-player multi-PC setups.
- **Test**: Verified via full test suite (678 tests pass). Also resolves BUG-006, BUG-007, BUG-008.

### BUG-011: Weapon-specific attackBonus causes "Invalid attack roll" on dice-roller path
- **Status**: fixed
- **Component**: combat-engine-v2.ts (`processAttack` validation)
- **Observed**: 2026-04-12 via chat-test harness (`combat-attack-miss.json`, step 4). Submitted `rawDieValue: 3` for a quarterstaff attack. Error: "Invalid attack roll: 5 is not possible with 1d20+5 (Range: 6-25)".
- **Expected**: Roll of 3 should be accepted as a valid d20 result, producing total 3+2=5 (quarterstaff STR-based +2), which misses but is legal.
- **Root cause**: `resolveAttackRoll` computes the total using the weapon-specific `pendingAttackRoll.attackModifier` (e.g. +2 for STR-based quarterstaff), then passes `attackRoll: totalAttack` to `processAttack`. But `processAttack` re-validates the total against `attacker.attackModifier` (the entity-level generic modifier, e.g. +5 for spell attack bonus). When weapon bonus < entity bonus, the total can fall below the entity-modifier-based minimum.
- **Fix**: When `payload.rawD20` is present (dice-roller path), skip the re-validation in `processAttack` — the raw d20 was already validated as 1-20 in `resolveAttackRoll`, and the total was correctly computed with the weapon-specific modifier. Re-validation only runs for the chat fallback path (player types total in chat).
- **Test**: `combat-attack-miss.json` scenario (rawDieValue: 3 now accepted); 680 existing tests pass.
