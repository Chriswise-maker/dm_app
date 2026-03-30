import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { ContentPackLoader } from '../content-pack';
import { lookupByName, filterEntries, summarizeForLLM } from '../srd-query';

const SRD_DIR = path.resolve(__dirname, '../../../data/srd-2014');

describe('srd-query', () => {
  let loader: ContentPackLoader;

  beforeAll(() => {
    loader = new ContentPackLoader();
    loader.loadPack(SRD_DIR);
  });

  describe('lookupByName', () => {
    it('finds a spell by exact name', () => {
      const fireball = lookupByName(loader, 'spells', 'Fireball');
      expect(fireball).not.toBeNull();
      expect(fireball.level).toBe(3);
      expect(fireball.damageFormula).toBe('8d6');
    });

    it('finds a spell case-insensitively', () => {
      const fireball = lookupByName(loader, 'spells', 'fireball');
      expect(fireball).not.toBeNull();
      expect(fireball.level).toBe(3);
      expect(fireball.damageFormula).toBe('8d6');
    });

    it('finds a spell with fuzzy match (includes)', () => {
      const result = lookupByName(loader, 'spells', 'fire ball');
      expect(result).not.toBeNull();
      expect(result.name).toBe('Fireball');
    });

    it('finds a monster by name', () => {
      const goblin = lookupByName(loader, 'monsters', 'Goblin');
      expect(goblin).not.toBeNull();
      expect(goblin.cr).toBe(0.25);
      expect(goblin.ac).toBe(15);
    });

    it('returns null for non-existent entry', () => {
      expect(lookupByName(loader, 'spells', 'xyzzy')).toBeNull();
    });
  });

  describe('filterEntries', () => {
    it('filters spells by level and class', () => {
      const results = filterEntries(loader, 'spells', {
        level: 3,
        class: 'wizard',
      });
      const names = results.map((e) => e.name);
      expect(names).toContain('Fireball');
      expect(names).not.toContain('Cure Wounds');
    });

    it('filters monsters by CR range', () => {
      const results = filterEntries(loader, 'monsters', {
        cr: { max: 1 },
      });
      const names = results.map((e) => e.name);
      expect(names).toContain('Goblin');
      // Everything should be CR <= 1
      for (const entry of results) {
        expect(entry.cr).toBeLessThanOrEqual(1);
      }
    });
  });

  describe('custom override', () => {
    let tmpDir: string;
    let overrideLoader: ContentPackLoader;

    beforeAll(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'srd-test-'));
      fs.writeFileSync(
        path.join(tmpDir, 'pack.json'),
        JSON.stringify({
          name: 'Test Custom',
          version: '1.0.0',
          categories: ['spells'],
          overrides: true,
        }),
      );
      fs.writeFileSync(
        path.join(tmpDir, 'spells.json'),
        JSON.stringify([
          {
            name: 'Fireball',
            level: 3,
            school: 'evocation',
            damageFormula: '10d6',
            damageType: 'fire',
            classes: ['sorcerer', 'wizard'],
          },
        ]),
      );

      overrideLoader = new ContentPackLoader();
      overrideLoader.loadPack(SRD_DIR);
      overrideLoader.loadPack(tmpDir);
    });

    afterAll(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('custom pack overrides SRD entry by name', () => {
      const fireball = lookupByName(overrideLoader, 'spells', 'Fireball');
      expect(fireball).not.toBeNull();
      expect(fireball.damageFormula).toBe('10d6');
    });
  });

  describe('summarizeForLLM', () => {
    it('produces a summary with key spell info', () => {
      const fireball = lookupByName(loader, 'spells', 'Fireball');
      const summary = summarizeForLLM(fireball, 'spells');
      expect(summary).toContain('3rd-level');
      expect(summary).toContain('evocation');
      expect(summary).toContain('8d6');
      expect(summary).toContain('fire');
      expect(summary).toContain('DEX save');
    });
  });
});
