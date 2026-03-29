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

## Current State (as of 2026-03-29)

**Stages 1–6** ✅ All complete.

- **Stage 1**: Dice mocking, getState deep copy, log persistence, rawD20 crit/fumble, endTurn round skip fix, submitRoll validation, manager lock + AI re-entrancy guard, error handling, dead code cleanup.
- **Stage 2**: Target scoring (pre-LLM), enriched entity data, narrator “you” fix, UNKNOWN parser fix, narrative consistency.
- **Stage 3**: `getLegalActions(entityId)` on engine, enemy AI uses legal actions (numbered choice prompt), `legalActions` exposed in `combatV2.getState`.
- **Stage 4**: `TurnResources` tracking (action/bonus/reaction), stop auto-ending turns, Dodge/Dash/Disengage/Help/Hide/Ready/UseItem/Heal actions, Extra Attack, contextual QUERY handler.
- **Stage 5**: D&D conditions with duration (`activeConditions`), death saves state machine, HEAL action, resistance/immunity/vulnerability/tempHp, concentration condition.
- **Stage 6**: `SpellSchema`, `CastSpellPayload`, `AWAIT_SAVE_ROLL` phase, `processCastSpell` (slot deduction, area effects, saving throws, healing), concentration tracking + CON save, `submitSavingThrow`, parser + AI spell support, `abilityScores` on entities.

### 🔜 Next Up
1. **Stage 7: Open5e Integration**
   - `server/combat/open5e-client.ts` — `fetchMonster(name)`, `fetchSpell(name)`
   - Map Open5e JSON → `CombatEntity` (multiattack, spells, resistances, ability scores)
   - Wire into `combat-helpers.ts` for automatic enemy population
   - Fallback to LLM-generated stats if Open5e lookup fails

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

```bash
npm test -- server/combat/ --exclude='**/dice-roller.test.ts'
npm test -- server/combat/__tests__/combat-engine-v2.test.ts
npm test -- server/combat/__tests__/combat-ui-behaviour.test.ts
```
