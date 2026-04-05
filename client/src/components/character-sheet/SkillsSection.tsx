import type { SkillEntry } from '@/hooks/useCharacterDerived';
import { formatMod } from '@/hooks/useCharacterDerived';
import CollapsibleSection from './shared/CollapsibleSection';

interface SkillsSectionProps {
  skills: SkillEntry[];
}

export default function SkillsSection({ skills }: SkillsSectionProps) {
  return (
    <CollapsibleSection title="Skills">
      <div className="space-y-0.5">
        {skills.map((skill) => (
          <div key={skill.name} className="flex items-baseline justify-between">
            <div className="flex items-center gap-1.5">
              {skill.proficient ? (
                <span className="w-1 h-1 rounded-full bg-brass inline-block" />
              ) : (
                <span className="w-1 h-1 inline-block" />
              )}
              <span className={`font-sans text-[9px] tracking-[0.1em] ${skill.proficient ? 'text-brass' : 'text-ghost'}`}>
                {skill.name}
              </span>
              <span className="font-sans text-[7px] text-ghost/40 uppercase">{skill.ability}</span>
            </div>
            <span className="font-serif text-xs text-foreground">{formatMod(skill.modifier)}</span>
          </div>
        ))}
      </div>
    </CollapsibleSection>
  );
}
