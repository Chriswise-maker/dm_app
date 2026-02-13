# Phase 4: UI Integration

> **Status**: 🟡 In Progress — Core integration done, polish remaining

## Goal

Wire the Combat Engine V2 to the frontend with a **chat-driven** approach. Player actions come from natural language in the chat, not buttons. The sidebar displays combat state and provides minimal controls.

---

## Design Philosophy

- **Pen & Paper Feel**: Players describe actions in chat ("I swing my sword at the goblin with desperate fury")
- **Narrative Flavor Flows Through**: The LLM captures player descriptions and weaves them into combat narration
- **Minimal UI Controls**: Only Undo and End Combat buttons — no attack/target selectors

---

## Completed Tasks ✅

### 4.1 Chat-Driven Player Action Parser ✅

**File**: `server/combat/player-action-parser.ts`

- [x] LLM prompt to extract structured action from player chat
- [x] Parse action type, target name, flavor text
- [x] Match target name to entity ID from BattleState
- [x] Return `ActionPayload` + `flavorContext` for narrator

**Example Flow**:
```
Player: "I lunge at the goblin with a desperate swing"
         ↓
Parser extracts:
  action: ATTACK
  targetName: "goblin" → matched to "g1"
  flavor: "I lunge at the goblin with a desperate swing"
         ↓
Engine: submitAction({ type: 'ATTACK', attackerId: 'p1', targetId: 'g1' })
         ↓
Narrator: Uses flavor + combat logs → rich narrative
```

### 4.2 Chat Integration ✅

**File**: `server/routers.ts`

- [x] Detect when combat is active and it's player's turn
- [x] Route player message through action parser
- [x] Call `combatV2.submitAction` with parsed action
- [x] Generate narrative response using combat logs
- [x] Trigger enemy AI loop after player action

### 4.6 Enhanced Parser: Roll Extraction ✅

- [x] Parse attack roll from "I roll 20", "nat 20", "I got 18"
- [x] Add `attackRoll?: number` to `LLMParseResult` and `AttackPayload`
- [x] Engine uses provided roll instead of auto-rolling

### 4.6B Two-Step Attack/Damage Flow ✅

- [x] Added `AWAIT_DAMAGE_ROLL` phase to engine
- [x] Added `pendingAttack` to BattleState (attacker, target, isCrit, damageFormula)
- [x] Player attacks pause at AWAIT_DAMAGE_ROLL for damage input
- [x] DM prompts "Roll your damage! (1d8+3)"
- [x] Damage extracted from player message, applied via `engine.applyDamage()`
- [x] Enemy attacks still auto-roll damage (no interruption)

### Bug Fixes ✅

- [x] Narrator "you" bug — fixed to use `entity.type === 'player'`
- [x] Combat deactivation on party wipe — engine destroyed properly
- [x] Activity log formulas — shows dice breakdown `(1d20+5 → [13]+5 = 18)`
- [x] UI sidebar not hiding on combat end — checks for RESOLVED phase

### 4.8 Player Initiative Input ✅

- [x] Added `AWAIT_INITIATIVE` phase to `CombatPhaseSchema`
- [x] Added `PendingInitiative` schema to track pending player rolls
- [x] Created `prepareCombat()` method — pauses for player initiative
- [x] Created `applyInitiative()` method — applies player roll
- [x] Handler in chat flow extracts roll from "I got 18" messages
- [x] DM appends "**Roll for initiative!**" when combat triggers

---

## Deferred to Phase 6 🔜

The following incomplete tasks have been moved to [Phase 6: UI Polish](./phase-6-ui-polish.md):

**4.3-4.5 CombatSidebar** (completed portions kept here):
- [x] Using `combatV2.getState` for polling
- [x] Display entities with HP
- [x] Highlight current turn entity
- [x] Show combat log feed
- [ ] ~~Visual polish (HP bars, styling)~~ → Phase 6

**4.4 Minimal UI Controls** (completed portions kept here):
- [x] End Combat button → calls `combatV2.endCombat`
- [x] Undo button → calls `combatV2.undo`
- [ ] ~~Confirm dialog before ending combat~~ → Phase 6

**4.7 Narrative Streaming** → Phase 6

---

## Completed 🟡 → ✅

### 4.9 Parser Enhancements (Partial) ✅

> **Goal**: Prep parser for Phase 5 features.

**Advantage/Disadvantage**
- [x] Detect "with advantage" / "at disadvantage" in message
- [x] Add `advantage?: boolean` and `disadvantage?: boolean` to parsed result
- [x] Pass to engine attack payload

**Weapon Extraction**
- [x] Parse weapon from "I attack with my longsword"
- [x] Add `weaponName?: string` to parsed result

> **Note**: Clarifying questions deferred to Phase 5 (needs spell system).

### 4.10 Combat Transition / Strict Mode ✅

**Goal**: Prevent LLM from hallucinating mechanic resolutions (damage, rolls) during the transition from narrative to combat.

**Files**: `server/combat/combat-transition.ts`, `server/prompts.ts`, `server/routers.ts`

- [x] **Strict Mode Prompts**: `STRUCTURED_OUTPUT_WRAPPER` explicitly forbids resolved mechanics in initiation.
- [x] **Transition Guard**: `stripCombatMechanics()` regex cleaner removes any leaked mechanical artifacts (HP updates, dice rolls) from the narrative before sending to client.
- [x] **Router Logic**: `hasCombatInitiation` trigger routes narrative through the stripper, ensuring clean handoff to the Combat Engine.

---

## Verification

1. Start combat via "initiate combat - 2 enemies"
2. Attack enemy → get prompted for attack roll
3. Provide attack roll → if hit, get prompted for damage roll
4. Provide damage → damage applied, turn advances
5. Enemy attacks auto-resolve with full activity log transparency
6. Combat ends when all enemies dead or player unconscious
7. Sidebar updates throughout and hides on combat end

---

## Known Bugs (Fixed) ✅

- [x] **Wrong combat end message**: Says "All enemies defeated" even when player goes to 0 HP
  - Fixed: Added `getCombatEndReason()` that returns "All players have fallen..." when appropriate
- [x] **Narrator "you" bug**: Enemies were also called "you"
  - Fixed: Changed `createNameResolver` to use `entity.type === 'player'`
- [x] **Combat UI stayed after party wipe**
  - Fixed: Added `CombatEngineManager.destroy()` on combat end

---

## Files Modified

| File | Change |
|------|--------|
| `server/combat/combat-types.ts` | Added `AWAIT_DAMAGE_ROLL`, `PendingAttack`, `awaitingDamageRoll` |
| `server/combat/combat-engine-v2.ts` | Split processAttack for two-step flow, added `applyDamage()` |
| `server/combat/player-action-parser.ts` | Roll extraction, auto-targeting |
| `server/combat/combat-narrator.ts` | Fixed name resolver to use entity type |
| `server/routers.ts` | AWAIT_DAMAGE_ROLL handler, combat end cleanup |
| `client/src/components/combat/CombatSidebar.tsx` | Phase checks for visibility |

