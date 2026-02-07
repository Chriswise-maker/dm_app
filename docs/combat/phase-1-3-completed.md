# Phases 1-3: Completed Implementation

> **Status**: ✅ Complete

---

## Phase 1: Core Engine & Types

### Files Created

| File | Purpose |
|------|---------|
| `server/combat/combat-types.ts` | Zod schemas for `CombatEntity`, `BattleState`, `ActionPayload`, `CombatLogEntry` |
| `server/combat/combat-engine-v2.ts` | Core deterministic engine |
| `server/combat/__tests__/combat-engine-v2.test.ts` | 14 unit tests |

### Dependency Added
```bash
pnpm add @dice-roller/rpg-dice-roller
```

---

## Phase 2: tRPC Integration

### Files Created/Modified

| File | Changes |
|------|---------|
| `server/combat/combat-engine-manager.ts` | Singleton per-session engine instances |
| `drizzle/schema.ts` | Added `engineStateJson` column to `combatState` |
| `server/db.ts` | Added `save/load/deleteCombatEngineState()` |
| `server/routers.ts` | Added `combatV2` router with 5 endpoints |
| `server/_core/index.ts` | Charset normalization middleware |
| `client/src/main.tsx` | Exposed `window.trpc` for console testing |

### Database Migration
```sql
ALTER TABLE "combatState" ADD COLUMN IF NOT EXISTS "engineStateJson" TEXT;
```
Run `npm run db:push` if starting fresh.

### Bug Fixes Applied

**1. Body-Parser Charset Issue**
```typescript
// server/_core/index.ts
app.use((req, _res, next) => {
  const contentType = req.headers['content-type'];
  if (contentType?.includes('charset=UTF-8')) {
    req.headers['content-type'] = contentType.replace('charset=UTF-8', 'charset=utf-8');
  }
  next();
});
```

**2. Duplicate Content-Type Header**  
Removed manual headers from tRPC client — tRPC handles this automatically.

---

## Phase 3: Enemy AI Controller

### Files Created

| File | Purpose |
|------|---------|
| `server/combat/enemy-ai-controller.ts` | LLM-driven enemy turn logic |

### Key Functions
```typescript
buildEnemyDecisionPromptV2()  // Tactical prompt for LLM
parseEnemyAction()            // Parse LLM response → ActionPayload
executeEnemyTurn()            // Execute single enemy turn
shouldExecuteAI()             // Check if current turn is enemy
runAILoop()                   // Chain enemy turns until player
```

### Modified Files
- `server/combat/combat-helpers.ts` — Triggers AI after combat init
- `server/routers.ts` — Triggers AI after player action

---

## Console Testing

```javascript
// Start combat
await trpc.combatV2.initiate.mutate({
  sessionId: 22,
  entities: [
    { id: 'p1', name: 'Hero', type: 'player', hp: 30, maxHp: 30, baseAC: 16, initiative: 15 },
    { id: 'g1', name: 'Goblin', type: 'enemy', hp: 7, maxHp: 7, baseAC: 12, initiative: 10 }
  ]
})

// Attack
await trpc.combatV2.submitAction.mutate({
  sessionId: 22,
  action: { type: 'ATTACK', attackerId: 'p1', targetId: 'g1' }
})

// Dry run (preview)
await trpc.combatV2.submitAction.mutate({
  sessionId: 22,
  action: { type: 'ATTACK', attackerId: 'p1', targetId: 'g1' },
  dryRun: true
})

// Undo
await trpc.combatV2.undo.mutate({ sessionId: 22 })

// Get state
await trpc.combatV2.getState.query({ sessionId: 22 })

// End combat
await trpc.combatV2.endCombat.mutate({ sessionId: 22 })
```

---

## Unit Tests

```bash
npm test -- server/combat/__tests__/combat-engine-v2.test.ts
# 14/14 passing
```

Tests cover:
- Entity initialization
- Initiative sorting with tie-breakers
- Attack hit/miss resolution
- Death vs Unconscious (`isEssential`)
- Undo functionality
- State export/import round-trip
