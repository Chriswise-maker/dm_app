/**
 * Response Parser Module
 * Parses structured JSON responses from the DM LLM
 * Handles automatic combat detection and game state changes
 */

export interface EnemyData {
    name: string;
    ac: number;
    hpMax: number;
    attackBonus: number;
    damageFormula: string;
    damageType: string;
    initiative?: number;
}

export interface HpChange {
    target: string;
    amount: number;
}

export interface GameStateChanges {
    combatInitiated?: boolean;
    combatEnded?: boolean;
    enemies?: EnemyData[];
    hpChanges?: HpChange[];
}

export interface StructuredDMResponse {
    narrative: string;
    gameStateChanges?: GameStateChanges;
}

/**
 * Parse a structured DM response from the LLM
 * Handles various edge cases including markdown wrapping and plain text fallback
 */
export function parseStructuredResponse(content: string): StructuredDMResponse {
    if (!content || typeof content !== 'string') {
        return { narrative: 'The DM is pondering...' };
    }

    let jsonContent = content.trim();

    // Remove markdown code blocks if present
    if (jsonContent.startsWith('```')) {
        jsonContent = jsonContent
            .replace(/^```(?:json)?\s*\n?/, '')
            .replace(/\n?```\s*$/, '');
    }

    // Try to parse as JSON
    try {
        const parsed = JSON.parse(jsonContent);

        // Validate the structure
        if (typeof parsed === 'object' && parsed !== null) {
            // Check if it has the expected structure
            if (typeof parsed.narrative === 'string') {
                return {
                    narrative: parsed.narrative,
                    gameStateChanges: parseGameStateChanges(parsed.gameStateChanges),
                };
            }

            // Maybe the LLM returned just a simple object without proper structure
            // Try to extract any text content
            if (parsed.response || parsed.text || parsed.message) {
                return {
                    narrative: parsed.response || parsed.text || parsed.message,
                };
            }
        }

        // If we got here, the JSON was valid but unexpected structure
        // Use the stringified content as narrative
        console.warn('[ResponseParser] Unexpected JSON structure:', parsed);
        return { narrative: JSON.stringify(parsed) };

    } catch (parseError) {
        // JSON parsing failed - treat the entire content as narrative
        // This is the fallback for when the LLM doesn't follow instructions
        console.warn('[ResponseParser] Failed to parse JSON, treating as plain narrative:', parseError);
        return { narrative: content };
    }
}

/**
 * Parse and validate game state changes
 */
function parseGameStateChanges(changes: unknown): GameStateChanges | undefined {
    if (!changes || typeof changes !== 'object') {
        return undefined;
    }

    const result: GameStateChanges = {};
    const changesObj = changes as Record<string, unknown>;

    // Combat initiated
    if (changesObj.combatInitiated === true) {
        result.combatInitiated = true;
    }

    // Combat ended
    if (changesObj.combatEnded === true) {
        result.combatEnded = true;
    }

    // Parse enemies array
    if (Array.isArray(changesObj.enemies) && changesObj.enemies.length > 0) {
        result.enemies = changesObj.enemies
            .filter(isValidEnemy)
            .map(normalizeEnemy);
    }

    // Parse HP changes
    if (Array.isArray(changesObj.hpChanges) && changesObj.hpChanges.length > 0) {
        result.hpChanges = changesObj.hpChanges
            .filter(isValidHpChange)
            .map(normalizeHpChange);
    }

    // Only return if we have at least one change
    if (Object.keys(result).length === 0) {
        return undefined;
    }

    return result;
}

/**
 * Type guard for valid enemy data
 */
function isValidEnemy(enemy: unknown): enemy is Record<string, unknown> {
    if (!enemy || typeof enemy !== 'object') return false;
    const e = enemy as Record<string, unknown>;
    return (
        typeof e.name === 'string' &&
        typeof e.ac === 'number' &&
        typeof e.hpMax === 'number'
    );
}

/**
 * Normalize enemy data with defaults
 */
function normalizeEnemy(enemy: Record<string, unknown>): EnemyData {
    return {
        name: String(enemy.name),
        ac: Number(enemy.ac) || 10,
        hpMax: Number(enemy.hpMax) || 10,
        attackBonus: Number(enemy.attackBonus) || 0,
        damageFormula: String(enemy.damageFormula || '1d6'),
        damageType: String(enemy.damageType || 'slashing'),
        initiative: typeof enemy.initiative === 'number' ? enemy.initiative : undefined,
    };
}

/**
 * Type guard for valid HP change
 */
function isValidHpChange(change: unknown): change is Record<string, unknown> {
    if (!change || typeof change !== 'object') return false;
    const c = change as Record<string, unknown>;
    return typeof c.target === 'string' && typeof c.amount === 'number';
}

/**
 * Normalize HP change data
 */
function normalizeHpChange(change: Record<string, unknown>): HpChange {
    return {
        target: String(change.target),
        amount: Number(change.amount),
    };
}

/**
 * Check if structured response contains combat initiation
 */
export function hasCombatInitiation(response: StructuredDMResponse): boolean {
    // Primary check: explicit combatInitiated flag
    if (response.gameStateChanges?.combatInitiated === true) {
        return true;
    }

    // Fallback: Check for combat keywords in narrative
    return detectCombatInNarrative(response.narrative);
}

/**
 * Fallback detection: Look for combat markers in the narrative
 * This helps catch cases where the LLM narrates combat without properly setting the flag
 */
function detectCombatInNarrative(narrative: string): boolean {
    if (!narrative) return false;

    const upperNarrative = narrative.toUpperCase();

    // Combat header patterns that indicate formal combat
    const combatPatterns = [
        /\bINITIATIVE\b.*\bORDER\b/i,
        /\bROLL\s+FOR\s+INITIATIVE\b/i,
        /\bCOMBAT\s*:\s*ROUND\s+\d+/i,
        /\bROUND\s+\d+\b.*\bINITIATIVE\b/i,
        /\bYOUR\s+TURN\s*[-—]\s*\w+/i,
        /\b(ATTACK\s+ROLL|TO\s+HIT)\s*:\s*🎲?\s*\d+d\d+/i,
    ];

    for (const pattern of combatPatterns) {
        if (pattern.test(narrative)) {
            console.log('[ResponseParser] Fallback combat detection triggered by pattern:', pattern.source);
            return true;
        }
    }

    return false;
}

/**
 * Check if structured response contains combat end
 */
export function hasCombatEnd(response: StructuredDMResponse): boolean {
    return response.gameStateChanges?.combatEnded === true;
}

/**
 * Get enemies from structured response
 */
export function getEnemies(response: StructuredDMResponse): EnemyData[] {
    return response.gameStateChanges?.enemies || [];
}
