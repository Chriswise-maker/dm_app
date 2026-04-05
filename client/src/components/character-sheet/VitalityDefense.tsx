import type { ActorSheet } from '../../../../server/kernel/actor-sheet';
import type { ActorState } from '../../../../server/kernel/actor-state';
import AdjustButtons from './shared/AdjustButtons';

function hpBarColor(pct: number): string {
  if (pct > 0.5) {
    const t = (pct - 0.5) / 0.5;
    const hue = 50 + t * 70;
    return `hsl(${hue}, 70%, 40%)`;
  }
  const t = pct / 0.5;
  const hue = t * 50;
  return `hsl(${hue}, 80%, 40%)`;
}

interface VitalityDefenseProps {
  sheet: ActorSheet | null;
  state: ActorState | null;
  hpCurrent: number;
  hpMax: number;
  ac: number;
  onHPAdjust: (delta: number) => void;
}

export default function VitalityDefense({
  sheet,
  state,
  hpCurrent,
  hpMax,
  ac,
  onHPAdjust,
}: VitalityDefenseProps) {
  const hpPct = hpMax > 0 ? hpCurrent / hpMax : 0;
  const tempHp = state?.tempHp ?? 0;
  const acSource = sheet?.ac?.source;
  const hitDie = sheet?.hitDie;
  const hitDiceCurrent = state?.hitDiceCurrent;
  const hitDiceMax = sheet?.level;

  return (
    <div className="py-3 border-b border-ghost/10">
      {/* HP + AC + Hit Dice row */}
      <div className="grid grid-cols-3 gap-3">
        {/* HP */}
        <div>
          <span className="font-sans text-[9px] tracking-[0.3em] uppercase text-ghost block mb-1">HP</span>
          <div className="flex items-baseline gap-1">
            <span className="font-serif text-2xl text-foreground leading-none tracking-tighter">
              {hpCurrent}
            </span>
            <span className="font-serif text-sm text-ghost">/ {hpMax}</span>
          </div>
          {tempHp > 0 && (
            <span className="font-sans text-[9px] text-blue-400 mt-0.5 block">
              +{tempHp} temp
            </span>
          )}
          {/* HP bar */}
          <div className="mt-1.5 h-1 rounded-full bg-ghost/10 overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${Math.min(100, hpPct * 100)}%`, backgroundColor: hpBarColor(hpPct) }}
            />
          </div>
        </div>

        {/* AC */}
        <div>
          <span className="font-sans text-[9px] tracking-[0.3em] uppercase text-ghost block mb-1">AC</span>
          <span className="font-serif text-2xl text-foreground leading-none tracking-tighter">{ac}</span>
          {acSource && acSource !== 'flat' && (
            <span className="font-sans text-[8px] text-ghost/60 block mt-0.5 truncate">
              {acSource}
            </span>
          )}
        </div>

        {/* Hit Dice */}
        <div>
          <span className="font-sans text-[9px] tracking-[0.3em] uppercase text-ghost block mb-1">Hit Dice</span>
          {hitDie && hitDiceMax != null && hitDiceCurrent != null ? (
            <div>
              <span className="font-serif text-2xl text-foreground leading-none tracking-tighter">
                {hitDiceCurrent}
              </span>
              <span className="font-serif text-sm text-ghost">/{hitDiceMax}</span>
              <span className="font-sans text-[8px] text-ghost/60 block mt-0.5">{hitDie}</span>
            </div>
          ) : (
            <span className="font-serif text-sm text-ghost/40">--</span>
          )}
        </div>
      </div>

      {/* HP adjust buttons */}
      <div className="mt-2" onClick={(e) => e.stopPropagation()}>
        <AdjustButtons onAdjust={onHPAdjust} />
      </div>
    </div>
  );
}
