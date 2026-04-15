# Architecture Review: State, Narration, and Brittleness

*Original: 2026-04-12 | Updated: 2026-04-15*

## Governing Principle

**Facts are structured, prose is free.**

The system is the bookkeeper; the LLM is the storyteller. Game state — HP, inventory, quests, NPC dispositions, events, turn order, what mechanically happened — must live in structured, authoritative data. The LLM receives facts as givens and has full creative freedom over voice, tone, description, and how events are narrated. When the system needs to know what changed, it reads structured fields — not the story.

Conversation history (recent messages) is **not** a substitute for structured state, but it is a necessary **complement**. Structured state keeps the model correct; conversation history keeps it in character, in the moment, and creatively continuous. Both are passed to the LLM. Neither does the other's job.

This review traces where the codebase violates this principle — in combat, in non-combat game state, and in the contracts between subsystems — and proposes a phased plan to fix it structurally.

---

## A. End-to-End Sequence: "User Typed in Chat"

```
User types message
  |
  v
[tRPC messages.send] --- routers.ts:1081
  |
  v
executeMessageSend(ctx, input) --- message-send.ts:72
  |
  +-- Load character, session, 10 recent messages, context, combatants
  +-- engine = CombatEngineManager.get(sessionId)
  +-- enginePhase = engine?.getState().phase
  |
  v
+------------- PHASE ROUTER ---------------+
|                                           |
|  AWAIT_DAMAGE_ROLL        Extract damage number via regex
|    looksLikeQuestion()?     engine.applyDamage(roll)
|      YES -> buildCombatQueryPrompt()      persist engine
|                                           generateCombatNarrativeStream()
|                                           |
|  AWAIT_SAVE_ROLL          Extract save roll
|                             engine.submitSavingThrow()
|                             generateCombatNarrativeStream()
|                                           |
|  AWAIT_ATTACK_ROLL        Extract d20 roll
|                             engine.resolveAttackRoll()
|                             HIT -> skip narration, prompt for damage
|                             MISS -> generateCombatNarrativeStream()
|                                           |
|  AWAIT_INITIATIVE         Extract initiative
|                             engine.applyInitiative()
|                             All rolled? -> turn order message
|                             Enemy first? -> runAILoop() (fire-and-forget)
|                                           |
|  ACTIVE + isPlayerTurn    parsePlayerAction() (fast model, JSON)
|    QUERY -> buildCombatQueryPrompt()
|    UNRECOGNIZED -> clarification message
|    ERROR -> formatted error message
|    OK:
|      engine.submitAction(parsed.action)
|      persist engine
|      awaitingAttackRoll? -> prompt for d20
|      awaitingDamageRoll? -> prompt for damage
|      else -> generateCombatNarrativeStream()
|        save player msg + DM narrative
|        phase RESOLVED? -> destroy engine
|        next entity enemy? -> runAILoop() (fire-and-forget)
|                                           |
|  Long/Short rest          Block if combat active, resolve rest
|                                           |
|  FALLBACK: no V2 / IDLE   Standard DM chat:
|    buildChatSystemPrompt() + buildChatUserPrompt() w/ v2BattleState
|    invokeLLMWithSettings() + SRD tool loop (up to 3 rounds)
|    Parse structured JSON response
|    combatInitiated? -> auto-create V2 engine
|    skillCheck? -> resolveSkillCheck()
|    extractContextFromResponse()
|    Every 20 msgs: buildSummaryPrompt()
+-------------------------------------------+
```

### Parallel Path: Sidebar UI (routers.ts)

```
[tRPC combat.submitAction] --- routers.ts:2117
  engine.submitAction(action) inside withLock
  persist -> check RESOLVED -> runAILoop (fire-and-forget)
  *** NO NARRATIVE GENERATED FOR PLAYER ACTION ***

[tRPC combat.submitRoll] --- routers.ts:2275
  engine.resolveAttackRoll/applyDamage/etc inside withLock
  persist -> save mechanical summary immediately
  AFTER lock: await generateAndSaveNarrativeAsync() -> then runAILoop
```

### Enemy AI Path

```
runAILoop() --- enemy-ai-controller.ts
  for each enemy turn:
    scoreTargets() -> scoreAction() (deterministic ranking)
    LLM: buildEnemyDecisionPromptV2() -> invokeFastLLMWithSettings()
    parseEnemyAction() -> engine.submitAction()
    persist engine
    Multi-attack loop (deterministic, no LLM)
    LLM: generateCombatNarrative() -> save to DB
```

---

## B. Prompt Inventory

| # | Prompt Kind | Source Function(s) | System Prompt | User Prompt Inputs | Streaming? | Model |
|---|---|---|---|---|---|---|
| 1 | **DM Chat** (non-combat) | `buildChatSystemPrompt()`, `buildChatUserPrompt()` | User-customizable `systemPrompt` + structured output wrapper | Character sheet, session summary, NPCs/locations/quests, 10 recent messages, v2BattleState snapshot, user message | No | Main |
| 2 | **Combat Query** | `buildCombatQueryPrompt()` | Hardcoded: "Answer combat questions concisely." | BattleState, character sheet (combat variant), resource status, legal actions, player question | No | Main |
| 3 | **Action Parser** | `buildActionParserPrompt()`, `getActionParserPrompt()` | User-customizable `combatSummaryPrompt` | Valid targets, allies, weapons, spells, 6 recent messages, action recognition rules, JSON format | No (JSON) | Fast |
| 4 | **Combat Narrative** | `computeCombatNarrativePrompts()`, `getCombatNarrativePrompt()` | User-customizable `combatNarrationPrompt` | Entity details, player flavor text, formatted log summary, ending instruction | Yes (stream) | Fast |
| 5 | **Enemy AI Decision** | `buildEnemyDecisionPromptV2()`, `getEnemyAIPrompt()` | User-customizable `combatTurnPrompt` | Enemy stats/HP/AC, spatial warnings, ranked targets, legal actions with scores, CHOICE:/FLAVOR: format | No | Fast |
| 6 | **Context Extraction** | `extractContextFromResponse()` | Internal | DM narrative text | No | Fast |
| 7 | **Session Summary** | `buildSummaryPrompt()` | Internal | Last N messages | No | Main |

### Source-of-Truth Conflicts

| Data Point | Authoritative Source | What Actually Happens | Violation? |
|---|---|---|---|
| HP values | Engine `CombatEntity.hp` | Narrator regex-parses `/(\\d+)\/(\\d+)\\s*HP/` from `log.description` | **YES** — prose scraped for facts |
| Spell name | `CastSpellPayload.spellName` | Narrator regex-parses `/casts (.+?)!?$/` from log description | **YES** — prose scraped for facts |
| Damage type | Resolved `dt` in `applyWeaponDamage` | Log entry used `attacker.damageType` (entity default) instead of resolved value | **YES** — wrong source used (fixed 2026-04-15) |
| Weapon stats | SRD data (`equipment.json`) | `deriveDamageFormula` bailed to `1d4` unarmed if `item.properties` was missing, without trying SRD | **YES** — dual derivation paths (fixed 2026-04-15) |
| Whose turn | Engine `turnOrder[turnIndex]` | Narrator told to say "whose turn next" without receiving the name | **YES** — missing input, LLM hallucinated |
| Active player | `activePlayerId` parameter | Engine `getCurrentTurnEntity()` | Can diverge if action causes turn advance before narrator runs |
| Character sheet | `formatCharacterSheet()` (DB + actorSheet) | `formatCharacterSheetForCombat()` (DB + engine entity) | Different formatters in different paths |
| NPC dispositions | None (inferred from prose) | `extractContextFromResponse()` scrapes DM narrative | **YES** — no structured source exists |
| Quest status | None (inferred from prose) | Same — extracted from narrative text | **YES** — no structured source exists |
| Equipment changes | `actorSheet` in DB | Only updates via manual character edit, not from DM narrative | Drift between story and sheet |

---

## C. Brittleness Findings

### Combat Pipeline

**C1. Two Parallel Action Paths With Different Narrative Handling (HIGH)**
Files: message-send.ts, routers.ts

- Chat path: parses text -> submitAction -> **inline narrative** (awaited) -> save -> fire-and-forget runAILoop
- Sidebar submitAction: submitAction -> persist -> fire-and-forget runAILoop -> **no narrative at all**
- Sidebar submitRoll: apply roll -> **mechanical summary saved immediately** -> async LLM narrative saved later -> then runAILoop

Impact: sidebar actions produce no narrative. If both paths are used, chat history has inconsistent DM response patterns. submitRoll creates two DM messages for one action.

**C2. Narrator Extracts Facts from Prose via Regex (MEDIUM)**
File: combat-narrator.ts

HP parsed from description strings. Spell names parsed from description strings. Both have structured alternatives (`log.amount`, `narrativeContext.spellName`) that are ignored. Any change to the engine's description format silently breaks narration.

**C3. Narrator Doesn't Know Next Entity Name (MEDIUM)**
File: combat-narrator.ts

The ending instruction tells the LLM to state whose turn is next, but never provides the name. The LLM must guess or omit it. The name is already computed in message-send.ts but not passed through.

**C4. `playerHasRemainingResources` Computed Differently in Two Paths (MEDIUM)**
Files: message-send.ts, routers.ts

Different checks in each file. Neither checks `extraAttacksRemaining`. Same question, two calculators, inconsistent answers.

**C5. Phase Branch Exhaustiveness Not Enforced (MEDIUM)**
File: message-send.ts

New engine phases (AWAIT_SMITE_DECISION, AWAIT_DEATH_SAVE, etc.) that lack an explicit branch fall through to non-combat DM chat while combat is active. No compile-time or runtime guard.

**C6. `runAILoop` Fire-and-Forget (LOW)**
File: message-send.ts

After the player's narrative is saved, `runAILoop` is `.catch()` only. If it fails, combat stalls with no enemy turn and no error visible to the player.

**C7. `actorName` vs Entity Name (LOW)**
File: message-send.ts

Narrator receives `character.name` from DB; engine uses `entity.name` set at combat init. Renaming a character mid-combat causes narrator and logs to disagree.

**C8. previewContext Doesn't See V2 BattleState (LOW)**
Files: routers.ts, message-send.ts

`previewContext` omits `v2BattleState`, so debugging prompts during combat shows the wrong context.

**C9. Enemy AI `parseEnemyAction` Has No Test Coverage (LOW)**
File: enemy-ai-controller.ts

CHOICE:/FLAVOR: parsing, legacy ACTION:/TARGET_ID: fallback, and the ultimate "pick first legal attack" fallback are all untested.

### Data Resolution and Loading

**C10. SRD Loader Fails Silently Under ESM (FIXED)**

`getSrdLoader()` used `__dirname` which is undefined in ESM mode (`node --import tsx/esm`). The loader initialized **empty** (0 equipment entries). Every weapon lookup returned null. All damage formulas fell back to `1d4 bludgeoning`. Fixed by switching to `import.meta.dirname`.

This is a pattern risk: any singleton that initializes at import time using CJS assumptions will fail the same way.

**C11. Dual Weapon Derivation Paths (FIXED)**

`deriveDamageFormula` and `buildCombatWeapons` both computed weapon stats. `deriveDamageFormula` bailed to unarmed `1d4` if the equipment item lacked a `properties` object — without trying SRD. `buildCombatWeapons` did try SRD. The entity-level `damageFormula` came from the broken path. Fixed by restructuring `deriveDamageFormula` to try SRD before falling back.

**C12. Damage Log Used Wrong Source (FIXED)**

`applyWeaponDamage` resolved the correct damage type to local variable `dt`, but logged `attacker.damageType` (the entity default) in the combat log entry, description, and activity log. The narrator and combat log could show "bludgeoning" while the engine actually applied "piercing." Fixed by using `dt` everywhere.

**C13. Action Parser JSON Fragility (FIXED)**

`parseLLMResponse` called `JSON.parse()` on the full LLM response. The model consistently appended explanation text after the JSON object, causing SyntaxError. Every combat action returned "I'm not sure what you want to do." Fixed by extracting the first `{...}` object via brace-depth tracking.

**C14. Stale Combat State Persisted to DB (ONGOING)**

Combat state is serialized to the database. If weapon stats, damage types, or formulas were wrong when combat was created (e.g. because the SRD loader was broken), those wrong values survive server restarts and code fixes. Loading from DB preserves the stale data. There is no migration, re-resolution, or version field on saved state.

### Non-Combat Game State

**C15. World State Inferred from Prose, Not Declared (HIGH)**

NPCs, locations, quests, and world events are extracted from DM narrative text by `extractContextFromResponse()` — an LLM call that reads prose and tries to infer what happened. If the LLM misreads the narrative, or the narrative is ambiguous, the "world model" degrades silently. There is no structured mechanism for the DM response to **declare** state changes.

**C16. Session Summaries Are Lossy Memory (MEDIUM)**

When older messages exceed the context window, `buildSummaryPrompt()` compresses them. Detail is lost. The DM's "memory" of earlier events depends on what the summarizer chose to keep. There is no structured event log preserving facts independently of prose compression.

**C17. Character Sheet Doesn't Update from Narrative (MEDIUM)**

If the DM narrates "you level up" or "you find an enchanted shield," the `actorSheet` and `actorState` in the database do not update. Equipment, level, proficiencies, and spell lists only change through the character edit UI. Over time, the story and the sheet drift apart.

---

## D. Phased Recommendations

### Phase 1: Contract — One Context Object Per Request

**D1. Create `CombatPromptContext`**
Define a typed object built once per combat interaction — from `(engine, actionResult, character, parsedAction)`. Contains: `activePlayerId`, `nextEntityName`, `playerHasRemainingResources`, weapon/spell context, log slice, actor display name, ending instruction. All narrator, query, and narrative functions receive this instead of computing fragments ad-hoc.

This is the single highest-leverage structural change. It eliminates C2 (narrator regex — context carries structured fields), C3 (next entity name — on the context), C4 (resource computation — one helper, one result), and C7 (actor name — resolved once from engine entity).

**D2. Narrator and log emission use structured fields only**
`formatLogEntry()` uses `log.amount` and entity lookup for HP, not regex on `log.description`. Spell names come from `narrativeContext.spellName` or a structured log field. Log entries emitted by the engine use the resolved `dt` variable, not entity defaults. No prose-to-fact path survives.

### Phase 2: Collapse Duplicate Logic

**D3. Shared `computePlayerHasRemainingResources` helper**
One function checking `actionUsed`, `bonusActionUsed`, AND `extraAttacksRemaining`. Used by both message-send.ts and routers.ts.

**D4. Exhaustive phase guard**
After all phase branches in `executeMessageSend`, add an explicit check:
```typescript
if (engine && enginePhase && !['IDLE','RESOLVED'].includes(enginePhase) && !handledByV2) {
  console.error(`[CombatV2] Unhandled phase: ${enginePhase}`);
  return { response: "Something unexpected happened in combat. Please try again.", ... };
}
```

**D5. Fix previewContext to pass v2BattleState**
So debugging prompts match production prompts during active combat.

### Phase 3: Unify Entry Paths

**D6. One internal "apply combat input" function**
Both tRPC routes (chat `messages.send` and sidebar `submitAction` / `submitRoll`) call the same function after their input differs (parsed text vs structured action). This function handles: persist, narrate (or explicitly skip with a documented reason), schedule AI loop. Eliminates C1.

**D7. Add narrative generation to `submitAction`**
Or document that sidebar actions are narration-free by design with UX copy so players aren't surprised. Either way, the decision is explicit, not accidental.

### Phase 4: Guards and Tests

**D8. `parseEnemyAction` unit tests**
Test: valid CHOICE/FLAVOR, missing CHOICE, legacy ACTION/TARGET_ID format, garbled LLM output, multi-line responses.

**D9. Snapshot tests for `computeCombatNarrativePrompts`**
Fixed log sequences (melee hit, spell miss, crit, multi-attack, turn-end with resources remaining) with snapshotted `{systemPrompt, userPrompt, logSummary}` output.

**D10. Integration test: submitRoll -> narrative -> AI loop ordering**
Assert that after a damage roll ending a turn: (1) mechanical summary is saved, (2) LLM narrative is saved, (3) enemy AI loop starts only after narrative is saved.

**D11. Persistence version / re-resolution**
Either add a `schemaVersion` field to persisted combat state (so stale data can be detected and re-resolved on load) or re-derive weapon stats from SRD when loading from DB.

### Phase 5: Non-Combat State

**D12. Structured event declarations from DM responses**
Extend the existing structured JSON response format (which already handles `combatInitiated`, `skillCheck`, etc.) to declare world state changes: `npcIntroduced`, `questUpdated`, `itemGained`, `locationDiscovered`. The system records these as structured facts. The LLM still has full creative freedom over how the event is narrated.

**D13. Persistent world-state layer**
A structured store of NPCs (name, disposition, location, alive/dead), quests (status, objectives), and key events — independent of chat history. The DM prompt reads from this instead of re-inferring from compressed summaries. Context extraction becomes a fallback, not the primary path.

**D14. Character sheet kept in sync by the system**
When the DM response declares `itemGained: "Enchanted Shield"` or `levelUp: 6`, the system updates `actorSheet` and `actorState` automatically. The character edit UI remains available for corrections, but the primary path is system-driven.

---

## E. Test Coverage Gaps

| Production Path | Test File | Coverage |
|---|---|---|
| `computeCombatNarrativePrompts` prompt construction | `narrator-prompt.test.ts`, `narrator-scenarios.test.ts` | Good (48+ tests) |
| `formatLogEntry` log -> text | `combat-narrator-log-format.test.ts` | Minimal (2 tests) |
| `generateCombatNarrativeStream` streaming + fallbacks | None | **Missing** |
| `generateAndSaveNarrativeAsync` async save | None | **Missing** |
| `parseEnemyAction` response parsing | None | **Missing** |
| `parseLLMResponse` (action parser) JSON extraction | None | **Missing** |
| `executeMessageSend` V2 phase routing | `message-send-pipeline.test.ts` | Minimal (3 tests) |
| `submitRoll` async narrative + AI loop | None | **Missing** |
| `previewContext` vs production prompt divergence | None | **Missing** |
| Multi-player `activePlayerId` switching | `combat-narrator.test.ts` | Minimal (1 test) |
| `getSrdLoader` path resolution under ESM | None | **Missing** |
| `extractContextFromResponse` accuracy | None | **Missing** |
| Persisted combat state migration / staleness | None | **Missing** |

---

## F. Summary

The core architecture is sound: deterministic engine + LLM narration is the right separation. The brittleness comes from violations of the governing principle — **facts reconstructed from prose** where structured data exists, **parallel entry paths** that build similar-but-not-identical inputs, **implicit contracts** between subsystems, and **no structured state layer** outside of combat.

The same pattern appears at every level:
- **Combat narrator** scrapes HP and spell names from description strings instead of using structured log fields.
- **Weapon resolution** fell back to wrong defaults because a singleton loader failed silently.
- **Non-combat game state** (NPCs, quests, world events) exists only as inferred fragments from compressed chat history.

The fix is not a rewrite — it is **enforcing the principle layer by layer**: one context object per request (Phase 1), shared helpers and structured fields (Phase 2), unified entry paths (Phase 3), guards and tests to lock it (Phase 4), and extending structured state beyond combat to the full game world (Phase 5).

Conversation history (recent messages) remains part of every LLM prompt — it provides creative continuity, tone, and the texture of what just happened at the table. But it is a **complement** to structured state, not a substitute. The system remembers facts; the conversation remembers the feel.
