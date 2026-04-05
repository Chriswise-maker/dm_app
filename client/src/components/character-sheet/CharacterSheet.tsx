import type { ActorSheet } from '../../../../server/kernel/actor-sheet';
import type { ActorState } from '../../../../server/kernel/actor-state';
import { useCharacterDerived } from '@/hooks/useCharacterDerived';

import IdentityHeader from './IdentityHeader';
import VitalityDefense from './VitalityDefense';
import StatusBar from './StatusBar';
import AbilityScores from './AbilityScores';
import SkillsSection from './SkillsSection';
import SpellcastingSection from './SpellcastingSection';
import EquipmentSection from './EquipmentSection';
import FeaturesSection from './FeaturesSection';
import MovementSenses from './MovementSenses';
import ProficienciesSection from './ProficienciesSection';

interface CharacterSheetProps {
  character: {
    id: number;
    name: string;
    className: string;
    level: number;
    hpCurrent: number;
    hpMax: number;
    ac: number;
    stats: { str: number; dex: number; con: number; int: number; wis: number; cha: number };
    actorSheet: ActorSheet | null;
    actorState: ActorState | null;
  };
  onHPAdjust: (delta: number) => void;
}

export default function CharacterSheet({ character, onHPAdjust }: CharacterSheetProps) {
  const sheet = character.actorSheet;
  const state = character.actorState;
  const derived = useCharacterDerived(sheet, state);

  // Determine HP from actorState if available, fallback to flat DB columns
  const hpCurrent = state?.hpCurrent ?? character.hpCurrent;
  const hpMax = state?.hpMax ?? character.hpMax;
  const ac = sheet?.ac?.base ?? character.ac;

  return (
    <div className="space-y-0">
      {/* Section 1: Identity */}
      {sheet ? (
        <IdentityHeader
          sheet={sheet}
          name={character.name}
          className={character.className}
          level={character.level}
        />
      ) : (
        // Legacy fallback: no actorSheet
        <div className="pb-3 border-b border-ghost/10">
          <h3 className="font-serif text-lg tracking-tight text-vellum">{character.name}</h3>
          <p className="font-sans text-[9px] tracking-[0.2em] uppercase text-ghost mt-1">
            {character.className} &middot; Level {character.level}
          </p>
        </div>
      )}

      {/* Section 2: Vitality & Defense */}
      <VitalityDefense
        sheet={sheet}
        state={state}
        hpCurrent={hpCurrent}
        hpMax={hpMax}
        ac={ac}
        onHPAdjust={onHPAdjust}
      />

      {/* Section 3: Status Bar (conditional) */}
      {state && <StatusBar state={state} />}

      {/* Section 4: Ability Scores */}
      {derived ? (
        <AbilityScores
          abilities={derived.abilities}
          passivePerception={derived.passivePerception}
          initiativeModifier={derived.initiativeModifier}
        />
      ) : (
        // Legacy fallback: raw stats only
        <div className="py-3 border-b border-ghost/10">
          <span className="font-sans text-[9px] tracking-[0.3em] uppercase text-ghost block mb-2">Abilities</span>
          <div className="space-y-1">
            {(['str', 'dex', 'con', 'int', 'wis', 'cha'] as const).map((key) => (
              <div key={key} className="flex items-baseline justify-between">
                <span className="font-sans text-[9px] tracking-[0.2em] uppercase text-ghost">
                  {key.charAt(0).toUpperCase() + key.slice(1)}
                </span>
                <span className="font-serif text-sm text-foreground">{character.stats[key]}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sections 5-10: Only render with actorSheet data */}
      {sheet && derived && (
        <>
          {/* Section 5: Skills */}
          <SkillsSection skills={derived.skills} />

          {/* Section 6: Spellcasting (hidden for non-casters) */}
          {sheet.spellcasting && (
            <SpellcastingSection
              spellcasting={sheet.spellcasting}
              slotsCurrent={state?.spellSlotsCurrent ?? {}}
            />
          )}

          {/* Section 7: Equipment & Gold */}
          {sheet.equipment.length > 0 && (
            <EquipmentSection
              equipment={sheet.equipment}
              gold={state?.gold ?? 0}
            />
          )}

          {/* Section 8: Features & Feats */}
          {(sheet.features.length > 0 || sheet.feats.length > 0) && (
            <FeaturesSection
              features={sheet.features}
              feats={sheet.feats}
              featureUses={state?.featureUses ?? {}}
            />
          )}

          {/* Section 9: Movement & Senses */}
          <MovementSenses speeds={sheet.speeds} senses={sheet.senses} />

          {/* Section 10: Proficiencies */}
          <ProficienciesSection proficiencies={sheet.proficiencies} />
        </>
      )}
    </div>
  );
}
