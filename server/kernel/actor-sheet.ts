import { z } from 'zod';

export const AbilityStat = z.enum(["str", "dex", "con", "int", "wis", "cha"]);
export type AbilityStat = z.infer<typeof AbilityStat>;

export const ActorSheetSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  ancestry: z.string(),
  characterClass: z.string(),
  subclass: z.string().nullable(),
  level: z.number().int().min(1).max(20),
  abilityScores: z.object({
    str: z.number().int().min(1).max(30),
    dex: z.number().int().min(1).max(30),
    con: z.number().int().min(1).max(30),
    int: z.number().int().min(1).max(30),
    wis: z.number().int().min(1).max(30),
    cha: z.number().int().min(1).max(30),
  }),
  proficiencyBonus: z.number().int(),
  proficiencies: z.object({
    saves: z.array(AbilityStat),
    skills: z.array(z.string()),
    weapons: z.array(z.string()),
    armor: z.array(z.string()),
    tools: z.array(z.string()),
  }),
  speeds: z.object({
    walk: z.number(),
    fly: z.number().optional(),
    swim: z.number().optional(),
    climb: z.number().optional(),
    burrow: z.number().optional(),
  }),
  senses: z.object({
    darkvision: z.number().optional(),
    blindsight: z.number().optional(),
    tremorsense: z.number().optional(),
    truesight: z.number().optional(),
  }),
  hitDie: z.string().regex(/^d(4|6|8|10|12|20)$/, "hitDie must be d4, d6, d8, d10, d12, or d20"),
  maxHp: z.number().int().min(1),
  ac: z.object({
    base: z.number().int(),
    source: z.string(),
  }),
  spellcasting: z.object({
    ability: AbilityStat,
    saveDC: z.number().int(),
    attackBonus: z.number().int(),
    cantripsKnown: z.array(z.string()),
    spellsKnown: z.array(z.string()),
    spellSlots: z.record(z.string(), z.number().int()),
  }).nullable(),
  equipment: z.array(z.object({
    name: z.string(),
    type: z.string(),
    properties: z.record(z.string(), z.unknown()).optional(),
  })),
  features: z.array(z.object({
    name: z.string(),
    source: z.string(),
    description: z.string(),
    usesMax: z.number().int().optional(),
    rechargeOn: z.enum(["short_rest", "long_rest"]).optional(),
  })),
  background: z.string().nullable(),
  feats: z.array(z.string()),
}).refine(
  s => s.proficiencyBonus === Math.floor((s.level - 1) / 4) + 2,
  { message: "proficiencyBonus must match level-derived value" },
);

export type ActorSheet = z.infer<typeof ActorSheetSchema>;
