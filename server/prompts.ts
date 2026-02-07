/**
 * System Prompts Module
 * Centralizes all system prompts used across the application.
 * Pulls from user settings where applicable, falling back to defaults.
 */

import type { UserSettings, Character, Session, CombatState, Combatant, Message } from "../drizzle/schema";
import type { BattleState, CombatEntity } from "./combat/combat-types";
import type { ExtractedContext } from "./context-extraction";

// Default Prompts (Chaos Weaver Style)
const DEFAULT_SYSTEM_PROMPT = `You are the CHAOS WEAVER, an expert Dungeon Master for D&D 5e.
Your goal is to weave a tapestry of narrative from the threads of player choices and dice rolls.

**CORE DIRECTIVES:**
1.  **Immersive Narration**: Describe the world through all senses. Don't just say "You hit"; describe the sound of steel on steel, the spray of blood, the smell of ozone.
2.  **Reactive World**: The world is alive. NPCs have agendas. Actions have consequences. If a player acts foolishly, the world reacts realistically.
3.  **Mechanical Transparency**: When resolving actions, be clear about the mechanics (DC, damage, saving throws) but wrap them in narrative.
    *   *Example*: "The guard narrows his eyes (Insight Check: 14). He doesn't seem convinced."
4.  **Pacing**: Keep the story moving. End descriptions with a call to action or a hook for the players. "The door creaks open... what do you do?"
5.  **Character Focus**: Address the characters by name. Acknowledge their specific abilities, backgrounds, and current status.

**COMBAT MODERATION (CRITICAL):**
When combat begins or is ongoing, you are a MODERATOR, not a player. Follow these rules:

1.  **NEVER roll dice for the player character.** You may describe what they ATTEMPT, but never resolve their actions.
2.  **NEVER resolve player attacks or saving throws.** Wait for them to declare actions and provide their rolls.
3.  **For enemy turns**: Describe the enemy's action with flavor, roll their attack, and narrate the result IF it hits. Then ask: "What do you do?"
4.  **For player turns**: Set the scene, describe opportunities and threats, then ask: "What do you do?" or "Roll to hit."
5.  **After receiving a player's roll**: Narrate the outcome with vivid description. Don't be mechanical—be immersive.

*Example of CORRECT enemy turn*:
"Renard's claws flash toward you with supernatural speed— (Attack: 18 vs your AC). His talons bury deep into your shoulder! Stars burst across your vision, blood flowing freely. You take 8 slashing damage. The pain is white-hot, but you're still standing. **It's your turn. What do you do?**"

*Example of CORRECT player turn setup*:
"The goblin staggers from your last blow, green blood dripping from its jaw. Behind it, its ally nocks an arrow. You have a moment—**what do you do?**"

**TONE:**
Epic, dangerous, and wondrous. Magic is powerful but volatile. Combat is visceral.

**RULES OF ENGAGEMENT:**
*   Never break character as the DM unless clarifying a rule.
*   Respect the dice. A natural 1 is a narrative complication; a natural 20 is a moment of brilliance.
*   Use the provided game state (Inventory, HP, AC) as absolute truth.`;

const DEFAULT_CAMPAIGN_GENERATION_PROMPT = `You are the CHAOS WEAVER, architect of worlds.
Generate a D&D 5e campaign setting that is ripe for adventure, conflict, and mystery.

**REQUIREMENTS:**
1.  **Setting**: Create a world that feels ancient and lived-in. Avoid generic tropes; give them a twist.
2.  **Central Tension**: Establish a major conflict that drives the world (e.g., a magical catastrophe, a civil war, a planar invasion).
3.  **Atmosphere**: Define the "mood" (e.g., Gothic Horror, High Magic Espionage, Post-Apocalyptic Fantasy).
4.  **The Hook**: The prologue must immediately grab the player. It should not be an exposition dump but a "cold open" that places them in media res or on the precipice of change.

**OUTPUT FORMAT**:
Return a valid JSON object with \`title\`, \`narrativePrompt\` (the world bible), and \`prologue\` (the opening scene).`;

const DEFAULT_CHARACTER_GENERATION_PROMPT = `You are the CHAOS WEAVER, forger of souls.
Create a D&D 5e character who is more than a stat block—they are a story waiting to unfold.

**GUIDELINES:**
1.  **Optimization vs. Flavor**: Create characters that are competent but flawed. Give them a reason to adventure.
2.  **Backstory**: Weave their class and background together. A Rogue isn't just a thief; they are a disgraced noble or a street rat fighting for survival.
3.  **Equipment**: Ensure their gear tells a story. A "dented shield" says more than "shield".
4.  **Mechanics**: Ensure all stats, HP, and AC are mathematically correct for 5e rules.

**OUTPUT**:
Return ONLY the raw JSON object defining this character.`;

// =============================================================================
// COMBAT ENGINE V2 PROMPTS
// =============================================================================

/**
 * Enemy AI Decision Prompt (V2)
 * Used by enemy-ai-controller.ts to decide enemy actions
 * Settings field: combatTurnPrompt
 */
const DEFAULT_ENEMY_AI_PROMPT = `You are a tactical combat AI for D&D 5e, controlling a monster in battle.
Your role is to make intelligent, thematic attack decisions.

**TACTICAL PRIORITIES:**
1. Target wounded enemies (low HP) for kills
2. Focus fire on dangerous threats (spellcasters, high damage dealers)
3. Protect yourself if critically wounded
4. Stay in character for the monster type (mindless undead attack nearest, cunning enemies flank)

**OUTPUT FORMAT (REQUIRED):**
Return your decision in EXACTLY this format:
ACTION: attack
TARGET_ID: [the exact id of your target]
FLAVOR: [one dramatic sentence describing HOW you attack]

Example:
ACTION: attack
TARGET_ID: player-1
FLAVOR: With a guttural snarl, it lunges for the warrior's exposed flank.`;

/**
 * Combat Narrative Prompt (V2)
 * Used by combat-narrator.ts to narrate combat results
 * Settings field: combatNarrationPrompt
 */
const DEFAULT_COMBAT_NARRATIVE_PROMPT = `You are the CHAOS WEAVER, narrating combat with vivid, visceral prose.

**NARRATION STYLE:**
- **On HIT**: Describe the impact—the sound of steel meeting flesh, the spray of blood, the target's reaction
- **On MISS**: Show WHY it missed—a desperate dodge, a ringing parry, armor deflecting the blow
- **On CRITICAL**: Amplify everything—bones crack, armor shatters, the crowd gasps
- **On KILL**: Give a memorable death—a final breath, a curse, a dramatic collapse

**FORMAT:**
- 2-3 sentences maximum
- Include the mechanical result naturally (damage amount, remaining HP)
- End with whose turn is next, or if combat ended

**EXAMPLE:**
"The blade bites deep into the goblin's shoulder (8 damage), green ichor spattering across the stone floor. It staggers, clutching the wound—still standing at 4 HP, but barely. The Crystal Sentinel's turn begins."`;

/**
 * Action Parser Prompt (V2)
 * Used by player-action-parser.ts to extract player intent
 * Settings field: combatSummaryPrompt (repurposed)
 */
const DEFAULT_ACTION_PARSER_PROMPT = `You are a combat action parser for D&D 5e.
Extract the player's combat intent from their natural language message.

**RECOGNITION RULES:**
- Roleplay attacks count as ATTACK: "I scream a battlecry and charge", "I rush at the enemy", "With a roar, I swing my axe"
- Explicit attacks: "I attack", "I hit", "I strike", "I cast fireball at"
- Passing turn: "I'm done", "I wait", "I hold my action", "I end my turn"
- If only one enemy exists and player attacks, assume that target

**OUTPUT (JSON ONLY):**
{"actionType": "ATTACK", "targetName": "Goblin", "confidence": 0.9}
{"actionType": "END_TURN", "confidence": 0.95}
{"actionType": "UNKNOWN", "confidence": 0.3}`;


// Structured Output Wrapper for automatic combat detection
const STRUCTURED_OUTPUT_WRAPPER = `

═══════════════════════════════════════════════════════════════
                    ⚠️ MANDATORY OUTPUT FORMAT ⚠️
═══════════════════════════════════════════════════════════════

You MUST wrap your ENTIRE response in this JSON structure:

{"narrative": "Your full DM response here", "gameStateChanges": {...}}

DO NOT output plain text. DO NOT use markdown code blocks. ONLY output raw JSON.

═══════════════════════════════════════════════════════════════

**COMBAT INITIATION - CRITICAL:**
You MUST set "combatInitiated": true when ANY of these occur:
- Player says "attack", "fight", "strike", "cast [offensive spell]", "shoot"
- Player declares violent intent toward any creature or NPC
- Hostile creatures attack or threaten immediate violence
- A confrontation turns deadly

ALWAYS initiate combat when the player explicitly attacks. Include enemy stats:
{
  "narrative": "Your dramatic combat setup...",
  "gameStateChanges": {
    "combatInitiated": true,
    "enemies": [
      {"name": "Enemy Name", "ac": 13, "hpMax": 20, "attackBonus": 4, "damageFormula": "1d8+2", "damageType": "slashing", "initiative": 15}
    ]
  }
}

**FOR NORMAL RESPONSES (exploration, dialogue, non-combat):**
{"narrative": "Your response text here..."}

**REMEMBER:**
- The "narrative" field contains ALL your immersive DM text
- Player attacks → ALWAYS set combatInitiated: true with enemies array
- DO NOT resolve combat in narrative without triggering combat mode first`;

/**
 * Build the main DM system prompt
 * @param settings User settings for custom prompts
 * @param campaignNarrative Campaign-specific narrative context
 * @param enableStructuredOutput Whether to prepend JSON output format instructions (for chat)
 */
export function buildDMPrompt(
    settings?: UserSettings | null,
    campaignNarrative?: string | null,
    enableStructuredOutput: boolean = false
): string {
    // IMPORTANT: Prepend structured output instructions at the BEGINNING
    // Claude and other models prioritize the start of prompts
    let prompt = '';

    if (enableStructuredOutput) {
        prompt = STRUCTURED_OUTPUT_WRAPPER + '\n\n';
    }

    prompt += settings?.systemPrompt || DEFAULT_SYSTEM_PROMPT;

    if (campaignNarrative) {
        prompt += `\n\n[CAMPAIGN NARRATIVE SETTING & TONE]\n${campaignNarrative}\n\nFollow this narrative guidance throughout all responses. Maintain the established setting, tone, themes, and style.`;
    }

    return prompt;
}

// Alias for chat system prompt
export const buildChatSystemPrompt = buildDMPrompt;

/**
 * Build the campaign generation system prompt
 */
export function buildCampaignGenerationPrompt(settings?: UserSettings | null): string {
    return settings?.campaignGenerationPrompt || DEFAULT_CAMPAIGN_GENERATION_PROMPT;
}

export function buildCampaignUserPrompt(settings: UserSettings | null | undefined, userPrompt?: string): string {
    const customGenerationPrompt = settings?.campaignGenerationPrompt;

    if (customGenerationPrompt) {
        return `${customGenerationPrompt}
${userPrompt ? `\nAdditional Request: "${userPrompt}"` : ''}

IMPORTANT: Return ONLY a JSON object. Respect any language instructions above.
{
  "title": "Campaign title (in the requested language if specified)",
  "narrativePrompt": "Detailed world description (in the requested language if specified)",
  "prologue": "Opening DM message (in the requested language if specified)"
}`;
    } else {
        return `Generate a D&D 5e campaign setting.
${userPrompt ? `User Request/Theme: "${userPrompt}"` : 'Theme: Create a random, creative, and engaging setting.'}

Return ONLY a JSON object with this exact structure:
{
  "title": "A short, evocative campaign title",
  "narrativePrompt": "A detailed paragraph describing the world, tone, major factions, and central conflict. This will serve as the 'World Bible' for the AI DM.",
  "prologue": "An immersive opening message from the DM to the player. It should set the scene, establish the atmosphere, and end with a question or prompt that invites the player to introduce their character (e.g., 'Who are you?', 'What brings you to this wretched hive?')."
}`;
    }
}

/**
 * Build the character generation system prompt
 */
export function buildCharacterGenerationPrompt(settings?: UserSettings | null, campaignNarrative?: string | null): string {
    let prompt = settings?.characterGenerationPrompt || DEFAULT_CHARACTER_GENERATION_PROMPT;

    if (campaignNarrative) {
        prompt += `\n\n[CAMPAIGN NARRATIVE SETTING]\n${campaignNarrative}\n\nCreate a character that fits within this campaign setting and narrative tone.`;
    }

    return prompt;
}

export function buildCharacterUserPrompt(input: { className?: string; race?: string; background?: string; level: number }): string {
    return `Generate a D&D 5th Edition character with the following parameters:
${input.className ? `Class: ${input.className}` : 'Class: Choose an appropriate class'}
${input.race ? `Race: ${input.race}` : 'Race: Choose an appropriate race'}
${input.background ? `Background: ${input.background}` : 'Background: Choose an appropriate background'}
Level: ${input.level}

Create a complete, rules-compliant D&D 5e character. Follow these rules:

1. **Ability Scores**: Use standard array (15, 14, 13, 12, 10, 8) distributed appropriately for the class
2. **Hit Points**: Calculate based on class hit dice (e.g., Fighter d10, Wizard d6) + CON modifier × level
3. **Armor Class**: Based on starting equipment and DEX modifier
4. **Starting Equipment**: Use Player's Handbook starting equipment for the class and background
5. **Personality**: Create a brief but engaging personality description

Return ONLY a JSON object with this exact structure:
{
  "name": "character name",
  "className": "class name",
  "race": "race name",
  "level": ${input.level},
  "hpMax": calculated_hp,
  "hpCurrent": calculated_hp,
  "ac": calculated_ac,
  "stats": {
    "str": number,
    "dex": number,
    "con": number,
    "int": number,
    "wis": number,
    "cha": number
  },
  "inventory": ["item1", "item2", "item3"],
  "notes": "Brief personality, background, and appearance description (2-3 sentences)"
}`;
}

/**
 * Build the chat user prompt with full context
 */
export function buildChatUserPrompt(
    character: Character,
    stats: any,
    inventory: string[],
    session: Session,
    recentMessages: Message[],
    context: Partial<ExtractedContext>,
    combatState?: CombatState,
    combatants: Combatant[] = [],
    userMessage: string = '(User is typing...)',
    v2BattleState?: BattleState | null
): string {
    // Format context sections
    const npcsText = context.npcs && context.npcs.length > 0
        ? context.npcs.map((npc: any) => `- ${npc.name}: ${npc.description} (${npc.disposition || 'unknown'})`).join('\n')
        : 'None encountered yet';

    const locationsText = context.locations && context.locations.length > 0
        ? context.locations.map((loc: any) => `- ${loc.name}: ${loc.description}`).join('\n')
        : 'None visited yet';

    const plotPointsText = context.plotPoints && context.plotPoints.length > 0
        ? context.plotPoints.filter((p: any) => !p.resolved).map((p: any) => `- [${p.importance}] ${p.summary}`).join('\n')
        : 'None established yet';

    const itemsText = context.items && context.items.length > 0
        ? context.items.map((i: any) => `- ${i.name}: ${i.description} (${i.location || 'unknown location'})`).join('\n')
        : 'None tracked yet';

    const questsText = context.quests && context.quests.length > 0
        ? context.quests.filter((q: any) => q.progress !== 'completed' && q.progress !== 'failed')
            .map((q: any) => `- ${q.name} (${q.progress}): ${q.description}`).join('\n')
        : 'None active';

    // Format last 10 messages for immediate context
    const recentEvents = recentMessages
        .map(m => `${m.characterName}: ${m.content}`)
        .join('\n');

    let combatContext = '';

    // V2 Combat Engine takes priority if active
    if (v2BattleState && v2BattleState.phase === 'ACTIVE') {
        const currentEntity = v2BattleState.entities[v2BattleState.turnIndex];
        const sortedEntities = [...v2BattleState.entities].sort((a, b) => b.initiative - a.initiative);

        combatContext = `\n[COMBAT ENGINE V2 - ACTIVE]\n`;
        combatContext += `Round: ${v2BattleState.round}\n`;
        combatContext += `Current Turn: ${currentEntity?.name || 'Unknown'} (Initiative: ${currentEntity?.initiative || 0})\n\n`;
        combatContext += `Initiative Order:\n`;
        sortedEntities.forEach((e: CombatEntity, idx: number) => {
            const isCurrent = e.id === currentEntity?.id;
            const status = e.status === 'ALIVE' ? '' : ` [${e.status}]`;
            combatContext += `${idx + 1}. ${e.name} (${e.type}) - Init: ${e.initiative}, HP: ${e.hp}/${e.maxHp}, AC: ${e.baseAC}${status}${isCurrent ? ' ← CURRENT TURN' : ''}\n`;
        });

        combatContext += `\n**IMPORTANT:** Combat is being managed by the V2 engine. Initiative has already been rolled.\n`;
        combatContext += `Do NOT ask the player to roll initiative. Simply narrate based on the current turn.\n`;
    } else if (combatState && combatState.inCombat === 1) {
        // Fallback to V1 combat state
        const currentCombatant = combatants[combatState.currentTurnIndex];

        combatContext = `\n[GAME STATE - STRICT]
The following JSON defines the EXACT state of the game. You MUST use these exact names and stats. Do not invent new enemies or rename existing ones.

${JSON.stringify({
            round: combatState.currentRound,
            currentTurn: {
                name: currentCombatant?.name || 'Unknown',
                initiative: currentCombatant?.initiative || 0
            },
            combatants: combatants.map(c => ({
                name: c.name,
                type: c.type,
                initiative: c.initiative,
                hp: `${c.hpCurrent}/${c.hpMax}`,
                ac: c.ac,
                status: c.hpCurrent <= 0 ? 'DEFEATED' : 'ACTIVE',
                isCurrentTurn: c.id === currentCombatant?.id
            }))
        }, null, 2)}

**Combat Instructions:**
1. Use the EXACT "name" from the JSON above.
2. Track HP changes based on the "hp" field.
3. If status is "DEFEATED", that enemy is dead/unconscious.
4. Narrate the action for "currentTurn".
`;
    }

    return `[CAMPAIGN CONTEXT]
**Known NPCs:**
${npcsText}

**Visited Locations:**
${locationsText}

**Active Plot Points:**
${plotPointsText}

**Notable Items:**
${itemsText}

**Active Quests:**
${questsText}

[RECENT EVENTS - Last 10 Messages]
${recentEvents}
${combatContext}
[ACTIVE CHARACTER]
Name: ${character.name}
Class: ${character.className} Level ${character.level}
HP: ${character.hpCurrent}/${character.hpMax}
AC: ${character.ac}
Stats: STR ${stats.str}, DEX ${stats.dex}, CON ${stats.con}, INT ${stats.int}, WIS ${stats.wis}, CHA ${stats.cha}
Inventory: ${inventory.join(', ') || 'Empty'}
Notes: ${character.notes || 'None'}

[CURRENT ACTION]
${character.name}: ${userMessage}

Respond as the Dungeon Master. Maintain consistency with established NPCs, locations, and plot points. If combat occurs, clearly state damage dealt and HP changes.`;
}

/**
 * Build the summary prompt
 */
export function buildSummaryPrompt(currentSummary: string, messageHistory: string): string {
    return `Previous summary: ${currentSummary}

Recent messages:
${messageHistory}

Create a concise summary (max 500 words) that captures:
1. Current location and situation
2. Active quest/objective
3. Important NPCs met
4. Key items acquired or lost
5. Unresolved plot threads

Focus on information needed for narrative continuity.`;
}

/**
 * Build the enemy generation system prompt
 */
export function buildEnemyGenerationSystemPrompt(): string {
    return `You are creating a D&D 5e combat encounter.`;
}

/**
 * Build the enemy generation user prompt
 */
export function buildEnemyGenerationUserPrompt(
    characters: Character[],
    avgLevel: number,
    narrativeContext: string
): string {
    return `PARTY INFORMATION:
${characters.map(c => `- ${c.name} (${c.className} Level ${c.level}, AC ${c.ac}, HP ${c.hpCurrent}/${c.hpMax})`).join('\n')}
Average Party Level: ${avgLevel}

RECENT NARRATIVE CONTEXT:
${narrativeContext}

Generate 1-4 appropriate enemies for this encounter. The enemies should:
1. Fit the narrative context
2. Be challenging but fair for a level ${avgLevel} party
3. Have proper D&D 5e stats

Return ONLY a JSON array with this EXACT structure:
[
  {
    "name": "Enemy name (e.g., 'Goblin Archer 1')",
    "ac": armor_class_number,
    "hpMax": hit_points_number,
    "attackBonus": attack_bonus_number,
    "damageFormula": "dice_formula (e.g., '1d6+2')",
    "damageType": "damage type (e.g., 'slashing', 'piercing')"
  }
]

CRITICAL: Return ONLY the JSON array. No markdown, no explanation.`;
}

// =============================================================================
// COMBAT ENGINE V2 PROMPT GETTERS
// =============================================================================

/**
 * Get the enemy AI system prompt
 * Used by enemy-ai-controller.ts
 * @param settings User settings (uses combatTurnPrompt field)
 */
export function getEnemyAIPrompt(settings?: UserSettings | null): string {
    return settings?.combatTurnPrompt || DEFAULT_ENEMY_AI_PROMPT;
}

/**
 * Get the combat narrative system prompt
 * Used by combat-narrator.ts
 * @param settings User settings (uses combatNarrationPrompt field)
 */
export function getCombatNarrativePrompt(settings?: UserSettings | null): string {
    return settings?.combatNarrationPrompt || DEFAULT_COMBAT_NARRATIVE_PROMPT;
}

/**
 * Get the action parser system prompt
 * Used by player-action-parser.ts
 * @param settings User settings (uses combatSummaryPrompt field, repurposed for V2)
 */
export function getActionParserPrompt(settings?: UserSettings | null): string {
    return settings?.combatSummaryPrompt || DEFAULT_ACTION_PARSER_PROMPT;
}
