import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { InsertUser, users } from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      const sql = postgres(process.env.DATABASE_URL, { max: 1 });
      _db = drizzle(sql);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onConflictDoUpdate({
      target: users.openId,
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

// D&D Game Database Helpers
import { sessions, characters, messages, InsertSession, InsertCharacter, InsertMessage } from "../drizzle/schema";
import { desc } from "drizzle-orm";

// Session helpers
export async function createSession(userId: number, campaignName: string, narrativePrompt?: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.insert(sessions).values({
    userId,
    campaignName,
    narrativePrompt: narrativePrompt || null,
    currentSummary: null,
  }).returning({ id: sessions.id });

  return { id: result[0].id, campaignName };
}

export async function getUserSessions(userId: number) {
  const db = await getDb();
  if (!db) return [];

  return await db.select().from(sessions)
    .where(eq(sessions.userId, userId))
    .orderBy(desc(sessions.updatedAt));
}

export async function getSession(sessionId: number) {
  const db = await getDb();
  if (!db) return null;

  const result = await db.select().from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1);

  return result.length > 0 ? result[0] : null;
}

export async function updateSessionSummary(sessionId: number, summary: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.update(sessions)
    .set({ currentSummary: summary, updatedAt: new Date() })
    .where(eq(sessions.id, sessionId));
}

export async function updateSessionNarrative(sessionId: number, narrativePrompt: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.update(sessions)
    .set({ narrativePrompt, updatedAt: new Date() })
    .where(eq(sessions.id, sessionId));
}

export async function deleteSession(sessionId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Delete combat-related data first (combatants references characters.id)
  await db.delete(combatants).where(eq(combatants.sessionId, sessionId));
  await db.delete(combatLog).where(eq(combatLog.sessionId, sessionId));
  await db.delete(combatState).where(eq(combatState.sessionId, sessionId));

  // Delete other related data
  await db.delete(messages).where(eq(messages.sessionId, sessionId));
  await db.delete(characters).where(eq(characters.sessionId, sessionId));
  await db.delete(sessionContext).where(eq(sessionContext.sessionId, sessionId));

  // Delete the session itself
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}

// Character helpers
export async function createCharacter(data: Omit<InsertCharacter, 'id' | 'createdAt' | 'updatedAt'>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.insert(characters).values(data).returning({ id: characters.id });
  return { id: result[0].id };
}

export async function getSessionCharacters(sessionId: number) {
  const db = await getDb();
  if (!db) return [];

  return await db.select().from(characters)
    .where(eq(characters.sessionId, sessionId));
}

export async function getCharacter(characterId: number) {
  const db = await getDb();
  if (!db) return null;

  const result = await db.select().from(characters)
    .where(eq(characters.id, characterId))
    .limit(1);

  return result.length > 0 ? result[0] : null;
}

export async function updateCharacterHP(characterId: number, hpCurrent: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.update(characters)
    .set({ hpCurrent, updatedAt: new Date() })
    .where(eq(characters.id, characterId));
}

export async function updateCharacter(characterId: number, data: Partial<Omit<InsertCharacter, 'id' | 'sessionId'>>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.update(characters)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(characters.id, characterId));
}

export async function deleteCharacter(characterId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.delete(characters)
    .where(eq(characters.id, characterId));
}

// Message helpers
export async function saveMessage(data: Omit<InsertMessage, 'id' | 'timestamp'>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.insert(messages).values(data).returning({ id: messages.id });
  return { id: result[0].id };
}

export async function getSessionMessages(sessionId: number, limit: number = 50) {
  const db = await getDb();
  if (!db) return [];

  const result = await db.select().from(messages)
    .where(eq(messages.sessionId, sessionId))
    .orderBy(desc(messages.timestamp))
    .limit(limit);

  // Return in chronological order (oldest first)
  return result.reverse();
}

export async function getMessageCount(sessionId: number) {
  const db = await getDb();
  if (!db) return 0;

  const result = await db.select().from(messages)
    .where(eq(messages.sessionId, sessionId));

  return result.length;
}

// ===== User Settings Functions =====
import { userSettings, InsertUserSettings, UserSettings } from "../drizzle/schema";

export async function getUserSettings(userId: number): Promise<UserSettings | undefined> {
  const db = await getDb();
  if (!db) return undefined;

  const result = await db.select().from(userSettings)
    .where(eq(userSettings.userId, userId))
    .limit(1);

  return result[0];
}

export async function upsertUserSettings(settings: InsertUserSettings): Promise<void> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert settings: database not available");
    return;
  }

  await db.insert(userSettings)
    .values(settings)
    .onConflictDoUpdate({
      target: userSettings.userId,
      set: {
        llmProvider: settings.llmProvider,
        llmModel: settings.llmModel,
        llmApiKey: settings.llmApiKey,
        ttsEnabled: settings.ttsEnabled,
        ttsProvider: settings.ttsProvider,
        ttsVoice: settings.ttsVoice,
        ttsApiKey: settings.ttsApiKey,
        systemPrompt: settings.systemPrompt,
        campaignGenerationPrompt: settings.campaignGenerationPrompt,
        characterGenerationPrompt: settings.characterGenerationPrompt,
        combatTurnPrompt: settings.combatTurnPrompt,
        combatNarrationPrompt: settings.combatNarrationPrompt,
        combatSummaryPrompt: settings.combatSummaryPrompt,
        updatedAt: new Date(),
      },
    });
}

// ===== Session Context Functions =====
import { sessionContext, SessionContext, InsertSessionContext } from "../drizzle/schema";
import type { ExtractedContext } from "./context-extraction";

export async function getSessionContext(sessionId: number): Promise<SessionContext | undefined> {
  const db = await getDb();
  if (!db) return undefined;

  const result = await db.select().from(sessionContext)
    .where(eq(sessionContext.sessionId, sessionId))
    .limit(1);

  return result[0];
}

export async function upsertSessionContext(
  sessionId: number,
  context: Partial<ExtractedContext>
): Promise<void> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert context: database not available");
    return;
  }

  const contextData: InsertSessionContext = {
    sessionId,
    npcs: context.npcs ? JSON.stringify(context.npcs) : null,
    locations: context.locations ? JSON.stringify(context.locations) : null,
    plotPoints: context.plotPoints ? JSON.stringify(context.plotPoints) : null,
    items: context.items ? JSON.stringify(context.items) : null,
    relationships: context.relationships ? JSON.stringify(context.relationships) : null,
    factions: context.factions ? JSON.stringify(context.factions) : null,
    quests: context.quests ? JSON.stringify(context.quests) : null,
    worldState: null, // Reserved for future use
    campaignSummary: null, // Will be generated separately
    recentEvents: context.recentEvent ? JSON.stringify([context.recentEvent]) : null,
  };

  await db.insert(sessionContext)
    .values(contextData)
    .onConflictDoUpdate({
      target: sessionContext.sessionId,
      set: {
        npcs: contextData.npcs,
        locations: contextData.locations,
        plotPoints: contextData.plotPoints,
        items: contextData.items,
        relationships: contextData.relationships,
        factions: contextData.factions,
        quests: contextData.quests,
        worldState: contextData.worldState,
        campaignSummary: contextData.campaignSummary,
        recentEvents: contextData.recentEvents,
        updatedAt: new Date(),
      },
    });
}

/**
 * Parse stored JSON context back into ExtractedContext format
 */
export function parseSessionContext(stored: SessionContext | undefined): Partial<ExtractedContext> {
  if (!stored) return {};

  return {
    npcs: stored.npcs ? JSON.parse(stored.npcs) : undefined,
    locations: stored.locations ? JSON.parse(stored.locations) : undefined,
    plotPoints: stored.plotPoints ? JSON.parse(stored.plotPoints) : undefined,
    items: stored.items ? JSON.parse(stored.items) : undefined,
    relationships: stored.relationships ? JSON.parse(stored.relationships) : undefined,
    factions: stored.factions ? JSON.parse(stored.factions) : undefined,
    quests: stored.quests ? JSON.parse(stored.quests) : undefined,
    recentEvent: stored.recentEvents ? JSON.parse(stored.recentEvents)[0] : undefined,
  };
}

// ===== Combat System Functions =====
import { combatState, combatants, combatLog, CombatState, Combatant, CombatLog, InsertCombatState, InsertCombatant, InsertCombatLog } from "../drizzle/schema";

export async function createCombatState(sessionId: number): Promise<CombatState> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // First, check if combat state already exists for this session
  const existing = await db.select().from(combatState)
    .where(eq(combatState.sessionId, sessionId))
    .limit(1);

  if (existing.length > 0) {
    // Update existing combat state
    await db.update(combatState)
      .set({
        inCombat: 1,
        currentRound: 1,
        currentTurnIndex: 0,
        updatedAt: new Date(),
      })
      .where(eq(combatState.sessionId, sessionId));

    return (await db.select().from(combatState)
      .where(eq(combatState.sessionId, sessionId))
      .limit(1))[0];
  }

  // Create new combat state
  const result = await db.insert(combatState).values({
    sessionId,
    inCombat: 1,
    currentRound: 1,
    currentTurnIndex: 0,
  }).returning();

  return result[0];
}

export async function getCombatState(sessionId: number): Promise<CombatState | undefined> {
  const db = await getDb();
  if (!db) return undefined;

  const result = await db.select().from(combatState)
    .where(eq(combatState.sessionId, sessionId))
    .limit(1);

  return result[0];
}

export async function updateCombatState(sessionId: number, data: Partial<InsertCombatState>): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.update(combatState)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(combatState.sessionId, sessionId));
}

export async function deleteCombatState(sessionId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Delete related combatants and logs first
  const state = await getCombatState(sessionId);
  if (state) {
    await db.delete(combatants).where(eq(combatants.combatStateId, state.id));
    await db.delete(combatLog).where(eq(combatLog.combatStateId, state.id));
  }

  await db.delete(combatState).where(eq(combatState.sessionId, sessionId));
}

export async function addCombatant(data: Omit<InsertCombatant, 'id' | 'createdAt'>): Promise<Combatant> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.insert(combatants).values(data).returning();
  return result[0];
}

export async function getCombatants(combatStateId: number): Promise<Combatant[]> {
  const db = await getDb();
  if (!db) return [];

  return await db.select().from(combatants)
    .where(eq(combatants.combatStateId, combatStateId));
}

export async function getCombatantsBySession(sessionId: number): Promise<Combatant[]> {
  const db = await getDb();
  if (!db) return [];

  return await db.select().from(combatants)
    .where(eq(combatants.sessionId, sessionId));
}

export async function updateCombatant(combatantId: number, data: Partial<InsertCombatant>): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.update(combatants)
    .set(data)
    .where(eq(combatants.id, combatantId));
}

export async function removeCombatant(combatantId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.delete(combatants).where(eq(combatants.id, combatantId));
}

export async function logCombatAction(data: Omit<InsertCombatLog, 'id' | 'timestamp'>): Promise<CombatLog> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.insert(combatLog).values(data).returning();
  return result[0];
}

export async function getCombatLog(combatStateId: number, limit: number = 50): Promise<CombatLog[]> {
  const db = await getDb();
  if (!db) return [];

  const result = await db.select().from(combatLog)
    .where(eq(combatLog.combatStateId, combatStateId))
    .orderBy(desc(combatLog.timestamp))
    .limit(limit);

  return result.reverse(); // Chronological order (oldest first)
}

export async function endCombat(sessionId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const state = await getCombatState(sessionId);
  if (!state) return;

  // Delete all combatants for this combat session
  await db.delete(combatants).where(eq(combatants.combatStateId, state.id));

  // Set inCombat to 0
  await db.update(combatState)
    .set({ inCombat: 0, updatedAt: new Date() })
    .where(eq(combatState.sessionId, sessionId));
}
