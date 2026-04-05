import type { ActorState } from '../../../../server/kernel/actor-state';
import ResourceDots from './shared/ResourceDots';

interface StatusBarProps {
  state: ActorState;
}

export default function StatusBar({ state }: StatusBarProps) {
  const hasConditions = state.conditions.length > 0;
  const hasConcentration = state.concentration !== null;
  const hasExhaustion = state.exhaustion > 0;
  const hasDeathSaves = state.deathSaves.successes > 0 || state.deathSaves.failures > 0;

  if (!hasConditions && !hasConcentration && !hasExhaustion && !hasDeathSaves) {
    return null;
  }

  return (
    <div className="py-3 border-b border-ghost/10 space-y-2">
      {/* Conditions */}
      {hasConditions && (
        <div className="flex flex-wrap gap-1">
          {state.conditions.map((cond, i) => (
            <span
              key={`${cond.name}-${i}`}
              className="inline-flex items-center px-1.5 py-0.5 rounded text-[8px] font-sans uppercase tracking-wider bg-destructive/20 text-destructive"
            >
              {cond.name}
              {cond.duration != null && (
                <span className="ml-1 text-ghost/60">{cond.duration}r</span>
              )}
            </span>
          ))}
        </div>
      )}

      {/* Concentration */}
      {hasConcentration && state.concentration && (
        <div className="flex items-center gap-1.5">
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[8px] font-sans uppercase tracking-wider bg-blue-500/20 text-blue-400">
            Concentrating: {state.concentration.spellName}
          </span>
        </div>
      )}

      {/* Exhaustion */}
      {hasExhaustion && (
        <div className="flex items-center gap-2">
          <span className="font-sans text-[8px] tracking-[0.2em] uppercase text-ghost">Exhaustion</span>
          <ResourceDots current={state.exhaustion} max={6} filledColor="text-amber-500" />
        </div>
      )}

      {/* Death Saves */}
      {hasDeathSaves && (
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <span className="font-sans text-[8px] tracking-[0.2em] uppercase text-ghost">Saves</span>
            <ResourceDots current={state.deathSaves.successes} max={3} filledColor="text-emerald-500" />
          </div>
          <div className="flex items-center gap-1">
            <span className="font-sans text-[8px] tracking-[0.2em] uppercase text-ghost">Fails</span>
            <ResourceDots current={state.deathSaves.failures} max={3} filledColor="text-destructive" />
          </div>
        </div>
      )}
    </div>
  );
}
