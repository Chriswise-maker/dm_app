import { describe, it, expect, vi, afterEach } from 'vitest';
import { DiceRoller } from '../dice-roller';

describe('DiceRoller', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rollD20 returns 1 when Math.random is 0', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    expect(DiceRoller.rollD20()).toBe(1);
  });

  it('rollD20 returns 20 when Math.random is just below 1', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999999);
    expect(DiceRoller.rollD20()).toBe(20);
  });

  it('roll parses implicit 1d20', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    expect(DiceRoller.roll('d20')).toBe(1);
  });

  it('roll applies modifier', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    // 1d6 + 3 => 1 + 3
    expect(DiceRoller.roll('1d6+3')).toBe(4);
  });

  it('roll rejects invalid formula', () => {
    expect(() => DiceRoller.roll('invalid')).toThrow(/Invalid dice formula/);
  });

  it('rollWithAdvantage takes max of two rolls', () => {
    let n = 0;
    vi.spyOn(Math, 'random').mockImplementation(() => {
      n += 1;
      return n === 1 ? 0 : 0.5;
    });
    const r = DiceRoller.rollWithAdvantage('d20');
    expect(r).toBeGreaterThanOrEqual(1);
    expect(r).toBeLessThanOrEqual(20);
  });
});
