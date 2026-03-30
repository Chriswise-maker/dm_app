import type { Modifier, EffectDefinition, EffectInstance } from './effect-types';

/**
 * Collect all active modifiers from a set of effect instances.
 */
export function getActiveModifiers(
  instances: EffectInstance[],
  definitions: Map<string, EffectDefinition>,
): Modifier[] {
  const modifiers: Modifier[] = [];
  for (const instance of instances) {
    const def = definitions.get(instance.definitionId);
    if (def) {
      modifiers.push(...def.modifiers);
    }
  }
  return modifiers;
}

/**
 * Decrement durations, return instances that are still active (filter out expired).
 */
export function tickEffects(instances: EffectInstance[]): EffectInstance[] {
  return instances
    .map((inst) => {
      if (inst.remainingRounds === null) return inst;
      return { ...inst, remainingRounds: inst.remainingRounds - 1 };
    })
    .filter((inst) => inst.remainingRounds === null || inst.remainingRounds > 0);
}

/**
 * Check if adding a concentration effect should remove an existing one.
 * Returns updated instances with old concentration effect removed if the new one requires concentration.
 */
export function resolveConcentration(
  instances: EffectInstance[],
  definitions: Map<string, EffectDefinition>,
  newDefinition: EffectDefinition,
): EffectInstance[] {
  if (!newDefinition.requiresConcentration) return instances;

  return instances.filter((inst) => {
    const def = definitions.get(inst.definitionId);
    return !def?.requiresConcentration;
  });
}
