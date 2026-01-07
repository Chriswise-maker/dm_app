# Combat Engine V2 — Project Status

> **Last Updated:** 2026-01-07  
> **Status:** Phase 2.1, 2.2, 2.4, 2.5 Complete | Phase 2.3 Pending

---

## Overview

Combat Engine V2 is a deterministic combat system for the D&D Dungeon Master app. It replaces the old database-centric combat logic with a proper state machine that supports undo, structured logging, and LLM-driven enemy AI (planned).

### Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Frontend (React)                      │
│  CombatSidebar → trpc.combatV2.* endpoints               │
└─────────────────────┬───────────────────────────────────┘
                      │ tRPC
┌─────────────────────▼───────────────────────────────────┐
│                  combatV2 Router                         │
│  getState | initiate | submitAction | undo | endCombat   │
└─────────────────────┬───────────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────────┐
│              CombatEngineManager                         │
│  Per-session singleton | Lazy DB loading | Persistence   │
└─────────────────────┬───────────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────────┐
│                CombatEngineV2                            │
│  Deterministic state machine | Undo history | Logging    │
└─────────────────────────────────────────────────────────┘
```

---

## Files Created/Modified

### Phase 1 (Complete)

| File | Status | Purpose |
|------|--------|---------|
| `server/combat/combat-types.ts` | ✅ New | Zod schemas for `CombatEntity`, `BattleState`, `ActionPayload`, etc. |
| `server/combat/combat-engine-v2.ts` | ✅ New | Core deterministic engine with `submitAction()`, `undoLastAction()`, etc. |
| `server/combat/__tests__/combat-engine-v2.test.ts` | ✅ New | 14 unit tests (all passing) |

### Phase 2 (Current)

| File | Status | Changes |
|------|--------|---------|
| `server/combat/combat-engine-manager.ts` | ✅ New | Singleton manager for per-session engine instances |
| `drizzle/schema.ts` | ✅ Modified | Added `engineStateJson` column to `combatState` table |
| `server/db.ts` | ✅ Modified | Added `save/load/deleteCombatEngineState()` functions |
| `server/routers.ts` | ✅ Modified | Added `combatV2` router with 5 endpoints |
| `server/_core/index.ts` | ✅ Modified | Added charset normalization middleware for body-parser |
| `client/src/main.tsx` | ✅ Modified | Added vanilla tRPC client exposed as `window.trpc` for console testing |

---

## tRPC Endpoints (combatV2 Router)

All endpoints are working and verified:

| Endpoint | Type | Input | Description |
|----------|------|-------|-------------|
| `getState` | query | `{ sessionId }` | Returns current `BattleState` |
| `initiate` | mutation | `{ sessionId, entities[] }` | Starts combat, rolls initiative |
| `submitAction` | mutation | `{ sessionId, action, dryRun? }` | Processes ATTACK or END_TURN |
| `undo` | mutation | `{ sessionId }` | Reverts to previous state |
| `endCombat` | mutation | `{ sessionId }` | Ends combat, cleans up |

### Example Usage (Browser Console)

```javascript
// List sessions to get your sessionId
await trpc.sessions.list.query()

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

// Dry run (preview without applying)
await trpc.combatV2.submitAction.mutate({
  sessionId: 22,
  action: { type: 'ATTACK', attackerId: 'p1', targetId: 'g1' },
  dryRun: true
})

// Undo last action
await trpc.combatV2.undo.mutate({ sessionId: 22 })

// Get current state
await trpc.combatV2.getState.query({ sessionId: 22 })

// End combat
await trpc.combatV2.endCombat.mutate({ sessionId: 22 })
```

---

## Database Schema Change

The `combatState` table has a new column:

```sql
ALTER TABLE "combatState" ADD COLUMN IF NOT EXISTS "engineStateJson" TEXT;
```

This column stores the serialized `BattleState` JSON from `CombatEngineV2.exportState()`.

**Note:** This migration was applied manually during this session. If starting fresh, run:
```bash
npm run db:push
```

---

## Bug Fixes Applied

### 1. Body-Parser Charset Issue

**Problem:** Express body-parser rejected `charset=UTF-8` (uppercase) from browser.

**Fix:** Added middleware in `server/_core/index.ts`:
```typescript
app.use((req, _res, next) => {
  const contentType = req.headers['content-type'];
  if (contentType && contentType.includes('charset=UTF-8')) {
    req.headers['content-type'] = contentType.replace('charset=UTF-8', 'charset=utf-8');
  }
  next();
});
```

### 2. Duplicate Content-Type Header

**Problem:** Manual `Content-Type` header in tRPC client caused request failures.

**Fix:** Removed manual headers from `client/src/main.tsx` — tRPC handles this automatically.

---

## Testing

### Unit Tests
```bash
npm test -- server/combat/__tests__/combat-engine-v2.test.ts
# Result: 14/14 tests passing
```

### TypeScript Check
```bash
npm run check
# Result: No errors
```

### Manual Browser Testing
All endpoints verified working via browser console with `window.trpc`.

---

## What's Still Pending

### Phase 2.3: Bridge to Existing Combat Helpers

The following functions in `server/combat/combat-helpers.ts` still use the OLD combat system:

- `handleAutoCombatInitiation()` — Creates combat when LLM says "combat starts"
- `handleAutoCombatEnd()` — Ends combat when LLM says "combat ends"

**Task:** Update these to use `CombatEngineV2` and `CombatEngineManager` instead of direct database calls.

### Phase 3: Enemy AI (Future)

- Build context prompt from `BattleState` for LLM
- LLM returns structured `ActionPayload`
- Validate and resolve via engine
- Narrate outcome with LLM

### Phase 4: UI Integration (Future)

- Wire `CombatSidebar.tsx` to `combatV2` endpoints
- Display turn indicator, HP bars, combat log
- Add Undo button
- Add attack buttons

---

## How to Continue

1. **Start the app:**
   ```bash
   npm run dev
   ```

2. **Run tests:**
   ```bash
   npm test -- server/combat/__tests__/combat-engine-v2.test.ts
   ```

3. **Test endpoints in browser console:**
   - Open http://localhost:3000
   - Open DevTools Console (Cmd+Option+K in Firefox)
   - Use `trpc.combatV2.*` commands

4. **Next task (Phase 2.3):**
   - Open `server/combat/combat-helpers.ts`
   - Update `handleAutoCombatInitiation()` to use `CombatEngineManager.getOrCreate()`
   - Update `handleAutoCombatEnd()` to use `CombatEngineManager.destroy()`

---

## Key Files to Review

| File | Purpose |
|------|---------|
| `server/combat/combat-types.ts` | All type definitions |
| `server/combat/combat-engine-v2.ts` | Core engine logic |
| `server/combat/combat-engine-manager.ts` | Per-session engine management |
| `server/routers.ts` (lines 1315-1545) | `combatV2` tRPC router |
| `server/combat/combat-helpers.ts` | Auto-combat functions (need updating) |

---

## Related Conversations

- **Combat Engine V2 Phase 1** — Created core engine and types
- **Revamping D&D Combat Engine** — Original architecture design
