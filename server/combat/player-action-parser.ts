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
    actionType: 'ATTACK' | 'DODGE' | 'DASH' | 'DISENGAGE' | 'HELP' | 'HIDE' | 'READY' | 'USE_ITEM' | 'CAST_SPELL' | 'END_TURN' | 'QUERY' | 'UNKNOWN';
    targetName?: string;
    allyName?: string;   // For HELP: who to help
    attackRoll?: number; // Player-provided roll value (e.g., "I roll 20")
    weaponName?: string; // Weapon mentioned ("longsword", "bow")
    itemName?: string;   // For USE_ITEM: what item
    spellName?: string;  // For CAST_SPELL
    targetNames?: string[]; // For area spells
    trigger?: string;    // For READY: trigger condition
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

    // Show spells if current player has them
    if (currentPlayerId) {
        const currentPlayer = state.entities.find((e: CombatEntity) => e.id === currentPlayerId);
        if (currentPlayer?.spells && currentPlayer.spells.length > 0) {
            prompt += `\nKNOWN SPELLS (${currentPlayer.name}):\n`;
            for (const spell of currentPlayer.spells) {
                const slotInfo = spell.level === 0 ? 'cantrip' : `level ${spell.level} (${currentPlayer.spellSlots[String(spell.level)] ?? 0} slots left)`;
                prompt += `- "${spell.name}" (${slotInfo}): ${spell.description || spell.damageFormula || spell.healingFormula || 'utility'}\n`;
            }
            prompt += '\n';
        }
    }

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

    prompt += `D&D 5e STANDARD ACTIONS (recognize these):\n`;
    prompt += `- DODGE: "I dodge", "I take the Dodge action", "I brace for attacks", "I go defensive"\n`;
    prompt += `- DASH: "I dash", "I run", "I sprint", "I move double speed"\n`;
    prompt += `- DISENGAGE: "I disengage", "I back away carefully", "I withdraw safely"\n`;
    prompt += `- HELP: "I help Thorin", "I assist my ally", "I give Elara advantage"\n`;
    prompt += `- HIDE: "I hide", "I try to conceal myself", "I sneak into the shadows"\n`;
    prompt += `- READY: "I ready an attack", "I wait for it to come closer and then strike"\n`;
    prompt += `- USE_ITEM: "I drink a potion", "I use my healing potion on Thorin"\n`;
    prompt += `- CAST_SPELL: "I cast Fireball", "I use Magic Missile on the goblin", "I cast Cure Wounds on Elara"\n`;
    prompt += `- END_TURN: "done", "end turn", "pass", "I wait", "no", "nah", "that's it", "move on", "I'm good", "nothing else", "next", "no thanks"\n`;
    prompt += `- QUERY: "what can I do?", "what are my options?", "how does dodge work?", "can I attack twice?", "what's my AC?", any question about rules, abilities, or combat state\n\n`;

    prompt += `Analyze the message and determine:\n`;
    prompt += `1. actionType: ATTACK, DODGE, DASH, DISENGAGE, HELP, HIDE, READY, USE_ITEM, END_TURN, QUERY, or UNKNOWN\n`;
    prompt += `2. targetName: If attacking, who are they targeting? Match to a name from VALID TARGETS. If only one enemy, assume that target.\n`;
    prompt += `3. allyName: If helping, who are they helping? Match to a name from ALLIES.\n`;
    prompt += `4. attackRoll: If the player mentions a number ("I roll 20", "got an 18", "nat 20"), extract it as their attack roll.\n`;
    prompt += `5. weaponName: If they mention a weapon ("with my longsword", "fire my bow"), extract it.\n`;
    prompt += `6. itemName: If using an item ("healing potion", "scroll of fireball"), extract it.\n`;
    prompt += `7. trigger: If readying an action, what's the trigger ("when it gets close", "if it moves").\n`;
    prompt += `8. advantage/disadvantage: true if explicitly stated.\n`;
    prompt += `9. confidence: How confident are you (0.0 to 1.0)?\n`;
    prompt += `10. spellName: If casting a spell, the exact spell name.\n`;
    prompt += `11. targetNames: Array of target names if multiple targets (area spells).\n\n`;

    prompt += `Return ONLY valid JSON:\n`;
    prompt += `{"actionType": "ATTACK", "targetName": "Goblin", "attackRoll": 20, "weaponName": "longsword", "confidence": 0.9}\n`;
    prompt += `{"actionType": "DODGE", "confidence": 0.95}\n`;
    prompt += `{"actionType": "HELP", "allyName": "Thorin", "targetName": "Goblin", "confidence": 0.85}\n`;
    prompt += `{"actionType": "USE_ITEM", "itemName": "healing potion", "targetName": "Elara", "confidence": 0.9}\n`;
    prompt += `{"actionType": "CAST_SPELL", "spellName": "Fireball", "confidence": 0.9}\n`;
    prompt += `{"actionType": "END_TURN", "confidence": 0.95}\n`;

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

        const validActions = ['ATTACK', 'DODGE', 'DASH', 'DISENGAGE', 'HELP', 'HIDE', 'READY', 'USE_ITEM', 'CAST_SPELL', 'END_TURN', 'QUERY', 'UNKNOWN'];
        return {
            actionType: validActions.includes(parsed.actionType) ? parsed.actionType : 'UNKNOWN',
            targetName: parsed.targetName,
            allyName: typeof parsed.allyName === 'string' ? parsed.allyName : undefined,
            attackRoll: typeof parsed.attackRoll === 'number' ? parsed.attackRoll : undefined,
            weaponName: typeof parsed.weaponName === 'string' ? parsed.weaponName : undefined,
            itemName: typeof parsed.itemName === 'string' ? parsed.itemName : undefined,
            spellName: typeof parsed.spellName === 'string' ? parsed.spellName : undefined,
            targetNames: Array.isArray(parsed.targetNames) ? parsed.targetNames : undefined,
            trigger: typeof parsed.trigger === 'string' ? parsed.trigger : undefined,
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

    // --- Standard actions (no target needed) ---
    if (llmResult.actionType === 'DODGE') {
        activity.parser(sessionId, `Parsed: DODGE (conf: ${llmResult.confidence.toFixed(2)})`);
        return {
            action: { type: 'DODGE', entityId: currentEntity.id },
            flavorText: playerMessage,
            confidence: llmResult.confidence,
        };
    }

    if (llmResult.actionType === 'DASH') {
        activity.parser(sessionId, `Parsed: DASH (conf: ${llmResult.confidence.toFixed(2)})`);
        return {
            action: { type: 'DASH', entityId: currentEntity.id },
            flavorText: playerMessage,
            confidence: llmResult.confidence,
        };
    }

    if (llmResult.actionType === 'DISENGAGE') {
        activity.parser(sessionId, `Parsed: DISENGAGE (conf: ${llmResult.confidence.toFixed(2)})`);
        return {
            action: { type: 'DISENGAGE', entityId: currentEntity.id },
            flavorText: playerMessage,
            confidence: llmResult.confidence,
        };
    }

    if (llmResult.actionType === 'HELP') {
        const players = state.entities.filter(
            (e: CombatEntity) => (e.type === 'player' || e.type === 'ally') && e.status === 'ALIVE' && e.id !== currentEntity.id
        );
        let ally: CombatEntity | undefined;
        if (llmResult.allyName) {
            ally = matchTargetToEntity(llmResult.allyName, players);
        } else if (players.length === 1) {
            ally = players[0];
        }

        if (ally) {
            // Optionally resolve a target enemy
            let targetId: string | undefined;
            if (llmResult.targetName) {
                const enemies = state.entities.filter(
                    (e: CombatEntity) => e.type === 'enemy' && e.status === 'ALIVE'
                );
                const enemy = matchTargetToEntity(llmResult.targetName, enemies);
                targetId = enemy?.id;
            }

            activity.parser(sessionId, `Parsed: HELP → ${ally.name} (conf: ${llmResult.confidence.toFixed(2)})`);
            return {
                action: { type: 'HELP', entityId: currentEntity.id, allyId: ally.id, targetId },
                flavorText: playerMessage,
                confidence: llmResult.confidence,
            };
        }
        // Couldn't find ally — fall through to unknown
    }

    if (llmResult.actionType === 'HIDE') {
        activity.parser(sessionId, `Parsed: HIDE (conf: ${llmResult.confidence.toFixed(2)})`);
        return {
            action: { type: 'HIDE', entityId: currentEntity.id },
            flavorText: playerMessage,
            confidence: llmResult.confidence,
        };
    }

    if (llmResult.actionType === 'READY') {
        activity.parser(sessionId, `Parsed: READY (conf: ${llmResult.confidence.toFixed(2)})`);
        return {
            action: {
                type: 'READY',
                entityId: currentEntity.id,
                trigger: llmResult.trigger || 'when a creature comes within reach',
                readiedAction: 'ATTACK',
                targetId: undefined,
            },
            flavorText: playerMessage,
            confidence: llmResult.confidence,
        };
    }

    if (llmResult.actionType === 'USE_ITEM') {
        // Resolve optional target
        let targetId: string | undefined;
        if (llmResult.targetName) {
            const allAlive = state.entities.filter((e: CombatEntity) => e.status === 'ALIVE');
            const target = matchTargetToEntity(llmResult.targetName, allAlive);
            targetId = target?.id;
        }

        activity.parser(sessionId, `Parsed: USE_ITEM → ${llmResult.itemName || 'item'} (conf: ${llmResult.confidence.toFixed(2)})`);
        return {
            action: {
                type: 'USE_ITEM',
                entityId: currentEntity.id,
                itemName: llmResult.itemName || 'item',
                targetId,
            },
            flavorText: playerMessage,
            confidence: llmResult.confidence,
        };
    }

    if (llmResult.actionType === 'CAST_SPELL') {
        const spellName = llmResult.spellName;
        if (!spellName) {
            return {
                action: { type: 'END_TURN', entityId: currentEntity.id },
                flavorText: playerMessage,
                confidence: 0,
                error: 'No spell name detected',
            };
        }

        // Check if the current entity has this spell
        const spell = currentEntity.spells?.find(
            (s: any) => s.name.toLowerCase() === spellName.toLowerCase()
        );
        if (!spell) {
            return {
                action: { type: 'END_TURN', entityId: currentEntity.id },
                flavorText: playerMessage,
                confidence: llmResult.confidence,
                error: `Player does not know spell: ${spellName}`,
            };
        }

        // Resolve targets
        let targetIds: string[] = [];
        if (spell.isAreaEffect) {
            // Area spells: target all enemies
            targetIds = state.entities
                .filter((e: CombatEntity) => e.type === 'enemy' && e.status === 'ALIVE')
                .map((e: CombatEntity) => e.id);
        } else if (spell.healingFormula) {
            // Healing spells: check target
            if (llmResult.targetName) {
                const allAlive = state.entities.filter((e: CombatEntity) =>
                    (e.status === 'ALIVE' || e.status === 'UNCONSCIOUS') &&
                    (e.type === 'player' || e.type === 'ally')
                );
                const target = matchTargetToEntity(llmResult.targetName, allAlive);
                if (target) targetIds = [target.id];
            } else {
                targetIds = [currentEntity.id]; // self-heal
            }
        } else {
            // Damage/effect spells
            if (llmResult.targetName) {
                const enemies = state.entities.filter(
                    (e: CombatEntity) => e.type === 'enemy' && e.status === 'ALIVE'
                );
                const target = matchTargetToEntity(llmResult.targetName, enemies);
                if (target) targetIds = [target.id];
            } else if (state.entities.filter((e: CombatEntity) => e.type === 'enemy' && e.status === 'ALIVE').length === 1) {
                // Auto-target single enemy
                const enemy = state.entities.find((e: CombatEntity) => e.type === 'enemy' && e.status === 'ALIVE');
                if (enemy) targetIds = [enemy.id];
            }
        }

        activity.parser(sessionId, `Parsed: CAST_SPELL → ${spellName} at [${targetIds.join(', ')}] (conf: ${llmResult.confidence.toFixed(2)})`);
        return {
            action: {
                type: 'CAST_SPELL',
                casterId: currentEntity.id,
                spellName: spell.name,
                targetIds,
            },
            flavorText: playerMessage,
            confidence: llmResult.confidence,
        };
    }

    if (llmResult.actionType === 'END_TURN') {
        activity.parser(sessionId, `Parsed: END_TURN (conf: ${llmResult.confidence.toFixed(2)})`);
        return {
            action: { type: 'END_TURN', entityId: currentEntity.id },
            flavorText: playerMessage,
            confidence: llmResult.confidence,
        };
    }

    // Query — player is asking a question, not taking an action
    if (llmResult.actionType === 'QUERY') {
        activity.parser(sessionId, `Parsed: QUERY (conf: ${llmResult.confidence.toFixed(2)})`, { message: playerMessage });
        return {
            action: { type: 'END_TURN', entityId: currentEntity.id },
            flavorText: playerMessage,
            confidence: llmResult.confidence,
            error: 'QUERY',
        };
    }

    // Unknown action — do NOT end turn; ask for clarification
    activity.parser(sessionId, `Parsed: UNKNOWN - could not parse action`, { message: playerMessage });
    return {
        action: { type: 'END_TURN', entityId: currentEntity.id },
        flavorText: '',
        confidence: 0,
        error: 'UNRECOGNIZED_ACTION',
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

    // Spell cast keywords — check before generic attack
    const spellMatch = lower.match(/(?:i\s+)?(?:cast|use|channel|invoke)\s+(.+?)(?:\s+(?:at|on|against)\s+|$)/i);
    if (spellMatch) {
        const spellName = spellMatch[1].trim();
        const targetMatch = lower.match(/(?:at|on|against|toward)\s+(?:the\s+)?(\w+)/i);
        return {
            actionType: 'CAST_SPELL',
            spellName: spellName.replace(/^(?:my\s+|the\s+)/, ''),
            targetName: targetMatch?.[1],
            confidence: 0.6,
        };
    }

    // Attack keywords - expanded to include roleplay/combat verbs
    const attackKeywords = [
        'attack', 'hit', 'strike', 'swing', 'slash', 'stab', 'shoot', 'fire', 'throw',
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

    // Dodge keywords
    const dodgeKeywords = ['dodge', 'go defensive', 'brace', 'take the dodge'];
    if (dodgeKeywords.some((k) => lower.includes(k))) {
        return { actionType: 'DODGE', confidence: 0.7 };
    }

    // Dash keywords
    const dashKeywords = ['dash', 'sprint', 'run away', 'run fast', 'double move'];
    if (dashKeywords.some((k) => lower.includes(k))) {
        return { actionType: 'DASH', confidence: 0.7 };
    }

    // Disengage keywords
    const disengageKeywords = ['disengage', 'back away', 'withdraw', 'retreat safely', 'pull back'];
    if (disengageKeywords.some((k) => lower.includes(k))) {
        return { actionType: 'DISENGAGE', confidence: 0.7 };
    }

    // Help keywords
    const helpMatch = lower.match(/(?:help|assist|aid)\s+(\w+)/);
    if (helpMatch) {
        return { actionType: 'HELP', allyName: helpMatch[1], confidence: 0.6 };
    }

    // Hide keywords
    const hideKeywords = ['hide', 'sneak', 'conceal', 'stealth'];
    if (hideKeywords.some((k) => lower.includes(k))) {
        return { actionType: 'HIDE', confidence: 0.7 };
    }

    // Ready keywords
    if (lower.includes('ready') && (lower.includes('attack') || lower.includes('action') || lower.includes('when') || lower.includes('if'))) {
        const triggerMatch = lower.match(/(?:when|if)\s+(.+)/);
        return { actionType: 'READY', trigger: triggerMatch?.[1], confidence: 0.5 };
    }

    // Use item keywords
    const itemMatch = lower.match(/(?:use|drink|activate|apply)\s+(?:my\s+|a\s+|the\s+)?(.+?)(?:\s+on\s+|\s*$)/);
    if (itemMatch && ['potion', 'scroll', 'wand', 'ring', 'amulet', 'oil', 'bomb', 'kit', 'herb'].some(w => lower.includes(w))) {
        return { actionType: 'USE_ITEM', itemName: itemMatch[1], confidence: 0.6 };
    }

    // End turn keywords (includes soft confirmations for "anything else?" prompts)
    const endKeywords = ['done', 'pass', 'end', 'skip', 'wait', 'nothing', 'hold',
        'move on', "that's it", "thats it", "i'm good", "im good", 'no thanks',
        'nothing else', 'next'];
    if (endKeywords.some((k) => lower.includes(k))) {
        return {
            actionType: 'END_TURN',
            confidence: 0.6,
        };
    }
    // Bare "no" / "nah" / "nope" — only if the message is very short (avoids matching "no, I attack")
    if (lower.length <= 10 && /^(no|nah|nope|n)\b/.test(lower.trim())) {
        return {
            actionType: 'END_TURN',
            confidence: 0.5,
        };
    }

    // Query keywords — questions about options, rules, or combat state
    const isQuestion = lower.includes('?') || lower.startsWith('what') || lower.startsWith('how') ||
        lower.startsWith('can i') || lower.startsWith('do i') || lower.startsWith('am i') ||
        lower.includes('my options') || lower.includes('what can') || lower.includes('what do');
    if (isQuestion) {
        return { actionType: 'QUERY', confidence: 0.8 };
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
