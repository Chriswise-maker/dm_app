/**
 * Combat Transition Module
 * 
 * Handles the boundary between narrative mode and combat engine mode.
 * When the LLM signals combatInitiated: true, the narrative should contain
 * ONLY scene-setting — no resolved mechanics. This module provides a safety
 * net to strip mechanical artifacts the LLM may hallucinate despite prompt
 * instructions.
 */

/**
 * Strip mechanical artifacts from combat initiation narratives.
 * 
 * The LLM sometimes resolves attacks, damage, initiative, and dice rolls
 * in the narrative even when instructed not to. This is a safety net —
 * the prompt constraint in STRUCTURED_OUTPUT_WRAPPER is the primary fix.
 * 
 * @param narrative - The raw LLM narrative when combatInitiated is true
 * @returns Cleaned narrative with mechanical content removed
 */
export function stripCombatMechanics(narrative: string): string {
    let cleaned = narrative;

    // =========================================================================
    // 1. Remove inline mechanical notation
    // =========================================================================

    // Parenthesized mechanics: (Attack: 18 vs AC 12), (DC 14 Constitution), (1d8+3 = 7)
    cleaned = cleaned.replace(/\((?:Attack|Roll|DC|Save|Saving Throw|Damage|Initiative|AC)[^)]*\)/gi, '');

    // Bracketed mechanics: [DC 14], [Attack Roll], [COMBAT INITIATED]
    cleaned = cleaned.replace(/\[\s*(?:DC|Attack|Save|Initiative|COMBAT|HP|Damage)[^\]]*\]/gi, '');

    // =========================================================================
    // 2. Remove damage references
    // =========================================================================

    // Typed damage: "7 piercing damage", "12 radiant damage"
    cleaned = cleaned.replace(
        /\b\d+\s+(?:piercing|slashing|bludgeoning|fire|cold|lightning|thunder|poison|acid|necrotic|radiant|force|psychic)\s+damage\b/gi,
        ''
    );

    // Generic damage: "take 8 damage", "takes 7 damage", "dealing 12 damage"
    cleaned = cleaned.replace(/\b(?:takes?|deals?|dealing|suffer(?:s|ing)?)\s+\d+\s+damage\b/gi, '');

    // Damage amounts at end of sentence: "...for 8 damage."
    cleaned = cleaned.replace(/\bfor\s+\d+\s+damage\b/gi, '');

    // =========================================================================
    // 3. Remove HP tracking
    // =========================================================================

    // HP transitions: "HP: 28 → 21", "HP: 28 -> 21"
    cleaned = cleaned.replace(/HP:\s*\d+\s*[→\->]+\s*\d+(?:\/\d+)?/gi, '');

    // HP status: "(21/28 HP)", "(21/28 HP remaining)", "HP remaining"
    cleaned = cleaned.replace(/\(\s*\d+\s*\/\s*\d+\s*HP(?:\s*remaining)?\s*\)/gi, '');

    // Inline HP: "at 21 HP", "down to 15 HP"
    cleaned = cleaned.replace(/\b(?:at|down to|with|has)\s+\d+\s*(?:\/\s*\d+\s*)?HP\b/gi, '');

    // =========================================================================
    // 4. Remove initiative and turn order
    // =========================================================================

    // Initiative listings: "Initiative Order: Mira 16, Seeker 14, You 13"
    cleaned = cleaned.replace(/Initiative(?:\s+Order)?:\s*[^\n]+/gi, '');

    // Turn order with arrows: "Mira (16) → Seeker (14) → Silas (13)"
    cleaned = cleaned.replace(/(?:\w+\s*\(\d+\)\s*→\s*){2,}[\w\s()]+/g, '');

    // "INITIATIVE ORDER" as a header
    cleaned = cleaned.replace(/\*?\*?INITIATIVE ORDER\*?\*?:?\s*[^\n]*/gi, '');

    // =========================================================================
    // 5. Remove dice notation and rolls
    // =========================================================================

    // Dice formulas in prose: "1d20+5", "2d8+3", "1d6"
    cleaned = cleaned.replace(/\b\d+d\d+(?:\s*[+\-]\s*\d+)?\b/g, '');

    // Roll results: "rolls a 16", "rolled 18", "natural 20", "nat 1"
    cleaned = cleaned.replace(/\b(?:rolls?\s+(?:a\s+)?\d+|nat(?:ural)?\s+\d+)\b/gi, '');

    // Attack roll vs AC: "18 vs AC 12", "16 against AC 14"
    cleaned = cleaned.replace(/\b\d+\s+(?:vs\.?|against|versus)\s+(?:AC\s*)?\d+\b/gi, '');

    // =========================================================================
    // 6. Remove stat blocks and combat status sections
    // =========================================================================

    // Stat-block-like lines: "AC: 15", "HP: 68/68"
    cleaned = cleaned.replace(/\b(?:AC|HP|Spell Slots):\s*[\d/]+(?:\s*\([^)]*\))?/gi, '');

    // Combat status headers and their content blocks
    cleaned = cleaned.replace(/(?:COMBAT STATUS|BATTLEFIELD|YOUR STATUS|ENEMIES|TARGETING OPTIONS):?\s*\n(?:[\s\S]*?)(?=\n\n|\n[A-Z]|$)/gi, '');

    // "Roll for initiative!" — the engine handles initiative prompting
    cleaned = cleaned.replace(/\*?\*?Roll for initiative!?\*?\*?/gi, '');

    // =========================================================================
    // 7. Remove common LLM combat framing
    // =========================================================================

    // Seeker/enemy attack resolution: "Seeker 1 Attack Roll: 16 (hits AC 12)"
    cleaned = cleaned.replace(/\w+\s*\d*\s*Attack Roll:\s*\d+\s*\([^)]*\)/gi, '');

    // Damage lines: "Damage: 1d8+2 = 7 piercing damage"
    cleaned = cleaned.replace(/Damage:\s*[^\n]+/gi, '');

    // Constitution/Saving Throw prompts: "Constitution Saving Throw required: DC 14"
    cleaned = cleaned.replace(/\w+\s+Saving Throw\s+required:\s*DC\s*\d+/gi, '');

    // "On failure/success" mechanical descriptions
    cleaned = cleaned.replace(/On (?:failure|success):\s*[^\n]+/gi, '');

    // =========================================================================
    // 8. Clean up artifacts
    // =========================================================================

    // Empty parentheses and brackets left behind
    cleaned = cleaned.replace(/\(\s*\)/g, '');
    cleaned = cleaned.replace(/\[\s*\]/g, '');

    // Multiple consecutive newlines → max 2
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

    // Multiple spaces → single space
    cleaned = cleaned.replace(/[ \t]{2,}/g, ' ');

    // Dangling punctuation after removed content: "The bolt .  " → "The bolt."
    cleaned = cleaned.replace(/\s+([.,!?])/g, '$1');

    // Lines that are now just whitespace or a single punctuation mark
    cleaned = cleaned.replace(/^\s*[.,;:]\s*$/gm, '');

    // Trim each line
    cleaned = cleaned.split('\n').map(line => line.trim()).join('\n');

    // Final trim
    cleaned = cleaned.trim();

    // If we stripped so aggressively that nothing meaningful remains,
    // return a generic transition line rather than empty string
    if (cleaned.length < 20) {
        return 'Steel is drawn. Blood is about to be spilled.';
    }

    return cleaned;
}