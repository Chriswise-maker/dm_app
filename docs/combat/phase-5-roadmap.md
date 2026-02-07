# Phase 5: Advanced Features Roadmap

> **Status**: 📋 Future

---

## 5.1 Visual Dice

- 3D dice library (`dice-box` or `react-dice-roll`)
- Engine pauses at `AWAIT_ROLL` state
- Frontend shows dice animation
- Result submitted via `combat.submitRoll`

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
