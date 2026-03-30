import { DiceRoll } from "@dice-roller/rpg-dice-roller";

export interface CharacterLike {
    id: number;
    name: string;
    className: string;
    level: number;
    hpCurrent: number;
    hpMax: number;
    stats: string | { con?: number };
}

export interface CharacterResourceState {
    hitDieSize: number;
    hitDiceMax: number;
    hitDiceRemaining: number;
    spellSlotsMax: Record<string, number>;
    spellSlotsCurrent: Record<string, number>;
}

export interface PhaseAWorldState {
    characterResources?: Record<string, CharacterResourceState>;
    [key: string]: unknown;
}

type RollLike = { total: number };

const FULL_CASTER_SLOTS: Record<number, Record<string, number>> = {
    1: { "1": 2 }, 2: { "1": 3 }, 3: { "1": 4, "2": 2 }, 4: { "1": 4, "2": 3 },
    5: { "1": 4, "2": 3, "3": 2 }, 6: { "1": 4, "2": 3, "3": 3 },
    7: { "1": 4, "2": 3, "3": 3, "4": 1 }, 8: { "1": 4, "2": 3, "3": 3, "4": 2 },
    9: { "1": 4, "2": 3, "3": 3, "4": 3, "5": 1 }, 10: { "1": 4, "2": 3, "3": 3, "4": 3, "5": 2 },
    11: { "1": 4, "2": 3, "3": 3, "4": 3, "5": 2, "6": 1 }, 12: { "1": 4, "2": 3, "3": 3, "4": 3, "5": 2, "6": 1 },
    13: { "1": 4, "2": 3, "3": 3, "4": 3, "5": 2, "6": 1, "7": 1 }, 14: { "1": 4, "2": 3, "3": 3, "4": 3, "5": 2, "6": 1, "7": 1 },
    15: { "1": 4, "2": 3, "3": 3, "4": 3, "5": 2, "6": 1, "7": 1, "8": 1 }, 16: { "1": 4, "2": 3, "3": 3, "4": 3, "5": 2, "6": 1, "7": 1, "8": 1 },
    17: { "1": 4, "2": 3, "3": 3, "4": 3, "5": 2, "6": 1, "7": 1, "8": 1, "9": 1 },
    18: { "1": 4, "2": 3, "3": 3, "4": 3, "5": 3, "6": 1, "7": 1, "8": 1, "9": 1 },
    19: { "1": 4, "2": 3, "3": 3, "4": 3, "5": 3, "6": 2, "7": 1, "8": 1, "9": 1 },
    20: { "1": 4, "2": 3, "3": 3, "4": 3, "5": 3, "6": 2, "7": 2, "8": 1, "9": 1 },
};

const HALF_CASTER_SLOTS: Record<number, Record<string, number>> = {
    1: {}, 2: { "1": 2 }, 3: { "1": 3 }, 4: { "1": 3 },
    5: { "1": 4, "2": 2 }, 6: { "1": 4, "2": 2 }, 7: { "1": 4, "2": 3 }, 8: { "1": 4, "2": 3 },
    9: { "1": 4, "2": 3, "3": 2 }, 10: { "1": 4, "2": 3, "3": 2 }, 11: { "1": 4, "2": 3, "3": 3 }, 12: { "1": 4, "2": 3, "3": 3 },
    13: { "1": 4, "2": 3, "3": 3, "4": 1 }, 14: { "1": 4, "2": 3, "3": 3, "4": 1 }, 15: { "1": 4, "2": 3, "3": 3, "4": 2 }, 16: { "1": 4, "2": 3, "3": 3, "4": 2 },
    17: { "1": 4, "2": 3, "3": 3, "4": 3, "5": 1 }, 18: { "1": 4, "2": 3, "3": 3, "4": 3, "5": 1 }, 19: { "1": 4, "2": 3, "3": 3, "4": 3, "5": 2 }, 20: { "1": 4, "2": 3, "3": 3, "4": 3, "5": 2 },
};

const WARLOCK_SLOTS: Record<number, Record<string, number>> = {
    1: { "1": 1 }, 2: { "1": 2 }, 3: { "2": 2 }, 4: { "2": 2 }, 5: { "3": 2 },
    6: { "3": 2 }, 7: { "4": 2 }, 8: { "4": 2 }, 9: { "5": 2 }, 10: { "5": 2 },
    11: { "5": 3 }, 12: { "5": 3 }, 13: { "5": 3 }, 14: { "5": 3 }, 15: { "5": 3 },
    16: { "5": 3 }, 17: { "5": 4 }, 18: { "5": 4 }, 19: { "5": 4 }, 20: { "5": 4 },
};

function defaultRoll(formula: string): RollLike {
    return { total: new DiceRoll(formula).total };
}

function normalizeClassName(className: string): string {
    return className.trim().toLowerCase();
}

function getStatsObject(stats: CharacterLike["stats"]): { con?: number } {
    return typeof stats === "string" ? JSON.parse(stats) : stats;
}

export function parseWorldState(worldState: unknown): PhaseAWorldState {
    if (!worldState || typeof worldState !== "object") return {};
    return worldState as PhaseAWorldState;
}

export function getHitDieSize(className: string): number {
    const normalized = normalizeClassName(className);
    if (normalized.includes("barbarian")) return 12;
    if (normalized.includes("fighter") || normalized.includes("paladin") || normalized.includes("ranger")) return 10;
    if (normalized.includes("wizard") || normalized.includes("sorcerer")) return 6;
    return 8;
}

export function getSpellSlotsForClass(className: string, level: number): Record<string, number> {
    const normalized = normalizeClassName(className);
    if (normalized.includes("warlock")) return WARLOCK_SLOTS[level] ?? {};
    if (["wizard", "cleric", "druid", "sorcerer", "bard"].some(name => normalized.includes(name))) {
        return FULL_CASTER_SLOTS[level] ?? {};
    }
    if (normalized.includes("paladin") || normalized.includes("ranger")) {
        return HALF_CASTER_SLOTS[level] ?? {};
    }
    return {};
}

export function buildDefaultResourceState(character: CharacterLike): CharacterResourceState {
    const spellSlotsMax = getSpellSlotsForClass(character.className, character.level);
    return {
        hitDieSize: getHitDieSize(character.className),
        hitDiceMax: character.level,
        hitDiceRemaining: character.level,
        spellSlotsMax,
        spellSlotsCurrent: { ...spellSlotsMax },
    };
}

export function getCharacterResourceState(worldState: unknown, character: CharacterLike): CharacterResourceState {
    const parsedWorld = parseWorldState(worldState);
    const stored = parsedWorld.characterResources?.[String(character.id)];
    const defaults = buildDefaultResourceState(character);
    return {
        ...defaults,
        ...stored,
        spellSlotsMax: { ...defaults.spellSlotsMax, ...(stored?.spellSlotsMax ?? {}) },
        spellSlotsCurrent: { ...defaults.spellSlotsMax, ...(stored?.spellSlotsCurrent ?? {}) },
    };
}

export function setCharacterResourceState(worldState: unknown, characterId: number, state: CharacterResourceState): PhaseAWorldState {
    const parsedWorld = parseWorldState(worldState);
    return {
        ...parsedWorld,
        characterResources: {
            ...(parsedWorld.characterResources ?? {}),
            [String(characterId)]: state,
        },
    };
}

export function detectHitDiceToSpend(message: string): number | undefined {
    const numeral = message.match(/\bspend\s+(\d+)\s+hit\s*dice?\b/i);
    if (numeral) return Math.max(1, parseInt(numeral[1], 10));

    const wordMap: Record<string, number> = {
        one: 1,
        two: 2,
        three: 3,
        four: 4,
        five: 5,
        six: 6,
    };
    const word = message.match(/\bspend\s+(one|two|three|four|five|six)\s+hit\s*dice?\b/i);
    if (word) return wordMap[word[1].toLowerCase()];

    return undefined;
}

export function resolveShortRest(
    character: CharacterLike,
    resourceState: CharacterResourceState,
    options?: {
        hitDiceToSpend?: number;
        rollFn?: (formula: string) => RollLike;
    }
): {
    hpAfter: number;
    resourceState: CharacterResourceState;
    hitDiceSpent: number;
    healed: number;
    summary: string;
} {
    const stats = getStatsObject(character.stats);
    const conMod = Math.floor(((stats.con ?? 10) - 10) / 2);
    const maxSpend = Math.min(
        resourceState.hitDiceRemaining,
        Math.max(0, character.hpMax - character.hpCurrent) > 0 ? (options?.hitDiceToSpend ?? 1) : 0
    );
    const rollFn = options?.rollFn ?? defaultRoll;

    let healed = 0;
    let diceActuallySpent = 0;
    for (let i = 0; i < maxSpend; i++) {
        if (character.hpCurrent + healed >= character.hpMax) break; // Don't waste dice at full HP
        const die = rollFn(`1d${resourceState.hitDieSize}`).total;
        healed += Math.max(0, die + conMod);
        diceActuallySpent++;
    }

    const hpAfter = Math.min(character.hpMax, character.hpCurrent + healed);
    const actualHealed = hpAfter - character.hpCurrent;
    // Warlocks recover all pact magic slots on a short rest (5e rule)
    const isWarlock = normalizeClassName(character.className).includes("warlock");
    const nextState: CharacterResourceState = {
        ...resourceState,
        hitDiceRemaining: resourceState.hitDiceRemaining - diceActuallySpent,
        ...(isWarlock ? { spellSlotsCurrent: { ...resourceState.spellSlotsMax } } : {}),
    };

    const parts: string[] = [];
    if (diceActuallySpent > 0) {
        parts.push(`spends ${diceActuallySpent} hit ${diceActuallySpent === 1 ? "die" : "dice"} and recovers ${actualHealed} HP (${character.hpCurrent} -> ${hpAfter})`);
    }
    if (isWarlock) {
        parts.push("recovers pact magic slots");
    }
    const summary = parts.length > 0
        ? `${character.name} takes a short rest, ${parts.join(", ")}.`
        : `${character.name} takes a short rest but spends no hit dice.`;

    return {
        hpAfter,
        resourceState: nextState,
        hitDiceSpent: diceActuallySpent,
        healed: actualHealed,
        summary,
    };
}

export function resolveLongRest(
    character: CharacterLike,
    resourceState: CharacterResourceState
): {
    hpAfter: number;
    resourceState: CharacterResourceState;
    hitDiceRecovered: number;
    summary: string;
} {
    const hitDiceRecovered = Math.max(1, Math.floor(character.level / 2));
    const hpAfter = character.hpMax;
    const nextState: CharacterResourceState = {
        ...resourceState,
        hitDiceRemaining: Math.min(resourceState.hitDiceMax, resourceState.hitDiceRemaining + hitDiceRecovered),
        spellSlotsCurrent: { ...resourceState.spellSlotsMax },
    };

    return {
        hpAfter,
        resourceState: nextState,
        hitDiceRecovered,
        summary: `${character.name} finishes a long rest, returns to full HP (${hpAfter}), recovers spell slots, and regains ${hitDiceRecovered} hit ${hitDiceRecovered === 1 ? "die" : "dice"}.`,
    };
}
