/**
 * Ensures DAMAGE log descriptions expose (current/max HP) in a form the narrator
 * regex can parse — see combat-narrator formatLogEntry DAMAGE case (BUG-010).
 */
import { describe, it, expect } from 'vitest';

describe('DAMAGE log HP suffix (engine → narrator)', () => {
  const extractHpFromDescription = (description: string) =>
    description.match(/\((\d+)\/(\d+)\s*HP(?: remaining)?\)/);

  it('parses "(16/28 HP remaining)" from engine-style descriptions', () => {
    const desc =
      'Desperate Leader deals 12 slashing damage to Silas Gravemourn! (16/28 HP remaining)';
    const m = extractHpFromDescription(desc);
    expect(m?.[1]).toBe('16');
    expect(m?.[2]).toBe('28');
  });

  it('parses "(16/28 HP)" without remaining', () => {
    const desc = 'Goblin deals 4 slashing to Mira! (7/11 HP)';
    const m = extractHpFromDescription(desc);
    expect(m?.[1]).toBe('7');
    expect(m?.[2]).toBe('11');
  });
});
