/**
 * System Prompts Module
 * Centralizes all system prompts used across the application.
 * Pulls from user settings where applicable, falling back to defaults.
 */

import type { UserSettings, Character, Session, CombatState, Combatant, Message } from "../drizzle/schema";
import { RangeBand, type BattleState, type CombatEntity } from "./combat/combat-types";
import type { ExtractedContext } from "./context-extraction";
import type { Tool } from "./_core/llm";
import type { ActorSheet } from "./kernel/actor-sheet";
import type { ActorState } from "./kernel/actor-state";

// =============================================================================
// SRD TOOL DEFINITIONS (OpenAI function-calling format)
// =============================================================================

export const SRD_TOOLS: Tool[] = [
  {
    type: "function",
    function: {
      name: "lookup_spell",
      description: "Look up a D&D 5e spell by name. Returns level, school, damage, range, components, duration, and description.",
      parameters: {
        type: "object",
        properties: { name: { type: "string", description: "The spell name to look up" } },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "lookup_monster",
      description: "Look up a monster or creature. Returns AC, HP, stats, attacks, abilities, and CR.",
      parameters: {
        type: "object",
        properties: { name: { type: "string", description: "The monster name" } },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "lookup_equipment",
      description: "Look up a weapon, armor, or piece of equipment. Returns stats, damage, properties, cost.",
      parameters: {
        type: "object",
        properties: { name: { type: "string", description: "The item name" } },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_srd",
      description: "Search the D&D 5e SRD rules database. Use for general queries like 'all 3rd level wizard spells' or 'CR 5 monsters'.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query" },
          category: { type: "string", enum: ["spells", "monsters", "equipment", "classes", "races"] },
        },
        required: ["query"],
      },
    },
  },
];

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

**COMBAT INITIATION (CRITICAL — ENGINE HANDOFF):**
When combat BEGINS (the moment violence erupts), a separate Combat Engine takes control of ALL mechanics.
Your role at this moment is SCENE SETTER, not RESOLVER:
- Describe the atmosphere: sounds, smells, the chaos of weapons being drawn
- Show enemies readying themselves: weapons raised, spells charging, formations shifting
- Convey the stakes: what happens if the player loses, what they are fighting for
- End on a beat of tension — the held breath before the storm
- Do NOT describe any attack connecting, any damage being dealt, or any dice being rolled
- Do NOT list initiative order, HP values, AC values, or dice formulas
- Do NOT ask the player to roll for initiative — the Combat Engine handles this
The Combat Engine will manage initiative, turn order, attacks, damage, and death from this point forward.
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
- Standard actions: DODGE ("I dodge", "I go defensive"), DASH ("I sprint"), DISENGAGE ("I back away"), HELP ("I help Thorin"), HIDE ("I sneak"), USE_ITEM ("I drink a potion")
- Passing turn: "I'm done", "I wait", "I hold my action", "I end my turn", "no", "nah", "that's it", "move on", "I'm good", "next"
- Questions and queries: QUERY — "what can I do?", "what are my options?", "how does dodge work?", "can I attack twice?", any question about rules, abilities, or combat state
- If only one enemy exists and player attacks, assume that target

**OUTPUT (JSON ONLY):**
{"actionType": "ATTACK", "targetName": "Goblin", "confidence": 0.9}
{"actionType": "DODGE", "confidence": 0.95}
{"actionType": "QUERY", "confidence": 0.9}
{"actionType": "END_TURN", "confidence": 0.95}
{"actionType": "UNKNOWN", "confidence": 0.3}`;


// Structured Output Wrapper for automatic combat detection
const STRUCTURED_OUTPUT_WRAPPER = `
⚠️ MANDATORY OUTPUT FORMAT — You MUST return raw JSON (no markdown, no plain text):
{"narrative": "Your full DM response here", "gameStateChanges": {...}}

MECHANICAL BOUNDARY:
- NEVER invent damage numbers, HP changes, dice rolls, or saving throws — only use numbers the combat engine provides.
- NEVER deduct spell slots, modify HP, or change conditions in narrative text. The engine handles ALL mechanical state.

COMBAT INITIATION — set "combatInitiated": true when violence begins or the player attacks:
{"narrative": "Scene-setting ONLY — tension, stakes, the moment BEFORE impact. No dice, no damage, no initiative order, no resolved actions.",
 "gameStateChanges": {"combatInitiated": true, "enemies": [{"name": "...", "ac": 13, "hpMax": 20, "attackBonus": 4, "damageFormula": "1d8+2", "damageType": "slashing", "initiative": 15}]}}
A separate COMBAT ENGINE takes over ALL mechanics after your scene-setting.

COMBAT END — when enemies are defeated/fled/surrendered:
{"narrative": "Victory narrative...", "gameStateChanges": {"combatEnded": true}}

SKILL CHECKS — when the fiction calls for uncertainty outside combat, request ONE check:
{"narrative": "Narrative...", "gameStateChanges": {"skillCheck": {"skill": "perception", "dc": 14, "reason": "spotting the hidden compartment"}}}
You may use "ability" (e.g. "str") instead of "skill". Only request checks when the outcome is uncertain and meaningful.

NORMAL RESPONSES (exploration, dialogue):
{"narrative": "Your response text here..."}`;

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
4. **Personality**: Create a brief but engaging personality description

Note: Equipment, proficiencies, spells, and features are handled automatically from SRD data — you only need to provide the stats and narrative details below.

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

function describeRangeBand(range?: RangeBand): string {
    switch (range) {
        case RangeBand.MELEE:
            return "melee (5 ft)";
        case RangeBand.NEAR:
            return "near (30 ft)";
        case RangeBand.FAR:
            return "far (60+ ft)";
        default:
            return "unknown range";
    }
}

function getBattleEntityById(state: BattleState, entityId?: string): CombatEntity | undefined {
    if (!entityId) return undefined;
    return state.entities.find(entity => entity.id === entityId);
}

function getOrderedBattleEntities(state: BattleState): CombatEntity[] {
    const ordered = state.turnOrder
        .map(entityId => getBattleEntityById(state, entityId))
        .filter((entity): entity is CombatEntity => !!entity);

    if (ordered.length === state.entities.length) {
        return ordered;
    }

    const seen = new Set(ordered.map(entity => entity.id));
    return [
        ...ordered,
        ...state.entities.filter(entity => !seen.has(entity.id)),
    ];
}

function findBattleEntityForCharacter(state: BattleState, character: Character): CombatEntity | undefined {
    return state.entities.find(entity => entity.dbCharacterId === character.id)
        ?? state.entities.find(entity =>
            entity.type === "player" && entity.name.toLowerCase() === character.name.toLowerCase()
        );
}

export function buildBattlefieldSnapshot(
    state: BattleState,
    focusEntityId?: string
): string {
    const currentTurnEntity = getBattleEntityById(state, state.turnOrder[state.turnIndex]);
    const orderedEntities = getOrderedBattleEntities(state);
    let snapshot = `Round: ${state.round}\n`;
    snapshot += `Current Turn: ${currentTurnEntity?.name || "Unknown"} (Initiative: ${currentTurnEntity?.initiative || 0})\n\n`;
    snapshot += `Initiative Order:\n`;

    orderedEntities.forEach((entity, idx) => {
        const isCurrent = entity.id === currentTurnEntity?.id;
        const status = entity.status === "ALIVE" ? "" : ` [${entity.status}]`;
        const charClass = entity.characterClass ? ` [${entity.characterClass}]` : '';
        const weapons = entity.weapons?.length ? ` | weapons: ${entity.weapons.map((w: any) => {
            const parts = [w.damageFormula, w.damageType];
            if (w.isRanged) parts.push('ranged');
            return `${w.name} (${parts.join(', ')})`;
        }).join('; ')}` : '';
        const spells = entity.spells?.length ? ` | spells: ${entity.spells.map((s: any) => s.name).join(', ')}` : '';
        snapshot += `${idx + 1}. ${entity.name} (${entity.type})${charClass} - Init: ${entity.initiative}, HP: ${entity.hp}/${entity.maxHp}, AC: ${entity.baseAC}${status}${weapons}${spells}${isCurrent ? " <- CURRENT TURN" : ""}\n`;
    });

    const focusEntity = getBattleEntityById(state, focusEntityId);
    if (focusEntity) {
        const otherEntities = state.entities.filter(entity => entity.id !== focusEntity.id && entity.status === "ALIVE");
        snapshot += `\nRelative Positioning for ${focusEntity.name}:\n`;

        if (otherEntities.length === 0) {
            snapshot += `- No other active combatants.\n`;
        } else {
            otherEntities.forEach(entity => {
                const range = focusEntity.rangeTo?.[entity.id] ?? entity.rangeTo?.[focusEntity.id];
                snapshot += `- ${entity.name} (${entity.type}): ${describeRangeBand(range)}\n`;
            });
        }
    }

    return snapshot.trimEnd();
}

export function buildCombatQueryPrompt(params: {
    battleState: BattleState;
    focusEntityId?: string;
    characterSheetText: string;
    resourceStatus: string;
    actionList: string;
    question: string;
}): string {
    const { battleState, focusEntityId, characterSheetText, resourceStatus, actionList, question } = params;

    return `You are a D&D 5e Dungeon Master helping a player understand their combat state and options.

The combat engine is using theater-of-mind range bands instead of a tactical grid.
The battlefield snapshot below is authoritative. Do NOT say you need a tactical map or enemy positions.

PLAYER CHARACTER:
${characterSheetText}
TURN RESOURCES: ${resourceStatus}

BATTLEFIELD SNAPSHOT:
${buildBattlefieldSnapshot(battleState, focusEntityId)}

AVAILABLE ACTIONS:
${actionList}

PLAYER'S QUESTION: "${question}"

Answer the question directly.
- If they ask where they are, summarize who is in melee, near, and far relative to them.
- If they ask how far enemies are, use the exact range bands above.
- If they ask what they can do, use AVAILABLE ACTIONS and their character sheet above.
- If they ask about special attacks or abilities, check their class features and spells.
Keep it concise, helpful, and in character as the DM.`;
}

/**
 * Produce a single canonical text block describing the full character.
 * Merges DB columns, actorSheet, and actorState into one representation.
 * Every prompt path should use this instead of ad-hoc field extraction.
 *
 * Covers:
 *   Identity   — name, class, subclass, level, ancestry, background, feats
 *   Combat     — HP (current/max/temp), AC (with source), ability scores + mods,
 *                proficiency bonus, passive Perception, weapons (damage/type/ranged)
 *   Resources  — spell slots (current/max), feature uses (remaining/max/recharge),
 *                hit dice (remaining/die size), gold
 *   Casting    — save DC, attack bonus, cantrips, prepared spells
 *   Traits     — speeds, senses, proficiencies (saves/skills/weapons/armor/tools)
 *   Status     — conditions, concentration, exhaustion
 *   Gear       — equipment list (from actorSheet) or inventory (legacy DB column)
 *   Features   — class features with descriptions (truncated to 100 chars)
 *   Notes      — freeform character notes
 */
export function formatCharacterSheet(character: Character): string {
    // --- DB columns (always available) ---
    let stats: Record<string, number> = {};
    try { stats = JSON.parse(character.stats); } catch { /* empty */ }
    let inventory: string[] = [];
    try { inventory = JSON.parse(character.inventory); } catch { /* empty */ }

    const mod = (v: number) => {
        const m = Math.floor((v - 10) / 2);
        return m >= 0 ? `+${m}` : `${m}`;
    };

    const lines: string[] = [];
    lines.push(`Name: ${character.name}`);
    lines.push(`Class: ${character.className} Level ${character.level}`);

    // --- actorSheet (rich data) ---
    let sheet: ActorSheet | null = null;
    if (character.actorSheet) {
        try { sheet = JSON.parse(character.actorSheet); } catch (e) { console.warn('[formatCharacterSheet] Failed to parse actorSheet:', e); }
    }

    // --- actorState (runtime data) ---
    let state: ActorState | null = null;
    if (character.actorState) {
        try { state = JSON.parse(character.actorState); } catch (e) { console.warn('[formatCharacterSheet] Failed to parse actorState:', e); }
    }

    // Ancestry / subclass / background (from sheet)
    if (sheet) {
        lines.push(`Ancestry: ${sheet.ancestry}`);
        if (sheet.subclass) lines.push(`Subclass: ${sheet.subclass}`);
        if (sheet.background) lines.push(`Background: ${sheet.background}`);
        if (sheet.feats.length > 0) lines.push(`Feats: ${sheet.feats.join(', ')}`);
    }

    // HP — prefer actorState, fall back to DB
    const hpCurrent = state?.hpCurrent ?? character.hpCurrent;
    const hpMax = state?.hpMax ?? character.hpMax;
    let hpLine = `HP: ${hpCurrent}/${hpMax}`;
    if (state?.tempHp) hpLine += ` (+${state.tempHp} temp)`;
    lines.push(hpLine);

    // AC — prefer sheet (has source), fall back to DB
    if (sheet) {
        lines.push(`AC: ${sheet.ac.base} (${sheet.ac.source})`);
    } else {
        lines.push(`AC: ${character.ac}`);
    }

    // Ability scores — prefer sheet, fall back to DB
    const scores = sheet?.abilityScores ?? stats;
    if (scores && Object.keys(scores).length > 0) {
        lines.push(`Stats: STR ${scores.str}(${mod(scores.str)}) DEX ${scores.dex}(${mod(scores.dex)}) CON ${scores.con}(${mod(scores.con)}) INT ${scores.int}(${mod(scores.int)}) WIS ${scores.wis}(${mod(scores.wis)}) CHA ${scores.cha}(${mod(scores.cha)})`);
    }

    // Proficiency bonus — from sheet, or derived from level
    const profBonus = sheet?.proficiencyBonus ?? Math.floor((character.level - 1) / 4) + 2;
    lines.push(`Proficiency Bonus: +${profBonus}`);

    // Passive Perception — 10 + WIS mod + proficiency if Perception is a proficient skill
    const wisScore = (sheet?.abilityScores ?? stats)?.wis ?? 10;
    const wisMod = Math.floor((wisScore - 10) / 2);
    const hasPerceptionProf = sheet?.proficiencies?.skills?.some(
        s => s.toLowerCase() === 'perception'
    ) ?? false;
    const passivePerception = 10 + wisMod + (hasPerceptionProf ? profBonus : 0);
    lines.push(`Passive Perception: ${passivePerception}`);

    // Speeds
    if (sheet?.speeds) {
        const parts: string[] = [`Walk ${sheet.speeds.walk} ft`];
        if (sheet.speeds.fly) parts.push(`Fly ${sheet.speeds.fly} ft`);
        if (sheet.speeds.swim) parts.push(`Swim ${sheet.speeds.swim} ft`);
        if (sheet.speeds.climb) parts.push(`Climb ${sheet.speeds.climb} ft`);
        if (sheet.speeds.burrow) parts.push(`Burrow ${sheet.speeds.burrow} ft`);
        lines.push(`Speed: ${parts.join(', ')}`);
    }

    // Senses
    if (sheet?.senses) {
        const parts: string[] = [];
        if (sheet.senses.darkvision) parts.push(`Darkvision ${sheet.senses.darkvision} ft`);
        if (sheet.senses.blindsight) parts.push(`Blindsight ${sheet.senses.blindsight} ft`);
        if (sheet.senses.tremorsense) parts.push(`Tremorsense ${sheet.senses.tremorsense} ft`);
        if (sheet.senses.truesight) parts.push(`Truesight ${sheet.senses.truesight} ft`);
        if (parts.length > 0) lines.push(`Senses: ${parts.join(', ')}`);
    }

    // Proficiencies
    if (sheet?.proficiencies) {
        const p = sheet.proficiencies;
        const parts: string[] = [];
        if (p.saves.length) parts.push(`Saves: ${p.saves.join(', ')}`);
        if (p.skills.length) parts.push(`Skills: ${p.skills.join(', ')}`);
        if (p.weapons.length) parts.push(`Weapons: ${p.weapons.join(', ')}`);
        if (p.armor.length) parts.push(`Armor: ${p.armor.join(', ')}`);
        if (p.tools.length) parts.push(`Tools: ${p.tools.join(', ')}`);
        if (parts.length > 0) lines.push(`Proficiencies: ${parts.join(' | ')}`);
    }

    // Equipment / Inventory — prefer actorSheet.equipment, fall back to DB inventory
    if (sheet?.equipment && sheet.equipment.length > 0) {
        const weapons = sheet.equipment.filter(e => e.type === 'weapon');
        const nonWeapons = sheet.equipment.filter(e => e.type !== 'weapon');
        if (weapons.length > 0) {
            lines.push(`Weapons: ${weapons.map(w => {
                const dmg = (w.properties as any)?.damage || '';
                const dmgType = (w.properties as any)?.damageType || '';
                const ranged = (w.properties as any)?.ranged ? ', ranged' : '';
                return dmgType ? `${w.name} (${dmg} ${dmgType}${ranged})` : w.name;
            }).join(', ')}`);
        }
        if (nonWeapons.length > 0) {
            lines.push(`Equipment: ${nonWeapons.map(e => e.name).join(', ')}`);
        }
    } else if (inventory.length > 0) {
        lines.push(`Inventory: ${inventory.join(', ')}`);
    }

    // Spellcasting (from sheet)
    if (sheet?.spellcasting) {
        const sc = sheet.spellcasting;
        lines.push(`Spell Save DC: ${sc.saveDC}, Attack Bonus: +${sc.attackBonus}`);
        if (sc.cantripsKnown.length > 0) lines.push(`Cantrips: ${sc.cantripsKnown.join(', ')}`);
        if (sc.spellsKnown.length > 0) lines.push(`Spells Prepared: ${sc.spellsKnown.join(', ')}`);
    }

    // Spell slots — prefer actorState (current) vs sheet (max)
    if (state && Object.keys(state.spellSlotsCurrent).length > 0) {
        const maxSlots = sheet?.spellcasting?.spellSlots ?? {};
        const slotParts = Object.entries(state.spellSlotsCurrent)
            .filter(([level, v]) => v > 0 || (maxSlots as any)[level] > 0)
            .map(([level, current]) => `L${level}: ${current}/${(maxSlots as any)[level] ?? '?'}`);
        if (slotParts.length > 0) lines.push(`Spell Slots: ${slotParts.join(', ')}`);
    }

    // Hit dice — remaining from actorState, die size from sheet
    if (sheet) {
        const hdRemaining = state?.hitDiceCurrent ?? sheet.level;
        lines.push(`Hit Dice: ${hdRemaining}/${sheet.level} (${sheet.hitDie})`);
    }

    // Gold
    if (state && state.gold > 0) {
        lines.push(`Gold: ${state.gold}`);
    }

    // Class features (from sheet + uses from actorState)
    if (sheet?.features && sheet.features.length > 0) {
        const featureParts = sheet.features.map(f => {
            let entry = f.name;
            if (f.usesMax != null) {
                const remaining = state?.featureUses?.[f.name] ?? f.usesMax;
                entry += ` (${remaining}/${f.usesMax}, ${f.rechargeOn ?? 'rest'})`;
            }
            if (f.description) entry += ` — ${f.description.substring(0, 100)}`;
            return entry;
        });
        lines.push(`Class Features: ${featureParts.join('; ')}`);
    }

    // Conditions & concentration (from actorState)
    if (state) {
        if (state.conditions.length > 0) {
            lines.push(`Conditions: ${state.conditions.map((c: any) => c.name ?? c).join(', ')}`);
        }
        if (state.concentration) {
            lines.push(`Concentrating on: ${state.concentration.spellName}`);
        }
        if (state.exhaustion > 0) {
            lines.push(`Exhaustion: ${state.exhaustion}`);
        }
    }

    // Notes
    if (character.notes) lines.push(`Notes: ${character.notes}`);

    return lines.join('\n');
}

/**
 * Extract the list of skill proficiency names from a character's actorSheet.
 * Normalizes to lowercase snake_case to match SkillName conventions (e.g. "Sleight of Hand" → "sleight_of_hand").
 * Returns an empty array if the sheet is missing or malformed.
 */
export function getSkillProficiencies(character: Character): string[] {
    if (!character.actorSheet) return [];
    try {
        const sheet: ActorSheet = JSON.parse(character.actorSheet);
        return (sheet.proficiencies?.skills ?? []).map(
            s => s.toLowerCase().replace(/[\s-]+/g, '_')
        );
    } catch (e) {
        console.warn('[getSkillProficiencies] Failed to parse actorSheet:', e);
        return [];
    }
}

/**
 * Build the chat user prompt with full context.
 * Character data comes FIRST so the DM always sees who it's talking to.
 * Session summary provides continuity across the context window.
 */
export function buildChatUserPrompt(
    character: Character,
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
        const focusEntity = findBattleEntityForCharacter(v2BattleState, character);
        combatContext = `\n[COMBAT ENGINE V2 - ACTIVE]\n`;
        combatContext += `${buildBattlefieldSnapshot(v2BattleState, focusEntity?.id)}\n`;
        combatContext += `\n**IMPORTANT:** Combat is being managed by the V2 engine. Initiative has already been rolled.\n`;
        combatContext += `Range bands are the authoritative battlefield positions. Do NOT claim you need a tactical map to answer distance questions.\n`;
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

    return `[ACTIVE CHARACTER]
${formatCharacterSheet(character)}

[SESSION SUMMARY]
${session.currentSummary || 'Session just started.'}

[CAMPAIGN CONTEXT]
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
[CURRENT ACTION]
${character.name}: ${userMessage}

Respond as the Dungeon Master. Maintain consistency with established NPCs, locations, and plot points.`;
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
