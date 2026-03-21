/**
 * Parses OpenAI-compatible chat completion SSE streams (Manus Forge, OpenAI, etc.)
 */

export async function* parseOpenAICompatibleSSEStream(
  body: ReadableStream<Uint8Array>
): AsyncGenerator<string, void, void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const parts = buffer.split(/\n\n/);
      buffer = parts.pop() ?? '';

      for (const part of parts) {
        for (const rawLine of part.split('\n')) {
          const line = rawLine.replace(/\r$/, '').trimEnd();
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trimStart();
          if (data === '[DONE]') return;
          try {
            const json = JSON.parse(data) as {
              choices?: Array<{ delta?: { content?: string | null } }>;
            };
            const delta = json.choices?.[0]?.delta?.content;
            if (typeof delta === 'string' && delta.length > 0) {
              yield delta;
            }
          } catch {
            // skip malformed chunk
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
