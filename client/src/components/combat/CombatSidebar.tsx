import { useState } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { trpc } from '@/lib/trpc';
import { toast } from 'sonner';
import { DiceRoller } from './DiceRoller';

interface CombatSidebarProps {
    sessionId: number;
}

// --- HP bar color helper ---
function hpBarColor(pct: number): string {
    if (pct > 0.5) {
        // Green to yellow: interpolate hue 120 → 50
        const t = (pct - 0.5) / 0.5;
        const hue = 50 + t * 70;
        return `hsl(${hue}, 70%, 40%)`;
    }
    // Yellow to red: interpolate hue 50 → 0
    const t = pct / 0.5;
    const hue = t * 50;
    return `hsl(${hue}, 80%, 40%)`;
}

// --- Ordinal helper for spell levels ---
function ordinal(n: number): string {
    if (n === 1) return '1st';
    if (n === 2) return '2nd';
    if (n === 3) return '3rd';
    return `${n}th`;
}

// --- Ability score modifier ---
function abilityMod(score: number): string {
    const mod = Math.floor((score - 10) / 2);
    return mod >= 0 ? `+${mod}` : `${mod}`;
}

export default function CombatSidebar({ sessionId }: CombatSidebarProps) {
    const utils = trpc.useUtils();
    const [expandedEntities, setExpandedEntities] = useState<Record<string, boolean>>({});

    const { data: combatState, isLoading, refetch } = trpc.combatV2.getState.useQuery(
        { sessionId },
        {
            refetchInterval: (query) =>
                (query.state.data as any)?.phase?.startsWith('AWAIT_') ? 1000 : 2000,
            refetchOnWindowFocus: true,
        }
    );

    const endCombatMutation = trpc.combatV2.endCombat.useMutation({
        onSuccess: () => {
            toast.success('Combat ended');
            utils.combatV2.getState.invalidate({ sessionId });
        },
    });

    const undoMutation = trpc.combatV2.undo.useMutation({
        onSuccess: (data) => {
            if (data.success) {
                toast.success('Undid last action');
                utils.combatV2.getState.invalidate({ sessionId });
            } else {
                toast.error('Nothing to undo');
            }
        },
    });

    const submitActionMutation = trpc.combatV2.submitAction.useMutation({
        onSuccess: () => {
            utils.combatV2.getState.invalidate({ sessionId });
            utils.messages.list.invalidate({ sessionId });
        },
    });

    if (isLoading) return null;
    if (!combatState || combatState.phase === 'IDLE' || combatState.phase === 'RESOLVED') return null;

    const handleEndCombat = () => {
        endCombatMutation.mutate({ sessionId });
    };

    const handleUndo = () => {
        undoMutation.mutate({ sessionId });
    };

    const sortedEntities = [...combatState.entities].sort((a, b) => b.initiative - a.initiative);

    const currentEntityId = combatState.turnOrder[combatState.turnIndex];
    const currentEntity = combatState.entities.find(e => e.id === currentEntityId);
    const isPlayerTurn = currentEntity?.type === 'player' && combatState.phase === 'ACTIVE';
    const tr = combatState.turnResources;

    const handleEndTurn = () => {
        if (!currentEntityId) return;
        submitActionMutation.mutate({ sessionId, action: { type: 'END_TURN', entityId: currentEntityId } });
    };

    const toggleExpanded = (entityId: string) => {
        setExpandedEntities(prev => ({ ...prev, [entityId]: !prev[entityId] }));
    };

    return (
        <aside className="bg-background flex flex-col h-full w-full overflow-hidden">
            {/* Header */}
            <div className="px-6 py-4 flex items-center justify-between">
                <div>
                    <span className="font-sans text-[10px] tracking-[0.3em] uppercase text-ghost">The Sequence</span>
                    <span className="font-sans text-[9px] text-ghost/40 ml-3">Round {combatState.round}</span>
                </div>
                <div className="flex gap-3">
                    <button
                        onClick={handleUndo}
                        className="font-sans text-[9px] tracking-[0.2em] uppercase text-ghost hover:text-vellum transition-colors"
                    >
                        Undo
                    </button>
                    <AlertDialog>
                        <AlertDialogTrigger asChild>
                            <button className="font-sans text-[9px] tracking-[0.2em] uppercase text-ghost hover:text-destructive transition-colors">
                                End
                            </button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                            <AlertDialogHeader>
                                <AlertDialogTitle className="font-serif">End Combat?</AlertDialogTitle>
                                <AlertDialogDescription>
                                    This will end the current combat session.
                                </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction onClick={handleEndCombat} className="bg-destructive hover:bg-destructive/90">
                                    End Combat
                                </AlertDialogAction>
                            </AlertDialogFooter>
                        </AlertDialogContent>
                    </AlertDialog>
                </div>
            </div>

            {/* Visual dice roller */}
            {combatState.pendingRoll && (
                <DiceRoller
                    pendingRoll={combatState.pendingRoll}
                    sessionId={sessionId}
                    onRollComplete={() => { refetch(); utils.messages.list.invalidate({ sessionId }); }}
                />
            )}

            {/* Action economy */}
            {isPlayerTurn && tr && (
                <div className="px-6 pb-4">
                    <div className="flex items-center justify-between mb-2">
                        <span className="font-sans text-[9px] tracking-[0.3em] uppercase text-ghost">
                            Action Economy
                        </span>
                        <button
                            onClick={handleEndTurn}
                            disabled={submitActionMutation.isPending}
                            className="font-sans text-[9px] tracking-[0.2em] uppercase text-ghost hover:text-brass transition-colors"
                        >
                            End Turn
                        </button>
                    </div>
                    <div className="flex gap-3 flex-wrap">
                        <span className={`font-sans text-[9px] tracking-[0.2em] uppercase ${tr.actionUsed ? 'text-ghost/30 line-through' : 'text-brass'}`}>
                            Action
                        </span>
                        <span className={`font-sans text-[9px] tracking-[0.2em] uppercase ${tr.bonusActionUsed ? 'text-ghost/30 line-through' : 'text-brass'}`}>
                            Bonus
                        </span>
                        <span className={`font-sans text-[9px] tracking-[0.2em] uppercase ${tr.reactionUsed ? 'text-ghost/30 line-through' : 'text-brass'}`}>
                            Reaction
                        </span>
                        {tr.extraAttacksRemaining > 0 && (
                            <span className="font-sans text-[9px] tracking-[0.2em] uppercase text-brass">
                                +{tr.extraAttacksRemaining} Attack
                            </span>
                        )}
                    </div>
                </div>
            )}

            {/* Spell slot tracker */}
            {isPlayerTurn && currentEntity && Object.keys(currentEntity.spellSlots ?? {}).length > 0 && (
                <div className="px-6 pb-4">
                    <span className="font-sans text-[9px] tracking-[0.3em] uppercase text-ghost block mb-2">
                        Spell Slots
                    </span>
                    <div className="flex gap-3 flex-wrap">
                        {Object.entries(currentEntity.spellSlots)
                            .sort(([a], [b]) => Number(a) - Number(b))
                            .map(([level, remaining]) => {
                                const total = remaining as number;
                                return (
                                    <div key={level} className="flex items-center gap-1">
                                        <span className="font-sans text-[9px] text-ghost/60">
                                            {ordinal(Number(level))}
                                        </span>
                                        <span className="font-sans text-[10px] text-brass">
                                            {total > 0 ? '●'.repeat(total) : '—'}
                                        </span>
                                    </div>
                                );
                            })}
                    </div>
                </div>
            )}

            <ScrollArea className="flex-1 min-h-0 overflow-hidden">
                <div className="space-y-4 px-6 py-4">
                    {sortedEntities.map((entity) => {
                        const isTurnById = combatState.turnOrder[combatState.turnIndex] === entity.id;
                        const isDefeated = entity.status === 'DEAD' || entity.status === 'UNCONSCIOUS';
                        const isEnemy = entity.type !== 'player';
                        const isRolling = combatState.pendingRoll?.entityName === entity.name;
                        const hpPct = entity.maxHp > 0 ? entity.hp / entity.maxHp : 0;
                        const isExpanded = expandedEntities[entity.id] ?? false;

                        const hasSpells = entity.spells && entity.spells.length > 0;
                        const hasFeatures = entity.featureUses && Object.keys(entity.featureUses).length > 0;
                        const hasDetails = hasSpells || hasFeatures || entity.abilityScores;
                        const isExpandable = entity.type === 'player' && hasDetails;

                        return (
                            <Collapsible
                                key={entity.id}
                                open={isExpanded}
                                onOpenChange={() => isExpandable && toggleExpanded(entity.id)}
                            >
                                <div
                                    className={`relative rounded-md px-3 py-2 transition-all duration-300 ${
                                        isTurnById
                                            ? 'bg-brass/8 ring-1 ring-brass/30 shadow-[0_0_12px_rgba(166,147,116,0.15)]'
                                            : ''
                                    } ${isDefeated ? 'opacity-30' : ''} ${isRolling ? 'animate-pulse' : ''}`}
                                >
                                    {/* Active turn indicator — animated brass left border */}
                                    {isTurnById && (
                                        <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-gradient-to-b from-brass/40 via-brass to-brass/40 rounded-l-md" />
                                    )}

                                    <CollapsibleTrigger asChild disabled={!isExpandable}>
                                        <div className={isExpandable ? 'cursor-pointer' : ''}>
                                            <div className="flex justify-between items-baseline">
                                                <div className="flex items-baseline gap-2">
                                                    <span className={`font-serif tracking-tight ${isDefeated ? 'line-through' : ''} ${
                                                        isTurnById
                                                            ? 'text-xl text-brass font-bold'
                                                            : isEnemy
                                                                ? 'text-base text-destructive'
                                                                : 'text-base text-foreground'
                                                    }`}>
                                                        {entity.name}
                                                    </span>
                                                    {isExpandable && (
                                                        <span className="text-ghost/40 text-[10px]">
                                                            {isExpanded ? '▾' : '▸'}
                                                        </span>
                                                    )}
                                                </div>
                                                <span className={`font-sans text-[11px] ${isTurnById ? 'text-brass font-bold' : 'text-ghost'}`}>
                                                    {String(entity.initiative).padStart(2, '0')}
                                                </span>
                                            </div>

                                            {isTurnById && (
                                                <span className="font-sans text-[9px] tracking-[0.2em] text-brass/60 uppercase">Acting Now</span>
                                            )}

                                            {/* HP bar + text */}
                                            <div className="mt-1.5">
                                                <div className="flex items-baseline gap-1 mb-1">
                                                    <span className="font-sans text-[9px] tracking-[0.2em] uppercase text-ghost">
                                                        {entity.hp}/{entity.maxHp}
                                                    </span>
                                                    <span className="font-sans text-[8px] text-ghost/40">HP</span>
                                                    {(entity.tempHp ?? 0) > 0 && (
                                                        <span className="font-sans text-[8px] text-blue-400">+{entity.tempHp} temp</span>
                                                    )}
                                                    <span className="font-sans text-[8px] text-ghost/40 ml-auto">AC {entity.baseAC}</span>
                                                </div>
                                                {/* Gradient HP bar */}
                                                <div className="w-full h-1.5 rounded-full bg-ghost/10 overflow-hidden">
                                                    <div
                                                        className="h-full rounded-full transition-all duration-500 ease-out"
                                                        style={{
                                                            width: `${Math.max(hpPct * 100, 0)}%`,
                                                            backgroundColor: hpBarColor(hpPct),
                                                        }}
                                                    />
                                                </div>
                                            </div>

                                            {/* Feature uses — inline below HP */}
                                            {hasFeatures && (
                                                <div className="flex gap-2 flex-wrap mt-1.5">
                                                    {Object.entries(entity.featureUses!).map(([name, remaining]) => (
                                                        <span
                                                            key={name}
                                                            className={`font-sans text-[8px] tracking-wide uppercase ${
                                                                remaining > 0 ? 'text-brass/80' : 'text-ghost/30'
                                                            }`}
                                                        >
                                                            {name.replace(/_/g, ' ')} {remaining}
                                                        </span>
                                                    ))}
                                                </div>
                                            )}

                                            {/* Active conditions */}
                                            {entity.activeConditions && entity.activeConditions.length > 0 && (
                                                <div className="flex gap-1.5 flex-wrap mt-1">
                                                    {entity.activeConditions.map((c, i) => (
                                                        <span
                                                            key={`${c.name}-${i}`}
                                                            className="font-sans text-[8px] tracking-wide uppercase text-amber-400/80 bg-amber-400/10 px-1.5 py-0.5 rounded"
                                                        >
                                                            {c.name}{c.duration != null ? ` (${c.duration}r)` : ''}
                                                        </span>
                                                    ))}
                                                </div>
                                            )}

                                            {isDefeated && (
                                                <span className="font-sans text-[9px] tracking-[0.2em] uppercase text-destructive mt-1 block">
                                                    {entity.status}
                                                </span>
                                            )}
                                        </div>
                                    </CollapsibleTrigger>

                                    {/* Expandable character sheet panel */}
                                    <CollapsibleContent>
                                        <div className="mt-3 pt-3 border-t border-ghost/10 space-y-3">
                                            {/* Ability Scores */}
                                            {entity.abilityScores && (
                                                <div>
                                                    <span className="font-sans text-[8px] tracking-[0.3em] uppercase text-ghost/50 block mb-1">Abilities</span>
                                                    <div className="grid grid-cols-6 gap-1">
                                                        {(['str', 'dex', 'con', 'int', 'wis', 'cha'] as const).map(ab => (
                                                            <div key={ab} className="text-center">
                                                                <span className="font-sans text-[8px] tracking-wider uppercase text-ghost/40 block">
                                                                    {ab}
                                                                </span>
                                                                <span className="font-sans text-[11px] text-foreground block leading-tight">
                                                                    {entity.abilityScores![ab]}
                                                                </span>
                                                                <span className="font-sans text-[9px] text-ghost/60">
                                                                    {abilityMod(entity.abilityScores![ab])}
                                                                </span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}

                                            {/* Weapons */}
                                            {entity.weapons && entity.weapons.length > 0 && (
                                                <div>
                                                    <span className="font-sans text-[8px] tracking-[0.3em] uppercase text-ghost/50 block mb-1">Weapons</span>
                                                    {entity.weapons.map((w, i) => (
                                                        <div key={i} className="flex justify-between items-baseline">
                                                            <span className="font-sans text-[10px] text-foreground">{w.name}</span>
                                                            <span className="font-sans text-[9px] text-ghost/60">
                                                                +{w.attackBonus} / {w.damageFormula} {w.damageType}
                                                            </span>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}

                                            {/* Spells with slot tracking */}
                                            {hasSpells && (
                                                <div>
                                                    <div className="flex items-baseline justify-between mb-1">
                                                        <span className="font-sans text-[8px] tracking-[0.3em] uppercase text-ghost/50">Spells</span>
                                                        {entity.spellSaveDC && (
                                                            <span className="font-sans text-[8px] text-ghost/40">
                                                                DC {entity.spellSaveDC}
                                                                {entity.spellAttackBonus != null && ` / +${entity.spellAttackBonus}`}
                                                            </span>
                                                        )}
                                                    </div>
                                                    {/* Group spells by level */}
                                                    {Array.from(
                                                        entity.spells!.reduce((acc, spell) => {
                                                            const lvl = spell.level;
                                                            if (!acc.has(lvl)) acc.set(lvl, []);
                                                            acc.get(lvl)!.push(spell);
                                                            return acc;
                                                        }, new Map<number, typeof entity.spells>())
                                                    )
                                                        .sort(([a], [b]) => a - b)
                                                        .map(([level, spells]) => {
                                                            const slotCount = level > 0 ? entity.spellSlots[String(level)] ?? 0 : null;
                                                            return (
                                                                <div key={level} className="mb-1.5">
                                                                    <div className="flex items-baseline gap-1.5">
                                                                        <span className="font-sans text-[8px] tracking-wider uppercase text-ghost/40">
                                                                            {level === 0 ? 'Cantrips' : ordinal(level)}
                                                                        </span>
                                                                        {slotCount !== null && (
                                                                            <span className="font-sans text-[9px]">
                                                                                {slotCount > 0 ? (
                                                                                    <span className="text-brass">{'●'.repeat(slotCount)}</span>
                                                                                ) : (
                                                                                    <span className="text-ghost/30">{'○'.repeat(entity.spellSlots[String(level)] ?? 1)}</span>
                                                                                )}
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                    <div className="flex flex-wrap gap-x-2 gap-y-0.5 ml-1">
                                                                        {spells!.map((spell, si) => (
                                                                            <span
                                                                                key={si}
                                                                                className={`font-sans text-[9px] ${
                                                                                    level > 0 && (entity.spellSlots[String(level)] ?? 0) === 0
                                                                                        ? 'text-ghost/30'
                                                                                        : 'text-foreground/80'
                                                                                }`}
                                                                                title={spell.description || spell.name}
                                                                            >
                                                                                {spell.name}
                                                                                {spell.requiresConcentration && <span className="text-amber-400/60 ml-0.5">C</span>}
                                                                            </span>
                                                                        ))}
                                                                    </div>
                                                                </div>
                                                            );
                                                        })}
                                                </div>
                                            )}
                                        </div>
                                    </CollapsibleContent>
                                </div>
                            </Collapsible>
                        );
                    })}
                </div>

                {/* Combat guidance */}
                <div className="mt-8 px-6 py-4 space-y-2">
                    <p className="font-sans text-[9px] tracking-[0.2em] uppercase text-ghost text-center">Chat-Driven Combat</p>
                    <p className="font-serif text-sm italic text-ghost/60 text-center">
                        Declare your intent in the chronicle
                    </p>
                </div>

                {/* Battle Feed */}
                {combatState.log.length > 0 && (
                    <div className="mt-4 mx-6 mb-6 pt-4">
                        <span className="font-sans text-[9px] tracking-[0.3em] uppercase text-ghost block mb-3">Battle Feed</span>
                        <ul className="space-y-2">
                            {combatState.log.slice(-5).reverse().map(l => (
                                <li key={l.id} className="font-serif text-xs text-ghost/60 break-words">
                                    {l.description}
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
            </ScrollArea>
        </aside>
    );
}
