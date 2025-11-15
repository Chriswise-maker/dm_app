import { integer, pgEnum, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */

export const roleEnum = pgEnum("role", ["user", "admin"]);
export const llmProviderEnum = pgEnum("llmProvider", ["manus", "openai", "anthropic", "google"]);

export const users = pgTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: roleEnum("role").default("user").notNull(),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn", { withTimezone: true }).defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// D&D Game Tables
export const sessions = pgTable("sessions", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  userId: integer("userId").notNull().references(() => users.id),
  campaignName: text("campaignName").notNull(),
  currentSummary: text("currentSummary"),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull(),
});

export const characters = pgTable("characters", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  sessionId: integer("sessionId").notNull().references(() => sessions.id),
  name: varchar("name", { length: 255 }).notNull(),
  className: varchar("className", { length: 100 }).notNull(),
  level: integer("level").notNull().default(1),
  hpCurrent: integer("hpCurrent").notNull(),
  hpMax: integer("hpMax").notNull(),
  ac: integer("ac").notNull(),
  // Stats as JSON: {str, dex, con, int, wis, cha}
  stats: text("stats").notNull(),
  // Inventory as JSON array
  inventory: text("inventory").notNull(),
  notes: text("notes"),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull(),
});

export const messages = pgTable("messages", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  sessionId: integer("sessionId").notNull().references(() => sessions.id),
  characterName: varchar("characterName", { length: 255 }).notNull(),
  content: text("content").notNull(),
  isDm: integer("isDm").notNull().default(0),
  timestamp: timestamp("timestamp", { withTimezone: true }).defaultNow().notNull(),
});

export type Session = typeof sessions.$inferSelect;
export type InsertSession = typeof sessions.$inferInsert;
export type Character = typeof characters.$inferSelect;
export type InsertCharacter = typeof characters.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type InsertMessage = typeof messages.$inferInsert;

// User Settings Table
export const userSettings = pgTable("userSettings", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  userId: integer("userId").notNull().unique().references(() => users.id),
  // LLM Configuration
  llmProvider: llmProviderEnum("llmProvider").notNull().default("manus"),
  llmModel: varchar("llmModel", { length: 100 }),
  llmApiKey: text("llmApiKey"), // Encrypted API key
  // Text-to-Speech Configuration (for future use)
  ttsEnabled: integer("ttsEnabled").notNull().default(0),
  ttsProvider: varchar("ttsProvider", { length: 50 }),
  ttsVoice: varchar("ttsVoice", { length: 100 }),
  ttsApiKey: text("ttsApiKey"),
  systemPrompt: text("systemPrompt"),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull(),
});

export type UserSettings = typeof userSettings.$inferSelect;
export type InsertUserSettings = typeof userSettings.$inferInsert;

// Session Context Table - Stores extracted game state for intelligent context management
export const sessionContext = pgTable("sessionContext", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  sessionId: integer("sessionId").notNull().unique().references(() => sessions.id),
  
  // Core extracted data (JSON fields for flexibility)
  npcs: text("npcs"), // [{name, description, firstMet, disposition, notes}]
  locations: text("locations"), // [{name, description, visited, notes}]
  plotPoints: text("plotPoints"), // [{summary, importance, resolved}]
  items: text("items"), // [{name, description, acquiredBy, location}]
  
  // Extensible fields for future additions
  relationships: text("relationships"), // [{char1, char2, affinity, notes}]
  factions: text("factions"), // [{name, standing, notes}]
  quests: text("quests"), // [{name, description, progress, giver}]
  worldState: text("worldState"), // {time, weather, majorEvents, etc}
  
  // Narrative summary
  campaignSummary: text("campaignSummary"), // High-level summary of campaign so far
  recentEvents: text("recentEvents"), // Last 3-5 major events
  
  updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull(),
});

export type SessionContext = typeof sessionContext.$inferSelect;
export type InsertSessionContext = typeof sessionContext.$inferInsert;