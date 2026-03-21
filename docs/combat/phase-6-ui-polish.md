# Phase 6: UI Polish, Streaming & Tiered Models

> **Status**: 📋 Future
>
> **When to do this:** Phase 6 is independent of the combat engine rework (Stages 1–7). You can finish the rework first and do Phase 6 later, or tackle it in parallel. No rework stage depends on anything below.

---

## 6.1 CombatSidebar Polish

- [ ] HP bars with gradient styling
- [ ] Turn indicator animations
- [ ] Confirm dialog before ending combat
- [ ] Responsive design improvements

---

## 6.2 Real Streaming (do first)

> **Goal:** Tokens flow to the player as the LLM generates them. Perceived latency drops immediately. Same model, same prompts — only transport changes.

### Problem today

| Path | What happens | User sees |
|------|-------------|-----------|
| Main chat (`messages.send`) | Server awaits **full** LLM response, returns it as one string | Dead air → wall of text |
| Combat narrative (attack/damage/roll) | Server awaits `generateCombatNarrative()`, returns it as one string | Same |
| Client (`ChatInterface.tsx`) | Receives complete string, **fakes** streaming with `setInterval` (2-5 chars every 30ms) | Looks like typing but only starts after full wait |

### What to change

**Server — streaming LLM support:**
- [ ] Add `stream: true` option to `invokeLLM` / `invokeLLMWithSettings` (`server/_core/llm.ts`, `server/llm-with-settings.ts`)
- [ ] Handle provider-specific streaming formats:
  - OpenAI: SSE with `data: {"choices":[{"delta":{"content":"..."}}]}` chunks
  - Anthropic: SSE with `content_block_delta` events
  - Google/Gemini: SSE with `candidates[0].content.parts[0].text` chunks
- [ ] Return an `AsyncIterable<string>` or `ReadableStream` from the invoke function when streaming is requested

**Server — streaming endpoints:**
- [ ] Add a streaming variant of `messages.send` (e.g. tRPC subscription, or a raw SSE endpoint at `/api/chat/stream`)
- [ ] `generateCombatNarrative` in `server/combat/combat-narrator.ts`: add a streaming variant that yields chunks instead of returning a full string
- [ ] Combat paths in `server/routers.ts` (`AWAIT_ATTACK_ROLL`, `AWAIT_DAMAGE_ROLL`, ACTIVE handler): use streaming narrative instead of awaiting full text

**Client — consume real stream:**
- [ ] Replace fake `setInterval` reveal in `ChatInterface.tsx` with real stream consumption (e.g. `EventSource`, `fetch` with `ReadableStream`, or tRPC subscription)
- [ ] Render tokens as they arrive; scroll-to-bottom on each chunk
- [ ] On stream end: persist final message, refetch, invalidate queries as before

**Keep working:**
- [ ] Activity log / combat sidebar still update from engine state (instant, no streaming needed)
- [ ] Error handling: if stream fails mid-way, show what was received + error toast
- [ ] Fallback: if streaming isn't available (e.g. provider doesn't support it), fall back to current await-then-return behavior

---

## 6.3 Tiered Models (do second)

> **Goal:** Use fast/cheap models where quality doesn't suffer; reserve the full model for open-ended DM storytelling. Reduces **actual** latency and API costs.

### Why this works

| LLM call | Current model | Output | Quality needs | Better fit |
|----------|--------------|--------|---------------|------------|
| **Enemy decision** (`enemy-ai-controller.ts`) | Same as main | 3 structured lines (`ACTION / TARGET_ID / FLAVOR`) | Low — structured, has fallback | Fast model (e.g. Gemini Flash, GPT-4o-mini, Haiku) |
| **Combat narrative** (`combat-narrator.ts`) | Same as main | 2-3 sentences, constrained by prompt rules | Medium — short, formulaic prose | Fast model |
| **Player action parsing** (`player-action-parser.ts`) | Same as main | JSON classification of intent | Low — structured, has fallback | Fast model |
| **Main DM chat** (`messages.send`, non-combat) | User's chosen model | Open-ended roleplay, world-building, story | **High** — this is the product | Keep current model |

### Latency impact (estimated per enemy turn)

| | Current (single model) | With tiered |
|---|---|---|
| Decision LLM | ~2-4s | ~0.3-0.5s |
| Narrative LLM | ~2-4s | ~0.5-1s |
| **Per enemy** | **~4-8s** | **~1-1.5s** |
| **3 enemies** | **~12-24s** | **~3-5s** |

### What to change

**Configuration — model tiers in settings:**
- [ ] Add model tier fields to `GameSettings` / user settings schema:
  ```
  combatDecisionModel: string   // fast model for enemy AI decisions
  combatNarrativeModel: string  // fast model for combat narrator
  chatModel: string             // main model for DM chat (existing)
  ```
- [ ] Provide sensible defaults per provider (e.g. OpenAI: `gpt-4o-mini` for combat, `gpt-4o` for chat)
- [ ] UI: optional settings page toggle (or just use defaults without exposing to user)

**Server — route calls to the right model:**
- [ ] `invokeLLMWithSettings`: accept an optional `tier` or `modelOverride` parameter
- [ ] `enemy-ai-controller.ts` → `executeEnemyTurn`: pass `combatDecisionModel` when calling LLM for enemy decision
- [ ] `combat-narrator.ts` → `generateCombatNarrative`: pass `combatNarrativeModel` when calling LLM for narrative
- [ ] `player-action-parser.ts` → `parsePlayerAction`: pass `combatDecisionModel` for intent classification
- [ ] `messages.send` (non-combat path): continue using `chatModel` (no change)

**Fallbacks and safety:**
- [ ] If a fast model returns unparseable output for enemy decisions, fall back to `scoreTargets()[0]` (deterministic — already implemented)
- [ ] If narrative model produces poor output, it's 2-3 sentences — acceptable; monitor and adjust prompt if needed
- [ ] Log which model was used per call for debugging (`[LLM] Using tier: combat-decision, model: gpt-4o-mini`)

**Cost savings:**
- [ ] Fast models are typically 10-20x cheaper per token than frontier models
- [ ] Combat generates many short LLM calls (decision + narrative per enemy, per turn) — this is where most token volume lives
- [ ] Main DM chat (fewer, longer calls) stays on the quality model — cost increase there is minimal

---

## 6.4 General UI Overhaul

- [ ] Theme consistency across components
- [ ] Mobile-friendly layouts
- [ ] Accessibility improvements (ARIA labels, keyboard nav)
- [ ] Loading states and error handling

---

## Key files reference

| File | Relevant to |
|------|-------------|
| `server/_core/llm.ts` | Streaming support, model routing |
| `server/llm-with-settings.ts` | Per-user model config, tier parameter |
| `server/routers.ts` | `messages.send`, `combatV2.submitRoll`, combat phase handlers |
| `server/combat/combat-narrator.ts` | `generateCombatNarrative` — streaming variant, model tier |
| `server/combat/enemy-ai-controller.ts` | `executeEnemyTurn` — decision model tier |
| `server/combat/player-action-parser.ts` | `parsePlayerAction` — decision model tier |
| `client/src/components/ChatInterface.tsx` | Replace fake streaming with real stream consumption |
