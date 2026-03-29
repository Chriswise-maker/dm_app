# Combat Engine V2

Deterministic state machine for D&D 5e combat. See `docs/combat/COMBAT_ENGINE.md` for full spec.

## Status
**Stages 1–6 complete.** Stage 7 (Open5e Integration) is next.

## Architecture
```
CombatSidebar (React) → combatV2 tRPC router → CombatEngineManager → CombatEngineV2
                                                        ↓
                                                EnemyAIController (LLM)
```

## Key Rules
- **Engine is deterministic** — dice rolls are injected via `rollFn`. LLM is ONLY used for enemy AI decisions, NOT for resolving hits/damage/saves.
- **Deep copy state** — `getState()` returns `structuredClone`. Never mutate returned state directly.
- **Manager is singleton per session** — `CombatEngineManager` holds one `CombatEngineV2` per sessionId in memory.
- **Undo via history stack** — `pushHistory()` is called before every mutating action. `undoLastAction()` pops the stack.
- **Zod schemas are source of truth** — all types in `combat-types.ts`. Don't create parallel type definitions.
- **Never instantiate CombatEngineV2 directly in router code** — always go through `CombatEngineManager`.

## Combat Phases
```
IDLE → AWAIT_INITIATIVE → ACTIVE
  → AWAIT_ATTACK_ROLL    (player attacking — visual dice for d20)
  → AWAIT_DAMAGE_ROLL    (hit confirmed — waiting for damage roll)
  → AWAIT_DEATH_SAVE     (unconscious player's turn)
  → AWAIT_SAVE_ROLL      (player targeted by enemy spell — must roll save)
→ RESOLVED
```

## Files
| File | Role |
|------|------|
| `combat-types.ts` | Zod schemas (CombatPhase, CombatEntity, Spell, BattleState, all payloads) |
| `combat-engine-v2.ts` | Core state machine (~2400 lines) |
| `combat-engine-manager.ts` | Per-session lifecycle, DB persistence, concurrency lock |
| `combat-validators.ts` | Input validation |
| `combat-helpers.ts` | Shared utility functions |
| `combat-narrator.ts` | LLM narration of combat events |
| `dice-roller.ts` | Wrapper around @dice-roller/rpg-dice-roller |
| `attack-detector.ts` | NLP detection of attacks from chat |
| `player-action-parser.ts` | Parse player intent from messages (LLM-based) |
| `enemy-ai-controller.ts` | LLM-driven enemy turn decisions |

## Action Types
| Action | Resource | Notes |
|--------|----------|-------|
| ATTACK | action | Weapon attack. If player has no roll → AWAIT_ATTACK_ROLL |
| CAST_SPELL | action / bonus_action | Determined by `spell.castingTime`. Deducts slot. |
| DODGE | action | Adds "dodging" flag → attacks have disadvantage |
| DASH | action | Doubles movement |
| DISENGAGE | action | No opportunity attacks on movement |
| HELP | action | Adds "helped_by:id" flag → ally gets advantage |
| HIDE | action | Adds "hidden" flag |
| READY | action | Stores "readied:ACTION:trigger" flag |
| USE_ITEM | action | Logged; effects not yet modeled |
| HEAL | action | Restores HP; revives unconscious essential entities |
| OPPORTUNITY_ATTACK | reaction | Off-turn attack |
| END_TURN | none | Explicit turn end |

## Spellcasting (Stage 6)
- Spells are stored on `CombatEntity.spells[]` with `spellSlots` tracking remaining uses.
- `castSpell(casterId, spellName, targetIds)` validates slot → deducts slot → applies effects.
- **No save**: full damage/conditions applied immediately.
- **Enemy saves**: auto-rolled by engine using target's `abilityScores`.
- **Player saves**: engine enters `AWAIT_SAVE_ROLL`. Player calls `submitRoll({ rollType: "save" })`.
- **Concentration**: casting drops previous concentration, applies `concentrating` condition. Taking damage triggers an auto-rolled CON save (DC = max(10, damage/2)).
- Cantrips (level 0) don't use spell slots.

## Testing
```bash
pnpm test -- server/combat/__tests__/combat-engine-v2.test.ts
pnpm test -- server/combat/  # all combat tests
```
Always mock dice rolls in tests. Use the existing test patterns in `__tests__/`.

## Common Pitfalls
- Don't add non-deterministic behavior to the engine (random outside dice-roller)
- Always go through `CombatEngineManager` — never instantiate `CombatEngineV2` directly in router code
- The `submitRoll` endpoint is for visual dice UI — it feeds pre-rolled values into the engine
- Enemy AI returns an action choice; the engine still resolves it deterministically
- Concentration is tracked via `activeConditions` (`concentrating`) — not the legacy `conditions` string array
- Adding a new action type? Update: types, engine `submitAction`, `getLegalActions`, parser, enemy AI, and tests
