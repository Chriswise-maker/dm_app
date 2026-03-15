# Phase 5: Advanced Features Roadmap

> **Status**: 🔄 In Progress
> **Combat Engine Rework**: Stage 1 (Bug Fixes) ✅ Complete — see plan for Stages 2–7.

---

## Stage 1: Bug Fixes and Hardening ✅ (2026-03-15)

- [x] Dice mocking via optional `rollFn` in engine constructor (deterministic tests)
- [x] `getState()` returns deep copy (`structuredClone`) — mutations don't affect engine
- [x] Log persistence: entries pushed to `state.log`, capped at 200
- [x] Crit/fumble from player rolls: `rawD20` on `AttackPayload`, used in `processAttack` and `resolveAttackRoll`
- [x] `endTurn` round boundary: increment round when skip-dead loop wraps past turn order end
- [x] `submitRoll` validation: d20 rolls 1–20, damage rolls validated against formula max
- [x] Concurrency: `CombatEngineManager.withLock(sessionId, fn)`; `submitRoll`/`submitAction` wrapped; AI loop re-entrancy guard in `runAILoop`
- [x] Error handling: AWAIT_DAMAGE_ROLL / AWAIT_ATTACK_ROLL check `result.success` before narrative; `submitAction` destroys engine when `phase === 'RESOLVED'`
- [x] Dead code: removed `CombatEntityWithHooks`, `autoCritDamage`, `allowNegativeHP` from settings

---

## 5.1 Visual Dice ✅

- [x] 2D animated dice (framer-motion) in CombatSidebar
- [x] Engine pauses at `AWAIT_INITIATIVE`, `AWAIT_ATTACK_ROLL`, `AWAIT_DAMAGE_ROLL`
- [x] Result submitted via `combatV2.submitRoll`
- [x] Chat fallback for typing rolls manually

## 5.2 Saving Throws

- DEX/CON/WIS saves with DC calculation
- Advantage/disadvantage from conditions
- Damage modifiers: Resistance (½), Immunity (0), Vulnerability (2×)

## 5.3 Open5e Integration

```typescript
fetchMonster("goblin") → CombatEntity
fetchSpell("fireball") → SpellData
```
- Auto-populate enemy stats from API
- Spell data: range, damage, save DC

## 5.4 Tiered AI Models

```typescript
GameSettings: {
  ai_models: {
    minion_tier: "gemini-flash",   // cheap, fast
    boss_tier: "gemini-pro"        // smarter tactics
  }
}
```

## 5.5 Full Action Economy

- Action types: Attack, Cast, Dodge, Dash, Disengage, Help, Hide, Ready
- Resources per turn: Action (1), Bonus (1), Reaction (1), Movement
- Spell slot tracking + concentration checks

## 5.6 Conditions

- Poisoned, Paralyzed, Stunned, Prone, Frightened, etc.
- Auto-apply advantage/disadvantage
- Duration tracking

## 5.7 Reactions (Optional)

- Opportunity attacks on movement
- Shield, Counterspell
- LIFO stack for interrupt resolution
