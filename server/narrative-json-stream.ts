/**
 * Extracts the "narrative" string value from a streaming JSON object while
 * the model is still generating (for json_object streaming).
 */

export function tryExtractNarrativeFromPartialJson(buffer: string): {
  narrativeSoFar: string;
  isComplete: boolean;
} {
  const key = '"narrative"';
  const idx = buffer.indexOf(key);
  if (idx === -1) return { narrativeSoFar: '', isComplete: false };

  let i = idx + key.length;
  while (i < buffer.length && /\s/.test(buffer[i]!)) i++;
  if (buffer[i] !== ':') return { narrativeSoFar: '', isComplete: false };
  i++;
  while (i < buffer.length && /\s/.test(buffer[i]!)) i++;
  if (buffer[i] !== '"') return { narrativeSoFar: '', isComplete: false };
  i++;

  let out = '';
  while (i < buffer.length) {
    const ch = buffer[i]!;
    if (ch === '\\') {
      if (i + 1 >= buffer.length) {
        return { narrativeSoFar: out, isComplete: false };
      }
      const next = buffer[i + 1]!;
      if (next === 'n') {
        out += '\n';
        i += 2;
        continue;
      }
      if (next === 't') {
        out += '\t';
        i += 2;
        continue;
      }
      if (next === 'r') {
        out += '\r';
        i += 2;
        continue;
      }
      if (next === '"') {
        out += '"';
        i += 2;
        continue;
      }
      if (next === '\\') {
        out += '\\';
        i += 2;
        continue;
      }
      out += next;
      i += 2;
      continue;
    }
    if (ch === '"') {
      return { narrativeSoFar: out, isComplete: true };
    }
    out += ch;
    i++;
  }
  return { narrativeSoFar: out, isComplete: false };
}

export function createNarrativeJsonEmitter() {
  let lastEmitted = '';
  return {
    appendAndExtractDelta(fullBuffer: string): string {
      const { narrativeSoFar } = tryExtractNarrativeFromPartialJson(fullBuffer);
      if (narrativeSoFar.length <= lastEmitted.length) return '';
      const delta = narrativeSoFar.slice(lastEmitted.length);
      lastEmitted = narrativeSoFar;
      return delta;
    },
    reset() {
      lastEmitted = '';
    },
  };
}
