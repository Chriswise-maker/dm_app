import fs from 'fs';
import path from 'path';

interface PackMeta {
  name: string;
  version: string;
  source?: string;
  categories: string[];
  overrides?: boolean;
}

interface ContentPack {
  meta: PackMeta;
  data: Map<string, any[]>;
}

export class ContentPackLoader {
  private packs: ContentPack[] = [];

  loadPack(packDir: string): void {
    const metaPath = path.join(packDir, 'pack.json');
    if (!fs.existsSync(metaPath)) return;

    const meta: PackMeta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    const data = new Map<string, any[]>();

    for (const category of meta.categories) {
      const filePath = path.join(packDir, `${category}.json`);
      if (fs.existsSync(filePath)) {
        data.set(category, JSON.parse(fs.readFileSync(filePath, 'utf-8')));
      }
    }

    this.packs.push({ meta, data });
  }

  getEntries(category: string): any[] {
    const seen = new Map<string, any>();

    for (const pack of this.packs) {
      const entries = pack.data.get(category);
      if (!entries) continue;
      for (const entry of entries) {
        const key = (entry.name as string).toLowerCase();
        if (pack.meta.overrides || !seen.has(key)) {
          seen.set(key, entry);
        }
      }
    }

    return Array.from(seen.values());
  }

  getEntry(category: string, name: string): any | null {
    const entries = this.getEntries(category);

    // Exact match
    const exact = entries.find((e) => e.name === name);
    if (exact) return exact;

    // Case-insensitive
    const lower = name.toLowerCase();
    const ci = entries.find((e) => (e.name as string).toLowerCase() === lower);
    return ci ?? null;
  }

  isLoaded(): boolean {
    return this.packs.length > 0;
  }
}
