
import { invokeLLMWithSettings } from '../llm-with-settings';
import { activity } from '../activity-log';
import { getCombatNarrativePrompt } from '../prompts';
import type { CombatLogEntry, CombatEntity } from './combat-types';

/**
 * Combat Narrator
 * 
 * Generates immersive narrative text from combat log entries
 * and player flavor text.
 */

// Helper to resolve entity IDs to names
// When activePlayerId is set: only that player gets "you"; other players use their name (multi-player fix)
// When activePlayerId is unset: all players get "you" (legacy single-player behavior)
function createNameResolver(entities: CombatEntity[], activePlayerId?: string): (id: string | undefined) => string {
    const entityMap = new Map(entities.map(e => [e.id, e.name]));

    return (id: string | undefined) => {
        if (!id) return 'Unknown';
        if (activePlayerId && id === activePlayerId) return 'you';
        if (!activePlayerId) {
            // Legacy: all players = "you"
            const isPlayer = entities.some(e => e.type === 'player' && e.id === id);
            if (isPlayer) return 'you';
        }
        return entityMap.get(id) ?? id;
    };
}

export async function generateCombatNarrative(
    sessionId: number,
    userId: number,
    logs: CombatLogEntry[],
    playerFlavorText: string,
    actorName: string,
    entities: CombatEntity[] = [], // Entity list for name resolution
    isEnemyTurn: boolean = false, // Whether this is an enemy's turn
    activePlayerId?: string // Entity ID to use "you" for (turn owner or attack target); omit for legacy
): Promise<string> {
    // If no logs, just return generic response (shouldn't happen in valid flow)
    if (logs.length === 0) {
        return "The action has no visible effect.";
    }

    // Create name resolver: only activePlayerId gets "you" in multi-player
    const resolveName = createNameResolver(entities, activePlayerId);

    // Build prompt from logs
    const logSummary = logs.map(log => formatLogEntry(log, resolveName)).join('\n');

    // Find the active player's name for reference (who we're addressing as "you")
    const activeEntity = activePlayerId ? entities.find(e => e.id === activePlayerId) : entities.find(e => e.type === 'player');
    const playerName = activeEntity?.name || entities.find(e => e.type === 'player')?.name || 'the adventurer';

    let prompt: string;

    if (isEnemyTurn) {
        // ENEMY TURN: Describe enemy actions in third person, player as "you"
        prompt = `You are the Dungeon Master narrating combat directly to the player.

PLAYER CHARACTER: ${playerName} (address as "you")
ENEMY ACTING: ${actorName} (describe in THIRD PERSON - "it", "the creature", "${actorName}")

ENEMY'S FLAVOR:
"${playerFlavorText}"

MECHANICAL RESULTS:
${logSummary}

CRITICAL: Write a 2-3 sentence narrative from the PLAYER'S perspective:
- The ENEMY (${actorName}) is described in THIRD PERSON: "it attacks", "the creature lunges", "${actorName} strikes"
- The PLAYER is always "you": "you dodge", "you take damage", "your guard"
- NEVER say "you attack" or "you launch" when describing what the enemy does
- End with whose turn it is next`;
    } else {
        // PLAYER TURN: Address player in second person
        prompt = `You are the Dungeon Master narrating combat directly to the player.

PLAYER CHARACTER: ${actorName}
PLAYER'S DESCRIPTION:
"${playerFlavorText}"

MECHANICAL RESULTS:
${logSummary}

Write a vivid, immersive 2-3 sentence narrative of what just happened.
- Address the player in SECOND PERSON ("you") - vary between "you", "your blade", or their name for variety
- Include the player's flavor where it fits naturally
- End with whose turn it is next, or if combat ended`;
    }


    activity.narrator(sessionId, `Generating narrative for ${logs.length} log entries`);

    // Fetch user settings for customizable narrator prompt
    const db = await import('../db');
    const userSettings = await db.getUserSettings(userId);
    const systemPrompt = getCombatNarrativePrompt(userSettings);

    try {
        const response = await invokeLLMWithSettings(userId, {
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: prompt },
            ],
            maxTokens: 300,
        });

        const content = response.choices[0]?.message?.content;
        const narrative = typeof content === 'string' ? content : 'The battle continues...';

        activity.narrator(sessionId, 'Narrative generated successfully');
        return narrative;
    } catch (error) {
        console.error('[CombatNarrator] Failed to generate narrative:', error);
        activity.error(sessionId, 'Failed to generate narrative', { error: String(error) });
        return `You attack! ${logSummary}`;
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

