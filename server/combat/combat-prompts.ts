/**
 * Combat Prompt Builder
 * Constructs prompts for LLM to narrate combat in Chaos Weaver style
 */

import type { CombatantData, CombatStateData, AttackResult } from './combat-engine';

export class CombatPromptBuilder {
    /**
     * Build prompt for DM to describe current combatant's turn
     */
    static buildTurnPrompt(
        combatState: CombatStateData,
        currentActor: CombatantData
    ): string {
        const enemies = combatState.combatants.filter(c => c.type === 'enemy');
        const players = combatState.combatants.filter(c => c.type === 'player');

        let prompt = `[COMBAT MODE - ROUND ${combatState.round}]\n\n`;
        prompt += `Current Turn: ${currentActor.name} (${currentActor.type})\n\n`;

        // Provide tactical context
        prompt += `COMBATANT STATUS:\n`;

        prompt += `Players:\n`;
        players.forEach(p => {
            prompt += `- ${p.name}: HP ${p.hpCurrent}/${p.hpMax}, AC ${p.ac}${p.position ? `, ${p.position}` : ''}\n`;
        });

        prompt += `\nEnemies:\n`;
        enemies.forEach(e => {
            prompt += `- ${e.name}: HP ${e.hpCurrent}/${e.hpMax}, AC ${e.ac}${e.position ? `, ${e.position}` : ''}\n`;
        });

        // Instructions for DM
        prompt += `\n---\n\n`;

        if (currentActor.type === 'player') {
            prompt += `Prompt ${currentActor.name} for their action using Chaos Weaver style.\n`;
            prompt += `Format: "${currentActor.name}, your turn. [Brief tactical situation]. What do you do?"\n`;
            prompt += `Include relevant enemy positions, threats, and opportunities in your description.`;
        } else {
            prompt += `This is an enemy turn. Describe what the enemy does narratively, but do NOT decide the mechanical outcome.\n`;
            prompt += `The system will determine hit/miss and damage.\n`;
            prompt += `Simply narrate the enemy's action (e.g., "The goblin snarls and lunges at Alice with its rusty blade...").`;
        }

        return prompt;
    }

    /**
     * Build prompt for narrating attack result
     */
    static buildNarrationPrompt(
        actorName: string,
        targetName: string,
        result: AttackResult,
        weaponDescription?: string
    ): string {
        let prompt = `Narrate this combat action in Chaos Weaver style:\n\n`;
        prompt += `Actor: ${actorName}\n`;
        prompt += `Target: ${targetName}\n`;
        prompt += `Attack Roll: ${result.attackRoll} vs AC ${result.targetAC}\n`;

        if (result.isCritical) {
            prompt += `CRITICAL HIT!\n`;
        }

        if (result.isHit) {
            prompt += `Result: HIT\n`;
            if (result.damage !== undefined) {
                prompt += `Damage: ${result.damage}\n`;
                prompt += `Target HP: ${result.targetNewHP}/${result.targetMaxHP}\n`;
            }

            if (result.isDead) {
                prompt += `TARGET KILLED (KILLING BLOW)\n\n`;
                prompt += `Generate a DRAMATIC, CINEMATIC death description:\n`;
                prompt += `- Use vivid, specific sensory details\n`;
                prompt += `- This is a finisher move - make it memorable\n`;
                prompt += `- Include the exact damage amount\n`;
                prompt += `- Use Chaos Weaver techniques (unexpected details, specific imagery)\n`;
                prompt += `Example style: "Your blade catches the goblin mid-snarl. The steel passes through its neck. Clean. The head tilts. Rolls. The body follows three heartbeats later. Black blood pools in the shape of a crescent moon."\n`;
            } else {
                // Regular hit
                const bloodied = result.targetNewHP! <= (result.targetMaxHP! / 2);
                prompt += `\nGenerate a CONCISE but vivid hit description:\n`;
                prompt += `- One or two sentences maximum (keep combat moving)\n`;
                prompt += `- Include: physical action, sensory detail, result\n`;
                prompt += `- Mention the damage amount: "${result.damage}${weaponDescription ? ` ${weaponDescription}` : ''} damage"\n`;
                prompt += `- State remaining HP: "HP: ${result.targetNewHP}/${result.targetMaxHP}"\n`;
                if (bloodied) {
                    prompt += `- Target is bloodied (below half HP) - describe their wounded state\n`;
                }
                prompt += `Example: "Your sword bites into the orc's shoulder. Blood—bright red. The orc grunts. ${result.damage} slashing damage. HP: ${result.targetNewHP}/${result.targetMaxHP}."\n`;
            }
        } else {
            prompt += `Result: MISS\n\n`;
            prompt += `Generate a BRIEF miss description:\n`;
            prompt += `- One sentence\n`;
            prompt += `- Show what physically happened (dodge, deflection, near-miss)\n`;
            prompt += `- Keep combat pacing fast\n`;
            prompt += `Example: "The arrow whistles past Alice's ear. Close enough to hear the fletching."\n`;
        }

        return prompt;
    }

    /**
     * Build prompt for enemy AI decision-making
     */
    static buildEnemyDecisionPrompt(
        enemy: CombatantData,
        combatState: CombatStateData
    ): string {
        const players = combatState.combatants.filter(c => c.type === 'player');
        const otherEnemies = combatState.combatants.filter(
            c => c.type === 'enemy' && c.name !== enemy.name
        );

        let prompt = `You are controlling: ${enemy.name}\n\n`;
        prompt += `Your stats:\n`;
        prompt += `- HP: ${enemy.hpCurrent}/${enemy.hpMax}\n`;
        prompt += `- AC: ${enemy.ac}\n`;
        prompt += `- Attack: +${enemy.attackBonus} to hit\n`;
        prompt += `- Damage: ${enemy.damageFormula} ${enemy.damageType}\n`;
        if (enemy.specialAbilities && enemy.specialAbilities.length > 0) {
            prompt += `- Abilities: ${enemy.specialAbilities.join(', ')}\n`;
        }

        prompt += `\nAllies:\n`;
        if (otherEnemies.length > 0) {
            otherEnemies.forEach(e => {
                prompt += `- ${e.name}: HP ${e.hpCurrent}/${e.hpMax}\n`;
            });
        } else {
            prompt += `- None (you are alone)\n`;
        }

        prompt += `\nEnemies (player characters):\n`;
        players.forEach(p => {
            prompt += `- ${p.name}: HP ${p.hpCurrent}/${p.hpMax}, AC ${p.ac}${p.position ? `, ${p.position}` : ''}\n`;
        });

        prompt += `\n---\n\n`;
        prompt += `Decide your action. For Phase 1, only basic attacks are supported.\n\n`;
        prompt += `Return your decision in this format:\n`;
        prompt += `ACTION: attack\n`;
        prompt += `TARGET: [character name]\n`;
        prompt += `REASONING: [brief tactical explanation from enemy's perspective]\n\n`;
        prompt += `Example:\n`;
        prompt += `ACTION: attack\n`;
        prompt += `TARGET: Alice\n`;
        prompt += `REASONING: The warrior who just killed my companion. Revenge.`;

        return prompt;
    }

    /**
     * Build combat summary prompt
     */
    static buildCombatSummary(
        combatState: CombatStateData,
        victor: 'players' | 'enemies'
    ): string {
        const duration = combatState.round;
        const survivors = combatState.combatants;

        let prompt = `Combat has ended. ${victor === 'players' ? 'The party is victorious!' : 'The enemies have won.'}\n\n`;
        prompt += `Duration: ${duration} round${duration !== 1 ? 's' : ''}\n`;

        if (victor === 'players') {
            prompt += `\nSurviving party members:\n`;
            survivors.forEach(s => {
                prompt += `- ${s.name}: HP ${s.hpCurrent}/${s.hpMax}\n`;
            });
        }

        prompt += `\n---\n\n`;
        prompt += `Generate a brief Chaos Weaver-style conclusion to the combat.\n`;
        prompt += `- 2-3 sentences\n`;
        prompt += `- Describe the aftermath (silence, smoke, bodies, etc.)\n`;
        prompt += `- Include one impossible or unsettling detail if appropriate\n`;
        prompt += `- End with an open question: "What do you do?"\n\n`;
        prompt += `Example: "Silence returns to the forest path. Three bodies. Smoke rising from two. The smell of burnt hair and copper. Somewhere, a crow calls. Once. What do you do?"`;

        return prompt;
    }

    /**
     * Build the combat mode system prompt extension
     * This gets appended to the base Chaos Weaver prompt when in combat
     */
    static buildCombatModeExtension(): string {
        return `

## [COMBAT MODE ACTIVE]

When in combat, ADDITIONALLY apply these rules:

**TURN MANAGEMENT:**
- Always explicitly prompt the current character: "[Name], your turn. [Brief situation]. What do you do?"
- Provide tactical context: enemy positions, distances, conditions
- After describing action results, transition to next actor

**MECHANICAL PRECISION:**
- You will receive mechanical outcomes from the system (hit/miss, damage, HP changes)
- Your role is ONLY to narrate these predetermined outcomes
- NEVER decide damage amounts or hit/miss - only describe them cinematically
- Track initiative order explicitly

**COMBAT NARRATION STYLE:**
You MUST balance CHAOS WEAVER style with combat pacing:

**Regular hits/misses (concise):**
Good: "Your sword opens the orc's shoulder. Black blood—too thick. 7 slashing damage. HP: 8/15."
Bad: "The sword seems to maybe hit for some damage."

**Killing blows (dramatic):**
Good: "Your blade catches the goblin mid-snarl. The steel passes through its neck. Clean. The head tilts. Rolls. The body follows three heartbeats later. Black blood pools in the shape of a crescent moon."

**CHAOS IN COMBAT:**
- Use chaos elements SPARINGLY in combat to maintain pace
- Impossible details work: "The arrow embeds in the wall. The wall bleeds."
- Don't break mechanical accuracy for chaos effects
- Save major chaos for dramatic moments`;
    }
}
