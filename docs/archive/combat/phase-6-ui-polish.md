# Phase 6: UI Polish, Streaming & Tiered Models

> **Status**: 🟡 In progress — **§6.2 (real streaming + chat UX) implemented**; §6.1, §6.3, §6.4 still open.
>
> **When to do this:** Phase 6 is independent of the combat engine rework (Stages 1–7). You can finish the rework first and do Phase 6 later, or tackle it in parallel. No rework stage depends on anything below.

---

## 6.1 CombatSidebar Polish

- [ ] HP bars with gradient styling
- [ ] Turn indicator animations
- [ ] Confirm dialog before ending combat
- [ ] Responsive design improvements

---

## 6.2 Real Streaming (implemented)

> **Goal:** Tokens flow to the player as the LLM generates them. Perceived latency drops immediately. Same model, same prompts — only transport changes.

### What shipped

**Server**

- `POST /api/chat/stream` — SSE (`text/event-stream`): events `{"type":"token","text":"..."}` then `{"type":"done",...}` or `{"type":"error",...}`. Registered from `server/_core/index.ts` via `registerChatStreamRoute`.
- `server/message-send.ts` — `executeMessageSend(ctx, input, streamHooks?)` holds the former `messages.send` logic; optional `onNarrativeDelta` for token-sized narration during generation.
- `server/_core/llm-stream.ts` — OpenAI-compatible SSE parsing.
- `server/_core/llm.ts` — `invokeLLMStream()` (Forge/Manus, `stream: true`).
- `server/llm-with-settings.ts` — `invokeLLMWithSettingsStream()` (provider-specific streaming; Google may fall back to non-stream).
- `server/narrative-json-stream.ts` — partial JSON streaming for structured `json_object` narratives where applicable.
- `server/combat/combat-narrator.ts` — `generateCombatNarrativeStream()`; `generateCombatNarrative()` collects stream with non-stream fallback.
- `server/routers.ts` — `messages.send` delegates to `executeMessageSend` without streaming hooks (parity with prior behavior).

**Client (`client/src/components/ChatInterface.tsx`)**

- Sends chat via `fetch('/api/chat/stream', …)` and parses `data:` SSE lines (not `EventSource`, because POST body).
- **Reveal pacing:** tokens are buffered; the UI drains to the screen at a **steady ~48 characters per second** (`STREAM_REVEAL_CHARS_PER_SECOND`) using a fractional carry so frame timing stays even (no burst “catch-up” when the model sends large chunks).
- **While streaming:** DM bubble renders **plain text** (`whitespace-pre-wrap`) to avoid re-parsing markdown every tick; after `done`, `refetch()` restores persisted messages rendered with **Streamdown** as before.
- **Auto-scroll:** scrolls to bottom on new history / stream / pending user line **only while** the user is “following” the tail. If they scroll **more than ~72px** above the bottom (`SCROLL_STICK_BOTTOM_PX`), auto-scroll stops until they scroll back near the bottom. Switching **campaign (`sessionId`)** resets follow mode to on.

**Still non-streaming (by design unless extended)**

- Combat sidebar / activity log — engine state updates remain instant polling, not SSE.
- Some combat paths that don’t go through the chat stream helper may still use full-string narration from the server.

**Errors**

- Stream failures: toast + optional partial text; queries refetched in `finally` as before.

### Historical checklist (for reference)

<details>
<summary>Original §6.2 task list</summary>

- Server streaming LLM + SSE route — **done** (see files above).
- Client real stream consumption — **done** (`ChatInterface` + `/api/chat/stream`).
- Optional: stream combat roll follow-ups everywhere — partial / path-dependent.
- Fallback when streaming unavailable — **done** on server paths that use stream with non-stream fallback where implemented.

</details>

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
| `server/_core/llm.ts` | `invokeLLMStream` |
| `server/_core/llm-stream.ts` | OpenAI-style SSE parsing |
| `server/llm-with-settings.ts` | `invokeLLMWithSettingsStream`, providers |
| `server/narrative-json-stream.ts` | Streaming partial JSON for narrative fields |
| `server/chat-stream-route.ts` | `POST /api/chat/stream` |
| `server/message-send.ts` | `executeMessageSend`, optional `onNarrativeDelta` |
| `server/_core/index.ts` | Registers chat stream route |
| `server/routers.ts` | `messages.send` → `executeMessageSend` |
| `server/combat/combat-narrator.ts` | Stream + non-stream combat narrative |
| `client/src/components/ChatInterface.tsx` | SSE client, reveal pacing, stick-to-bottom scroll |
| `server/combat/enemy-ai-controller.ts` | `executeEnemyTurn` — decision model tier (future) |
| `server/combat/player-action-parser.ts` | `parsePlayerAction` — decision model tier (future) |
