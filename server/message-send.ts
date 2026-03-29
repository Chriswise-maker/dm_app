import type { Combatant } from '../drizzle/schema';
import type { TrpcContext } from './_core/context';

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
  const { buildChatSystemPrompt, buildChatUserPrompt } = await import('./prompts');
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

    const attackerId = engine.getState().pendingAttack?.attackerId;

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

    // Generate narrative
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
        attackerId
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
      // Trigger Enemy AI if turn passed
      const nextEntity = engine.getCurrentTurnEntity();
      if (nextEntity && nextEntity.type === 'enemy') {
        const { runAILoop } = await import('./combat/enemy-ai-controller');
        console.log(`[CombatV2] Turn passed to ${nextEntity.name} (enemy), triggering AI loop...`);
        runAILoop(input.sessionId, ctx.user.id).catch(err => {
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

  // Handle AWAIT_ATTACK_ROLL phase - player provides their d20 via chat (fallback for visual dice)
  if (engine && enginePhase === 'AWAIT_ATTACK_ROLL') {
    console.log('[CombatV2] In attack roll phase, extracting roll value from chat');

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

    const narrative = await streamToString(
      await generateCombatNarrativeStream(
        input.sessionId,
        ctx.user.id,
        result.logs,
        input.message,
        character.name,
        currentState.entities,
        false,
        currentState.pendingAttackRoll?.attackerId,
        {
          awaitingDamageRoll: isAwaitingDamage,
          pendingDamageFormula: currentState.pendingAttack?.damageFormula,
          isCriticalHit: currentState.pendingAttack?.isCritical,
          weaponName: currentState.pendingAttack?.weaponName,
        }
      ),
      streamHooks?.onNarrativeDelta
    );

    await db.saveMessage({ sessionId: input.sessionId, characterName: character.name, content: input.message, isDm: 0 });

    // If the attack hit, prompt for damage roll
    let dmContent = narrative;
    if (isAwaitingDamage && currentState.pendingAttack) {
      const dmgSuf = `\n\n**Roll your damage!** (${currentState.pendingAttack.damageFormula}${currentState.pendingAttack.isCritical ? ' — DOUBLE DICE for crit!' : ''})`;
      dmContent += dmgSuf;
      streamHooks?.onNarrativeDelta?.(dmgSuf);
    }

    await db.saveMessage({ sessionId: input.sessionId, characterName: 'DM', content: dmContent, isDm: 1 });

    if (currentState.phase === 'RESOLVED') {
      await CombatEngineManager.destroy(input.sessionId);
    } else {
      const nextEntity = engine.getCurrentTurnEntity();
      if (nextEntity && nextEntity.type === 'enemy') {
        const { runAILoop } = await import('./combat/enemy-ai-controller');
        runAILoop(input.sessionId, ctx.user.id).catch(err => console.error('[CombatV2] AI loop error:', err));
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

    // Find which player entity this character corresponds to
    const playerEntityId = `player-${character.id}`;
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

      // Trigger enemy AI if first turn is an enemy
      if (firstEntity && firstEntity.type === 'enemy') {
        const { runAILoop } = await import('./combat/enemy-ai-controller');
        console.log(`[CombatV2] First turn is ${firstEntity.name} (enemy), triggering AI loop...`);
        runAILoop(input.sessionId, ctx.user.id).catch(err => {
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

  const isV2CombatActive = engine && enginePhase === 'ACTIVE';

  if (isV2CombatActive && isPlayerTurn(input.sessionId)) {
    console.log('[CombatV2] Intercepting chat for player turn');

    // 1. Parse player action from chat
    const parsed = await parsePlayerAction(input.sessionId, ctx.user.id, input.message);

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

      const queryPrompt = `You are a D&D 5e Dungeon Master helping a player understand their combat options. Answer their question concisely and helpfully, in character as the DM.

PLAYER CHARACTER: ${currentEntity?.name || 'Unknown'} (HP: ${currentEntity?.hp}/${currentEntity?.maxHp}, AC: ${currentEntity?.baseAC})
TURN RESOURCES: ${resourceStatus}

AVAILABLE ACTIONS:
${actionList}

PLAYER'S QUESTION: "${input.message}"

Answer the question directly. If they're asking what they can do, list their available actions with brief explanations. Keep it concise but helpful. Use D&D 5e rules knowledge to explain mechanics if asked.`;

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
    }

    // 2. Execute action through engine
    // Note: parsePlayerAction returns a valid ActionPayload
    const result = engine!.submitAction(parsed.action);

    // 3. Persist state
    if (result.success) {
      await CombatEngineManager.persist(input.sessionId);
      const { syncCombatStateToDb } = await import('./combat/combat-helpers');
      await syncCombatStateToDb(input.sessionId);
    }

    // 4a. Check if waiting for attack roll (visual dice roller)
    if (result.awaitingAttackRoll) {
      const pending = engine!.getState().pendingAttackRoll;
      const targetName = engine!.getState().entities.find(e => e.id === pending?.targetId)?.name || 'the enemy';

      const attackPrompt = `**Roll to hit ${targetName}!** Use the dice roller in the sidebar, or type your d20 result.`;

      await db.saveMessage({ sessionId: input.sessionId, characterName: character.name, content: input.message, isDm: 0 });
      await db.saveMessage({ sessionId: input.sessionId, characterName: 'DM', content: attackPrompt, isDm: 1 });

      return { response: attackPrompt, combatTriggered: false, enemiesAdded: 0 };
    }

    // 4b. Check if waiting for damage roll
    if (result.awaitingDamageRoll) {
      const pendingAttack = engine!.getState().pendingAttack;
      const targetName = engine!.getState().entities.find(e => e.id === pendingAttack?.targetId)?.name || 'the enemy';

      // Generate hit narrative and prompt for damage
      const hitNarrative = await streamToString(
        await generateCombatNarrativeStream(
          input.sessionId,
          ctx.user.id,
          result.logs,
          parsed.flavorText,
          character.name,
          engine!.getState().entities,
          false,
          pendingAttack?.attackerId,
          {
            awaitingDamageRoll: true,
            pendingDamageFormula: pendingAttack?.damageFormula,
            isCriticalHit: pendingAttack?.isCritical,
            weaponName: pendingAttack?.weaponName,
          }
        ),
        streamHooks?.onNarrativeDelta
      );

      const damageSuffix = `\n\n**Roll your damage!** (${pendingAttack?.damageFormula}${pendingAttack?.isCritical ? ' - DOUBLE DICE for crit!' : ''})`;
      const damagePrompt = `${hitNarrative}${damageSuffix}`;
      streamHooks?.onNarrativeDelta?.(damageSuffix);

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

    const narrative = await streamToString(
      await generateCombatNarrativeStream(
        input.sessionId,
        ctx.user.id,
        result.logs,
        parsed.flavorText,
        character.name,
        currentState.entities,
        false,
        activePlayerId,
        playerHasRemainingResources ? { playerHasRemainingResources: true } : undefined
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
      // 7. Trigger Enemy AI if turn passed
      const nextEntity = engine!.getCurrentTurnEntity();
      if (nextEntity && nextEntity.type === 'enemy') {
        const { runAILoop } = await import('./combat/enemy-ai-controller');
        console.log(`[CombatV2] Turn passed to ${nextEntity.name} (enemy), triggering AI loop...`);
        runAILoop(input.sessionId, ctx.user.id).catch(err => {
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

  const enrichedPrompt = buildChatUserPrompt(
    character,
    stats,
    inventory,
    session,
    recentMessages,
    context,
    existingCombatState,
    combatants,
    input.message,
    v2BattleState
  );

  // Get LLM response with JSON mode enabled (streaming when streamHooks provided)
  const { invokeLLMWithSettingsStream } = await import('./llm-with-settings');
  const { createNarrativeJsonEmitter } = await import('./narrative-json-stream');

  let contentString: string;

  if (streamHooks?.onNarrativeDelta) {
    let acc = userSettings?.llmProvider === 'anthropic' ? '{' : '';
    const streamEmitter = createNarrativeJsonEmitter();
    try {
      const stream = await invokeLLMWithSettingsStream(ctx.user.id, {
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: enrichedPrompt },
        ],
        response_format: { type: 'json_object' },
      });
      for await (const chunk of stream) {
        acc += chunk;
        const delta = streamEmitter.appendAndExtractDelta(acc);
        if (delta) streamHooks.onNarrativeDelta(delta);
      }
      contentString = acc;
    } catch (streamErr) {
      console.warn('[Chat] Stream failed, using non-streaming fallback:', streamErr);
      const response = await invokeLLMWithSettings(ctx.user.id, {
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: enrichedPrompt },
        ],
        response_format: { type: 'json_object' },
      });
      if (!response.choices || !response.choices[0] || !response.choices[0].message) {
        console.error('[Chat] Invalid LLM response structure:', response);
        throw new Error('Failed to get DM response: Invalid response from LLM');
      }
      const rawContent = response.choices[0].message.content;
      contentString = typeof rawContent === 'string' ? rawContent : JSON.stringify(rawContent);
      const structuredFallback = parseStructuredResponse(contentString);
      streamHooks.onNarrativeDelta(structuredFallback.narrative);
    }
  } else {
    const response = await invokeLLMWithSettings(ctx.user.id, {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: enrichedPrompt },
      ],
      response_format: { type: 'json_object' },
    });

    if (!response.choices || !response.choices[0] || !response.choices[0].message) {
      console.error('[Chat] Invalid LLM response structure:', response);
      throw new Error('Failed to get DM response: Invalid response from LLM');
    }

    const rawContent = response.choices[0].message.content;
    contentString = typeof rawContent === 'string' ? rawContent : JSON.stringify(rawContent);
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
