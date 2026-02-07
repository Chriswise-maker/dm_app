# Research: Adapting the Engine for Multi-System RPG Support

## 1. Executive Summary
The current application is heavily optimized for **Dungeons & Dragons 5th Edition (D&D 5e)**. While the narrative layers (Campaign Management, Chat, Worldbuilding) are largely prompt-driven and easily adaptable, the **Combat Engine (Situation/Simulation Layer)** is tightly coupled to D&D 5e mechanics (d20 methodology, specific attribute dependencies, and turn structures).

Adapting to "crunchy" systems with vastly different mechanics (e.g., *Shadowrun's* dice pools, *Call of Cthulhu's* d100 thresholds) requires a refactoring of the core engine from a monolithic implementation to a **Strategy Pattern** architecture.

This document outlines the current technical debt, compares target systems, and proposes a roadmap for a "Universal Tabletop Engine."

---

## 2. Codebase Audit: The "D&D Coupling"
Currently, `server/combat/combat-engine-v2.ts` and `combat-types.ts` effectively hardcode the D&D 5e SRD (System Reference Document) rules.

### Hardcoded Mechanics Identified
1.  **Resolution Mechanic:** The engine explicitly calls `rollDice("1d20")` and adds modifiers. It assumes a binary Pass/Fail against a Target Number (AC/DC).
    *   *Constraint:* Incompatible with Dice Pools (Shadowrun, World of Darkness) or Roll-Under Systems (GURPS, Call of Cthulhu).
2.  **Damage Model:** Logic assumes `Attack Roll -> Compare AC -> Roll Damage -> Subtract HP`.
    *   *Constraint:* Incompatible with systems using "Soak" rolls (Shadowrun) or Wound Levels instead of HP (Savage Worlds, Fate).
3.  **Initiative System:** Hardcoded sorting: `Total -> Modifier -> Coin Flip`.
    *   *Constraint:* Incompatible with Shadowrun (Initiative Passes/Score reduction), Lancer (Alternating Activations), or PbtA (No initiative).
4.  **Data Schema (Zod):**
    *   `baseAC` (Armor Class) is a required field.
    *   `initiativeModifier` is explicitly tracked.
    *   `damageFormula` assumes string-based dice notation (e.g., "1d8+3").

---

## 3. Comparative Research: System Archetypes

To understand the scope of adaptation, we analyzed three distinct "Archetypes" of RPG rulesets.

### Archetype A: The d20 Lineage (Current)
*   **Examples:** D&D 3.5/5e, Pathfinder 1e/2e, Starfinder.
*   **Core Mechanic:** `d20 + Mod vs Target Number`.
*   **Current Fit:** 100%. The system handles this natively.
*   **Adaptation Effort:** Low. (Pathfinder 2e would only require changing the Critical Hit logic logic).

### Archetype B: The d100 / Percentile (Simulationist)
*   **Examples:** Call of Cthulhu (CoC), RuneQuest, Warhammer Fantasy (WFRP).
*   **Core Mechanic:** `d100 <= Skill Level`.
    *   *Degrees of Success:* Regular, Hard (1/2 skill), Extreme (1/5 skill).
    *   *Opposed Rolls:* Compare success levels.
*   **Friction:** The engine has no concept of "Marginal Success" or "Degrees" in the basic `ActionResult`. AC does not exist; instead, players might Dodge or Parry as a Reaction (changing the target number dynamically).
*   **Adaptation Effort:** Medium. Requires a fundamental change to how math is processed.

### Archetype C: The Dice Pool (Narrative/Cinema)
*   **Examples:** Shadowrun (d6 pool), World of Darkness (d10 pool), Blades in the Dark.
*   **Core Mechanic:** Roll `Attribute + Skill` number of dice. Count dice meeting a threshold (e.g., 5 or 6).
    *   *Shadowrun:* Net hits (Hits - Opponent Hits) = Outcome.
    *   *Glitch:* Rolling more ones than hits.
*   **Friction:** High. The concept of "Advantage" (rolling 2 keep 1) does not translate. "Modifiers" usually add *dice*, not *integers*.
*   **Adaptation Effort:** High. Requires a fundamental change to how math is processed.

---

## 4. Proposed Architecture: The "Rule Kernel" Strategy

To support multiple worlds, we cannot simply "tweak" `CombatEngineV2`. We must abstract it.

### The "Plugin" Architecture
We move from a single class to an Interface-Implementation pattern.

#### New Core Interface: `IRulesEngine`
```typescript
interface IRulesEngine {
  // How do we decide who goes first?
  calculateInitiative(entities: Entity[]): TurnOrder;
  
  // Generic Action Resolution
  resolveAction(action: ActionPayload, state: BattleState): ActionResult;
  
  // Data Validation
  validateEntity(entity: any): boolean;
}
```

#### Implementations (Adapters)
1.  **`DnD5eSystem`**: The current code, wrapped in the interface.
2.  **`CoC7eSystem`**:
    *   `resolveAction`: Runs `d100` checks.
    *   `calculateInitiative`: Static DEX ranking (mostly).
3.  **`Shadowrun6eSystem`**:
    *   `resolveAction`: Rolls generic pools. Handles soak tests.

### Implementation Steps

#### Step 1: Data Abstraction (The "property bag")
Currently, schemas are strict (`baseAC`, `hp`). We need a flexible schema.
*   **Change:** Move specific stats into a `systemData` JSON blob.
*   **Common:** Keep `name`, `id`, `portrait`.
*   **Flexible:**
    *   D&D: `{ systemData: { ac: 15, hp: 30, str: 18 } }`
    *   CoC: `{ systemData: { sanity: 45, majorWound: false, skills: { firearms: 60 } } }`

#### Step 2: Extract the "Resolver"
Move the `processAttack` logic out of `CombatEngineV2`.
*   Pass a `ResolutionStrategy` into the engine constructor.
*   The Engine handles state (logging, turn index, history).
*   The Strategy handles math (did it hit? how much damage?).

#### Step 3: Frontend Agnosticism
The UI currently shows "AC" and "HP" explicitly.
*   **Change:** UI components should map keys based on system config, or receive "Display Stats" from the backend directly.
    *   *Backend sends:* `[{ label: "Sanity", value: 45, max: 99 }]`
    *   *Frontend renders:* Generic stat bars.

---

## 5. Feasibility Conclusion & Roadmap

**Verdict:**
Adaptation is **Complex but Feasible**. It requires a "Foundational Refactor" (Phase 6 or 7) before any new systems can be added.

**Estimated Effort:**
1.  **Refactor Engine to Interface:** 2-3 Days.
    *   Split `CombatEngineV2` into `CoreEngine` (State Machine) and `DnD5eRules` (Math).
2.  **Generic Data Layer:** 1-2 Days.
    *   Migrate DB schema to use `status` columns and `jsonb` for stats.
3.  **New System Pilot (e.g., Call of Cthulhu):** 3-4 Days.
    *   Implement `CoC7eRules`.
    *   Update UI to handle percentile rolls.

**Recommendation:**
Finish the current D&D 5e Combat Engine (Phase 5). Ensure it is stable. Then, treat "Multi-System Support" as a major V3.0 release, as it touches the database, engine, and UI core.
