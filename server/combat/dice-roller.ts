/**
 * Dice Roller Utility
 * Deterministic dice rolling for D&D 5e combat system
 */

export class DiceRoller {
    /**
     * Roll a single die with specified number of sides
     */
    static rollDie(sides: number): number {
        return Math.floor(Math.random() * sides) + 1;
    }

    /**
     * Roll multiple dice and return individual results
     */
    static rollDice(sides: number, count: number): number[] {
        const results: number[] = [];
        for (let i = 0; i < count; i++) {
            results.push(this.rollDie(sides));
        }
        return results;
    }

    /**
     * Roll a d20
     */
    static rollD20(): number {
        return this.rollDie(20);
    }

    /**
     * Parse and roll a dice formula (e.g., "2d6+3", "1d8+5")
     * Returns the total rolled value
     */
    static roll(formula: string): number {
        const normalized = formula.trim().toLowerCase().replace(/\s/g, '');

        // Match patterns like "2d6+3", "1d8", "d20", "3d4-1"
        const match = normalized.match(/^(\d*)d(\d+)([+\-]\d+)?$/);

        if (!match) {
            throw new Error(`Invalid dice formula: ${formula}`);
        }

        const count = match[1] ? parseInt(match[1], 10) : 1;
        const sides = parseInt(match[2], 10);
        const modifier = match[3] ? parseInt(match[3], 10) : 0;

        if (count <= 0 || sides <= 0) {
            throw new Error(`Invalid dice count or sides: ${formula}`);
        }

        const rolls = this.rollDice(sides, count);
        const total = rolls.reduce((sum, roll) => sum + roll, 0) + modifier;

        return total;
    }

    /**
     * Roll with advantage (roll twice, take higher)
     */
    static rollWithAdvantage(formula: string): number {
        const roll1 = this.roll(formula);
        const roll2 = this.roll(formula);
        return Math.max(roll1, roll2);
    }

    /**
     * Roll with disadvantage (roll twice, take lower)
     */
    static rollWithDisadvantage(formula: string): number {
        const roll1 = this.roll(formula);
        const roll2 = this.roll(formula);
        return Math.min(roll1, roll2);
    }

    /**
     * Parse damage formula and roll
     * Same as roll() but more semantically clear for damage
     */
    static rollDamage(formula: string): number {
        return this.roll(formula);
    }
}
