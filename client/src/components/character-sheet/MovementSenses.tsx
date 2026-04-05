import type { ActorSheet } from '../../../../server/kernel/actor-sheet';
import CollapsibleSection from './shared/CollapsibleSection';

interface MovementSensesProps {
  speeds: ActorSheet['speeds'];
  senses: ActorSheet['senses'];
}

export default function MovementSenses({ speeds, senses }: MovementSensesProps) {
  const speedEntries: [string, number][] = [
    ['Walk', speeds.walk],
    ...(speeds.fly ? [['Fly', speeds.fly] as [string, number]] : []),
    ...(speeds.swim ? [['Swim', speeds.swim] as [string, number]] : []),
    ...(speeds.climb ? [['Climb', speeds.climb] as [string, number]] : []),
    ...(speeds.burrow ? [['Burrow', speeds.burrow] as [string, number]] : []),
  ];

  const senseEntries: [string, number][] = [
    ...(senses.darkvision ? [['Darkvision', senses.darkvision] as [string, number]] : []),
    ...(senses.blindsight ? [['Blindsight', senses.blindsight] as [string, number]] : []),
    ...(senses.tremorsense ? [['Tremorsense', senses.tremorsense] as [string, number]] : []),
    ...(senses.truesight ? [['Truesight', senses.truesight] as [string, number]] : []),
  ];

  const summaryBadge = (
    <span className="font-sans text-[8px] text-ghost/60">{speeds.walk} ft</span>
  );

  return (
    <CollapsibleSection title="Movement & Senses" badge={summaryBadge}>
      {/* Speeds */}
      <div className="mb-2">
        <div className="space-y-0.5">
          {speedEntries.map(([label, value]) => (
            <div key={label} className="flex items-baseline justify-between">
              <span className="font-sans text-[9px] tracking-[0.1em] text-ghost">{label}</span>
              <span className="font-serif text-xs text-foreground">{value} ft</span>
            </div>
          ))}
        </div>
      </div>

      {/* Senses */}
      {senseEntries.length > 0 && (
        <div>
          <span className="font-sans text-[8px] tracking-[0.2em] uppercase text-ghost block mb-1">Senses</span>
          <div className="space-y-0.5">
            {senseEntries.map(([label, value]) => (
              <div key={label} className="flex items-baseline justify-between">
                <span className="font-sans text-[9px] tracking-[0.1em] text-ghost">{label}</span>
                <span className="font-serif text-xs text-foreground">{value} ft</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </CollapsibleSection>
  );
}
