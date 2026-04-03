
import { invokeLLMWithSettings, invokeLLMWithSettingsStream } from '../llm-with-settings';
import { activity } from '../activity-log';
import { getCombatNarrativePrompt } from '../prompts';
import type { CombatLogEntry, CombatEntity } from './combat-types';

/**
 * Additional context for combat narration.
 *
 * Currently optional — fields will be populated as DND data integration
 * is built out (weapon names, damage types, spell info, etc.).
 */
export interface CombatNarrativeContext {
    /** The weapon or spell used for the action (e.g. "greatsword", "Eldritch Blast") */
    weaponName?: string;
    /** Damage type of the attack (e.g. "slashing", "fire") */
    damageType?: string;
    /** Tactical role of the acting entity (for enemy narration flavor) */
    tacticalRole?: string;
    /** True when the engine is in AWAIT_DAMAGE_ROLL — player still needs to roll damage */
    awaitingDamageRoll?: boolean;
    /** The pending damage formula (e.g. "2d6+3") — shown to player */
    pendingDamageFormula?: string;
    /** Whether the pending hit is a critical */
    isCriticalHit?: boolean;
    /** True when the player still has resources (bonus action, etc.) after their action */
    playerHasRemainingResources?: boolean;
}

/**
 * Combat Narrator
 *
 * Generates immersive narrative text from combat log entries
 * and player flavor text.
 */

function createNameResolver(entities: CombatEntity[], activePlayerId?: string): (id: string | undefined) => string {
    const entityMap = new Map(entities.map(e => [e.id, e.name]));

    return (id: string | undefined) => {
        if (!id) return 'Unknown';
        if (activePlayerId && id === activePlayerId) return 'you';
        if (!activePlayerId) {
            const isPlayer = entities.some(e => e.type === 'player' && e.id === id);
            if (isPlayer) return 'you';
        }
        return entityMap.get(id) ?? id;
    };
}

async function computeCombatNarrativePrompts(
    userId: number,
    logs: CombatLogEntry[],
    playerFlavorText: string,
    actorName: string,
    entities: CombatEntity[],
    isEnemyTurn: boolean,
    activePlayerId?: string,
    narrativeContext?: CombatNarrativeContext
): Promise<{ systemPrompt: string; userPrompt: string; logSummary: string } | null> {
    if (logs.length === 0) {
        return null;
    }

    const resolveName = createNameResolver(entities, activePlayerId);
    const logSummary = logs.map(log => formatLogEntry(log, resolveName)).join('\n');

    const activeEntity = activePlayerId ? entities.find(e => e.id === activePlayerId) : entities.find(e => e.type === 'player');
    const playerName = activeEntity?.name || entities.find(e => e.type === 'player')?.name || 'the adventurer';

    // Build optional entity metadata block for grounding
    const actingEntity = entities.find(e => e.name === actorName);
    const contextLines: string[] = [];
    if (narrativeContext?.weaponName || actingEntity?.damageFormula) {
        contextLines.push(`WEAPON: ${narrativeContext?.weaponName || 'unknown'} (${narrativeContext?.damageType || actingEntity?.damageType || 'unknown'} damage)`);
    }
    if (narrativeContext?.isCriticalHit) {
        contextLines.push(`CRITICAL HIT: Yes — describe a devastating, precise strike`);
    }
    if (narrativeContext?.tacticalRole || actingEntity?.tacticalRole) {
        contextLines.push(`TACTICAL ROLE: ${narrativeContext?.tacticalRole || actingEntity?.tacticalRole}`);
    }
    const entityMetaBlock = contextLines.length > 0
        ? `\nENTITY DETAILS:\n${contextLines.join('\n')}\n`
        : '';

    // Determine how to end the narrative based on combat state
    let endingInstruction: string;
    if (narrativeContext?.playerHasRemainingResources) {
        // Player used their action but still has bonus action / other resources.
        // Prompt naturally like a real DM would: "anything else?"
        endingInstruction = 'End by naturally asking the player if they want to do anything else with their turn — like a real DM would. Examples: "Anything else?", "What else would you like to do?", "Do you want to do anything else before we move on?". Keep it natural and brief, not mechanical. Do NOT announce whose turn is next — it\'s still their turn.';
    } else {
        endingInstruction = 'End with whose turn it is next, or if combat ended';
    }

    let prompt: string;

    if (isEnemyTurn) {
        prompt = `You are the Dungeon Master narrating combat directly to the player.

PLAYER CHARACTER: ${playerName} (address as "you")
ENEMY ACTING: ${actorName} (describe in THIRD PERSON - "it", "the creature", "${actorName}")
${entityMetaBlock}
ENEMY'S FLAVOR:
"${playerFlavorText}"

MECHANICAL RESULTS:
${logSummary}

CRITICAL: Write a 2-3 sentence narrative from the PLAYER'S perspective:
- The ENEMY (${actorName}) is described in THIRD PERSON: "it attacks", "the creature lunges", "${actorName} strikes"
- The PLAYER is always "you": "you dodge", "you take damage", "your guard"
- NEVER say "you attack" or "you launch" when describing what the enemy does
- ${endingInstruction}`;
    } else {
        prompt = `You are the Dungeon Master narrating combat directly to the player.

PLAYER CHARACTER: ${actorName}
${entityMetaBlock}
PLAYER'S DESCRIPTION:
"${playerFlavorText}"

MECHANICAL RESULTS:
${logSummary}

Write a vivid, immersive 2-3 sentence narrative of what just happened.
- Address the player in SECOND PERSON ("you") - vary between "you", "your blade", or their name for variety
- Include the player's flavor where it fits naturally
- Use the WEAPON and damage type from ENTITY DETAILS — describe the attack in a way consistent with the weapon (e.g. arrows pierce, swords slash, maces crush)
- Scale the narrative intensity to the damage: a low roll barely grazes, a high roll strikes true, a critical hit is devastating
- ${endingInstruction}`;
    }

    const db = await import('../db');
    const userSettings = await db.getUserSettings(userId);
    const systemPrompt = getCombatNarrativePrompt(userSettings);

    return { systemPrompt, userPrompt: prompt, logSummary };
}

/**
 * Stream narrative tokens from the LLM (for SSE / real-time UI).
 */
export async function generateCombatNarrativeStream(
    sessionId: number,
    userId: number,
    logs: CombatLogEntry[],
    playerFlavorText: string,
    actorName: string,
    entities: CombatEntity[] = [],
    isEnemyTurn: boolean = false,
    activePlayerId?: string,
    narrativeContext?: CombatNarrativeContext
): Promise<AsyncIterable<string>> {
    const pre = await computeCombatNarrativePrompts(
        userId,
        logs,
        playerFlavorText,
        actorName,
        entities,
        isEnemyTurn,
        activePlayerId,
        narrativeContext
    );

    if (!pre) {
        return (async function* () {
            yield 'The action has no visible effect.';
        })();
    }

    activity.narrator(sessionId, `Generating narrative for ${logs.length} log entries`);

    try {
        return await invokeLLMWithSettingsStream(userId, {
            messages: [
                { role: 'system', content: pre.systemPrompt },
                { role: 'user', content: pre.userPrompt },
            ],
            maxTokens: 300,
        });
    } catch (error) {
        console.error('[CombatNarrator] Stream failed, using non-streaming fallback:', error);
        try {
            const response = await invokeLLMWithSettings(userId, {
                messages: [
                    { role: 'system', content: pre.systemPrompt },
                    { role: 'user', content: pre.userPrompt },
                ],
                maxTokens: 300,
            });
            const content = response.choices[0]?.message?.content;
            const narrative = typeof content === 'string' ? content : 'The battle continues...';
            return (async function* () {
                yield narrative;
            })();
        } catch (fallbackErr) {
            console.error('[CombatNarrator] Fallback failed:', fallbackErr);
            activity.error(sessionId, 'Failed to generate narrative', { error: String(fallbackErr) });
            return (async function* () {
                yield `You attack! ${pre.logSummary}`;
            })();
        }
    }
}

export async function generateCombatNarrative(
    sessionId: number,
    userId: number,
    logs: CombatLogEntry[],
    playerFlavorText: string,
    actorName: string,
    entities: CombatEntity[] = [],
    isEnemyTurn: boolean = false,
    activePlayerId?: string,
    narrativeContext?: CombatNarrativeContext
): Promise<string> {
    const stream = await generateCombatNarrativeStream(
        sessionId,
        userId,
        logs,
        playerFlavorText,
        actorName,
        entities,
        isEnemyTurn,
        activePlayerId,
        narrativeContext
    );

    let narrative = '';
    try {
        for await (const chunk of stream) {
            narrative += chunk;
        }
    } catch (error) {
        console.error('[CombatNarrator] Failed to generate narrative:', error);
        activity.error(sessionId, 'Failed to generate narrative', { error: String(error) });
        const pre = await computeCombatNarrativePrompts(
            userId,
            logs,
            playerFlavorText,
            actorName,
            entities,
            isEnemyTurn,
            activePlayerId
        );
        return pre ? `You attack! ${pre.logSummary}` : 'The action has no visible effect.';
    }

    if (logs.length > 0) {
        activity.narrator(sessionId, 'Narrative generated successfully');
    }

    return narrative.trim() || 'The battle continues...';
}

/**
 * Generate a deterministic initiative narrative (no LLM call).
 * Returns instantly with a formatted turn order message.
 */
export function generateInitiativeNarrative(
    entities: CombatEntity[],
    turnOrder: string[]
): string {
    const ordered = turnOrder
        .map(id => entities.find(e => e.id === id))
        .filter(Boolean)
        .map(e => `**${e!.name}** (${e!.initiative})`)
        .join(' → ');

    const firstEntity = turnOrder.length > 0
        ? entities.find(e => e.id === turnOrder[0])
        : null;

    let msg = `**Initiative rolled! The battle begins!**\n\n**Turn Order:** ${ordered}`;
    if (firstEntity) {
        msg += `\n\n*${firstEntity.name}'s turn!*`;
    }
    return msg;
}

/**
 * Generate a brief mechanical summary from combat logs (no LLM call).
 * Used as immediate feedback while full LLM narrative generates async.
 */
export function generateMechanicalSummary(
    logs: CombatLogEntry[],
    entities: CombatEntity[],
    activePlayerId?: string
): string {
    const resolveName = createNameResolver(entities, activePlayerId);
    return logs.map(log => formatLogEntry(log, resolveName)).join('\n');
}

/**
 * Fire-and-forget: generate LLM narrative and save as a DM message.
 * Falls back to mechanical summary on error.
 */
export async function generateAndSaveNarrativeAsync(
    sessionId: number,
    userId: number,
    logs: CombatLogEntry[],
    flavorText: string,
    actorName: string,
    entities: CombatEntity[],
    isEnemyTurn: boolean,
    activePlayerId?: string,
    appendText?: string,
    narrativeContext?: CombatNarrativeContext
): Promise<void> {
    try {
        const narrative = await generateCombatNarrative(
            sessionId, userId, logs, flavorText, actorName, entities, isEnemyTurn, activePlayerId, narrativeContext
        );
        const db = await import('../db');
        let content = narrative;
        if (appendText) content += appendText;
        await db.saveMessage({ sessionId, characterName: 'DM', content, isDm: 1 });
    } catch (err) {
        console.error('[CombatNarrator] Async narrative failed:', err);
        try {
            const db = await import('../db');
            const fallback = flavorText || 'The battle continues...';
            await db.saveMessage({ sessionId, characterName: 'DM', content: fallback, isDm: 1 });
        } catch (saveErr) {
            console.error('[CombatNarrator] Fallback save failed:', saveErr);
        }
    }
}

function formatLogEntry(log: CombatLogEntry, resolveName: (id: string | undefined) => string): string {
    switch (log.type) {
        case 'ATTACK_ROLL':
            const rollVal = log.roll?.result ?? '?';
            const isCrit = log.roll?.isCritical;
            const hitStatus = log.success ? 'HIT' : 'MISS';
            return `Attack roll: ${rollVal} (${hitStatus}${isCrit ? ' - CRITICAL!' : ''})`;
        case 'DAMAGE':
            return `Damage: ${log.amount} ${log.damageType || ''} to ${resolveName(log.targetId)}`;
        case 'HEALING':
            return `Healed: ${log.amount} hp to ${resolveName(log.targetId)}`;
        case 'DEATH':
            return `${resolveName(log.targetId) || resolveName(log.actorId)} was killed!`;
        case 'UNCONSCIOUS':
            return `${resolveName(log.targetId) || resolveName(log.actorId)} falls unconscious!`;
        case 'TURN_START':
            return `${resolveName(log.actorId)}'s turn begins`;
        case 'TURN_END':
            return `${resolveName(log.actorId)}'s turn ends`;
        case 'CUSTOM':
            return `Info: ${log.description}`;
        default:
            return log.description ? `[${log.type}] ${log.description}` : `[${log.type}]`;
    }
}
