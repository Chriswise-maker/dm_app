# Chat Test Scenario Format (v2)

Scenarios are JSON files that drive the chat-test harness through a sequence of
player messages, optional dice rolls, and assertions on both response text and
combat state.

## Schema

```jsonc
{
  "name": "Human-readable name",
  "description": "Optional longer description",
  "sessionId": 1,        // DB session to use
  "characterId": 1,      // Default character (can be overridden per step)
  "steps": [
    {
      // The player message to send
      "message": "I attack the goblin!",

      // Override character for this step (multi-PC scenarios)
      "characterId": 2,

      // Delay before sending (ms) — useful after async enemy turns
      "delayMs": 1000,

      // Text-based assertions on the DM response
      "expect": {
        "contains": ["substring"],       // case-insensitive
        "notContains": ["error"],         // case-insensitive
        "combatTriggered": true,          // boolean
        "minLength": 50                   // minimum char count
      },

      // State-based combat assertions (via combatV2.getState)
      // Checked AFTER message send + settle wait + any rolls
      "expectCombat": {
        "phase": "ACTIVE",                           // CombatPhase enum value
        "currentEntity": "Silas Gravemourn",          // name (case-insensitive)
        "round": 1,
        "turnIndex": 0,
        "pendingRollType": "attack",                  // or null for "no pending roll"
        "hp": {
          "Silas Gravemourn": { "min": 1, "max": 30 },
          "Goblin": { "exact": 0 }
        },
        "entityCount": { "min": 3 }
      },

      // Dice rolls to submit after the message (simulates visual dice roller)
      "rolls": [
        {
          "rollType": "initiative",  // initiative | attack | damage | save | deathSave
          "rawDieValue": 15,         // the raw d20 (or damage die) result
          "entityId": "optional-entity-id"
        }
      ],

      // How long to wait for async enemy turns before asserting (default: 5000ms)
      "settleTimeoutMs": 8000
    }
  ]
}
```

## LLM usage (Tier 1 vs Tier 2)

- **Tier 1 — this harness:** Calls a running app’s `messages.send` → **real LLM**
  usage (DM, combat narrator, enemy AI, parser). Needs API keys and a dev server.
  Good for local/nightly regression on **real** behavior.
- **Tier 2 — no real LLM:** Run Vitest with mocks instead, e.g.
  `pnpm test -- server/combat/__tests__/message-send-pipeline.test.ts`. Use for
  cheap CI checks of **orchestration** (`executeMessageSend`, `runAILoop`,
  `syncCombatStateToDb` calls) without tokens.

The harness also runs **`crossCheckNarratorHP`** on each DM reply when combat is
active: it compares phrases like “down to N HP” and `N/M HP` to **engine state**
and the **last `DAMAGE` log** (so second-person “you” is checked even when the
text never says the PC’s name). `expectCombat.currentEntity` compares to
**`combatV2.getState`’s current turn name** (not entity id).

## Tips

- **Session/character IDs** must match your dev DB. Use `sessions.reset` (done
  automatically by the harness) to start fresh.
- **`expectCombat`** assertions are the primary signal — prefer them over
  text `contains` checks, which are fragile with LLM variance.
- **`rolls`** let you submit dice results programmatically. The harness calls
  `combatV2.submitRoll` for each entry in order.
- **`delayMs`** is useful when the previous step triggers an async enemy AI
  loop — give it time to finish before your next message.
- **Multi-PC scenarios** use per-step `characterId` overrides.
- Run with `DICE_SEED=15,10,8` env var for deterministic enemy rolls.

## Running

```bash
# Single scenario
npx tsx scripts/chat-test.ts --scenario scripts/scenarios/my-scenario.json

# With deterministic dice for enemy turns
DICE_SEED=15,10,8 pnpm dev &
npx tsx scripts/chat-test.ts --scenario scripts/scenarios/my-scenario.json
```

## Scenario library

See [`SCENARIOS_INDEX.md`](SCENARIOS_INDEX.md) for the full list of JSON scenarios (regression, arcs, mechanics, multi-PC, exploration).
