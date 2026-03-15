# Combat Engine V2

> **Status**: Phase 5.1 Complete (Visual Dice). **Stage 1 Bug Fixes** complete. Stage 2 (Smarter Enemies) next.
> **Last Updated**: 2026-03-15

## Overview

Deterministic combat engine replacing the old database-driven approach. Provides undo support, structured logging, and LLM-driven enemy AI.

```
Frontend (React)  →  combatV2 tRPC Router  →  CombatEngineManager  →  CombatEngineV2
                                                      ↓
                                              EnemyAIController (LLM)
```

---

## Phase Status

| Phase | Status | Details |
|-------|--------|---------|
| **1. Core Engine** | ✅ Done | Types, state machine, undo, tests |
| **2. tRPC Integration** | ✅ Done | Endpoints, DB persistence, manager |
| **3. Enemy AI** | ✅ Done | LLM-driven enemy turns |
| **4. UI Integration** | ✅ Done | Chat-driven parsing, logging |
| **5. Advanced Features** | 🔄 In Progress | [→ Phase 5 Roadmap](./phase-5-roadmap.md) — 5.1 Visual Dice ✅, Stage 1 Bug Fixes ✅ |

---

## Key Files

| File | Purpose |
|------|---------|
| `server/combat/combat-types.ts` | Zod schemas |
| `server/combat/combat-engine-v2.ts` | Core engine |
| `server/combat/combat-engine-manager.ts` | Per-session instances |
| `server/combat/enemy-ai-controller.ts` | Enemy AI logic |
| `server/routers.ts` (combatV2) | tRPC endpoints |

---

## tRPC Endpoints

```typescript
trpc.combatV2.getState({ sessionId })      // Get BattleState
trpc.combatV2.initiate({ sessionId, entities })  // Start combat
trpc.combatV2.submitAction({ sessionId, action, dryRun? })  // Attack/EndTurn
trpc.combatV2.submitRoll({ sessionId, rollType, rawDieValue, entityId? })  // Visual dice roller
trpc.combatV2.undo({ sessionId })          // Undo last action
trpc.combatV2.endCombat({ sessionId })     // End combat
```

---

## Architectural Constraints

### 1. Dice Library
Use `@dice-roller/rpg-dice-roller` — handles `2d20kh1` (advantage), `4d6dl1` (stats), etc.

### 2. Hook Pattern for Stats
Stats as methods, not properties (allows buffs/debuffs):
```typescript
const ac = target.getAC(attackerContext);  // ✅
const ac = target.ac;                       // ❌
```

### 3. History Stack (Undo)
- Push deep copy of `BattleState` before each action
- `undoLastAction()` pops and restores

### 4. Initiative Tie-Breakers
1. Total score (descending)
2. DEX modifier
3. Random coin flip

### 5. Dead vs Unconscious
- `isEssential: false` (monsters) → 0 HP = **Dead**
- `isEssential: true` (players) → 0 HP = **Unconscious**

### 6. Range Bands (No Grid)
```typescript
enum RangeBand { MELEE = 5, NEAR = 30, FAR = 60 }
```

### 7. Event Logging
Actions return structured `CombatLogEntry[]`:
```typescript
[{ type: "ATTACK_ROLL", value: 18, isHit: true }, 
 { type: "DAMAGE", amount: 5, targetId: "goblin-1" }]
```

### 8. Turn Lifecycle Hooks
`startTurn(entityId)` and `endTurn(entityId)` for regen, status effects, etc.

### 9. Debug Persistence
`saveDebugState()` → writes `debug-snapshot.json` for troubleshooting

### 10. Tiered AI Models (Planned)
```typescript
GameSettings: { 
  ai_models: { 
    minion_tier: "gemini-flash",  // cheap, fast
    boss_tier: "gemini-pro"       // smarter tactics
  } 
}
```

---

## Testing

```bash
npm test -- server/combat/ --exclude='**/dice-roller.test.ts'   # All combat tests (~33)
npm test -- server/combat/__tests__/combat-engine-v2.test.ts   # Engine + Stage 1 unit tests
npm test -- server/combat/__tests__/combat-ui-behaviour.test.ts  # UI-visible behaviour (log, crit, round)
```

Stage 1 added: deterministic roll injection (`rollFn`), log persistence, `rawD20` crit/fumble, endTurn round fix, submitRoll validation, manager lock + AI re-entrancy guard, error handling, dead code removal.
