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
import type { CombatEntity, BattleState, ActionPayload, CombatLogEntry } from './combat-types';

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
function buildEnemyDecisionPromptV2(enemy: CombatEntity, state: BattleState, rankedTargets: CombatEntity[]): string {
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

    prompt += `\n---\n\n`;
    prompt += `Choose your attack target. Pick the most tactical option.\n\n`;
    prompt += `Return your decision in EXACTLY this format (no other text):\n`;
    prompt += `ACTION: attack\n`;
    prompt += `TARGET_ID: [the id of your target, e.g., p1]\n`;
    prompt += `FLAVOR: [one sentence describing HOW you attack]\n\n`;
    prompt += `Example:\n`;
    prompt += `ACTION: attack\n`;
    prompt += `TARGET_ID: p1\n`;
    prompt += `FLAVOR: I lunge forward with a savage snarl, aiming for the warrior's throat.\n`;

    return prompt;
}

// =============================================================================
// RESPONSE PARSING
// =============================================================================

interface ParsedEnemyAction {
    type: 'ATTACK' | 'END_TURN';
    targetId?: string;
    flavor?: string;
}

/**
 * Parse the LLM response into a structured action
 */
function parseEnemyAction(response: string, enemy: CombatEntity, state: BattleState): ParsedEnemyAction {
    const lines = response.split('\n');

    let action = 'attack';
    let targetId: string | undefined;
    let flavor: string | undefined;

    for (const line of lines) {
        const trimmed = line.trim();

        if (trimmed.toUpperCase().startsWith('ACTION:')) {
            action = trimmed.substring(7).trim().toLowerCase();
        }
        if (trimmed.toUpperCase().startsWith('TARGET_ID:')) {
            targetId = trimmed.substring(10).trim();
        }
        if (trimmed.toUpperCase().startsWith('FLAVOR:')) {
            flavor = trimmed.substring(7).trim();
        }
    }

    // Validate target exists and is alive
    const validTargets = state.entities.filter((e: CombatEntity) => e.type === 'player' && e.status === 'ALIVE');

    if (!targetId || !validTargets.find((t: CombatEntity) => t.id === targetId)) {
        // Fallback: use first from scoreTargets (tactically best) if available
        const ranked = scoreTargets(enemy, state);
        const fallback = ranked.find((t) => validTargets.some((v) => v.id === t.id));
        if (fallback) {
            console.warn(`[EnemyAI] Invalid target "${targetId}", using tactical fallback: ${fallback.name}`);
            targetId = fallback.id;
        } else if (validTargets.length > 0) {
            targetId = validTargets[Math.floor(Math.random() * validTargets.length)].id;
        }
    }

    if (!targetId) {
        // No valid targets, end turn
        return { type: 'END_TURN' };
    }

    return {
        type: 'ATTACK',
        targetId,
        flavor,
    };
}

// =============================================================================
// MAIN AI LOGIC
// =============================================================================

/**
 * Execute a single enemy turn
 * Returns the combat log entries from this turn
 */
export async function executeEnemyTurn(sessionId: number, userId: number): Promise<{ logs: any[], flavor: string }> {
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

    // Score targets before LLM (pre-LLM tactical guidance)
    const rankedTargets = scoreTargets(entity, state);

    // Build prompt (includes ranked targets for LLM guidance)
    const prompt = buildEnemyDecisionPromptV2(entity, state, rankedTargets);

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
        // Fallback: attack first valid target
        const ranked = scoreTargets(entity, state);
        const fallbackTarget = ranked.find((t) => t.status === 'ALIVE') ?? ranked[0];
        if (fallbackTarget) {
            llmResponse = `ACTION: attack\nTARGET_ID: ${fallbackTarget.id}\nFLAVOR: Attacks wildly!`;
        } else {
            llmResponse = `ACTION: end_turn`;
        }
    }

    // Parse response
    const parsed = parseEnemyAction(llmResponse, entity, state);

    // Build action payload
    let actionPayload: ActionPayload;
    if (parsed.type === 'ATTACK' && parsed.targetId) {
        actionPayload = {
            type: 'ATTACK',
            attackerId: entity.id,
            targetId: parsed.targetId,
            weaponName: 'natural weapon',
            isRanged: false,
            advantage: false,
            disadvantage: false,
        };
    } else {
        actionPayload = {
            type: 'END_TURN',
            entityId: entity.id,
        };
    }

    // Submit action
    const result = engine.submitAction(actionPayload);
    console.log(`[EnemyAI] Action result for ${entity.name}:`, result.success ? 'SUCCESS' : result.error);

    // Log the action
    if (actionPayload.type === 'ATTACK') {
        const targetEntity = state.entities.find((e: CombatEntity) => e.id === actionPayload.targetId);
        activity.ai(sessionId, `${entity.name} attacks ${targetEntity?.name || 'unknown'}`, { action: actionPayload });
    } else {
        activity.ai(sessionId, `${entity.name} ends turn`);
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

            // Small delay to prevent hammering the LLM
            await new Promise(resolve => setTimeout(resolve, 200));
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

        if (iterationCount >= maxIterations) {
            console.warn(`[EnemyAI] Hit max iterations (${maxIterations}) for session ${sessionId}`);
        }
    } finally {
        CombatEngineManager.setAILoopRunning(sessionId, false);
    }

    console.log(`[EnemyAI] AI loop complete for session ${sessionId}`);
}
