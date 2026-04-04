import { z } from 'zod';
import { ActiveConditionSchema } from '../combat/combat-types';
import type { ActorSheet } from './actor-sheet';

export const ActorStateSchema = z.object({
  actorId: z.string(),
  hpCurrent: z.number().int().min(0),
  hpMax: z.number().int(),
  tempHp: z.number().int().default(0),
  conditions: z.array(ActiveConditionSchema),
  spellSlotsCurrent: z.record(z.string(), z.number().int()),
  hitDiceCurrent: z.number().int(),
  featureUses: z.record(z.string(), z.number().int()),
  concentration: z.object({
    spellName: z.string(),
    saveDC: z.number().int(),
  }).nullable(),
  deathSaves: z.object({
    successes: z.number().int().default(0),
    failures: z.number().int().default(0),
  }),
  exhaustion: z.number().int().min(0).max(6).default(0),
  gold: z.number().min(0).default(0),
});

export type ActorState = z.infer<typeof ActorStateSchema>;

export function deriveInitialState(sheet: ActorSheet): ActorState {
  const featureUses: Record<string, number> = {};
  for (const feature of sheet.features) {
    if (feature.usesMax != null) {
      featureUses[feature.name] = feature.usesMax;
    }
  }

  const spellSlotsCurrent: Record<number, number> = {};
  if (sheet.spellcasting) {
    for (const [level, max] of Object.entries(sheet.spellcasting.spellSlots)) {
      spellSlotsCurrent[Number(level)] = max;
    }
  }

  return {
    actorId: sheet.id,
    hpCurrent: sheet.maxHp,
    hpMax: sheet.maxHp,
    tempHp: 0,
    conditions: [],
    spellSlotsCurrent,
    hitDiceCurrent: sheet.level,
    featureUses,
    concentration: null,
    deathSaves: { successes: 0, failures: 0 },
    exhaustion: 0,
    gold: 0,
  };
}
