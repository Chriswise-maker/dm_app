import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
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
import { Sword, ChevronRight, Undo, Skull } from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { toast } from 'sonner';
import { DiceRoller } from './DiceRoller';

interface CombatSidebarProps {
    sessionId: number;
}

export default function CombatSidebar({ sessionId }: CombatSidebarProps) {
    const utils = trpc.useUtils();

    // Poll combat state from V2 engine — faster polling when awaiting a player roll
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

    if (isLoading) return null;
    // Hide sidebar when no combat or combat has ended
    if (!combatState || combatState.phase === 'IDLE' || combatState.phase === 'RESOLVED') return null;

    const handleEndCombat = () => {
        endCombatMutation.mutate({ sessionId });
    };

    const handleUndo = () => {
        undoMutation.mutate({ sessionId });
    };

    // Sort by initiative descending for display
    const sortedEntities = [...combatState.entities].sort((a, b) => b.initiative - a.initiative);

    return (
        <aside className="w-48 lg:w-64 border-l bg-card flex flex-col h-full flex-shrink-0 overflow-hidden">
            <div className="p-4 border-b flex items-center gap-2 justify-between bg-destructive/10">
                <div className="flex items-center gap-2">
                    <Sword className="h-5 w-5 text-destructive" />
                    <h3 className="font-semibold text-destructive">Combat V2 - R{combatState.round}</h3>
                </div>
                <div className="flex gap-1">
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={handleUndo}
                        title="Undo last action"
                        className="h-8 w-8"
                    >
                        <Undo className="h-4 w-4" />
                    </Button>

                    <AlertDialog>
                        <AlertDialogTrigger asChild>
                            <Button
                                variant="outline"
                                size="sm"
                                className="text-xs h-8"
                            >
                                End
                            </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                            <AlertDialogHeader>
                                <AlertDialogTitle>End Combat?</AlertDialogTitle>
                                <AlertDialogDescription>
                                    This will end the current combat session.
                                    Are you sure?
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

            {/* Visual dice roller — shown whenever the engine needs a player roll */}
            {combatState.pendingRoll && (
                <DiceRoller
                    pendingRoll={combatState.pendingRoll}
                    sessionId={sessionId}
                    onRollComplete={() => { refetch(); }}
                />
            )}

            <ScrollArea className="flex-1 p-4">
                <div className="space-y-3">
                    {sortedEntities.map((entity, idx) => {
                        const isTurn = combatState.currentTurnEntity === entity.name; // Note: currentTurnEntity in state might be name or ID? checking CombatState type would be good. 
                        // Actually engine uses ID for turn order, but state export might have resolved it? 
                        // In V2, `currentState.currentTurnEntity` isn't explicitly in BattleStateSchema. 
                        // Logic in `getState()` just returns state. 
                        // Wait, looking at `combat-types.ts` (not recently read), BattleState doesn't have `currentTurnEntity`.
                        // But `CombatSidebar.tsx` was using `combatState.currentTurnEntity === entity.name`.
                        // Using `combatState.turnOrder[combatState.turnIndex] === entity.id` is safer.
                        const isTurnById = combatState.turnOrder[combatState.turnIndex] === entity.id;

                        const isDefeated = entity.status === 'DEAD' || entity.status === 'UNCONSCIOUS';
                        const isPlayer = entity.type === 'player';
                        const hpPercent = (entity.hp / entity.maxHp) * 100;
                        const isRolling = combatState.pendingRoll?.entityName === entity.name;

                        return (
                            <div
                                key={entity.id}
                                className={`
                                    p-3 rounded-lg border-2 transition-colors relative overflow-hidden
                                    ${isTurnById ? 'border-primary bg-primary/5' : 'border-border'}
                                    ${isDefeated ? 'opacity-50' : ''}
                                    ${isRolling ? 'ring-2 ring-amber-500 ring-offset-1 ring-offset-background animate-pulse' : ''}
                                `}
                            >
                                <div className="relative z-10">
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2">
                                                {isTurnById && <ChevronRight className="h-4 w-4 text-primary flex-shrink-0" />}
                                                <p className={`font-medium text-sm truncate ${isDefeated ? 'line-through' : ''}`}>
                                                    {entity.name}
                                                </p>
                                            </div>
                                            <p className="text-xs text-muted-foreground mt-1">
                                                Init: {entity.initiative} | AC: {entity.baseAC}
                                            </p>
                                        </div>
                                        <div className="flex flex-col items-end">
                                            <span className={`text-sm font-mono font-bold ${entity.hp <= (entity.maxHp * 0.5) ? 'text-destructive' : ''}`}>
                                                {entity.hp}/{entity.maxHp}
                                            </span>
                                            <span className="text-[10px] text-muted-foreground">HP</span>
                                        </div>
                                    </div>

                                    <Progress value={hpPercent} className="h-1.5 mt-2" indicatorClassName={entity.hp <= (entity.maxHp * 0.5) ? 'bg-destructive' : 'bg-primary'} />

                                    {isDefeated && (
                                        <div className="mt-2 flex items-center gap-1 text-xs text-destructive font-semibold">
                                            <Skull className="h-3 w-3" />
                                            {entity.status}
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>

                <div className="mt-6 text-xs text-muted-foreground text-center space-y-1 pb-4 border-t pt-4">
                    <p className="font-semibold text-primary">Chat-Driven Combat</p>
                    <p>Type actions in the chat:</p>
                    <p className="italic">"I attack the goblin with my sword"</p>
                    <p className="italic">"I cast Fireball at the group"</p>
                </div>

                {combatState.log.length > 0 && (
                    <div className="mt-4 border rounded bg-muted/20 p-2">
                        <p className="text-xs font-semibold mb-2">Battle Feed</p>
                        <ul className="text-[10px] space-y-1 font-mono text-muted-foreground">
                            {combatState.log.slice(-5).reverse().map(l => (
                                <li key={l.id} className="truncate">
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
