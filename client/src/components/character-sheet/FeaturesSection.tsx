import { useState } from 'react';
import type { ActorSheet } from '../../../../server/kernel/actor-sheet';
import type { ActorState } from '../../../../server/kernel/actor-state';
import CollapsibleSection from './shared/CollapsibleSection';

interface FeaturesSectionProps {
  features: ActorSheet['features'];
  feats: ActorSheet['feats'];
  featureUses: ActorState['featureUses'];
}

export default function FeaturesSection({ features, feats, featureUses }: FeaturesSectionProps) {
  const [expandedFeature, setExpandedFeature] = useState<string | null>(null);

  return (
    <CollapsibleSection title="Features & Feats">
      {features.length > 0 && (
        <div className="space-y-1.5">
          {features.map((feat) => {
            const isExpanded = expandedFeature === feat.name;
            const usesMax = feat.usesMax;
            const usesCurrent =
              usesMax != null ? (featureUses[feat.name] ?? usesMax) : null;

            return (
              <div key={feat.name}>
                <div
                  className="flex items-start justify-between cursor-pointer"
                  onClick={() => setExpandedFeature(isExpanded ? null : feat.name)}
                >
                  <div className="min-w-0 flex-1">
                    <span className="font-serif text-[11px] text-foreground">{feat.name}</span>
                    <span className="font-sans text-[7px] text-ghost/50 ml-1">{feat.source}</span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {feat.rechargeOn && (
                      <span className="font-sans text-[7px] tracking-wider uppercase text-ghost/50">
                        {feat.rechargeOn === 'short_rest' ? 'SR' : 'LR'}
                      </span>
                    )}
                    {usesMax != null && usesCurrent != null && (
                      <span className="font-sans text-[9px] text-brass">
                        {usesCurrent}/{usesMax}
                      </span>
                    )}
                  </div>
                </div>
                {isExpanded && feat.description && (
                  <p className="font-serif text-[10px] text-ghost/70 mt-1 ml-1 leading-relaxed">
                    {feat.description}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Feats */}
      {feats.length > 0 && (
        <div className="mt-2 pt-2 border-t border-ghost/5">
          <span className="font-sans text-[8px] tracking-[0.2em] uppercase text-ghost block mb-1">Feats</span>
          <div className="flex flex-wrap gap-x-2 gap-y-0.5">
            {feats.map((feat) => (
              <span key={feat} className="font-serif text-[11px] text-foreground">{feat}</span>
            ))}
          </div>
        </div>
      )}
    </CollapsibleSection>
  );
}
