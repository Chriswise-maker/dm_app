import type { Combatant } from '../drizzle/schema';
import type { TrpcContext } from './_core/context';
import type { SkillName } from './skill-check';

export type MessageSendInput = {
  sessionId: number;
  characterId: number;
  message: string;
  apiKey?: string;
  model?: 'claude' | 'gpt';
};

export type MessageSendResult = {
  response: string;
  combatTriggered: boolean;
  enemiesAdded: number;
};

export type MessageSendStreamHooks = {
  onNarrativeDelta?: (delta: string) => void;
};

async function streamToString(
  stream: AsyncIterable<string>,
  onDelta?: (d: string) => void
): Promise<string> {
  let full = '';
  for await (const chunk of stream) {
    full += chunk;
    if (chunk && onDelta) onDelta(chunk);
  }
  return full;
}

/** Quick check: does a message look like a question rather than a dice roll? */
function looksLikeQuestion(message: string): boolean {
  const trimmed = message.trim().toLowerCase();
  if (!trimmed) return false;
  return trimmed.includes('?')
    || /^(can i|could i|do i|am i|may i|should i|what|how|where|who|when|why|which)\b/.test(trimmed);
}

function formatCombatParserError(error: string): string {
  if (error.startsWith('Could not find target:')) {
    return `I couldn't identify that target. Try naming the creature directly.`;
  }
  if (error === 'No spell name detected') {
    return `Tell me which spell you're casting.`;
  }
  if (error.startsWith('Player does not know spell:')) {
    const spellName = error.replace('Player does not know spell:', '').trim();
    return spellName
      ? `I don't see ${spellName} in your current combat spell list.`
      : `I don't see that spell in your current combat spell list.`;
  }
  return error;
}

function formatCombatExecutionError(error?: string): string {
  if (!error) {
    return `That action couldn't be completed right now.`;
  }
  if (error.startsWith('No action available for')) {
    const actionName = error.replace('No action available for', '').trim();
    return `You can't ${actionName.toLowerCase()} right now because your action is already spent.`;
  }
  if (error.startsWith('No movement remaining')) {
    return `You don't have any movement left this turn.`;
  }
  return error;
}

export async function executeMessageSend(
  ctx: TrpcContext,
  input: MessageSendInput,
  streamHooks?: MessageSendStreamHooks
): Promise<MessageSendResult> {
  if (!ctx.user) {
    throw new Error('Unauthorized');
  }

  const db = await import('./db');
  const { invokeLLMWithSettings } = await import('./llm-with-settings');
  const { buildChatSystemPrompt, buildChatUserPrompt, buildCombatQueryPrompt, formatCharacterSheet, formatCharacterSheetForCombat, getSkillProficiencies } = await import('./prompts');
  const { parseStructuredResponse, hasCombatInitiation, hasCombatEnd, getEnemies } = await import('./response-parser');
  const { handleAutoCombatInitiation, handleAutoCombatEnd } = await import('./combat/combat-helpers');
  const { CombatEngineManager } = await import('./combat/combat-engine-manager');
  const { isPlayerTurn, parsePlayerAction } = await import('./combat/player-action-parser');
  const { generateCombatNarrativeStream } = await import('./combat/combat-narrator');

  // Get context
  const character = await db.getCharacter(input.characterId);
  if (!character) throw new Error('Character not found');

  const session = await db.getSession(input.sessionId);
  if (!session) throw new Error('Session not found');

  const recentMessages = await db.getSessionMessages(input.sessionId, 10);
  const stats = JSON.parse(character.stats);
  const inventory = JSON.parse(character.inventory);

  // Get extracted context
  const storedContext = await db.getSessionContext(input.sessionId);
  const context = db.parseSessionContext(storedContext);

  // Get combat state if in combat
  const existingCombatState = await db.getCombatState(input.sessionId);
  let combatants: Combatant[] = [];
  if (existingCombatState && existingCombatState.inCombat === 1) {
    combatants = await db.getCombatants(existingCombatState.id);
    combatants.sort((a, b) => b.initiative - a.initiative);
  }

  // =====================================================================
  // PHASE 4.2: COMBAT ENGINE V2 INTEGRATION
  // =====================================================================

  // Check if V2 engine is active
  const engine = CombatEngineManager.get(input.sessionId);
  const enginePhase = engine?.getState().phase;

  // Handle AWAIT_DAMAGE_ROLL phase - player needs to provide damage roll
  if (engine && enginePhase === 'AWAIT_DAMAGE_ROLL') {
    console.log('[CombatV2] In damage roll phase, extracting damage value');

    // Check if the player is asking a question instead of providing a roll
    if (looksLikeQuestion(input.message)) {
      const state = engine.getState();
      const currentEntityId = state.pendingAttack?.attackerId;
      const currentEntity = currentEntityId ? state.entities.find(e => e.id === currentEntityId) : null;
      const queryPrompt = buildCombatQueryPrompt({
        battleState: state,
        focusEntityId: currentEntityId,
        characterSheetText: currentEntity
          ? formatCharacterSheetForCombat(character, currentEntity)
          : formatCharacterSheet(character),
        resourceStatus: 'Awaiting damage roll',
        actionList: `Currently waiting for damage roll (${state.pendingAttack?.damageFormula})`,
        question: input.message,
      });
      const { invokeLLMWithSettings } = await import('./llm-with-settings');
      const queryResult = await invokeLLMWithSettings(ctx.user.id, {
        messages: [
          { role: 'system', content: 'You are a D&D 5e Dungeon Master. Answer combat questions concisely. After answering, remind the player to roll their damage.' },
          { role: 'user', content: queryPrompt },
        ],
        max_tokens: 500,
      });
      const rawContent = queryResult.choices?.[0]?.message?.content;
      const queryResponse = (typeof rawContent === 'string' ? rawContent : null)
        || `I'm not sure how to answer that. You still need to roll damage (${state.pendingAttack?.damageFormula}).`;
      await db.saveMessage({ sessionId: input.sessionId, characterName: character.name, content: input.message, isDm: 0 });
      await db.saveMessage({ sessionId: input.sessionId, characterName: 'DM', content: queryResponse, isDm: 1 });
      return { response: queryResponse, combatTriggered: false, enemiesAdded: 0 };
    }

    // Extract damage number from message
    const damageMatch = input.message.match(/(\d+)/);
    if (!damageMatch) {
      // No number found, prompt player to provide damage
      await db.saveMessage({
        sessionId: input.sessionId,
        characterName: character.name,
        content: input.message,
        isDm: 0
      });
      await db.saveMessage({
        sessionId: input.sessionId,
        characterName: 'DM',
        content: `I need the damage roll result. Roll your damage dice (${engine.getState().pendingAttack?.damageFormula}) and tell me the number.`,
        isDm: 1
      });
      return {
        response: `I need the damage roll result. Roll your damage dice (${engine.getState().pendingAttack?.damageFormula}) and tell me the number.`,
        combatTriggered: false,
        enemiesAdded: 0,
      };
    }

    const damageRoll = parseInt(damageMatch[1], 10);
    console.log(`[CombatV2] Extracted damage roll: ${damageRoll}`);

    // Capture pending attack context before applyDamage clears it
    const pendingCtx = engine.getState().pendingAttack;
    const attackerId = pendingCtx?.attackerId;

    // Apply damage through engine
    const result = engine.applyDamage(damageRoll);

    if (!result.success) {
      await db.saveMessage({ sessionId: input.sessionId, characterName: character.name, content: input.message, isDm: 0 });
      await db.saveMessage({ sessionId: input.sessionId, characterName: 'DM', content: result.error ?? 'Something went wrong with that roll.', isDm: 1 });
      return { response: result.error ?? 'Invalid roll.', combatTriggered: false, enemiesAdded: 0 };
    }

    await CombatEngineManager.persist(input.sessionId);
    const { syncCombatStateToDb } = await import('./combat/combat-helpers');
    await syncCombatStateToDb(input.sessionId);

    // Generate narrative — this is the single narration covering the entire attack (hit + damage)
    const currentState = engine.getState();
    const stillPlayersTurn = currentState.phase === 'ACTIVE'
        && engine.getCurrentTurnEntity()?.type === 'player';
    const hasRemainingResources = stillPlayersTurn && currentState.turnResources
        ? (!currentState.turnResources.actionUsed || !currentState.turnResources.bonusActionUsed)
        : false;

    const narrative = await streamToString(
      await generateCombatNarrativeStream(
        input.sessionId,
        ctx.user.id,
        result.logs,
        input.message,
        character.name,
        currentState.entities,
        false,
        attackerId,
        {
          weaponName: pendingCtx?.weaponName,
          playerHasRemainingResources: hasRemainingResources || undefined,
        }
      ),
      streamHooks?.onNarrativeDelta
    );

    // Save messages
    await db.saveMessage({
      sessionId: input.sessionId,
      characterName: character.name,
      content: input.message,
      isDm: 0
    });
    await db.saveMessage({
      sessionId: input.sessionId,
      characterName: 'DM',
      content: narrative,
      isDm: 1
    });

    // Check if combat ended
    if (currentState.phase === 'RESOLVED') {
      console.log('[CombatV2] Combat ended after damage, destroying engine');
      await CombatEngineManager.destroy(input.sessionId);
    } else {
      // Trigger AI loop if turn passed to enemy or non-active player
      const nextEntity = engine.getCurrentTurnEntity();
      if (nextEntity && (nextEntity.type === 'enemy' || nextEntity.dbCharacterId !== character.id)) {
        const { runAILoop } = await import('./combat/enemy-ai-controller');
        console.log(`[CombatV2] Turn passed to ${nextEntity.name}, triggering AI loop...`);
        runAILoop(input.sessionId, ctx.user.id, character.id).catch(err => {
          console.error('[CombatV2] AI loop error:', err);
        });
      }
    }

    return {
      response: narrative,
      combatTriggered: false,
      enemiesAdded: 0,
    };
  }

  // Handle AWAIT_SAVE_ROLL phase - player provides their saving throw via chat
  if (engine && enginePhase === 'AWAIT_SAVE_ROLL') {
    console.log('[CombatV2] In save roll phase, extracting roll value from chat');

    if (looksLikeQuestion(input.message)) {
      const pending = engine.getState().pendingSpellSave;
      const saveDC = pending?.spellSaveDC ?? '?';
      const saveStat = pending?.saveStat ?? '?';
      const spellName = pending?.spellName ?? 'a spell';
      await db.saveMessage({ sessionId: input.sessionId, characterName: character.name, content: input.message, isDm: 0 });
      const answer = `You need to make a **${saveStat} saving throw** (DC ${saveDC}) against ${spellName}. Roll a d20 and tell me the result.`;
      await db.saveMessage({ sessionId: input.sessionId, characterName: 'DM', content: answer, isDm: 1 });
      return { response: answer, combatTriggered: false, enemiesAdded: 0 };
    }

    const pending = engine.getState().pendingSpellSave;
    const targetEntityId = pending?.pendingTargetIds[0];
    const targetEntity = targetEntityId ? engine.getEntity(targetEntityId) : null;
    const rollMatch = input.message.match(/\b(\d{1,2})\b/);

    if (!pending || !targetEntityId || !targetEntity) {
      return { response: 'No save is pending right now.', combatTriggered: false, enemiesAdded: 0 };
    }

    if (!rollMatch) {
      await db.saveMessage({
        sessionId: input.sessionId,
        characterName: character.name,
        content: input.message,
        isDm: 0,
      });
      await db.saveMessage({
        sessionId: input.sessionId,
        characterName: 'DM',
        content: `${targetEntity.name} needs to roll a ${pending.saveStat} saving throw against ${pending.spellName} (DC ${pending.spellSaveDC}). Use the dice roller or type the d20 result.`,
        isDm: 1,
      });
      return { response: `Roll a ${pending.saveStat} save for ${targetEntity.name} (DC ${pending.spellSaveDC}).`, combatTriggered: false, enemiesAdded: 0 };
    }

    const rawRoll = parseInt(rollMatch[1], 10);
    if (rawRoll < 1 || rawRoll > 20) {
      await db.saveMessage({ sessionId: input.sessionId, characterName: character.name, content: input.message, isDm: 0 });
      await db.saveMessage({ sessionId: input.sessionId, characterName: 'DM', content: `That doesn't look like a valid d20 roll. Roll a d20 (1-20) and tell me the result.`, isDm: 1 });
      return { response: `Roll a d20 (1-20) for the saving throw.`, combatTriggered: false, enemiesAdded: 0 };
    }

    const result = engine.submitSavingThrow(targetEntityId, rawRoll);
    if (!result.success) {
      await db.saveMessage({ sessionId: input.sessionId, characterName: character.name, content: input.message, isDm: 0 });
      await db.saveMessage({ sessionId: input.sessionId, characterName: 'DM', content: result.error ?? 'Something went wrong with that saving throw.', isDm: 1 });
      return { response: result.error ?? 'Invalid saving throw.', combatTriggered: false, enemiesAdded: 0 };
    }

    await CombatEngineManager.persist(input.sessionId);
    const { syncCombatStateToDb } = await import('./combat/combat-helpers');
    await syncCombatStateToDb(input.sessionId);

    const currentState = engine.getState();
    const narrative = await streamToString(
      await generateCombatNarrativeStream(
        input.sessionId,
        ctx.user.id,
        result.logs,
        input.message,
        character.name,
        currentState.entities,
        false,
        targetEntityId
      ),
      streamHooks?.onNarrativeDelta
    );

    await db.saveMessage({ sessionId: input.sessionId, characterName: character.name, content: input.message, isDm: 0 });
    await db.saveMessage({ sessionId: input.sessionId, characterName: 'DM', content: narrative, isDm: 1 });

    if (currentState.phase === 'RESOLVED') {
      await CombatEngineManager.destroy(input.sessionId);
    } else {
      const nextEntity = engine.getCurrentTurnEntity();
      if (nextEntity && (nextEntity.type === 'enemy' || nextEntity.dbCharacterId !== character.id)) {
        const { runAILoop } = await import('./combat/enemy-ai-controller');
        runAILoop(input.sessionId, ctx.user.id, character.id).catch(err => console.error('[CombatV2] AI loop error:', err));
      }
    }

    return { response: narrative, combatTriggered: false, enemiesAdded: 0 };
  }

  if (engine && enginePhase === 'AWAIT_DEATH_SAVE') {
    console.log('[CombatV2] In death save phase, extracting roll value from chat');

    const currentEntity = engine.getCurrentTurnEntity();
    const rollMatch = input.message.match(/\b(\d{1,2})\b/);

    if (!currentEntity) {
      return { response: 'No death save is pending right now.', combatTriggered: false, enemiesAdded: 0 };
    }

    if (!rollMatch) {
      await db.saveMessage({
        sessionId: input.sessionId,
        characterName: character.name,
        content: input.message,
        isDm: 0,
      });
      await db.saveMessage({
        sessionId: input.sessionId,
        characterName: 'DM',
        content: `${currentEntity.name} must make a death saving throw. Use the dice roller or type the d20 result.`,
        isDm: 1,
      });
      return { response: `${currentEntity.name} needs a death save roll.`, combatTriggered: false, enemiesAdded: 0 };
    }

    const rawRoll = parseInt(rollMatch[1], 10);
    if (rawRoll < 1 || rawRoll > 20) {
      await db.saveMessage({ sessionId: input.sessionId, characterName: character.name, content: input.message, isDm: 0 });
      await db.saveMessage({ sessionId: input.sessionId, characterName: 'DM', content: `That doesn't look like a valid d20 roll. Roll a d20 (1-20) and tell me the result.`, isDm: 1 });
      return { response: `Roll a d20 (1-20) for the death save.`, combatTriggered: false, enemiesAdded: 0 };
    }

    const result = engine.rollDeathSave(currentEntity.id, rawRoll);
    if (!result.success) {
      await db.saveMessage({ sessionId: input.sessionId, characterName: character.name, content: input.message, isDm: 0 });
      await db.saveMessage({ sessionId: input.sessionId, characterName: 'DM', content: result.error ?? 'Something went wrong with that death save.', isDm: 1 });
      return { response: result.error ?? 'Invalid death save.', combatTriggered: false, enemiesAdded: 0 };
    }

    await CombatEngineManager.persist(input.sessionId);
    const { syncCombatStateToDb } = await import('./combat/combat-helpers');
    await syncCombatStateToDb(input.sessionId);

    const currentState = engine.getState();
    const narrative = await streamToString(
      await generateCombatNarrativeStream(
        input.sessionId,
        ctx.user.id,
        result.logs,
        input.message,
        character.name,
        currentState.entities,
        false,
        currentEntity.id
      ),
      streamHooks?.onNarrativeDelta
    );

    await db.saveMessage({ sessionId: input.sessionId, characterName: character.name, content: input.message, isDm: 0 });
    await db.saveMessage({ sessionId: input.sessionId, characterName: 'DM', content: narrative, isDm: 1 });

    if (currentState.phase === 'RESOLVED') {
      await CombatEngineManager.destroy(input.sessionId);
    } else {
      const nextEntity = engine.getCurrentTurnEntity();
      if (nextEntity && (nextEntity.type === 'enemy' || nextEntity.dbCharacterId !== character.id)) {
        const { runAILoop } = await import('./combat/enemy-ai-controller');
        runAILoop(input.sessionId, ctx.user.id, character.id).catch(err => console.error('[CombatV2] AI loop error:', err));
      }
    }

    return { response: narrative, combatTriggered: false, enemiesAdded: 0 };
  }

  if (engine && enginePhase === 'AWAIT_ATTACK_ROLL') {
    console.log('[CombatV2] In attack roll phase, extracting roll value from chat');

    if (looksLikeQuestion(input.message)) {
      const pending = engine.getState().pendingAttackRoll;
      await db.saveMessage({ sessionId: input.sessionId, characterName: character.name, content: input.message, isDm: 0 });
      const answer = `You need to roll a **d20** for your attack roll. Use the dice roller in the sidebar or type the number (e.g. "15").`;
      await db.saveMessage({ sessionId: input.sessionId, characterName: 'DM', content: answer, isDm: 1 });
      return { response: answer, combatTriggered: false, enemiesAdded: 0 };
    }

    const rollMatch = input.message.match(/\b(\d{1,2})\b/);
    if (!rollMatch) {
      // No number found - remind the player to use the dice roller or type a number
      await db.saveMessage({
        sessionId: input.sessionId,
        characterName: character.name,
        content: input.message,
        isDm: 0
      });
      await db.saveMessage({
        sessionId: input.sessionId,
        characterName: 'DM',
        content: `Use the **dice roller** in the sidebar to roll your attack, or type your d20 result (e.g. "I rolled 15").`,
        isDm: 1
      });
      return { response: `Use the dice roller in the sidebar, or type your d20 roll result.`, combatTriggered: false, enemiesAdded: 0 };
    }

    const rawRoll = parseInt(rollMatch[1], 10);
    if (rawRoll < 1 || rawRoll > 20) {
      await db.saveMessage({ sessionId: input.sessionId, characterName: character.name, content: input.message, isDm: 0 });
      await db.saveMessage({ sessionId: input.sessionId, characterName: 'DM', content: `That doesn't look like a valid d20 roll. Roll a d20 (1-20) and tell me the result!`, isDm: 1 });
      return { response: `Roll a d20 (1-20) for your attack roll.`, combatTriggered: false, enemiesAdded: 0 };
    }

    console.log(`[CombatV2] Extracted attack roll: ${rawRoll}`);
    // Capture pending state before resolveAttackRoll clears it
    const pendingAttackRoll = engine.getState().pendingAttackRoll;
    const result = engine.resolveAttackRoll(rawRoll);

    if (!result.success) {
      await db.saveMessage({ sessionId: input.sessionId, characterName: character.name, content: input.message, isDm: 0 });
      await db.saveMessage({ sessionId: input.sessionId, characterName: 'DM', content: result.error ?? 'Something went wrong with that roll.', isDm: 1 });
      return { response: result.error ?? 'Invalid roll.', combatTriggered: false, enemiesAdded: 0 };
    }

    await CombatEngineManager.persist(input.sessionId);
    const { syncCombatStateToDb } = await import('./combat/combat-helpers');
    await syncCombatStateToDb(input.sessionId);

    const currentState = engine.getState();
    const isAwaitingDamage = currentState.phase === 'AWAIT_DAMAGE_ROLL' && !!currentState.pendingAttack;

    await db.saveMessage({ sessionId: input.sessionId, characterName: character.name, content: input.message, isDm: 0 });

    let dmContent: string;
    if (isAwaitingDamage && currentState.pendingAttack) {
      // HIT — skip narration here; one combined narration will be generated after damage roll
      const critNote = currentState.pendingAttack.isCritical ? ' **Critical hit!** DOUBLE DICE!' : '';
      dmContent = `**Hit!**${critNote} Roll your damage (${currentState.pendingAttack.damageFormula}).`;
      streamHooks?.onNarrativeDelta?.(dmContent);
    } else {
      // MISS or other outcome — generate narration now since there's no damage roll to follow
      dmContent = await streamToString(
        await generateCombatNarrativeStream(
          input.sessionId,
          ctx.user.id,
          result.logs,
          input.message,
          character.name,
          currentState.entities,
          false,
          pendingAttackRoll?.attackerId,
          {
            ...(pendingAttackRoll?.weaponName ? { weaponName: pendingAttackRoll.weaponName } : {}),
          }
        ),
        streamHooks?.onNarrativeDelta
      );
    }

    await db.saveMessage({ sessionId: input.sessionId, characterName: 'DM', content: dmContent, isDm: 1 });

    if (currentState.phase === 'RESOLVED') {
      await CombatEngineManager.destroy(input.sessionId);
    } else {
      const nextEntity = engine.getCurrentTurnEntity();
      if (nextEntity && (nextEntity.type === 'enemy' || nextEntity.dbCharacterId !== character.id)) {
        const { runAILoop } = await import('./combat/enemy-ai-controller');
        runAILoop(input.sessionId, ctx.user.id, character.id).catch(err => console.error('[CombatV2] AI loop error:', err));
      }
    }

    return { response: dmContent, combatTriggered: false, enemiesAdded: 0 };
  }

  // Handle AWAIT_INITIATIVE phase - player needs to provide initiative roll
  if (engine && enginePhase === 'AWAIT_INITIATIVE') {
    console.log('[CombatV2] In initiative phase, extracting initiative value');

    // Extract initiative number from message
    const initiativeMatch = input.message.match(/(\d+)/);
    if (!initiativeMatch) {
      // No number found, prompt player to provide initiative
      await db.saveMessage({
        sessionId: input.sessionId,
        characterName: character.name,
        content: input.message,
        isDm: 0
      });
      await db.saveMessage({
        sessionId: input.sessionId,
        characterName: 'DM',
        content: `I need your initiative roll. Roll a d20 and add your initiative modifier, then tell me the result!`,
        isDm: 1
      });
      return {
        response: `I need your initiative roll. Roll a d20 and add your initiative modifier, then tell me the result!`,
        combatTriggered: true,
        enemiesAdded: 0,
      };
    }

    const initiativeRoll = parseInt(initiativeMatch[1], 10);
    console.log(`[CombatV2] Extracted initiative roll: ${initiativeRoll}`);

    // Find which player entity this character corresponds to.
    // If this character already rolled, apply to the next pending character instead
    // (supports single-player controlling multiple characters via chat).
    let playerEntityId = `player-${character.id}`;
    const pendingIds = engine.getState().pendingInitiative?.pendingEntityIds ?? [];
    if (!pendingIds.includes(playerEntityId) && pendingIds.length > 0) {
      playerEntityId = pendingIds[0];
      console.log(`[CombatV2] Character already rolled, applying to next pending: ${playerEntityId}`);
    }
    const result = engine.applyInitiative(playerEntityId, initiativeRoll);

    if (result.logs.length > 0) {
      await CombatEngineManager.persist(input.sessionId);
      const { syncCombatStateToDb } = await import('./combat/combat-helpers');
      await syncCombatStateToDb(input.sessionId);
    }

    // Save player message
    await db.saveMessage({
      sessionId: input.sessionId,
      characterName: character.name,
      content: input.message,
      isDm: 0
    });

    if (result.combatStarted) {
      // Combat started! Generate narrative about turn order
      const currentState = engine.getState();
      const turnOrderNames = currentState.turnOrder.map(id => {
        const entity = currentState.entities.find(e => e.id === id);
        return entity ? `${entity.name} (${entity.initiative})` : id;
      }).join(' → ');

      const firstEntity = currentState.entities.find(e => e.id === currentState.turnOrder[0]);
      const narrativeResponse = `**Initiative set!** The battle begins!\n\n**Turn Order:** ${turnOrderNames}\n\n*${firstEntity?.name}'s turn!*`;

      await db.saveMessage({
        sessionId: input.sessionId,
        characterName: 'DM',
        content: narrativeResponse,
        isDm: 1
      });

      // Trigger AI loop if first turn is an enemy or non-active player
      if (firstEntity && (firstEntity.type === 'enemy' || firstEntity.dbCharacterId !== character.id)) {
        const { runAILoop } = await import('./combat/enemy-ai-controller');
        console.log(`[CombatV2] First turn is ${firstEntity.name}, triggering AI loop...`);
        runAILoop(input.sessionId, ctx.user.id, character.id).catch(err => {
          console.error('[CombatV2] AI loop error:', err);
        });
      }

      return {
        response: narrativeResponse,
        combatTriggered: true,
        enemiesAdded: 0,
      };
    } else {
      // Still waiting for other players
      const remainingNames = result.remainingPlayers.map(id => {
        const entity = engine.getState().entities.find(e => e.id === id);
        return entity?.name || id;
      }).join(', ');

      const waitingMessage = `Got it! Still waiting for initiative from: **${remainingNames}**`;

      await db.saveMessage({
        sessionId: input.sessionId,
        characterName: 'DM',
        content: waitingMessage,
        isDm: 1
      });

      return {
        response: waitingMessage,
        combatTriggered: true,
        enemiesAdded: 0,
      };
    }
  }

  const longRestMatch = input.message.match(/\b(long rest|take a long rest|rest for the night|camp for the night)\b/i);
  const shortRestMatch = input.message.match(/\b(short rest|take a short rest|take a breather|catch our breath)\b/i);
  if (longRestMatch || shortRestMatch) {
    const isCombatOngoing = !!engine && enginePhase && enginePhase !== 'IDLE' && enginePhase !== 'RESOLVED';
    if (isCombatOngoing) {
      await db.saveMessage({ sessionId: input.sessionId, characterName: character.name, content: input.message, isDm: 0 });
      await db.saveMessage({ sessionId: input.sessionId, characterName: 'DM', content: `You can't take a ${longRestMatch ? 'long' : 'short'} rest during combat.`, isDm: 1 });
      return { response: `You can't rest during combat.`, combatTriggered: false, enemiesAdded: 0 };
    }

    const { detectHitDiceToSpend, getCharacterResourceState, resolveLongRest, resolveShortRest, setCharacterResourceState } = await import('./rest');
    const sessionCharacters = await db.getSessionCharacters(input.sessionId);
    const storedContext = await db.getSessionContext(input.sessionId);
    const parsedContext = db.parseSessionContext(storedContext);
    let worldState = parsedContext.worldState;
    const hitDiceToSpend = detectHitDiceToSpend(input.message);

    const { ActorStateSchema } = await import('./kernel/actor-state');
    const summaries: string[] = [];
    for (const sessionCharacter of sessionCharacters) {
      const resourceState = getCharacterResourceState(worldState, sessionCharacter);
      if (longRestMatch) {
        const result = resolveLongRest(sessionCharacter, resourceState);
        await db.updateCharacterHP(sessionCharacter.id, result.hpAfter);
        worldState = setCharacterResourceState(worldState, sessionCharacter.id, result.resourceState);
        summaries.push(result.summary);

        // Sync actorState for long rest
        if (sessionCharacter.actorState && sessionCharacter.actorSheet) {
          try {
            const state = ActorStateSchema.parse(JSON.parse(sessionCharacter.actorState));
            const sheet = JSON.parse(sessionCharacter.actorSheet);
            state.hpCurrent = state.hpMax;
            // Restore all spell slots from sheet
            if (sheet.spellcasting?.spellSlots) {
              for (const [level, max] of Object.entries(sheet.spellcasting.spellSlots)) {
                state.spellSlotsCurrent[level] = max as number;
              }
            }
            // Restore hit dice: up to half level (rounded up)
            const halfLevel = Math.max(1, Math.ceil(sheet.level / 2));
            state.hitDiceCurrent = Math.min(sheet.level, state.hitDiceCurrent + halfLevel);
            // Restore feature uses for long_rest features
            if (sheet.features) {
              for (const feature of sheet.features) {
                if (feature.rechargeOn === 'long_rest' && feature.usesMax != null) {
                  state.featureUses[feature.name] = feature.usesMax;
                }
              }
            }
            // Reduce exhaustion by 1
            if (state.exhaustion > 0) state.exhaustion -= 1;
            // Clear concentration and death saves
            state.concentration = null;
            state.deathSaves = { successes: 0, failures: 0 };
            await db.updateCharacter(sessionCharacter.id, { actorState: JSON.stringify(state) });
          } catch (e) {
            console.warn('[ActorState] Failed to sync long rest:', e);
          }
        }
      } else {
        // Only apply explicit hit dice count to the speaking character; others spend 1 by default
        const diceForThisChar = sessionCharacter.id === character.id ? hitDiceToSpend : undefined;
        const result = resolveShortRest(sessionCharacter, resourceState, { hitDiceToSpend: diceForThisChar });
        await db.updateCharacterHP(sessionCharacter.id, result.hpAfter);
        worldState = setCharacterResourceState(worldState, sessionCharacter.id, result.resourceState);
        summaries.push(result.summary);

        // Sync actorState for short rest
        if (sessionCharacter.actorState && sessionCharacter.actorSheet) {
          try {
            const state = ActorStateSchema.parse(JSON.parse(sessionCharacter.actorState));
            const sheet = JSON.parse(sessionCharacter.actorSheet);
            state.hpCurrent = result.hpAfter;
            state.hitDiceCurrent = Math.max(0, state.hitDiceCurrent - result.hitDiceSpent);
            // Restore feature uses for short_rest features
            if (sheet.features) {
              for (const feature of sheet.features) {
                if (feature.rechargeOn === 'short_rest' && feature.usesMax != null) {
                  state.featureUses[feature.name] = feature.usesMax;
                }
              }
            }
            await db.updateCharacter(sessionCharacter.id, { actorState: JSON.stringify(state) });
          } catch (e) {
            console.warn('[ActorState] Failed to sync short rest:', e);
          }
        }
      }
    }

    await db.upsertSessionContext(input.sessionId, {
      ...parsedContext,
      worldState,
      recentEvent: longRestMatch ? 'The party completes a long rest.' : 'The party takes a short rest.',
    });

    const restNarrative = summaries.join('\n');
    await db.saveMessage({ sessionId: input.sessionId, characterName: character.name, content: input.message, isDm: 0 });
    await db.saveMessage({ sessionId: input.sessionId, characterName: 'DM', content: restNarrative, isDm: 1 });
    return { response: restNarrative, combatTriggered: false, enemiesAdded: 0 };
  }

  const isV2CombatActive = engine && enginePhase === 'ACTIVE';

  if (isV2CombatActive && isPlayerTurn(input.sessionId)) {
    console.log('[CombatV2] Intercepting chat for player turn');

    // 1. Parse player action from chat
    const parsed = await parsePlayerAction(input.sessionId, ctx.user.id, input.message, recentMessages);

    // QUERY: player is asking about options/rules — respond with legal actions, don't consume turn
    if (parsed.error === 'QUERY') {
      const state = engine!.getState();
      const currentEntityId = state.turnOrder[state.turnIndex];
      const legalActions = engine!.getLegalActions(currentEntityId);
      const turnRes = state.turnResources;
      const currentEntity = state.entities.find(e => e.id === currentEntityId);

      // Build context for the LLM to answer the question
      const resourceStatus = turnRes
        ? [
            turnRes.actionUsed ? '~~Action~~ (used)' : '**Action** (available)',
            turnRes.bonusActionUsed ? '~~Bonus Action~~ (used)' : '**Bonus Action** (available)',
            turnRes.reactionUsed ? '~~Reaction~~ (used)' : '**Reaction** (available)',
            turnRes.extraAttacksRemaining > 0 ? `**Extra Attacks**: ${turnRes.extraAttacksRemaining} remaining` : null,
          ].filter(Boolean).join(', ')
        : 'Action, Bonus Action, Reaction';

      const actionList = legalActions
        .map(a => `• **${a.type}**${a.description ? ` — ${a.description}` : ''}`)
        .join('\n');

      const queryPrompt = buildCombatQueryPrompt({
        battleState: state,
        focusEntityId: currentEntityId,
        characterSheetText: currentEntity
          ? formatCharacterSheetForCombat(character, currentEntity)
          : formatCharacterSheet(character),
        resourceStatus,
        actionList,
        question: input.message,
      });

      const { invokeLLMWithSettings } = await import('./llm-with-settings');
      const queryResult = await invokeLLMWithSettings(ctx.user.id, {
        messages: [
          { role: 'system', content: 'You are a D&D 5e Dungeon Master. Answer combat questions concisely and helpfully.' },
          { role: 'user', content: queryPrompt },
        ],
        max_tokens: 500,
      });
      const rawContent = queryResult.choices?.[0]?.message?.content;
      const queryResponse: string = (typeof rawContent === 'string' ? rawContent : null)
        || "I'm not sure how to answer that. Try asking about your available actions or D&D 5e rules.";

      await db.saveMessage({ sessionId: input.sessionId, characterName: character.name, content: input.message, isDm: 0 });
      await db.saveMessage({ sessionId: input.sessionId, characterName: 'DM', content: queryResponse, isDm: 1 });
      return { response: queryResponse, combatTriggered: false, enemiesAdded: 0 };
    }

    // UNRECOGNIZED_ACTION: ask for clarification, do NOT end turn
    if (parsed.error === 'UNRECOGNIZED_ACTION') {
      await db.saveMessage({ sessionId: input.sessionId, characterName: character.name, content: input.message, isDm: 0 });
      const clarificationMsg = "I'm not sure what you want to do. Try describing an action like 'I attack the goblin' or 'I end my turn.'";
      await db.saveMessage({ sessionId: input.sessionId, characterName: 'DM', content: clarificationMsg, isDm: 1 });
      return { response: clarificationMsg, combatTriggered: false, enemiesAdded: 0 };
    }

    if (parsed.error) {
      console.warn('[CombatV2] Action parsing warning:', parsed.error);
      const parserErrorMessage = formatCombatParserError(parsed.error);
      await db.saveMessage({ sessionId: input.sessionId, characterName: character.name, content: input.message, isDm: 0 });
      await db.saveMessage({ sessionId: input.sessionId, characterName: 'DM', content: parserErrorMessage, isDm: 1 });
      return { response: parserErrorMessage, combatTriggered: false, enemiesAdded: 0 };
    }

    // 2. Execute action through engine
    // Note: parsePlayerAction returns a valid ActionPayload
    const result = engine!.submitAction(parsed.action);

    if (!result.success) {
      const executionErrorMessage = formatCombatExecutionError(result.error);
      await db.saveMessage({ sessionId: input.sessionId, characterName: character.name, content: input.message, isDm: 0 });
      await db.saveMessage({ sessionId: input.sessionId, characterName: 'DM', content: executionErrorMessage, isDm: 1 });
      return { response: executionErrorMessage, combatTriggered: false, enemiesAdded: 0 };
    }

    // 3. Persist state
    await CombatEngineManager.persist(input.sessionId);
    const { syncCombatStateToDb } = await import('./combat/combat-helpers');
    await syncCombatStateToDb(input.sessionId);

    // 4a. Check if waiting for attack roll (visual dice roller)
    if (result.awaitingAttackRoll) {
      const pending = engine!.getState().pendingAttackRoll;
      const targetName = engine!.getState().entities.find(e => e.id === pending?.targetId)?.name || 'the enemy';

      const attackPrompt = `**Roll to hit ${targetName}!** Use the dice roller in the sidebar, or type your d20 result.`;

      await db.saveMessage({ sessionId: input.sessionId, characterName: character.name, content: input.message, isDm: 0 });
      await db.saveMessage({ sessionId: input.sessionId, characterName: 'DM', content: attackPrompt, isDm: 1 });

      return { response: attackPrompt, combatTriggered: false, enemiesAdded: 0 };
    }

    // 4b. Check if waiting for damage roll — hit! Skip narration, prompt for damage.
    // One combined narration will be generated after the damage roll resolves.
    if (result.awaitingDamageRoll) {
      const pendingAttack = engine!.getState().pendingAttack;
      const targetName = engine!.getState().entities.find(e => e.id === pendingAttack?.targetId)?.name || 'the enemy';

      const critNote = pendingAttack?.isCritical ? ' **Critical hit!** DOUBLE DICE!' : '';
      const damagePrompt = `**Hit!**${critNote} Roll your damage (${pendingAttack?.damageFormula}) against ${targetName}.`;
      streamHooks?.onNarrativeDelta?.(damagePrompt);

      await db.saveMessage({
        sessionId: input.sessionId,
        characterName: character.name,
        content: input.message,
        isDm: 0
      });
      await db.saveMessage({
        sessionId: input.sessionId,
        characterName: 'DM',
        content: damagePrompt,
        isDm: 1
      });

      return {
        response: damagePrompt,
        combatTriggered: false,
        enemiesAdded: 0,
      };
    }

    // 5. Generate narrative from logs + flavor (for miss or non-attack actions)
    const currentState = engine!.getState(); // Get fresh state for entities
    const activePlayerId = parsed.action.type === 'ATTACK' ? parsed.action.attackerId
        : parsed.action.type === 'OPPORTUNITY_ATTACK' ? parsed.action.attackerId
        : 'entityId' in parsed.action ? parsed.action.entityId : undefined;

    // Check if the player still has remaining resources (turn didn't auto-end)
    const stillPlayersTurn = currentState.phase === 'ACTIVE'
        && engine!.getCurrentTurnEntity()?.type === 'player'
        && parsed.action.type !== 'END_TURN';
    const playerHasRemainingResources = stillPlayersTurn && currentState.turnResources
        ? (!currentState.turnResources.actionUsed || !currentState.turnResources.bonusActionUsed)
        : false;

    // Resolve weapon context for narrative (attacks, misses, etc.)
    const activeEntity = activePlayerId
        ? currentState.entities.find(e => e.id === activePlayerId)
        : undefined;
    let narrativeWeaponCtx: Record<string, any> = {};
    if (parsed.action.type === 'ATTACK' && 'weaponName' in parsed.action) {
        const weapon = activeEntity?.weapons?.find(
            w => w.name.toLowerCase() === (parsed.action as any).weaponName?.toLowerCase()
        );
        narrativeWeaponCtx = {
            weaponName: weapon?.name ?? (parsed.action as any).weaponName,
        };
    }

    // For END_TURN, pass full turn logs so narrator has context about what happened
    // (e.g. crits, spells cast earlier in the turn). For other actions, use immediate logs.
    const narrativeLogs = parsed.action.type === 'END_TURN'
        ? engine!.getTurnLogs()
        : result.logs;

    const narrative = await streamToString(
      await generateCombatNarrativeStream(
        input.sessionId,
        ctx.user.id,
        narrativeLogs,
        parsed.flavorText,
        character.name,
        currentState.entities,
        false,
        activePlayerId,
        {
          ...narrativeWeaponCtx,
          playerHasRemainingResources: playerHasRemainingResources || undefined,
        }
      ),
      streamHooks?.onNarrativeDelta
    );

    // 5. Save messages
    await db.saveMessage({
      sessionId: input.sessionId,
      characterName: character.name,
      content: input.message,
      isDm: 0
    });

    await db.saveMessage({
      sessionId: input.sessionId,
      characterName: 'DM',
      content: narrative,
      isDm: 1
    });

    // 6. Check if combat ended
    const updatedState = engine!.getState();
    if (updatedState.phase === 'RESOLVED') {
      console.log('[CombatV2] Combat ended, destroying engine');
      await CombatEngineManager.destroy(input.sessionId);
    } else {
      // 7. Trigger AI loop if turn passed to enemy or non-active player
      const nextEntity = engine!.getCurrentTurnEntity();
      if (nextEntity && (nextEntity.type === 'enemy' || nextEntity.dbCharacterId !== character.id)) {
        const { runAILoop } = await import('./combat/enemy-ai-controller');
        console.log(`[CombatV2] Turn passed to ${nextEntity.name}, triggering AI loop...`);
        runAILoop(input.sessionId, ctx.user.id, character.id).catch(err => {
          console.error('[CombatV2] AI loop error:', err);
        });
      }
    }

    return {
      response: narrative,
      combatTriggered: false,
      enemiesAdded: 0,
    };
  }

  // =====================================================================
  // END COMBAT V2 INTEGRATION - FALLBACK TO STANDARD FLOW
  // =====================================================================

  // Get user's custom system prompt or use default
  // Enable structured output for automatic combat detection
  const userSettings = await db.getUserSettings(ctx.user.id);
  const systemPrompt = buildChatSystemPrompt(userSettings, session.narrativePrompt, true); // Enable structured output

  // Get V2 Battle State if engine is active (to pass to DM)
  const v2BattleState = engine?.getState() ?? null;

  let enrichedPrompt = buildChatUserPrompt(
    character,
    session,
    recentMessages,
    context,
    existingCombatState,
    combatants,
    input.message,
    v2BattleState
  );

  // If the player's message explicitly requests combat and no combat is active, inject
  // a strong reminder so the DM reliably sets combatInitiated: true in its JSON output.
  // This is needed because response_format: json_object is OpenAI-specific and Claude/Gemini
  // rely entirely on prompt instructions for structured output compliance.
  if (!existingCombatState?.inCombat && !(engine && enginePhase && enginePhase !== 'IDLE' && enginePhase !== 'RESOLVED')) {
    const lowerMsg = input.message.toLowerCase();
    const combatRequestTerms = ['combat', 'fight', 'attack', 'battle', 'enemies', 'start combat', 'initiate'];
    const isExplicitCombatRequest = combatRequestTerms.some(t => lowerMsg.includes(t));
    if (isExplicitCombatRequest) {
      enrichedPrompt += '\n\n[SYSTEM REMINDER: The player has explicitly requested combat. Your JSON response MUST include "combatInitiated": true in gameStateChanges, with an "enemies" array containing full stat blocks (name, ac, hpMax, attackBonus, damageFormula, damageType, initiative). This is mandatory — do not omit it.]';
    }
  }

  // =====================================================================
  // SRD TOOL CALL LOOP — let the LLM look up spells, monsters, etc.
  // =====================================================================

  const { SRD_TOOLS } = await import('./prompts');
  const { getSrdLoader, lookupByName, filterEntries, summarizeForLLM } = await import('./srd/');
  type LLMMessage = import('./_core/llm').Message;

  const chatMessages: LLMMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: enrichedPrompt },
  ];

  const MAX_TOOL_ROUNDS = 3;
  let contentString: string | null = null;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await invokeLLMWithSettings(ctx.user.id, {
      messages: chatMessages,
      tools: SRD_TOOLS,
      response_format: { type: 'json_object' },
    });

    const choice = response.choices?.[0];
    if (!choice?.message) {
      console.error('[Chat] Invalid LLM response structure:', response);
      throw new Error('Failed to get DM response: Invalid response from LLM');
    }

    const toolCalls = choice.message.tool_calls;
    if (!toolCalls || toolCalls.length === 0) {
      // No tool calls — final text response
      const rawContent = choice.message.content;
      contentString = typeof rawContent === 'string' ? rawContent : JSON.stringify(rawContent);
      break;
    }

    console.log(`[Chat] SRD tool round ${round + 1}: ${toolCalls.map(tc => tc.function.name).join(', ')}`);

    // Append assistant message (with tool_calls) to conversation
    chatMessages.push({
      role: 'assistant',
      content: choice.message.content || '',
      tool_calls: toolCalls,
    });

    // Execute each tool call and append results
    const loader = getSrdLoader();
    for (const tc of toolCalls) {
      let toolResult: string;
      try {
        const args = JSON.parse(tc.function.arguments);
        switch (tc.function.name) {
          case 'lookup_spell': {
            const entry = lookupByName(loader, 'spells', args.name);
            toolResult = entry ? summarizeForLLM(entry, 'spells') : `No spell found matching "${args.name}".`;
            break;
          }
          case 'lookup_monster': {
            const entry = lookupByName(loader, 'monsters', args.name);
            toolResult = entry ? summarizeForLLM(entry, 'monsters') : `No monster found matching "${args.name}".`;
            break;
          }
          case 'lookup_equipment': {
            const entry = lookupByName(loader, 'equipment', args.name);
            toolResult = entry ? summarizeForLLM(entry, 'equipment') : `No equipment found matching "${args.name}".`;
            break;
          }
          case 'search_srd': {
            const category = args.category || 'spells';
            const query = (args.query as string).toLowerCase();
            const entries = loader.getEntries(category);
            const matches = entries
              .filter((e: any) => (e.name as string).toLowerCase().includes(query) || JSON.stringify(e).toLowerCase().includes(query))
              .slice(0, 5);
            toolResult = matches.length > 0
              ? matches.map((e: any) => summarizeForLLM(e, category)).join('\n\n')
              : `No results found for "${args.query}" in ${category}.`;
            break;
          }
          default:
            toolResult = `Unknown tool: ${tc.function.name}`;
        }
      } catch (err) {
        toolResult = `Tool error: ${err instanceof Error ? err.message : String(err)}`;
      }

      chatMessages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: toolResult,
      });
    }
  }

  // If we exhausted tool rounds without a final text response, make one last call without tools
  if (contentString === null) {
    console.log('[Chat] Exhausted tool rounds, requesting final response');
    const finalResponse = await invokeLLMWithSettings(ctx.user.id, {
      messages: chatMessages,
      response_format: { type: 'json_object' },
    });
    const rawContent = finalResponse.choices?.[0]?.message?.content;
    contentString = typeof rawContent === 'string' ? rawContent : JSON.stringify(rawContent ?? '');
  }

  // Emit narrative for streaming hooks
  if (streamHooks?.onNarrativeDelta) {
    const previewStructured = parseStructuredResponse(contentString);
    streamHooks.onNarrativeDelta(previewStructured.narrative);
  }

  console.log('[Chat] Raw LLM response (first 500 chars):', contentString.substring(0, 500));

  const structured = parseStructuredResponse(contentString);
  let dmNarrative = structured.narrative;

  // Debug: Log parsing result
  console.log('[Chat] Parsed response - hasGameStateChanges:', !!structured.gameStateChanges);
  console.log('[Chat] Parsed response - combatInitiated:', structured.gameStateChanges?.combatInitiated);

  // Track if combat was triggered
  let combatTriggered = false;
  let enemiesAdded = 0;

  // Handle automatic combat initiation
  if (hasCombatInitiation(structured) && !existingCombatState?.inCombat) {
    console.log('[AutoCombat] Combat triggered by DM response');
    const enemies = getEnemies(structured);

    // Initiate combat even if no enemies are provided (fallback detection case)
    // This allows manual enemy entry later
    const result = await handleAutoCombatInitiation(
      input.sessionId,
      input.characterId,
      enemies, // May be empty for keyword-detected combat
      ctx.user.id
    );
    combatTriggered = result.success;
    enemiesAdded = result.enemiesAdded;
    console.log(`[AutoCombat] Result: ${enemiesAdded} enemies added, success: ${combatTriggered}`);

    // If awaiting initiative, append prompt to narrative
    if (result.awaitingInitiative) {
      const suf = '\n\n**Roll for initiative!**';
      dmNarrative += suf;
      streamHooks?.onNarrativeDelta?.(suf);
    }
  }

  // Handle automatic combat end
  if (hasCombatEnd(structured) && existingCombatState?.inCombat) {
    console.log('[AutoCombat] Combat ended by DM response');
    await handleAutoCombatEnd(input.sessionId);
  }

  const combatStillInactive = !(engine && enginePhase && enginePhase !== 'IDLE' && enginePhase !== 'RESOLVED');
  if (structured.gameStateChanges?.skillCheck && combatStillInactive) {
    const { normalizeAbilityName, normalizeSkillName, resolveSkillCheck } = await import('./skill-check');
    const request = structured.gameStateChanges.skillCheck;
    const skillResult = resolveSkillCheck({
      characterName: character.name,
      stats,
      level: character.level,
      dc: request.dc,
      ability: normalizeAbilityName(request.ability),
      skill: normalizeSkillName(request.skill),
      proficientSkills: getSkillProficiencies(character) as SkillName[],
      advantage: request.advantage,
      disadvantage: request.disadvantage,
    });
    const extra = `\n\n${skillResult.summary}${request.reason ? `\nReason: ${request.reason}.` : ''}`;
    dmNarrative += extra;
    streamHooks?.onNarrativeDelta?.(extra);
  }

  // Save messages (only the narrative part, not the full JSON)
  await db.saveMessage({
    sessionId: input.sessionId,
    characterName: character.name,
    content: input.message,
    isDm: 0,
  });

  await db.saveMessage({
    sessionId: input.sessionId,
    characterName: 'DM',
    content: dmNarrative,
    isDm: 1,
  });

  // Extract context from the interaction (using narrative only)
  const { extractContextFromResponse, mergeContext } = await import('./context-extraction');

  const extractedContext = await extractContextFromResponse(
    dmNarrative,
    input.message,
    character.name
  );

  // Get existing context and merge with new extraction
  const existingContext = await db.getSessionContext(input.sessionId);
  const parsedContext = db.parseSessionContext(existingContext);
  const mergedContext = mergeContext(parsedContext, extractedContext);

  // Save updated context
  await db.upsertSessionContext(input.sessionId, mergedContext);

  // Apply character updates from extracted context (user can manually override via character sheet)
  console.log('[Character Updates] Extracted character updates:', extractedContext.characterUpdates);
  if (extractedContext.characterUpdates) {
    for (const update of extractedContext.characterUpdates) {
      // Only update the active character for now to be safe
      if (update.characterName.toLowerCase() === character.name.toLowerCase()) {
        const updateData: any = {};

        // Apply HP changes
        if (update.hpChange !== undefined) {
          const newHp = Math.max(0, Math.min(
            character.hpMax,
            character.hpCurrent + update.hpChange
          ));
          updateData.hpCurrent = newHp;
        }

        // Apply inventory changes
        if (update.inventoryAdded || update.inventoryRemoved) {
          let currentInventory = [...inventory];

          if (update.inventoryAdded) {
            currentInventory.push(...update.inventoryAdded);
          }

          if (update.inventoryRemoved) {
            currentInventory = currentInventory.filter(
              item => !update.inventoryRemoved!.includes(item)
            );
          }

          updateData.inventory = JSON.stringify(currentInventory);
        }

        // Apply updates if any
        if (Object.keys(updateData).length > 0) {
          console.log('[Character Updates] Applying updates to character:', character.name, updateData);
          await db.updateCharacter(character.id, updateData);
          console.log('[Character Updates] Successfully updated character');
        } else {
          console.log('[Character Updates] No updates to apply for:', character.name);
        }
      }
    }
  }

  // Sync gameStateChanges to actorState (structured path is source of truth)
  if (structured.gameStateChanges && character.actorState) {
    try {
      const { ActorStateSchema } = await import('./kernel/actor-state');
      const parsed = ActorStateSchema.parse(JSON.parse(character.actorState));
      let changed = false;

      // HP changes from structured gameStateChanges (takes priority over narrative extraction)
      if (structured.gameStateChanges.hpChanges) {
        for (const hpChange of structured.gameStateChanges.hpChanges) {
          if (hpChange.target.toLowerCase() === character.name.toLowerCase()) {
            parsed.hpCurrent = Math.max(0, Math.min(parsed.hpMax, parsed.hpCurrent + hpChange.amount));
            changed = true;
          }
        }
      }

      if (changed) {
        await db.updateCharacter(character.id, { actorState: JSON.stringify(parsed) });
      }
    } catch (e) {
      console.warn('[ActorState] Failed to sync gameStateChanges to actorState:', e);
    }
  }

  // Check if we need to update summary
  const messageCount = await db.getMessageCount(input.sessionId);
  if (messageCount % 20 === 0) {
    // Generate new summary
    const allMessages = await db.getSessionMessages(input.sessionId, 50);
    const messageHistory = allMessages
      .map(m => `${m.characterName}: ${m.content}`)
      .join('\n');

    const { buildSummaryPrompt } = await import('./prompts');
    const summaryPrompt = buildSummaryPrompt(session.currentSummary || 'None', messageHistory);

    const summaryResponse = await invokeLLMWithSettings(ctx.user.id, {
      messages: [{ role: 'user', content: summaryPrompt }],
    });

    if (!summaryResponse.choices || !summaryResponse.choices[0] || !summaryResponse.choices[0].message) {
      console.error('[Summary] Invalid LLM response structure:', summaryResponse);
      // Don't throw error for summary - just skip update
      console.warn('[Summary] Skipping summary update due to invalid LLM response');
    } else {
      const summaryContent = summaryResponse.choices[0].message.content;
      const newSummary = (typeof summaryContent === 'string' ? summaryContent : session.currentSummary) || 'Campaign in progress';
      await db.updateSessionSummary(input.sessionId, newSummary);
    }
  }

  // Return response with combat state info
  return {
    response: dmNarrative,
    combatTriggered,
    enemiesAdded,
  };
}
