# Combat Engine V2

> **Status**: Stages 1–6 complete. Stage 7 (Open5e Integration) next.
> **Last Updated**: 2026-03-29

## Overview

Deterministic D&D 5e combat engine with LLM-driven enemy AI, full action economy, conditions, spellcasting, and undo support.

```
Frontend (React)  →  combatV2 tRPC Router  →  CombatEngineManager  →  CombatEngineV2
                                                      ↓
                                              EnemyAIController (LLM)
```

---

## Stage Completion

| Stage | Status | What was built |
|-------|--------|---------------|
| **Stage 1** | ✅ Done | Bug fixes & hardening: dice mocking, deep copy state, log persistence, rawD20 crit/fumble, endTurn round skip, submitRoll validation, manager lock |
| **Stage 2** | ✅ Done | Smarter enemies: target scoring, enriched entity data, narrator "you" fix, UNKNOWN parser fix, narrative consistency |
| **Stage 3** | ✅ Done | Legal action architecture: `getLegalActions()`, enemy AI uses legal actions, exposed in `getState` |
| **Stage 4** | ✅ Done | Action economy: turn resources (action/bonus/reaction), Dodge/Dash/Disengage/Help/Hide/Ready/UseItem, extra attacks, auto-end logic |
| **Stage 5** | ✅ Done | Conditions, death saves, healing: D&D conditions with duration, death save state machine, HEAL action, resistance/immunity/vulnerability, tempHp |
| **Stage 6** | ✅ Done | Spellcasting: `SpellSchema`, `CAST_SPELL` action, `AWAIT_SAVE_ROLL` phase, concentration, ability scores, legal action wiring, parser + AI |
| **Stage 7** | 🔜 Next | Open5e integration: API client, map monster/spell data to `CombatEntity` |

---

## Architecture

### Files

| File | Role |
|------|------|
| `combat-types.ts` | All Zod schemas — single source of truth for types. Edit here first. |
| `combat-engine-v2.ts` | Core state machine. All game rules live here. ~2400 lines. |
| `combat-engine-manager.ts` | Per-session lifecycle, DB persistence, concurrency lock |
| `combat-validators.ts` | Input validation (dice roll range checks) |
| `combat-helpers.ts` | Shared utility functions |
| `combat-narrator.ts` | LLM narration of combat events |
| `dice-roller.ts` | Wrapper around `@dice-roller/rpg-dice-roller` |
| `attack-detector.ts` | NLP detection of attacks from chat messages |
| `player-action-parser.ts` | Parse player chat into `ActionPayload` via LLM |
| `enemy-ai-controller.ts` | LLM-driven enemy turn decisions |

### Phase State Machine

```
IDLE
  → AWAIT_INITIATIVE   (players roll d20 initiative)
  → ACTIVE             (someone's turn; waiting for action)
      → AWAIT_ATTACK_ROLL    (player attacks without providing a roll — visual dice)
      → AWAIT_DAMAGE_ROLL    (hit confirmed — waiting for damage roll)
      → AWAIT_DEATH_SAVE     (unconscious player's turn — must roll death save)
      → AWAIT_SAVE_ROLL      (enemy spell targets player — must roll saving throw)
  → RESOLVED           (all enemies dead, or all players dead/fled)
```

### CombatEntity Fields (key)

```typescript
{
  // Core
  id, name, type: "player" | "enemy" | "ally"
  hp, maxHp, baseAC
  initiative, initiativeModifier
  status: "ALIVE" | "UNCONSCIOUS" | "DEAD" | "FLED"
  isEssential   // true = unconscious at 0 HP (players), false = dead (monsters)

  // Combat
  attackModifier, damageFormula, damageType
  extraAttacks           // Extra Attack feature (Fighter 5+ etc.)

  // Defenses
  resistances, immunities, vulnerabilities   // damage type strings
  tempHp                                     // absorbed before real HP

  // Conditions
  conditions: string[]         // internal flags ("dodging", "helped_by:…", "readied:…")
  activeConditions: ActiveCondition[]  // D&D 5e conditions with duration

  // Death saves (unconscious players)
  deathSaves: { successes: 0–3, failures: 0–3 }

  // Spellcasting (Stage 6)
  spells: Spell[]                          // known spells
  spellSlots: { "1": 4, "2": 3, … }       // remaining slots per level
  spellSaveDC?: number                     // DC for enemy saves (8 + prof + mod)
  abilityScores?: { str, dex, con, int, wis, cha }  // for save modifiers
}
```

### Spell Schema (Stage 6)

```typescript
{
  name: string
  level: 0–9              // 0 = cantrip (no slot)
  school: string
  castingTime: "action" | "bonus_action" | "reaction"
  range: number           // feet (not enforced without grid)
  isAreaEffect: boolean
  areaType?: "sphere" | "cone" | "line" | "cube"
  areaSize?: number
  savingThrow?: "STR"|"DEX"|"CON"|"INT"|"WIS"|"CHA"
  halfOnSave: boolean     // halve damage on successful save (Fireball = true, Hold Person = false)
  damageFormula?: string  // e.g. "8d6"
  damageType?: string     // "fire", "force", etc.
  healingFormula?: string // e.g. "1d8+4"
  requiresConcentration: boolean
  conditions: string[]    // D&D conditions to apply on hit (e.g. "paralyzed")
  description: string
}
```

---

## tRPC Endpoints

```typescript
trpc.combatV2.getState({ sessionId })
// → BattleState + legalActions[] for current turn entity

trpc.combatV2.initiate({ sessionId, entities })
// → Start combat, enter AWAIT_INITIATIVE if players need to roll

trpc.combatV2.submitAction({ sessionId, action, dryRun? })
// → ActionResult { success, logs, newState }
// action: ATTACK | CAST_SPELL | DODGE | DASH | DISENGAGE | HEAL |
//         HELP | HIDE | READY | USE_ITEM | OPPORTUNITY_ATTACK | END_TURN

trpc.combatV2.submitRoll({ sessionId, rollType, rawDieValue, entityId? })
// rollType: "initiative" | "attack" | "damage" | "deathSave"
// → ActionResult; advances phase from AWAIT_* back to ACTIVE

trpc.combatV2.undo({ sessionId })
// → Restore previous BattleState from history stack

trpc.combatV2.endCombat({ sessionId })
// → RESOLVED phase, persist final state to DB
```

---

## Key Mechanics

### Action Economy
Each turn: **1 Action**, **1 Bonus Action**, **Movement**, **1 Reaction** (per round).
Tracked in `turnResources: TurnResourcesSchema`. Engine won't consume a resource that's already used.
Enemies auto-end turn after exhausting actions. Players must explicitly call END_TURN.

### Concentration
- Spells with `requiresConcentration: true` apply the `concentrating` active condition to the caster.
- Casting a new concentration spell automatically drops the previous one.
- When a concentrating entity takes damage: auto-rolled CON save (DC = max(10, damage/2)).
- Failure → `concentrating` condition removed.

### Saving Throws (spells)
- **Enemy targets**: engine auto-rolls using `abilityScores` (or defaults to +0 if not set).
- **Player targets**: engine enters `AWAIT_SAVE_ROLL` phase. Frontend prompts the player to roll. `submitRoll({ rollType: "save" })` resolves it.
- Half-damage spells: successful save deals `floor(damage / 2)`.

### Death Saves
On an unconscious player's turn (`isEssential: true`, HP ≤ 0):
- Engine enters `AWAIT_DEATH_SAVE` phase.
- Player rolls d20 via `submitRoll({ rollType: "deathSave" })`.
- Nat 20: revive at 1 HP. Nat 1: 2 failures. ≥ 10: success. < 10: failure.
- 3 successes: stabilized. 3 failures: dead.
- Taking damage while unconscious: 1 automatic failure (2 if melee + adjacent).

### Conditions (D&D 5e)
Applied via `applyCondition(entityId, { name, duration?, sourceId? })`.
Duration ticks down at the start of each affected entity's turn (`tickConditions`).
Internal flags (dodging, helped_by:, readied:) use the legacy `conditions: string[]` — don't mix.

### Resistance / Immunity / Vulnerability
Order of operations: immunity → raw damage → vulnerability (×2) → resistance (÷2) → tempHp absorption → real HP.

---

## Architectural Rules

1. **Deterministic engine** — dice rolls are injected via `rollFn`. LLM only decides *what to do*, engine resolves *the outcome*.
2. **Zod is source of truth** — all types in `combat-types.ts`. No parallel type definitions elsewhere.
3. **Deep copy state** — `getState()` returns `structuredClone`. Never mutate the returned object.
4. **Always use `CombatEngineManager`** — never instantiate `CombatEngineV2` directly in router code.
5. **`submitRoll` is for visual dice only** — feeds pre-rolled values from the frontend 3D dice UI.
6. **History stack = undo** — `pushHistory()` is called before every mutating action.

---

## Testing

```bash
pnpm test -- server/combat/  # All combat tests
pnpm test -- server/combat/__tests__/combat-engine-v2.test.ts  # Engine unit tests
pnpm test -- server/combat/__tests__/combat-ui-behaviour.test.ts  # UI-visible behaviour
pnpm test -- server/combat/__tests__/legal-actions.test.ts  # Legal actions
```

Always inject a `rollFn` in tests:
```typescript
const mockRoll = vi.fn().mockReturnValue({ total: 15, rolls: [15], isCritical: false, isFumble: false });
const engine = createCombatEngine(sessionId, {}, mockRoll);
```
