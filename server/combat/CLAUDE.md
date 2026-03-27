# Combat Engine V2

Deterministic state machine for D&D 5e combat. See `docs/combat/COMBAT_ENGINE.md` for full spec.

## Status
Phase 5.1 (Visual Dice) complete | Stage 1 Bug Fixes complete | Stage 2 (Smarter Enemies) next.

## Architecture
```
CombatSidebar (React) → combatV2 tRPC router → CombatEngineManager → CombatEngineV2
                                                        ↓
                                                EnemyAIController (LLM)
```

## Key Rules
- **Engine is deterministic** — dice rolls produce the same result given the same seed. LLM is ONLY used for enemy AI decisions, NOT for resolving hits/damage.
- **Deep copy state** — `getState()` returns deep copies. Never mutate returned state directly.
- **Manager is singleton per session** — `CombatEngineManager` holds one `CombatEngineV2` per sessionId in memory.
- **Undo via history stack** — state is snapshot before each action. `undoLastAction()` pops the stack.
- **Zod schemas are source of truth** — all types in `combat-types.ts`. Don't create parallel type definitions.

## Combat Phases
IDLE → AWAIT_INITIATIVE → ACTIVE → AWAIT_ATTACK_ROLL / AWAIT_DAMAGE_ROLL → ACTIVE (next turn) → RESOLVED

## Files
| File | Role |
|------|------|
| `combat-types.ts` | Zod schemas (CombatPhase, CombatEntity, BattleState) |
| `combat-engine-v2.ts` | Core state machine |
| `combat-engine-manager.ts` | Per-session lifecycle, DB persistence |
| `combat-validators.ts` | Input validation |
| `combat-helpers.ts` | Shared utility functions |
| `combat-narrator.ts` | LLM narration of combat events |
| `dice-roller.ts` | Wrapper around @dice-roller/rpg-dice-roller |
| `attack-detector.ts` | NLP detection of attacks from chat |
| `player-action-parser.ts` | Parse player intent from messages |
| `enemy-ai-controller.ts` | LLM-driven enemy turn decisions |

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
