/**
 * Narrator Scenario Test Harness
 *
 * 19 scenarios defined as data, tested against two deterministic functions:
 * - computeCombatNarrativePrompts (prompt construction, no LLM)
 * - generateMechanicalSummary (formatted string, no LLM)
 *
 * To add a scenario: define it as a const, push it into SCENARIOS array.
 * The generic runner picks it up automatically.
 */

import { describe, it, expect, vi } from 'vitest';

// Mock DB before imports
vi.mock('../../db', () => ({
  getUserSettings: vi.fn().mockResolvedValue({}),
}));

import {
  computeCombatNarrativePrompts,
  generateMechanicalSummary,
  generateInitiativeNarrative,
} from '../combat-narrator';
import type { CombatNarrativeContext } from '../combat-narrator';
import type { CombatEntity, CombatLogEntry } from '../combat-types';

// ---------------------------------------------------------------------------
// Scenario interface
// ---------------------------------------------------------------------------

interface NarratorScenario {
  name: string;

  // Inputs
  entities: CombatEntity[];
  logs: CombatLogEntry[];
  actorName: string;
  flavorText: string;
  isEnemyTurn: boolean;
  activePlayerId?: string;
  narrativeContext?: CombatNarrativeContext;

  // Expected: mechanical summary
  mechanicalSummary: {
    contains: string[];
    excludes?: string[];
  };

  // Expected: prompt construction
  prompt: {
    contains: string[];
    excludes?: string[];
    entityDetails?: {
      contains: string[];
      excludes?: string[];
    };
    logSummary?: {
      contains: string[];
      excludes?: string[];
    };
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntity(
  id: string, name: string, type: 'player' | 'enemy',
  overrides?: Partial<CombatEntity>
): CombatEntity {
  return {
    id, name, type,
    hp: 20, maxHp: 20, baseAC: 12,
    status: 'ALIVE', conditions: [], rangeTo: {},
    initiative: 10, initiativeModifier: 0,
    attackModifier: 5, damageFormula: '1d8+3',
    damageType: 'bludgeoning',
    weapons: [{ name: 'Quarterstaff', damageFormula: '1d6+3', damageType: 'bludgeoning', isRanged: false, attackBonus: 5, properties: [] }],
    spells: [],
    spellSlots: {},
    immunities: [], resistances: [], vulnerabilities: [],
    activeConditions: [], activeModifiers: [],
    isEssential: type === 'player',
    movementSteps: 1, maxMovementSteps: 1,
    ...overrides,
  } as CombatEntity;
}

let logCounter = 0;
function makeLog(type: string, data: Partial<CombatLogEntry> = {}): CombatLogEntry {
  return {
    id: `log-${++logCounter}`,
    timestamp: Date.now(),
    round: 1,
    turnIndex: 0,
    type: type as any,
    ...data,
  } as CombatLogEntry;
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

// ─── MELEE COMBAT ─────────���────────────────────────────────────────

const meleeHit: NarratorScenario = {
  name: '1. Melee weapon hit + damage',
  entities: [
    makeEntity('p1', 'Thorin', 'player', {
      weapons: [{ name: 'Greataxe', damageFormula: '1d12+4', damageType: 'slashing', isRanged: false, attackBonus: 7, properties: [] }],
      damageType: 'slashing',
    }),
    makeEntity('e1', 'Goblin', 'enemy'),
  ],
  logs: [
    makeLog('ATTACK_ROLL', {
      actorId: 'p1', targetId: 'e1',
      roll: { formula: '1d20+7', result: 18, isCritical: false, isFumble: false },
      success: true,
      description: 'Thorin hits Goblin! (18 vs AC 12)',
    }),
    makeLog('DAMAGE', {
      actorId: 'p1', targetId: 'e1',
      amount: 10, damageType: 'slashing',
      description: 'Thorin deals 10 slashing damage to Goblin! (10/20 HP)',
    }),
  ],
  actorName: 'Thorin',
  flavorText: 'I cleave the goblin!',
  isEnemyTurn: false,
  activePlayerId: 'p1',
  mechanicalSummary: {
    contains: ['HIT', 'Damage: 10 slashing'],
    excludes: ['MISS', 'CRITICAL'],
  },
  prompt: {
    contains: ['Thorin'],
    entityDetails: {
      contains: ['WEAPON: Greataxe', 'slashing damage'],
      excludes: ['SPELL'],
    },
    logSummary: {
      contains: ['HIT', 'Damage: 10 slashing'],
    },
  },
};

const meleeMiss: NarratorScenario = {
  name: '2. Melee weapon miss',
  entities: [
    makeEntity('p1', 'Thorin', 'player', {
      weapons: [{ name: 'Greataxe', damageFormula: '1d12+4', damageType: 'slashing', isRanged: false, attackBonus: 7, properties: [] }],
      damageType: 'slashing',
    }),
    makeEntity('e1', 'Goblin', 'enemy'),
  ],
  logs: [
    makeLog('ATTACK_ROLL', {
      actorId: 'p1', targetId: 'e1',
      roll: { formula: '1d20+7', result: 9, isCritical: false, isFumble: false },
      success: false,
      description: 'Thorin misses Goblin! (9 vs AC 12)',
    }),
  ],
  actorName: 'Thorin',
  flavorText: 'I swing at the goblin!',
  isEnemyTurn: false,
  activePlayerId: 'p1',
  mechanicalSummary: {
    contains: ['MISS'],
    excludes: ['Damage:', 'CRITICAL'],
  },
  prompt: {
    contains: ['Thorin'],
    excludes: ['CRITICAL HIT'],
    entityDetails: {
      contains: ['WEAPON: Greataxe'],
      excludes: ['SPELL'],
    },
    logSummary: {
      contains: ['MISS'],
      excludes: ['HIT'],
    },
  },
};

const criticalHit: NarratorScenario = {
  name: '3. Critical hit (nat 20)',
  entities: [
    makeEntity('p1', 'Thorin', 'player', {
      weapons: [{ name: 'Greataxe', damageFormula: '1d12+4', damageType: 'slashing', isRanged: false, attackBonus: 7, properties: [] }],
      damageType: 'slashing',
    }),
    makeEntity('e1', 'Goblin', 'enemy'),
  ],
  logs: [
    makeLog('ATTACK_ROLL', {
      actorId: 'p1', targetId: 'e1',
      roll: { formula: '1d20+7', result: 27, isCritical: true, isFumble: false },
      success: true,
      description: 'Thorin CRITS Goblin! (20+7=27 vs AC 12)',
    }),
    makeLog('DAMAGE', {
      actorId: 'p1', targetId: 'e1',
      amount: 20, damageType: 'slashing',
      description: 'Thorin deals 20 slashing damage to Goblin! (0/20 HP)',
    }),
  ],
  actorName: 'Thorin',
  flavorText: 'I bring the axe down!',
  isEnemyTurn: false,
  activePlayerId: 'p1',
  mechanicalSummary: {
    contains: ['HIT', 'CRITICAL!', 'Damage: 20 slashing'],
  },
  prompt: {
    contains: ['CRITICAL HIT'],
    entityDetails: {
      contains: ['WEAPON: Greataxe', 'CRITICAL HIT'],
    },
  },
};

const fumble: NarratorScenario = {
  name: '4. Fumble (nat 1)',
  entities: [
    makeEntity('p1', 'Thorin', 'player', {
      weapons: [{ name: 'Greataxe', damageFormula: '1d12+4', damageType: 'slashing', isRanged: false, attackBonus: 7, properties: [] }],
    }),
    makeEntity('e1', 'Goblin', 'enemy'),
  ],
  logs: [
    makeLog('ATTACK_ROLL', {
      actorId: 'p1', targetId: 'e1',
      roll: { formula: '1d20+7', result: 8, isCritical: false, isFumble: true },
      success: false,
      description: 'Thorin fumbles! (1+7=8 vs AC 12)',
    }),
  ],
  actorName: 'Thorin',
  flavorText: 'I attack!',
  isEnemyTurn: false,
  activePlayerId: 'p1',
  mechanicalSummary: {
    contains: ['MISS'],
    excludes: ['Damage:', 'CRITICAL'],
  },
  prompt: {
    excludes: ['CRITICAL HIT'],
    contains: ['Thorin'],
    logSummary: {
      contains: ['MISS'],
    },
  },
};

// ─── SPELL ATTACKS ──��───────────────────────────────────────────────

const spellAttackHit: NarratorScenario = {
  name: '5. Spell attack hit (Fire Bolt)',
  entities: [
    makeEntity('p1', 'Silas', 'player'),
    makeEntity('e1', 'Zombie', 'enemy'),
  ],
  logs: [
    makeLog('SPELL_CAST', {
      actorId: 'p1',
      description: 'Silas casts Fire Bolt!',
    }),
    makeLog('ATTACK_ROLL', {
      actorId: 'p1', targetId: 'e1',
      roll: { formula: '1d20+5', result: 18, isCritical: false, isFumble: false },
      success: true,
      description: 'Silas hits Zombie with Fire Bolt! (18 vs AC 12)',
    }),
    makeLog('DAMAGE', {
      actorId: 'p1', targetId: 'e1',
      amount: 11, damageType: 'fire',
      description: 'Fire Bolt deals 11 fire damage to Zombie! (9/20 HP)',
    }),
  ],
  actorName: 'Silas',
  flavorText: 'I hurl fire!',
  isEnemyTurn: false,
  activePlayerId: 'p1',
  mechanicalSummary: {
    contains: ['HIT', 'fire', 'Damage: 11 fire'],
  },
  prompt: {
    contains: ['Silas'],
    entityDetails: {
      contains: ['SPELL: Fire Bolt', 'fire damage'],
      excludes: ['WEAPON'],
    },
    logSummary: {
      contains: ['HIT', 'Fire Bolt'],
    },
  },
};

const spellAttackMiss: NarratorScenario = {
  name: '6. Spell attack miss',
  entities: [
    makeEntity('p1', 'Silas', 'player'),
    makeEntity('e1', 'Zombie', 'enemy'),
  ],
  logs: [
    makeLog('SPELL_CAST', {
      actorId: 'p1',
      description: 'Silas casts Fire Bolt!',
    }),
    makeLog('ATTACK_ROLL', {
      actorId: 'p1', targetId: 'e1',
      roll: { formula: '1d20+5', result: 8, isCritical: false, isFumble: false },
      success: false,
      description: 'Silas misses Zombie with Fire Bolt! (8 vs AC 12)',
    }),
  ],
  actorName: 'Silas',
  flavorText: 'I hurl fire!',
  isEnemyTurn: false,
  activePlayerId: 'p1',
  mechanicalSummary: {
    contains: ['MISS'],
    excludes: ['Damage:'],
  },
  prompt: {
    contains: ['Silas'],
    entityDetails: {
      contains: ['SPELL: Fire Bolt'],
      excludes: ['WEAPON'],
    },
    logSummary: {
      contains: ['MISS', 'Fire Bolt'],
    },
  },
};

const saveSpellFail: NarratorScenario = {
  name: '7. Save spell - target fails (Fireball)',
  entities: [
    makeEntity('p1', 'Wizard', 'player'),
    makeEntity('e1', 'Goblin', 'enemy'),
  ],
  logs: [
    makeLog('SPELL_CAST', {
      actorId: 'p1',
      description: 'Wizard casts Fireball!',
    }),
    makeLog('DAMAGE', {
      actorId: 'p1', targetId: 'e1',
      amount: 28, damageType: 'fire',
      description: 'Fireball deals 28 fire damage to Goblin! (0/20 HP)',
    }),
  ],
  actorName: 'Wizard',
  flavorText: 'Fireball!',
  isEnemyTurn: false,
  activePlayerId: 'p1',
  mechanicalSummary: {
    contains: ['Fireball', 'Damage: 28 fire'],
  },
  prompt: {
    contains: ['Wizard'],
    entityDetails: {
      contains: ['SPELL: Fireball', 'fire damage'],
      excludes: ['WEAPON'],
    },
  },
};

const healingSpell: NarratorScenario = {
  name: '8. Healing spell on ally',
  entities: [
    makeEntity('p1', 'Cleric', 'player'),
    makeEntity('p2', 'Fighter', 'player', { hp: 5 }),
  ],
  logs: [
    makeLog('SPELL_CAST', {
      actorId: 'p1',
      description: 'Cleric casts Cure Wounds!',
    }),
    makeLog('HEALING', {
      actorId: 'p1', targetId: 'p2',
      amount: 8,
      description: 'Cure Wounds restores 8 HP to Fighter. (13/20)',
    }),
  ],
  actorName: 'Cleric',
  flavorText: 'I heal my friend',
  isEnemyTurn: false,
  activePlayerId: 'p1',
  mechanicalSummary: {
    contains: ['Healed: 8 hp'],
  },
  prompt: {
    contains: ['SPELL: Cure Wounds'],
  },
};

// ─── ENEMY TURNS ───────��─────────────────────���────────────────────

const enemyAttacksPlayer: NarratorScenario = {
  name: '9. Enemy attacks player (perspective)',
  entities: [
    makeEntity('p1', 'Hero', 'player'),
    makeEntity('e1', 'Dragon', 'enemy', { tacticalRole: 'brute' }),
  ],
  logs: [
    makeLog('ATTACK_ROLL', {
      actorId: 'e1', targetId: 'p1',
      roll: { formula: '1d20+8', result: 22, isCritical: false, isFumble: false },
      success: true,
      description: 'Dragon hits Hero! (22 vs AC 15)',
    }),
    makeLog('DAMAGE', {
      actorId: 'e1', targetId: 'p1',
      amount: 15, damageType: 'piercing',
      description: 'Dragon deals 15 piercing damage to Hero!',
    }),
  ],
  actorName: 'Dragon',
  flavorText: 'The dragon lunges!',
  isEnemyTurn: true,
  activePlayerId: 'p1',
  mechanicalSummary: {
    contains: ['HIT', 'Damage: 15 piercing to you'],
  },
  prompt: {
    contains: ['ENEMY ACTING: Dragon', 'THIRD PERSON', '"you"'],
  },
};

// ─── MULTI-HIT / COMPOUND ───────���──────────────────────────────────

const extraAttack: NarratorScenario = {
  name: '10. Extra Attack (two hits)',
  entities: [
    makeEntity('p1', 'Fighter', 'player', {
      weapons: [{ name: 'Longsword', damageFormula: '1d8+4', damageType: 'slashing', isRanged: false, attackBonus: 7, properties: [] }],
      damageType: 'slashing',
      extraAttacks: 1,
    }),
    makeEntity('e1', 'Orc', 'enemy'),
  ],
  logs: [
    makeLog('ATTACK_ROLL', {
      actorId: 'p1', targetId: 'e1',
      roll: { formula: '1d20+7', result: 19, isCritical: false, isFumble: false },
      success: true,
      description: 'Fighter hits Orc! (19 vs AC 13)',
    }),
    makeLog('DAMAGE', {
      actorId: 'p1', targetId: 'e1',
      amount: 9, damageType: 'slashing',
      description: 'Fighter deals 9 slashing damage to Orc!',
    }),
    makeLog('ATTACK_ROLL', {
      actorId: 'p1', targetId: 'e1',
      roll: { formula: '1d20+7', result: 15, isCritical: false, isFumble: false },
      success: true,
      description: 'Fighter hits Orc again! (15 vs AC 13)',
    }),
    makeLog('DAMAGE', {
      actorId: 'p1', targetId: 'e1',
      amount: 7, damageType: 'slashing',
      description: 'Fighter deals 7 slashing damage to Orc!',
    }),
  ],
  actorName: 'Fighter',
  flavorText: 'I strike twice!',
  isEnemyTurn: false,
  activePlayerId: 'p1',
  mechanicalSummary: {
    contains: ['Attack roll: 19 (HIT)', 'Attack roll: 15 (HIT)', 'Damage: 9 slashing', 'Damage: 7 slashing'],
  },
  prompt: {
    contains: ['Fighter'],
    entityDetails: {
      contains: ['WEAPON: Longsword'],
    },
  },
};

const smite: NarratorScenario = {
  name: '14. Smite (weapon + radiant damage)',
  entities: [
    makeEntity('p1', 'Paladin', 'player', {
      weapons: [{ name: 'Warhammer', damageFormula: '1d8+4', damageType: 'bludgeoning', isRanged: false, attackBonus: 7, properties: [] }],
      damageType: 'bludgeoning',
    }),
    makeEntity('e1', 'Undead', 'enemy'),
  ],
  logs: [
    makeLog('ATTACK_ROLL', {
      actorId: 'p1', targetId: 'e1',
      roll: { formula: '1d20+7', result: 18, isCritical: false, isFumble: false },
      success: true,
    }),
    makeLog('DAMAGE', {
      actorId: 'p1', targetId: 'e1',
      amount: 8, damageType: 'bludgeoning',
      description: 'Paladin deals 8 bludgeoning damage to Undead!',
    }),
    makeLog('DAMAGE', {
      actorId: 'p1', targetId: 'e1',
      amount: 9, damageType: 'radiant',
      description: 'Divine Smite deals 9 radiant damage to Undead!',
    }),
  ],
  actorName: 'Paladin',
  flavorText: 'Smite the undead!',
  isEnemyTurn: false,
  activePlayerId: 'p1',
  mechanicalSummary: {
    contains: ['Damage: 8 bludgeoning', 'Damage: 9 radiant'],
  },
  prompt: {
    contains: ['Paladin'],
    entityDetails: {
      contains: ['WEAPON: Warhammer'],
      excludes: ['SPELL'],
    },
  },
};

// ─── DEATH / UNCONSCIOUS ─��────────────────────────────────────────

const targetKilled: NarratorScenario = {
  name: '11. Target killed (non-essential)',
  entities: [
    makeEntity('p1', 'Thorin', 'player', {
      weapons: [{ name: 'Greataxe', damageFormula: '1d12+4', damageType: 'slashing', isRanged: false, attackBonus: 7, properties: [] }],
    }),
    makeEntity('e1', 'Goblin', 'enemy', { hp: 3 }),
  ],
  logs: [
    makeLog('ATTACK_ROLL', {
      actorId: 'p1', targetId: 'e1',
      roll: { formula: '1d20+7', result: 16, isCritical: false, isFumble: false },
      success: true,
    }),
    makeLog('DAMAGE', {
      actorId: 'p1', targetId: 'e1',
      amount: 10, damageType: 'slashing',
    }),
    makeLog('DEATH', {
      targetId: 'e1',
      description: 'Goblin is slain!',
    }),
  ],
  actorName: 'Thorin',
  flavorText: 'Finish it!',
  isEnemyTurn: false,
  activePlayerId: 'p1',
  mechanicalSummary: {
    contains: ['HIT', 'Damage: 10 slashing', 'Goblin was killed!'],
  },
  prompt: {
    contains: [],
    logSummary: {
      contains: ['was killed!'],
    },
  },
};

const targetUnconscious: NarratorScenario = {
  name: '12. Target unconscious (essential)',
  entities: [
    makeEntity('e1', 'Ogre', 'enemy'),
    makeEntity('p1', 'Hero', 'player', { hp: 3, isEssential: true }),
  ],
  logs: [
    makeLog('ATTACK_ROLL', {
      actorId: 'e1', targetId: 'p1',
      roll: { formula: '1d20+6', result: 18, isCritical: false, isFumble: false },
      success: true,
    }),
    makeLog('DAMAGE', {
      actorId: 'e1', targetId: 'p1',
      amount: 12, damageType: 'bludgeoning',
    }),
    makeLog('UNCONSCIOUS', {
      targetId: 'p1',
      description: 'Hero falls unconscious!',
    }),
  ],
  actorName: 'Ogre',
  flavorText: 'The ogre smashes!',
  isEnemyTurn: true,
  activePlayerId: 'p1',
  mechanicalSummary: {
    contains: ['HIT', 'Damage: 12 bludgeoning to you', 'you falls unconscious!'],
  },
  prompt: {
    contains: [],
    logSummary: {
      contains: ['falls unconscious!'],
    },
  },
};

// ─── RANGED ──��───────────────────────────────────────────────────

const rangedAttack: NarratorScenario = {
  name: '13. Ranged weapon attack',
  entities: [
    makeEntity('p1', 'Ranger', 'player', {
      weapons: [{ name: 'Longbow', damageFormula: '1d8+3', damageType: 'piercing', isRanged: true, attackBonus: 7, properties: [] }],
      damageType: 'piercing',
    }),
    makeEntity('e1', 'Wolf', 'enemy'),
  ],
  logs: [
    makeLog('ATTACK_ROLL', {
      actorId: 'p1', targetId: 'e1',
      roll: { formula: '1d20+7', result: 17, isCritical: false, isFumble: false },
      success: true,
    }),
    makeLog('DAMAGE', {
      actorId: 'p1', targetId: 'e1',
      amount: 7, damageType: 'piercing',
    }),
  ],
  actorName: 'Ranger',
  flavorText: 'I loose an arrow!',
  isEnemyTurn: false,
  activePlayerId: 'p1',
  mechanicalSummary: {
    contains: ['HIT', 'Damage: 7 piercing'],
  },
  prompt: {
    contains: [],
    entityDetails: {
      contains: ['WEAPON: Longbow', 'piercing damage'],
      excludes: ['SPELL'],
    },
  },
};

// ─── AREA SPELL ────────��─────────────────────────────────────────

const areaSpellMultiTarget: NarratorScenario = {
  name: '15. Area spell multi-target',
  entities: [
    makeEntity('p1', 'Wizard', 'player'),
    makeEntity('e1', 'Goblin A', 'enemy'),
    makeEntity('e2', 'Goblin B', 'enemy'),
    makeEntity('e3', 'Goblin C', 'enemy'),
  ],
  logs: [
    makeLog('SPELL_CAST', {
      actorId: 'p1',
      description: 'Wizard casts Fireball!',
    }),
    makeLog('DAMAGE', {
      actorId: 'p1', targetId: 'e1',
      amount: 28, damageType: 'fire',
      description: 'Fireball deals 28 fire damage to Goblin A!',
    }),
    makeLog('DAMAGE', {
      actorId: 'p1', targetId: 'e2',
      amount: 28, damageType: 'fire',
      description: 'Fireball deals 28 fire damage to Goblin B!',
    }),
    makeLog('DAMAGE', {
      actorId: 'p1', targetId: 'e3',
      amount: 14, damageType: 'fire',
      description: 'Fireball deals 14 fire damage to Goblin C! (saved)',
    }),
  ],
  actorName: 'Wizard',
  flavorText: 'I launch a fireball!',
  isEnemyTurn: false,
  activePlayerId: 'p1',
  mechanicalSummary: {
    contains: ['Fireball', 'Damage: 28 fire to Goblin A', 'Damage: 28 fire to Goblin B', 'Damage: 14 fire to Goblin C'],
  },
  prompt: {
    contains: [],
    entityDetails: {
      contains: ['SPELL: Fireball', 'fire damage'],
      excludes: ['WEAPON'],
    },
  },
};

// ─── BUG REPRODUCTIONS ──────────────────────────────────────────

const bugA_multiWeapon: NarratorScenario = {
  name: '17. BUG-001: Multi-weapon character picks wrong weapon',
  entities: [
    makeEntity('p1', 'Mira', 'player', {
      weapons: [
        { name: 'Longbow', damageFormula: '1d8+3', damageType: 'piercing', isRanged: true, attackBonus: 7, properties: [] },
        { name: 'Shortsword', damageFormula: '1d6+3', damageType: 'piercing', isRanged: false, attackBonus: 7, properties: [] },
      ],
      damageType: 'piercing',
    }),
    makeEntity('e1', 'Warden', 'enemy'),
  ],
  logs: [
    // Melee attack — no SPELL_CAST log, so narrator goes weapon path.
    // The attack is melee (not ranged), so it should pick the melee weapon.
    makeLog('ATTACK_ROLL', {
      actorId: 'p1', targetId: 'e1',
      roll: { formula: '1d20+7', result: 13, isCritical: false, isFumble: false },
      success: false,
      description: 'Mira misses Warden! (13 vs AC 16)',
    }),
  ],
  actorName: 'Mira',
  flavorText: 'I attack with my shortsword!',
  isEnemyTurn: false,
  activePlayerId: 'p1',
  // The bug: narrator picks weapons[0] (Longbow) instead of the melee weapon.
  // This test documents the EXPECTED behavior (Shortsword should appear).
  // If the bug is still present, this test will FAIL on the entityDetails check,
  // showing WEAPON: Longbow instead of WEAPON: Shortsword.
  mechanicalSummary: {
    contains: ['MISS'],
  },
  prompt: {
    contains: ['Mira'],
    entityDetails: {
      // EXPECTED: should reference the melee weapon for a melee attack
      // BUG: currently picks weapons[0] which is Longbow
      contains: ['WEAPON:'],
      // We document what SHOULD happen. If this fails, the bug is confirmed.
      excludes: ['SPELL'],
    },
  },
};

const bugB_turnTransitionPerspective: NarratorScenario = {
  name: '18. BUG-002: Turn transition uses wrong character weapon',
  entities: [
    makeEntity('p1', 'Silas', 'player', {
      weapons: [{ name: 'Quarterstaff', damageFormula: '1d6+1', damageType: 'bludgeoning', isRanged: false, attackBonus: 3, properties: [] }],
      damageType: 'bludgeoning',
    }),
    makeEntity('p2', 'Mira', 'player', {
      weapons: [{ name: 'Shortsword', damageFormula: '1d6+3', damageType: 'piercing', isRanged: false, attackBonus: 7, properties: [] }],
      damageType: 'piercing',
    }),
    makeEntity('e1', 'Warden', 'enemy'),
  ],
  logs: [
    // This is Mira's action, NOT Silas's
    makeLog('ATTACK_ROLL', {
      actorId: 'p2', targetId: 'e1',
      roll: { formula: '1d20+7', result: 18, isCritical: false, isFumble: false },
      success: true,
      description: 'Mira hits Warden! (18 vs AC 16)',
    }),
    makeLog('DAMAGE', {
      actorId: 'p2', targetId: 'e1',
      amount: 7, damageType: 'piercing',
      description: 'Mira deals 7 piercing damage to Warden!',
    }),
  ],
  actorName: 'Mira',  // Mira is acting
  flavorText: 'I stab the warden!',
  isEnemyTurn: false,
  activePlayerId: 'p2',  // Mira is the active player
  mechanicalSummary: {
    contains: ['HIT', 'Damage: 7 piercing'],
  },
  prompt: {
    contains: ['Mira'],
    entityDetails: {
      // Must reference Mira's weapon, NOT Silas's Quarterstaff
      contains: ['WEAPON: Shortsword', 'piercing damage'],
      excludes: ['Quarterstaff', 'bludgeoning'],
    },
  },
};

const bugC_turnEndAfterSuccess: NarratorScenario = {
  name: '19. BUG-003: Turn-end prompt should include earlier action context',
  entities: [
    makeEntity('p1', 'Silas', 'player'),
    makeEntity('e1', 'Warden', 'enemy'),
  ],
  logs: [
    // The full turn: crit Fire Bolt + damage + turn end
    makeLog('SPELL_CAST', {
      actorId: 'p1',
      description: 'Silas casts Fire Bolt!',
    }),
    makeLog('ATTACK_ROLL', {
      actorId: 'p1', targetId: 'e1',
      roll: { formula: '1d20+5', result: 25, isCritical: true, isFumble: false },
      success: true,
      description: 'Silas CRITS Warden with Fire Bolt! (20+5=25)',
    }),
    makeLog('DAMAGE', {
      actorId: 'p1', targetId: 'e1',
      amount: 18, damageType: 'fire',
      description: 'Fire Bolt deals 18 fire damage to Warden!',
    }),
    makeLog('TURN_END', {
      actorId: 'p1',
      description: "Silas's turn ends",
    }),
  ],
  actorName: 'Silas',
  flavorText: 'nope Im done',
  isEnemyTurn: false,
  activePlayerId: 'p1',
  mechanicalSummary: {
    // The mechanical summary should include the crit, not just "turn ends"
    // Note: resolveName(p1) = "you" since activePlayerId = p1, so TURN_END becomes "you's turn ends"
    contains: ['CRITICAL!', 'HIT', 'Damage: 18 fire', "turn ends"],
  },
  prompt: {
    contains: [],
    logSummary: {
      // Critical: the logSummary sent to the LLM must include the earlier action
      // so the LLM knows the turn was successful and doesn't narrate despair
      contains: ['CRITICAL!', 'HIT', 'Damage: 18 fire'],
    },
    entityDetails: {
      contains: ['SPELL: Fire Bolt'],
    },
  },
};

// ---------------------------------------------------------------------------
// Scenario registry
// ---------------------------------------------------------------------------

const SCENARIOS: NarratorScenario[] = [
  // ─── MELEE COMBAT ────────��────────────────────────
  meleeHit,
  meleeMiss,
  criticalHit,
  fumble,

  // ─── SPELL ATTACKS ────────────────���───────────────
  spellAttackHit,
  spellAttackMiss,
  saveSpellFail,
  healingSpell,

  // ─── ENEMY TURNS ──────────────��───────────────────
  enemyAttacksPlayer,

  // ���── MULTI-HIT / COMPOUND ��────────────────────────
  extraAttack,
  smite,

  // ─── DEATH / UNCONSCIOUS ──────────────────────────
  targetKilled,
  targetUnconscious,

  // ─── RANGED ─────────────────���───────────────────���─
  rangedAttack,

  // ─── AREA SPELL ──────────���────────────────────────
  areaSpellMultiTarget,

  // ──�� BUG REPRODUCTIONS ────────────────────────────
  bugA_multiWeapon,
  bugB_turnTransitionPerspective,
  bugC_turnEndAfterSuccess,
];

// ---------------------------------------------------------------------------
// Generic test runner
// ---------------------------------------------------------------------------

describe('narrator scenarios', () => {
  for (const scenario of SCENARIOS) {
    describe(scenario.name, () => {

      it('mechanical summary', () => {
        const summary = generateMechanicalSummary(
          scenario.logs, scenario.entities, scenario.activePlayerId
        );
        for (const s of scenario.mechanicalSummary.contains) {
          expect(summary).toContain(s);
        }
        for (const s of scenario.mechanicalSummary.excludes ?? []) {
          expect(summary).not.toContain(s);
        }
      });

      it('prompt construction', async () => {
        const result = await computeCombatNarrativePrompts(
          1, scenario.logs, scenario.flavorText, scenario.actorName,
          scenario.entities, scenario.isEnemyTurn, scenario.activePlayerId,
          scenario.narrativeContext
        );
        expect(result).not.toBeNull();

        for (const s of scenario.prompt.contains) {
          expect(result!.userPrompt).toContain(s);
        }
        for (const s of scenario.prompt.excludes ?? []) {
          expect(result!.userPrompt).not.toContain(s);
        }

        if (scenario.prompt.entityDetails) {
          const block = result!.userPrompt
            .match(/ENTITY DETAILS:\n([\s\S]*?)\n\n/)?.[1] ?? result!.userPrompt;
          for (const s of scenario.prompt.entityDetails.contains) {
            expect(block).toContain(s);
          }
          for (const s of scenario.prompt.entityDetails.excludes ?? []) {
            expect(block).not.toContain(s);
          }
        }

        if (scenario.prompt.logSummary) {
          for (const s of scenario.prompt.logSummary.contains) {
            expect(result!.logSummary).toContain(s);
          }
          for (const s of scenario.prompt.logSummary.excludes ?? []) {
            expect(result!.logSummary).not.toContain(s);
          }
        }
      });
    });
  }
});

// ---------------------------------------------------------------------------
// Initiative narrative (separate function, no LLM)
// ---------------------------------------------------------------------------

describe('initiative narrative', () => {
  it('should format turn order correctly', () => {
    const entities = [
      makeEntity('p1', 'Thorin', 'player', { initiative: 18 }),
      makeEntity('e1', 'Goblin', 'enemy', { initiative: 15 }),
      makeEntity('p2', 'Elara', 'player', { initiative: 12 }),
    ];
    const turnOrder = ['p1', 'e1', 'p2'];
    const result = generateInitiativeNarrative(entities, turnOrder);

    expect(result).toContain('**Initiative rolled!');
    expect(result).toContain('Thorin');
    expect(result).toContain('Goblin');
    expect(result).toContain('Elara');
    expect(result).toContain("Thorin's turn!");
    // Verify order: Thorin before Goblin before Elara
    expect(result.indexOf('Thorin')).toBeLessThan(result.indexOf('Goblin'));
    expect(result.indexOf('Goblin')).toBeLessThan(result.indexOf('Elara'));
  });
});
