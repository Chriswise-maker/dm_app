import type { ActorSheet } from '../../../../server/kernel/actor-sheet';
import CollapsibleSection from './shared/CollapsibleSection';

interface ProficienciesSectionProps {
  proficiencies: ActorSheet['proficiencies'];
}

export default function ProficienciesSection({ proficiencies }: ProficienciesSectionProps) {
  const { weapons, armor, tools } = proficiencies;
  const hasAny = weapons.length > 0 || armor.length > 0 || tools.length > 0;

  if (!hasAny) return null;

  return (
    <CollapsibleSection title="Proficiencies">
      {weapons.length > 0 && (
        <div className="mb-1.5">
          <span className="font-sans text-[8px] tracking-[0.2em] uppercase text-ghost block mb-0.5">Weapons</span>
          <p className="font-serif text-[11px] text-foreground/80">{weapons.join(', ')}</p>
        </div>
      )}
      {armor.length > 0 && (
        <div className="mb-1.5">
          <span className="font-sans text-[8px] tracking-[0.2em] uppercase text-ghost block mb-0.5">Armor</span>
          <p className="font-serif text-[11px] text-foreground/80">{armor.join(', ')}</p>
        </div>
      )}
      {tools.length > 0 && (
        <div>
          <span className="font-sans text-[8px] tracking-[0.2em] uppercase text-ghost block mb-0.5">Tools</span>
          <p className="font-serif text-[11px] text-foreground/80">{tools.join(', ')}</p>
        </div>
      )}
    </CollapsibleSection>
  );
}
