import { invokeLLM } from "./_core/llm";

/**
 * Extensible schema for extracted context
 * Add new fields here as needed - the extraction prompt will automatically include them
 */
export interface ExtractedContext {
  // Core extracted data
  npcs?: Array<{
    name: string;
    description: string;
    disposition?: string; // friendly, neutral, hostile, unknown
    notes?: string;
  }>;
  locations?: Array<{
    name: string;
    description: string;
    notes?: string;
  }>;
  plotPoints?: Array<{
    summary: string;
    importance: 'low' | 'medium' | 'high';
    resolved: boolean;
  }>;
  items?: Array<{
    name: string;
    description: string;
    acquiredBy?: string; // character name
    location?: string; // where it is now
  }>;

  // Character state changes
  characterUpdates?: Array<{
    characterName: string;
    hpChange?: number; // positive for healing, negative for damage
    inventoryAdded?: string[];
    inventoryRemoved?: string[];
    conditions?: string[]; // poisoned, blessed, cursed, etc.
  }>;

  // Extensible fields (prepared for future use)
  relationships?: Array<{
    character1: string;
    character2: string;
    affinity: number; // -100 to 100
    notes?: string;
  }>;
  factions?: Array<{
    name: string;
    standing: number; // -100 to 100
    notes?: string;
  }>;
  quests?: Array<{
    name: string;
    description: string;
    progress: 'not_started' | 'in_progress' | 'completed' | 'failed';
    giver?: string;
  }>;

  // Narrative summary
  recentEvent?: string; // One-sentence summary of what just happened
}

/**
 * Extract structured context from a DM response using LLM
 */
export async function extractContextFromResponse(
  dmResponse: string,
  playerMessage: string,
  characterName: string
): Promise<ExtractedContext> {
  const extractionPrompt = `You are a D&D game state analyzer. Extract structured information from the following interaction.

**Player Action:**
${playerMessage}

**DM Response:**
${dmResponse}

**Active Character:**
${characterName}

Extract the following information in JSON format. Only include fields that are relevant to this interaction. If nothing is found for a category, omit it entirely.

{
  "npcs": [{"name": "string", "description": "string", "disposition": "friendly|neutral|hostile|unknown", "notes": "string"}],
  "locations": [{"name": "string", "description": "string", "notes": "string"}],
  "plotPoints": [{"summary": "string", "importance": "low|medium|high", "resolved": boolean}],
  "items": [{"name": "string", "description": "string", "acquiredBy": "character name or null", "location": "where it is"}],
  "characterUpdates": [{
    "characterName": "string",
    "hpChange": number (positive for healing, negative for damage),
    "inventoryAdded": ["item names"],
    "inventoryRemoved": ["item names"],
    "conditions": ["status effects like poisoned, blessed, etc"]
  }],
  "relationships": [{"character1": "string", "character2": "string", "affinity": number (-100 to 100), "notes": "string"}],
  "factions": [{"name": "string", "standing": number (-100 to 100), "notes": "string"}],
  "quests": [{"name": "string", "description": "string", "progress": "not_started|in_progress|completed|failed", "giver": "NPC name"}],
  "recentEvent": "One sentence summary of what happened in this interaction"
}

**Important:**
- Only extract information explicitly mentioned in the text
- For HP changes, look for damage taken, healing received, or explicit HP mentions
- For relationships, infer from interactions (helping = positive, fighting = negative)
- For items, track acquisitions, losses, and current location
- Be conservative - if unsure, omit the field

Return ONLY the JSON object, no other text.`;

  try {
    console.log('[Context Extraction] Starting extraction for player message:', playerMessage.substring(0, 50));
    const response = await invokeLLM({
      messages: [
        { role: "system", content: "You are a precise JSON extractor. Return only valid JSON, no markdown, no explanations." },
        { role: "user", content: extractionPrompt }
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "context_extraction",
          strict: true,
          schema: {
            type: "object",
            properties: {
              npcs: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    description: { type: "string" },
                    disposition: { type: "string", enum: ["friendly", "neutral", "hostile", "unknown"] },
                    notes: { type: "string" }
                  },
                  required: ["name", "description"],
                  additionalProperties: false
                }
              },
              locations: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    description: { type: "string" },
                    notes: { type: "string" }
                  },
                  required: ["name", "description"],
                  additionalProperties: false
                }
              },
              plotPoints: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    summary: { type: "string" },
                    importance: { type: "string", enum: ["low", "medium", "high"] },
                    resolved: { type: "boolean" }
                  },
                  required: ["summary", "importance", "resolved"],
                  additionalProperties: false
                }
              },
              items: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    description: { type: "string" },
                    acquiredBy: { type: "string" },
                    location: { type: "string" }
                  },
                  required: ["name", "description"],
                  additionalProperties: false
                }
              },
              characterUpdates: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    characterName: { type: "string" },
                    hpChange: { type: "number" },
                    inventoryAdded: { type: "array", items: { type: "string" } },
                    inventoryRemoved: { type: "array", items: { type: "string" } },
                    conditions: { type: "array", items: { type: "string" } }
                  },
                  required: ["characterName"],
                  additionalProperties: false
                }
              },
              relationships: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    character1: { type: "string" },
                    character2: { type: "string" },
                    affinity: { type: "number" },
                    notes: { type: "string" }
                  },
                  required: ["character1", "character2", "affinity"],
                  additionalProperties: false
                }
              },
              factions: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    standing: { type: "number" },
                    notes: { type: "string" }
                  },
                  required: ["name", "standing"],
                  additionalProperties: false
                }
              },
              quests: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    description: { type: "string" },
                    progress: { type: "string", enum: ["not_started", "in_progress", "completed", "failed"] },
                    giver: { type: "string" }
                  },
                  required: ["name", "description", "progress"],
                  additionalProperties: false
                }
              },
              recentEvent: { type: "string" }
            },
            additionalProperties: false
          }
        }
      }
    });

    const content = response.choices[0]?.message?.content;
    if (!content || typeof content !== 'string') {
      console.error('[Context Extraction] No content in LLM response');
      return {};
    }

    const extracted = JSON.parse(content) as ExtractedContext;
    console.log('[Context Extraction] Extracted context:', JSON.stringify(extracted, null, 2));
    return extracted;
  } catch (error) {
    console.error('[Context Extraction] Failed to extract context:', error);
    return {}; // Return empty context on error, don't break the flow
  }
}

/**
 * Merge new extracted context with existing context
 * This allows incremental updates without losing previous data
 */
export function mergeContext(
  existing: Partial<ExtractedContext>,
  newContext: ExtractedContext
): ExtractedContext {
  const merged: ExtractedContext = { ...existing };

  // Merge NPCs (avoid duplicates by name)
  if (newContext.npcs) {
    const existingNpcs = merged.npcs || [];
    const npcMap = new Map(existingNpcs.map(npc => [npc.name.toLowerCase(), npc]));

    newContext.npcs.forEach(npc => {
      const key = npc.name.toLowerCase();
      if (npcMap.has(key)) {
        // Update existing NPC
        const existing = npcMap.get(key)!;
        npcMap.set(key, { ...existing, ...npc });
      } else {
        // Add new NPC
        npcMap.set(key, npc);
      }
    });

    merged.npcs = Array.from(npcMap.values());
  }

  // Merge locations (avoid duplicates)
  if (newContext.locations) {
    const existingLocs = merged.locations || [];
    const locMap = new Map(existingLocs.map(loc => [loc.name.toLowerCase(), loc]));

    newContext.locations.forEach(loc => {
      const key = loc.name.toLowerCase();
      if (!locMap.has(key)) {
        locMap.set(key, loc);
      }
    });

    merged.locations = Array.from(locMap.values());
  }

  // Merge plot points (append new ones)
  if (newContext.plotPoints) {
    merged.plotPoints = [...(merged.plotPoints || []), ...newContext.plotPoints];
  }

  // Merge items (avoid duplicates)
  if (newContext.items) {
    const existingItems = merged.items || [];
    const itemMap = new Map(existingItems.map(item => [item.name.toLowerCase(), item]));

    newContext.items.forEach(item => {
      const key = item.name.toLowerCase();
      itemMap.set(key, item); // Always update with latest info
    });

    merged.items = Array.from(itemMap.values());
  }

  // Merge relationships (update or add)
  if (newContext.relationships) {
    const existingRels = merged.relationships || [];
    const relMap = new Map(
      existingRels.map(rel => {
        const key = [rel.character1, rel.character2].sort().join('|').toLowerCase();
        return [key, rel];
      })
    );

    newContext.relationships.forEach(rel => {
      const key = [rel.character1, rel.character2].sort().join('|').toLowerCase();
      if (relMap.has(key)) {
        const existing = relMap.get(key)!;
        // Average the affinity scores for incremental updates
        rel.affinity = Math.round((existing.affinity + rel.affinity) / 2);
      }
      relMap.set(key, rel);
    });

    merged.relationships = Array.from(relMap.values());
  }

  // Merge factions (update standing)
  if (newContext.factions) {
    const existingFactions = merged.factions || [];
    const factionMap = new Map(existingFactions.map(f => [f.name.toLowerCase(), f]));

    newContext.factions.forEach(faction => {
      const key = faction.name.toLowerCase();
      if (factionMap.has(key)) {
        const existing = factionMap.get(key)!;
        // Average the standings
        faction.standing = Math.round((existing.standing + faction.standing) / 2);
      }
      factionMap.set(key, faction);
    });

    merged.factions = Array.from(factionMap.values());
  }

  // Merge quests (update progress)
  if (newContext.quests) {
    const existingQuests = merged.quests || [];
    const questMap = new Map(existingQuests.map(q => [q.name.toLowerCase(), q]));

    newContext.quests.forEach(quest => {
      const key = quest.name.toLowerCase();
      questMap.set(key, quest); // Always use latest progress
    });

    merged.quests = Array.from(questMap.values());
  }

  // Keep most recent event
  if (newContext.recentEvent) {
    merged.recentEvent = newContext.recentEvent;
  }

  return merged;
}
