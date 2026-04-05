import type { AbilityEntry } from '@/hooks/useCharacterDerived';
import { formatMod } from '@/hooks/useCharacterDerived';

interface AbilityScoresProps {
  abilities: AbilityEntry[];
  passivePerception: number;
  initiativeModifier: number;
}

export default function AbilityScores({ abilities, passivePerception, initiativeModifier }: AbilityScoresProps) {
  return (
    <div className="py-3 border-b border-ghost/10">
      <span className="font-sans text-[9px] tracking-[0.3em] uppercase text-ghost block mb-2">Abilities</span>

      <div className="space-y-1">
        {abilities.map((a) => (
          <div key={a.key} className="flex items-baseline justify-between">
            <div className="flex items-center gap-1.5">
              {a.saveProficient && (
                <span className="w-1 h-1 rounded-full bg-brass inline-block" />
              )}
              {!a.saveProficient && (
                <span className="w-1 h-1 inline-block" />
              )}
              <span className="font-sans text-[9px] tracking-[0.2em] uppercase text-ghost">{a.label}</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="font-serif text-sm text-foreground">{a.score}</span>
              <span className="font-sans text-[9px] text-ghost">({formatMod(a.modifier)})</span>
            </div>
          </div>
        ))}
      </div>

      {/* Quick-reference derived stats */}
      <div className="flex items-center gap-4 mt-2 pt-2 border-t border-ghost/5">
        <div className="flex items-baseline gap-1">
          <span className="font-sans text-[8px] tracking-[0.15em] uppercase text-ghost">Initiative</span>
          <span className="font-serif text-xs text-foreground">{formatMod(initiativeModifier)}</span>
        </div>
        <div className="flex items-baseline gap-1">
          <span className="font-sans text-[8px] tracking-[0.15em] uppercase text-ghost">Passive Per.</span>
          <span className="font-serif text-xs text-foreground">{passivePerception}</span>
        </div>
      </div>
    </div>
  );
}
