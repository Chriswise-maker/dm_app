---
description: Work on the combat engine system
---

## Before Starting

1. Read `docs/combat/COMBAT_ENGINE.md` for current status
2. Check which phase you're working on:
   - `docs/combat/phase-1-3-completed.md` — reference for what's done
   - `docs/combat/phase-4-ui-integration.md` — current work (in progress)
   - `docs/combat/phase-5-roadmap.md` — future features

---

## Current State (as of 2026-01-11)

**Phase 4 UI Integration** is in progress. Here's what's done:

### ✅ Completed This Session
1. **Player Action Parser** (`server/combat/player-action-parser.ts`)
   - LLM-based intent extraction from chat messages
   - Fuzzy entity matching ("the goblin" → `g1`)
   - Returns `ActionPayload` + raw message as flavor

2. **Activity Log Service** (`server/activity-log.ts`)
   - In-memory backend event logging
   - Types: parser, engine, roll, damage, death, ai, llm, narrator, system, error
   - Exposed via `messages.getActivityLog` tRPC endpoint

3. **ContextViewer Redesign** (`client/src/components/ContextViewer.tsx`)
   - 3 tabs: Activity, Game State, LLM Context
   - Activity tab auto-refreshes every 2s
   - Game State shows BattleState with entities/HP/turn

4. **Activity Logging Wiring**
   - Added `activity.*` calls to `player-action-parser.ts`
   - Added `activity.*` calls to `enemy-ai-controller.ts`
   - Added `activity.*` calls to `combat-engine-v2.ts`

### 🔜 Next Up (4.2 Chat Integration)
1. Detect when combat is active and it's player's turn in chat flow
2. Route player message through `parsePlayerAction()`
3. Call `combatV2.submitAction` with parsed action
4. Generate narrative using combat logs + flavor
5. Trigger enemy AI loop after player action

---

## When Implementing a Feature

1. Find or add the feature in the appropriate phase doc
2. Mark the task as `[/]` in-progress
3. Implement the feature
4. Test it works
5. Mark the task as `[x]` complete

---

## When a Phase is Complete

**IMPORTANT**: Update docs before finishing!

1. Move completed tasks from `phase-X.md` to `phase-1-3-completed.md` (or rename to include new phase)
2. Update `COMBAT_ENGINE.md` phase table:
   ```
   | **Phase X** | ✅ Done | Brief summary |
   ```
3. Add any bug fixes, gotchas, or testing notes to the completed doc

---

## Key Files

| Purpose | Location |
|---------|----------|
| Combat types | `server/combat/combat-types.ts` |
| Core engine | `server/combat/combat-engine-v2.ts` |
| Engine manager | `server/combat/combat-engine-manager.ts` |
| Enemy AI | `server/combat/enemy-ai-controller.ts` |
| Player action parser | `server/combat/player-action-parser.ts` |
| Activity log | `server/activity-log.ts` |
| tRPC endpoints | `server/routers.ts` (combatV2 router) |
| UI sidebar | `client/src/components/combat/CombatSidebar.tsx` |
| Debug viewer | `client/src/components/ContextViewer.tsx` |

---

## Testing

// turbo
```bash
npm test -- server/combat/__tests__/combat-engine-v2.test.ts
```
