---
name: Combat Engine Rework
overview: A staged rework of the D&D 5e combat engine, progressing from critical bug fixes through smarter AI, action economy, conditions, and spellcasting. Each stage is independently playable and includes tests.
todos:
  - id: stage-1
    content: "Stage 1: Bug Fixes and Hardening — dice mocking, shallow copy, log persistence, crit detection, endTurn skip, submitRoll validation, concurrency lock, error handling, dead code cleanup"
    status: done
  - id: stage-2
    content: "Stage 2: Smarter Enemies — target scoring, enriched entity data, narrator multi-player fix, UNKNOWN parser fix, narrative consistency"
    status: done
  - id: stage-3
    content: "Stage 3: Legal Action Architecture — getLegalActions(), wire enemy AI, expose in getState"
    status: done
  - id: stage-4
    content: "Stage 4: Action Economy — turn resource tracking, stop auto-ending turns, new action types (Dodge/Dash/Disengage/Help/Hide/Ready/UseItem/OpportunityAttack), update parser and AI, contextual manual ('What can I do?' queries), action point tracker UI"
    status: done
  - id: stage-5
    content: "Stage 5: Conditions, Death Saves, and Healing — condition schema + effects, death saves, healing action, damage resistance/immunity/vulnerability, tempHp"
    status: done
  - id: stage-6
    content: "Stage 6: Spellcasting — spell schema, CAST_SPELL action, AWAIT_SAVE_ROLL phase, concentration, wire into legal actions and AI"
    status: done
  - id: stage-7
    content: "Stage 7: Open5e Integration — API client, map to CombatEntity, wire into combat initiation"
    status: pending
isProject: false
---

# Combat Engine Rework — Full Implementation Plan

This plan replaces the existing Phase 5 roadmap in [phase-5-roadmap.md](dm_app/docs/combat/phase-5-roadmap.md). Each stage is fully playable and testable. An agent should execute one stage at a time, run tests after each substep, and not proceed to the next stage until all tests pass.

**Key files overview:**

- Engine: [combat-engine-v2.ts](dm_app/server/combat/combat-engine-v2.ts)
- Types: [combat-types.ts](dm_app/server/combat/combat-types.ts)
- Manager: [combat-engine-manager.ts](dm_app/server/combat/combat-engine-manager.ts)
- Enemy AI: [enemy-ai-controller.ts](dm_app/server/combat/enemy-ai-controller.ts)
- Narrator: [combat-narrator.ts](dm_app/server/combat/combat-narrator.ts)
- Player parser: [player-action-parser.ts](dm_app/server/combat/player-action-parser.ts)
- Router: [routers.ts](dm_app/server/routers.ts) (combatV2 at ~line 1755, messages.send combat at ~line 430)
- Tests: [combat-engine-v2.test.ts](dm_app/server/combat/__tests__/combat-engine-v2.test.ts)
- Client dice utils: [dice-utils.ts](dm_app/client/src/lib/dice-utils.ts)

---

## Stage 1: Bug Fixes and Hardening

Goal: Fix all known bugs and make the existing system reliable before adding features. No new features.

### 1.1 — Add dice mocking to tests (do this FIRST — all later test work depends on it)

**File:** [combat-engine-v2.test.ts](dm_app/server/combat/__tests__/combat-engine-v2.test.ts)

- Create a `mockRollDice` utility that replaces the `rollDice` function (line 52 of the engine) with deterministic results
- The engine's `rollDice` at line 52 is a module-level function using `new DiceRoll(formula)`. To mock it: extract `rollDice` into its own exported module (e.g., `server/combat/dice-utils-server.ts`), then import it in the engine. In tests, use `vi.mock()` to control it
- Alternatively: inject a `rollFn` into the engine constructor that defaults to `rollDice` but can be overridden in tests. This is the simpler approach — add an optional `rollFn` parameter to the `CombatEngineV2` constructor (line 92)

**Test to write:**

```typescript
it("should use injected roll function for deterministic tests", () => {
  const mockRoll = () => ({ total: 15, rolls: [15], isCritical: false, isFumble: false });
  const engine = createCombatEngine(1, {}, mockRoll);
  // ... verify the mock is used
});
```

**Fix flaky tests:** Update the existing "should hit when roll meets AC" test (line 164) and "should record attack and damage logs" test (line 188) to use the mock instead of hoping for good rolls.

### 1.2 — Fix `getState()` shallow copy

**File:** [combat-engine-v2.ts](dm_app/server/combat/combat-engine-v2.ts), line 114

Change `getState()` from:

```typescript
return { ...this.state };
```

To a deep clone (use `structuredClone` or the existing `cloneStateForHistory` at line 43):

```typescript
return structuredClone(this.state) as Readonly<BattleState>;
```

**Test:**

```typescript
it("should return a deep copy from getState — mutations do not affect engine", () => {
  // start combat, get state, mutate returned state's entities[0].hp
  // get state again, verify hp is unchanged
});
```

### 1.3 — Fix log persistence

**File:** [combat-engine-v2.ts](dm_app/server/combat/combat-engine-v2.ts)

Currently `this.state.log` is always `[]`. Logs are returned from methods but never stored.

In `createLogEntry` (line 1129), after creating the entry, also push it to `this.state.log`:

```typescript
this.state.log.push(entry);
```

Cap the log array to avoid unbounded growth (e.g., keep last 200 entries).

**Test:**

```typescript
it("should persist log entries to state.log", () => {
  // start combat, submit attack, check engine.getState().log.length > 0
});
it("should include logs after export/import round-trip", () => {
  // start combat, attack, export, create new engine, import, check logs exist
});
```

### 1.4 — Fix crit detection from player-provided rolls

**File:** [combat-engine-v2.ts](dm_app/server/combat/combat-engine-v2.ts), `processAttack` method (line 782)

Lines 846-847 try to reverse-engineer the raw d20 from the total:

```typescript
isCritical = payload.attackRoll >= 20 + attacker.attackModifier;
isFumble = payload.attackRoll <= 1 + attacker.attackModifier;
```

Fix: Add a `rawD20?: number` field to `AttackPayloadSchema` (line 222 of combat-types.ts). When present, use it directly for crit/fumble detection:

```typescript
if (payload.rawD20 !== undefined) {
  isCritical = payload.rawD20 === 20;
  isFumble = payload.rawD20 === 1;
} else if (payload.attackRoll !== undefined) {
  // Legacy path: reverse-engineer (keep for chat fallback)
  isCritical = payload.attackRoll >= 20 + attacker.attackModifier;
  isFumble = payload.attackRoll <= 1 + attacker.attackModifier;
}
```

Update `resolveAttackRoll` (line 726) to pass `rawD20` through to `processAttack`.

**Tests:**

```typescript
it("should detect nat 20 crit via rawD20 field", () => { ... });
it("should detect nat 1 fumble via rawD20 field", () => { ... });
it("should NOT crit when total >= 20+mod but rawD20 is not 20", () => { ... });
```

### 1.5 — Fix `endTurn` round boundary skip

**File:** [combat-engine-v2.ts](dm_app/server/combat/combat-engine-v2.ts), `endTurn` method (line 509)

The dead-entity skip loop (lines 540-552) wraps `turnIndex` via modulo but does NOT increment `round` when wrapping past the end. Fix: track whether the index wrapped past `turnOrder.length` during the skip loop and increment `round` if so.

**Test:**

```typescript
it("should increment round when skipping dead entities wraps past turn order end", () => {
  // Create 3 entities: player(init 20), enemy1(init 15), enemy2(init 10)
  // Kill enemy1 and enemy2
  // End player's turn — should wrap to round 2 and land on player again
  // Verify round === 2
});
```

### 1.6 — Fix `submitRoll` upper-bound validation

**File:** [routers.ts](dm_app/server/routers.ts), line 2047

Change:

```typescript
rawDieValue: z.number().int().min(1),
```

To validate against the roll type. Inside the handler (after line 2052), add a guard:

```typescript
if (input.rollType === 'initiative' || input.rollType === 'attack') {
  if (input.rawDieValue > 20) {
    return { success: false, error: `Invalid d20 roll: ${input.rawDieValue} (max 20)` };
  }
}
```

For damage rolls, validate against the formula's max using the existing `validateDiceRoll` from [combat-validators.ts](dm_app/server/combat/combat-validators.ts).

**Test:** (integration test or unit test of the validation logic)

```typescript
it("should reject d20 rolls above 20", () => { ... });
it("should reject damage rolls above formula maximum", () => { ... });
```

### 1.7 — Add concurrency lock to CombatEngineManager

**File:** [combat-engine-manager.ts](dm_app/server/combat/combat-engine-manager.ts)

Add a per-session lock mechanism. Simple approach: a `Map<number, Promise<void>>` of pending operations. Wrap engine-mutating operations in a queue:

```typescript
private locks = new Map<number, Promise<void>>();

async withLock<T>(sessionId: number, fn: () => Promise<T>): Promise<T> {
  const existing = this.locks.get(sessionId) ?? Promise.resolve();
  let resolve: () => void;
  const next = new Promise<void>(r => { resolve = r; });
  this.locks.set(sessionId, next);
  await existing;
  try {
    return await fn();
  } finally {
    resolve!();
  }
}
```

Update `submitRoll` and `submitAction` in [routers.ts](dm_app/server/routers.ts) to use `CombatEngineManager.withLock(sessionId, async () => { ... })`.

Add a `runningAILoop` flag per session to prevent re-entrant `runAILoop` calls.

**Test:**

```typescript
it("should serialize concurrent operations on the same session", async () => {
  // Fire two mutations concurrently, verify they don't interleave
});
```

### 1.8 — Fix error handling in messages.send combat handlers

**File:** [routers.ts](dm_app/server/routers.ts)

In the `AWAIT_DAMAGE_ROLL` handler (line 434), `AWAIT_ATTACK_ROLL` handler (line 519), and `AWAIT_INITIATIVE` handler (line 589):

- Check `result.success` BEFORE generating narrative
- If `!result.success`, return the error message to the player instead of proceeding

Add missing RESOLVED check in `submitAction` endpoint (line 1900): after `engine.submitAction()`, check if `newState.phase === 'RESOLVED'` and destroy the engine if so (same pattern as `submitRoll`).

**Test:**

```typescript
it("should not generate narrative when engine mutation fails", () => { ... });
```

### 1.9 — Clean up dead code

- Remove `CombatEntityWithHooks` interface (line 428 of combat-types.ts) — it's never implemented
- Remove unused settings `autoCritDamage` and `allowNegativeHP` from `GameSettingsSchema` (line 325), OR implement them. Recommendation: remove for now, add back when implementing the features
- Note: `dice-roller.ts` IS used by `routers.ts` (lines 1161, 1277) for enemy generation — do NOT delete it. But document that the engine itself uses `@dice-roller/rpg-dice-roller` instead

**Test:** Run `npm run check` (TypeScript) to verify no type errors after removal.

---

## Stage 2: Smarter Enemies

Goal: Enemies feel tactical within the current constraints (attack or end turn). No engine action changes.

### 2.1 — Add target scoring logic (pre-LLM)

**File:** [enemy-ai-controller.ts](dm_app/server/combat/enemy-ai-controller.ts)

Create a new function `scoreTargets(enemy, state)` that returns players sorted by tactical priority:

- Lowest HP percentage first (finish off wounded targets)
- Prefer targets that are concentrating (if concentration is tracked later, prepare the field now)
- Avoid UNCONSCIOUS targets (unless no ALIVE targets remain)
- Break ties randomly

Call this BEFORE the LLM prompt. Include the ranked target list in the prompt so the LLM has guidance:

```
Recommended targets (most to least tactical):
1. Elara the Wizard [id: p2] — 3/20 HP (15%), vulnerable
2. Thorin the Fighter [id: p1] — 25/30 HP (83%), healthy
```

**Test file:** Create `server/combat/__tests__/enemy-ai-scoring.test.ts`

```typescript
it("should rank low-HP targets higher", () => { ... });
it("should rank unconscious targets last", () => { ... });
it("should handle single target", () => { ... });
it("should handle all targets unconscious — returns empty", () => { ... });
```

### 2.2 — Enrich enemy entity data for the prompt

**File:** [combat-types.ts](dm_app/server/combat/combat-types.ts)

Add optional fields to `CombatEntitySchema` (line 99):

```typescript
tacticalRole: z.enum(['brute', 'skirmisher', 'controller', 'sniper', 'beast', 'minion']).optional(),
isRanged: z.boolean().optional().default(false),
preferredRange: z.nativeEnum(RangeBand).optional(),
```

**File:** [enemy-ai-controller.ts](dm_app/server/combat/enemy-ai-controller.ts)

Update `buildEnemyDecisionPromptV2` (line 30) to include:

- The enemy's `tacticalRole` if set
- Whether this enemy is ranged
- HP percentage for all entities (not just raw numbers)
- Who is currently the biggest threat

### 2.3 — Fix narrator multi-player "you" ambiguity

**File:** [combat-narrator.ts](dm_app/server/combat/combat-narrator.ts)

In `createNameResolver` (line 16), instead of mapping ALL player entities to `"you"`, only map the ACTIVE player (the one whose turn it is or who is being targeted) to `"you"`. Pass the active player's ID as a parameter:

```typescript
function createNameResolver(entities: CombatEntity[], activePlayerId?: string): (id: string | undefined) => string
```

Use the entity's name for other players: "Thorin" instead of "you" when Thorin is not the active character.

**Test file:** Create `server/combat/__tests__/combat-narrator.test.ts`

```typescript
it("should use 'you' only for the active player", () => { ... });
it("should use name for non-active players", () => { ... });
```

### 2.4 — Fix UNKNOWN parser silently ending turns

**File:** [player-action-parser.ts](dm_app/server/combat/player-action-parser.ts)

In the handler for `UNKNOWN` action type (around line 324):

- Instead of returning an `END_TURN` payload, return an error payload:

```typescript
return {
  action: { type: 'END_TURN', entityId: currentPlayerId },
  flavorText: '',
  confidence: 0,
  error: 'UNRECOGNIZED_ACTION',
};
```

- In [routers.ts](dm_app/server/routers.ts) ACTIVE phase handler (~line 690), check for `error === 'UNRECOGNIZED_ACTION'` and return a DM message asking for clarification instead of ending the turn:

```
"I'm not sure what you want to do. Try describing an action like 'I attack the goblin' or 'I end my turn.'"
```

**Test:**

```typescript
it("should return UNRECOGNIZED_ACTION for gibberish input", () => { ... });
it("should NOT end the player's turn on unrecognized input", () => { ... });
```

### 2.5 — Unify narrative quality between chat and dice roller

**File:** [routers.ts](dm_app/server/routers.ts), `submitRoll` endpoint (line 2046)

Currently `submitRoll` uses raw log concatenation (line ~2115):

```typescript
result.logs.map(l => l.description).join('\n')
```

Replace with a call to `generateCombatNarrative()` (same function used by the chat path and enemy AI). This ensures all combat narration goes through the LLM narrator.

**Test:** Manual verification (LLM-dependent). Add a comment documenting this choice.

---

## Stage 3: Legal Action Architecture

Goal: The engine knows what each entity can legally do. AI and parser use this.

### 3.1 — Implement `getLegalActions(entityId)`

**File:** [combat-engine-v2.ts](dm_app/server/combat/combat-engine-v2.ts)

Add a new public method:

```typescript
getLegalActions(entityId: string): LegalAction[]
```

Where `LegalAction` is a new type in [combat-types.ts](dm_app/server/combat/combat-types.ts):

```typescript
export interface LegalAction {
  type: ActionType;              // 'ATTACK' | 'END_TURN' (expand in Stage 4)
  targetId?: string;             // who can be targeted
  targetName?: string;           // display name
  weaponName?: string;           // what weapon
  description: string;           // human-readable: "Attack Goblin with longsword"
}
```

Implementation logic:

- If phase is not ACTIVE or it's not this entity's turn, return `[]`
- For each alive enemy (from this entity's perspective), add an ATTACK action
- Always include END_TURN
- Filter out invalid targets (self, dead, fled)

**Test file:** Create `server/combat/__tests__/legal-actions.test.ts`

```typescript
it("should return attack actions for each alive enemy", () => { ... });
it("should always include END_TURN", () => { ... });
it("should return empty array when not entity's turn", () => { ... });
it("should not include dead entities as targets", () => { ... });
it("should not include self as target", () => { ... });
```

### 3.2 — Wire enemy AI to use legal actions

**File:** [enemy-ai-controller.ts](dm_app/server/combat/enemy-ai-controller.ts)

Update `buildEnemyDecisionPromptV2` to call `engine.getLegalActions(enemy.id)` and list the legal options in the prompt:

```
Your available actions:
1. ATTACK target=p1 — Attack Thorin the Fighter with claws
2. ATTACK target=p2 — Attack Elara the Wizard with claws
3. END_TURN — End your turn

Choose the number of your action and explain WHY in one sentence.
```

Update the parser to match the selection back to a `LegalAction`, rather than free-parsing ACTION/TARGET_ID/FLAVOR.

**Test:**

```typescript
it("should only select from legal actions", () => { ... });
it("should fall back to first legal attack when LLM returns invalid choice", () => { ... });
```

### 3.3 — Expose legal actions in `getState`

**File:** [routers.ts](dm_app/server/routers.ts), `combatV2.getState` (line 1759)

Add `legalActions` to the returned state when it's a player's turn:

```typescript
legalActions: state.phase === 'ACTIVE' ? engine.getLegalActions(currentEntityId) : [],
```

This prepares the frontend for a future "action menu" UI without requiring it now.

---

## Stage 4: Action Economy

Goal: Turns support multiple actions. Attacks don't auto-end turns. This is the largest stage.

### 4.1 — Add turn resource tracking to BattleState

**File:** [combat-types.ts](dm_app/server/combat/combat-types.ts)

Add to `BattleState` (line 341):

```typescript
turnResources?: {
  actionUsed: boolean;
  bonusActionUsed: boolean;
  movementUsed: boolean;
  reactionUsed: boolean;
  extraAttacksRemaining: number;  // for Fighter Extra Attack etc.
};
```

### 4.2 — Stop auto-ending turns after attack

**File:** [combat-engine-v2.ts](dm_app/server/combat/combat-engine-v2.ts)

In `processAttack` (line 782):

- On miss (line 887): do NOT call `endTurn()`. Instead, mark `actionUsed = true` and return
- On hit + damage applied (line 974): do NOT call `endTurn()`. Mark `actionUsed = true` and return
- Let the player explicitly end their turn via `END_TURN` or auto-end when all resources are spent

Add a `startTurnResources(entityId)` call in `startTurn` (line 490) that initializes `turnResources`.

Add an `autoEndTurnIfExhausted()` check after each action: if `actionUsed && bonusActionUsed` (or entity has no bonus actions), auto-end. For enemies, always auto-end after their action (preserve current behavior) unless multiattack is available.

### 4.3 — Add new action types to the engine

**File:** [combat-engine-v2.ts](dm_app/server/combat/combat-engine-v2.ts)

Add handler cases in `submitAction` (line 635) for:

- `DODGE` — sets a flag on the entity; attackers have disadvantage until next turn. Uses the Action
- `DASH` — doubles movement (theater-of-mind: changes range band). Uses the Action
- `DISENGAGE` — allows movement without opportunity attacks (future-proofing). Uses the Action
- `HELP` — gives advantage to the next attack on a target by an ally. Uses the Action

Add corresponding payload schemas in [combat-types.ts](dm_app/server/combat/combat-types.ts) and extend the `ActionPayloadSchema` discriminated union (line 247).

### 4.4 — Update `getLegalActions` for action economy

**File:** [combat-engine-v2.ts](dm_app/server/combat/combat-engine-v2.ts)

`getLegalActions` should now check `turnResources`:

- If `actionUsed` and no `extraAttacksRemaining`: no ATTACK, DODGE, DASH, DISENGAGE, HELP
- Always include END_TURN
- If entity has bonus action abilities (future), include those when `!bonusActionUsed`

### 4.5 — Update player parser

**File:** [player-action-parser.ts](dm_app/server/combat/player-action-parser.ts)

Update the LLM prompt (line 51) and `fallbackParse` (line 335) to recognize:

- "I dodge" / "I take the Dodge action" → `DODGE`
- "I dash" / "I run" → `DASH`
- "I disengage" / "I back away carefully" → `DISENGAGE`
- "I help Thorin" → `HELP`
- "I end my turn" / "done" → `END_TURN`

### 4.6 — Update enemy AI for multi-action turns

**File:** [enemy-ai-controller.ts](dm_app/server/combat/enemy-ai-controller.ts)

For enemies with multiattack, the `executeEnemyTurn` function should loop through available actions:

1. Get legal actions
2. If ATTACK is legal and entity has attacks remaining, choose target and attack
3. Repeat until no attacks remain
4. End turn

**Tests:**

```typescript
describe("Action Economy", () => {
  it("should NOT auto-end turn after attack miss", () => { ... });
  it("should NOT auto-end turn after dealing damage", () => { ... });
  it("should end turn when player explicitly sends END_TURN", () => { ... });
  it("should apply Dodge disadvantage to incoming attacks", () => { ... });
  it("should allow extra attacks when extraAttacksRemaining > 0", () => { ... });
  it("should prevent attack when action already used and no extra attacks", () => { ... });
  it("should auto-end enemy turn after all actions exhausted", () => { ... });
});
```

### 4.7 — Contextual Manual: "What can I do?" support

Goal: When it's a player's turn, they can ask natural-language questions like "What can I do?", "What are my options?", or "How does Dodge work?" and the LLM responds as a contextual rules manual — combining the player's current legal actions, turn resources, and D&D 5e rules knowledge.

**File:** [player-action-parser.ts](dm_app/server/combat/player-action-parser.ts)

Add a new classification category `QUERY` alongside ATTACK, DODGE, etc. The parser should detect questions/help requests:

- "What can I do?" / "What are my options?"
- "How does grapple work?"
- "Can I attack twice?"
- "What does Dodge do?"
- "How much movement do I have?"

When classified as `QUERY`, return a special result:

```typescript
return {
  action: null,           // no action taken — turn is NOT consumed
  type: 'QUERY',
  flavorText: '',
  confidence: 1,
};
```

**File:** [routers.ts](dm_app/server/routers.ts), ACTIVE phase handler

When the parser returns `type: 'QUERY'`:

1. Call `engine.getLegalActions(entityId)` to get current options
2. Read `turnResources` from state to know what's been used
3. Build an LLM prompt that includes:
   - The player's legal actions (formatted as a readable list)
   - Current turn resource state (action used? bonus action available? etc.)
   - The entity's stats/abilities for context
   - The original question
4. Send the LLM response back as a DM message (system-style, not narrative)
5. Do NOT advance the turn — the player still gets to act

Example interaction:
```
Player: "What can I do?"
DM: "It's your turn! You have your Action and Bonus Action available.
     You can:
     • Attack — strike a target with your longsword (+5 to hit, 1d8+3 slashing)
     • Dodge — impose disadvantage on all attacks against you until your next turn
     • Dash — double your movement this turn
     • Disengage — move without provoking opportunity attacks
     • Help — give an ally advantage on their next attack against a target
     • End Turn — pass to the next combatant
     You also have your Reaction available if an enemy tries to flee."
```

**Tests:**

```typescript
it("should detect 'what can I do' as a QUERY, not an action", () => { ... });
it("should NOT consume the player's action when answering a query", () => { ... });
it("should include legal actions in the query response", () => { ... });
it("should include turn resource state in the query response", () => { ... });
```

### 4.8 — Action Point Tracker UI

Goal: Show the player a clear visual tracker of their remaining turn resources (action, bonus action, reaction, movement) so they know what they've spent and what's left.

**File:** [combat-types.ts](dm_app/server/combat/combat-types.ts)

Ensure `turnResources` (from 4.1) is included in the state returned by `getState()` so the client can render it.

**File:** Create `client/src/components/combat/ActionPointTracker.tsx`

A compact UI component that displays:

```
┌──────────────────────────────────┐
│  ◉ Action   ◉ Bonus   ◉ React  │
│  ○ Move                         │
└──────────────────────────────────┘
```

- Filled circle (◉) = available, hollow (○) = used
- Gray out used resources
- Animate the transition when a resource is consumed
- Show extra attacks as pips if `extraAttacksRemaining > 0`: e.g. "◉ ◉ Attacks (2 remaining)"
- Tooltip on each resource explaining what it does (mini rules reference)

**File:** Wire into the combat UI (wherever the "your turn" indicator lives)

- Only show when it's the current player's turn and phase is ACTIVE
- Collapse/hide when it's an enemy turn or combat is in a rolling phase

**Tests:**

```typescript
it("should display all resources as available at start of turn", () => { ... });
it("should mark action as used after attack", () => { ... });
it("should hide tracker when it is not the player's turn", () => { ... });
```

---

## Stage 5: Conditions, Death Saves, and Healing

Goal: Conditions have mechanical teeth. Players can die properly and be rescued.

### 5.1 — Implement condition schema

**File:** [combat-types.ts](dm_app/server/combat/combat-types.ts)

Replace `conditions: z.array(z.string())` in `CombatEntitySchema` (line 99) with:

```typescript
export const ConditionSchema = z.object({
  name: z.enum([
    'blinded', 'charmed', 'deafened', 'frightened', 'grappled',
    'incapacitated', 'invisible', 'paralyzed', 'petrified',
    'poisoned', 'prone', 'restrained', 'stunned', 'unconscious',
    'concentrating', 'dodging',
  ]),
  sourceId: z.string().optional(),
  duration: z.number().optional(),     // rounds remaining, undefined = permanent
  appliedAtRound: z.number(),
});
conditions: z.array(ConditionSchema).default([]),
```

### 5.2 — Add condition mechanical effects

**File:** [combat-engine-v2.ts](dm_app/server/combat/combat-engine-v2.ts)

Create helper methods:

```typescript
hasCondition(entityId: string, condition: string): boolean
applyCondition(entityId: string, condition: Condition): CombatLogEntry
removeCondition(entityId: string, conditionName: string): CombatLogEntry
tickConditions(entityId: string): CombatLogEntry[]  // decrement durations, remove expired
```

Wire into `processAttack`:

- **Prone target**: melee attacks have advantage, ranged have disadvantage
- **Stunned/Paralyzed target**: attacks have advantage, hits are auto-crits if within 5ft
- **Poisoned attacker**: attack rolls have disadvantage
- **Dodging target**: attacks have disadvantage
- **Blinded attacker**: disadvantage on attacks
- **Invisible attacker**: advantage on attacks
- **Frightened**: disadvantage on attacks while source is visible (simplified: always)

Wire into `startTurn`:

- Call `tickConditions` to decrement durations and remove expired ones

### 5.3 — Implement death saving throws

**File:** [combat-types.ts](dm_app/server/combat/combat-types.ts)

Add to `CombatEntitySchema`:

```typescript
deathSaves: z.object({
  successes: z.number().default(0),
  failures: z.number().default(0),
}).optional(),
```

**File:** [combat-engine-v2.ts](dm_app/server/combat/combat-engine-v2.ts)

Add `rollDeathSave(entityId: string, roll: number)` method:

- Nat 20: regain 1 HP, become ALIVE, clear death saves
- > = 10: add success. 3 successes = stabilize (UNCONSCIOUS but no more saves)
- < 10: add failure. 3 failures = DEAD
- Nat 1: 2 failures

Wire into `startTurn`: if entity is UNCONSCIOUS and `isEssential`, enter `AWAIT_DEATH_SAVE` phase (new phase).

Taking damage while unconscious: auto-failure (melee within 5ft = 2 failures).

### 5.4 — Implement healing

**File:** [combat-engine-v2.ts](dm_app/server/combat/combat-engine-v2.ts)

Add action type `HEAL` and method:

```typescript
applyHealing(targetId: string, amount: number): ActionResult
```

- Restore HP up to maxHp
- If target is UNCONSCIOUS and HP > 0: set status to ALIVE, clear death saves
- Log a HEALING entry

### 5.5 — Add damage resistance/immunity/vulnerability

**File:** [combat-types.ts](dm_app/server/combat/combat-types.ts)

Add to `CombatEntitySchema`:

```typescript
resistances: z.array(z.string()).default([]),   // ["fire", "bludgeoning"]
immunities: z.array(z.string()).default([]),
vulnerabilities: z.array(z.string()).default([]),
```

**File:** [combat-engine-v2.ts](dm_app/server/combat/combat-engine-v2.ts)

In damage application (around line 928 and 1030):

- Check `target.immunities.includes(damageType)` → 0 damage
- Check `target.resistances.includes(damageType)` → halve damage (floor)
- Check `target.vulnerabilities.includes(damageType)` → double damage

### 5.6 — Add tempHp

**File:** [combat-types.ts](dm_app/server/combat/combat-types.ts)

Add `tempHp: z.number().default(0)` to `CombatEntitySchema`.

In damage application: subtract from `tempHp` first, remainder goes to `hp`.

**Tests:**

```typescript
describe("Conditions", () => {
  it("should apply advantage when attacking prone target in melee", () => { ... });
  it("should apply disadvantage when attacker is poisoned", () => { ... });
  it("should remove conditions when duration expires", () => { ... });
  it("should auto-crit against paralyzed target", () => { ... });
});
describe("Death Saves", () => {
  it("should roll death save at start of unconscious player turn", () => { ... });
  it("should die on 3 failures", () => { ... });
  it("should stabilize on 3 successes", () => { ... });
  it("should regain 1 HP on nat 20 death save", () => { ... });
  it("should add 2 failures on nat 1", () => { ... });
  it("should auto-fail on taking damage while unconscious", () => { ... });
});
describe("Healing", () => {
  it("should restore HP up to max", () => { ... });
  it("should revive unconscious player", () => { ... });
  it("should clear death saves on revival", () => { ... });
});
describe("Damage Modifiers", () => {
  it("should halve damage for resistant target", () => { ... });
  it("should deal 0 damage for immune target", () => { ... });
  it("should double damage for vulnerable target", () => { ... });
  it("should subtract from tempHp before hp", () => { ... });
});
```

---

## Stage 6: Spellcasting

Goal: Players and enemies can cast spells. Area effects, saves, and concentration work.

### 6.1 — Add spell data schema

**File:** [combat-types.ts](dm_app/server/combat/combat-types.ts)

```typescript
export const SpellSchema = z.object({
  name: z.string(),
  level: z.number(),
  school: z.string(),
  castingTime: z.enum(['action', 'bonus_action', 'reaction']),
  range: z.number(),
  isAreaEffect: z.boolean().default(false),
  areaType: z.enum(['sphere', 'cone', 'line', 'cube']).optional(),
  areaSize: z.number().optional(),
  savingThrow: z.enum(['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA']).optional(),
  damageFormula: z.string().optional(),
  damageType: z.string().optional(),
  healingFormula: z.string().optional(),
  requiresConcentration: z.boolean().default(false),
  conditions: z.array(z.string()).default([]),
  description: z.string(),
});
```

Add to `CombatEntitySchema`:

```typescript
spells: z.array(SpellSchema).default([]),
spellSlots: z.record(z.string(), z.number()).default({}),  // { "1": 4, "2": 3 }
spellSaveDC: z.number().optional(),
abilityScores: z.object({
  str: z.number(), dex: z.number(), con: z.number(),
  int: z.number(), wis: z.number(), cha: z.number(),
}).optional(),
```

### 6.2 — Add CAST_SPELL action and AWAIT_SAVE_ROLL phase

**File:** [combat-engine-v2.ts](dm_app/server/combat/combat-engine-v2.ts)

- Add `AWAIT_SAVE_ROLL` and `AWAIT_DEATH_SAVE` to `CombatPhaseSchema`
- Implement `castSpell(casterId, spellName, targetIds)` method:
  - Validate spell is known and slot is available
  - Deduct spell slot
  - If spell requires save: enter `AWAIT_SAVE_ROLL` for each target
  - If spell deals damage: roll damage, apply (with saves halving)
  - If spell heals: apply healing
  - If spell applies condition: apply condition
  - If spell requires concentration: apply `concentrating` condition, drop previous concentration

### 6.3 — Add concentration tracking

- When a concentrating entity takes damage: roll CON save (DC = max(10, damage/2))
- On failure: drop concentration, remove the spell's effects
- When a new concentration spell is cast: drop old one automatically

### 6.4 — Wire spells into legal actions

Update `getLegalActions` to include castable spells (has slot, action/bonus action available).

### 6.5 — Update parser and AI for spells

- Player parser: detect "I cast Fireball at the group" → `CAST_SPELL`
- Enemy AI: if entity has spells, include them in legal actions

**Tests:**

```typescript
describe("Spellcasting", () => {
  it("should deduct spell slot on cast", () => { ... });
  it("should deal area damage to multiple targets", () => { ... });
  it("should halve damage on successful save", () => { ... });
  it("should apply concentration condition", () => { ... });
  it("should drop concentration when taking damage and failing save", () => { ... });
  it("should drop old concentration when casting new concentration spell", () => { ... });
});
```

---

## Stage 7: Open5e Integration

Goal: Real monster stat blocks populate automatically.

### 7.1 — Create Open5e client

**File:** Create `server/combat/open5e-client.ts`

```typescript
export async function fetchMonster(name: string): Promise<CombatEntity | null>
export async function fetchSpell(name: string): Promise<Spell | null>
```

Query `https://api.open5e.com/v1/monsters/?name=...` and map the response to a `CombatEntity` with all fields populated: multiattack, spells, resistances, immunities, ability scores, etc.

### 7.2 — Wire into combat initiation

Update [combat-helpers.ts](dm_app/server/combat/combat-helpers.ts) to optionally look up enemies from Open5e when the DM mentions a standard monster name.

**Tests:**

```typescript
it("should map Open5e goblin to CombatEntity with correct stats", () => { ... });
it("should fall back to generated stats when Open5e lookup fails", () => { ... });
```

---

## Workflow Integration

After each stage is complete, the implementing agent MUST:

1. Run all tests: `cd dm_app && npm test`
2. Run type check: `cd dm_app && npm run check`
3. Update [phase-5-roadmap.md](dm_app/docs/combat/phase-5-roadmap.md) — mark completed items
4. Update [COMBAT_ENGINE.md](dm_app/docs/combat/COMBAT_ENGINE.md) — update status and date
5. Update [combat.md](dm_app/.agent/workflows/combat.md) — update "Current State" and "Next Up"

