import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { z } from "zod";
import type { Combatant } from "../drizzle/schema";

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

    reset: protectedProcedure
      .input(z.object({ sessionId: z.number() }))
      .mutation(async ({ input }) => {
        const db = await import('./db');
        const { CombatEngineManager } = await import('./combat/combat-engine-manager');
        const { clearActivityLog } = await import('./activity-log');

        // Destroy V2 engine if active
        await CombatEngineManager.destroy(input.sessionId);

        // Clear activity log (in-memory)
        clearActivityLog(input.sessionId);

        // Reset DB state
        await db.resetSession(input.sessionId);

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

        // 2. Construct Generation Prompt
        const { buildCampaignGenerationPrompt, buildCampaignUserPrompt } = await import('./prompts');
        const systemPrompt = buildCampaignGenerationPrompt(userSettings);
        const generationPrompt = buildCampaignUserPrompt(userSettings, input.prompt);

        // 3. Call LLM
        const response = await invokeLLMWithSettings(ctx.user.id, {
          messages: [
            { role: 'system', content: systemPrompt + '\nReturn ONLY raw JSON. No markdown formatting.' },
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

        const { buildCharacterGenerationPrompt, buildCharacterUserPrompt } = await import('./prompts');
        const userSettings = await db.getUserSettings(ctx.user.id);
        const systemPrompt = buildCharacterGenerationPrompt(userSettings, session.narrativePrompt);
        const userPrompt = buildCharacterUserPrompt(input);

        const response = await invokeLLMWithSettings(ctx.user.id, {
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
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

    previewContext: protectedProcedure
      .input(z.object({
        sessionId: z.number(),
        characterId: z.number(),
        message: z.string().optional(),
      }))
      .query(async ({ ctx, input }) => {
        const db = await import('./db');
        const { buildChatSystemPrompt, buildChatUserPrompt } = await import('./prompts');

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

        // Get combat state if in combat
        const combatState = await db.getCombatState(input.sessionId);
        let combatants: Combatant[] = [];
        if (combatState && combatState.inCombat === 1) {
          combatants = await db.getCombatants(combatState.id);
          combatants.sort((a, b) => b.initiative - a.initiative);
        }

        // Get user's custom system prompt or use default
        const userSettings = await db.getUserSettings(ctx.user.id);

        const systemPrompt = buildChatSystemPrompt(userSettings, session.narrativePrompt);
        const enrichedPrompt = buildChatUserPrompt(
          character,
          stats,
          inventory,
          session,
          recentMessages,
          context,
          combatState,
          combatants,
          input.message || '(User is typing...)'
        );

        return {
          systemPrompt,
          enrichedPrompt,
          databaseState: context
        };
      }),

    // Get activity log for debugging
    getActivityLog: protectedProcedure
      .input(z.object({
        sessionId: z.number(),
        limit: z.number().default(50),
      }))
      .query(async ({ input }) => {
        const { getActivityLog } = await import('./activity-log');
        return {
          entries: getActivityLog(input.sessionId, input.limit),
        };
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
        const { executeMessageSend } = await import('./message-send');
        return executeMessageSend(ctx, input);
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
        characterGenerationPrompt: settings.characterGenerationPrompt,
        combatTurnPrompt: settings.combatTurnPrompt,
        combatNarrationPrompt: settings.combatNarrationPrompt,
        combatSummaryPrompt: settings.combatSummaryPrompt,
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
        characterGenerationPrompt: z.string().nullable(),
        combatTurnPrompt: z.string().nullable(),
        combatNarrationPrompt: z.string().nullable(),
        combatSummaryPrompt: z.string().nullable(),
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
          characterGenerationPrompt: input.characterGenerationPrompt,
          combatTurnPrompt: input.combatTurnPrompt,
          combatNarrationPrompt: input.combatNarrationPrompt,
          combatSummaryPrompt: input.combatSummaryPrompt,
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
        const { buildEnemyGenerationSystemPrompt, buildEnemyGenerationUserPrompt } = await import('./prompts');

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
        const systemPrompt = buildEnemyGenerationSystemPrompt();
        const userPrompt = buildEnemyGenerationUserPrompt(characters, avgLevel, narrativeContext);

        const response = await invokeLLMWithSettings(ctx.user.id, {
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
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
        const { mergeContext } = await import('./context-extraction');

        // Helper function to detect if an enemy has a proper name
        const isNamedEnemy = (name: string): boolean => {
          // Check if name ends with a number (e.g., "Guard 2", "Goblin 1")
          if (/\s+\d+$/.test(name)) return false;

          // Check if name is just "Type Number" pattern
          if (/^[A-Z][a-z]+\s+\d+$/.test(name)) return false;

          // Otherwise, assume it's a named enemy
          return true;
        };

        // Get combat state and combatants before ending
        const combatState = await db.getCombatState(input.sessionId);
        if (combatState) {
          const combatants = await db.getCombatants(combatState.id);

          // Filter for named enemies
          const namedEnemies = combatants.filter(c =>
            c.type === 'enemy' && isNamedEnemy(c.name)
          );

          if (namedEnemies.length > 0) {
            // Get existing context
            const storedContext = await db.getSessionContext(input.sessionId);
            const existingContext = db.parseSessionContext(storedContext);

            // Create NPC entries for named enemies
            const newNpcs = namedEnemies.map(enemy => ({
              name: enemy.name,
              description: `${enemy.hpCurrent <= 0 ? 'Defeated' : 'Survived'} in combat. AC ${enemy.ac}, HP ${enemy.hpMax}`,
              disposition: enemy.hpCurrent <= 0 ? 'hostile (defeated)' : 'hostile (escaped)',
              notes: `Encountered in combat. ${enemy.hpCurrent <= 0 ? 'Was killed.' : 'Survived the encounter.'}`
            }));

            // Merge with existing context
            const mergedContext = mergeContext(existingContext, { npcs: newNpcs });

            // Save updated context
            await db.upsertSessionContext(input.sessionId, mergedContext);

            console.log(`[Combat End] Saved ${namedEnemies.length} named enemies to permanent NPC database:`, newNpcs.map(n => n.name).join(', '));
          }
        }

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

    // Get combat action log for debugging
    getCombatLog: protectedProcedure
      .input(z.object({
        sessionId: z.number(),
        limit: z.number().optional().default(20),
      }))
      .query(async ({ input }) => {
        const db = await import('./db');

        // Get combat state
        const state = await db.getCombatState(input.sessionId);
        if (!state) {
          return { log: [] };
        }

        const log = await db.getCombatLog(state.id, input.limit);

        return {
          log: log.map(entry => ({
            id: entry.id,
            round: entry.round,
            actorName: entry.actorName,
            actionType: entry.actionType,
            targetName: entry.targetName,
            rollType: entry.rollType,
            rollResult: entry.rollResult,
            outcome: entry.outcome,
            damageDealt: entry.damageDealt,
            timestamp: entry.timestamp,
          })),
        };
      }),

    // Process a player attack with manual dice roll
    processPlayerAttack: protectedProcedure
      .input(z.object({
        sessionId: z.number(),
        targetName: z.string(),
        attackRoll: z.number(), // Player's d20 + attack bonus
        damageRoll: z.number().optional(), // Player's damage roll (if hit)
        characterId: z.number().optional(), // For logging purposes
      }))
      .mutation(async ({ input }) => {
        const db = await import('./db');

        // 1. Get combat state
        const state = await db.getCombatState(input.sessionId);
        if (!state || state.inCombat !== 1) {
          throw new Error('Not in combat');
        }

        // 2. Find the target
        const combatants = await db.getCombatants(state.id);
        const target = combatants.find(c =>
          c.name.toLowerCase().includes(input.targetName.toLowerCase()) ||
          input.targetName.toLowerCase().includes(c.name.toLowerCase())
        );

        if (!target) {
          throw new Error(`Target not found: ${input.targetName}`);
        }

        // 3. Check if hit
        const isHit = input.attackRoll >= target.ac;
        const isCritical = input.attackRoll >= 20; // Natural 20 assumed if roll is 20+

        let result: {
          isHit: boolean;
          isCritical: boolean;
          attackRoll: number;
          targetAC: number;
          targetName: string;
          damage?: number;
          targetNewHP?: number;
          targetMaxHP?: number;
          isDead?: boolean;
          mechanicalOutcome: string; // For DM context
        } = {
          isHit,
          isCritical,
          attackRoll: input.attackRoll,
          targetAC: target.ac,
          targetName: target.name,
          mechanicalOutcome: '',
        };

        // 4. Apply damage if hit and damage provided
        if (isHit && input.damageRoll !== undefined) {
          const damage = Math.max(0, input.damageRoll);
          const newHP = Math.max(0, target.hpCurrent - damage);
          const isDead = newHP === 0;

          await db.updateCombatant(target.id, { hpCurrent: newHP });

          // Remove from combat if dead
          if (isDead) {
            await db.removeCombatant(target.id);
          }

          result = {
            ...result,
            damage,
            targetNewHP: newHP,
            targetMaxHP: target.hpMax,
            isDead,
          };

          result.mechanicalOutcome = `[COMBAT] Attack roll ${input.attackRoll} vs AC ${target.ac} = ${isCritical ? 'CRITICAL HIT!' : 'HIT'}. ${damage} damage dealt. ${target.name}: ${newHP}/${target.hpMax} HP${isDead ? ' - DEFEATED!' : ''}.`;
        } else if (isHit) {
          result.mechanicalOutcome = `[COMBAT] Attack roll ${input.attackRoll} vs AC ${target.ac} = ${isCritical ? 'CRITICAL HIT!' : 'HIT'}. Awaiting damage roll.`;
        } else {
          result.mechanicalOutcome = `[COMBAT] Attack roll ${input.attackRoll} vs AC ${target.ac} = MISS.`;
        }

        // 5. Log the action
        await db.logCombatAction({
          sessionId: input.sessionId,
          combatStateId: state.id,
          round: state.currentRound,
          actorName: 'Player', // Could be enhanced with character name
          actionType: 'attack',
          targetName: target.name,
          rollType: 'attack',
          rollResult: input.attackRoll,
          outcome: isHit ? (result.isDead ? 'killed' : 'hit') : 'miss',
          damageDealt: input.damageRoll || null,
          narrative: null,
        });

        return result;
      }),
  }),

  // =========================================================================
  // Combat Engine V2 Router — New Deterministic Combat System
  // =========================================================================
  combatV2: router({
    /**
     * Get current combat state from the V2 engine
     */
    getState: protectedProcedure
      .input(z.object({ sessionId: z.number() }))
      .query(async ({ input }) => {
        const { CombatEngineManager } = await import('./combat/combat-engine-manager');

        // Try to get existing engine or load from DB
        let engine = CombatEngineManager.get(input.sessionId);
        if (!engine) {
          engine = await CombatEngineManager.loadFromDb(input.sessionId);
        }

        const state = engine.getState();

        // Return a serializable version (BattleState is already serializable except history)
        // Compute pendingRoll context for the visual dice roller
        const pendingRoll = (() => {
          if (state.phase === 'AWAIT_INITIATIVE' && state.pendingInitiative) {
            const nextEntityId = state.pendingInitiative.pendingEntityIds[0];
            const entity = engine.getEntity(nextEntityId);
            return {
              type: 'initiative' as const,
              formula: '1d20',
              modifier: entity?.initiativeModifier ?? 0,
              entityId: nextEntityId,
              entityName: entity?.name || 'Unknown',
              prompt: `Roll initiative for ${entity?.name || 'player'} (d20+${entity?.initiativeModifier ?? 0})`,
            };
          }
          if (state.phase === 'AWAIT_ATTACK_ROLL' && state.pendingAttackRoll) {
            const attacker = engine.getEntity(state.pendingAttackRoll.attackerId);
            const target = engine.getEntity(state.pendingAttackRoll.targetId);
            return {
              type: 'attack' as const,
              formula: '1d20',
              modifier: state.pendingAttackRoll.attackModifier,
              entityId: state.pendingAttackRoll.attackerId,
              entityName: attacker?.name || 'Unknown',
              targetName: target?.name || 'Unknown',
              prompt: `${attacker?.name} rolls to hit ${target?.name} (d20+${state.pendingAttackRoll.attackModifier})`,
            };
          }
          if (state.phase === 'AWAIT_DAMAGE_ROLL' && state.pendingAttack) {
            const attacker = engine.getEntity(state.pendingAttack.attackerId);
            const target = engine.getEntity(state.pendingAttack.targetId);
            return {
              type: 'damage' as const,
              formula: state.pendingAttack.damageFormula,
              entityId: state.pendingAttack.attackerId,
              entityName: attacker?.name || 'Unknown',
              targetName: target?.name || 'Unknown',
              isCritical: state.pendingAttack.isCritical,
              prompt: `${attacker?.name} rolls damage against ${target?.name} (${state.pendingAttack.damageFormula}${state.pendingAttack.isCritical ? ' — CRITICAL!' : ''})`,
            };
          }
          return null;
        })();

        return {
          id: state.id,
          sessionId: state.sessionId,
          phase: state.phase,
          round: state.round,
          turnIndex: state.turnIndex,
          turnOrder: state.turnOrder,
          entities: state.entities.map(e => ({
            id: e.id,
            name: e.name,
            type: e.type,
            hp: e.hp,
            maxHp: e.maxHp,
            baseAC: e.baseAC,
            initiative: e.initiative,
            status: e.status,
            attackModifier: e.attackModifier,
            damageFormula: e.damageFormula,
            damageType: e.damageType,
          })),
          currentTurnEntity: engine.getCurrentTurnEntity()?.name ?? null,
          log: state.log.slice(-20), // Last 20 log entries
          pendingRoll,
        };
      }),

    /**
     * Initiate combat with entities
     */
    initiate: protectedProcedure
      .input(z.object({
        sessionId: z.number(),
        entities: z.array(z.object({
          id: z.string(),
          name: z.string(),
          type: z.enum(['player', 'enemy', 'ally']),
          hp: z.number(),
          maxHp: z.number(),
          baseAC: z.number(),
          initiative: z.number().optional(),
          initiativeModifier: z.number().optional(),
          attackModifier: z.number().optional(),
          damageFormula: z.string().optional(),
          damageType: z.string().optional(),
          isEssential: z.boolean().optional(),
          dbCharacterId: z.number().optional(),
        })),
      }))
      .mutation(async ({ input }) => {
        const { CombatEngineManager } = await import('./combat/combat-engine-manager');
        const { CombatEntitySchema } = await import('./combat/combat-types');

        // Create fresh engine for this session
        const engine = CombatEngineManager.getOrCreate(input.sessionId);

        // Parse and validate entities
        const entities = input.entities.map(e => CombatEntitySchema.parse({
          ...e,
          initiative: e.initiative ?? 0,
          initiativeModifier: e.initiativeModifier ?? 0,
          attackModifier: e.attackModifier ?? 0,
          damageFormula: e.damageFormula ?? '1d6',
          damageType: e.damageType ?? 'bludgeoning',
          isEssential: e.isEssential ?? (e.type === 'player'),
          status: 'ALIVE',
          conditions: [],
          rangeTo: {},
        }));

        // Start combat
        const logs = engine.initiateCombat(entities);

        // Persist to database
        await CombatEngineManager.persist(input.sessionId);

        return {
          success: true,
          logs,
          state: engine.getState(),
        };
      }),

    /**
     * Submit an action (attack, end turn, etc.)
     */
    submitAction: protectedProcedure
      .input(z.object({
        sessionId: z.number(),
        action: z.discriminatedUnion('type', [
          z.object({
            type: z.literal('ATTACK'),
            attackerId: z.string(),
            targetId: z.string(),
            weaponName: z.string().optional(),
            isRanged: z.boolean().optional(),
            advantage: z.boolean().optional(),
            disadvantage: z.boolean().optional(),
          }),
          z.object({
            type: z.literal('END_TURN'),
            entityId: z.string(),
          }),
        ]),
        dryRun: z.boolean().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { CombatEngineManager } = await import('./combat/combat-engine-manager');

        // Get or load engine
        let engine = CombatEngineManager.get(input.sessionId);
        if (!engine) {
          engine = await CombatEngineManager.loadFromDb(input.sessionId);
        }

        if (engine.getState().phase === 'IDLE') {
          return {
            success: false,
            error: 'Combat not active. Call initiate first.',
            logs: [],
            newState: engine.getState(),
          };
        }

        // Normalize action with defaults for optional fields
        const normalizedAction = input.action.type === 'ATTACK'
          ? {
            ...input.action,
            isRanged: input.action.isRanged ?? false,
            advantage: input.action.advantage ?? false,
            disadvantage: input.action.disadvantage ?? false,
          }
          : input.action;

        // If dry run, clone state, apply action, return result without persisting
        if (input.dryRun) {
          const stateJson = engine.exportState();
          const { createCombatEngine } = await import('./combat/combat-engine-v2');
          const tempEngine = createCombatEngine(input.sessionId);
          tempEngine.loadState(stateJson);

          const result = tempEngine.submitAction(normalizedAction);
          return {
            success: result.success,
            error: result.error,
            logs: result.logs,
            newState: result.newState,
            isDryRun: true,
          };
        }

        return CombatEngineManager.withLock(input.sessionId, async () => {
        // Apply action for real
        const result = engine!.submitAction(normalizedAction);

        // Persist if successful
        if (result.success) {
          await CombatEngineManager.persist(input.sessionId);
          const { syncCombatStateToDb } = await import('./combat/combat-helpers');
          await syncCombatStateToDb(input.sessionId);

          // If combat resolved, destroy engine
          if (result.newState.phase === 'RESOLVED') {
            console.log(`[CombatV2] submitAction: combat resolved, destroying engine`);
            await CombatEngineManager.destroy(input.sessionId);
          } else {
            // If it's now an enemy's turn, trigger AI loop
            const nextEntity = engine!.getCurrentTurnEntity();
            if (nextEntity && nextEntity.type === 'enemy') {
              const { runAILoop } = await import('./combat/enemy-ai-controller');
              console.log(`[CombatV2] Next turn is ${nextEntity.name} (enemy), triggering AI loop...`);
              runAILoop(input.sessionId, ctx.user.id).catch(err => {
                console.error('[CombatV2] AI loop error:', err);
              });
            }
          }
        }

        return {
          success: result.success,
          error: result.error,
          logs: result.logs,
          newState: result.newState,
        };
        }); // end withLock
      }),

    /**
     * Undo the last action
     */
    undo: protectedProcedure
      .input(z.object({ sessionId: z.number() }))
      .mutation(async ({ input }) => {
        const { CombatEngineManager } = await import('./combat/combat-engine-manager');

        const engine = CombatEngineManager.get(input.sessionId);
        if (!engine) {
          return { success: false, error: 'No active combat engine' };
        }

        const undoSuccess = engine.undoLastAction();

        if (undoSuccess) {
          await CombatEngineManager.persist(input.sessionId);
          const { syncCombatStateToDb } = await import('./combat/combat-helpers');
          await syncCombatStateToDb(input.sessionId);
        }

        return {
          success: undoSuccess,
          newState: engine.getState(),
        };
      }),

    /**
     * End combat and cleanup
     */
    endCombat: protectedProcedure
      .input(z.object({ sessionId: z.number() }))
      .mutation(async ({ input }) => {
        const { CombatEngineManager } = await import('./combat/combat-engine-manager');

        const engine = CombatEngineManager.get(input.sessionId);
        if (engine) {
          engine.endCombat('Combat ended by user');
        }

        // Destroy engine and remove persisted state
        await CombatEngineManager.destroy(input.sessionId);

        return { success: true };
      }),

    /**
     * Submit a dice roll result from the visual dice roller.
     *
     * Routes the roll to the correct engine method based on current phase:
     * - AWAIT_INITIATIVE  → engine.applyInitiative()
     * - AWAIT_ATTACK_ROLL → engine.resolveAttackRoll()
     * - AWAIT_DAMAGE_ROLL → engine.applyDamage()
     *
     * After applying, saves a narrative message to chat and triggers
     * enemy AI if the turn passed to an enemy.
     */
    submitRoll: protectedProcedure
      .input(z.object({
        sessionId: z.number(),
        rollType: z.enum(['initiative', 'attack', 'damage']),
        rawDieValue: z.number().int().min(1),
        entityId: z.string().optional(), // for initiative: which player entity is rolling
      }))
      .mutation(async ({ ctx, input }) => {
        const { CombatEngineManager } = await import('./combat/combat-engine-manager');
        const db = await import('./db');

        // ---- FAST PATH (inside lock): engine ops + deterministic messages ----
        const lockResult = await CombatEngineManager.withLock(input.sessionId, async () => {
        let engine = CombatEngineManager.get(input.sessionId);
        if (!engine) {
          engine = await CombatEngineManager.loadFromDb(input.sessionId);
        }

        const state = engine.getState();
        const { sessionId, rollType, rawDieValue, entityId } = input;

        // Validate phase matches roll type
        const expectedPhase = {
          initiative: 'AWAIT_INITIATIVE',
          attack: 'AWAIT_ATTACK_ROLL',
          damage: 'AWAIT_DAMAGE_ROLL',
        }[rollType];

        if (state.phase !== expectedPhase) {
          return { success: false as const, error: `Not in ${expectedPhase} phase (currently ${state.phase})` };
        }

        // Validate d20 roll range for initiative and attack rolls
        if (rollType === 'initiative' || rollType === 'attack') {
          if (rawDieValue > 20) {
            return { success: false as const, error: `Invalid d20 roll: ${rawDieValue} (must be 1-20)` };
          }
        }

        // Validate damage rolls against formula maximum
        if (rollType === 'damage' && state.pendingAttack) {
          const { validateDiceRoll: validateRoll } = await import('./combat/combat-validators');
          const validation = validateRoll(rawDieValue, state.pendingAttack.damageFormula);
          if (!validation.valid) {
            return { success: false as const, error: `Invalid damage roll: ${rawDieValue} is out of range for ${state.pendingAttack.damageFormula} (${validation.min}-${validation.max})` };
          }
        }

        // Determine the entity name for saving the player "message"
        const rollingEntityName = (() => {
          if (rollType === 'initiative' && state.pendingInitiative) {
            const eid = entityId || state.pendingInitiative.pendingEntityIds[0];
            return engine!.getEntity(eid)?.name ?? 'Player';
          }
          if (rollType === 'attack' && state.pendingAttackRoll) {
            return engine!.getEntity(state.pendingAttackRoll.attackerId)?.name ?? 'Player';
          }
          if (rollType === 'damage' && state.pendingAttack) {
            return engine!.getEntity(state.pendingAttack.attackerId)?.name ?? 'Player';
          }
          return 'Player';
        })();

        let result;

        if (rollType === 'initiative') {
          const targetEntityId = entityId || state.pendingInitiative!.pendingEntityIds[0];
          const initResult = engine.applyInitiative(targetEntityId, rawDieValue);
          result = {
            success: initResult.logs.length > 0 || initResult.combatStarted,
            logs: initResult.logs,
            combatStarted: initResult.combatStarted,
            newState: engine.getState(),
          };
        } else if (rollType === 'attack') {
          result = engine.resolveAttackRoll(rawDieValue);
        } else {
          result = engine.applyDamage(rawDieValue);
        }

        if (!result.success && result.error) {
          return { success: false as const, error: result.error };
        }

        // Persist engine state
        await CombatEngineManager.persist(sessionId);
        const { syncCombatStateToDb } = await import('./combat/combat-helpers');
        await syncCombatStateToDb(sessionId);

        const rollLabel = rollType === 'initiative' ? `d20 initiative` : rollType === 'attack' ? `d20 attack` : `damage`;
        const flavorText = `${rollingEntityName} rolls ${rawDieValue} (${rollLabel})`;

        const activePlayerId =
          rollType === 'initiative'
            ? (entityId || state.pendingInitiative?.pendingEntityIds[0])
            : rollType === 'attack'
              ? state.pendingAttackRoll?.attackerId
              : state.pendingAttack?.attackerId;

        // Save player roll message (fast, no LLM)
        await db.saveMessage({
          sessionId,
          characterName: rollingEntityName,
          content: `🎲 Rolled ${rawDieValue} (${rollLabel})`,
          isDm: 0,
        });

        // Save deterministic DM response immediately (no LLM)
        const newState = engine.getState();
        const { generateInitiativeNarrative, generateMechanicalSummary } = await import('./combat/combat-narrator');

        let dmContent: string;
        if (rollType === 'initiative' && (result as any).combatStarted) {
          // Initiative: deterministic turn order message
          dmContent = generateInitiativeNarrative(newState.entities, newState.turnOrder);
        } else if (rollType === 'initiative') {
          // Still waiting for other players
          dmContent = flavorText;
        } else {
          // Attack/damage: mechanical summary (hit/miss/damage)
          dmContent = result.logs.length > 0
            ? generateMechanicalSummary(result.logs, newState.entities, activePlayerId)
            : flavorText;
          if (rollType === 'attack' && newState.phase === 'AWAIT_DAMAGE_ROLL' && newState.pendingAttack) {
            dmContent += `\n\n**Roll your damage!** (${newState.pendingAttack.damageFormula}${newState.pendingAttack.isCritical ? ' — DOUBLE DICE for critical hit!' : ''})`;
          }
        }

        await db.saveMessage({
          sessionId,
          characterName: 'DM',
          content: dmContent,
          isDm: 1,
        });

        // Check if combat ended after this roll
        if (newState.phase === 'RESOLVED') {
          console.log('[CombatV2] Combat ended after roll, destroying engine');
          await CombatEngineManager.destroy(sessionId);
        }

        return {
          success: true as const,
          logs: result.logs,
          newState,
          // Pass data needed for async work
          _async: {
            sessionId,
            userId: ctx.user.id,
            rollType,
            flavorText,
            rollingEntityName,
            entities: newState.entities,
            activePlayerId,
            hasLogs: result.logs.length > 0,
            phase: newState.phase,
          },
        };
        }); // end withLock

        // ---- ASYNC PATH (after lock released): LLM narrative + AI loop ----
        if (lockResult.success && lockResult._async) {
          const a = lockResult._async;

          // Generate rich LLM narrative for attack/damage (fire-and-forget)
          if (a.rollType !== 'initiative' && a.hasLogs) {
            const { generateAndSaveNarrativeAsync } = await import('./combat/combat-narrator');
            generateAndSaveNarrativeAsync(
              a.sessionId, a.userId, lockResult.logs, a.flavorText,
              a.rollingEntityName, a.entities, false, a.activePlayerId
            ).catch(err => console.error('[CombatV2] Async narrative error:', err));
          }

          // Trigger enemy AI if turn passed to enemy
          if (a.phase !== 'RESOLVED') {
            const { CombatEngineManager: EM } = await import('./combat/combat-engine-manager');
            const eng = EM.get(a.sessionId);
            const nextEntity = eng?.getCurrentTurnEntity();
            if (nextEntity && nextEntity.type === 'enemy') {
              const { runAILoop } = await import('./combat/enemy-ai-controller');
              console.log(`[CombatV2] submitRoll: next turn is ${nextEntity.name} (enemy), triggering AI loop...`);
              runAILoop(a.sessionId, a.userId).catch(err => {
                console.error('[CombatV2] AI loop error after submitRoll:', err);
              });
            }
          }
        }

        // Return clean result (strip internal _async data)
        const { _async, ...clientResult } = lockResult;
        return clientResult;
      }),
  }),
});

export type AppRouter = typeof appRouter;
