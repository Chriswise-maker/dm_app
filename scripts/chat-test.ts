/**
 * Chat Test Harness — programmatic testing of LLM chat output
 *
 * Tests the full message-send pipeline (context gathering, LLM call, combat
 * detection, response) without the browser UI. Works against a running dev
 * server.
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

interface ScenarioStep {
  message: string;
  /** Optional assertions on the response */
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
}

interface Scenario {
  name: string;
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
  console.log(`Session: ${scenario.sessionId}, Character: ${scenario.characterId}`);
  console.log(`Steps: ${scenario.steps.length}\n`);

  let allPassed = true;

  for (let i = 0; i < scenario.steps.length; i++) {
    const step = scenario.steps[i];
    console.log(`── Step ${i + 1}/${scenario.steps.length}: "${step.message}" ──`);

    const start = Date.now();
    const result = await sendMessage(
      scenario.sessionId,
      scenario.characterId,
      step.message
    );
    const elapsed = Date.now() - start;

    console.log(`  Response (${elapsed}ms, ${result.response.length} chars):`);
    // Print first 200 chars as preview
    const preview =
      result.response.length > 200
        ? result.response.slice(0, 200) + "..."
        : result.response;
    console.log(`  ${preview}\n`);

    if (result.combatTriggered) {
      console.log(`  Combat triggered! Enemies added: ${result.enemiesAdded}`);
    }

    // Run assertions
    if (step.expect) {
      const failures: string[] = [];
      const lower = result.response.toLowerCase();

      if (step.expect.contains) {
        for (const substr of step.expect.contains) {
          if (!lower.includes(substr.toLowerCase())) {
            failures.push(`Expected response to contain "${substr}"`);
          }
        }
      }

      if (step.expect.notContains) {
        for (const substr of step.expect.notContains) {
          if (lower.includes(substr.toLowerCase())) {
            failures.push(`Expected response NOT to contain "${substr}"`);
          }
        }
      }

      if (step.expect.combatTriggered !== undefined) {
        if (result.combatTriggered !== step.expect.combatTriggered) {
          failures.push(
            `Expected combatTriggered=${step.expect.combatTriggered}, got ${result.combatTriggered}`
          );
        }
      }

      if (step.expect.minLength && result.response.length < step.expect.minLength) {
        failures.push(
          `Expected min length ${step.expect.minLength}, got ${result.response.length}`
        );
      }

      if (failures.length > 0) {
        console.log(`  FAIL:`);
        for (const f of failures) console.log(`    - ${f}`);
        allPassed = false;
      } else {
        console.log(`  PASS`);
      }
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
