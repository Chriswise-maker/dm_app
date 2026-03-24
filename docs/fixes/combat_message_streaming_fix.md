# Combat Narrative & Streaming Fixes

This document covers two major rounds of fixes to the V2 Combat Engine message flow.

## Round 1: Enemy Narrative & Player Prompts
Previously, enemy turns only output a mechanical log message (e.g., "Attack roll 18... HIT"), and after enemy turns completed, the player was not prompted to act.

**Changes (`enemy-ai-controller.ts`)**:
1. **Added LLM Narrative**: After saving the immediate mechanical message for an enemy turn, we now trigger `generateCombatNarrative` from the player's perspective to narrate the action.
2. **Player Prompt**: When the AI loop finishes and it is the player's turn again, the engine automatically saves a DM message prompting the player: `*Player's turn!* What does Player do?`.
3. **Removed Dead Code**: Removed an unnecessary 200ms `setTimeout` delay between turns, relying on the natural pacing of the LLM generation.

## Round 2: Message Ordering & Queued Streaming
Previously, all enemy and player narrative messages arrived via DB polling simultaneously, appearing instantly on screen in the wrong order.

**Changes**:
1. **Ordering Fix (`routers.ts`)**: In `submitRoll`, the player's LLM narrative generation is now explicitly `await`ed before triggering the enemy AI loop. This ensures the player's narrative saves *before* any enemy mechanical messages are generated.
2. **Typewriter Reveal (`RevealText.tsx`)**: Created a new React component that takes a fully-formed string and reveals it character-by-character using a smooth, 60fps `requestAnimationFrame` loop at a ChatGPT-like speed (350 chars/sec).
3. **Reveal Queue (`ChatInterface.tsx`)**:
    - Incoming combat messages (picked up by the 2-second polling interval) are now tracked via `seenMessageIdsRef`.
    - New DM messages are pushed into a `revealQueue`.
    - Only the message at the head of the queue (`currentRevealId`) is allowed to render via `RevealText`.
    - Other pending messages in the queue return `null` (invisible) until their turn.
    - When a message finishes revealing, it calls `onRevealComplete`, popping itself from the queue and allowing the next message to start, creating a serialized, DM-like typing effect.
    - Faster streaming: Base SSE streaming speed for normal chat was also increased from 48 chars/sec to 350 chars/sec to match the new combat reveal speed.
