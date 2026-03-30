# Narrative Combat Design (D&D 5e Compliant)

## The Philosophy: Initiative is King
You are absolutely correct: The "Stack" is not D&D. In 5th Edition, the "Order of Things" is strictly defined by **Initiative**.

When a player says "I attack everyone" in a standoff:
1. **Time Stops**.
2. **Initiative is Rolled** for everyone involved.
3. **Actions Resolve in Order**.

There is no "Interrupt" phase. If the Seekers shoot you *before* your spell goes off, it's simply because **they rolled higher Initiative** (or you were Surprised).

## The "Order of Things" Algorithm

### 1. The Trigger
**Player**: "I cast Ray of Sickness at the Leader!"
**System**:
- Detects Hostile Intent.
- Pauses flow.
- "Roll for Initiative!"

### 2. The Resolution Sequence
The engine determines the order based on Initiative rolls.

#### Scenario A: The Enemy is Faster (Seekers Init 18, Player Init 12)
1. **Turn 1 (Seekers)**: The engine sees they are Hostile. They take their turn.
   - *Narrative*: "As you begin to chant, the Seekers react with lightning speed! Bolts fly before you can finish your sigil."
   - Action: Attack (Hits Player).
2. **Turn 2 (Player)**: Now it's the Player's turn.
   - The system executes the `pendingIntendedAction` ("Ray of Sickness") automatically (or prompts to confirm, in case the situation changed).
   - *Narrative*: "Grimacing from the pain, you unleash the rot."

#### Scenario B: The Player is Faster (Player Init 20, Seekers Init 18)
1. **Turn 1 (Player)**:
   - Action: `Ray of Sickness` executes immediately.
   - *Narrative*: "You catch them off guard! Your spell strikes the Leader before she can raise her shield."
2. **Turn 2 (Seekers)**:
   - They retaliate.

### 3. Handling "Readied Actions" (The Standoff)
In a standoff, NPCs might have valid **Readied Actions** ("I shoot if he moves").
- **Mechanic**: If an NPC has a Readied Action, they use their **Reaction** immediately after the Trigger.
- **Rule**: This happens *after* the trigger in 5e (usually), but for "I attack", the trigger is the *start* of the attack.
- **Simplification**: Just give them **Advantage on Initiative** to represent their readiness. This keeps it clean and 5e conformant.

## Engine Implementation

### New State: `pendingIntendedAction`
When combat starts from narrative, we store:
```typescript
{
  type: "CAST_SPELL",
  spell: "Ray of Sickness",
  target: "Leader"
}
```

### The `initiateNarrativeCombat` Flow
1. **Roll Initiative** for all entities.
2. **Sort Turn Order**.
3. **Process First Round**:
   - Iterate through turns.
   - If User's Turn: Execute `pendingIntendedAction`.
   - If Enemy Turn: AI decides action (likely Attack).
4. **Log Events** sequentially.

## Solving the Narrative "Mess"
This treats the "Mess" (simultaneous shouting/shooting) as a linear sequence that happens very fast. The "Activity Log" will show the precise second-by-second breakdown:
- [00:01] **Seeker 1** wins initiative!
- [00:02] **Seeker 1** shoots Player (7 dmg).
- [00:03] **Player** turn starts.
- [00:04] **Player** casts Ray of Sickness.

This is 100% D&D conformant and strictly deterministic.
