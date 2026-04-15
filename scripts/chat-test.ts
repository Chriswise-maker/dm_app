/**
 * Chat Test Harness — programmatic testing of LLM chat output
 *
 * Tests the full message-send pipeline (context gathering, LLM call, combat
 * detection, response) without the browser UI. Works against a running dev
 * server.
 *
 * **LLM usage (Tier 1 vs Tier 2):**
 * - This script hits `messages.send` on a live server → **real LLM calls** for DM
 *   chat, combat narrator, enemy AI, parser, etc. (same as the UI). Use for
 *   local/nightly runs with API keys; not a substitute for CI-only mocks.
 * - **No real LLM:** run Vitest integration tests instead, e.g.
 *   `server/combat/__tests__/message-send-pipeline.test.ts` (mocks LLM + DB).
 *
 * Usage:
 *   # Start dev server first: pnpm dev
 *
 *   # Interactive single message:
 *   npx tsx scripts/chat-test.ts --session 1 --character 1 --message "I attack the goblin"
 *
 *   # Run a scenario file (sequence of messages with assertions):
 *   npx tsx scripts/chat-test.ts --scenario scripts/scenarios/basic-chat.json
 *
 *   # Stream mode (watch SSE tokens in real-time):
 *   npx tsx scripts/chat-test.ts --stream --session 1 --character 1 --message "Hello"
 *
 *   # Preview context only (see what the LLM would receive, no actual call):
 *   npx tsx scripts/chat-test.ts --preview --session 1 --character 1 --message "Hello"
 */

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";

// ── Types ────────────────────────────────────────────────────────────────────

interface MessageSendResult {
  response: string;
  combatTriggered: boolean;
  enemiesAdded: number;
}

/** HP assertion — at least one of min/max/exact must be specified */
interface HpAssertion {
  min?: number;
  max?: number;
  exact?: number;
}

/** State-based combat assertions (checked via combatV2.getState) */
interface ExpectCombat {
  /** Expected combat phase */
  phase?: string;
  /** Entity name (case-insensitive) whose turn it should be */
  currentEntity?: string;
  /** HP bounds per entity name (case-insensitive key) */
  hp?: Record<string, HpAssertion>;
  /** Expected round number */
  round?: number;
  /** Expected turnIndex */
  turnIndex?: number;
  /** Pending roll type (or null if none expected) */
  pendingRollType?: string | null;
  /** Entity count assertions */
  entityCount?: { min?: number; max?: number; exact?: number };
}

/** Roll to submit after a message (simulates visual dice roller) */
interface RollAction {
  rollType: "initiative" | "attack" | "damage" | "save" | "deathSave";
  rawDieValue: number;
  entityId?: string;
}

interface ScenarioStep {
  message: string;
  /** Which character sends this message (overrides scenario-level characterId) */
  characterId?: number;
  /** Optional assertions on the response text */
  expect?: {
    /** Response must contain this substring (case-insensitive) */
    contains?: string[];
    /** Response must NOT contain this substring */
    notContains?: string[];
    /** Combat should/shouldn't be triggered */
    combatTriggered?: boolean;
    /** Min response length */
    minLength?: number;
  };
  /** State-based combat assertions — checked after message + any async enemy turns settle */
  expectCombat?: ExpectCombat;
  /** Roll(s) to submit after this message (e.g. initiative, attack, damage) */
  rolls?: RollAction[];
  /** How long (ms) to wait/poll for combat state to settle before asserting. Default: 5000 */
  settleTimeoutMs?: number;
  /** Delay (ms) before sending this message. Useful after async enemy turns. Default: 0 */
  delayMs?: number;
}

interface Scenario {
  name: string;
  description?: string;
  sessionId: number;
  characterId: number;
  steps: ScenarioStep[];
}

// ── tRPC caller (via HTTP, superjson) ────────────────────────────────────────

async function trpcMutation<T>(
  path: string,
  input: unknown
): Promise<T> {
  const res = await fetch(`${BASE_URL}/api/trpc/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ json: input }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`tRPC ${path} failed (${res.status}): ${text}`);
  }

  const json = await res.json();
  // superjson wraps in { result: { data: { json: ... } } }
  return json?.result?.data?.json ?? json?.result?.data ?? json;
}

async function trpcQuery<T>(
  path: string,
  input: unknown
): Promise<T> {
  const encoded = encodeURIComponent(JSON.stringify({ json: input }));
  const res = await fetch(`${BASE_URL}/api/trpc/${path}?input=${encoded}`, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`tRPC ${path} failed (${res.status}): ${text}`);
  }

  const json = await res.json();
  return json?.result?.data?.json ?? json?.result?.data ?? json;
}

// ── Combat state queries ────────────────────────────────────────────────────

interface CombatStateResult {
  id: string;
  sessionId: number;
  phase: string;
  round: number;
  turnIndex: number;
  turnOrder: string[];
  entities: Array<{
    id: string;
    name: string;
    type: string;
    hp: number;
    maxHp: number;
    status: string;
    initiative: number;
  }>;
  /** Whose turn — entity name (matches combatV2.getState), not id */
  currentTurnEntity: string | null;
  /** Last events from engine (includes DAMAGE.targetId when present) */
  log: Array<{
    type: string;
    targetId?: string;
    actorId?: string;
    amount?: number;
    description?: string;
  }>;
  pendingRoll: {
    type: string;
    entityId: string;
    entityName: string;
  } | null;
  legalActions: string[];
  turnResources: { actionUsed: boolean; bonusActionUsed: boolean; movementUsed: boolean } | null;
}

async function getCombatState(sessionId: number): Promise<CombatStateResult | null> {
  try {
    return await trpcQuery<CombatStateResult>("combatV2.getState", { sessionId });
  } catch (err) {
    // No combat active — return null instead of throwing
    return null;
  }
}

interface SubmitRollResult {
  success: boolean;
  error?: string;
  logs: Array<{ type: string; message: string }>;
  newState: unknown;
  combatStarted?: boolean;
}

async function submitRoll(
  sessionId: number,
  rollType: string,
  rawDieValue: number,
  entityId?: string
): Promise<SubmitRollResult> {
  const input: Record<string, unknown> = { sessionId, rollType, rawDieValue };
  if (entityId) input.entityId = entityId;
  return trpcMutation<SubmitRollResult>("combatV2.submitRoll", input);
}

// ── Poll for combat state to settle ─────────────────────────────────────────

/**
 * Poll combatV2.getState until a condition is met or timeout.
 * Used after sending a message to wait for async enemy turns to finish.
 * Returns the final state, or null if combat is not active.
 */
async function pollCombatState(
  sessionId: number,
  condition: (state: CombatStateResult) => boolean,
  timeoutMs: number = 5000,
  intervalMs: number = 300
): Promise<CombatStateResult | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const state = await getCombatState(sessionId);
    if (!state) return null;
    if (condition(state)) return state;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  // Timeout — return whatever state we have
  return getCombatState(sessionId);
}

/**
 * Wait for combat state to settle after a message send.
 * "Settled" = not waiting for an enemy AI loop to finish.
 * In practice: phase is not rapidly changing (poll twice, same state).
 */
async function waitForSettle(sessionId: number, timeoutMs: number = 5000): Promise<CombatStateResult | null> {
  let prev: CombatStateResult | null = null;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const state = await getCombatState(sessionId);
    if (!state) return null;
    // Consider settled if phase + turnIndex match two polls in a row
    if (prev && prev.phase === state.phase && prev.turnIndex === state.turnIndex) {
      return state;
    }
    prev = state;
    await new Promise(r => setTimeout(r, 400));
  }
  return getCombatState(sessionId);
}

// ── Assert combat state ─────────────────────────────────────────────────────

function assertCombatState(state: CombatStateResult | null, expect: ExpectCombat): string[] {
  const failures: string[] = [];

  if (!state) {
    failures.push("Expected combat state but got null (no active combat)");
    return failures;
  }

  if (expect.phase !== undefined && state.phase !== expect.phase) {
    failures.push(`phase: expected "${expect.phase}", got "${state.phase}"`);
  }

  if (expect.round !== undefined && state.round !== expect.round) {
    failures.push(`round: expected ${expect.round}, got ${state.round}`);
  }

  if (expect.turnIndex !== undefined && state.turnIndex !== expect.turnIndex) {
    failures.push(`turnIndex: expected ${expect.turnIndex}, got ${state.turnIndex}`);
  }

  if (expect.currentEntity !== undefined) {
    // combatV2.getState returns currentTurnEntity as the entity's display name (not id)
    const raw = state.currentTurnEntity;
    const currentName = raw?.trim() || "(none)";
    if (currentName.toLowerCase() !== expect.currentEntity.toLowerCase()) {
      failures.push(`currentEntity: expected "${expect.currentEntity}", got "${currentName}"`);
    }
  }

  if (expect.hp) {
    for (const [name, assertion] of Object.entries(expect.hp)) {
      const entity = state.entities.find(e => e.name.toLowerCase() === name.toLowerCase());
      if (!entity) {
        failures.push(`hp["${name}"]: entity not found in combat`);
        continue;
      }
      if (assertion.min !== undefined && entity.hp < assertion.min) {
        failures.push(`hp["${name}"]: expected >= ${assertion.min}, got ${entity.hp}`);
      }
      if (assertion.max !== undefined && entity.hp > assertion.max) {
        failures.push(`hp["${name}"]: expected <= ${assertion.max}, got ${entity.hp}`);
      }
      if (assertion.exact !== undefined && entity.hp !== assertion.exact) {
        failures.push(`hp["${name}"]: expected exactly ${assertion.exact}, got ${entity.hp}`);
      }
    }
  }

  if (expect.pendingRollType !== undefined) {
    const actual = state.pendingRoll?.type ?? null;
    if (expect.pendingRollType !== actual) {
      failures.push(`pendingRollType: expected ${JSON.stringify(expect.pendingRollType)}, got ${JSON.stringify(actual)}`);
    }
  }

  if (expect.entityCount) {
    const count = state.entities.length;
    const ec = expect.entityCount;
    if (ec.min !== undefined && count < ec.min) {
      failures.push(`entityCount: expected >= ${ec.min}, got ${count}`);
    }
    if (ec.max !== undefined && count > ec.max) {
      failures.push(`entityCount: expected <= ${ec.max}, got ${count}`);
    }
    if (ec.exact !== undefined && count !== ec.exact) {
      failures.push(`entityCount: expected exactly ${ec.exact}, got ${count}`);
    }
  }

  return failures;
}

// ── Cross-check narrator text against combat state ──────────────────────────

/**
 * Scan the DM response for **claimed current HP** and cross-check against engine state.
 * Catches BUG-010: narrator says "down to 38 HP" when state is 16/28 — including when
 * the prose only says "you" (no character name), by using the last DAMAGE.targetId
 * from combat log.
 */
function crossCheckNarratorHP(response: string, state: CombatStateResult | null): string[] {
  if (!state || state.entities.length === 0) return [];
  const failures: string[] = [];
  const lower = response.toLowerCase();

  const logs = state.log ?? [];
  let lastPlayerDamageTarget: {
    id: string;
    name: string;
    hp: number;
    maxHp: number;
  } | null = null;
  for (let i = logs.length - 1; i >= 0; i--) {
    const e = logs[i];
    if (e?.type === "DAMAGE" && e.targetId) {
      const ent = state.entities.find((x) => x.id === e.targetId);
      if (ent && ent.type === "player") {
        lastPlayerDamageTarget = {
          id: ent.id,
          name: ent.name,
          hp: ent.hp,
          maxHp: ent.maxHp,
        };
        break;
      }
    }
  }

  const players = state.entities.filter((e) => e.type === "player");

  // Subject for second-person "you" / "your" lines: last PC that took damage, or sole PC
  const youSubject =
    lastPlayerDamageTarget ??
    (players.length === 1
      ? {
          id: players[0].id,
          name: players[0].name,
          hp: players[0].hp,
          maxHp: players[0].maxHp,
        }
      : null);

  const usesYou = /\byou\b|\byour\b/i.test(response);

  // 1) Named entity: impossible remaining HP (> max) when that name appears in the reply
  for (const entity of state.entities) {
    const nameLower = entity.name.toLowerCase();
    const first = nameLower.split(" ")[0];
    if (!lower.includes(nameLower) && !lower.includes(first)) continue;

    for (const m of response.matchAll(
      /(?:down to|reduced to|now at|left with)\s+(\d+)\s*(?:hp|hit points|health)/gi
    )) {
      const n = parseInt(m[1], 10);
      if (!isNaN(n) && n > entity.maxHp) {
        failures.push(
          `[narrator-hp] "${entity.name}": narrator claims ${n} HP but maxHp is ${entity.maxHp} (engine: ${entity.hp}/${entity.maxHp})`
        );
      }
    }
  }

  // 2) Second-person: compare "down to N" / "N/M HP" to engine when we know who was hit
  if (youSubject && usesYou && (lastPlayerDamageTarget !== null || players.length === 1)) {
    const sub = youSubject;
    for (const m of response.matchAll(
      /(?:down to|reduced to|now at|left with)\s+(\d+)\s*(?:hp|hit points|health)/gi
    )) {
      const n = parseInt(m[1], 10);
      if (isNaN(n)) continue;
      if (n > sub.maxHp) {
        failures.push(
          `[narrator-hp] "you" narrative claims ${n} HP > ${sub.name}'s max ${sub.maxHp}`
        );
      } else if (n !== sub.hp) {
        failures.push(
          `[narrator-hp] "you" narrative claims ${n} HP remaining but engine has ${sub.name} at ${sub.hp}/${sub.maxHp}`
        );
      }
    }
    for (const m of response.matchAll(/(\d+)\s*\/\s*(\d+)\s*(?:hp|hit points)/gi)) {
      const cur = parseInt(m[1], 10);
      const max = parseInt(m[2], 10);
      if (isNaN(cur) || isNaN(max)) continue;
      if (max !== sub.maxHp) continue;
      if (cur !== sub.hp) {
        failures.push(
          `[narrator-hp] "you" narrative shows ${cur}/${max} HP but engine has ${sub.name} at ${sub.hp}/${sub.maxHp}`
        );
      }
    }
  }

  return failures;
}

// ── Send message (non-streaming, via tRPC) ───────────────────────────────────

async function sendMessage(
  sessionId: number,
  characterId: number,
  message: string
): Promise<MessageSendResult> {
  return trpcMutation<MessageSendResult>("messages.send", {
    sessionId,
    characterId,
    message,
  });
}

// ── Send message (streaming, via SSE) ────────────────────────────────────────

async function sendMessageStream(
  sessionId: number,
  characterId: number,
  message: string
): Promise<MessageSendResult> {
  const res = await fetch(`${BASE_URL}/api/chat/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, characterId, message }),
  });

  if (!res.ok) {
    throw new Error(`Stream request failed (${res.status})`);
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let fullResponse = "";
  let result: MessageSendResult | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    const lines = chunk.split("\n");

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = JSON.parse(line.slice(6));

      if (data.type === "token") {
        process.stdout.write(data.text);
        fullResponse += data.text;
      } else if (data.type === "done") {
        result = {
          response: data.response ?? fullResponse,
          combatTriggered: data.combatTriggered ?? false,
          enemiesAdded: data.enemiesAdded ?? 0,
        };
      } else if (data.type === "error") {
        throw new Error(`Stream error: ${data.message}`);
      }
    }
  }

  console.log(""); // newline after streaming output
  return result ?? { response: fullResponse, combatTriggered: false, enemiesAdded: 0 };
}

// ── Preview context (no LLM call) ────────────────────────────────────────────

async function previewContext(
  sessionId: number,
  characterId: number,
  message?: string
): Promise<void> {
  const ctx = await trpcQuery<{
    systemPrompt: string;
    enrichedPrompt: string;
    databaseState: unknown;
  }>("messages.previewContext", { sessionId, characterId, message });

  console.log("── System Prompt ──");
  console.log(ctx.systemPrompt);
  console.log("\n── Enriched User Prompt ──");
  console.log(ctx.enrichedPrompt);
  console.log("\n── Database State ──");
  console.log(JSON.stringify(ctx.databaseState, null, 2));
}

// ── Scenario runner ──────────────────────────────────────────────────────────

async function runScenario(scenario: Scenario): Promise<boolean> {
  console.log(`\n=== Scenario: ${scenario.name} ===`);
  if (scenario.description) console.log(`  ${scenario.description}`);
  console.log(`Session: ${scenario.sessionId}, Character: ${scenario.characterId}`);
  console.log(`Steps: ${scenario.steps.length}\n`);

  // Reset session (clears messages, combat state, and context) so each run starts fresh
  try {
    await trpcMutation("sessions.reset", { sessionId: scenario.sessionId });
    console.log("  (Reset session — messages, combat state, and context cleared)\n");
  } catch (err) {
    console.warn("  (Session reset failed — continuing anyway):", err);
  }

  let allPassed = true;

  for (let i = 0; i < scenario.steps.length; i++) {
    const step = scenario.steps[i];
    const charId = step.characterId ?? scenario.characterId;
    console.log(`── Step ${i + 1}/${scenario.steps.length}: "${step.message}" ──`);

    // Optional delay before sending
    if (step.delayMs && step.delayMs > 0) {
      console.log(`  (waiting ${step.delayMs}ms before sending...)`);
      await new Promise(r => setTimeout(r, step.delayMs));
    }

    const start = Date.now();
    const result = await sendMessage(
      scenario.sessionId,
      charId,
      step.message
    );
    const elapsed = Date.now() - start;

    console.log(`  Response (${elapsed}ms, ${result.response.length} chars):`);
    const preview =
      result.response.length > 200
        ? result.response.slice(0, 200) + "..."
        : result.response;
    console.log(`  ${preview}\n`);

    if (result.combatTriggered) {
      console.log(`  Combat triggered! Enemies added: ${result.enemiesAdded}`);
    }

    // Run text assertions
    const failures: string[] = [];

    if (step.expect) {
      const lower = result.response.toLowerCase();

      if (step.expect.contains) {
        for (const substr of step.expect.contains) {
          if (!lower.includes(substr.toLowerCase())) {
            failures.push(`[text] Expected response to contain "${substr}"`);
          }
        }
      }

      if (step.expect.notContains) {
        for (const substr of step.expect.notContains) {
          if (lower.includes(substr.toLowerCase())) {
            failures.push(`[text] Expected response NOT to contain "${substr}"`);
          }
        }
      }

      if (step.expect.combatTriggered !== undefined) {
        if (result.combatTriggered !== step.expect.combatTriggered) {
          failures.push(
            `[text] Expected combatTriggered=${step.expect.combatTriggered}, got ${result.combatTriggered}`
          );
        }
      }

      if (step.expect.minLength && result.response.length < step.expect.minLength) {
        failures.push(
          `[text] Expected min length ${step.expect.minLength}, got ${result.response.length}`
        );
      }
    }

    // Submit rolls if specified (e.g. initiative, attack, damage)
    if (step.rolls && step.rolls.length > 0) {
      for (const roll of step.rolls) {
        console.log(`  Submitting ${roll.rollType} roll: d=${roll.rawDieValue}${roll.entityId ? ` entity=${roll.entityId}` : ""}`);
        try {
          const rollResult = await submitRoll(
            scenario.sessionId,
            roll.rollType,
            roll.rawDieValue,
            roll.entityId
          );
          if (!rollResult.success) {
            failures.push(`[roll] ${roll.rollType} failed: ${rollResult.error}`);
          } else {
            console.log(`    Roll accepted. Logs: ${rollResult.logs?.length ?? 0}`);
            if (rollResult.combatStarted) console.log(`    Combat started!`);
          }
        } catch (err: any) {
          failures.push(`[roll] ${roll.rollType} threw: ${err.message}`);
        }
      }
    }

    // State-based combat assertions
    if (step.expectCombat) {
      const settleTimeout = step.settleTimeoutMs ?? 5000;
      console.log(`  Waiting for combat state to settle (max ${settleTimeout}ms)...`);
      const combatState = await waitForSettle(scenario.sessionId, settleTimeout);
      const stateFailures = assertCombatState(combatState, step.expectCombat);
      if (stateFailures.length > 0) {
        for (const f of stateFailures) failures.push(`[state] ${f}`);
        // Dump state on failure for diagnostics
        if (combatState) {
          console.log(`  --- Combat state snapshot ---`);
          console.log(`    phase=${combatState.phase} round=${combatState.round} turnIndex=${combatState.turnIndex}`);
          console.log(`    currentTurn=${combatState.currentTurnEntity}`);
          console.log(`    entities: ${combatState.entities.map(e => `${e.name}(${e.hp}/${e.maxHp} ${e.status})`).join(", ")}`);
          console.log(`    pendingRoll=${combatState.pendingRoll ? combatState.pendingRoll.type + " for " + combatState.pendingRoll.entityName : "none"}`);
          console.log(`  --- End state snapshot ---`);
        }
      } else {
        console.log(`  Combat state: PASS`);
      }
    }

    // Automatic narrator-vs-state cross-check (always runs if combat is active)
    // Catches BUG-010 class: narrator hallucinating HP values
    if (result.response.length > 0) {
      const crossCheckState = await getCombatState(scenario.sessionId);
      const hpWarnings = crossCheckNarratorHP(result.response, crossCheckState);
      if (hpWarnings.length > 0) {
        for (const w of hpWarnings) {
          console.log(`  WARNING: ${w}`);
          failures.push(w);
        }
      }
    }

    // Report
    if (failures.length > 0) {
      console.log(`  FAIL:`);
      for (const f of failures) console.log(`    - ${f}`);
      if (result.response.length > 200) {
        console.log(`\n  --- Full DM response (for diagnostics) ---`);
        console.log(`  ${result.response}`);
        console.log(`  --- End of response ---\n`);
      }
      allPassed = false;
    } else if (step.expect || step.expectCombat) {
      console.log(`  PASS`);
    }

    console.log("");
  }

  console.log(allPassed ? "=== ALL PASSED ===" : "=== SOME STEPS FAILED ===");
  return allPassed;
}

// ── CLI ──────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  const flag = (name: string): boolean => args.includes(`--${name}`);
  const arg = (name: string): string | undefined => {
    const idx = args.indexOf(`--${name}`);
    return idx >= 0 ? args[idx + 1] : undefined;
  };

  // Scenario mode
  const scenarioPath = arg("scenario");
  if (scenarioPath) {
    const fs = await import("fs");
    const scenario: Scenario = JSON.parse(fs.readFileSync(scenarioPath, "utf-8"));
    const passed = await runScenario(scenario);
    process.exit(passed ? 0 : 1);
  }

  // Single message mode
  const sessionId = Number(arg("session") ?? "1");
  const characterId = Number(arg("character") ?? "1");
  const message = arg("message");

  if (!message) {
    console.log(`Chat Test Harness — test LLM output without the UI

Usage:
  # Single message (non-streaming):
  npx tsx scripts/chat-test.ts --session 1 --character 1 --message "I search the room"

  # Streaming (watch tokens arrive):
  npx tsx scripts/chat-test.ts --stream --session 1 --character 1 --message "Hello"

  # Preview LLM context (no actual call):
  npx tsx scripts/chat-test.ts --preview --session 1 --character 1

  # Run a scenario file:
  npx tsx scripts/chat-test.ts --scenario scripts/scenarios/basic-chat.json

Options:
  --session N      Session ID (default: 1)
  --character N    Character ID (default: 1)
  --message "..."  The player message to send
  --stream         Use SSE streaming endpoint
  --preview        Show LLM context without calling the model
  --scenario PATH  Run a JSON scenario file

Environment:
  BASE_URL         Server URL (default: http://localhost:3000)
`);
    process.exit(0);
  }

  // Preview mode
  if (flag("preview")) {
    await previewContext(sessionId, characterId, message);
    process.exit(0);
  }

  // Stream or non-stream
  const start = Date.now();
  const result = flag("stream")
    ? await sendMessageStream(sessionId, characterId, message)
    : await sendMessage(sessionId, characterId, message);
  const elapsed = Date.now() - start;

  if (!flag("stream")) {
    console.log(result.response);
  }

  console.log(`\n── Meta ──`);
  console.log(`  Time: ${elapsed}ms`);
  console.log(`  Length: ${result.response.length} chars`);
  console.log(`  Combat triggered: ${result.combatTriggered}`);
  if (result.enemiesAdded > 0) {
    console.log(`  Enemies added: ${result.enemiesAdded}`);
  }
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
