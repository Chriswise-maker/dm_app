/**
 * Enemy AI Controller
 * 
 * Orchestrates automatic turns for non-player entities during combat.
 * When it's an enemy's turn, this controller:
 * 1. Builds a prompt describing the battlefield
 * 2. Asks the LLM for a tactical decision
 * 3. Parses the response into an action
 * 4. Submits the action to the combat engine
 * 5. Advances to the next turn
 * 
 * If multiple enemies are in sequence, it loops through all of them.
 */

import { CombatEngineManager } from './combat-engine-manager';
import { invokeLLMWithSettings } from '../llm-with-settings';
import { activity } from '../activity-log';
import { getEnemyAIPrompt } from '../prompts';
import { generateCombatNarrative } from './combat-narrator';
import type { CombatEntity, BattleState, ActionPayload, CombatLogEntry, LegalAction } from './combat-types';

// =============================================================================
// TARGET SCORING (pre-LLM tactical guidance)
// =============================================================================

/**
 * Score and rank potential targets by tactical priority.
 * - Lowest HP percentage first (finish off wounded targets)
 * - Avoid UNCONSCIOUS targets unless no ALIVE targets remain
 * - Break ties randomly
 */
export function scoreTargets(enemy: CombatEntity, state: BattleState): CombatEntity[] {
    const players = state.entities.filter(
        (e: CombatEntity) => e.type === 'player' && (e.status === 'ALIVE' || e.status === 'UNCONSCIOUS')
    );

    // Prefer ALIVE over UNCONSCIOUS
    const alive = players.filter((e) => e.status === 'ALIVE');
    const unconscious = players.filter((e) => e.status === 'UNCONSCIOUS');

    const candidates = alive.length > 0 ? alive : unconscious;
    if (candidates.length === 0) return [];

    // Sort by HP percentage ascending (lowest first = most vulnerable)
    const sorted = [...candidates].sort((a, b) => {
        const pctA = a.maxHp > 0 ? a.hp / a.maxHp : 1;
        const pctB = b.maxHp > 0 ? b.hp / b.maxHp : 1;
        if (pctA !== pctB) return pctA - pctB;
        // Tie-break: random
        return Math.random() - 0.5;
    });

    return sorted;
}

// =============================================================================
// PROMPT BUILDING
// =============================================================================

/**
 * Build a prompt for the LLM to decide an enemy's action
 * Uses the V2 CombatEntity format
 */
function buildEnemyDecisionPromptV2(enemy: CombatEntity, state: BattleState, rankedTargets: CombatEntity[], legalActions: LegalAction[]): string {
    const allies = state.entities.filter((e: CombatEntity) => e.type === 'enemy' && e.id !== enemy.id && e.status === 'ALIVE');

    let prompt = `You are controlling: ${enemy.name}\n\n`;
    prompt += `Your stats:\n`;
    prompt += `- HP: ${enemy.hp}/${enemy.maxHp}\n`;
    prompt += `- AC: ${enemy.baseAC}\n`;
    prompt += `- Attack: +${enemy.attackModifier} to hit\n`;
    prompt += `- Damage: ${enemy.damageFormula} ${enemy.damageType}\n`;
    if (enemy.tacticalRole) {
        prompt += `- Role: ${enemy.tacticalRole}\n`;
    }
    if (enemy.isRanged) {
        prompt += `- Ranged attacker\n`;
    }

    if (allies.length > 0) {
        prompt += `\nAllies:\n`;
        allies.forEach((a: CombatEntity) => {
            const pct = a.maxHp > 0 ? Math.round((a.hp / a.maxHp) * 100) : 0;
            prompt += `- ${a.name}: HP ${a.hp}/${a.maxHp} (${pct}%)\n`;
        });
    } else {
        prompt += `\nAllies: None (you fight alone)\n`;
    }

    // Add spells info if enemy has spells
    if (enemy.spells && enemy.spells.length > 0) {
        prompt += `\nYour spells:\n`;
        for (const spell of enemy.spells) {
            const slotInfo = spell.level === 0 ? 'cantrip' : `level ${spell.level} (${enemy.spellSlots[String(spell.level)] ?? 0} slots)`;
            prompt += `- ${spell.name} (${slotInfo}): ${spell.damageFormula ? spell.damageFormula + ' ' + (spell.damageType ?? '') : ''}${spell.healingFormula ? 'heals ' + spell.healingFormula : ''}${spell.isAreaEffect ? ' (area)' : ''}\n`;
        }
    }

    prompt += `\nRecommended targets (most to least tactical):\n`;
    rankedTargets.forEach((p: CombatEntity, i: number) => {
        const pct = p.maxHp > 0 ? Math.round((p.hp / p.maxHp) * 100) : 0;
        const status = p.status === 'UNCONSCIOUS' ? ', unconscious' : pct < 30 ? ', vulnerable' : '';
        prompt += `${i + 1}. ${p.name} [id: ${p.id}] — ${p.hp}/${p.maxHp} HP (${pct}%)${status}\n`;
    });

    // Biggest threat: healthiest ALIVE player (most dangerous)
    const alivePlayers = rankedTargets.filter((p) => p.status === 'ALIVE');
    if (alivePlayers.length > 1) {
        const biggestThreat = alivePlayers.reduce((a, b) =>
            (a.maxHp > 0 ? a.hp / a.maxHp : 0) > (b.maxHp > 0 ? b.hp / b.maxHp : 0) ? a : b
        );
        const pct = biggestThreat.maxHp > 0 ? Math.round((biggestThreat.hp / biggestThreat.maxHp) * 100) : 0;
        prompt += `\nBiggest threat: ${biggestThreat.name} (${pct}% HP, most dangerous)\n`;
    }

    // List legal actions as numbered choices
    prompt += `\nYour available actions:\n`;
    legalActions.forEach((action, i) => {
        if (action.type === 'ATTACK' && action.targetId) {
            prompt += `${i + 1}. ATTACK target=${action.targetId} — ${action.description}\n`;
        } else {
            prompt += `${i + 1}. ${action.type} — ${action.description}\n`;
        }
    });

    prompt += `\n---\n\n`;
    prompt += `Choose the number of your action and explain WHY in one sentence.\n\n`;
    prompt += `Return your decision in EXACTLY this format (no other text):\n`;
    prompt += `CHOICE: [number]\n`;
    prompt += `FLAVOR: [one sentence describing HOW you act]\n\n`;
    prompt += `Example:\n`;
    prompt += `CHOICE: 1\n`;
    prompt += `FLAVOR: I lunge forward with a savage snarl, aiming for the warrior's throat.\n`;

    return prompt;
}

// =============================================================================
// RESPONSE PARSING
// =============================================================================

interface ParsedEnemyAction {
    type: 'ATTACK' | 'DODGE' | 'DASH' | 'DISENGAGE' | 'HELP' | 'HIDE' | 'CAST_SPELL' | 'END_TURN';
    targetId?: string;
    allyId?: string;
    spellName?: string;
    targetIds?: string[];
    flavor?: string;
}

/**
 * Parse the LLM response into a structured action by matching CHOICE back to legal actions.
 * Falls back to first legal attack if the LLM returns an invalid choice.
 */
function parseEnemyAction(response: string, enemy: CombatEntity, state: BattleState, legalActions: LegalAction[]): ParsedEnemyAction {
    const lines = response.split('\n');

    let choiceNum: number | undefined;
    let flavor: string | undefined;

    // Also support legacy ACTION/TARGET_ID format for robustness
    let legacyTargetId: string | undefined;
    let legacyAction: string | undefined;

    for (const line of lines) {
        const trimmed = line.trim();

        if (trimmed.toUpperCase().startsWith('CHOICE:')) {
            const val = trimmed.substring(7).trim();
            const parsed = parseInt(val, 10);
            if (!isNaN(parsed)) choiceNum = parsed;
        }
        if (trimmed.toUpperCase().startsWith('FLAVOR:')) {
            flavor = trimmed.substring(7).trim();
        }
        // Legacy format support
        if (trimmed.toUpperCase().startsWith('ACTION:')) {
            legacyAction = trimmed.substring(7).trim().toLowerCase();
        }
        if (trimmed.toUpperCase().startsWith('TARGET_ID:')) {
            legacyTargetId = trimmed.substring(10).trim();
        }
    }

    // Try to match CHOICE to a legal action
    if (choiceNum !== undefined && choiceNum >= 1 && choiceNum <= legalActions.length) {
        const chosen = legalActions[choiceNum - 1];
        if (chosen.type === 'ATTACK' && chosen.targetId) {
            return { type: 'ATTACK', targetId: chosen.targetId, flavor };
        }
        if (chosen.type === 'END_TURN') {
            return { type: 'END_TURN', flavor };
        }
        // Standard actions (Dodge, Dash, Disengage, Help, Hide)
        if (['DODGE', 'DASH', 'DISENGAGE', 'HIDE'].includes(chosen.type)) {
            return { type: chosen.type as ParsedEnemyAction['type'], flavor };
        }
        if (chosen.type === 'HELP' && chosen.targetId) {
            return { type: 'HELP', allyId: chosen.targetId, flavor };
        }
        if (chosen.type === 'CAST_SPELL' && chosen.spellName) {
            return { type: 'CAST_SPELL', spellName: chosen.spellName, targetId: chosen.targetId, flavor };
        }
    }

    // Legacy fallback: match TARGET_ID against legal actions
    if (legacyTargetId) {
        const matchedAction = legalActions.find(a => a.type === 'ATTACK' && a.targetId === legacyTargetId);
        if (matchedAction) {
            return { type: 'ATTACK', targetId: legacyTargetId, flavor };
        }
    }

    // Final fallback: pick the first legal ATTACK action
    const firstAttack = legalActions.find(a => a.type === 'ATTACK' && a.targetId);
    if (firstAttack) {
        console.warn(`[EnemyAI] Invalid choice from LLM, using first legal attack: ${firstAttack.description}`);
        return { type: 'ATTACK', targetId: firstAttack.targetId, flavor };
    }

    return { type: 'END_TURN', flavor };
}

// =============================================================================
// MAIN AI LOGIC
// =============================================================================

/**
 * Execute a single enemy turn
 * Returns the combat log entries from this turn
 */
export async function executeEnemyTurn(sessionId: number, userId: number): Promise<{ logs: CombatLogEntry[], flavor: string }> {
    const engine = CombatEngineManager.get(sessionId);
    if (!engine) {
        console.warn(`[EnemyAI] No engine found for session ${sessionId}`);
        return { logs: [], flavor: '' };
    }

    const state = engine.getState();
    if (state.phase !== 'ACTIVE') {
        console.log(`[EnemyAI] Combat not active for session ${sessionId}`);
        return { logs: [], flavor: '' };
    }

    // Check if there are any valid targets (alive players)
    const validTargets = state.entities.filter((e: CombatEntity) => e.type === 'player' && e.status === 'ALIVE');
    if (validTargets.length === 0) {
        console.log(`[EnemyAI] No valid targets remain, ending combat`);
        activity.ai(sessionId, 'No valid targets remain, ending combat');
        engine.endCombat('All player characters are down');
        await CombatEngineManager.persist(sessionId);
        // Destroy engine to fully deactivate combat
        await CombatEngineManager.destroy(sessionId);
        console.log(`[EnemyAI] Combat engine destroyed for session ${sessionId}`);
        return { logs: [], flavor: '' };
    }

    const entity = engine.getCurrentTurnEntity();
    if (!entity) {
        console.warn(`[EnemyAI] No current turn entity for session ${sessionId}`);
        return { logs: [], flavor: '' };
    }

    if (entity.type !== 'enemy') {
        // Not an enemy's turn, exit
        console.log(`[EnemyAI] Current turn is ${entity.name} (${entity.type}), skipping AI`);
        return { logs: [], flavor: '' };
    }

    console.log(`[EnemyAI] Executing turn for ${entity.name}...`);
    activity.ai(sessionId, `Enemy turn: ${entity.name} is deciding...`);

    // Get legal actions from the engine
    const legalActions = engine.getLegalActions(entity.id);

    // Score targets before LLM (pre-LLM tactical guidance)
    const rankedTargets = scoreTargets(entity, state);

    // Build prompt (includes ranked targets and legal actions for LLM guidance)
    const prompt = buildEnemyDecisionPromptV2(entity, state, rankedTargets, legalActions);

    // Fetch user settings for customizable prompts
    const db = await import('../db');
    const userSettings = await db.getUserSettings(userId);
    const systemPrompt = getEnemyAIPrompt(userSettings);

    // Call LLM
    let llmResponse: string;
    try {
        const result = await invokeLLMWithSettings(userId, {
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: prompt },
            ],
            maxTokens: 200,
        });

        const content = result.choices[0]?.message?.content;
        llmResponse = typeof content === 'string' ? content : '';
        console.log(`[EnemyAI] LLM Response for ${entity.name}:`, llmResponse);
    } catch (error) {
        console.error(`[EnemyAI] LLM call failed for ${entity.name}:`, error);
        // Fallback: pick first legal attack action
        const firstAttack = legalActions.find(a => a.type === 'ATTACK');
        if (firstAttack) {
            llmResponse = `CHOICE: ${legalActions.indexOf(firstAttack) + 1}\nFLAVOR: Attacks wildly!`;
        } else {
            llmResponse = `CHOICE: ${legalActions.length}\nFLAVOR: Holds position.`;
        }
    }

    // Parse response (matched against legal actions)
    const parsed = parseEnemyAction(llmResponse, entity, state, legalActions);

    // Build action payload based on parsed AI decision
    let actionPayload: ActionPayload;
    switch (parsed.type) {
        case 'ATTACK':
            if (parsed.targetId) {
                // Check if target has the 'dodging' condition — applies disadvantage per D&D 5e rules
                const target = state.entities.find(e => e.id === parsed.targetId);
                const targetIsDodging = target?.conditions?.some?.(
                    (c: any) => (typeof c === 'string' ? c === 'dodging' : c.name === 'dodging')
                ) ?? false;

                actionPayload = {
                    type: 'ATTACK',
                    attackerId: entity.id,
                    targetId: parsed.targetId,
                    weaponName: 'natural weapon',
                    isRanged: false,
                    advantage: false,
                    disadvantage: targetIsDodging,
                };
            } else {
                actionPayload = { type: 'END_TURN', entityId: entity.id };
            }
            break;
        case 'DODGE':
            actionPayload = { type: 'DODGE', entityId: entity.id };
            break;
        case 'DASH':
            actionPayload = { type: 'DASH', entityId: entity.id };
            break;
        case 'DISENGAGE':
            actionPayload = { type: 'DISENGAGE', entityId: entity.id };
            break;
        case 'HIDE':
            actionPayload = { type: 'HIDE', entityId: entity.id };
            break;
        case 'HELP':
            if (parsed.allyId) {
                actionPayload = { type: 'HELP', entityId: entity.id, allyId: parsed.allyId };
            } else {
                actionPayload = { type: 'END_TURN', entityId: entity.id };
            }
            break;
        case 'CAST_SPELL':
            if (parsed.spellName) {
                const spellTargetIds = parsed.targetIds ?? (parsed.targetId ? [parsed.targetId] : []);
                actionPayload = {
                    type: 'CAST_SPELL',
                    casterId: entity.id,
                    spellName: parsed.spellName,
                    targetIds: spellTargetIds,
                };
            } else {
                actionPayload = { type: 'END_TURN', entityId: entity.id };
            }
            break;
        default:
            actionPayload = { type: 'END_TURN', entityId: entity.id };
    }

    // Submit action
    const result = engine.submitAction(actionPayload);
    console.log(`[EnemyAI] Action result for ${entity.name}:`, result.success ? 'SUCCESS' : result.error);

    // Multiattack loop: if the enemy still has extra attacks remaining, keep attacking.
    // We skip the LLM for extra attacks and just target the best available target.
    const MAX_EXTRA_ATTACKS = 4;
    let extraAttackCount = 0;
    while (extraAttackCount < MAX_EXTRA_ATTACKS) {
        const freshState = engine.getState();
        if (freshState.phase !== 'ACTIVE') break;
        if (freshState.turnOrder[freshState.turnIndex] !== entity.id) break;
        const freshLegal = engine.getLegalActions(entity.id);
        if (!freshLegal.some(a => a.type === 'ATTACK')) break;

        const freshTargets = scoreTargets(entity, freshState);
        if (freshTargets.length === 0) break;
        const extraTarget = freshTargets[0];

        const freshTargetEntity = freshState.entities.find(e => e.id === extraTarget.id);
        const extraTargetIsDodging = freshTargetEntity?.conditions?.some?.(
            (c: any) => (typeof c === 'string' ? c === 'dodging' : c.name === 'dodging')
        ) ?? false;

        const extraPayload: ActionPayload = {
            type: 'ATTACK',
            attackerId: entity.id,
            targetId: extraTarget.id,
            weaponName: 'natural weapon',
            isRanged: false,
            advantage: false,
            disadvantage: extraTargetIsDodging,
        };

        const extraResult = engine.submitAction(extraPayload);
        console.log(`[EnemyAI] Extra attack ${extraAttackCount + 1} for ${entity.name}:`, extraResult.success ? 'SUCCESS' : extraResult.error);
        result.logs.push(...extraResult.logs);

        extraAttackCount++;
    }

    // If the engine hasn't auto-ended the turn (e.g. all extra attacks used but action economy
    // didn't trigger endTurn), explicitly end it now.
    {
        const afterState = engine.getState();
        if (afterState.phase === 'ACTIVE' && afterState.turnOrder[afterState.turnIndex] === entity.id) {
            engine.submitAction({ type: 'END_TURN', entityId: entity.id });
        }
    }

    // Log the action
    if (actionPayload.type === 'ATTACK') {
        const targetEntity = state.entities.find((e: CombatEntity) => e.id === (actionPayload as any).targetId);
        activity.ai(sessionId, `${entity.name} attacks ${targetEntity?.name || 'unknown'}`, { action: actionPayload });
    } else if (actionPayload.type === 'END_TURN') {
        activity.ai(sessionId, `${entity.name} ends turn`);
    } else {
        activity.ai(sessionId, `${entity.name} takes the ${actionPayload.type} action`);
    }

    // Persist state
    await CombatEngineManager.persist(sessionId);

    // Save a deterministic per-turn message immediately so the player sees
    // each enemy action in chat without waiting for LLM narrative generation
    if (result.logs.length > 0) {
        try {
            const db = await import('../db');
            const updatedState = engine.getState();
            const msg = formatEnemyTurnMessage(entity, result.logs, updatedState.entities);
            if (msg) {
                await db.saveMessage({
                    sessionId,
                    characterName: 'DM',
                    content: msg,
                    isDm: 1,
                });
            }

            // Generate LLM narrative for this enemy's turn and save as a follow-up DM message.
            // Awaited so the next enemy turn only starts after the narrative is saved,
            // giving a sequential "mechanical → narrative → next enemy" flow like a real DM.
            try {
                const narrative = await generateCombatNarrative(
                    sessionId,
                    userId,
                    result.logs,
                    parsed.flavor || `${entity.name} attacks!`,
                    entity.name,
                    updatedState.entities,
                    true, // isEnemyTurn
                    undefined, // activePlayerId
                    {
                        weaponName: entity.damageFormula,
                        damageType: entity.damageType,
                        tacticalRole: entity.tacticalRole,
                    }
                );
                if (narrative && narrative.trim()) {
                    await db.saveMessage({
                        sessionId,
                        characterName: 'DM',
                        content: narrative,
                        isDm: 1,
                    });
                }
            } catch (narrativeErr) {
                console.error('[EnemyAI] Narrative generation failed (non-fatal):', narrativeErr);
            }
        } catch (err) {
            console.error('[EnemyAI] Failed to save per-turn message:', err);
        }
    }

    return {
        logs: result.logs,
        flavor: parsed.flavor || `${entity.name} attacks!`
    };
}

/**
 * Format a deterministic message from combat log entries for immediate display
 */
function formatEnemyTurnMessage(actor: CombatEntity, logs: CombatLogEntry[], entities: CombatEntity[]): string | null {
    const nameMap = new Map(entities.map(e => [e.id, e.name]));
    const resolveName = (id?: string) => (id ? nameMap.get(id) ?? id : 'unknown');

    const parts: string[] = [];

    for (const log of logs) {
        switch (log.type) {
            case 'ATTACK_ROLL': {
                const target = resolveName(log.targetId);
                const roll = log.roll?.result ?? '?';
                const hitMiss = log.success ? '**HIT**' : '**MISS**';
                const crit = log.roll?.isCritical ? ' (CRITICAL!)' : '';
                const formula = log.roll?.formula ? ` (${log.roll.formula} = ${roll})` : '';
                parts.push(`**${actor.name}** attacks ${target}! Rolls ${roll}${formula} — ${hitMiss}${crit}`);
                break;
            }
            case 'DAMAGE': {
                const target = resolveName(log.targetId);
                const targetEntity = entities.find(e => e.id === log.targetId);
                const hpStr = targetEntity ? ` (${targetEntity.hp}/${targetEntity.maxHp} HP)` : '';
                parts.push(`Deals **${log.amount} ${log.damageType || ''}** damage to ${target}${hpStr}`);
                break;
            }
            case 'DEATH':
                parts.push(`${resolveName(log.targetId)} has been **slain**!`);
                break;
            case 'UNCONSCIOUS':
                parts.push(`${resolveName(log.targetId)} falls **unconscious**!`);
                break;
        }
    }

    return parts.length > 0 ? parts.join('\n') : null;
}

/**
 * Check if the current turn belongs to an enemy
 */
export function shouldExecuteAI(sessionId: number): boolean {
    const engine = CombatEngineManager.get(sessionId);
    if (!engine) return false;

    const state = engine.getState();
    if (state.phase !== 'ACTIVE') return false;

    const entity = engine.getCurrentTurnEntity();
    if (!entity) return false;

    return entity.type === 'enemy';
}

/**
 * Run the AI loop for consecutive enemy turns
 * This will keep executing until it's a player's turn or combat ends
 */
export async function runAILoop(sessionId: number, userId: number): Promise<void> {
    // Prevent re-entrant AI loops on the same session
    if (CombatEngineManager.isAILoopRunning(sessionId)) {
        console.log(`[EnemyAI] AI loop already running for session ${sessionId}, skipping`);
        return;
    }

    console.log(`[EnemyAI] Starting AI loop for session ${sessionId}`);
    CombatEngineManager.setAILoopRunning(sessionId, true);

    let iterationCount = 0;
    const maxIterations = 20; // Safety limit to prevent infinite loops
    const allLogs: any[] = [];
    let combinedFlavor = "";

    try {
        while (iterationCount < maxIterations) {
            // Check combat phase before continuing
            const engine = CombatEngineManager.get(sessionId);
            if (!engine || engine.getState().phase !== 'ACTIVE') {
                console.log(`[EnemyAI] Combat no longer active, exiting loop`);
                break;
            }

            if (!shouldExecuteAI(sessionId)) {
                console.log(`[EnemyAI] Not an enemy's turn, exiting loop`);
                break;
            }

            iterationCount++;
            console.log(`[EnemyAI] Loop iteration ${iterationCount}`);

            const { logs, flavor } = await (executeEnemyTurn(sessionId, userId) as any);
            allLogs.push(...logs);
            if (flavor) {
                combinedFlavor += (combinedFlavor ? " " : "") + flavor;
            }

            // Narrative generation is awaited inside executeEnemyTurn,
            // so no extra delay is needed — natural pacing from the LLM call.
        }

        // Per-turn messages are now saved immediately in executeEnemyTurn,
        // so we only need to sync HP here
        if (allLogs.length > 0) {
            try {
                const { syncCombatStateToDb } = await import('./combat-helpers');
                await syncCombatStateToDb(sessionId);
            } catch (err) {
                console.error('[EnemyAI] HP sync error:', err);
            }
        }

        // If the loop exited because it's now a player's turn, prompt them
        const engAfter = CombatEngineManager.get(sessionId);
        if (engAfter && engAfter.getState().phase === 'ACTIVE') {
            const nextEntity = engAfter.getCurrentTurnEntity();
            if (nextEntity && nextEntity.type === 'player') {
                try {
                    const db = await import('../db');
                    await db.saveMessage({
                        sessionId,
                        characterName: 'DM',
                        content: `*${nextEntity.name}'s turn!*\n\nWhat does ${nextEntity.name} do?`,
                        isDm: 1,
                    });
                } catch (err) {
                    console.error('[EnemyAI] Failed to save player prompt:', err);
                }
            }
        }

        if (iterationCount >= maxIterations) {
            console.warn(`[EnemyAI] Hit max iterations (${maxIterations}) for session ${sessionId}`);
        }
    } finally {
        CombatEngineManager.setAILoopRunning(sessionId, false);
    }

    console.log(`[EnemyAI] AI loop complete for session ${sessionId}`);
}
