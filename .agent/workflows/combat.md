---
description: Work on the combat engine system
---

## Before Starting

1. Read `docs/combat/COMBAT_ENGINE.md` for current status
2. Check which phase you're working on:
   - `docs/combat/phase-1-4-completed.md` — reference for what's done
   - `docs/combat/phase-5-roadmap.md` — current work (in progress)
   - `docs/combat/phase-6-ui-polish.md` — UI polish deferred tasks

---

## Current State (as of 2026-02-20)

**Phase 4 UI Integration** is ✅ Complete.

**Phase 5 Advanced Features Roadmap** is in progress. Here's what's next:

### 🔜 Next Up (Phase 5)
1. **Visual Dice** (5.1)
   - 3D dice library (`dice-box` or `react-dice-roll`)
   - Engine pauses at `AWAIT_ROLL` state
   - Frontend shows dice animation
   - Result submitted via `combat.submitRoll`
2. **Saving Throws** (5.2)
   - DEX/CON/WIS saves with DC calculation
   - Advantage/disadvantage from conditions
   - Damage modifiers: Resistance (½), Immunity (0), Vulnerability (2×)

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

1. Move completed tasks from `phase-X.md` to `phase-1-4-completed.md` (or rename to include new phase)
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
