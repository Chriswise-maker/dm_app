import { z } from 'zod';
import { AbilityStat } from './actor-sheet';

const _src = { sourceCondition: z.string().optional() };

export const ModifierSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("stat_bonus"), stat: AbilityStat, value: z.number(), ..._src }),
  z.object({ type: z.literal("ac_bonus"), value: z.number(), ..._src }),
  z.object({ type: z.literal("attack_bonus"), value: z.number(), ..._src }),
  z.object({ type: z.literal("save_bonus"), stat: z.union([AbilityStat, z.literal("all")]), value: z.number(), ..._src }),
  z.object({ type: z.literal("damage_resistance"), damageType: z.string(), ..._src }),
  z.object({ type: z.literal("damage_immunity"), damageType: z.string(), ..._src }),
  z.object({ type: z.literal("damage_vulnerability"), damageType: z.string(), ..._src }),
  z.object({ type: z.literal("condition_immunity"), condition: z.string(), ..._src }),
  z.object({ type: z.literal("advantage"), on: z.enum(["attack", "save", "ability_check"]), stat: AbilityStat.optional(), ..._src }),
  z.object({ type: z.literal("disadvantage"), on: z.enum(["attack", "save", "ability_check"]), stat: AbilityStat.optional(), ..._src }),
  z.object({ type: z.literal("extra_damage"), formula: z.string(), damageType: z.string(), ..._src }),
  z.object({ type: z.literal("speed_bonus"), value: z.number(), ..._src }),
  z.object({ type: z.literal("temp_hp"), value: z.number(), ..._src }),
]);

export type Modifier = z.infer<typeof ModifierSchema>;

export const EffectDefinitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  source: z.enum(["spell", "class_feature", "racial_trait", "item", "condition", "feat"]),
  duration: z.object({
    type: z.enum(["instant", "rounds", "minutes", "hours", "until_dispelled", "until_rest"]),
    value: z.number().optional(),
  }),
  requiresConcentration: z.boolean().default(false),
  modifiers: z.array(ModifierSchema),
});

export type EffectDefinition = z.infer<typeof EffectDefinitionSchema>;

export const EffectInstanceSchema = z.object({
  id: z.string(),
  definitionId: z.string(),
  sourceActorId: z.string(),
  targetActorId: z.string(),
  remainingRounds: z.number().nullable(),
  appliedAtRound: z.number(),
});

export type EffectInstance = z.infer<typeof EffectInstanceSchema>;
