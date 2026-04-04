import { z } from 'zod';
import { resolveSkillCheck, type SkillCheckResult, type SkillName, type AbilityName } from './skill-check';

export const SkillChallengeSchema = z.object({
  name: z.string(),
  description: z.string(),
  dc: z.number().int().min(1).max(30),
  successesNeeded: z.number().int().min(1),
  failuresAllowed: z.number().int().min(1),
  currentSuccesses: z.number().int().default(0),
  currentFailures: z.number().int().default(0),
  allowedSkills: z.array(z.string()).default([]),
  completedChecks: z.array(z.object({
    characterName: z.string(),
    skill: z.string().optional(),
    ability: z.string().optional(),
    total: z.number(),
    dc: z.number(),
    success: z.boolean(),
    summary: z.string(),
  })).default([]),
});

export type SkillChallenge = z.infer<typeof SkillChallengeSchema>;

export type SkillChallengeOutcome = 'in_progress' | 'success' | 'failure';

export interface SkillChallengeCheckResult {
  checkResult: SkillCheckResult;
  challenge: SkillChallenge;
  outcome: SkillChallengeOutcome;
  summary: string;
}

export function createSkillChallenge(params: {
  name: string;
  description: string;
  dc: number;
  successesNeeded: number;
  failuresAllowed: number;
  allowedSkills?: string[];
}): SkillChallenge {
  return {
    name: params.name,
    description: params.description,
    dc: params.dc,
    successesNeeded: params.successesNeeded,
    failuresAllowed: params.failuresAllowed,
    currentSuccesses: 0,
    currentFailures: 0,
    allowedSkills: params.allowedSkills ?? [],
    completedChecks: [],
  };
}

function getOutcome(challenge: SkillChallenge): SkillChallengeOutcome {
  if (challenge.currentSuccesses >= challenge.successesNeeded) return 'success';
  if (challenge.currentFailures >= challenge.failuresAllowed) return 'failure';
  return 'in_progress';
}

export function contributeCheck(
  challenge: SkillChallenge,
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
): SkillChallengeCheckResult {
  const existing = getOutcome(challenge);
  if (existing !== 'in_progress') {
    throw new Error(`Skill challenge "${challenge.name}" is already ${existing}`);
  }

  if (challenge.allowedSkills.length > 0 && params.skill) {
    if (!challenge.allowedSkills.includes(params.skill)) {
      throw new Error(`Skill "${params.skill}" is not allowed in this challenge. Allowed: ${challenge.allowedSkills.join(', ')}`);
    }
  }

  const checkResult = resolveSkillCheck({
    characterName: params.characterName,
    stats: params.stats,
    level: params.level,
    dc: challenge.dc,
    skill: params.skill,
    ability: params.ability,
    proficientSkills: params.proficientSkills,
    advantage: params.advantage,
    disadvantage: params.disadvantage,
    rawRoll: params.rawRoll,
    rollFn: params.rollFn,
  });

  const updated: SkillChallenge = {
    ...challenge,
    currentSuccesses: challenge.currentSuccesses + (checkResult.success ? 1 : 0),
    currentFailures: challenge.currentFailures + (checkResult.success ? 0 : 1),
    completedChecks: [
      ...challenge.completedChecks,
      {
        characterName: params.characterName,
        skill: checkResult.skill,
        ability: checkResult.ability,
        total: checkResult.total,
        dc: challenge.dc,
        success: checkResult.success,
        summary: checkResult.summary,
      },
    ],
  };

  const outcome = getOutcome(updated);
  let summary = checkResult.summary;
  summary += ` [${updated.currentSuccesses}/${updated.successesNeeded} successes, ${updated.currentFailures}/${updated.failuresAllowed} failures]`;
  if (outcome === 'success') {
    summary += `\n**Skill Challenge "${updated.name}" — Success!**`;
  } else if (outcome === 'failure') {
    summary += `\n**Skill Challenge "${updated.name}" — Failure!**`;
  }

  return {
    checkResult,
    challenge: updated,
    outcome,
    summary,
  };
}
