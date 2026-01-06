/**
 * Attack Detector Module
 * Detects attack intent from player messages
 */

interface AttackDetectionResult {
    isAttack: boolean;
    targetName?: string;
    spellName?: string;
    isRanged?: boolean;
}

/**
 * Detect if a player message indicates an attack
 */
export function detectAttack(message: string): AttackDetectionResult {
    const lowerMessage = message.toLowerCase().trim();

    // Common attack patterns
    const attackPatterns = [
        /i (?:want to )?attack (?:the )?(.+)/i,
        /i (?:want to )?hit (?:the )?(.+)/i,
        /i (?:want to )?strike (?:the )?(.+)/i,
        /i (?:want to )?swing (?:at |my .+ at )?(?:the )?(.+)/i,
        /i (?:want to )?shoot (?:at )?(?:the )?(.+)/i,
        /i (?:want to )?stab (?:the )?(.+)/i,
        /i (?:want to )?slash (?:at )?(?:the )?(.+)/i,
    ];

    // Spell attack patterns
    const spellPatterns = [
        /i (?:want to )?cast (.+?) (?:at|on) (?:the )?(.+)/i,
        /i (?:want to )?use (.+?) (?:at|on|against) (?:the )?(.+)/i,
    ];

    // Check regular attacks
    for (const pattern of attackPatterns) {
        const match = lowerMessage.match(pattern);
        if (match) {
            const targetName = cleanTargetName(match[1]);
            return {
                isAttack: true,
                targetName,
                isRanged: /shoot|bow|arrow|crossbow/i.test(lowerMessage),
            };
        }
    }

    // Check spell attacks
    for (const pattern of spellPatterns) {
        const match = lowerMessage.match(pattern);
        if (match) {
            const spellName = match[1].trim();
            const targetName = cleanTargetName(match[2]);

            // Only count as attack if it's a damage spell
            const damageSpells = [
                'fire bolt', 'eldritch blast', 'sacred flame', 'toll the dead',
                'ray of frost', 'chill touch', 'shocking grasp', 'magic missile',
                'guiding bolt', 'inflict wounds', 'chromatic orb', 'scorching ray',
            ];

            const isDamageSpell = damageSpells.some(spell =>
                spellName.toLowerCase().includes(spell)
            );

            if (isDamageSpell) {
                return {
                    isAttack: true,
                    targetName,
                    spellName,
                };
            }
        }
    }

    return { isAttack: false };
}

/**
 * Clean up target name from the message
 */
function cleanTargetName(raw: string): string {
    return raw
        .replace(/[.,!?;:].*$/, '') // Remove punctuation and anything after
        .replace(/with .+$/, '')    // Remove "with my sword" etc.
        .replace(/using .+$/, '')   // Remove "using my axe" etc.
        .trim();
}

/**
 * Find the best matching combatant name from a list
 */
export function findMatchingCombatant(
    targetName: string,
    combatants: Array<{ name: string; type: string }>
): { name: string; type: string } | null {
    const normalizedTarget = targetName.toLowerCase();

    // Exact match first
    const exactMatch = combatants.find(
        c => c.name.toLowerCase() === normalizedTarget
    );
    if (exactMatch) return exactMatch;

    // Partial match (target name is contained in combatant name)
    const partialMatch = combatants.find(
        c => c.name.toLowerCase().includes(normalizedTarget)
    );
    if (partialMatch) return partialMatch;

    // Fuzzy match (combatant name contains target)
    const fuzzyMatch = combatants.find(
        c => normalizedTarget.includes(c.name.toLowerCase())
    );
    if (fuzzyMatch) return fuzzyMatch;

    return null;
}
