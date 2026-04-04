import { z } from 'zod';

export const TravelPace = z.enum(['fast', 'normal', 'slow']);
export type TravelPace = z.infer<typeof TravelPace>;

export const TravelStateSchema = z.object({
  destination: z.string(),
  distanceMiles: z.number().positive(),
  pace: TravelPace,
  milesCompleted: z.number().default(0),
  encounterChance: z.number().min(0).max(100).default(20),
  encounterCheckIntervalMiles: z.number().positive().default(6),
  lastEncounterCheckMile: z.number().default(0),
  encounters: z.array(z.object({
    atMile: z.number(),
    roll: z.number(),
    triggered: z.boolean(),
    description: z.string().optional(),
  })).default([]),
  completed: z.boolean().default(false),
});

export type TravelState = z.infer<typeof TravelStateSchema>;

/**
 * Miles per 8-hour travel day by pace.
 * Fast: 30 mi, Normal: 24 mi, Slow: 18 mi (PHB p.182)
 */
const PACE_MILES_PER_DAY: Record<TravelPace, number> = {
  fast: 30,
  normal: 24,
  slow: 18,
};

/**
 * Fast pace: -5 passive Perception.
 * Slow pace: can use stealth (represented as +0 here, stealth allowed flag).
 */
export const PACE_PERCEPTION_MODIFIER: Record<TravelPace, number> = {
  fast: -5,
  normal: 0,
  slow: 0,
};

export const PACE_CAN_STEALTH: Record<TravelPace, boolean> = {
  fast: false,
  normal: false,
  slow: true,
};

export function createTravel(params: {
  destination: string;
  distanceMiles: number;
  pace: TravelPace;
  encounterChance?: number;
  encounterCheckIntervalMiles?: number;
}): TravelState {
  return {
    destination: params.destination,
    distanceMiles: params.distanceMiles,
    pace: params.pace,
    milesCompleted: 0,
    encounterChance: params.encounterChance ?? 20,
    encounterCheckIntervalMiles: params.encounterCheckIntervalMiles ?? 6,
    lastEncounterCheckMile: 0,
    encounters: [],
    completed: false,
  };
}

export interface TravelDayResult {
  travel: TravelState;
  milesAdvanced: number;
  encounterChecks: { atMile: number; roll: number; triggered: boolean }[];
  completed: boolean;
  summary: string;
}

/**
 * Advance one day of travel. Checks for random encounters at each interval.
 * @param rollFn Optional d100 roller for testing. Returns 1-100.
 */
export function advanceTravelDay(
  travel: TravelState,
  rollFn?: () => number,
): TravelDayResult {
  if (travel.completed) {
    throw new Error('Travel is already completed.');
  }

  const roll = rollFn ?? (() => Math.floor(Math.random() * 100) + 1);
  const milesPerDay = PACE_MILES_PER_DAY[travel.pace];
  const remaining = travel.distanceMiles - travel.milesCompleted;
  const milesAdvanced = Math.min(milesPerDay, remaining);
  const newMilesCompleted = travel.milesCompleted + milesAdvanced;
  const completed = newMilesCompleted >= travel.distanceMiles;

  // Check for encounters at each interval threshold crossed
  const encounterChecks: { atMile: number; roll: number; triggered: boolean }[] = [];
  let checkMile = travel.lastEncounterCheckMile + travel.encounterCheckIntervalMiles;

  while (checkMile <= newMilesCompleted) {
    const d100 = roll();
    const triggered = d100 <= travel.encounterChance;
    encounterChecks.push({ atMile: checkMile, roll: d100, triggered });
    checkMile += travel.encounterCheckIntervalMiles;
  }

  const updatedTravel: TravelState = {
    ...travel,
    milesCompleted: newMilesCompleted,
    lastEncounterCheckMile: checkMile - travel.encounterCheckIntervalMiles,
    encounters: [
      ...travel.encounters,
      ...encounterChecks.map(ec => ({ ...ec })),
    ],
    completed,
  };

  const paceNote = travel.pace === 'fast'
    ? ' (fast pace: -5 passive Perception)'
    : travel.pace === 'slow'
      ? ' (slow pace: can use stealth)'
      : '';

  let summary = `**Travel Day:** The party travels ${milesAdvanced} miles toward ${travel.destination}${paceNote}. [${Math.round(newMilesCompleted)}/${travel.distanceMiles} miles]`;

  if (encounterChecks.some(ec => ec.triggered)) {
    summary += '\n**Random encounter triggered!**';
  }

  if (completed) {
    summary += `\n**The party arrives at ${travel.destination}!**`;
  }

  return {
    travel: updatedTravel,
    milesAdvanced,
    encounterChecks,
    completed,
    summary,
  };
}

export function getMilesPerDay(pace: TravelPace): number {
  return PACE_MILES_PER_DAY[pace];
}
