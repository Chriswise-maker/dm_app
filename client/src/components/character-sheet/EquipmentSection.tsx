import type { ActorSheet } from '../../../../server/kernel/actor-sheet';
import CollapsibleSection from './shared/CollapsibleSection';

interface EquipmentSectionProps {
  equipment: ActorSheet['equipment'];
  gold: number;
}

export default function EquipmentSection({ equipment, gold }: EquipmentSectionProps) {
  const weapons = equipment.filter((e) => e.type === 'weapon');
  const other = equipment.filter((e) => e.type !== 'weapon');

  return (
    <CollapsibleSection
      title="Equipment"
      badge={<span className="font-serif text-[10px] text-amber-500">{gold} gp</span>}
    >
      {/* Weapons */}
      {weapons.length > 0 && (
        <div className="mb-2">
          <span className="font-sans text-[8px] tracking-[0.2em] uppercase text-ghost block mb-1">Weapons</span>
          <div className="space-y-1">
            {weapons.map((w) => {
              const props = w.properties ?? {};
              const damage = props.damage as string | undefined;
              const damageType = props.damageType as string | undefined;
              return (
                <div key={w.name} className="flex items-baseline justify-between">
                  <span className="font-serif text-[11px] text-foreground">{w.name}</span>
                  <span className="font-sans text-[8px] text-ghost">
                    {damage && <>{damage}</>}
                    {damageType && <> {damageType}</>}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Other gear */}
      {other.length > 0 && (
        <div>
          <span className="font-sans text-[8px] tracking-[0.2em] uppercase text-ghost block mb-1">Gear</span>
          <div className="flex flex-wrap gap-x-2 gap-y-0.5">
            {other.map((item) => (
              <span key={item.name} className="font-serif text-[11px] text-ghost/80">{item.name}</span>
            ))}
          </div>
        </div>
      )}
    </CollapsibleSection>
  );
}
