import type { ActorSheet } from '../../../../server/kernel/actor-sheet';

interface IdentityHeaderProps {
  sheet: ActorSheet;
  /** Fallback values from flat DB columns when actorSheet fields differ */
  name?: string;
  className?: string;
  level?: number;
}

export default function IdentityHeader({ sheet, name, className, level }: IdentityHeaderProps) {
  const displayName = name ?? sheet.name;
  const displayClass = className ?? sheet.characterClass;
  const displayLevel = level ?? sheet.level;

  const classLine = [
    sheet.ancestry,
    sheet.subclass ? `${displayClass} (${sheet.subclass})` : displayClass,
  ].filter(Boolean).join(' ');

  return (
    <div className="pb-3 border-b border-ghost/10">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="font-serif text-lg tracking-tight text-vellum">{displayName}</h3>
          <p className="font-sans text-[9px] tracking-[0.2em] uppercase text-ghost mt-1">
            {classLine} &middot; Level {displayLevel}
          </p>
          {sheet.background && (
            <p className="font-sans text-[8px] tracking-[0.15em] uppercase text-ghost/60 mt-0.5">
              {sheet.background}
            </p>
          )}
        </div>
        <span className="font-sans text-[8px] tracking-[0.2em] uppercase text-brass shrink-0 mt-1">
          Prof +{sheet.proficiencyBonus}
        </span>
      </div>
    </div>
  );
}
