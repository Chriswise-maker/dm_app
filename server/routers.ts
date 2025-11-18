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
Use D&D 5e rules for all mechanics.`;
        
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
        
        // Apply character updates from extracted context
        console.log('[Character Updates] Extracted character updates:', extractedContext.characterUpdates);
        if (extractedContext.characterUpdates) {
          for (const update of extractedContext.characterUpdates) {
            console.log('[Character Updates] Processing update for:', update.characterName, 'Current character:', character.name);
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
        });
        return { success: true };
      }),
  }),
});

export type AppRouter = typeof appRouter;
