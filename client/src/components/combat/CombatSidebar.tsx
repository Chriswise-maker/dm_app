import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Sword, X, ChevronRight, RefreshCw, Undo, Skull } from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { toast } from 'sonner';

interface CombatSidebarProps {
    sessionId: number;
}

export default function CombatSidebar({ sessionId }: CombatSidebarProps) {
    const utils = trpc.useUtils();

    // Poll combat state from V2 engine
    const { data: combatState, isLoading } = trpc.combatV2.getState.useQuery(
        { sessionId },
        {
            refetchInterval: 2000,
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
    // Show during ACTIVE and AWAIT_DAMAGE_ROLL phases
    if (!combatState || combatState.phase === 'IDLE' || combatState.phase === 'RESOLVED') return null;

    const handleEndCombat = () => {
        if (confirm('Are you sure you want to end combat?')) {
            endCombatMutation.mutate({ sessionId });
        }
    };

    const handleUndo = () => {
        undoMutation.mutate({ sessionId });
    };

    // V2 engine already sorts by turn order in 'entities', but 'turnOrder' array has the IDs in order
    // Accessing entities via map or find is inefficient if list is small, so let's just use the array 
    // provided `entities` are not sorted? 
    // The router returns `entities` mapped from state.entities (which are usually sorted by init).
    // Let's rely on the router's `entities` list but sort by initiative just in case, or use turnOrder if strict.
    // Actually, V2 logs show turnOrder.

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
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={handleEndCombat}
                        className="text-xs h-8"
                    >
                        End
                    </Button>
                </div>
            </div>

            <ScrollArea className="flex-1 p-4">
                <div className="space-y-3">
                    {sortedEntities.map((entity, idx) => {
                        const isTurn = combatState.currentTurnEntity === entity.name;
                        const isDefeated = entity.status === 'DEAD' || entity.status === 'UNCONSCIOUS';
                        const isPlayer = entity.type === 'player';

                        return (
                            <div
                                key={entity.id}
                                className={`
                                    p-3 rounded-lg border-2 transition-colors
                                    ${isTurn ? 'border-primary bg-primary/5' : 'border-border'}
                                    ${isDefeated ? 'opacity-50' : ''}
                                `}
                            >
                                <div className="flex items-start justify-between gap-2">
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                            {isTurn && <ChevronRight className="h-4 w-4 text-primary flex-shrink-0" />}
                                            <p className={`font-medium text-sm truncate ${isDefeated ? 'line-through' : ''}`}>
                                                {entity.name}
                                            </p>
                                        </div>
                                        <p className="text-xs text-muted-foreground mt-1">
                                            Init: {entity.initiative} | AC: {entity.baseAC}
                                        </p>
                                    </div>
                                    <div className="flex flex-col items-end">
                                        <span className={`text-sm font-mono font-bold ${entity.hp <= 0 ? 'text-destructive' : ''}`}>
                                            {entity.hp}/{entity.maxHp}
                                        </span>
                                        <span className="text-[10px] text-muted-foreground">HP</span>
                                    </div>
                                </div>
                                {isDefeated && (
                                    <div className="mt-2 flex items-center gap-1 text-xs text-destructive font-semibold">
                                        <Skull className="h-3 w-3" />
                                        {entity.status}
                                    </div>
                                )}
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
