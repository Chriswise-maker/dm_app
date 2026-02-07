/**
 * Player Action Parser
 * 
 * Parses natural language player combat messages into structured ActionPayloads.
 * Uses LLM to extract intent (what action), target (who), while preserving
 * the original message as flavor for narrative generation.
 * 
 * Example:
 *   Input:  "I lunge at the goblin with a desperate swing"
 *   Output: { action: ATTACK, targetId: 'g1', flavor: (original message) }
 */

import { CombatEngineManager } from './combat-engine-manager';
import { invokeLLMWithSettings } from '../llm-with-settings';
import { activity } from '../activity-log';
import { getActionParserPrompt } from '../prompts';
import type { CombatEntity, BattleState, ActionPayload } from './combat-types';

// =============================================================================
// TYPES
// =============================================================================

export interface ParsedPlayerAction {
    /** The structured action to execute */
    action: ActionPayload;
    /** Original player message (used by narrator for flavor) */
    flavorText: string;
    /** Confidence score 0-1 (for debugging) */
    confidence: number;
    /** If parsing failed, the reason */
    error?: string;
}

interface LLMParseResult {
    actionType: 'ATTACK' | 'END_TURN' | 'UNKNOWN';
    targetName?: string;
    attackRoll?: number; // Player-provided roll value (e.g., "I roll 20")
    weaponName?: string; // Weapon mentioned ("longsword", "bow")
    advantage?: boolean; // "with advantage"
    disadvantage?: boolean; // "at disadvantage"
    confidence: number;
}

// =============================================================================
// PROMPT BUILDING
// =============================================================================

/**
 * Build the prompt for parsing player combat intent
 */
function buildActionParserPrompt(
    playerMessage: string,
    state: BattleState,
    currentPlayerId: string
): string {
    const enemies = state.entities.filter(
        (e: CombatEntity) => e.type === 'enemy' && e.status === 'ALIVE'
    );
    const players = state.entities.filter(
        (e: CombatEntity) => e.type === 'player' && e.status === 'ALIVE'
    );

    let prompt = `You are parsing a player's combat action in a D&D 5e game.\n\n`;

    prompt += `CURRENT TURN: It is the player's turn.\n\n`;

    prompt += `VALID TARGETS (enemies):\n`;
    enemies.forEach((e: CombatEntity) => {
        prompt += `- "${e.name}" (id: ${e.id})\n`;
    });
    if (enemies.length === 0) {
        prompt += `- (no enemies alive)\n`;
    }

    prompt += `\nALLIES (for reference):\n`;
    players.forEach((p: CombatEntity) => {
        prompt += `- "${p.name}" (id: ${p.id})${p.id === currentPlayerId ? ' ← CURRENT PLAYER' : ''}\n`;
    });

    prompt += `\n---\n\n`;
    prompt += `PLAYER MESSAGE:\n"${playerMessage}"\n\n`;

    prompt += `---\n\n`;
    prompt += `IMPORTANT: Players often describe attacks in roleplay style. Recognize these as ATTACK actions:\n`;
    prompt += `- "I scream a battlecry and charge at the enemy" = ATTACK\n`;
    prompt += `- "I rush forward and swing my sword" = ATTACK\n`;
    prompt += `- "With a mighty roar, I bring my axe down" = ATTACK\n`;
    prompt += `- "I lunge at the goblin" = ATTACK\n`;
    prompt += `- "I roll 20" or "roll 18" = ATTACK (player is providing their attack roll)\n`;
    prompt += `- Any action implying physical violence toward an enemy = ATTACK\n\n`;

    prompt += `Analyze the message and determine:\n`;
    prompt += `1. actionType: Is this an ATTACK (any violent action toward enemy), END_TURN (player is done/passes), or UNKNOWN?\n`;
    prompt += `2. targetName: If attacking, who are they targeting? Match to a name from VALID TARGETS. If only one enemy, assume that target.\n`;
    prompt += `3. attackRoll: If the player mentions a number ("I roll 20", "got an 18", "nat 20"), extract it as their attack roll.\n`;
    prompt += `4. weaponName: If they mention a weapon ("with my longsword", "fire my bow"), extract it.\n`;
    prompt += `5. advantage: true if they say "with advantage", "I have advantage".\n`;
    prompt += `6. disadvantage: true if they say "at disadvantage", "with disadvantage".\n`;
    prompt += `7. confidence: How confident are you (0.0 to 1.0)?\n\n`;

    prompt += `Return ONLY valid JSON:\n`;
    prompt += `{"actionType": "ATTACK", "targetName": "Goblin", "attackRoll": 20, "weaponName": "longsword", "advantage": false, "disadvantage": false, "confidence": 0.9}\n`;
    prompt += `{"actionType": "ATTACK", "targetName": "Goblin", "weaponName": "greataxe", "advantage": true, "confidence": 0.8}\n`;
    prompt += `{"actionType": "END_TURN", "confidence": 0.95}\n`;
    prompt += `{"actionType": "UNKNOWN", "confidence": 0.3}\n`;

    return prompt;
}

// =============================================================================
// LLM RESPONSE PARSING
// =============================================================================

/**
 * Parse the LLM's JSON response
 */
function parseLLMResponse(response: string): LLMParseResult {
    try {
        // Clean up response (remove markdown if present)
        let jsonStr = response.trim();
        if (jsonStr.startsWith('```')) {
            jsonStr = jsonStr
                .replace(/^```(?:json)?\s*\n?/, '')
                .replace(/\n?```\s*$/, '');
        }

        const parsed = JSON.parse(jsonStr);

        return {
            actionType: parsed.actionType || 'UNKNOWN',
            targetName: parsed.targetName,
            attackRoll: typeof parsed.attackRoll === 'number' ? parsed.attackRoll : undefined,
            weaponName: typeof parsed.weaponName === 'string' ? parsed.weaponName : undefined,
            advantage: parsed.advantage === true,
            disadvantage: parsed.disadvantage === true,
            confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
        };
    } catch (error) {
        console.warn('[PlayerActionParser] Failed to parse LLM response:', error);
        return {
            actionType: 'UNKNOWN',
            confidence: 0,
        };
    }
}

/**
 * Match a target name to an entity ID
 * Uses fuzzy matching for flexibility
 */
function matchTargetToEntity(
    targetName: string,
    entities: CombatEntity[]
): CombatEntity | undefined {
    const normalizedTarget = targetName.toLowerCase().trim();

    // Exact match first
    const exact = entities.find(
        (e) => e.name.toLowerCase() === normalizedTarget
    );
    if (exact) return exact;

    // Partial match (target name contained in entity name or vice versa)
    const partial = entities.find(
        (e) =>
            e.name.toLowerCase().includes(normalizedTarget) ||
            normalizedTarget.includes(e.name.toLowerCase())
    );
    if (partial) return partial;

    // Word overlap match (for "the goblin" matching "Goblin Archer")
    const targetWords = normalizedTarget.split(/\s+/);
    const wordMatch = entities.find((e) => {
        const entityWords = e.name.toLowerCase().split(/\s+/);
        return targetWords.some((tw) => entityWords.some((ew) => ew.includes(tw) || tw.includes(ew)));
    });

    return wordMatch;
}

// =============================================================================
// MAIN PARSER LOGIC
// =============================================================================

/**
 * Parse a player's chat message into a combat action
 * 
 * @param sessionId - Combat session ID
 * @param userId - User ID (for LLM settings)
 * @param playerMessage - The raw message from the player
 * @returns ParsedPlayerAction with action payload and flavor text
 */
export async function parsePlayerAction(
    sessionId: number,
    userId: number,
    playerMessage: string
): Promise<ParsedPlayerAction> {
    const engine = CombatEngineManager.get(sessionId);
    if (!engine) {
        return {
            action: { type: 'END_TURN', entityId: '' },
            flavorText: playerMessage,
            confidence: 0,
            error: 'No active combat session',
        };
    }

    const state = engine.getState();
    if (state.phase !== 'ACTIVE') {
        return {
            action: { type: 'END_TURN', entityId: '' },
            flavorText: playerMessage,
            confidence: 0,
            error: 'Combat not active',
        };
    }

    const currentEntity = engine.getCurrentTurnEntity();
    if (!currentEntity || currentEntity.type !== 'player') {
        return {
            action: { type: 'END_TURN', entityId: '' },
            flavorText: playerMessage,
            confidence: 0,
            error: 'Not a player turn',
        };
    }

    console.log(`[PlayerActionParser] Parsing: "${playerMessage}" for ${currentEntity.name}`);
    activity.parser(sessionId, `Parsing: "${playerMessage.substring(0, 50)}..." for ${currentEntity.name}`);

    // Build prompt for LLM
    const prompt = buildActionParserPrompt(playerMessage, state, currentEntity.id);

    // Fetch user settings for customizable parser prompt
    const db = await import('../db');
    const userSettings = await db.getUserSettings(userId);
    const systemPrompt = getActionParserPrompt(userSettings);

    // Call LLM to parse intent
    let llmResult: LLMParseResult;
    try {
        const llmResponse = await invokeLLMWithSettings(userId, {
            messages: [
                {
                    role: 'system',
                    content: systemPrompt,
                },
                { role: 'user', content: prompt },
            ],
            maxTokens: 100,
            responseFormat: { type: 'json_object' },
        });

        const content = llmResponse.choices[0]?.message?.content;
        llmResult = parseLLMResponse(typeof content === 'string' ? content : '');
        console.log('[PlayerActionParser] LLM result:', llmResult);
    } catch (error) {
        console.error('[PlayerActionParser] LLM call failed:', error);
        // Fallback: try to detect action from keywords
        llmResult = fallbackParse(playerMessage);
    }

    // Build ActionPayload based on parsed result
    if (llmResult.actionType === 'ATTACK') {
        const enemies = state.entities.filter(
            (e: CombatEntity) => e.type === 'enemy' && e.status === 'ALIVE'
        );

        let target: CombatEntity | undefined;

        if (llmResult.targetName) {
            target = matchTargetToEntity(llmResult.targetName, enemies);
        } else if (enemies.length === 1) {
            // No target specified but only one enemy - auto-target
            target = enemies[0];
            console.log(`[PlayerActionParser] Auto-targeting only enemy: ${target.name}`);
        } else if (enemies.length > 1) {
            // Multiple enemies and no target - pick first one (or could ask for clarification)
            target = enemies[0];
            console.log(`[PlayerActionParser] No target specified, defaulting to first enemy: ${target.name}`);
        }

        if (target) {
            const rollMsg = llmResult.attackRoll ? ` (roll: ${llmResult.attackRoll})` : '';
            const weaponMsg = llmResult.weaponName ? ` with ${llmResult.weaponName}` : '';
            const advMsg = llmResult.advantage ? ' (ADV)' : llmResult.disadvantage ? ' (DIS)' : '';
            activity.parser(sessionId, `Parsed: ATTACK → ${target.name}${weaponMsg}${rollMsg}${advMsg} (conf: ${llmResult.confidence.toFixed(2)})`);
            return {
                action: {
                    type: 'ATTACK',
                    attackerId: currentEntity.id,
                    targetId: target.id,
                    weaponName: llmResult.weaponName || 'weapon',
                    isRanged: false,
                    advantage: llmResult.advantage || false,
                    disadvantage: llmResult.disadvantage || false,
                    attackRoll: llmResult.attackRoll, // Pass player's roll to engine
                },
                flavorText: playerMessage,
                confidence: llmResult.confidence,
            };
        } else {
            // No valid targets
            return {
                action: { type: 'END_TURN', entityId: currentEntity.id },
                flavorText: playerMessage,
                confidence: llmResult.confidence,
                error: `Could not find target: "${llmResult.targetName}"`,
            };
        }
    }

    if (llmResult.actionType === 'END_TURN') {
        activity.parser(sessionId, `Parsed: END_TURN (conf: ${llmResult.confidence.toFixed(2)})`);
        return {
            action: { type: 'END_TURN', entityId: currentEntity.id },
            flavorText: playerMessage,
            confidence: llmResult.confidence,
        };
    }

    // Unknown action
    activity.parser(sessionId, `Parsed: UNKNOWN - could not parse action`, { message: playerMessage });
    return {
        action: { type: 'END_TURN', entityId: currentEntity.id },
        flavorText: playerMessage,
        confidence: llmResult.confidence,
        error: 'Could not parse action from message',
    };
}

/**
 * Fallback parser using keywords (if LLM fails)
 */
function fallbackParse(message: string): LLMParseResult {
    const lower = message.toLowerCase();

    // Extract roll value if present ("roll 20", "I got 18", "nat 20")
    let attackRoll: number | undefined;
    const rollMatch = lower.match(/(?:roll(?:ed)?|got|rolled?\s+a?)\s*(\d+)/i) ||
        lower.match(/nat(?:ural)?\s*(\d+)/i) ||
        lower.match(/^(\d+)$/); // Just a number
    if (rollMatch) {
        attackRoll = parseInt(rollMatch[1], 10);
    }

    // Detect advantage/disadvantage
    const advantage = /\b(with\s+)?advantage\b/i.test(message);
    const disadvantage = /\b(at\s+|with\s+)?disadvantage\b/i.test(message);

    // Extract weapon name
    let weaponName: string | undefined;
    const weaponMatch = lower.match(/(?:with\s+(?:my\s+)?|using\s+(?:my\s+)?|fire\s+(?:my\s+)?)(\w+(?:\s+\w+)?)/i);
    if (weaponMatch) {
        // Common weapon names to validate against
        const weapons = ['sword', 'longsword', 'shortsword', 'greatsword', 'axe', 'greataxe', 'battleaxe',
            'bow', 'longbow', 'shortbow', 'crossbow', 'dagger', 'mace', 'warhammer', 'spear', 'javelin',
            'staff', 'quarterstaff', 'rapier', 'scimitar', 'flail', 'morningstar', 'halberd', 'glaive'];
        const extracted = weaponMatch[1].toLowerCase();
        if (weapons.some(w => extracted.includes(w))) {
            weaponName = weaponMatch[1];
        }
    }

    // If they just said a roll value, treat it as an attack
    if (attackRoll !== undefined && lower.match(/^(?:i\s+)?(?:roll(?:ed)?|got)\s+\d+/i)) {
        return {
            actionType: 'ATTACK',
            targetName: undefined, // Will use first enemy
            attackRoll,
            weaponName,
            advantage,
            disadvantage,
            confidence: 0.7,
        };
    }

    // Attack keywords - expanded to include roleplay/combat verbs
    const attackKeywords = [
        'attack', 'hit', 'strike', 'swing', 'slash', 'stab', 'shoot', 'fire', 'cast', 'throw',
        'charge', 'rush', 'lunge', 'smash', 'battlecry', 'battle cry', 'roar',
        'cleave', 'slice', 'bash', 'pummel', 'assault', 'engage'
    ];
    if (attackKeywords.some((k) => lower.includes(k))) {
        // Try to find target name after common prepositions
        const targetMatch = lower.match(/(?:at|on|the|toward|towards|against|into)\s+(\w+)/);
        return {
            actionType: 'ATTACK',
            targetName: targetMatch ? targetMatch[1] : undefined,
            attackRoll,
            weaponName,
            advantage,
            disadvantage,
            confidence: 0.5,
        };
    }

    // End turn keywords
    const endKeywords = ['done', 'pass', 'end', 'skip', 'wait', 'nothing', 'hold', 'defend', 'ready'];
    if (endKeywords.some((k) => lower.includes(k))) {
        return {
            actionType: 'END_TURN',
            confidence: 0.6,
        };
    }

    return {
        actionType: 'UNKNOWN',
        confidence: 0.2,
    };
}

/**
 * Check if the current turn is a player's turn
 */
export function isPlayerTurn(sessionId: number): boolean {
    const engine = CombatEngineManager.get(sessionId);
    if (!engine) return false;

    const state = engine.getState();
    if (state.phase !== 'ACTIVE') return false;

    const entity = engine.getCurrentTurnEntity();
    return entity?.type === 'player';
}
