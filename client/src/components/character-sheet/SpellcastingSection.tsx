import type { ActorSheet } from '../../../../server/kernel/actor-sheet';
import type { ActorState } from '../../../../server/kernel/actor-state';
import CollapsibleSection from './shared/CollapsibleSection';
import ResourceDots from './shared/ResourceDots';

function ordinal(n: number): string {
  if (n === 1) return '1st';
  if (n === 2) return '2nd';
  if (n === 3) return '3rd';
  return `${n}th`;
}

interface SpellcastingSectionProps {
  spellcasting: NonNullable<ActorSheet['spellcasting']>;
  slotsCurrent: ActorState['spellSlotsCurrent'];
}

export default function SpellcastingSection({ spellcasting, slotsCurrent }: SpellcastingSectionProps) {
  const slotLevels = Object.entries(spellcasting.spellSlots)
    .map(([lvl, max]) => ({ level: Number(lvl), max }))
    .filter((s) => s.max > 0)
    .sort((a, b) => a.level - b.level);

  // Group spells by level (inferred from slot structure or just list all)
  const cantrips = spellcasting.cantripsKnown;
  const spells = spellcasting.spellsKnown;

  const summaryBadge = (
    <span className="font-sans text-[8px] text-ghost/60">
      DC {spellcasting.saveDC}
    </span>
  );

  return (
    <CollapsibleSection title="Spellcasting" defaultOpen badge={summaryBadge}>
      {/* Header stats */}
      <div className="flex items-center gap-3 mb-3">
        <span className="font-sans text-[8px] tracking-[0.15em] uppercase text-ghost">
          Save DC <span className="text-foreground font-serif text-xs">{spellcasting.saveDC}</span>
        </span>
        <span className="font-sans text-[8px] tracking-[0.15em] uppercase text-ghost">
          Attack <span className="text-foreground font-serif text-xs">+{spellcasting.attackBonus}</span>
        </span>
        <span className="font-sans text-[8px] tracking-[0.15em] uppercase text-brass">
          {spellcasting.ability.toUpperCase()}
        </span>
      </div>

      {/* Spell Slots */}
      {slotLevels.length > 0 && (
        <div className="space-y-1 mb-3">
          {slotLevels.map(({ level, max }) => {
            const current = slotsCurrent[String(level)] ?? max;
            return (
              <div key={level} className="flex items-center justify-between">
                <span className="font-sans text-[8px] tracking-[0.15em] uppercase text-ghost w-8">
                  {ordinal(level)}
                </span>
                <ResourceDots current={current} max={max} filledColor="text-blue-400" />
              </div>
            );
          })}
        </div>
      )}

      {/* Cantrips */}
      {cantrips.length > 0 && (
        <div className="mb-2">
          <span className="font-sans text-[8px] tracking-[0.2em] uppercase text-ghost block mb-1">Cantrips</span>
          <div className="flex flex-wrap gap-1">
            {cantrips.map((spell) => (
              <span key={spell} className="font-serif text-[11px] text-foreground">
                {spell}{cantrips.indexOf(spell) < cantrips.length - 1 ? ',' : ''}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Known/Prepared Spells */}
      {spells.length > 0 && (
        <div>
          <span className="font-sans text-[8px] tracking-[0.2em] uppercase text-ghost block mb-1">Spells</span>
          <div className="flex flex-wrap gap-1">
            {spells.map((spell) => (
              <span key={spell} className="font-serif text-[11px] text-foreground">
                {spell}{spells.indexOf(spell) < spells.length - 1 ? ',' : ''}
              </span>
            ))}
          </div>
        </div>
      )}
    </CollapsibleSection>
  );
}
