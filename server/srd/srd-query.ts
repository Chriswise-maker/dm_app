import type { ContentPackLoader } from './content-pack';

export function lookupByName(
  loader: ContentPackLoader,
  category: string,
  name: string,
): any | null {
  // Exact match via getEntry (handles exact + case-insensitive)
  const direct = loader.getEntry(category, name);
  if (direct) return direct;

  const entries = loader.getEntries(category);
  const lower = name.toLowerCase();

  // startsWith
  const starts = entries.filter((e) =>
    (e.name as string).toLowerCase().startsWith(lower),
  );
  if (starts.length > 0) {
    return starts.sort((a, b) => a.name.length - b.name.length)[0];
  }

  // includes
  const includes = entries.filter((e) =>
    (e.name as string).toLowerCase().includes(lower),
  );
  if (includes.length > 0) {
    return includes.sort((a, b) => a.name.length - b.name.length)[0];
  }

  // Try with spaces removed (e.g. "fire ball" → "fireball")
  const compacted = lower.replace(/\s+/g, '');
  if (compacted !== lower) {
    const compactIncludes = entries.filter((e) =>
      (e.name as string).toLowerCase().replace(/\s+/g, '').includes(compacted),
    );
    if (compactIncludes.length > 0) {
      return compactIncludes.sort((a, b) => a.name.length - b.name.length)[0];
    }
  }

  return null;
}

export function filterEntries(
  loader: ContentPackLoader,
  category: string,
  filters: {
    level?: number;
    class?: string;
    school?: string;
    cr?: { min?: number; max?: number };
    type?: string;
  },
): any[] {
  let entries = loader.getEntries(category);

  if (filters.level !== undefined) {
    entries = entries.filter((e) => e.level === filters.level);
  }
  if (filters.class) {
    const cls = filters.class.toLowerCase();
    entries = entries.filter(
      (e) =>
        Array.isArray(e.classes) &&
        e.classes.some((c: string) => c.toLowerCase() === cls),
    );
  }
  if (filters.school) {
    const school = filters.school.toLowerCase();
    entries = entries.filter(
      (e) => (e.school as string)?.toLowerCase() === school,
    );
  }
  if (filters.cr) {
    if (filters.cr.min !== undefined) {
      entries = entries.filter((e) => e.cr >= filters.cr!.min!);
    }
    if (filters.cr.max !== undefined) {
      entries = entries.filter((e) => e.cr <= filters.cr!.max!);
    }
  }
  if (filters.type) {
    const type = filters.type.toLowerCase();
    entries = entries.filter(
      (e) =>
        (e.type as string)?.toLowerCase() === type ||
        (e.category as string)?.toLowerCase() === type,
    );
  }

  return entries;
}

export function summarizeForLLM(entry: any, category: string): string {
  switch (category) {
    case 'spells':
      return summarizeSpell(entry);
    case 'monsters':
      return summarizeMonster(entry);
    case 'equipment':
      return summarizeEquipment(entry);
    default:
      return `${entry.name}: ${entry.description ?? JSON.stringify(entry)}`;
  }
}

function summarizeSpell(s: any): string {
  const parts: string[] = [];
  const levelStr =
    s.level === 0 ? `${s.school} cantrip` : `${ordinal(s.level)}-level ${s.school}`;
  parts.push(`${s.name} (${levelStr}).`);
  parts.push(`Range: ${s.range}.`);
  if (s.damageFormula) {
    parts.push(`Damage: ${s.damageFormula} ${s.damageType ?? ''}.`.trim());
  }
  if (s.healingFormula) {
    parts.push(`Healing: ${s.healingFormula}.`);
  }
  if (s.saveStat) {
    parts.push(`${s.saveStat.toUpperCase()} save (${s.saveEffect ?? 'negates'}).`);
  }
  if (s.isAreaEffect && s.areaSize) {
    parts.push(`Area: ${s.areaSize}.`);
  }
  if (s.requiresConcentration) {
    parts.push('Concentration.');
  }
  parts.push(`Duration: ${s.duration}.`);
  if (s.classes?.length) {
    parts.push(`Classes: ${s.classes.join(', ')}.`);
  }
  return parts.join(' ');
}

function summarizeMonster(m: any): string {
  const parts: string[] = [];
  parts.push(`${m.name} — ${m.size} ${m.type}, CR ${m.cr}.`);
  parts.push(`AC ${m.ac}, HP ${m.hp} (${m.hitDie}).`);
  if (m.speeds) {
    const speeds = Object.entries(m.speeds)
      .map(([k, v]) => `${k} ${v} ft.`)
      .join(', ');
    parts.push(`Speed: ${speeds}.`);
  }
  if (m.actions?.length) {
    const actionNames = m.actions.map((a: any) => a.name).join(', ');
    parts.push(`Actions: ${actionNames}.`);
  }
  return parts.join(' ');
}

function summarizeEquipment(e: any): string {
  const parts: string[] = [];
  parts.push(`${e.name} (${e.category}${e.subcategory ? `, ${e.subcategory}` : ''}).`);
  if (e.damage) {
    parts.push(`Damage: ${e.damage.formula} ${e.damage.type}.`);
  }
  if (e.ac) {
    parts.push(`AC: ${e.ac}.`);
  }
  if (e.cost) {
    parts.push(`Cost: ${e.cost.amount} ${e.cost.unit}.`);
  }
  if (e.weight) {
    parts.push(`Weight: ${e.weight} lb.`);
  }
  return parts.join(' ');
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
