# Phase 5.1: Visual Dice Roller — Implementation Prompt

> **For**: A coding agent. Follow every step in order. Do NOT skip steps. Do NOT refactor unrelated code. Do NOT add features not described here.

---

## GOAL

Build a visual animated dice roller component that appears inside the combat sidebar when the combat engine is waiting for a player roll. When the player clicks "Roll", dice animate and the result is **automatically submitted** to the combat engine via a new tRPC endpoint. The player never needs to type their roll in chat.

The dice roller activates in three scenarios:
1. **Initiative** — phase `AWAIT_INITIATIVE`: player rolls d20 for initiative
2. **Attack** — phase `AWAIT_ATTACK_ROLL` (NEW phase): player rolls d20+modifier to hit
3. **Damage** — phase `AWAIT_DAMAGE_ROLL`: player rolls damage dice after a hit

---

## ARCHITECTURE OVERVIEW

```
┌─────────────────────────────────────────────────────────┐
│  CombatSidebar.tsx                                      │
│  ┌───────────────────────────────────────────────────┐  │
│  │  DiceRoller.tsx  (NEW)                            │  │
│  │  - Reads combatState.phase                        │  │
│  │  - Shows when phase is AWAIT_*                    │  │
│  │  - Animates dice on click                         │  │
│  │  - Calls tRPC combatV2.submitRoll on completion   │  │
│  └───────────────────────────────────────────────────┘  │
│  ... existing sidebar content ...                       │
└─────────────────────────────────────────────────────────┘
         │
         │ tRPC mutation: combatV2.submitRoll
         ▼
┌─────────────────────────────────────────────────────────┐
│  server/routers.ts — new submitRoll procedure           │
│  - Reads current phase                                  │
│  - Routes to correct engine method                      │
│  - Generates narrative from resulting logs              │
│  - Saves narrative as assistant message in chat         │
│  - Returns result to client                             │
└─────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────┐
│  combat-engine-v2.ts                                    │
│  - AWAIT_INITIATIVE → applyInitiative()                 │
│  - AWAIT_ATTACK_ROLL → processAttackWithRoll() (NEW)    │
│  - AWAIT_DAMAGE_ROLL → applyDamage()                    │
└─────────────────────────────────────────────────────────┘
```

---

## FILES TO CREATE

| File | Purpose |
|------|---------|
| `client/src/components/combat/DiceRoller.tsx` | Visual dice component with animation |
| `client/src/lib/dice-utils.ts` | Client-side dice formula parser + random generator |

## FILES TO MODIFY

| File | Change |
|------|--------|
| `server/combat/combat-types.ts` | Add `AWAIT_ATTACK_ROLL` phase, add `PendingAttackRoll` type |
| `server/combat/combat-engine-v2.ts` | Add AWAIT_ATTACK_ROLL handling, new method |
| `server/routers.ts` | Add `combatV2.submitRoll` endpoint, modify attack flow |
| `client/src/components/combat/CombatSidebar.tsx` | Mount DiceRoller component |

---

## STEP 1: Client-Side Dice Utilities

**Create file:** `client/src/lib/dice-utils.ts`

This module parses dice formulas and generates random results on the client side.

```typescript
/**
 * Parse a dice formula string into its components.
 *
 * Supports formats:
 *   "1d20"      → { count: 1, sides: 20, modifier: 0 }
 *   "1d20+5"    → { count: 1, sides: 20, modifier: 5 }
 *   "2d6+3"     → { count: 2, sides: 6,  modifier: 3 }
 *   "1d8-1"     → { count: 1, sides: 8,  modifier: -1 }
 *   "2d8+3"     → (critical damage example)
 *
 * @returns null if formula cannot be parsed
 */
export interface ParsedFormula {
  count: number;    // number of dice (e.g., 2 in "2d6")
  sides: number;    // sides per die (e.g., 6 in "2d6")
  modifier: number; // flat modifier (e.g., 3 in "2d6+3")
  formula: string;  // original formula string
}

export interface DiceResult {
  rolls: number[];    // individual die results, e.g. [3, 5]
  modifier: number;   // the flat modifier
  total: number;      // sum of rolls + modifier
  formula: string;    // original formula
}
```

**Implement these functions:**

1. `parseFormula(formula: string): ParsedFormula | null` — Use regex `/^(\d+)d(\d+)([+-]\d+)?$/` to parse. Return null on failure.

2. `rollFormula(formula: string): DiceResult | null` — Parse the formula, then for each die (`count` times), generate `Math.floor(Math.random() * sides) + 1`. Sum all rolls, add modifier. Return the `DiceResult`.

3. `getFormulaRange(formula: string): { min: number; max: number } | null` — Return the minimum (count * 1 + modifier) and maximum (count * sides + modifier) possible values.

---

## STEP 2: Add AWAIT_ATTACK_ROLL Phase to Combat Types

**Modify file:** `server/combat/combat-types.ts`

### 2a. Update PhaseSchema

Find the `PhaseSchema` zod enum (around line 15-25). It currently has:
```typescript
z.enum(["IDLE", "AWAIT_INITIATIVE", "ACTIVE", "AWAIT_ROLL", "AWAIT_DAMAGE_ROLL", "RESOLVED"])
```

Add `"AWAIT_ATTACK_ROLL"` to this enum:
```typescript
z.enum(["IDLE", "AWAIT_INITIATIVE", "ACTIVE", "AWAIT_ROLL", "AWAIT_ATTACK_ROLL", "AWAIT_DAMAGE_ROLL", "RESOLVED"])
```

### 2b. Add PendingAttackRoll Type

Find the `PendingAttack` type definition (around lines 278-286). BELOW it, add a new type:

```typescript
export const PendingAttackRollSchema = z.object({
  attackerId: z.string(),
  targetId: z.string(),
  attackModifier: z.number(),
  advantage: z.boolean().default(false),
  disadvantage: z.boolean().default(false),
  weaponName: z.string().optional(),
  createdAt: z.number(),
});
export type PendingAttackRoll = z.infer<typeof PendingAttackRollSchema>;
```

### 2c. Add pendingAttackRoll to BattleState

Find the `BattleStateSchema` definition. It already has `pendingAttack` and `pendingInitiative` optional fields. Add:

```typescript
pendingAttackRoll: PendingAttackRollSchema.optional(),
```

### 2d. Update ActionResult

Find the `ActionResult` type. It has `awaitingDamageRoll?: boolean`. Add:
```typescript
awaitingAttackRoll?: boolean;
```

---

## STEP 3: Add AWAIT_ATTACK_ROLL to Combat Engine

**Modify file:** `server/combat/combat-engine-v2.ts`

### 3a. Modify `submitAction` for ATTACK type

Currently in `submitAction()` (around line 635-657), when action type is `"ATTACK"`, it calls `this.processAttack(payload)` which auto-rolls the attack if no `attackRoll` is provided.

**Change the ATTACK case** to check if the attacker is a player and no roll was provided:

```typescript
case "ATTACK": {
    const attackPayload = payload as AttackPayload;
    const attacker = this.getEntity(attackPayload.attackerId);

    // If player attack with no pre-rolled value → pause for visual dice
    if (attacker?.type === 'player' && attackPayload.attackRoll === undefined) {
        return this.enterAwaitAttackRoll(attackPayload);
    }

    return this.processAttack(attackPayload);
}
```

### 3b. Add `enterAwaitAttackRoll` method

Add this new private method in the engine class, near the `processAttack` method:

```typescript
/**
 * Pause combat to await a player's attack roll from the visual dice roller.
 * Sets phase to AWAIT_ATTACK_ROLL and stores pending attack info.
 */
private enterAwaitAttackRoll(payload: AttackPayload): ActionResult {
    const attacker = this.getEntity(payload.attackerId);
    const target = this.getEntity(payload.targetId);

    if (!attacker || !target) {
        return {
            success: false,
            logs: [],
            newState: this.getState() as BattleState,
            error: `Attacker or target not found`,
        };
    }

    this.state.phase = 'AWAIT_ATTACK_ROLL';
    this.state.pendingAttackRoll = {
        attackerId: attacker.id,
        targetId: target.id,
        attackModifier: attacker.attackModifier,
        advantage: payload.advantage || false,
        disadvantage: payload.disadvantage || false,
        weaponName: payload.weaponName,
        createdAt: Date.now(),
    };
    this.state.updatedAt = Date.now();

    const diceFormula = (payload.advantage && !payload.disadvantage) ? "2d20kh1"
        : (payload.disadvantage && !payload.advantage) ? "2d20kl1"
        : "1d20";

    activity.system(
        this.state.sessionId,
        `${attacker.name} attacks ${target.name}! Awaiting attack roll (${diceFormula}+${attacker.attackModifier})`
    );

    return {
        success: true,
        logs: [this.createLogEntry("CUSTOM", {
            actorId: attacker.id,
            targetId: target.id,
            description: `${attacker.name} attacks ${target.name}! Roll to hit...`,
        })],
        newState: this.getState() as BattleState,
        awaitingAttackRoll: true,
    };
}
```

### 3c. Add `resolveAttackRoll` method

Add this new PUBLIC method to the engine class. This is called when the visual dice roller submits an attack roll value:

```typescript
/**
 * Resolve a pending attack roll from the visual dice roller.
 * Called when phase is AWAIT_ATTACK_ROLL.
 *
 * @param attackTotal - The total attack roll (d20 result + modifier, as shown on dice)
 *                      NOTE: This is the RAW d20 value. The engine adds the modifier.
 *                      Wait - check the caller. If the dice roller rolls "1d20" and gets 14,
 *                      and modifier is +5, the caller should send 14 (raw) or 19 (total)?
 *                      Convention: Send the RAW d20 roll. The engine will add the modifier.
 *                      This matches how applyInitiative works (raw d20, engine adds modifier).
 */
resolveAttackRoll(rawD20Roll: number): ActionResult {
    if (this.state.phase !== 'AWAIT_ATTACK_ROLL' || !this.state.pendingAttackRoll) {
        return {
            success: false,
            logs: [],
            newState: this.getState() as BattleState,
            error: 'No pending attack roll',
        };
    }

    this.pushHistory();

    const pending = this.state.pendingAttackRoll;

    // Validate the d20 roll (must be 1-20)
    const validation = validateDiceRoll(rawD20Roll, "1d20");
    if (!validation.valid) {
        return {
            success: false,
            logs: [],
            newState: this.getState() as BattleState,
            error: `Invalid attack roll: ${rawD20Roll}. Must be 1-20.`,
        };
    }

    // Clear the pending state
    this.state.pendingAttackRoll = undefined;
    this.state.phase = 'ACTIVE';

    // Now process the attack with the provided roll
    // The total = raw d20 + attack modifier
    const totalAttack = rawD20Roll + pending.attackModifier;

    // Build an AttackPayload with the roll included
    const attackPayload: AttackPayload = {
        type: 'ATTACK',
        attackerId: pending.attackerId,
        targetId: pending.targetId,
        attackRoll: totalAttack,
        advantage: pending.advantage,
        disadvantage: pending.disadvantage,
        weaponName: pending.weaponName,
    };

    // Process via existing attack logic (which accepts pre-rolled values)
    return this.processAttack(attackPayload);
}
```

**IMPORTANT:** The `processAttack` method currently handles `payload.attackRoll !== undefined` by using the value as-is (it treats it as the TOTAL including modifier). So passing `totalAttack = rawD20Roll + modifier` is correct. Verify this by reading `processAttack` around line 707 where it does `totalAttack = payload.attackRoll`.

---

## STEP 4: Add `submitRoll` tRPC Endpoint

**Modify file:** `server/routers.ts`

### 4a. Add the endpoint inside the `combatV2` router

Find the `combatV2` router object (around line 1672). Add a new mutation after the existing `submitAction` procedure:

```typescript
submitRoll: publicProcedure
    .input(z.object({
        sessionId: z.number(),
        rollType: z.enum(['initiative', 'attack', 'damage']),
        rawDieValue: z.number().int().min(1),
        // For initiative: which player entity is rolling
        entityId: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
        const { sessionId, rollType, rawDieValue, entityId } = input;

        const engine = await CombatEngineManager.loadFromDb(sessionId);
        if (!engine) {
            return { success: false, error: 'No active combat' };
        }

        const state = engine.getState();
        let result;
        let narrativeContext = '';

        switch (rollType) {
            case 'initiative': {
                if (state.phase !== 'AWAIT_INITIATIVE') {
                    return { success: false, error: 'Not awaiting initiative' };
                }
                // Determine which entity is rolling
                // If entityId provided, use it. Otherwise find the first pending player.
                let targetEntityId = entityId;
                if (!targetEntityId && state.pendingInitiative) {
                    targetEntityId = state.pendingInitiative.pendingEntityIds[0];
                }
                if (!targetEntityId) {
                    return { success: false, error: 'No pending initiative rolls' };
                }

                const initResult = engine.applyInitiative(targetEntityId, rawDieValue);
                result = {
                    success: true,
                    logs: initResult.logs,
                    combatStarted: initResult.combatStarted,
                    newState: engine.getState(),
                };

                const entity = engine.getEntity(targetEntityId);
                narrativeContext = initResult.combatStarted
                    ? `Combat has begun! Turn order established.`
                    : `${entity?.name || 'Player'} rolled ${rawDieValue} for initiative.`;
                break;
            }

            case 'attack': {
                if (state.phase !== 'AWAIT_ATTACK_ROLL') {
                    return { success: false, error: 'Not awaiting attack roll' };
                }
                result = engine.resolveAttackRoll(rawDieValue);

                if (result.success && result.logs.length > 0) {
                    // Build narrative from attack result logs
                    const attackLog = result.logs.find(l => l.type === 'ATTACK_ROLL');
                    narrativeContext = attackLog?.description || 'Attack resolved.';
                }
                break;
            }

            case 'damage': {
                if (state.phase !== 'AWAIT_DAMAGE_ROLL') {
                    return { success: false, error: 'Not awaiting damage roll' };
                }
                result = engine.applyDamage(rawDieValue);

                if (result.success && result.logs.length > 0) {
                    const damageLog = result.logs.find(l => l.type === 'DAMAGE');
                    narrativeContext = damageLog?.description || 'Damage applied.';
                }
                break;
            }

            default:
                return { success: false, error: `Unknown roll type: ${rollType}` };
        }

        // Persist engine state
        await CombatEngineManager.persist(sessionId);

        // Save a system/assistant message to chat so the narrative appears
        // Use the same pattern as the existing message flow in messages.send
        if (result.success && narrativeContext) {
            // Insert an assistant message with the combat narrative
            // Find the appropriate DB insert call used elsewhere in this file.
            // Look for how messages are saved after combat actions in the messages.send handler.
            // Typically: db.insert(messages).values({ sessionId, role: 'assistant', content: narrativeContext })
            // Use the same pattern. Import `messages` table from schema if not already imported.

            // IMPORTANT: Check if the engine phase after this roll is 'RESOLVED'
            // If so, destroy the engine (same as endCombat does).
            const newState = engine.getState();
            if (newState.phase === 'RESOLVED') {
                CombatEngineManager.destroy(sessionId);
            }

            // If the new current turn entity is an enemy, trigger the AI loop
            // Copy the enemy-AI-triggering pattern from the existing submitAction handler.
            // Look for the runAILoop or similar async call pattern around lines 1830-1860.
        }

        return {
            success: result.success,
            error: result.error,
            logs: result.logs,
            newState: result.newState,
            combatStarted: (result as any).combatStarted,
        };
    }),
```

### 4b. Narrative and Enemy AI Integration

**CRITICAL:** After a successful roll submission, two things must happen:

1. **Save narrative as chat message** — Look at how the existing `messages.send` handler (around lines 434-516 for AWAIT_DAMAGE_ROLL) saves assistant messages after combat actions. Find the `db.insert(messages).values(...)` pattern and replicate it in `submitRoll`. The message should contain the combat log descriptions joined together.

2. **Trigger enemy AI if it's an enemy's turn** — After the roll resolves, check `engine.getCurrentTurnEntity()`. If the current turn entity's type is `'enemy'`, trigger the enemy AI loop. Look for how this is done in the existing `submitAction` handler (around lines 1830-1860). There should be an async function call like `runAILoop(sessionId)` or similar. Copy that pattern.

**Find these patterns by searching `routers.ts` for:**
- `db.insert(messages)` — to see how chat messages are saved
- `runAILoop` or `enemyAI` or `aiTurn` — to see how enemy turns are triggered
- The AWAIT_DAMAGE_ROLL handler in `messages.send` (lines 434-516) — this is the closest existing pattern to what submitRoll needs to do

---

## STEP 5: Update `getState` to Return Roll Context

**Modify file:** `server/routers.ts`

Find the `combatV2.getState` query (around lines 1676-1713). It currently returns phase, entities, logs, etc. Add these fields to the return object:

```typescript
// Add to the return object:
pendingRoll: (() => {
    const s = engine.getState();
    if (s.phase === 'AWAIT_INITIATIVE' && s.pendingInitiative) {
        const nextEntityId = s.pendingInitiative.pendingEntityIds[0];
        const entity = engine.getEntity(nextEntityId);
        return {
            type: 'initiative' as const,
            formula: '1d20',
            entityId: nextEntityId,
            entityName: entity?.name || 'Unknown',
            prompt: `Roll initiative for ${entity?.name || 'player'}`,
        };
    }
    if (s.phase === 'AWAIT_ATTACK_ROLL' && s.pendingAttackRoll) {
        const attacker = engine.getEntity(s.pendingAttackRoll.attackerId);
        const target = engine.getEntity(s.pendingAttackRoll.targetId);
        return {
            type: 'attack' as const,
            formula: '1d20',
            modifier: s.pendingAttackRoll.attackModifier,
            entityId: s.pendingAttackRoll.attackerId,
            entityName: attacker?.name || 'Unknown',
            targetName: target?.name || 'Unknown',
            prompt: `${attacker?.name} rolls to hit ${target?.name} (d20+${s.pendingAttackRoll.attackModifier})`,
        };
    }
    if (s.phase === 'AWAIT_DAMAGE_ROLL' && s.pendingAttack) {
        const attacker = engine.getEntity(s.pendingAttack.attackerId);
        const target = engine.getEntity(s.pendingAttack.targetId);
        return {
            type: 'damage' as const,
            formula: s.pendingAttack.damageFormula,
            entityId: s.pendingAttack.attackerId,
            entityName: attacker?.name || 'Unknown',
            targetName: target?.name || 'Unknown',
            isCritical: s.pendingAttack.isCritical,
            prompt: `${attacker?.name} rolls damage against ${target?.name} (${s.pendingAttack.damageFormula})`,
        };
    }
    return null;
})(),
```

---

## STEP 6: Create the DiceRoller Component

**Create file:** `client/src/components/combat/DiceRoller.tsx`

### Dependencies (already installed, do NOT install new packages):
- `framer-motion` — for dice animation
- `lucide-react` — for dice icons (Dices, Swords, Target)
- `sonner` — for toast notifications on error

### Component Props:

```typescript
interface DiceRollerProps {
  pendingRoll: {
    type: 'initiative' | 'attack' | 'damage';
    formula: string;           // "1d20" or "1d8+3" or "2d6+3"
    modifier?: number;         // attack modifier (only for attack rolls)
    entityName: string;        // who is rolling
    targetName?: string;       // who they're attacking
    isCritical?: boolean;      // critical hit damage?
    prompt: string;            // display text like "Roll to hit Goblin (d20+5)"
    entityId?: string;         // for initiative
  };
  sessionId: number;
  onRollComplete?: () => void; // callback after successful submission
}
```

### Component Behavior:

**States:** `idle` → `rolling` → `result` → `submitting` → `idle`

**Visual Layout (inside a Card component from shadcn/ui):**

```
┌─────────────────────────────────────┐
│  ⚔ Roll to Hit Goblin              │  ← prompt text
│                                     │
│      ┌──────┐  ┌──────┐           │  ← dice faces (animated)
│      │  14  │  │  ·   │           │     (1 for d20, 2 for 2d6, etc.)
│      └──────┘  └──────┘           │
│                                     │
│         14 + 5 = 19                │  ← breakdown (shown after roll)
│                                     │
│     [ 🎲  Roll! ]                  │  ← button (disabled during animation)
└─────────────────────────────────────┘
```

### Animation Spec (use framer-motion):

1. **Idle state:** Show the formula and a "Roll" button. Dice faces show "?" or a subtle bounce animation.

2. **Rolling state (1.2 seconds):**
   - Each die face rapidly cycles through random numbers (use `setInterval` every 80ms)
   - Apply framer-motion `animate` with:
     - `rotate: [0, 360, 720, 1080]` over 1.2s
     - `scale: [1, 1.1, 0.95, 1]`
   - The cycling numbers should feel like the dice are tumbling

3. **Result state:**
   - Numbers settle to final values
   - framer-motion `animate` with `scale: [1.3, 1]` and a quick bounce
   - Show breakdown text: e.g., "14 + 5 = 19" (for attack with modifier)
   - If critical (natural 20 on attack): flash gold/yellow, show "NAT 20!" text
   - If fumble (natural 1 on attack): flash red, show "NAT 1!" text
   - Auto-transition to submitting after 600ms pause

4. **Submitting state:**
   - Call `trpc.combatV2.submitRoll.useMutation()` with the result
   - Show a subtle loading spinner on the button
   - On success: call `onRollComplete()` and return to idle
   - On error: show error via `toast.error()` from sonner, return to idle

### Die Face Component (inline, not a separate file):

A single die face is a `64x64` rounded box:
```
- bg-stone-800 (dark background)
- border-2 border-amber-600 (gold border)
- rounded-lg
- text-2xl font-bold text-amber-100 (the number)
- flex items-center justify-center
- framer-motion motion.div for animation
```

For a d20: render 1 die face.
For 1d8+3: render 1 die face, then "+3" text.
For 2d6+3: render 2 die faces, then "+3" text.

Parse the formula using `parseFormula()` from `dice-utils.ts` to determine how many dice faces to show.

### Roll Value Generation:

Use the `rollFormula()` function from `dice-utils.ts` to generate the result. Call this ONCE when the player clicks "Roll", store it in component state, then animate toward it.

### tRPC Submission:

```typescript
const submitRoll = trpc.combatV2.submitRoll.useMutation({
    onSuccess: (data) => {
        if (data.success) {
            onRollComplete?.();
        } else {
            toast.error(data.error || 'Roll failed');
        }
    },
    onError: (err) => {
        toast.error(err.message);
    },
});
```

When submitting:
- For `initiative`: send `{ sessionId, rollType: 'initiative', rawDieValue: diceResult.rolls[0], entityId }`
- For `attack`: send `{ sessionId, rollType: 'attack', rawDieValue: diceResult.rolls[0] }`
  (The raw d20 value, NOT including modifier. The engine adds the modifier.)
- For `damage`: send `{ sessionId, rollType: 'damage', rawDieValue: diceResult.total }`
  (The TOTAL damage including modifier, since that's what `applyDamage()` expects.)

### Critical/Fumble Detection:

For attack rolls only, check `diceResult.rolls[0]`:
- If `rolls[0] === 20` → natural 20, show critical animation
- If `rolls[0] === 1` → natural 1, show fumble animation

For damage rolls, if `pendingRoll.isCritical` is true, show a "CRITICAL" badge.

---

## STEP 7: Integrate DiceRoller into CombatSidebar

**Modify file:** `client/src/components/combat/CombatSidebar.tsx`

### 7a. Import DiceRoller

```typescript
import { DiceRoller } from './DiceRoller';
```

### 7b. Add DiceRoller to the sidebar JSX

Find the sidebar's main content area. The `DiceRoller` should appear **above** the entity list but **below** the round counter header. Find where the round number is displayed and the entity list begins.

Add this conditional render between them:

```tsx
{combatState?.pendingRoll && (
    <DiceRoller
        pendingRoll={combatState.pendingRoll}
        sessionId={sessionId}
        onRollComplete={() => {
            // Refetch combat state immediately after roll
            refetch();
        }}
    />
)}
```

The `refetch` function comes from the existing `trpc.combatV2.getState.useQuery()` call. It's already destructured somewhere in the component — look for `const { data: combatState, ... } = trpc.combatV2.getState.useQuery(...)` and ensure `refetch` is extracted.

### 7c. Increase Poll Rate During AWAIT Phases

Find the `refetchInterval` option in the `useQuery` call (currently `2000`). Change it to be dynamic:

```typescript
refetchInterval: combatState?.phase?.startsWith('AWAIT_') ? 1000 : 2000,
```

This polls faster when we're waiting for a roll, so the UI updates quickly after submission.

---

## STEP 8: Handle Chat-Based Rolls (Backward Compatibility)

**Modify file:** `server/routers.ts`

The existing `messages.send` handler (the large procedure around line 384) has sections for `AWAIT_DAMAGE_ROLL` (lines 434-516) and `AWAIT_INITIATIVE` (lines 519-618). These parse roll values from chat messages.

**These must continue to work unchanged.** A player can EITHER use the visual dice roller OR type their roll in chat. Both paths lead to the same engine methods.

However, we need to add handling for the NEW `AWAIT_ATTACK_ROLL` phase in the `messages.send` handler. Find where `AWAIT_DAMAGE_ROLL` and `AWAIT_INITIATIVE` are handled (they're likely `if/else if` blocks checking `state.phase`).

Add a new block for `AWAIT_ATTACK_ROLL`:

```typescript
// Inside messages.send, where phase-specific handling occurs:

if (state.phase === 'AWAIT_ATTACK_ROLL' && state.pendingAttackRoll) {
    // Try to extract a d20 roll value from the player's message
    const rollMatch = userMessage.match(/\b(\d{1,2})\b/);
    if (rollMatch) {
        const rawRoll = parseInt(rollMatch[1], 10);
        if (rawRoll >= 1 && rawRoll <= 20) {
            const result = engine.resolveAttackRoll(rawRoll);
            if (result.success) {
                await CombatEngineManager.persist(sessionId);
                // Generate narrative from result.logs (same pattern as AWAIT_DAMAGE_ROLL handler)
                // Save message, trigger enemy AI if needed, etc.
                // ... copy the pattern from the AWAIT_DAMAGE_ROLL handler ...
            }
        }
    }
    // If no valid roll found, prompt the player to roll
    // (or they can use the visual dice roller)
}
```

**IMPORTANT:** Follow the exact same narrative-generation and message-saving pattern already used in the adjacent `AWAIT_DAMAGE_ROLL` handler. Do not invent a new pattern. Copy the structure: extract roll → call engine method → persist → generate narrative → save messages → check for enemy turn → return.

---

## STEP 9: Update CombatSidebar Visual Cues

**Modify file:** `client/src/components/combat/CombatSidebar.tsx`

When the dice roller is visible (a roll is pending), add a subtle visual cue to the entity whose turn it is:

Find where each entity is rendered in the sidebar list. When `combatState?.pendingRoll?.entityName` matches the current entity's name, add a pulsing border or glow effect:

```tsx
className={cn(
    // ... existing classes ...
    pendingRoll?.entityName === entity.name && "ring-2 ring-amber-500 animate-pulse"
)}
```

Use the `cn()` utility already imported in the component (from `@/lib/utils`).

---

## VERIFICATION CHECKLIST

After implementation, verify these scenarios work:

### Test 1: Initiative via Dice Roller
1. Start combat with players (initiative = 0)
2. Phase should be `AWAIT_INITIATIVE`
3. Dice roller appears showing "Roll initiative for [player name]"
4. Click Roll → dice animates → shows d20 result
5. Result auto-submits → initiative applied
6. If more players pending, dice roller re-appears for next player
7. When all rolled, combat starts

### Test 2: Attack via Dice Roller
1. During ACTIVE phase, player types "I attack the goblin" in chat
2. Phase changes to `AWAIT_ATTACK_ROLL`
3. Dice roller appears showing "Roll to hit Goblin (d20+5)"
4. Click Roll → shows d20 result + modifier breakdown
5. Natural 20 → golden flash. Natural 1 → red flash.
6. Result auto-submits → hit/miss determined
7. If hit → phase changes to AWAIT_DAMAGE_ROLL

### Test 3: Damage via Dice Roller
1. After a hit, phase is `AWAIT_DAMAGE_ROLL`
2. Dice roller appears showing "Roll damage (1d8+3)"
3. Click Roll → shows die result + modifier
4. If critical → shows "CRITICAL" badge, formula is doubled (e.g., 2d8+3)
5. Result auto-submits → damage applied → turn advances

### Test 4: Chat-Based Roll Still Works
1. When in AWAIT_ATTACK_ROLL, type "I rolled a 15" in chat
2. Engine should accept the roll and process the attack
3. Same for initiative and damage via chat

### Test 5: Enemy Turns After Dice
1. After player submits a roll that ends their turn
2. If next entity is an enemy, enemy AI should trigger automatically
3. Combat should continue flowing without getting stuck

---

## STYLING GUIDELINES

- Use the existing color palette: `stone-800`, `stone-900` backgrounds with `amber` accents
- The dice roller card should have: `bg-stone-800/90 border border-amber-600/50 rounded-xl`
- Keep animations smooth but not excessive — 1.2s roll, 0.6s result reveal
- On mobile (sidebar collapses), the dice roller should work within the collapsed sidebar or the main chat area — but do NOT implement mobile layout changes in this phase. Just ensure it doesn't break.

## DO NOT

- Do NOT install any new npm packages. Everything needed is already available (framer-motion, lucide-react, sonner, shadcn/ui components).
- Do NOT modify the database schema. The engine state (including new `pendingAttackRoll`) is serialized as JSON to the existing `combat_engine_state` column.
- Do NOT modify any test files. Existing tests should continue to pass since `initiateCombat()` (the legacy method) still auto-rolls and bypasses `AWAIT_ATTACK_ROLL`.
- Do NOT change how enemy attacks work. Enemies still auto-roll everything. Only player attacks enter `AWAIT_ATTACK_ROLL`.
- Do NOT add sound effects or 3D WebGL dice. Keep it 2D with framer-motion. 3D can be a future upgrade.
