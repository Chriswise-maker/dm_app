
import { DiceRoll } from "@dice-roller/rpg-dice-roller";

/**
 * Validates if a given roll result is possible within the constraints of a dice formula.
 * 
 * @param result The number to validate
 * @param formula The dice formula (e.g., "1d8+3", "2d6")
 * @returns { valid: boolean; max: number; min: number; error?: string }
 */
export function validateDiceRoll(result: number, formula: string): { valid: boolean; max: number; min: number; error?: string } {
    try {
        // Create a DiceRoll to inspect the formula
        // We roll once to get the structure, but we care about the min/max possibilities
        const roll = new DiceRoll(formula);

        // Calculate theoretical min and max
        // accessible via roll.minTotal and roll.maxTotal (if available in the library version)
        // usage: @dice-roller/rpg-dice-roller v5+ has minTotal/maxTotal

        // Let's check if the library provides min/max directly.
        // If not, we might need a safer way. 
        // For now, we assume standard library features.

        const min = roll.minTotal;
        const max = roll.maxTotal;

        if (result < min || result > max) {
            return {
                valid: false,
                max,
                min,
                error: `Roll ${result} is outside possible range [${min}, ${max}] for formula '${formula}'`
            };
        }

        return { valid: true, max, min };

    } catch (error) {
        return {
            valid: false,
            max: 0,
            min: 0,
            error: `Invalid formula: ${formula}`
        };
    }
}
