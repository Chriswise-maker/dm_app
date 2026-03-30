# Phase 5+: Combat Engine Rework Roadmap

> **Status**: Stages 1–6 ✅ Complete
> **Last Updated**: 2026-03-29
> **Next Up**: Stage 7 — Open5e Integration

---

## Current Status

The combat engine rework is no longer in early Phase 5. The implemented and documented state is:

- [x] Stage 1: Bug fixes and hardening
- [x] Stage 2: Smarter enemy AI
- [x] Stage 3: Legal action architecture
- [x] Stage 4: Full action economy
- [x] Stage 5: Conditions, death saves, healing, and damage modifiers
- [x] Stage 6: Spellcasting, saves, and concentration
- [ ] Stage 7: Open5e integration

Reference docs:

- `docs/plans/combat_engine_rework_2f498f2e.plan.md`
- `docs/combat/COMBAT_ENGINE.md`

---

## Completed Stages

### Stage 1: Bug Fixes and Hardening ✅ (2026-03-15)

- [x] Dice mocking via optional `rollFn` in engine constructor for deterministic tests
- [x] `getState()` returns a deep copy via `structuredClone`
- [x] Log persistence added to `state.log`, capped at 200 entries
- [x] Crit/fumble detection fixed for player-provided rolls via `rawD20`
- [x] Round increments correctly when skipping dead entities wraps turn order
- [x] `submitRoll` validates d20 and damage roll bounds
- [x] `CombatEngineManager.withLock(sessionId, fn)` added for sequential mutation safety
- [x] Awaited-roll error handling fixed so failed rolls do not produce bad narrative state
- [x] Dead settings/code removed

### Stage 2: Smarter Enemies ✅

- [x] Better target scoring and richer enemy evaluation context
- [x] Parser and narrator fixes for more reliable action selection
- [x] Multi-player narrative consistency improvements

### Stage 3: Legal Action Architecture ✅

- [x] `getLegalActions()` added to the engine
- [x] Enemy AI constrained to legal action choices
- [x] Legal actions exposed through combat state for UI consumption

### Stage 4: Action Economy ✅

- [x] Turn resources tracked: action, bonus action, movement, reaction
- [x] Added actions: `DODGE`, `DASH`, `DISENGAGE`, `HELP`, `HIDE`, `READY`, `USE_ITEM`, `OPPORTUNITY_ATTACK`
- [x] Parser, AI, and UI updated to respect legal action availability
- [x] Sidebar shows player-facing turn/action state

### Stage 5: Conditions, Death Saves, and Healing ✅

- [x] D&D-style active conditions with duration tracking
- [x] Death save flow with `AWAIT_DEATH_SAVE`
- [x] `HEAL` action revives unconscious essential entities
- [x] Resistance, immunity, vulnerability, and `tempHp` damage handling

### Stage 6: Spellcasting ✅

- [x] `SpellSchema` and `CAST_SPELL` action added
- [x] Saving throw flow via `AWAIT_SAVE_ROLL`
- [x] Slot deduction, cantrips, and spell targeting wired in
- [x] Concentration tracking and concentration break checks implemented
- [x] Player parser and enemy AI support spell usage

### Visual Dice UI ✅

- [x] Animated dice UI in the combat sidebar
- [x] Engine pauses at `AWAIT_INITIATIVE`, `AWAIT_ATTACK_ROLL`, `AWAIT_DAMAGE_ROLL`, `AWAIT_DEATH_SAVE`, and `AWAIT_SAVE_ROLL` when needed
- [x] Dice results submit through `combatV2.submitRoll`
- [x] Manual chat roll entry remains as fallback

---

## Remaining Work

### Stage 7: Open5e Integration ⏭

Goal: remove manual enemy/spell stat entry wherever possible by sourcing structured 5e data.

Planned scope:

- [ ] Add an Open5e client on the server side
- [ ] Map monster API responses to `CombatEntity`
- [ ] Map spell API responses to engine `Spell` data
- [ ] Auto-populate enemy combatants from imported monster names
- [ ] Use imported spell data for range, damage, save type, and concentration metadata
- [ ] Add tests for API mapping and combat-init integration paths

Example target API shape:

```typescript
fetchMonster("goblin") -> CombatEntity
fetchSpell("fireball") -> SpellData
```

---

## Validation

As of 2026-03-29, the combat test suite is green locally:

- `107/107` tests passing across `server/combat/`
