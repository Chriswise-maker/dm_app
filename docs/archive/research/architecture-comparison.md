# Research: Architecture Comparison - Siloed vs. Modular Engines

This document compares two strategies for adding support for new RPG systems (e.g., Shadowrun, Call of Cthulhu) to the application.

## Option A: The Siloed Approach (Parallel Engines)
*User Suggestion: "Finish D&D, then build a fresh, separate engine for Shadowrun. Switch via UI dropdown."*

### Concept
We maintain completely separate classes for each system.
*   `DnDCombatEngine` (Current)
*   `ShadowrunCombatEngine` (New)
*   `CoCCombatEngine` (New)

The API layer detects the active game type and routes requests to the appropriate engine instance.

### Pros
1.  **Zero Risk to D&D:** We don't touch the working D&D 5e code. It remains stable and optimized.
2.  **Perfect Optimization:** The Shadowrun engine can use specific data structures (e.g., `Edge`, `InitiativePasses`) without forcing them into a generic "Entity" schema.
3.  **Speed of Implementation:** We can start coding Shadowrun immediately without spending a week refactoring the existing code.
4.  **Simplicity:** Debugging is easier. "Why is initiative wrong?" -> Check `ShadowrunEngine.ts`. No need to trace through generic Abstract Factories.

### Cons
1.  **Code Duplication:** Both engines need:
    *   Undo/Redo History Stacks
    *   Combat Logs & Event Systems
    *   Turn Management (Start/End Turn)
    *   Entity Lists
    *   *Risk:* Fixing a bug in the "Undo" logic for D&D doesn't fix it for Shadowrun.
2.  **Frontend Complexity:** The UI needs to be smarter. It has to know "If D&D, show AC. If Shadowrun, show Physical/Stun tracks."
3.  **Divergence:** Over time, D&D might get "Spectator Mode" while Shadowrun gets "Macro Support," leading to feature disparity.

---

## Option B: The Modular Approach (Unified Core)
*Previous Proposal: "Refactor core to a generic engine, load rules as plugins."*

### Concept
One single `CombatEngine` class that handles the flow (Turns, Logs, History). It delegates math and specific rules to a `IRuleSystem` interface.

### Pros
1.  **Maintainability:** Fix "Undo" once, it works for every system.
2.  **Unified API:** The frontend treats everything as "Generic Entity with Stats," making it easier to add System #4, #5, etc.
3.  **Feature Parity:** New engine features (e.g., "WebSocket Spectating") automatically work for all games.

### Cons
1.  **High Upfront Cost:** Requires a risky refactor of the stable D&D engine.
2.  **Abstraction Leaks:** D&D is "Turn-based," but *Lancer* or *Shadowrun* have complex interrupt mechanics that might fight against a rigid "Generic Turn Loop."
3.  **"Lowest Common Denominator":** The engine might become bland to accommodate everyone, losing the "crunchy" feel of specific systems.

---

## Recommendation: The Hybrid "Library" Approach (Modified Option A)

**Go with the Side-by-Side (Siloed) approach, but share utilities.**

We should **not** refactor the current D&D engine into a generic monstrosity yet. It is too risky and might lead to over-engineering.

**The Strategy:**
1.  **Keep `CombatEngineV2` (D&D)** exactly as is. Finish Phase 5.
2.  **Create `ShadowrunEngine`** as a new class.
3.  **Extract Shared Logic:** Instead of inheritance, use composition.
    *   Create a `HistoryManager` class (handles undo stacks).
    *   Create a `LogManager` class (handles event streams).
    *   Both engines import and use these helpers, but run their own main loops.

**Why this wins:**
*   It allows you to build Shadowrun *cleanly* without breaking D&D.
*   It avoids copying 1000 lines of code (by sharing the History/Log helpers).
*   It lets the Shadowrun engine handle its weird initiative (Rolling for passes) without hacking the D&D initiative sorter.

### Roadmap Adjustment
1.  **Finish Phase 5 (D&D UI).**
2.  **Phase 6 (Preparation):** Extract `HistoryStack` and `DiceRoller` into generic helper classes (`/server/lib`).
3.  **Phase 7 (New System):** Build `ShadowrunEngine` from scratch, using those helpers.
