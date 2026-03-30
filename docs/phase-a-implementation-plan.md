# Phase A: Close Gaps & Add Spatial Awareness — Implementation Plan

> **Purpose:** Step-by-step implementation spec for a coding agent. Every task includes exact file paths, line numbers (as of 2026-03-29), code changes, and test specs.
>
> **Read first:** [COMBAT_ENGINE.md](combat/COMBAT_ENGINE.md), [ROADMAP.md](ROADMAP.md)

---

## Dependency Graph

```
A1 (Save Rolls)        — no deps, start immediately
A2 (Gate Placeholders) — depends on A5 for OA/Dash/Disengage spatial gating
A3 (Tests)             — depends on A1, A2, A4, A5
A4 (Skill Checks)      — no deps, start immediately
A5 (Spatial Model)     — no deps, start immediately
A6 (Rest Mechanics)    — no deps, start immediately
```

**Recommended execution order:** A1 → A5 → A2 → A4 → A6 → A3

---

## A1. Wire Save Rolls End-to-End

### Problem

The engine already supports `AWAIT_SAVE_ROLL` phase and `submitSavingThrow()` method (combat-engine-v2.ts:2385-2451), but:

1. `getState` endpoint (routers.ts:1159-1204) does NOT compute a `pendingRoll` for `AWAIT_SAVE_ROLL` phase — the dice roller UI never triggers
2. `submitRoll` endpoint (routers.ts:1457-1673) only accepts `rollType: 'initiative' | 'attack' | 'damage' | 'deathSave'` — no `'save'` option
3. Client `DiceRoller.tsx` `PendingRoll` interface (line 12-23) only has `type: 'initiative' | 'attack' | 'damage'` — no `'save'`
4. `message-send.ts` has no handler for `AWAIT_SAVE_ROLL` phase (chat fallback for typing a number)

### Changes

#### 1a. `server/routers.ts` — Add save roll to `getState` pendingRoll computation

**Location:** After the `AWAIT_DAMAGE_ROLL` block (line 1202), before `return null;` (line 1203).

**Add this block:**
```typescript
if (state.phase === 'AWAIT_SAVE_ROLL' && state.pendingSpellSave) {
  const nextTargetId = state.pendingSpellSave.pendingTargetIds[0];
  const target = engine.getEntity(nextTargetId);
  const caster = engine.getEntity(state.pendingSpellSave.casterId);
  const statName = state.pendingSpellSave.saveStat;
  const saveMod = target?.abilityScores
    ? Math.floor(((target.abilityScores as any)[statName.toLowerCase()] ?? 10) - 10) / 2
    : 0;
  return {
    type: 'save' as const,
    formula: '1d20',
    modifier: saveMod,
    entityId: nextTargetId,
    entityName: target?.name || 'Unknown',
    targetName: caster?.name || 'Unknown', // caster is who cast the spell
    prompt: `${target?.name} must make a ${statName} saving throw vs DC ${state.pendingSpellSave.spellSaveDC} (${state.pendingSpellSave.spellName})`,
  };
}
```

**Also:** Add `AWAIT_DEATH_SAVE` pendingRoll while we're here (currently also missing):
```typescript
if (state.phase === 'AWAIT_DEATH_SAVE') {
  const currentEntityId = state.turnOrder[state.turnIndex];
  const entity = engine.getEntity(currentEntityId);
  return {
    type: 'deathSave' as const,
    formula: '1d20',
    modifier: 0,
    entityId: currentEntityId,
    entityName: entity?.name || 'Unknown',
    prompt: `${entity?.name} must make a death saving throw!`,
  };
}
```

#### 1b. `server/routers.ts` — Add `'save'` to `submitRoll` input

**Location:** Line 1460.

**Change:**
```typescript
// FROM:
rollType: z.enum(['initiative', 'attack', 'damage', 'deathSave']),
// TO:
rollType: z.enum(['initiative', 'attack', 'damage', 'deathSave', 'save']),
```

#### 1c. `server/routers.ts` — Add phase mapping for `save`

**Location:** Line 1479-1484 (expectedPhase object).

**Change:**
```typescript
// FROM:
const expectedPhase = {
  initiative: 'AWAIT_INITIATIVE',
  attack: 'AWAIT_ATTACK_ROLL',
  damage: 'AWAIT_DAMAGE_ROLL',
  deathSave: 'AWAIT_DEATH_SAVE',
}[rollType];
// TO:
const expectedPhase = {
  initiative: 'AWAIT_INITIATIVE',
  attack: 'AWAIT_ATTACK_ROLL',
  damage: 'AWAIT_DAMAGE_ROLL',
  deathSave: 'AWAIT_DEATH_SAVE',
  save: 'AWAIT_SAVE_ROLL',
}[rollType];
```

#### 1d. `server/routers.ts` — Add d20 validation for `save` rolls

**Location:** Line 1491.

**Change:**
```typescript
// FROM:
if (rollType === 'initiative' || rollType === 'attack' || rollType === 'deathSave') {
// TO:
if (rollType === 'initiative' || rollType === 'attack' || rollType === 'deathSave' || rollType === 'save') {
```

#### 1e. `server/routers.ts` — Add rollingEntityName for `save`

**Location:** Line 1507-1522 (rollingEntityName IIFE). Add a case before the final `return 'Player'`:

```typescript
if (rollType === 'save' && state.pendingSpellSave) {
  const eid = entityId || state.pendingSpellSave.pendingTargetIds[0];
  return engine!.getEntity(eid)?.name ?? 'Player';
}
```

#### 1f. `server/routers.ts` — Add `save` roll handling in the dispatch block

**Location:** Line 1524-1544. The current structure is:
```typescript
if (rollType === 'initiative') { ... }
else if (rollType === 'attack') { ... }
else if (rollType === 'deathSave') { ... }
else { /* damage */ }
```

**Add before the `else` (damage) block:**
```typescript
else if (rollType === 'save') {
  const targetEntityId = entityId || state.pendingSpellSave!.pendingTargetIds[0];
  result = engine.submitSavingThrow(targetEntityId, rawDieValue);
}
```

**Note:** `submitSavingThrow` is the existing engine method at combat-engine-v2.ts:2385. Verify it's a public method. If not, make it public.

**Also update the rollLabel (line 1555):**
```typescript
// FROM:
const rollLabel = rollType === 'initiative' ? `d20 initiative` : rollType === 'attack' ? `d20 attack` : `damage`;
// TO:
const rollLabel = rollType === 'initiative' ? `d20 initiative`
  : rollType === 'attack' ? `d20 attack`
  : rollType === 'save' ? `d20 saving throw`
  : rollType === 'deathSave' ? `d20 death save`
  : `damage`;
```

**Also update activePlayerId (line 1558-1563) to handle save:**
```typescript
// Add case:
: rollType === 'save'
  ? (entityId || state.pendingSpellSave?.pendingTargetIds[0])
```

#### 1g. `client/src/components/combat/DiceRoller.tsx` — Add `'save' | 'deathSave'` to PendingRoll

**Location:** Line 12-23.

**Change:**
```typescript
// FROM:
type: 'initiative' | 'attack' | 'damage';
// TO:
type: 'initiative' | 'attack' | 'damage' | 'save' | 'deathSave';
```

The rest of the DiceRoller component should work without changes — save rolls are d20 (same as initiative/attack), and the submit path sends `rawDieValue` for any d20 roll.

**Verify:** The `handleRoll` function (line ~90-144) uses `pendingRoll.type` to determine whether to extract the raw d20 vs total. For save rolls, we want the raw d20 (same as initiative/attack). Check the logic and ensure save/deathSave follow the initiative/attack path (extract single d20), not the damage path (extract total). The condition at roughly line 130 should check `if (pendingRoll.type === 'damage')` for the damage case; all others extract raw d20. If the condition is different, adjust so `save` and `deathSave` types extract raw d20.

#### 1h. `server/message-send.ts` — Add chat fallback for AWAIT_SAVE_ROLL

**Location:** After the `AWAIT_DAMAGE_ROLL` handler block (~line 84-170) and before the `AWAIT_ATTACK_ROLL` block (~line 182).

**Add a new phase handler:**
```typescript
// Handle AWAIT_SAVE_ROLL phase — player can type a number as fallback
if (engine && enginePhase === 'AWAIT_SAVE_ROLL') {
  const pending = engine.getState().pendingSpellSave;
  if (pending) {
    const rollMatch = input.message.match(/(\d+)/);
    if (!rollMatch) {
      await db.saveMessage({ sessionId: input.sessionId, characterName: character.name, content: input.message, isDm: 0 });
      const targetId = pending.pendingTargetIds[0];
      const targetEntity = engine.getEntity(targetId);
      await db.saveMessage({
        sessionId: input.sessionId,
        characterName: 'DM',
        content: `${targetEntity?.name || 'You'} need to roll a ${pending.saveStat} saving throw (DC ${pending.spellSaveDC}) against ${pending.spellName}. Roll a d20 and tell me the result.`,
        isDm: 1,
      });
      return { response: 'Awaiting save roll.', combatTriggered: false, enemiesAdded: 0 };
    }

    const rawRoll = Math.min(20, Math.max(1, parseInt(rollMatch[1], 10)));
    const targetEntityId = pending.pendingTargetIds[0];
    const result = engine.submitSavingThrow(targetEntityId, rawRoll);

    await CombatEngineManager.persist(input.sessionId);
    const { syncCombatStateToDb } = await import('./combat/combat-helpers');
    await syncCombatStateToDb(input.sessionId);

    const currentState = engine.getState();
    const narrative = await streamToString(
      await generateCombatNarrativeStream(
        input.sessionId, ctx.user.id, result.logs, input.message,
        character.name, currentState.entities, false, targetEntityId
      ),
      streamHooks?.onNarrativeDelta
    );

    await db.saveMessage({ sessionId: input.sessionId, characterName: character.name, content: input.message, isDm: 0 });
    await db.saveMessage({ sessionId: input.sessionId, characterName: 'DM', content: narrative, isDm: 1 });

    // Handle post-save: check combat end, trigger AI loop
    if (currentState.phase === 'RESOLVED') {
      await CombatEngineManager.destroy(input.sessionId);
    } else {
      const nextEntity = engine.getCurrentTurnEntity();
      if (nextEntity && nextEntity.type === 'enemy') {
        const { runAILoop } = await import('./combat/enemy-ai-controller');
        runAILoop(input.sessionId, ctx.user.id).catch(err => console.error('[CombatV2] AI loop error:', err));
      }
    }

    return { response: narrative, combatTriggered: false, enemiesAdded: 0 };
  }
}
```

#### 1i. Verify `submitSavingThrow` is public

**File:** `server/combat/combat-engine-v2.ts`, line ~2385.

The method signature should NOT have `private` keyword. Check and remove `private` if present, or add a public wrapper method. The router at line 1f needs to call it.

### Verification

After all changes, this flow should work:
1. Enemy casts a spell targeting a player (e.g., Hold Person with WIS save)
2. Engine enters `AWAIT_SAVE_ROLL`, stores `pendingSpellSave`
3. `getState` returns `pendingRoll` with type `'save'`, formula `'1d20'`, modifier (WIS mod), prompt
4. Client `DiceRoller` renders with save prompt
5. Player clicks roll → d20 animation → auto-submit via `submitRoll({ rollType: 'save', rawDieValue, entityId })`
6. Router routes to `engine.submitSavingThrow()` → resolves save → returns to ACTIVE
7. Narrative generated and saved

---

## A2. Gate or Implement Placeholder Mechanics

### Problem

Three actions are advertised in `getLegalActions` but don't fully work:
- **READY** — stored as a condition string but trigger never fires (combat-engine-v2.ts:1209-1239)
- **OPPORTUNITY_ATTACK** — type exists (combat-types.ts:505-512) but `submitAction` falls to default error (combat-engine-v2.ts:1012-1019)
- **DASH / DISENGAGE** — logged but have no mechanical effect without spatial model (combat-engine-v2.ts:1065-1122)

### Strategy

Per roadmap: gate OPPORTUNITY_ATTACK, DASH, DISENGAGE behind A5 (spatial model). For READY, implement a simplified version that fires on the trigger entity's turn.

### Changes

#### 2a. READY — Implement simplified trigger resolution

**Design:** When an entity has a readied action, check at the start of each entity's turn whether any readied triggers match. The LLM would be overkill here; instead use a simple rule: a readied action triggers when the named target takes any action (simplified 5e). The trigger string is stored as `readied:ATTACK:when the goblin comes within reach:target:goblin-1`.

**File:** `server/combat/combat-engine-v2.ts`

**Step 1 — Add a `checkReadiedActions()` method:**

Place near `startTurn()` (~line 742). This method checks if any entity has a readied action whose target is the entity whose turn just started (or whose turn just passed). Call it at the end of `endTurn()` after advancing to next entity, or at the start of each entity's turn.

```typescript
/**
 * Check if any readied actions should trigger.
 * Simplified rule: a readied action with target X fires when X starts its turn.
 * The readied entity uses their reaction to perform the stored action.
 */
private checkReadiedActions(triggeringEntityId: string): CombatLogEntry[] {
    const logs: CombatLogEntry[] = [];

    for (const entity of this.state.entities) {
        if (entity.status !== 'ALIVE') continue;

        const readiedCondition = entity.conditions.find(c => c.startsWith('readied:'));
        if (!readiedCondition) continue;

        // Parse: "readied:ATTACK:trigger text:target:targetId"
        const parts = readiedCondition.split(':');
        const readiedAction = parts[1]; // e.g., "ATTACK"
        const targetId = parts[parts.length - 1]; // last segment after "target:"

        // Check if the triggering entity matches the readied target
        if (targetId !== triggeringEntityId) continue;

        // Check reaction is available (readied actions consume reaction)
        if (this.state.turnResources?.reactionUsed) {
            // This entity's reaction is already used — readied action fizzles
            continue;
        }

        // NOTE: We can't consume the *readying* entity's reaction via turnResources
        // because turnResources tracks the CURRENT turn entity's resources.
        // For cross-turn reactions, we use a simple flag approach.

        // Fire the readied action
        if (readiedAction === 'ATTACK') {
            const target = this.getEntity(triggeringEntityId);
            if (!target || target.status !== 'ALIVE') continue;

            // Execute attack using the readying entity's stats
            const attackRoll = this.rollFn("1d20");
            const rawD20 = attackRoll.total;
            const total = rawD20 + entity.attackModifier;
            const isCritical = rawD20 === 20;
            const isFumble = rawD20 === 1;
            const hit = isCritical || (!isFumble && total >= target.baseAC);

            logs.push(this.createLogEntry("ACTION", {
                actorId: entity.id,
                targetId: triggeringEntityId,
                description: `${entity.name}'s readied attack triggers against ${target.name}!`,
            }));

            if (hit) {
                const damage = this.rollFn(entity.damageFormula);
                const finalDamage = isCritical ? damage.total * 2 : damage.total;
                logs.push(...this.applyDamageToEntity(triggeringEntityId, finalDamage, entity.damageType, entity.id));
                logs.push(this.createLogEntry("ATTACK_ROLL", {
                    actorId: entity.id,
                    targetId: triggeringEntityId,
                    roll: { formula: "1d20", result: total, isCritical, isFumble },
                    success: true,
                    amount: finalDamage,
                    description: `${entity.name} hits ${target.name} with readied attack for ${finalDamage} ${entity.damageType} damage${isCritical ? ' (CRITICAL!)' : ''}.`,
                }));
            } else {
                logs.push(this.createLogEntry("ATTACK_ROLL", {
                    actorId: entity.id,
                    targetId: triggeringEntityId,
                    roll: { formula: "1d20", result: total, isCritical, isFumble },
                    success: false,
                    description: `${entity.name}'s readied attack misses ${target.name}${isFumble ? ' (fumble!)' : ''}.`,
                }));
            }
        }
        // For other readied actions (CAST_SPELL, etc.) — log that it triggers but don't resolve
        // Full resolution would require re-entering spell flow which is complex
        else {
            logs.push(this.createLogEntry("ACTION", {
                actorId: entity.id,
                description: `${entity.name}'s readied ${readiedAction} triggers! (auto-resolved as narrative)`,
            }));
        }

        // Remove the readied condition (it's been consumed)
        entity.conditions = entity.conditions.filter(c => c !== readiedCondition);
    }

    return logs;
}
```

**Step 2 — Call `checkReadiedActions()` in `startTurn()`:**

**Location:** `startTurn()`, line ~742, just before the return statement. Add:
```typescript
// Check if any readied actions trigger for this entity's turn
logs.push(...this.checkReadiedActions(entityId));
```

**Step 3 — NOTE:** The method `applyDamageToEntity` may not exist as a separate extracted method. Check if damage application is inline or a method. If damage is applied inline (e.g., in `processAttack`), extract the damage application logic into a reusable private method `applyDamageToEntity(targetId, amount, damageType, sourceId)` that handles resistance/immunity/vulnerability/tempHp/unconscious/death. Look at the existing damage application in `processAttack` (~line 1419+) to see what to extract.

**Alternative simpler approach if extraction is too complex:** Just do `target.hp = Math.max(0, target.hp - finalDamage)` and check for unconscious/death inline. This is less correct (ignores resistance/immunity) but much simpler for V1 of readied actions.

#### 2b. OPPORTUNITY_ATTACK — Gate behind spatial model

**File:** `server/combat/combat-engine-v2.ts`

**Current state:** `OPPORTUNITY_ATTACK` is in the `ActionTypeSchema` (combat-types.ts:352) and has a payload schema (combat-types.ts:505-512), but `submitAction` switch has no case — it falls to default error.

**Action:** Leave it as-is for now. It will be implemented in A5 when movement/engagement tracking exists. The action is NOT returned by `getLegalActions()` so players never see it. No change needed.

**Verify:** Confirm OPPORTUNITY_ATTACK is never returned by `getLegalActions()`. Check combat-engine-v2.ts:527-697 — there should be no block that pushes OPPORTUNITY_ATTACK to the actions array.

#### 2c. DASH — Add spatial effect (depends on A5)

After A5 is implemented, update `processDash()` (combat-engine-v2.ts:1065-1090):

```typescript
// After the existing log push, add:
// Mark entity as having dashed — spatial model will allow 2x range band shifts this turn
if (!entity.conditions.includes("dashing")) {
    entity.conditions.push("dashing");
}
```

Then in the spatial model's `moveEntity()` method (A5), check for `"dashing"` condition to allow double movement.

Clear `"dashing"` in `startTurn()` alongside `"dodging"` and `"disengaging"` (line 715-716).

#### 2d. DISENGAGE — Already partially implemented

`processDisengage()` (line 1096-1122) already adds `"disengaging"` to conditions. This is cleared at turn start (line 716). The spatial model (A5) should check this condition before triggering opportunity attacks during movement.

**No code change needed now.** The spatial model in A5 must respect `"disengaging"`.

---

## A3. Add Tests for the Gaps

### File: `server/combat/__tests__/combat-engine-v2.test.ts`

All tests go in the existing test file, in new `describe` blocks. Follow the existing patterns:

- Use `createCombatEngine(sessionId, {}, mockRollFn)` for deterministic dice
- Use `createPlayerEntity()` and `createEnemyEntity()` from combat-types.ts
- Use `engine.initiateCombat([entities])` to skip initiative phase

### 3a. Spell Save End-to-End (Player Targeted by Enemy Spell)

```typescript
describe("Spell save end-to-end (A1)", () => {
    it("should enter AWAIT_SAVE_ROLL when enemy casts save spell on player", () => {
        // Create enemy with a save spell (e.g., Hold Person WIS save)
        const enemy = createEnemyEntity("enemy-1", "Evil Wizard", 30, 12, 5, "1d6", {
            spells: [{
                name: "Hold Person",
                level: 2,
                school: "enchantment",
                castingTime: "action",
                range: 60,
                isAreaEffect: false,
                savingThrow: "WIS",
                halfOnSave: false,
                requiresConcentration: true,
                conditions: ["paralyzed"],
                description: "Target must make WIS save or be paralyzed",
            }],
            spellSlots: { "2": 3 },
            spellSaveDC: 14,
            abilityScores: { str: 8, dex: 14, con: 12, int: 18, wis: 14, cha: 10 },
        });
        const player = createPlayerEntity("player-1", "Fighter", 40, 40, 16, 15, {
            abilityScores: { str: 16, dex: 12, con: 14, int: 10, wis: 8, cha: 10 },
        });

        const engine = createCombatEngine(1);
        engine.initiateCombat([enemy, player]); // enemy goes first (higher init)

        // Enemy casts Hold Person on player
        const castResult = engine.submitAction({
            type: "CAST_SPELL",
            casterId: "enemy-1",
            spellName: "Hold Person",
            targetIds: ["player-1"],
        });

        expect(castResult.success).toBe(true);
        const state = engine.getState();
        expect(state.phase).toBe("AWAIT_SAVE_ROLL");
        expect(state.pendingSpellSave).toBeTruthy();
        expect(state.pendingSpellSave!.saveStat).toBe("WIS");
        expect(state.pendingSpellSave!.spellSaveDC).toBe(14);
        expect(state.pendingSpellSave!.pendingTargetIds).toContain("player-1");
    });

    it("should resolve save roll and apply conditions on failure", () => {
        // ... same setup as above, then:
        // Player rolls WIS save: raw d20 = 3, WIS mod = -1, total = 2 < DC 14 = FAIL
        const saveResult = engine.submitSavingThrow("player-1", 3);
        expect(saveResult.success).toBe(true);

        const state = engine.getState();
        expect(state.phase).toBe("ACTIVE"); // returned to active
        const player = state.entities.find(e => e.id === "player-1")!;
        expect(player.activeConditions.some(c => c.name === "paralyzed")).toBe(true);
    });

    it("should not apply conditions on successful save", () => {
        // Player rolls WIS save: raw d20 = 18, WIS mod = -1, total = 17 >= DC 14 = PASS
        const saveResult = engine.submitSavingThrow("player-1", 18);
        expect(saveResult.success).toBe(true);

        const state = engine.getState();
        const player = state.entities.find(e => e.id === "player-1")!;
        expect(player.activeConditions.some(c => c.name === "paralyzed")).toBe(false);
    });

    it("should halve damage on successful save for halfOnSave spells", () => {
        // Use Fireball (DEX save, halfOnSave: true)
        // Setup enemy with Fireball, mock damage roll to fixed value
        // Player succeeds DEX save → damage halved
    });
});
```

### 3b. Ready Action: Set Trigger, Trigger Fires

```typescript
describe("Ready action trigger resolution (A2)", () => {
    it("should fire readied attack when target's turn starts", () => {
        // Setup: Player readies attack against goblin
        // Player's turn: submit READY action with target goblin-1
        // Advance turns until goblin-1's turn starts
        // Verify: readied attack fires, damage applied, readied condition removed
    });

    it("should remove readied condition at start of readying entity's next turn if not triggered", () => {
        // Setup: Player readies action
        // Advance through full round (no trigger)
        // Verify: readied condition cleared at player's next turn (line 719)
    });

    it("should not fire readied attack if readying entity is unconscious", () => {
        // Setup: Player readies, then gets knocked to 0 HP
        // Target's turn starts
        // Verify: no readied attack fires
    });
});
```

### 3c. Spatial Model Tests (after A5)

```typescript
describe("Engagement tracking (A5)", () => {
    it("should track melee engagement when attack is made", () => {});
    it("should update range bands on movement", () => {});
    it("should default to MELEE for all entities at combat start", () => {});
    it("should prevent melee attack against FAR target", () => {});
    it("should allow ranged attack against FAR target", () => {});
});

describe("Movement-triggered opportunity attacks (A5)", () => {
    it("should trigger OA when entity leaves melee without Disengage", () => {});
    it("should NOT trigger OA when entity has Disengage condition", () => {});
    it("should consume reaction of attacking entity", () => {});
    it("should not trigger OA if attacker already used reaction", () => {});
});
```

### 3d. Skill Check Tests (after A4)

```typescript
describe("Out-of-combat skill checks (A4)", () => {
    it("should resolve d20 + ability mod + proficiency vs DC", () => {});
    it("should handle advantage (roll 2d20, keep highest)", () => {});
    it("should handle disadvantage (roll 2d20, keep lowest)", () => {});
    it("should return success/failure with margin", () => {});
});
```

### 3e. Rest Mechanics Tests (after A6)

```typescript
describe("Rest mechanics (A6)", () => {
    it("short rest: should restore HP from hit dice", () => {});
    it("short rest: should not exceed maxHp", () => {});
    it("long rest: should restore full HP", () => {});
    it("long rest: should recover all spell slots", () => {});
    it("long rest: should clear exhaustion (if tracked)", () => {});
    it("should not allow rest during combat", () => {});
});
```

---

## A4. Out-of-Combat Skill Checks

### Design

A lightweight skill check resolver that lives OUTSIDE the combat engine. It's used by the chat flow when the DM calls for a check. Not a full framework — just "roll d20 + modifier vs DC."

### New File: `server/skill-check.ts`

```typescript
import { z } from 'zod';

export const AbilitySchema = z.enum(['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA']);
export type Ability = z.infer<typeof AbilitySchema>;

export const SkillSchema = z.enum([
    'acrobatics', 'animal_handling', 'arcana', 'athletics', 'deception',
    'history', 'insight', 'intimidation', 'investigation', 'medicine',
    'nature', 'perception', 'performance', 'persuasion', 'religion',
    'sleight_of_hand', 'stealth', 'survival',
]);
export type Skill = z.infer<typeof SkillSchema>;

// Maps each skill to its governing ability
export const SKILL_ABILITY_MAP: Record<Skill, Ability> = {
    acrobatics: 'DEX', animal_handling: 'WIS', arcana: 'INT', athletics: 'STR',
    deception: 'CHA', history: 'INT', insight: 'WIS', intimidation: 'CHA',
    investigation: 'INT', medicine: 'WIS', nature: 'INT', perception: 'WIS',
    performance: 'CHA', persuasion: 'CHA', religion: 'INT', sleight_of_hand: 'DEX',
    stealth: 'DEX', survival: 'WIS',
};

export const SkillCheckInputSchema = z.object({
    ability: AbilitySchema,
    skill: SkillSchema.optional(),        // If provided, checks proficiency
    dc: z.number().int().min(1).max(30),
    advantage: z.boolean().default(false),
    disadvantage: z.boolean().default(false),
    // Character data
    abilityScores: z.object({
        str: z.number(), dex: z.number(), con: z.number(),
        int: z.number(), wis: z.number(), cha: z.number(),
    }),
    proficiencyBonus: z.number().default(2),
    proficientSkills: z.array(SkillSchema).default([]),
});

export type SkillCheckInput = z.infer<typeof SkillCheckInputSchema>;

export type SkillCheckResult = {
    success: boolean;
    total: number;
    rawRolls: number[];        // 1 roll normally, 2 for adv/disadv
    keptRoll: number;          // The d20 value used
    modifier: number;          // Total modifier applied
    dc: number;
    margin: number;            // total - dc (positive = pass by N, negative = fail by N)
    isNat20: boolean;
    isNat1: boolean;
    breakdown: string;         // e.g., "d20(15) + DEX(3) + proficiency(2) = 20 vs DC 15"
};

/**
 * Resolve a skill check deterministically.
 * @param input - Check parameters
 * @param rollFn - Injectable dice roller (for testing). Defaults to Math.random.
 */
export function resolveSkillCheck(
    input: SkillCheckInput,
    rollFn?: () => number  // Returns 1-20
): SkillCheckResult {
    const roll = rollFn ?? (() => Math.floor(Math.random() * 20) + 1);

    // Roll d20(s)
    const roll1 = roll();
    const roll2 = (input.advantage || input.disadvantage) ? roll() : roll1;
    const rawRolls = (input.advantage || input.disadvantage) ? [roll1, roll2] : [roll1];

    let keptRoll: number;
    if (input.advantage && !input.disadvantage) {
        keptRoll = Math.max(roll1, roll2);
    } else if (input.disadvantage && !input.advantage) {
        keptRoll = Math.min(roll1, roll2);
    } else {
        keptRoll = roll1; // Normal, or adv+disadv cancel out
    }

    // Calculate modifier
    const abilityKey = input.ability.toLowerCase() as keyof typeof input.abilityScores;
    const abilityScore = input.abilityScores[abilityKey];
    const abilityMod = Math.floor((abilityScore - 10) / 2);

    const isProficient = input.skill
        ? input.proficientSkills.includes(input.skill)
        : false;
    const profBonus = isProficient ? input.proficiencyBonus : 0;

    const modifier = abilityMod + profBonus;
    const total = keptRoll + modifier;
    const margin = total - input.dc;

    // Build breakdown
    const parts: string[] = [`d20(${keptRoll})`];
    parts.push(`${input.ability}(${abilityMod >= 0 ? '+' : ''}${abilityMod})`);
    if (profBonus > 0) parts.push(`proficiency(+${profBonus})`);
    const breakdown = `${parts.join(' + ')} = ${total} vs DC ${input.dc}`;

    return {
        success: total >= input.dc,
        total,
        rawRolls,
        keptRoll,
        modifier,
        dc: input.dc,
        margin,
        isNat20: keptRoll === 20,
        isNat1: keptRoll === 1,
        breakdown,
    };
}
```

### Wire into Chat Flow

#### 4a. Add `skillCheck` tRPC endpoint

**File:** `server/routers.ts`

Add a new router alongside combatV2 (or inside a new `mechanics` sub-router):

```typescript
skillCheck: protectedProcedure
  .input(z.object({
      sessionId: z.number(),
      characterId: z.number(),
      ability: AbilitySchema,
      skill: SkillSchema.optional(),
      dc: z.number().int().min(1).max(30),
      advantage: z.boolean().default(false),
      disadvantage: z.boolean().default(false),
  }))
  .mutation(async ({ ctx, input }) => {
      const db = await import('./db');
      const { resolveSkillCheck } = await import('./skill-check');

      const character = await db.getCharacter(input.characterId);
      if (!character) throw new Error('Character not found');

      const stats = JSON.parse(character.stats);

      const result = resolveSkillCheck({
          ability: input.ability,
          skill: input.skill,
          dc: input.dc,
          advantage: input.advantage,
          disadvantage: input.disadvantage,
          abilityScores: {
              str: stats.str ?? 10,
              dex: stats.dex ?? 10,
              con: stats.con ?? 10,
              int: stats.int ?? 10,
              wis: stats.wis ?? 10,
              cha: stats.cha ?? 10,
          },
          proficiencyBonus: Math.floor((character.level - 1) / 4) + 2,
          proficientSkills: stats.proficientSkills ?? [],
      });

      // Save messages
      await db.saveMessage({
          sessionId: input.sessionId,
          characterName: character.name,
          content: `🎲 ${result.breakdown}`,
          isDm: 0,
      });
      await db.saveMessage({
          sessionId: input.sessionId,
          characterName: 'DM',
          content: result.success
              ? `**${character.name} succeeds!** (${result.total} vs DC ${input.dc})`
              : `**${character.name} fails.** (${result.total} vs DC ${input.dc})`,
          isDm: 1,
      });

      return result;
  }),
```

#### 4b. LLM-triggered skill checks (chat flow integration)

The DM (LLM) should be able to call for skill checks naturally. This requires:

1. **Add a structured output field** to the DM's response schema. In `server/response-parser.ts` (or wherever structured response parsing happens), add:

```typescript
// In the structured response schema:
skillCheck?: {
    ability: 'STR' | 'DEX' | 'CON' | 'INT' | 'WIS' | 'CHA';
    skill?: string;    // e.g., "perception", "stealth"
    dc: number;
    advantage?: boolean;
    disadvantage?: boolean;
    reason: string;    // "to notice the hidden trap"
}
```

2. **In `message-send.ts`**, after parsing the LLM response, check for `skillCheck` in the structured output. If present, resolve it and append the result to the DM's narrative.

3. **In the system prompt** (`server/prompts.ts`), add instruction telling the DM it can call for skill checks using the structured format.

**Note:** This is the more complex part. For MVP, just having the tRPC endpoint that the UI can call is sufficient. The LLM integration can be a follow-up.

#### 4c. Character Schema — Add proficiencies

**File:** `drizzle/schema.ts`, `characters` table (~line 43-63).

The `stats` JSON column already stores `{str, dex, con, int, wis, cha}`. Extend it to also include `proficientSkills: string[]` in the JSON. Since this is a JSON text column, no migration needed — just ensure the code parses it with a default of `[]`.

**File:** Character creation UI and API must support selecting proficient skills. This is a UI task. For MVP, just ensure the backend handles missing `proficientSkills` gracefully with a `[]` default.

### Tests

**File:** `server/__tests__/skill-check.test.ts` (new file)

```typescript
import { resolveSkillCheck } from '../skill-check';

describe('Skill Check Resolver', () => {
    const baseScores = { str: 16, dex: 14, con: 12, int: 10, wis: 8, cha: 13 };

    it('should resolve basic ability check', () => {
        const result = resolveSkillCheck({
            ability: 'STR',
            dc: 15,
            abilityScores: baseScores,
            proficiencyBonus: 2,
            proficientSkills: [],
        }, () => 12); // fixed roll

        expect(result.total).toBe(15); // 12 + STR mod(+3) = 15
        expect(result.success).toBe(true);
        expect(result.margin).toBe(0);
    });

    it('should add proficiency bonus for proficient skill', () => {
        const result = resolveSkillCheck({
            ability: 'DEX',
            skill: 'stealth',
            dc: 15,
            abilityScores: baseScores,
            proficiencyBonus: 3,
            proficientSkills: ['stealth'],
        }, () => 10);

        expect(result.total).toBe(15); // 10 + DEX(+2) + prof(+3) = 15
        expect(result.success).toBe(true);
    });

    it('should handle advantage', () => {
        let callCount = 0;
        const result = resolveSkillCheck({
            ability: 'WIS',
            dc: 10,
            advantage: true,
            abilityScores: baseScores,
            proficiencyBonus: 2,
            proficientSkills: [],
        }, () => { callCount++; return callCount === 1 ? 5 : 15; });

        expect(result.keptRoll).toBe(15); // keeps higher
        expect(result.rawRolls).toEqual([5, 15]);
    });

    it('should handle disadvantage', () => {
        let callCount = 0;
        const result = resolveSkillCheck({
            ability: 'WIS',
            dc: 10,
            disadvantage: true,
            abilityScores: baseScores,
            proficiencyBonus: 2,
            proficientSkills: [],
        }, () => { callCount++; return callCount === 1 ? 5 : 15; });

        expect(result.keptRoll).toBe(5); // keeps lower
    });

    it('advantage and disadvantage cancel out', () => {
        const result = resolveSkillCheck({
            ability: 'STR',
            dc: 10,
            advantage: true,
            disadvantage: true,
            abilityScores: baseScores,
            proficiencyBonus: 2,
            proficientSkills: [],
        }, () => 10);

        expect(result.rawRolls).toEqual([10]); // single roll
    });
});
```

---

## A5. Hybrid Spatial Model (Theater-of-Mind)

### Design

Tier 1 only:
- **Engagement:** who is in melee with whom (bidirectional)
- **Range bands:** MELEE (5ft) / NEAR (30ft) / FAR (60ft+)
- Track per-entity via existing `CombatEntity.rangeTo` field (already defined in types!)
- Update on movement actions (MOVE, DASH)
- Default: all entities start at MELEE range from all other entities (theater-of-mind assumes close quarters)

### Existing Infrastructure

- `RangeBand` enum already exists (combat-types.ts:28-32): MELEE=5, NEAR=30, FAR=60
- `CombatEntity.rangeTo` already exists (combat-types.ts:224): `Record<string, RangeBand>`
- `CombatEntity.isRanged` and `preferredRange` exist for AI context
- `AttackContextSchema` has `range` field (combat-types.ts:137-145)
- `TurnResources.movementUsed` already tracks movement usage

### Changes

#### 5a. Initialize `rangeTo` at combat start

**File:** `server/combat/combat-engine-v2.ts`

In `initiateCombat()` or `prepareCombat()` — wherever entities are first added — initialize `rangeTo` for every entity pair.

**Location:** In `prepareCombat()` (~line 226) or `initiateCombat()`, after entities are added to `state.entities`:

```typescript
// Initialize spatial relationships — all entities start in melee range (theater-of-mind)
for (const entity of this.state.entities) {
    if (!entity.rangeTo) entity.rangeTo = {};
    for (const other of this.state.entities) {
        if (other.id === entity.id) continue;
        entity.rangeTo[other.id] = RangeBand.MELEE;
    }
}
```

#### 5b. Add MOVE action type

**File:** `server/combat/combat-types.ts`

Add to `ActionTypeSchema` (line 352-368):
```typescript
// Add MOVE to the enum
z.enum([..., 'MOVE', ...])
```

Add a `MovePayloadSchema`:
```typescript
export const MovePayloadSchema = z.object({
    type: z.literal('MOVE'),
    entityId: z.string(),
    targetEntityId: z.string(),        // Move toward this entity
    direction: z.enum(['toward', 'away']),
    resourceCost: ResourceCostSchema.optional(),
});
```

Add to `ActionPayloadSchema` discriminated union (line 572-585).

Add to `ACTION_DEFAULT_COST` (line 375): `MOVE: "movement"`.

#### 5c. Implement `processMove()` in engine

**File:** `server/combat/combat-engine-v2.ts`

```typescript
private processMove(payload: MovePayload): ActionResult {
    const entity = this.getEntity(payload.entityId);
    if (!entity) return this.actionError("Entity not found");

    const target = this.getEntity(payload.targetEntityId);
    if (!target) return this.actionError("Target entity not found");

    const cost = payload.resourceCost ?? ACTION_DEFAULT_COST.MOVE;
    if (!this.consumeResource(cost)) return this.actionError("No movement remaining this turn");

    const currentRange = entity.rangeTo?.[payload.targetEntityId] ?? RangeBand.MELEE;
    let newRange: RangeBand;

    if (payload.direction === 'toward') {
        // Move one band closer
        if (currentRange === RangeBand.FAR) newRange = RangeBand.NEAR;
        else if (currentRange === RangeBand.NEAR) newRange = RangeBand.MELEE;
        else newRange = RangeBand.MELEE; // Already in melee
    } else {
        // Move one band away
        if (currentRange === RangeBand.MELEE) newRange = RangeBand.NEAR;
        else if (currentRange === RangeBand.NEAR) newRange = RangeBand.FAR;
        else newRange = RangeBand.FAR; // Already far
    }

    // Check for opportunity attack when leaving melee
    const oaLogs: CombatLogEntry[] = [];
    if (payload.direction === 'away' && currentRange === RangeBand.MELEE) {
        if (!entity.conditions.includes('disengaging')) {
            // Trigger opportunity attacks from all melee enemies
            oaLogs.push(...this.triggerOpportunityAttacks(entity, payload.targetEntityId));
        }
    }

    // Update ranges (bidirectional)
    if (!entity.rangeTo) entity.rangeTo = {};
    if (!target.rangeTo) target.rangeTo = {};
    entity.rangeTo[payload.targetEntityId] = newRange;
    target.rangeTo[payload.entityId] = newRange;

    // Also update ranges relative to other entities (simplified: moving toward X moves you
    // away from entities on the "other side", but in theater-of-mind we keep it simple —
    // only the specified target relationship changes)

    const rangeName = newRange === RangeBand.MELEE ? 'melee range' : newRange === RangeBand.NEAR ? 'close range (30ft)' : 'far range (60ft+)';
    const logs: CombatLogEntry[] = [];
    logs.push(this.createLogEntry("MOVEMENT", {
        actorId: entity.id,
        targetId: payload.targetEntityId,
        description: `${entity.name} moves ${payload.direction} ${target.name} (now at ${rangeName}).`,
    }));

    // Dashing allows a second movement this turn
    if (entity.conditions.includes('dashing') && this.state.turnResources) {
        this.state.turnResources.movementUsed = false; // Reset for second move
        entity.conditions = entity.conditions.filter(c => c !== 'dashing');
    }

    const turnLogs = this.autoEndTurnIfExhausted(entity);
    return { success: true, logs: [...oaLogs, ...logs, ...turnLogs], newState: this.getState() };
}
```

#### 5d. Implement `triggerOpportunityAttacks()`

```typescript
/**
 * Trigger opportunity attacks when an entity leaves melee range.
 * Each eligible enemy gets one OA using their reaction.
 */
private triggerOpportunityAttacks(movingEntity: CombatEntity, primaryTargetId: string): CombatLogEntry[] {
    const logs: CombatLogEntry[] = [];

    for (const entity of this.state.entities) {
        // Skip self, dead entities, allies
        if (entity.id === movingEntity.id) continue;
        if (entity.status !== 'ALIVE') continue;
        if (entity.type === movingEntity.type) continue; // Same faction

        // Must be in melee range
        const range = entity.rangeTo?.[movingEntity.id];
        if (range !== RangeBand.MELEE) continue;

        // Must have reaction available
        // For non-current-turn entities, we track reactions via a simple flag
        // Check if entity already used reaction this round
        if (entity.conditions.includes('reaction_used')) continue;

        // Make opportunity attack
        const attackRoll = this.rollFn("1d20");
        const rawD20 = attackRoll.total;
        const total = rawD20 + entity.attackModifier;
        const isCritical = rawD20 === 20;
        const isFumble = rawD20 === 1;

        const targetAC = movingEntity.baseAC;
        const hit = isCritical || (!isFumble && total >= targetAC);

        entity.conditions.push('reaction_used');

        if (hit) {
            const damage = this.rollFn(entity.damageFormula);
            const finalDamage = isCritical ? damage.total * 2 : damage.total;
            logs.push(...this.applyDamageToEntity(movingEntity.id, finalDamage, entity.damageType, entity.id));
            logs.push(this.createLogEntry("ATTACK_ROLL", {
                actorId: entity.id,
                targetId: movingEntity.id,
                roll: { formula: "1d20", result: total, isCritical, isFumble },
                success: true,
                amount: finalDamage,
                description: `${entity.name} strikes ${movingEntity.name} with an opportunity attack for ${finalDamage} damage!`,
            }));
        } else {
            logs.push(this.createLogEntry("ATTACK_ROLL", {
                actorId: entity.id,
                targetId: movingEntity.id,
                roll: { formula: "1d20", result: total, isCritical, isFumble },
                success: false,
                description: `${entity.name}'s opportunity attack against ${movingEntity.name} misses!`,
            }));
        }
    }

    return logs;
}
```

**Note on `reaction_used` condition:** Clear this at the start of each entity's turn in `startTurn()`:
```typescript
// Add to startTurn() alongside existing condition clearing (line 715):
entity.conditions = entity.conditions.filter(c => c !== 'reaction_used');
```

**Wait — cross-entity reactions:** The `reaction_used` flag needs to be cleared at the start of the entity's OWN turn, not the current turn entity. The current `startTurn()` only clears conditions for `entityId` (the entity whose turn is starting). But `reaction_used` should be cleared for that entity when its turn starts. This is correct — add `'reaction_used'` to the filter at line 715-716:

```typescript
entity.conditions = entity.conditions.filter(c =>
    c !== "dodging" && c !== "disengaging" && c !== "hidden" && c !== "reaction_used"
);
```

Wait, that only clears for the entity whose turn is starting. That's correct — in D&D 5e, your reaction refreshes at the start of your turn. So `reaction_used` should be on the entity who used their reaction, and cleared when THEIR turn starts. But `startTurn(entityId)` only modifies `entity.conditions` for `entityId`. So this is correct.

But we need `reaction_used` to be tracked per-entity, not per-turn. Currently `turnResources.reactionUsed` only tracks the current turn entity. For off-turn reactions (opportunity attacks), use the `conditions` array approach described above.

#### 5e. Add MOVE to `getLegalActions()`

**File:** `server/combat/combat-engine-v2.ts`, in `getLegalActions()` (~line 527-697).

**Add after existing action blocks, before END_TURN (line ~690):**

```typescript
// Movement action — if movement not yet used this turn
if (!this.state.turnResources?.movementUsed) {
    // For each enemy, offer "move toward" and "move away"
    for (const target of validTargets) {
        const currentRange = entity.rangeTo?.[target.id] ?? RangeBand.MELEE;
        if (currentRange !== RangeBand.MELEE) {
            actions.push({
                type: 'MOVE',
                targetId: target.id,
                targetName: target.name,
                description: `Move toward ${target.name} (currently ${currentRange === RangeBand.NEAR ? 'close' : 'far'})`,
                resourceCost: 'movement',
            });
        }
        if (currentRange !== RangeBand.FAR) {
            actions.push({
                type: 'MOVE',
                targetId: target.id,
                targetName: target.name,
                description: `Move away from ${target.name} (currently ${currentRange === RangeBand.MELEE ? 'melee' : 'close'})`,
                resourceCost: 'movement',
            });
        }
    }
    // Also offer movement toward/away from allies if relevant
    for (const ally of allies) {
        const currentRange = entity.rangeTo?.[ally.id] ?? RangeBand.MELEE;
        if (currentRange !== RangeBand.MELEE) {
            actions.push({
                type: 'MOVE',
                targetId: ally.id,
                targetName: ally.name,
                description: `Move toward ${ally.name}`,
                resourceCost: 'movement',
            });
        }
    }
}
```

**Note:** This may produce many actions. Consider limiting: only show "move toward" for enemies not in melee, "move away" for enemies in melee. Keep it short for the UI.

#### 5f. Add MOVE to `submitAction()` switch

**File:** `server/combat/combat-engine-v2.ts`, in `submitAction()` switch (~line 964-1020).

```typescript
case 'MOVE':
    return this.processMove(action as MovePayload);
```

#### 5g. Range enforcement on attacks

**File:** `server/combat/combat-engine-v2.ts`, in attack resolution.

Add range checks to `processAttack()` (~line 1419):
```typescript
// After getting attacker and target entities:
const range = attacker.rangeTo?.[targetId] ?? RangeBand.MELEE;

// Melee attack requires MELEE range
if (!isRanged && range !== RangeBand.MELEE) {
    return this.actionError(`${attacker.name} is not in melee range of ${target.name}. Move closer first.`);
}

// Ranged attack at MELEE range has disadvantage (D&D 5e rule)
if (isRanged && range === RangeBand.MELEE) {
    // Set disadvantage flag for ranged attacks in melee
    hasDisadvantage = true;
}
```

Also update `getLegalActions()` to only offer melee attacks against MELEE-range targets, and ranged attacks with disadvantage note for MELEE targets:

In the ATTACK block (~line 563-574), filter by range:
```typescript
const range = entity.rangeTo?.[target.id] ?? RangeBand.MELEE;
if (!entity.isRanged && range !== RangeBand.MELEE) continue; // Can't melee from distance
```

#### 5h. Update player action parser and enemy AI

**File:** `server/combat/player-action-parser.ts`

Add MOVE to the list of parseable actions. The LLM should be able to interpret "I move toward the goblin" or "I back away" as MOVE actions with direction toward/away.

**File:** `server/combat/enemy-ai-controller.ts`

Update enemy AI to consider movement. Ranged enemies should prefer FAR range; melee enemies should move toward targets not in melee. This is AI enhancement — keep it simple:
- If melee enemy and no targets in melee range → MOVE toward nearest target
- If ranged enemy and target in melee range → MOVE away (with disengage if smart)

#### 5i. Extract `applyDamageToEntity()` helper

This is needed by both `triggerOpportunityAttacks()` (A5d) and `checkReadiedActions()` (A2a).

**File:** `server/combat/combat-engine-v2.ts`

Extract from the existing damage application logic in `processAttack()` (look for where HP is reduced, tempHp absorbed, resistance/immunity/vulnerability applied, unconscious/death checks happen). Create:

```typescript
/**
 * Apply damage to an entity, handling resistance/immunity/vulnerability, tempHp,
 * unconscious/death, and concentration checks.
 * Returns log entries describing what happened.
 */
private applyDamageToEntity(
    targetId: string,
    rawDamage: number,
    damageType: string,
    sourceId?: string
): CombatLogEntry[] {
    // ... (extract from existing processAttack damage application)
}
```

Look at the existing code in `processAttack` after a hit is confirmed — all the damage application logic should be extracted into this method. Then `processAttack` calls this method, and so do `triggerOpportunityAttacks` and `checkReadiedActions`.

---

## A6. Basic Rest Mechanics

### Design

Short and long rests are out-of-combat actions triggered from chat. They modify character state (HP, spell slots, hit dice). Since combat engine manages in-combat state and characters table manages persistent state, rests operate on the characters table.

### New Types

**File:** `server/combat/combat-types.ts` (or a new `server/rest.ts`)

```typescript
export const RestTypeSchema = z.enum(['short', 'long']);

export const ShortRestInputSchema = z.object({
    sessionId: z.number(),
    characterId: z.number(),
    hitDiceToSpend: z.number().int().min(0).max(20).default(0),
});

export const LongRestInputSchema = z.object({
    sessionId: z.number(),
    characterId: z.number(),
});
```

### New File: `server/rest.ts`

```typescript
import { z } from 'zod';

export type RestResult = {
    type: 'short' | 'long';
    hpBefore: number;
    hpAfter: number;
    hpRecovered: number;
    spellSlotsRecovered: Record<string, number>; // { "1": 2, "2": 1 } slots recovered
    hitDiceSpent: number;
    hitDiceRemaining: number;
    summary: string; // Human-readable summary
};

/**
 * Resolve a short rest for a character.
 * - Spend hit dice to recover HP (each: 1d<hitDie> + CON mod)
 * - No spell slot recovery (Wizard's Arcane Recovery not implemented yet)
 */
export function resolveShortRest(
    character: {
        hpCurrent: number;
        hpMax: number;
        level: number;
        className: string;
        stats: { con: number };
    },
    hitDiceToSpend: number,
    hitDiceRemaining: number,
    rollFn?: (formula: string) => number // Returns total
): RestResult {
    const conMod = Math.floor((character.stats.con - 10) / 2);
    const hitDie = getHitDie(character.className);

    let hpRecovered = 0;
    const actualDiceSpent = Math.min(hitDiceToSpend, hitDiceRemaining);

    for (let i = 0; i < actualDiceSpent; i++) {
        const roll = rollFn
            ? rollFn(`1d${hitDie}`)
            : Math.floor(Math.random() * hitDie) + 1;
        hpRecovered += Math.max(1, roll + conMod); // Minimum 1 HP per die
    }

    const hpBefore = character.hpCurrent;
    const hpAfter = Math.min(character.hpMax, hpBefore + hpRecovered);

    return {
        type: 'short',
        hpBefore,
        hpAfter,
        hpRecovered: hpAfter - hpBefore,
        spellSlotsRecovered: {},
        hitDiceSpent: actualDiceSpent,
        hitDiceRemaining: hitDiceRemaining - actualDiceSpent,
        summary: actualDiceSpent > 0
            ? `${character.className} takes a short rest, spending ${actualDiceSpent} hit ${actualDiceSpent === 1 ? 'die' : 'dice'} to recover ${hpAfter - hpBefore} HP (${hpBefore} → ${hpAfter}).`
            : `${character.className} takes a short rest but spends no hit dice.`,
    };
}

/**
 * Resolve a long rest for a character.
 * - Recover all HP
 * - Recover all spell slots
 * - Recover half level (rounded up, min 1) hit dice
 */
export function resolveLongRest(
    character: {
        hpCurrent: number;
        hpMax: number;
        level: number;
        className: string;
    },
    currentSpellSlots: Record<string, number>,
    maxSpellSlots: Record<string, number>,
    hitDiceRemaining: number,
): RestResult {
    const hpBefore = character.hpCurrent;
    const hpAfter = character.hpMax;

    // Recover spell slots
    const slotsRecovered: Record<string, number> = {};
    for (const [level, max] of Object.entries(maxSpellSlots)) {
        const current = currentSpellSlots[level] ?? 0;
        if (current < max) {
            slotsRecovered[level] = max - current;
        }
    }

    // Recover hit dice: half level rounded up, minimum 1
    const hitDiceRecovered = Math.max(1, Math.ceil(character.level / 2));
    const newHitDice = Math.min(character.level, hitDiceRemaining + hitDiceRecovered);

    return {
        type: 'long',
        hpBefore,
        hpAfter,
        hpRecovered: hpAfter - hpBefore,
        spellSlotsRecovered: slotsRecovered,
        hitDiceSpent: 0,
        hitDiceRemaining: newHitDice,
        summary: `Long rest complete. ${character.className} recovers to full HP (${hpAfter}), all spell slots restored, and ${hitDiceRecovered} hit dice recovered.`,
    };
}

/** Map class name to hit die size */
function getHitDie(className: string): number {
    const map: Record<string, number> = {
        barbarian: 12,
        fighter: 10, paladin: 10, ranger: 10,
        bard: 8, cleric: 8, druid: 8, monk: 8, rogue: 8, warlock: 8,
        sorcerer: 6, wizard: 6,
    };
    return map[className.toLowerCase()] ?? 8;
}
```

### Character Schema Extension

The character `stats` JSON needs two new optional fields:
- `hitDiceRemaining: number` (defaults to level)
- `maxSpellSlots: Record<string, number>` (for spell slot recovery tracking)
- `currentSpellSlots: Record<string, number>` (current available slots)

Since `stats` is a free-form JSON text column, no migration needed. Just parse with defaults.

### tRPC Endpoints

**File:** `server/routers.ts`

```typescript
shortRest: protectedProcedure
  .input(z.object({
      sessionId: z.number(),
      characterId: z.number(),
      hitDiceToSpend: z.number().int().min(0).default(0),
  }))
  .mutation(async ({ input }) => {
      // Verify not in combat
      const { CombatEngineManager } = await import('./combat/combat-engine-manager');
      const engine = CombatEngineManager.get(input.sessionId);
      if (engine && engine.getState().phase !== 'IDLE' && engine.getState().phase !== 'RESOLVED') {
          throw new Error('Cannot rest during combat');
      }

      const db = await import('./db');
      const character = await db.getCharacter(input.characterId);
      if (!character) throw new Error('Character not found');

      const stats = JSON.parse(character.stats);
      const { resolveShortRest } = await import('./rest');

      const result = resolveShortRest(
          {
              hpCurrent: character.hpCurrent,
              hpMax: character.hpMax,
              level: character.level,
              className: character.className,
              stats: { con: stats.con ?? 10 },
          },
          input.hitDiceToSpend,
          stats.hitDiceRemaining ?? character.level,
      );

      // Update character
      await db.updateCharacterHP(input.characterId, result.hpAfter);
      // Update stats JSON with new hitDiceRemaining
      stats.hitDiceRemaining = result.hitDiceRemaining;
      await db.updateCharacterStats(input.characterId, JSON.stringify(stats));

      // Save message
      await db.saveMessage({
          sessionId: input.sessionId,
          characterName: 'DM',
          content: result.summary,
          isDm: 1,
      });

      return result;
  }),

longRest: protectedProcedure
  .input(z.object({
      sessionId: z.number(),
      characterId: z.number(),
  }))
  .mutation(async ({ input }) => {
      // Verify not in combat
      const { CombatEngineManager } = await import('./combat/combat-engine-manager');
      const engine = CombatEngineManager.get(input.sessionId);
      if (engine && engine.getState().phase !== 'IDLE' && engine.getState().phase !== 'RESOLVED') {
          throw new Error('Cannot rest during combat');
      }

      const db = await import('./db');
      const character = await db.getCharacter(input.characterId);
      if (!character) throw new Error('Character not found');

      const stats = JSON.parse(character.stats);
      const { resolveLongRest } = await import('./rest');

      const result = resolveLongRest(
          {
              hpCurrent: character.hpCurrent,
              hpMax: character.hpMax,
              level: character.level,
              className: character.className,
          },
          stats.currentSpellSlots ?? {},
          stats.maxSpellSlots ?? {},
          stats.hitDiceRemaining ?? character.level,
      );

      // Update character
      await db.updateCharacterHP(input.characterId, result.hpAfter);
      stats.hitDiceRemaining = result.hitDiceRemaining;
      // Restore spell slots
      if (stats.maxSpellSlots) {
          stats.currentSpellSlots = { ...stats.maxSpellSlots };
      }
      await db.updateCharacterStats(input.characterId, JSON.stringify(stats));

      // Save message
      await db.saveMessage({
          sessionId: input.sessionId,
          characterName: 'DM',
          content: result.summary,
          isDm: 1,
      });

      return result;
  }),
```

**Note:** `db.updateCharacterStats()` may not exist yet. Add it to `server/db.ts`:
```typescript
export async function updateCharacterStats(characterId: number, statsJson: string) {
    await db.update(characters).set({ stats: statsJson, updatedAt: new Date() }).where(eq(characters.id, characterId));
}
```

### Chat Flow Integration

**File:** `server/message-send.ts` or `server/response-parser.ts`

Add detection for rest-related phrases in chat. When a player says "we take a long rest" or "let's short rest", detect this and either:
1. Auto-trigger the rest endpoint, or
2. Add a structured output field from the LLM response:
```typescript
rest?: { type: 'short' | 'long' }
```

For MVP, a simple regex detection in the chat handler is fine:
```typescript
const longRestMatch = input.message.match(/\b(long rest|take a long rest|rest for the night)\b/i);
const shortRestMatch = input.message.match(/\b(short rest|take a short rest|take a breather)\b/i);
```

---

## Implementation Checklist

### A1: Wire Save Rolls (Priority: HIGH — 1-2 hours)
- [ ] 1a. Add AWAIT_SAVE_ROLL to getState pendingRoll (routers.ts)
- [ ] 1a. Add AWAIT_DEATH_SAVE to getState pendingRoll (routers.ts)
- [ ] 1b. Add 'save' to submitRoll rollType enum (routers.ts)
- [ ] 1c. Add phase mapping for save (routers.ts)
- [ ] 1d. Add d20 validation for save (routers.ts)
- [ ] 1e. Add rollingEntityName for save (routers.ts)
- [ ] 1f. Add save roll dispatch (routers.ts)
- [ ] 1f. Update rollLabel and activePlayerId for save
- [ ] 1g. Add 'save' | 'deathSave' to DiceRoller PendingRoll type (DiceRoller.tsx)
- [ ] 1h. Add AWAIT_SAVE_ROLL handler to message-send.ts
- [ ] 1i. Verify submitSavingThrow is public

### A5: Spatial Model (Priority: HIGH — 3-4 hours)
- [ ] 5a. Initialize rangeTo at combat start
- [ ] 5b. Add MOVE action type + payload to combat-types.ts
- [ ] 5c. Implement processMove() in engine
- [ ] 5d. Implement triggerOpportunityAttacks()
- [ ] 5e. Add MOVE to getLegalActions()
- [ ] 5f. Add MOVE to submitAction() switch
- [ ] 5g. Range enforcement on attacks
- [ ] 5h. Update parser and enemy AI for MOVE
- [ ] 5i. Extract applyDamageToEntity() helper

### A2: Gate Placeholders (Priority: MEDIUM — 1-2 hours)
- [ ] 2a. Implement readied action trigger resolution
- [ ] 2b. Verify OPPORTUNITY_ATTACK is gated (no change needed)
- [ ] 2c. Add "dashing" condition to DASH for spatial model
- [ ] 2d. Verify DISENGAGE already works (no change needed)

### A4: Skill Checks (Priority: MEDIUM — 2-3 hours)
- [ ] Create server/skill-check.ts
- [ ] Add skillCheck tRPC endpoint
- [ ] Add proficientSkills to character stats JSON
- [ ] Create server/__tests__/skill-check.test.ts

### A6: Rest Mechanics (Priority: MEDIUM — 2-3 hours)
- [ ] Create server/rest.ts
- [ ] Add shortRest and longRest tRPC endpoints
- [ ] Add updateCharacterStats to db.ts
- [ ] Add chat detection for rest commands
- [ ] Create server/__tests__/rest.test.ts

### A3: Tests (Priority: HIGH — 2-3 hours, done after above)
- [ ] Spell save end-to-end tests
- [ ] Ready action trigger tests
- [ ] Spatial model / engagement tests
- [ ] Opportunity attack tests
- [ ] Skill check tests
- [ ] Rest mechanic tests

---

## Files Modified (Summary)

| File | Changes |
|------|---------|
| `server/routers.ts` | Save roll in getState, submitRoll, death save in getState; skillCheck, shortRest, longRest endpoints |
| `server/combat/combat-engine-v2.ts` | checkReadiedActions(), processMove(), triggerOpportunityAttacks(), applyDamageToEntity(), startTurn() changes, rangeTo initialization, range enforcement, getLegalActions() MOVE |
| `server/combat/combat-types.ts` | MOVE action type, MovePayloadSchema, add to union |
| `client/src/components/combat/DiceRoller.tsx` | Add 'save' \| 'deathSave' to PendingRoll type |
| `server/message-send.ts` | AWAIT_SAVE_ROLL handler, rest detection |
| `server/combat/player-action-parser.ts` | Add MOVE to parseable actions |
| `server/combat/enemy-ai-controller.ts` | Movement in AI decision-making |
| `server/skill-check.ts` | **NEW** — Skill check resolver |
| `server/rest.ts` | **NEW** — Rest mechanics resolver |
| `server/db.ts` | Add updateCharacterStats() |
| `server/combat/__tests__/combat-engine-v2.test.ts` | New test blocks for A1-A6 |
| `server/__tests__/skill-check.test.ts` | **NEW** — Skill check tests |
| `server/__tests__/rest.test.ts` | **NEW** — Rest mechanic tests |
