import { z } from 'zod';
import { resolveSkillCheck, type SkillCheckResult, type SkillName, type AbilityName } from './skill-check';

export const Disposition = z.enum(['hostile', 'neutral', 'friendly']);
export type Disposition = z.infer<typeof Disposition>;

const DISPOSITION_ORDER: Disposition[] = ['hostile', 'neutral', 'friendly'];

export const SocialEncounterSchema = z.object({
  npcName: z.string(),
  disposition: Disposition,
  dc: z.number().int().min(1).max(30),
  maxInteractions: z.number().int().min(1).default(5),
  approachesUsed: z.array(z.object({
    characterName: z.string(),
    skill: z.string().optional(),
    ability: z.string().optional(),
    total: z.number(),
    dc: z.number(),
    success: z.boolean(),
    criticalSuccess: z.boolean(),
    criticalFailure: z.boolean(),
    dispositionBefore: Disposition,
    dispositionAfter: Disposition,
    summary: z.string(),
  })).default([]),
  outcome: z.enum(['in_progress', 'success', 'failure', 'neutral_end']).default('in_progress'),
});

export type SocialEncounter = z.infer<typeof SocialEncounterSchema>;
export type SocialOutcome = SocialEncounter['outcome'];

export interface SocialCheckResult {
  checkResult: SkillCheckResult;
  encounter: SocialEncounter;
  outcome: SocialOutcome;
  summary: string;
}

export function createSocialEncounter(params: {
  npcName: string;
  disposition: Disposition;
  dc: number;
  maxInteractions?: number;
}): SocialEncounter {
  return {
    npcName: params.npcName,
    disposition: params.disposition,
    dc: params.dc,
    maxInteractions: params.maxInteractions ?? 5,
    approachesUsed: [],
    outcome: 'in_progress',
  };
}

function shiftDisposition(current: Disposition, direction: 1 | -1): Disposition {
  const idx = DISPOSITION_ORDER.indexOf(current);
  const newIdx = Math.max(0, Math.min(DISPOSITION_ORDER.length - 1, idx + direction));
  return DISPOSITION_ORDER[newIdx];
}

function resolveOutcome(encounter: SocialEncounter): SocialOutcome {
  if (encounter.disposition === 'friendly') return 'success';
  if (encounter.disposition === 'hostile') return 'failure';
  if (encounter.approachesUsed.length >= encounter.maxInteractions) return 'neutral_end';
  return 'in_progress';
}

export function attemptSocialCheck(
  encounter: SocialEncounter,
  params: {
    characterName: string;
    stats: Record<AbilityName, number>;
    level: number;
    skill?: SkillName;
    ability?: AbilityName;
    proficientSkills?: SkillName[];
    advantage?: boolean;
    disadvantage?: boolean;
    rawRoll?: number;
    rollFn?: (formula: string) => { total: number };
  },
): SocialCheckResult {
  if (encounter.outcome !== 'in_progress') {
    throw new Error(`Social encounter with ${encounter.npcName} is already resolved (${encounter.outcome}).`);
  }

  const checkResult = resolveSkillCheck({
    characterName: params.characterName,
    stats: params.stats,
    level: params.level,
    dc: encounter.dc,
    skill: params.skill,
    ability: params.ability,
    proficientSkills: params.proficientSkills,
    advantage: params.advantage,
    disadvantage: params.disadvantage,
    rawRoll: params.rawRoll,
    rollFn: params.rollFn,
  });

  const criticalSuccess = checkResult.rawRoll === 20;
  const criticalFailure = checkResult.rawRoll === 1;

  const dispositionBefore = encounter.disposition;
  let newDisposition = encounter.disposition;

  if (criticalSuccess) {
    // Crit success: shift two steps toward friendly
    newDisposition = shiftDisposition(newDisposition, 1);
    newDisposition = shiftDisposition(newDisposition, 1);
  } else if (criticalFailure) {
    // Crit failure: shift two steps toward hostile
    newDisposition = shiftDisposition(newDisposition, -1);
    newDisposition = shiftDisposition(newDisposition, -1);
  } else if (checkResult.success) {
    newDisposition = shiftDisposition(newDisposition, 1);
  } else {
    newDisposition = shiftDisposition(newDisposition, -1);
  }

  const approach = {
    characterName: params.characterName,
    skill: checkResult.skill,
    ability: checkResult.ability,
    total: checkResult.total,
    dc: encounter.dc,
    success: checkResult.success,
    criticalSuccess,
    criticalFailure,
    dispositionBefore,
    dispositionAfter: newDisposition,
    summary: checkResult.summary,
  };

  const updated: SocialEncounter = {
    ...encounter,
    disposition: newDisposition,
    approachesUsed: [...encounter.approachesUsed, approach],
  };

  // Resolve after disposition change — crit success/failure can immediately resolve
  const outcome = resolveOutcome(updated);
  updated.outcome = outcome;

  const dispositionLabel = newDisposition !== dispositionBefore
    ? ` Disposition: ${dispositionBefore} → **${newDisposition}**.`
    : ` Disposition: **${newDisposition}** (unchanged).`;

  let summary = checkResult.summary + dispositionLabel;
  summary += ` [${updated.approachesUsed.length}/${updated.maxInteractions} interactions]`;

  if (criticalSuccess) summary += ' *(Natural 20!)*';
  if (criticalFailure) summary += ' *(Natural 1!)*';

  if (outcome === 'success') {
    summary += `\n**${updated.npcName} is now friendly — encounter resolved successfully!**`;
  } else if (outcome === 'failure') {
    summary += `\n**${updated.npcName} has become hostile — encounter failed!**`;
  } else if (outcome === 'neutral_end') {
    summary += `\n**Social encounter with ${updated.npcName} concluded (neutral).**`;
  }

  return {
    checkResult,
    encounter: updated,
    outcome,
    summary,
  };
}
