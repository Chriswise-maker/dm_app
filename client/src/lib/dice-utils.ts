/**
 * Client-side dice formula parser and random number generator.
 *
 * Used by the visual DiceRoller component to:
 * 1. Parse formula strings like "2d6+3" into structured data
 * 2. Generate random rolls client-side for animation
 * 3. Calculate min/max ranges for validation display
 */

export interface ParsedFormula {
  count: number;    // number of dice (e.g., 2 in "2d6")
  sides: number;    // sides per die (e.g., 6 in "2d6")
  modifier: number; // flat modifier (e.g., 3 in "2d6+3", -1 in "1d8-1")
  formula: string;  // original formula string
}

export interface DiceResult {
  rolls: number[];    // individual die results, e.g. [3, 5]
  modifier: number;   // the flat modifier from the formula
  total: number;      // sum of all rolls + modifier
  formula: string;    // original formula
}

/**
 * Parse a dice formula string into its components.
 *
 * Supports: "1d20", "1d20+5", "2d6+3", "1d8-1", "2d8+3"
 * Returns null if the formula cannot be parsed.
 */
export function parseFormula(formula: string): ParsedFormula | null {
  const match = formula.trim().match(/^(\d+)d(\d+)([+-]\d+)?$/i);
  if (!match) return null;

  const count = parseInt(match[1], 10);
  const sides = parseInt(match[2], 10);
  const modifier = match[3] ? parseInt(match[3], 10) : 0;

  if (count < 1 || sides < 2) return null;

  return { count, sides, modifier, formula };
}

/**
 * Roll a dice formula, generating random values for each die.
 *
 * Returns null if the formula cannot be parsed.
 */
export function rollFormula(formula: string): DiceResult | null {
  const parsed = parseFormula(formula);
  if (!parsed) return null;

  const rolls: number[] = [];
  for (let i = 0; i < parsed.count; i++) {
    rolls.push(Math.floor(Math.random() * parsed.sides) + 1);
  }

  const total = rolls.reduce((sum, r) => sum + r, 0) + parsed.modifier;

  return {
    rolls,
    modifier: parsed.modifier,
    total,
    formula,
  };
}

/**
 * Get the minimum and maximum possible values for a formula.
 * Used for display and validation hints.
 */
export function getFormulaRange(formula: string): { min: number; max: number } | null {
  const parsed = parseFormula(formula);
  if (!parsed) return null;

  return {
    min: parsed.count * 1 + parsed.modifier,
    max: parsed.count * parsed.sides + parsed.modifier,
  };
}
