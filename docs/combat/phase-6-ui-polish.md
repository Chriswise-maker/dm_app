# Phase 6: UI Polish & Streaming

> **Status**: 📋 Future
>
> **When to do this:** Phase 6 is independent of the combat engine rework (Stages 1–7). You can finish the rework first and do Phase 6 later, or tackle it in parallel if you want better reply UX sooner. No rework stage depends on streaming or the architecture changes below.

---

## 6.1 CombatSidebar Polish

- [ ] HP bars with gradient styling
- [ ] Turn indicator animations
- [ ] Confirm dialog before ending combat
- [ ] Responsive design improvements

## 6.2 Narrative Streaming & Reply-Latency Architecture

> Addresses: replies taking long and then arriving all at once. Engine is fast; LLM round-trips and non-streaming responses cause the delay.

**Streaming (same model/prompt — no loss of authenticity):**
- [ ] Modify `generateCombatNarrative` to return a stream
- [ ] Update chat endpoint to use streaming response
- [ ] Frontend renders tokens as they arrive
- [ ] Activity log still shows instant engine results

**Return-engine-first, narrative async (optional / complementary):**
- [ ] Combat: return engine state + log immediately; run `generateCombatNarrative` in background
- [ ] When narrative is ready: push to client (e.g. subscription/SSE) or save to DB and invalidate/refetch
- [ ] User sees state update instantly; narrative appears when ready

**Progressive enemy output:**
- [ ] For each enemy turn: push or save that enemy's narrative as soon as it's ready (don't wait for all enemies in the round)
- [ ] Messages appear one-by-one instead of in a batch after a long pause

## 6.3 General UI Overhaul

- [ ] Theme consistency across components
- [ ] Mobile-friendly layouts
- [ ] Accessibility improvements (ARIA labels, keyboard nav)
- [ ] Loading states and error handling
