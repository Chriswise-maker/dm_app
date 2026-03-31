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
import { trpc } from '@/lib/trpc';
import { toast } from 'sonner';
import { DiceRoller } from './DiceRoller';

interface CombatSidebarProps {
    sessionId: number;
}

export default function CombatSidebar({ sessionId }: CombatSidebarProps) {
    const utils = trpc.useUtils();

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

            <ScrollArea className="flex-1 min-h-0 overflow-hidden">
                <div className="space-y-6 px-6 py-4">
                    {sortedEntities.map((entity) => {
                        const isTurnById = combatState.turnOrder[combatState.turnIndex] === entity.id;
                        const isDefeated = entity.status === 'DEAD' || entity.status === 'UNCONSCIOUS';
                        const isPlayer = entity.type === 'player';
                        const isEnemy = entity.type !== 'player';
                        const isRolling = combatState.pendingRoll?.entityName === entity.name;

                        return (
                            <div
                                key={entity.id}
                                className={`relative transition-all ${isDefeated ? 'opacity-30' : ''} ${isRolling ? 'animate-pulse' : ''}`}
                            >
                                {/* Active turn indicator — brass left border */}
                                {isTurnById && (
                                    <div className="absolute left-0 top-0 bottom-0 w-[1px] bg-brass -ml-3" />
                                )}

                                <div className="flex justify-between items-baseline">
                                    <span className={`font-serif tracking-tight ${isDefeated ? 'line-through' : ''} ${
                                        isTurnById
                                            ? 'text-2xl text-brass font-bold'
                                            : isEnemy
                                                ? 'text-lg text-destructive'
                                                : 'text-lg text-foreground'
                                    }`}>
                                        {entity.name}
                                    </span>
                                    <span className={`font-sans text-[11px] ${isTurnById ? 'text-brass font-bold' : 'text-ghost'}`}>
                                        {String(entity.initiative).padStart(2, '0')}
                                    </span>
                                </div>

                                {isTurnById && (
                                    <span className="font-sans text-[9px] tracking-[0.2em] text-brass/60 uppercase">Acting Now</span>
                                )}

                                {/* HP display for entities */}
                                <div className="flex items-baseline gap-1 mt-1">
                                    <span className={`font-sans text-[9px] tracking-[0.2em] uppercase text-ghost`}>
                                        {entity.hp}/{entity.maxHp}
                                    </span>
                                    <span className="font-sans text-[8px] text-ghost/40">HP</span>
                                    <span className="font-sans text-[8px] text-ghost/40 ml-2">AC {entity.baseAC}</span>
                                </div>

                                {isDefeated && (
                                    <span className="font-sans text-[9px] tracking-[0.2em] uppercase text-destructive mt-1 block">
                                        {entity.status}
                                    </span>
                                )}
                            </div>
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
