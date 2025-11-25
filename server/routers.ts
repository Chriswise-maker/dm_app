import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { z } from "zod";

export const appRouter = router({
  // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),

  // D&D Game routers
  sessions: router({
    create: protectedProcedure
      .input(z.object({
        campaignName: z.string().min(1),
        narrativePrompt: z.string().optional()
      }))
      .mutation(async ({ ctx, input }) => {
        const db = await import('./db');
        return db.createSession(ctx.user.id, input.campaignName, input.narrativePrompt);
      }),

    list: protectedProcedure.query(async ({ ctx }) => {
      const db = await import('./db');
      return db.getUserSessions(ctx.user.id);
    }),

    get: protectedProcedure
      .input(z.object({ sessionId: z.number() }))
      .query(async ({ input }) => {
        const db = await import('./db');
        return db.getSession(input.sessionId);
      }),

    delete: protectedProcedure
      .input(z.object({ sessionId: z.number() }))
      .mutation(async ({ input }) => {
        const db = await import('./db');
        await db.deleteSession(input.sessionId);
        return { success: true };
      }),

    generate: protectedProcedure
      .input(z.object({
        prompt: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { invokeLLMWithSettings } = await import('./llm-with-settings');
        const db = await import('./db');

        // 1. Get user settings
        const userSettings = await db.getUserSettings(ctx.user.id);

        // Use a dedicated, language-neutral system prompt for campaign generation
        // This ensures the generator focuses on the task (JSON creation) and respects the user's language instructions
        // without being influenced by the "DM Persona" (which might be English-biased).
        const campaignSystemPrompt = `You are an expert campaign generator.
Generate creative, engaging campaign settings exactly as instructed.
CRITICAL: Respect ALL language requirements. If the user specifies languages, follow them precisely.`;

        // 2. Construct Generation Prompt
        const customGenerationPrompt = userSettings?.campaignGenerationPrompt;

        let generationPrompt;
        if (customGenerationPrompt) {
          generationPrompt = `${customGenerationPrompt}
${input.prompt ? `\nAdditional Request: "${input.prompt}"` : ''}

IMPORTANT: Return ONLY a JSON object. Respect any language instructions above.
{
  "title": "Campaign title (in the requested language if specified)",
  "narrativePrompt": "Detailed world description (in the requested language if specified)",
  "prologue": "Opening DM message (in the requested language if specified)"
}`;
        } else {
          generationPrompt = `Generate a D&D 5e campaign setting.
${input.prompt ? `User Request/Theme: "${input.prompt}"` : 'Theme: Create a random, creative, and engaging setting.'}

Return ONLY a JSON object with this exact structure:
{
  "title": "A short, evocative campaign title",
  "narrativePrompt": "A detailed paragraph describing the world, tone, major factions, and central conflict. This will serve as the 'World Bible' for the AI DM.",
  "prologue": "An immersive opening message from the DM to the player. It should set the scene, establish the atmosphere, and end with a question or prompt that invites the player to introduce their character (e.g., 'Who are you?', 'What brings you to this wretched hive?')."
}`;
        }

        // 3. Call LLM
        const response = await invokeLLMWithSettings(ctx.user.id, {
          messages: [
            { role: 'system', content: campaignSystemPrompt + '\nReturn ONLY raw JSON. No markdown formatting.' },
            { role: 'user', content: generationPrompt },
          ],
        });

        if (!response.choices || !response.choices[0] || !response.choices[0].message) {
          throw new Error('Failed to generate campaign: Invalid LLM response');
        }

        const content = response.choices[0].message.content;
        if (!content || typeof content !== 'string') throw new Error('Failed to generate campaign: Empty or invalid response');

        // Clean up markdown if present
        let jsonContent = content.trim();
        if (jsonContent.startsWith('```')) {
          jsonContent = jsonContent.replace(/^```(?:json)?\s*\n/, '').replace(/\n```\s*$/, '');
        }

        let data;
        try {
          data = JSON.parse(jsonContent);
        } catch (e) {
          console.error('Failed to parse generated campaign JSON:', content);
          throw new Error('Failed to parse generated campaign data');
        }

        // 4. Create Session
        const session = await db.createSession(ctx.user.id, data.title, data.narrativePrompt);

        // 5. Insert Prologue Message
        await db.saveMessage({
          sessionId: session.id,
          characterName: 'DM',
          content: data.prologue,
          isDm: 1,
        });

        return session;
      }),

    updateNarrative: protectedProcedure
      .input(z.object({
        sessionId: z.number(),
        narrativePrompt: z.string(),
      }))
      .mutation(async ({ input }) => {
        const db = await import('./db');
        await db.updateSessionNarrative(input.sessionId, input.narrativePrompt);
        return { success: true };
      }),
  }),

  characters: router({
    create: protectedProcedure
      .input(z.object({
        sessionId: z.number(),
        name: z.string().min(1),
        className: z.string().min(1),
        level: z.number().min(1).default(1),
        hpCurrent: z.number().min(0),
        hpMax: z.number().min(1),
        ac: z.number().min(0),
        stats: z.object({
          str: z.number().min(1).max(30),
          dex: z.number().min(1).max(30),
          con: z.number().min(1).max(30),
          int: z.number().min(1).max(30),
          wis: z.number().min(1).max(30),
          cha: z.number().min(1).max(30),
        }),
        inventory: z.array(z.string()),
        notes: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const db = await import('./db');
        return db.createCharacter({
          ...input,
          stats: JSON.stringify(input.stats),
          inventory: JSON.stringify(input.inventory),
        });
      }),

    list: protectedProcedure
      .input(z.object({ sessionId: z.number() }))
      .query(async ({ input }) => {
        const db = await import('./db');
        const chars = await db.getSessionCharacters(input.sessionId);
        return chars.map(char => ({
          ...char,
          stats: JSON.parse(char.stats),
          inventory: JSON.parse(char.inventory),
        }));
      }),

    updateHP: protectedProcedure
      .input(z.object({
        characterId: z.number(),
        hpCurrent: z.number().min(0),
      }))
      .mutation(async ({ input }) => {
        const db = await import('./db');
        await db.updateCharacterHP(input.characterId, input.hpCurrent);
        return { success: true };
      }),

    update: protectedProcedure
      .input(z.object({
        characterId: z.number(),
        data: z.object({
          name: z.string().optional(),
          className: z.string().optional(),
          level: z.number().optional(),
          hpMax: z.number().optional(),
          ac: z.number().optional(),
          stats: z.object({
            str: z.number(),
            dex: z.number(),
            con: z.number(),
            int: z.number(),
            wis: z.number(),
            cha: z.number(),
          }).optional(),
          inventory: z.array(z.string()).optional(),
          notes: z.string().optional(),
        }),
      }))
      .mutation(async ({ input }) => {
        const db = await import('./db');
        const updateData: any = { ...input.data };
        if (updateData.stats) {
          updateData.stats = JSON.stringify(updateData.stats);
        }
        if (updateData.inventory) {
          updateData.inventory = JSON.stringify(updateData.inventory);
        }
        await db.updateCharacter(input.characterId, updateData);
        return { success: true };
      }),

    delete: protectedProcedure
      .input(z.object({ characterId: z.number() }))
      .mutation(async ({ input }) => {
        const db = await import('./db');
        await db.deleteCharacter(input.characterId);
        return { success: true };
      }),

    generate: protectedProcedure
      .input(z.object({
        sessionId: z.number(),
        className: z.string().optional(),
        race: z.string().optional(),
        background: z.string().optional(),
        level: z.number().min(1).max(20).default(1),
      }))
      .mutation(async ({ ctx, input }) => {
        const { invokeLLMWithSettings } = await import('./llm-with-settings');
        const db = await import('./db');

        // Get session to check for narrative prompt
        const session = await db.getSession(input.sessionId);
        if (!session) throw new Error('Session not found');

        const prompt = `Generate a D&D 5th Edition character with the following parameters:
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

        let systemPrompt = 'You are a D&D 5e character creation expert. Return ONLY raw JSON with no markdown formatting, no code blocks, no explanatory text. Just the JSON object.';

        // Add campaign narrative prompt if it exists
        if (session.narrativePrompt) {
          systemPrompt += `

[CAMPAIGN NARRATIVE SETTING]
${session.narrativePrompt}

Create a character that fits within this campaign setting and narrative tone.`;
        }

        const response = await invokeLLMWithSettings(ctx.user.id, {
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: prompt },
          ],
        });

        if (!response.choices || !response.choices[0] || !response.choices[0].message) {
          console.error('[Character Generation] Invalid LLM response structure:', response);
          throw new Error('Failed to generate character: Invalid response from LLM');
        }

        const content = response.choices[0].message.content;
        if (!content || typeof content !== 'string') {
          throw new Error('Failed to generate character: No content in response');
        }

        // Strip markdown code blocks if present
        let jsonContent = content.trim();
        if (jsonContent.startsWith('```')) {
          jsonContent = jsonContent.replace(/^```(?:json)?\s*\n/, '').replace(/\n```\s*$/, '');
        }

        // Parse the JSON response
        const characterData = JSON.parse(jsonContent);

        // Create the character in the database
        const result = await db.createCharacter({
          sessionId: input.sessionId,
          name: characterData.name,
          className: characterData.className,
          level: characterData.level,
          hpMax: characterData.hpMax,
          hpCurrent: characterData.hpCurrent,
          ac: characterData.ac,
          stats: JSON.stringify(characterData.stats),
          inventory: JSON.stringify(characterData.inventory),
          notes: characterData.notes,
        });

        return {
          ...result,
          ...characterData,
        };
      }),
  }),

  messages: router({
    list: protectedProcedure
      .input(z.object({ sessionId: z.number(), limit: z.number().default(50) }))
      .query(async ({ input }) => {
        const db = await import('./db');
        return db.getSessionMessages(input.sessionId, input.limit);
      }),

    send: protectedProcedure
      .input(z.object({
        sessionId: z.number(),
        characterId: z.number(),
        message: z.string().min(1),
        apiKey: z.string().optional(),
        model: z.enum(['claude', 'gpt']).default('claude'),
      }))
      .mutation(async ({ ctx, input }) => {
        const db = await import('./db');
        const { invokeLLMWithSettings } = await import('./llm-with-settings');

        // Get context
        const character = await db.getCharacter(input.characterId);
        if (!character) throw new Error('Character not found');

        const session = await db.getSession(input.sessionId);
        if (!session) throw new Error('Session not found');

        const recentMessages = await db.getSessionMessages(input.sessionId, 10);
        const stats = JSON.parse(character.stats);
        const inventory = JSON.parse(character.inventory);

        // Get extracted context
        const storedContext = await db.getSessionContext(input.sessionId);
        const context = db.parseSessionContext(storedContext);

        // Format context sections
        const npcsText = context.npcs && context.npcs.length > 0
          ? context.npcs.map(npc => `- ${npc.name}: ${npc.description} (${npc.disposition || 'unknown'})`).join('\n')
          : 'None encountered yet';

        const locationsText = context.locations && context.locations.length > 0
          ? context.locations.map(loc => `- ${loc.name}: ${loc.description}`).join('\n')
          : 'None visited yet';

        const plotPointsText = context.plotPoints && context.plotPoints.length > 0
          ? context.plotPoints.filter(p => !p.resolved).map(p => `- [${p.importance}] ${p.summary}`).join('\n')
          : 'None established yet';

        const itemsText = context.items && context.items.length > 0
          ? context.items.map(i => `- ${i.name}: ${i.description} (${i.location || 'unknown location'})`).join('\n')
          : 'None tracked yet';

        const questsText = context.quests && context.quests.length > 0
          ? context.quests.filter(q => q.progress !== 'completed' && q.progress !== 'failed')
            .map(q => `- ${q.name} (${q.progress}): ${q.description}`).join('\n')
          : 'None active';

        // Format last 10 messages for immediate context
        const recentEvents = recentMessages
          .map(m => `${m.characterName}: ${m.content}`)
          .join('\n');

        // Get combat state if in combat
        const combatState = await db.getCombatState(input.sessionId);
        let combatContext = '';

        if (combatState && combatState.inCombat === 1) {
          const combatants = await db.getCombatants(combatState.id);
          combatants.sort((a, b) => b.initiative - a.initiative);

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

        // Build enriched prompt with extracted context
        const enrichedPrompt = `[CAMPAIGN CONTEXT]
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
${character.name}: ${input.message}

Respond as the Dungeon Master. Maintain consistency with established NPCs, locations, and plot points. If combat occurs, clearly state damage dealt and HP changes.`;

        // Get user's custom system prompt or use default
        const userSettings = await db.getUserSettings(ctx.user.id);
        const defaultSystemPrompt = `You are an expert Dungeon Master for D&D 5th Edition.
Maintain narrative consistency based on the provided game state.
Be creative but respect established facts and character conditions.
During combat, track damage dealt and specify HP changes clearly.
Use D&D 5e rules for all mechanics.
IMPORTANT: When narrating combat, use the EXACT names of enemies as listed in the context (e.g., "Dragon-Touched Revolutionary 1", not "Dragon Brute"). This is critical for tracking game state.`;

        let systemPrompt = userSettings?.systemPrompt || defaultSystemPrompt;

        // Add campaign narrative prompt if it exists
        if (session.narrativePrompt) {
          systemPrompt += `

[CAMPAIGN NARRATIVE SETTING & TONE]
${session.narrativePrompt}

Follow this narrative guidance throughout all responses. Maintain the established setting, tone, themes, and style.`;
        }

        // Get LLM response using user settings
        const response = await invokeLLMWithSettings(ctx.user.id, {
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: enrichedPrompt },
          ],
        });

        if (!response.choices || !response.choices[0] || !response.choices[0].message) {
          console.error('[Chat] Invalid LLM response structure:', response);
          throw new Error('Failed to get DM response: Invalid response from LLM');
        }

        const content = response.choices[0].message.content;
        const dmResponse = typeof content === 'string' ? content : 'The DM is thinking...';

        // Save messages
        await db.saveMessage({
          sessionId: input.sessionId,
          characterName: character.name,
          content: input.message,
          isDm: 0,
        });

        await db.saveMessage({
          sessionId: input.sessionId,
          characterName: 'DM',
          content: dmResponse,
          isDm: 1,
        });

        // Extract context from the interaction
        const { extractContextFromResponse, mergeContext } = await import('./context-extraction');

        const extractedContext = await extractContextFromResponse(
          dmResponse,
          input.message,
          character.name
        );

        // Get existing context and merge with new extraction
        const existingContext = await db.getSessionContext(input.sessionId);
        const parsedContext = db.parseSessionContext(existingContext);
        const mergedContext = mergeContext(parsedContext, extractedContext);

        // Save updated context
        await db.upsertSessionContext(input.sessionId, mergedContext);

        // Apply character updates from extracted context (user can manually override via character sheet)
        console.log('[Character Updates] Extracted character updates:', extractedContext.characterUpdates);
        if (extractedContext.characterUpdates) {
          for (const update of extractedContext.characterUpdates) {
            // Only update the active character for now to be safe
            if (update.characterName.toLowerCase() === character.name.toLowerCase()) {
              const updateData: any = {};

              // Apply HP changes
              if (update.hpChange !== undefined) {
                const newHp = Math.max(0, Math.min(
                  character.hpMax,
                  character.hpCurrent + update.hpChange
                ));
                updateData.hpCurrent = newHp;
              }

              // Apply inventory changes
              if (update.inventoryAdded || update.inventoryRemoved) {
                let currentInventory = [...inventory];

                if (update.inventoryAdded) {
                  currentInventory.push(...update.inventoryAdded);
                }

                if (update.inventoryRemoved) {
                  currentInventory = currentInventory.filter(
                    item => !update.inventoryRemoved!.includes(item)
                  );
                }

                updateData.inventory = JSON.stringify(currentInventory);
              }

              // Apply updates if any
              if (Object.keys(updateData).length > 0) {
                console.log('[Character Updates] Applying updates to character:', character.name, updateData);
                await db.updateCharacter(character.id, updateData);
                console.log('[Character Updates] Successfully updated character');
              } else {
                console.log('[Character Updates] No updates to apply for:', character.name);
              }
            }
          }
        }

        // Check if we need to update summary
        const messageCount = await db.getMessageCount(input.sessionId);
        if (messageCount % 20 === 0) {
          // Generate new summary
          const allMessages = await db.getSessionMessages(input.sessionId, 50);
          const messageHistory = allMessages
            .map(m => `${m.characterName}: ${m.content}`)
            .join('\n');

          const summaryPrompt = `Previous summary: ${session.currentSummary || 'None'}

Recent messages:
${messageHistory}

Create a concise summary (max 500 words) that captures:
1. Current location and situation
2. Active quest/objective
3. Important NPCs met
4. Key items acquired or lost
5. Unresolved plot threads

Focus on information needed for narrative continuity.`;

          const summaryResponse = await invokeLLMWithSettings(ctx.user.id, {
            messages: [{ role: 'user', content: summaryPrompt }],
          });

          if (!summaryResponse.choices || !summaryResponse.choices[0] || !summaryResponse.choices[0].message) {
            console.error('[Summary] Invalid LLM response structure:', summaryResponse);
            // Don't throw error for summary - just skip update
            console.warn('[Summary] Skipping summary update due to invalid LLM response');
          } else {
            const summaryContent = summaryResponse.choices[0].message.content;
            const newSummary = (typeof summaryContent === 'string' ? summaryContent : session.currentSummary) || 'Campaign in progress';
            await db.updateSessionSummary(input.sessionId, newSummary);
          }
        }

        return { response: dmResponse };
      }),


  }),

  // Settings router
  tts: router({
    generate: protectedProcedure
      .input(z.object({
        text: z.string().min(1),
      }))
      .mutation(async ({ ctx, input }) => {
        const db = await import('./db');
        const settings = await db.getUserSettings(ctx.user.id);

        if (!settings || !settings.ttsApiKey) {
          throw new Error('TTS API key not configured. Please add your OpenAI API key in settings.');
        }

        if (!settings.ttsProvider || settings.ttsProvider !== 'openai') {
          throw new Error('Only OpenAI TTS is currently supported.');
        }

        const OpenAI = (await import('openai')).default;
        const openai = new OpenAI({ apiKey: settings.ttsApiKey });

        try {
          const mp3 = await openai.audio.speech.create({
            model: settings.ttsModel || 'tts-1',
            voice: (settings.ttsVoice || 'alloy') as any,
            input: input.text,
            response_format: 'mp3',
          });

          const buffer = Buffer.from(await mp3.arrayBuffer());
          const base64Audio = buffer.toString('base64');

          return {
            audio: base64Audio,
            format: 'mp3',
          };
        } catch (error: any) {
          console.error('TTS generation error:', error);
          throw new Error(`Failed to generate speech: ${error.message}`);
        }
      }),
  }),

  settings: router({
    get: protectedProcedure.query(async ({ ctx }) => {
      const db = await import('./db');
      const settings = await db.getUserSettings(ctx.user.id);

      // Return default settings if none exist
      if (!settings) {
        return {
          llmProvider: 'manus' as const,
          llmModel: null,
          llmApiKey: null,
          ttsEnabled: false,
          ttsProvider: null,
          ttsModel: null,
          ttsVoice: null,
          ttsApiKey: null,
          systemPrompt: null,
          campaignGenerationPrompt: null,
        };
      }

      return {
        llmProvider: settings.llmProvider,
        llmModel: settings.llmModel,
        llmApiKey: settings.llmApiKey,
        ttsEnabled: settings.ttsEnabled === 1,
        ttsProvider: settings.ttsProvider,
        ttsModel: settings.ttsModel,
        ttsVoice: settings.ttsVoice,
        ttsApiKey: settings.ttsApiKey,
        systemPrompt: settings.systemPrompt,
        campaignGenerationPrompt: settings.campaignGenerationPrompt,
      };
    }),

    update: protectedProcedure
      .input(z.object({
        llmProvider: z.enum(['manus', 'openai', 'anthropic', 'google']),
        llmModel: z.string().nullable(),
        llmApiKey: z.string().nullable(),
        ttsEnabled: z.boolean(),
        ttsProvider: z.string().nullable(),
        ttsModel: z.string().nullable(),
        ttsVoice: z.string().nullable(),
        ttsApiKey: z.string().nullable(),
        systemPrompt: z.string().nullable(),
        campaignGenerationPrompt: z.string().nullable(),
      }))
      .mutation(async ({ ctx, input }) => {
        const db = await import('./db');
        await db.upsertUserSettings({
          userId: ctx.user.id,
          llmProvider: input.llmProvider,
          llmModel: input.llmModel,
          llmApiKey: input.llmApiKey,
          ttsEnabled: input.ttsEnabled ? 1 : 0,
          ttsProvider: input.ttsProvider,
          ttsModel: input.ttsModel,
          ttsVoice: input.ttsVoice,
          ttsApiKey: input.ttsApiKey,
          systemPrompt: input.systemPrompt,
          campaignGenerationPrompt: input.campaignGenerationPrompt,
        });
        return { success: true };
      }),
  }),

  // Combat System Router
  combat: router({
    // Start combat mode
    initiate: protectedProcedure
      .input(z.object({ sessionId: z.number() }))
      .mutation(async ({ input }) => {
        const db = await import('./db');

        // Create or reset combat state
        const state = await db.createCombatState(input.sessionId);

        return { success: true, combatStateId: state.id };
      }),

    // Generate enemies automatically based on context
    generateEnemies: protectedProcedure
      .input(z.object({
        sessionId: z.number(),
        context: z.string().optional(), // Recent narrative context
      }))
      .mutation(async ({ ctx, input }) => {
        const db = await import('./db');
        const { invokeLLMWithSettings } = await import('./llm-with-settings');
        const { DiceRoller } = await import('./combat/dice-roller');

        // Get session and characters
        const session = await db.getSession(input.sessionId);
        if (!session) throw new Error('Session not found');

        const characters = await db.getSessionCharacters(input.sessionId);
        if (characters.length === 0) throw new Error('No characters in session');

        // Get recent messages for context
        const recentMessages = await db.getSessionMessages(input.sessionId, 5);
        const narrativeContext = recentMessages
          .map(m => `${m.characterName}: ${m.content}`)
          .join('\n');

        // Calculate party average level
        const avgLevel = Math.round(
          characters.reduce((sum, c) => sum + c.level, 0) / characters.length
        );

        // Generate enemies using LLM
        const prompt = `You are creating a D&D 5e combat encounter.

PARTY INFORMATION:
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

        const response = await invokeLLMWithSettings(ctx.user.id, {
          messages: [
            { role: 'system', content: 'You are a D&D 5e encounter generator. Return only valid JSON.' },
            { role: 'user', content: prompt },
          ],
        });

        if (!response.choices?.[0]?.message?.content) {
          throw new Error('Failed to generate enemies: Invalid LLM response');
        }

        const content = response.choices[0].message.content;
        if (typeof content !== 'string') {
          throw new Error('Failed to generate enemies: Invalid content type');
        }

        let jsonContent = content.trim();

        // Clean up markdown if present
        if (jsonContent.startsWith('```')) {
          jsonContent = jsonContent.replace(/^```(?:json)?\s*\n/, '').replace(/\n```\s*$/, '');
        }

        let enemies;
        try {
          enemies = JSON.parse(jsonContent);
        } catch (e) {
          console.error('Failed to parse enemy JSON:', jsonContent);
          throw new Error('Failed to parse generated enemies');
        }

        if (!Array.isArray(enemies) || enemies.length === 0) {
          throw new Error('No enemies generated');
        }

        // Get combat state
        const state = await db.getCombatState(input.sessionId);
        if (!state) throw new Error('Combat state not found');

        // Add each enemy to combat with rolled initiative
        const addedEnemies = [];

        for (const enemy of enemies) {
          const initiativeRoll = DiceRoller.roll('1d20');

          const combatant = await db.addCombatant({
            sessionId: input.sessionId,
            combatStateId: state.id,
            name: enemy.name,
            type: 'enemy',
            characterId: null,
            initiative: initiativeRoll,
            ac: enemy.ac,
            hpCurrent: enemy.hpMax,
            hpMax: enemy.hpMax,
            attackBonus: enemy.attackBonus,
            damageFormula: enemy.damageFormula,
            damageType: enemy.damageType,
            specialAbilities: null,
            position: null,
          });

          addedEnemies.push({
            ...combatant,
            initiativeRoll: initiativeRoll,
          });
        }

        return {
          success: true,
          enemies: addedEnemies,
          count: addedEnemies.length
        };
      }),


    // Add enemy to combat
    addEnemy: protectedProcedure
      .input(z.object({
        sessionId: z.number(),
        name: z.string().min(1),
        ac: z.number().min(1),
        hpMax: z.number().min(1),
        attackBonus: z.number(),
        damageFormula: z.string().min(1), // e.g., "1d6+2"
        damageType: z.string().default('slashing'),
        initiative: z.number(),
        position: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const db = await import('./db');
        const { DiceRoller } = await import('./combat/dice-roller');

        // Get combat state
        const state = await db.getCombatState(input.sessionId);
        if (!state) throw new Error('Combat state not found. Call combat.initiate first.');

        // Add enemy to database
        const combatant = await db.addCombatant({
          sessionId: input.sessionId,
          combatStateId: state.id,
          name: input.name,
          type: 'enemy',
          characterId: null,
          initiative: input.initiative,
          ac: input.ac,
          hpCurrent: input.hpMax,
          hpMax: input.hpMax,
          attackBonus: input.attackBonus,
          damageFormula: input.damageFormula,
          damageType: input.damageType,
          specialAbilities: null,
          position: input.position || null,
        });

        return { success: true, combatant };
      }),

    // Add player character to combat
    addPlayer: protectedProcedure
      .input(z.object({
        sessionId: z.number(),
        characterId: z.number(),
        initiative: z.number(),
        position: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const db = await import('./db');

        // Get character data
        const character = await db.getCharacter(input.characterId);
        if (!character) throw new Error('Character not found');

        // Get combat state
        const state = await db.getCombatState(input.sessionId);
        if (!state) throw new Error('Combat state not found. Call combat.initiate first.');

        // Add player to combat
        const combatant = await db.addCombatant({
          sessionId: input.sessionId,
          combatStateId: state.id,
          name: character.name,
          type: 'player',
          characterId: character.id,
          initiative: input.initiative,
          ac: character.ac,
          hpCurrent: character.hpCurrent,
          hpMax: character.hpMax,
          attackBonus: character.attackBonus || 0,
          damageFormula: character.damageFormula || null,
          damageType: null,
          specialAbilities: null,
          position: input.position || null,
        });

        return { success: true, combatant };
      }),

    // Sort initiative order
    sortInitiative: protectedProcedure
      .input(z.object({ sessionId: z.number() }))
      .mutation(async ({ input }) => {
        const db = await import('./db');

        // Get all combatants and sort by initiative (descending)
        const combatants = await db.getCombatantsBySession(input.sessionId);
        combatants.sort((a, b) => b.initiative - a.initiative);

        return {
          success: true,
          initiativeOrder: combatants.map(c => ({
            name: c.name,
            initiative: c.initiative,
            type: c.type,
          })),
        };
      }),

    // Resolve attack
    resolveAttack: protectedProcedure
      .input(z.object({
        sessionId: z.number(),
        actorName: z.string(),
        targetName: z.string(),
        attackRoll: z.number(),
        damage: z.number().optional(),
      }))
      .mutation(async ({ input }) => {
        const db = await import('./db');

        // Get combat state
        const state = await db.getCombatState(input.sessionId);
        if (!state) throw new Error('Combat state not found');

        // Get combatants
        const combatants = await db.getCombatants(state.id);
        const target = combatants.find(c => c.name === input.targetName);

        if (!target) throw new Error(`Target not found: ${input.targetName}`);

        // Check if hit
        const isHit = input.attackRoll >= target.ac;
        const isCritical = input.attackRoll === 20;

        let result: any = {
          isHit,
          isCritical,
          attackRoll: input.attackRoll,
          targetAC: target.ac,
        };

        if (isHit && input.damage !== undefined) {
          // Apply damage
          const newHP = Math.max(0, target.hpCurrent - input.damage);
          const isDead = newHP === 0;

          // Update combatant HP
          await db.updateCombatant(target.id, { hpCurrent: newHP });

          // If dead, remove from combat
          if (isDead) {
            await db.removeCombatant(target.id);
          }

          result = {
            ...result,
            damage: input.damage,
            targetNewHP: newHP,
            targetMaxHP: target.hpMax,
            isDead,
          };
        }

        // Log the action
        await db.logCombatAction({
          sessionId: input.sessionId,
          combatStateId: state.id,
          round: state.currentRound,
          actorName: input.actorName,
          actionType: 'attack',
          targetName: input.targetName,
          rollType: 'attack',
          rollResult: input.attackRoll,
          outcome: isHit ? (result.isDead ? 'killed' : 'hit') : 'miss',
          damageDealt: input.damage || null,
          narrative: null,
        });

        return result;
      }),

    // Advance turn
    advanceTurn: protectedProcedure
      .input(z.object({ sessionId: z.number() }))
      .mutation(async ({ input }) => {
        const db = await import('./db');

        // Get combat state
        const state = await db.getCombatState(input.sessionId);
        if (!state) throw new Error('Combat state not found');

        // Get combatants (sorted by initiative)
        const combatants = await db.getCombatants(state.id);
        combatants.sort((a, b) => b.initiative - a.initiative);

        if (combatants.length === 0) {
          throw new Error('No combatants in combat');
        }

        // Advance turn index
        let newTurnIndex = state.currentTurnIndex + 1;
        let newRound = state.currentRound;

        // If we've wrapped around, increment round
        if (newTurnIndex >= combatants.length) {
          newTurnIndex = 0;
          newRound++;
        }

        // Update combat state
        await db.updateCombatState(input.sessionId, {
          currentTurnIndex: newTurnIndex,
          currentRound: newRound,
        });

        const currentCombatant = combatants[newTurnIndex];

        return {
          success: true,
          currentTurn: {
            name: currentCombatant.name,
            type: currentCombatant.type,
            initiative: currentCombatant.initiative,
          },
          round: newRound,
        };
      }),

    // Get current combat state
    getState: protectedProcedure
      .input(z.object({ sessionId: z.number() }))
      .query(async ({ input }) => {
        const db = await import('./db');

        // Get combat state
        const state = await db.getCombatState(input.sessionId);
        if (!state) {
          return {
            inCombat: false,
            round: 0,
            combatants: [],
            currentTurnIndex: 0,
          };
        }

        // Get combatants (sorted by initiative)
        const combatants = await db.getCombatants(state.id);
        combatants.sort((a, b) => b.initiative - a.initiative);

        const currentCombatant = combatants[state.currentTurnIndex];

        return {
          inCombat: state.inCombat === 1,
          round: state.currentRound,
          currentTurnIndex: state.currentTurnIndex,
          combatants: combatants.map(c => ({
            id: c.id,
            name: c.name,
            type: c.type,
            initiative: c.initiative,
            ac: c.ac,
            hpCurrent: c.hpCurrent,
            hpMax: c.hpMax,
            attackBonus: c.attackBonus,
            damageFormula: c.damageFormula,
            damageType: c.damageType,
            position: c.position,
          })),
          currentTurn: currentCombatant ? {
            name: currentCombatant.name,
            type: currentCombatant.type,
            initiative: currentCombatant.initiative,
          } : null,
        };
      }),

    // End combat
    end: protectedProcedure
      .input(z.object({ sessionId: z.number() }))
      .mutation(async ({ input }) => {
        const db = await import('./db');

        // End combat (deletes combatants and sets inCombat = 0)
        await db.endCombat(input.sessionId);

        return { success: true };
      }),

    // Remove a single combatant (for manual deletion)
    removeCombatant: protectedProcedure
      .input(z.object({ combatantId: z.number() }))
      .mutation(async ({ input }) => {
        const db = await import('./db');

        // Delete the combatant
        await db.removeCombatant(input.combatantId);

        return { success: true };
      }),

    // Update a combatant's HP manually
    updateCombatantHP: protectedProcedure
      .input(z.object({
        combatantId: z.number(),
        newHP: z.number()
      }))
      .mutation(async ({ input }) => {
        const db = await import('./db');

        // Update the combatant's HP
        await db.updateCombatant(input.combatantId, {
          hpCurrent: input.newHP
        });

        return { success: true };
      }),
  }),
});

export type AppRouter = typeof appRouter;
