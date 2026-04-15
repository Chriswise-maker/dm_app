/**
 * Message-Send Pipeline Integration Test (Tier 2)
 *
 * Calls executeMessageSend with mocked LLM + mocked DB to validate that
 * the engine state, DB persistence, and combat orchestration stay aligned
 * through a player turn + enemy AI resolution.
 *
 * This catches the class of bugs where unit tests pass but the real chat
 * path diverges (BUG-006 class issues): ordering, syncCombatStateToDb,
 * runAILoop interactions.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { MessageSendInput } from '../../message-send';
import type { TrpcContext } from '../../_core/context';

// ── Mock DB ─────────────────────────────────────────────────────────────────

const savedMessages: Array<{ sessionId: number; characterName: string; content: string; isDm: number }> = [];

vi.mock('../../db', () => ({
  getCharacter: vi.fn().mockResolvedValue({
    id: 1,
    name: 'Silas Gravemourn',
    sessionId: 1,
    race: 'Human',
    class: 'Wizard',
    level: 5,
    hpCurrent: 28,
    hpMax: 28,
    ac: 12,
    stats: JSON.stringify({ str: 8, dex: 14, con: 12, int: 18, wis: 13, cha: 10 }),
    inventory: JSON.stringify([]),
    backstory: 'A necromancer scholar.',
    appearance: 'Pale, thin, dark robes.',
    actorSheet: null,
    actorState: null,
    portrait: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }),
  getSession: vi.fn().mockResolvedValue({
    id: 1,
    userId: 'test-user',
    name: 'Test Session',
    currentSummary: '',
    narrativePrompt: '',
    createdAt: new Date(),
    updatedAt: new Date(),
  }),
  getSessionMessages: vi.fn().mockResolvedValue([]),
  getSessionContext: vi.fn().mockResolvedValue(undefined),
  parseSessionContext: vi.fn().mockReturnValue({}),
  getCombatState: vi.fn().mockResolvedValue(null),
  getCombatants: vi.fn().mockResolvedValue([]),
  saveMessage: vi.fn().mockImplementation(async (msg: any) => {
    savedMessages.push(msg);
  }),
  saveCombatEngineState: vi.fn().mockResolvedValue(undefined),
  loadCombatEngineState: vi.fn().mockResolvedValue(null),
  deleteCombatEngineState: vi.fn().mockResolvedValue(undefined),
  getUserSettings: vi.fn().mockResolvedValue({}),
  getSessionCharacters: vi.fn().mockResolvedValue([]),
  upsertSessionContext: vi.fn().mockResolvedValue(undefined),
  updateCharacterHP: vi.fn().mockResolvedValue(undefined),
  updateCharacter: vi.fn().mockResolvedValue(undefined),
  getMessageCount: vi.fn().mockResolvedValue(5),
  updateSessionSummary: vi.fn().mockResolvedValue(undefined),
}));

// ── Mock context extraction ──────────────────────────────────────────────────

vi.mock('../../context-extraction', () => ({
  extractContextFromResponse: vi.fn().mockResolvedValue({}),
  mergeContext: vi.fn().mockReturnValue({}),
}));

// ── Mock core LLM (prevents API key check) ──────────────────────────────────

vi.mock('../../_core/llm', () => ({
  invokeLLM: vi.fn().mockResolvedValue({
    choices: [{ message: { content: 'Mock LLM response.' } }],
  }),
  assertApiKey: vi.fn(),
}));

// ── Mock LLM ────────────────────────────────────────────────────────────────

vi.mock('../../_core/llm-with-settings', () => ({
  invokeLLMWithSettings: vi.fn().mockResolvedValue({
    choices: [{ message: { content: 'The DM describes the scene.' } }],
  }),
}));

vi.mock('../../llm-with-settings', () => ({
  invokeLLMWithSettings: vi.fn().mockResolvedValue({
    choices: [{ message: { content: 'The DM describes the scene.' } }],
  }),
}));

// ── Mock combat narrator (returns fixed string instead of LLM call) ─────────

vi.mock('../combat-narrator', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    generateCombatNarrativeStream: vi.fn().mockResolvedValue(
      (async function* () { yield 'The attack lands with force!'; })()
    ),
    generateMechanicalSummary: actual.generateMechanicalSummary,
    generateInitiativeNarrative: actual.generateInitiativeNarrative,
    computeCombatNarrativePrompts: actual.computeCombatNarrativePrompts,
  };
});

// ── Mock player action parser ───────────────────────────────────────────────

vi.mock('../player-action-parser', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    isPlayerTurn: vi.fn().mockReturnValue(true),
    parsePlayerAction: vi.fn().mockResolvedValue({
      action: {
        type: 'END_TURN',
        entityId: 'player-1',
      },
      flavorText: 'Silas ends his turn.',
    }),
  };
});

// ── Mock enemy AI controller ────────────────────────────────────────────────

const runAILoopCalls: Array<{ sessionId: number; userId: string }> = [];

vi.mock('../enemy-ai-controller', () => ({
  runAILoop: vi.fn().mockImplementation(async (sessionId: number, userId: string) => {
    runAILoopCalls.push({ sessionId, userId });
  }),
}));

// ── Mock combat helpers ─────────────────────────────────────────────────────

vi.mock('../combat-helpers', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    syncCombatStateToDb: vi.fn().mockResolvedValue(undefined),
    handleAutoCombatInitiation: actual.handleAutoCombatInitiation,
    handleAutoCombatEnd: actual.handleAutoCombatEnd,
  };
});

// ── Mock response parser ────────────────────────────────────────────────────

vi.mock('../../response-parser', () => ({
  parseStructuredResponse: vi.fn().mockReturnValue({ narrative: 'The DM describes the scene vividly.' }),
  hasCombatInitiation: vi.fn().mockReturnValue(false),
  hasCombatEnd: vi.fn().mockReturnValue(false),
  getEnemies: vi.fn().mockReturnValue([]),
}));

// ── Mock prompts ────────────────────────────────────────────────────────────

vi.mock('../../prompts', () => ({
  buildChatSystemPrompt: vi.fn().mockReturnValue('You are a DM.'),
  buildChatUserPrompt: vi.fn().mockReturnValue('Player says hello.'),
  buildCombatQueryPrompt: vi.fn().mockReturnValue('Combat query.'),
  formatCharacterSheet: vi.fn().mockReturnValue('Silas Gravemourn - Wizard 5'),
  formatCharacterSheetForCombat: vi.fn().mockReturnValue('Silas Gravemourn - Wizard 5 (combat)'),
  getSkillProficiencies: vi.fn().mockReturnValue([]),
  SRD_TOOLS: [],
}));

vi.mock('../../srd/srd-loader', () => ({
  getSrdLoader: vi.fn().mockReturnValue({
    lookupByName: vi.fn().mockReturnValue(null),
    filterEntries: vi.fn().mockReturnValue([]),
    summarizeForLLM: vi.fn().mockReturnValue(''),
  }),
  lookupByName: vi.fn().mockReturnValue(null),
  filterEntries: vi.fn().mockReturnValue([]),
  summarizeForLLM: vi.fn().mockReturnValue(''),
}));

// ── Imports (after mocks) ───────────────────────────────────────────────────

import { CombatEngineManager } from '../combat-engine-manager';
import { createCombatEngine } from '../combat-engine-v2';
import { createPlayerEntity, createEnemyEntity } from '../combat-types';

// ── Test context ────────────────────────────────────────────────────────────

const mockCtx: TrpcContext = {
  user: {
    id: 'test-user',
    openId: 'test',
    name: 'Test User',
    email: 'test@test.com',
    loginMethod: 'local',
    role: 'user',
    createdAt: new Date(),
    updatedAt: new Date(),
  },
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function setupCombatEngine(sessionId: number) {
  const fixedRoll = () => ({ total: 15, rolls: [15], isCritical: false, isFumble: false });
  const engine = createCombatEngine(sessionId, undefined, fixedRoll);

  const player = createPlayerEntity('player-1', 'Silas Gravemourn', 28, 28, 12, 15, {
    weapons: [{ name: 'Quarterstaff', damageFormula: '1d6+1', damageType: 'bludgeoning', isRanged: false, attackBonus: 3, properties: [] }],
    damageType: 'bludgeoning',
  });

  const enemy = createEnemyEntity('enemy-1', 'Goblin Raider', 12, 13, 4, '1d6+2', {
    initiative: 10,
    maxHp: 12,
    damageType: 'slashing',
  });

  engine.initiateCombat([player, enemy]);

  // Store in manager so message-send can find it
  (CombatEngineManager as any).engines.set(sessionId, engine);

  return engine;
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('executeMessageSend pipeline integration', () => {
  beforeEach(() => {
    savedMessages.length = 0;
    runAILoopCalls.length = 0;
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Clean up engines
    (CombatEngineManager as any).engines.clear();
  });

  it('should process END_TURN and trigger enemy AI loop when turn passes to enemy', async () => {
    const sessionId = 100;
    const engine = setupCombatEngine(sessionId);

    // Verify setup: player's turn, ACTIVE phase
    const initialState = engine.getState();
    expect(initialState.phase).toBe('ACTIVE');
    const currentEntity = initialState.entities.find(
      e => e.id === initialState.turnOrder[initialState.turnIndex]
    );
    expect(currentEntity?.name).toBe('Silas Gravemourn');

    // Import the real function (mocks are already in place)
    const { executeMessageSend } = await import('../../message-send');

    const input: MessageSendInput = {
      sessionId,
      characterId: 1,
      message: "I end my turn.",
    };

    const result = await executeMessageSend(mockCtx, input);

    // Should get a narrative response
    expect(result.response).toBeTruthy();
    expect(result.response.length).toBeGreaterThan(0);

    // Engine state should have advanced: turn passed to enemy
    const afterState = engine.getState();
    const nextEntity = afterState.entities.find(
      e => e.id === afterState.turnOrder[afterState.turnIndex]
    );
    expect(nextEntity?.name).toBe('Goblin Raider');
    expect(nextEntity?.type).toBe('enemy');

    // runAILoop should have been called (async enemy turn)
    expect(runAILoopCalls.length).toBe(1);
    expect(runAILoopCalls[0].sessionId).toBe(sessionId);

    // Messages should have been saved (player + DM)
    expect(savedMessages.length).toBeGreaterThanOrEqual(2);
    expect(savedMessages.some(m => m.isDm === 0 && m.content === "I end my turn.")).toBe(true);
    expect(savedMessages.some(m => m.isDm === 1)).toBe(true);
  });

  it('should return a response even when engine is not active (general chat)', async () => {
    // No combat engine set up — this should fall through to the general chat path
    const { executeMessageSend } = await import('../../message-send');

    const input: MessageSendInput = {
      sessionId: 200,
      characterId: 1,
      message: "I look around the room.",
    };

    const result = await executeMessageSend(mockCtx, input);

    // Should get some response from the mocked LLM
    expect(result.response).toBeTruthy();
    expect(result.combatTriggered).toBe(false);
  });

  it('should persist engine state after action', async () => {
    const sessionId = 300;
    setupCombatEngine(sessionId);

    const { executeMessageSend } = await import('../../message-send');
    const db = await import('../../db');

    const input: MessageSendInput = {
      sessionId,
      characterId: 1,
      message: "I end my turn.",
    };

    await executeMessageSend(mockCtx, input);

    // syncCombatStateToDb should have been called
    const { syncCombatStateToDb } = await import('../combat-helpers');
    expect(syncCombatStateToDb).toHaveBeenCalledWith(sessionId);
  });
});
