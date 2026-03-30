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

export interface SkillCheckRequest {
    ability?: string;
    skill?: string;
    dc: number;
    advantage?: boolean;
    disadvantage?: boolean;
    reason?: string;
}

export interface GameStateChanges {
    combatInitiated?: boolean;
    combatEnded?: boolean;
    enemies?: EnemyData[];
    hpChanges?: HpChange[];
    skillCheck?: SkillCheckRequest;
}

export interface StructuredDMResponse {
    narrative: string;
    gameStateChanges?: GameStateChanges;
}

/**
 * Parse a structured DM response from the LLM
 * Handles various edge cases including markdown wrapping, malformed JSON, and plain text fallback
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

    // Attempt to extract JSON object if the content is not just a clean JSON string
    if (!jsonContent.startsWith('{')) {
        const firstBrace = jsonContent.indexOf('{');
        const lastBrace = jsonContent.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
            jsonContent = jsonContent.substring(firstBrace, lastBrace + 1);
        }
    }

    // Try to parse as JSON
    try {
        const parsed = JSON.parse(jsonContent);

        if (typeof parsed === 'object' && parsed !== null && typeof parsed.narrative === 'string') {
            console.log('[ResponseParser] Successfully parsed JSON, narrative length:', parsed.narrative.length);
            return {
                narrative: parsed.narrative,
                gameStateChanges: parseGameStateChanges(parsed.gameStateChanges),
            };
        }

        // Try alternate keys
        if (parsed.response || parsed.text || parsed.message) {
            return { narrative: parsed.response || parsed.text || parsed.message };
        }

        console.warn('[ResponseParser] Unexpected JSON structure:', Object.keys(parsed));
        return { narrative: JSON.stringify(parsed) };

    } catch (parseError) {
        console.log('[ResponseParser] JSON.parse failed, attempting regex extraction...');

        // JSON parse failed - try to extract narrative using regex
        // This handles cases where the LLM includes unescaped newlines in strings
        const narrativeMatch = jsonContent.match(/"narrative"\s*:\s*"([\s\S]*?)(?:"\s*,\s*"gameStateChanges"|"\s*}$)/);
        if (narrativeMatch && narrativeMatch[1]) {
            // Unescape any escaped quotes and clean up
            const extractedNarrative = narrativeMatch[1]
                .replace(/\\"/g, '"')
                .replace(/\\n/g, '\n')
                .trim();

            console.log('[ResponseParser] Extracted narrative via regex, length:', extractedNarrative.length);

            // Also try to extract gameStateChanges
            const gameStateMatch = jsonContent.match(/"gameStateChanges"\s*:\s*(\{[\s\S]*?\})\s*\}$/);
            let gameStateChanges: GameStateChanges | undefined;
            if (gameStateMatch && gameStateMatch[1]) {
                try {
                    const cleanedGameState = gameStateMatch[1].replace(/[\n\r]/g, '');
                    gameStateChanges = parseGameStateChanges(JSON.parse(cleanedGameState));
                } catch (e) {
                    console.log('[ResponseParser] Could not parse gameStateChanges');
                }
            }

            return { narrative: extractedNarrative, gameStateChanges };
        }

        // Last resort: check if content looks like JSON at all
        if (jsonContent.includes('"narrative"')) {
            // It was supposed to be JSON but we couldn't extract it
            // Try one more thing: remove all control characters and parse
            const sanitized = jsonContent.replace(/[\x00-\x1F\x7F]/g, ' ');
            try {
                const parsed = JSON.parse(sanitized);
                if (typeof parsed.narrative === 'string') {
                    return {
                        narrative: parsed.narrative,
                        gameStateChanges: parseGameStateChanges(parsed.gameStateChanges),
                    };
                }
            } catch (e) {
                // Give up on JSON parsing
            }
        }

        // Final fallback: return raw content (not ideal but better than crashing)
        console.warn('[ResponseParser] All parsing attempts failed, returning raw content');
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

    if (isValidSkillCheck(changesObj.skillCheck)) {
        result.skillCheck = normalizeSkillCheck(changesObj.skillCheck);
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

function isValidSkillCheck(value: unknown): value is Record<string, unknown> {
    if (!value || typeof value !== 'object') return false;
    const check = value as Record<string, unknown>;
    return typeof check.dc === 'number';
}

function normalizeSkillCheck(value: Record<string, unknown>): SkillCheckRequest {
    return {
        ability: typeof value.ability === 'string' ? value.ability : undefined,
        skill: typeof value.skill === 'string' ? value.skill : undefined,
        dc: Math.max(1, Math.min(30, Math.round(Number(value.dc)))),
        advantage: value.advantage === true,
        disadvantage: value.disadvantage === true,
        reason: typeof value.reason === 'string' ? value.reason : undefined,
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
