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

export async function deleteSession(sessionId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  // Delete related data first (messages, characters, context)
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
