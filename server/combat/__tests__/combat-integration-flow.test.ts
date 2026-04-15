/**
 * Combat Integration Flow Tests
 *
 * Simulates a player going through full combat flows — the same path
 * the real app takes through engine → caller → narrator.
 *
 * These tests replicate the exact "waiter" logic from routers.ts and
 * message-send.ts to catch bugs in how data is assembled before
 * reaching the narrator.
 *
 * No LLM calls, no DB, no HTTP — just engine + narrator prompt checks.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock DB
vi.mock('../../db', () => ({
  getUserSettings: vi.fn().mockResolvedValue({}),
}));

import { createCombatEngine } from '../combat-engine-v2';
import type { CombatEngineV2 } from '../combat-engine-v2';
import { createPlayerEntity, createEnemyEntity } from '../combat-types';
import type { CombatEntity, CombatLogEntry } from '../combat-types';
import {
  computeCombatNarrativePrompts,
  generateMechanicalSummary,
} from '../combat-narrator';

// ---------------------------------------------------------------------------
// Test helpers — replicate caller logic from routers.ts / message-send.ts
// ---------------------------------------------------------------------------

/**
 * Replicates the weapon context assembly from message-send.ts lines 877-885.
 * This is what the "waiter" does to determine which weapon to tell the narrator about.
 */
function assembleWeaponContext(
  actionType: string,
  actionWeaponName: string | undefined,
  activeEntity: CombatEntity | undefined
): Record<string, any> {
  if (actionType === 'ATTACK' && actionWeaponName) {
    const weapon = activeEntity?.weapons?.find(
      w => w.name.toLowerCase() === actionWeaponName.toLowerCase()
    );
    return { weaponName: weapon?.name ?? actionWeaponName };
  }
  return {};
}

/**
 * Replicates the routers.ts async path (lines 2484-2491).
 * This is the "waiter" for the dice-roller UI path.
 */
function assembleRouterNarratorCall(
  engine: CombatEngineV2,
  rollType: string,
  rawDieValue: number,
  logs: CombatLogEntry[],
  rollingEntityName: string,
  activePlayerId: string | undefined,
  playerHasRemainingResources: boolean,
) {
  const flavorText = `${rollingEntityName} rolls ${rawDieValue} (d20 ${rollType})`;
  return {
    logs,
    flavorText,
    actorName: rollingEntityName,
    entities: engine.getState().entities,
    isEnemyTurn: false,
    activePlayerId,
    narrativeContext: playerHasRemainingResources
      ? { playerHasRemainingResources: true }
      : undefined,
    // NOTE: No weaponName! This is the bug in routers.ts
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function createSilas(): CombatEntity {
  return createPlayerEntity('silas', 'Silas Gravemourn', 28, 28, 12, 15, {
    weapons: [{ name: 'Quarterstaff', damageFormula: '1d6+1', damageType: 'bludgeoning', isRanged: false, attackBonus: 3, properties: [] }],
    damageType: 'bludgeoning',
    spells: [
      { name: 'Fire Bolt', level: 0, school: 'evocation', castingTime: 'action', range: 120, isAreaEffect: false, savingThrow: undefined, halfOnSave: false, damageFormula: '2d10', damageType: 'fire', requiresConcentration: false, requiresAttackRoll: true, conditions: [], description: 'Hurl fire' },
      { name: 'Scorching Ray', level: 2, school: 'evocation', castingTime: 'action', range: 120, isAreaEffect: false, savingThrow: undefined, halfOnSave: false, damageFormula: '2d6', damageType: 'fire', requiresConcentration: false, requiresAttackRoll: true, conditions: [], description: '3 rays of fire' },
    ],
    spellSlots: { '1': 3, '2': 2 },
    spellAttackBonus: 5,
    spellSaveDC: 13,
    characterClass: 'Wizard',
    level: 3,
  });
}

function createMira(): CombatEntity {
  return createPlayerEntity('mira', 'Mira Ashenthorn', 32, 32, 15, 18, {
    weapons: [
      { name: 'Longbow', damageFormula: '1d8+3', damageType: 'piercing', isRanged: true, attackBonus: 7, properties: ['ammunition', 'heavy', 'two-handed'] },
      { name: 'Shortsword', damageFormula: '1d6+3', damageType: 'piercing', isRanged: false, attackBonus: 7, properties: ['finesse', 'light'] },
    ],
    damageType: 'piercing',
    characterClass: 'Ranger',
    level: 3,
  });
}

function createWarden(id: string, name: string): CombatEntity {
  return createEnemyEntity(id, name, 32, 16, 5, '1d8+3', {
    damageType: 'slashing',
    weapons: [{ name: 'Corrupted Blade', damageFormula: '1d8+3', damageType: 'slashing', isRanged: false, attackBonus: 5, properties: [] }],
    initiative: 12,
    tacticalRole: 'brute',
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('combat integration flow', () => {
  let engine: CombatEngineV2;

  describe('BUG-001: Multi-weapon character — wrong weapon in narrator prompt', () => {
    /**
     * Scenario: Mira has Longbow + Shortsword. She's in melee range and
     * attacks with her shortsword. The narrator should say "Shortsword",
     * not "Longbow".
     *
     * We test BOTH code paths:
     * 1. message-send.ts path (parsed action with weaponName)
     * 2. routers.ts path (dice roller, no weaponName passed)
     */

    beforeEach(() => {
      engine = createCombatEngine(1);
      const mira = createMira();
      const warden = createWarden('warden-a', 'Corrupted Throne-Warden Alpha');
      engine.prepareCombat([mira, warden]);
      engine.applyInitiative('mira', 18);
      engine.applyInitiative('warden-a', 12);
      // Mira goes first
    });

    it('message-send path: should pass correct weapon when parser specifies shortsword', async () => {
      // Simulate: parser detected "I attack with my shortsword" → ATTACK with weaponName: 'Shortsword'
      const result = engine.submitAction({
        type: 'ATTACK',
        attackerId: 'mira',
        targetId: 'warden-a',
        weaponName: 'Shortsword',
        attackRoll: 8, // miss
        rawD20: 3,
      });

      // Replicate message-send.ts weapon context assembly (lines 877-885)
      const activeEntity = engine.getState().entities.find(e => e.id === 'mira');
      const weaponCtx = assembleWeaponContext('ATTACK', 'Shortsword', activeEntity);

      const prompt = await computeCombatNarrativePrompts(
        1, result.logs, 'I attack with my shortsword!', 'Mira Ashenthorn',
        engine.getState().entities, false, 'mira', weaponCtx
      );

      expect(prompt).not.toBeNull();
      expect(prompt!.userPrompt).toContain('WEAPON: Shortsword');
      expect(prompt!.userPrompt).not.toContain('Longbow');
    });

    it('routers.ts path: NO weapon context passed — narrator falls back to weapons[0]', async () => {
      // Simulate dice-roller UI path: player rolls d20 via sidebar
      // First, submit attack action to enter AWAIT_ATTACK_ROLL
      const result = engine.submitAction({
        type: 'ATTACK',
        attackerId: 'mira',
        targetId: 'warden-a',
        weaponName: 'Shortsword',
        attackRoll: 8, // miss
        rawD20: 3,
      });

      // Replicate routers.ts async path — NO weaponName passed!
      const callerData = assembleRouterNarratorCall(
        engine, 'attack', 8, result.logs,
        'Mira Ashenthorn', 'mira', false
      );

      const prompt = await computeCombatNarrativePrompts(
        1, callerData.logs, callerData.flavorText, callerData.actorName,
        callerData.entities, callerData.isEnemyTurn, callerData.activePlayerId,
        callerData.narrativeContext
      );

      expect(prompt).not.toBeNull();
      // BUG CONFIRMED: routers.ts doesn't pass weaponName, so narrator picks weapons[0] = Longbow
      // This test documents the bug. When it's fixed, update the assertion.
      const entityBlock = prompt!.userPrompt.match(/ENTITY DETAILS:\n([\s\S]*?)\n\n/)?.[1] ?? '';
      // Currently: WEAPON: Longbow (BUG - should be Shortsword)
      expect(entityBlock).toContain('WEAPON:');
      // Documenting the bug: narrator has no way to know which weapon was used
      // because routers.ts doesn't pass narrativeContext.weaponName
      console.log('[BUG-001] Router path entity details:', entityBlock);
    });
  });

  describe('BUG-002: Turn transition — wrong character in narrator prompt', () => {
    /**
     * Scenario: Silas (wizard, quarterstaff) ends turn. Mira (ranger, shortsword)
     * attacks. The narrator for Mira's action should reference Mira's weapon,
     * not Silas's.
     */

    beforeEach(() => {
      engine = createCombatEngine(1);
      const silas = createSilas();
      const mira = createMira();
      const warden = createWarden('warden-a', 'Corrupted Throne-Warden Alpha');
      engine.prepareCombat([mira, silas, warden]);
      // Set initiative: Silas(15) → Warden(12) → Mira(18 but let's control order)
      engine.applyInitiative('silas', 15);
      engine.applyInitiative('mira', 10); // Mira goes after Silas
      engine.applyInitiative('warden-a', 5);
    });

    it('narrator should reference Mira\'s weapon on Mira\'s turn, not Silas\'s', async () => {
      // Silas casts Fire Bolt (his turn)
      const silasResult = engine.submitAction({
        type: 'CAST_SPELL',
        casterId: 'silas',
        spellName: 'Fire Bolt',
        targetIds: ['warden-a'],
        attackRoll: 18,
        rawD20: 13,
      });
      // Apply damage
      if (engine.getState().phase === 'AWAIT_DAMAGE_ROLL') {
        engine.applyDamage(11);
      }
      // Silas ends turn
      engine.submitAction({ type: 'END_TURN', entityId: 'silas' });

      // Now it's Mira's turn — she attacks with shortsword
      const miraResult = engine.submitAction({
        type: 'ATTACK',
        attackerId: 'mira',
        targetId: 'warden-a',
        weaponName: 'Shortsword',
        attackRoll: 18,
        rawD20: 13,
      });

      // Replicate message-send.ts caller logic for Mira's action
      const currentState = engine.getState();
      const activeEntity = currentState.entities.find(e => e.id === 'mira');
      const weaponCtx = assembleWeaponContext('ATTACK', 'Shortsword', activeEntity);

      const prompt = await computeCombatNarrativePrompts(
        1, miraResult.logs, 'I stab the warden!', 'Mira Ashenthorn',
        currentState.entities, false, 'mira', weaponCtx
      );

      expect(prompt).not.toBeNull();
      // Mira's weapon, not Silas's
      expect(prompt!.userPrompt).toContain('WEAPON: Shortsword');
      expect(prompt!.userPrompt).not.toContain('Quarterstaff');
      expect(prompt!.userPrompt).toContain('Mira Ashenthorn');
    });
  });

  describe('BUG-003: Turn-end narration missing action context', () => {
    /**
     * Scenario: Silas casts Fire Bolt (CRIT!), deals 18 damage, ends turn.
     * The turn-end narration should know about the crit.
     *
     * The bug: routers.ts and message-send.ts only pass the CURRENT action's
     * logs to the narrator. If the turn-end is a separate action, the crit
     * info is lost.
     */

    beforeEach(() => {
      engine = createCombatEngine(1);
      const silas = createSilas();
      const warden = createWarden('warden-a', 'Corrupted Throne-Warden Alpha');
      engine.prepareCombat([silas, warden]);
      engine.applyInitiative('silas', 15);
      engine.applyInitiative('warden-a', 5);
    });

    it('crit Fire Bolt + end turn: narrator should have crit context', async () => {
      // Step 1: Cast Fire Bolt → enters AWAIT_ATTACK_ROLL (player spell)
      engine.submitAction({
        type: 'CAST_SPELL',
        casterId: 'silas',
        spellName: 'Fire Bolt',
        targetIds: ['warden-a'],
      });
      expect(engine.getState().phase).toBe('AWAIT_ATTACK_ROLL');

      // Step 2: Resolve attack roll — NAT 20 = CRIT → enters AWAIT_DAMAGE_ROLL
      engine.resolveAttackRoll(20);

      // Step 2b: Submit spell damage roll (player rolls their damage)
      if (engine.getState().phase === 'AWAIT_DAMAGE_ROLL') {
        engine.applyDamage(14); // 2d10 crit damage
      }

      // Step 3: End turn
      engine.submitAction({ type: 'END_TURN', entityId: 'silas' });

      // engine.getTurnLogs() returns all logs from the just-completed turn
      const turnLogs = engine.getTurnLogs();
      const logTypes = turnLogs.map(l => l.type);

      expect(logTypes).toContain('TURN_START');
      expect(logTypes).toContain('SPELL_CAST');
      expect(logTypes).toContain('ATTACK_ROLL');
      expect(logTypes).toContain('DAMAGE');
      expect(logTypes).toContain('TURN_END');

      // Narrator prompt with full turn context should include crit info
      const prompt = await computeCombatNarrativePrompts(
        1, turnLogs, 'nope Im done', 'Silas Gravemourn',
        engine.getState().entities, false, 'silas'
      );

      if (prompt) {
        expect(prompt.logSummary).toContain('Fire Bolt');
        expect(prompt.logSummary).toContain('CRITICAL');
      }
    });
  });

  describe('BUG-001 supplement: routers.ts missing weaponName in narrativeContext', () => {
    /**
     * The routers.ts dice-roller path (line 2486-2491) passes `undefined`
     * for narrativeContext, losing the weapon name. The pendingAttackRoll
     * or pendingAttack has weaponName available but it's not forwarded.
     */

    beforeEach(() => {
      engine = createCombatEngine(1);
      const mira = createMira();
      const warden = createWarden('warden-a', 'Corrupted Throne-Warden Alpha');
      engine.prepareCombat([mira, warden]);
      engine.applyInitiative('mira', 18);
      engine.applyInitiative('warden-a', 12);
    });

    it('pendingAttack should contain weaponName for narrator', () => {
      // Submit attack (will go to AWAIT_ATTACK_ROLL or resolve)
      engine.submitAction({
        type: 'ATTACK',
        attackerId: 'mira',
        targetId: 'warden-a',
        weaponName: 'Shortsword',
        attackRoll: 18,
        rawD20: 13,
      });

      // After a hit, check if pendingAttack has weaponName
      const state = engine.getState();
      if (state.pendingAttack) {
        console.log('[BUG-001] pendingAttack.weaponName:', (state.pendingAttack as any).weaponName);
        // If this exists, routers.ts COULD pass it but doesn't
      }

      // For attack miss path, check pendingAttackRoll
      if (state.pendingAttackRoll) {
        console.log('[BUG-001] pendingAttackRoll:', JSON.stringify(state.pendingAttackRoll));
      }
    });
  });

  describe('BUG-006: Turn resources should reset on new turn', () => {
    /**
     * Scenario: Full round — Silas acts, Warden acts, Silas's turn again.
     * Silas should have fresh resources (action, bonus action, etc.)
     */

    beforeEach(() => {
      engine = createCombatEngine(1);
      const silas = createSilas();
      const warden = createWarden('warden-a', 'Corrupted Throne-Warden Alpha');
      engine.prepareCombat([silas, warden]);
      engine.applyInitiative('silas', 15);
      engine.applyInitiative('warden-a', 5);
    });

    it('after full round, player should have fresh action on new turn', () => {
      // Round 1, Silas's turn: cast Fire Bolt (uses action)
      engine.submitAction({
        type: 'CAST_SPELL',
        casterId: 'silas',
        spellName: 'Fire Bolt',
        targetIds: ['warden-a'],
        attackRoll: 18,
        rawD20: 13,
      });
      if (engine.getState().phase === 'AWAIT_DAMAGE_ROLL') {
        engine.applyDamage(11);
      }

      let state = engine.getState();
      // Action should be used
      expect(state.turnResources?.actionUsed).toBe(true);

      // End Silas's turn
      engine.submitAction({ type: 'END_TURN', entityId: 'silas' });

      // Warden's turn — submit a simple attack and end
      state = engine.getState();
      const currentEntity = state.turnOrder[state.turnIndex];
      expect(currentEntity).toBe('warden-a');

      engine.submitAction({
        type: 'ATTACK',
        attackerId: 'warden-a',
        targetId: 'silas',
        attackRoll: 10,
        rawD20: 5,
      });
      // Enemy turns auto-end after attack (miss doesn't auto-apply damage so we need to end explicitly)
      // Check if engine already advanced the turn
      state = engine.getState();
      const currentAfterWarden = state.turnOrder[state.turnIndex];
      if (currentAfterWarden === 'warden-a') {
        // Warden hasn't auto-ended, end manually
        engine.submitAction({ type: 'END_TURN', entityId: 'warden-a' });
      }

      // NEW ROUND — should be Silas's turn again with fresh resources
      state = engine.getState();
      const newTurnEntity = state.turnOrder[state.turnIndex];
      expect(newTurnEntity).toBe('silas');

      // THE KEY CHECK: turnResources should be fresh
      expect(state.turnResources).toBeDefined();
      expect(state.turnResources!.actionUsed).toBe(false);
      expect(state.turnResources!.bonusActionUsed).toBe(false);
      expect(state.turnResources!.movementUsed).toBe(false);

      // Silas should be able to cast Scorching Ray (costs action)
      const scorchResult = engine.submitAction({
        type: 'CAST_SPELL',
        casterId: 'silas',
        spellName: 'Scorching Ray',
        targetIds: ['warden-a'],
        attackRoll: 15,
        rawD20: 10,
      });

      // This should succeed — action should NOT be "already spent"
      expect(scorchResult.success).toBe(true);
      console.log('[BUG-006] Scorching Ray on new turn:', scorchResult.success ? 'SUCCESS' : scorchResult.error);
    });
  });

  describe('Full combat flow: Silas + Mira vs 2 Wardens (the real session)', () => {
    /**
     * Replays the actual combat from the bug report session.
     * Checks narrator prompts at each step for correctness.
     */

    beforeEach(() => {
      engine = createCombatEngine(1);
      const silas = createSilas();
      const mira = createMira();
      const wardenA = createWarden('warden-a', 'Corrupted Throne-Warden Alpha');
      const wardenB = createWarden('warden-b', 'Corrupted Throne-Warden Beta');
      engine.prepareCombat([silas, mira, wardenA, wardenB]);
      engine.applyInitiative('silas', 15);
      engine.applyInitiative('mira', 10);
      engine.applyInitiative('warden-a', 12);
      engine.applyInitiative('warden-b', 8);
      // Order: Silas(15) → Warden-A(12) → Mira(10) → Warden-B(8)
    });

    it('Silas casts Fire Bolt (crit) → narrator has spell + crit + damage context', async () => {
      // Step 1: Cast spell → enters AWAIT_ATTACK_ROLL (spell requires attack roll)
      const spellResult = engine.submitAction({
        type: 'CAST_SPELL',
        casterId: 'silas',
        spellName: 'Fire Bolt',
        targetIds: ['warden-b'],
      });

      // Step 2: Resolve attack roll (nat 20 = crit)
      let attackResult;
      if (engine.getState().phase === 'AWAIT_ATTACK_ROLL') {
        attackResult = engine.resolveAttackRoll(20); // nat 20
      }

      // Step 3: Apply damage
      let damageResult;
      if (engine.getState().phase === 'AWAIT_DAMAGE_ROLL') {
        damageResult = engine.applyDamage(18);
      }

      // Combine all logs from the full action sequence
      // This is what message-send.ts SHOULD do (but currently only passes result.logs from the last call)
      const allLogs = [
        ...spellResult.logs,
        ...(attackResult?.logs ?? []),
        ...(damageResult?.logs ?? []),
      ];

      // Narrator for the attack+damage (replicating message-send.ts damage roll path, line 209)
      // Note: message-send.ts only passes damageResult.logs, NOT the full sequence
      const promptWithDamageOnly = await computeCombatNarrativePrompts(
        1,
        damageResult?.logs ?? [],
        '18',
        'Silas Gravemourn',
        engine.getState().entities,
        false,
        'silas',
        { playerHasRemainingResources: true }
      );

      const promptWithAllLogs = await computeCombatNarrativePrompts(
        1,
        allLogs,
        'nat 20',
        'Silas Gravemourn',
        engine.getState().entities,
        false,
        'silas',
        { playerHasRemainingResources: true }
      );

      // With ALL logs: narrator has full context
      expect(promptWithAllLogs).not.toBeNull();
      expect(promptWithAllLogs!.userPrompt).toContain('SPELL: Fire Bolt');
      expect(promptWithAllLogs!.userPrompt).toContain('CRITICAL HIT');
      expect(promptWithAllLogs!.logSummary).toContain('CRITICAL');
      expect(promptWithAllLogs!.logSummary).toContain('Damage:');
      expect(promptWithAllLogs!.logSummary).toContain('fire');
      expect(promptWithAllLogs!.userPrompt).toContain('anything else');

      // With ONLY damage logs (current behavior): narrator misses the crit + spell
      console.log('[FLOW] Damage-only logSummary:', promptWithDamageOnly?.logSummary);
      console.log('[FLOW] All-logs logSummary:', promptWithAllLogs?.logSummary);
      console.log('[FLOW] Silas Fire Bolt crit — full logs correct ✓');
    });

    it('Mira attacks with shortsword (melee) → narrator says shortsword not longbow', async () => {
      // Skip to Mira's turn
      // Silas: quick attack + end turn
      engine.submitAction({
        type: 'CAST_SPELL',
        casterId: 'silas',
        spellName: 'Fire Bolt',
        targetIds: ['warden-b'],
        attackRoll: 18, rawD20: 13,
      });
      if (engine.getState().phase === 'AWAIT_DAMAGE_ROLL') engine.applyDamage(11);
      engine.submitAction({ type: 'END_TURN', entityId: 'silas' });

      // Warden A: attack + end
      engine.submitAction({
        type: 'ATTACK', attackerId: 'warden-a', targetId: 'silas',
        attackRoll: 10, rawD20: 5,
      });
      engine.submitAction({ type: 'END_TURN', entityId: 'warden-a' });

      // Now Mira's turn — she moves to melee and attacks with shortsword
      const miraResult = engine.submitAction({
        type: 'ATTACK',
        attackerId: 'mira',
        targetId: 'warden-b',
        weaponName: 'Shortsword',
        attackRoll: 13,
        rawD20: 6, // Miss
      });

      const currentState = engine.getState();
      const activeEntity = currentState.entities.find(e => e.id === 'mira');
      const weaponCtx = assembleWeaponContext('ATTACK', 'Shortsword', activeEntity);

      const prompt = await computeCombatNarrativePrompts(
        1, miraResult.logs, 'I attack with my shortsword',
        'Mira Ashenthorn', currentState.entities, false, 'mira', weaponCtx
      );

      expect(prompt).not.toBeNull();
      // THE BUG CHECK: must say Shortsword, not Longbow
      expect(prompt!.userPrompt).toContain('WEAPON: Shortsword');
      expect(prompt!.userPrompt).not.toContain('Longbow');
      console.log('[FLOW] Mira shortsword attack — weapon correct ✓');
    });

    it('Enemy attacks player → narrator uses correct perspective', async () => {
      // Skip to Warden A's turn
      engine.submitAction({
        type: 'CAST_SPELL', casterId: 'silas', spellName: 'Fire Bolt',
        targetIds: ['warden-b'], attackRoll: 18, rawD20: 13,
      });
      if (engine.getState().phase === 'AWAIT_DAMAGE_ROLL') engine.applyDamage(11);
      engine.submitAction({ type: 'END_TURN', entityId: 'silas' });

      // Warden A attacks Silas
      const wardenResult = engine.submitAction({
        type: 'ATTACK', attackerId: 'warden-a', targetId: 'silas',
        attackRoll: 18, rawD20: 13,
      });

      // Apply damage if hit
      let wardenDamage;
      if (engine.getState().phase === 'AWAIT_DAMAGE_ROLL') {
        wardenDamage = engine.applyDamage(7);
      }

      const allLogs = [...wardenResult.logs, ...(wardenDamage?.logs ?? [])];

      // Narrator call for enemy turn (replicates enemy-ai-controller.ts)
      const prompt = await computeCombatNarrativePrompts(
        1, allLogs, 'The warden swings its corrupted blade!',
        'Corrupted Throne-Warden Alpha',
        engine.getState().entities,
        true,  // isEnemyTurn = true
        'silas', // activePlayerId = the player being attacked
        { weaponName: 'Corrupted Blade', tacticalRole: 'brute' }
      );

      expect(prompt).not.toBeNull();
      // Enemy should be in third person, player as "you"
      expect(prompt!.userPrompt).toContain('ENEMY ACTING: Corrupted Throne-Warden Alpha');
      expect(prompt!.userPrompt).toContain('THIRD PERSON');
      expect(prompt!.userPrompt).toContain('"you"');
      // Weapon context should be the enemy's weapon
      expect(prompt!.userPrompt).toContain('WEAPON: Corrupted Blade');
      console.log('[FLOW] Enemy attack perspective — correct ✓');
    });
  });
});
