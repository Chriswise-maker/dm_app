import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sword, X, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { toast } from 'sonner';

interface Combatant {
    id: number;
    name: string;
    type: string;
    initiative: number;
    ac: number;
    hpCurrent: number;
    hpMax: number;
}

interface CombatState {
    inCombat: boolean;
    round: number;
    currentTurnIndex: number;
    combatants: Combatant[];
}

interface CombatSidebarProps {
    combatState: CombatState;
    sessionId: number;
    refetchCombatState: () => void;
}

export default function CombatSidebar({ combatState, sessionId, refetchCombatState }: CombatSidebarProps) {
    const [editingHP, setEditingHP] = useState<Record<number, string>>({});

    const endCombatMutation = trpc.combat.end.useMutation({
        onSuccess: () => {
            toast.success('Combat ended');
            refetchCombatState();
        },
        onError: (error) => {
            toast.error(`Failed to end combat: ${error.message}`);
        },
    });

    const removeCombatantMutation = trpc.combat.removeCombatant.useMutation({
        onSuccess: () => {
            toast.success('Enemy removed');
            refetchCombatState();
        },
        onError: (error) => {
            toast.error(`Failed to remove enemy: ${error.message}`);
        },
    });

    const updateHPMutation = trpc.combat.updateCombatantHP.useMutation({
        onSuccess: () => {
            refetchCombatState();
        },
        onError: (error: any) => {
            toast.error(`Failed to update HP: ${error.message}`);
        },
    });

    if (!combatState || !combatState.inCombat) return null;

    const sortedCombatants = [...combatState.combatants].sort((a, b) => b.initiative - a.initiative);

    const handleEndCombat = () => {
        endCombatMutation.mutate({ sessionId });
    };

    const handleRemoveCombatant = (combatantId: number, name: string) => {
        removeCombatantMutation.mutate({ combatantId });
    };

    const handleHPChange = (combatantId: number, value: string) => {
        const updated = { ...editingHP };
        updated[combatantId] = value;
        setEditingHP(updated);
    };

    const handleHPBlur = (combatant: Combatant) => {
        const newHPStr = editingHP[combatant.id];
        if (newHPStr !== undefined && newHPStr !== null) {
            const newHP = Math.max(0, Math.min(combatant.hpMax, parseInt(newHPStr) || 0));
            updateHPMutation.mutate({ combatantId: combatant.id, newHP });
            // Remove the editing state for this combatant
            const updated = { ...editingHP };
            delete updated[combatant.id];
            setEditingHP(updated);
        }
    };

    return (
        <aside className="w-80 border-l bg-card flex flex-col h-full">
            <div className="p-4 border-b flex items-center gap-2 justify-between bg-destructive/10">
                <div className="flex items-center gap-2">
                    <Sword className="h-5 w-5 text-destructive" />
                    <h3 className="font-semibold text-destructive">Combat - Round {combatState.round}</h3>
                </div>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={handleEndCombat}
                    className="text-xs"
                >
                    End Combat
                </Button>
            </div>

            <ScrollArea className="flex-1 p-4">
                <div className="space-y-3">
                    {sortedCombatants.map((combatant, idx) => {
                        const isActive = idx === combatState.currentTurnIndex;
                        const isDefeated = combatant.hpCurrent <= 0;
                        const isPlayer = combatant.type === 'player';

                        return (
                            <div
                                key={combatant.id}
                                className={`
                                    p-3 rounded-lg border-2 transition-colors
                                    ${isActive ? 'border-primary bg-primary/5' : 'border-border'}
                                    ${isDefeated ? 'opacity-50' : ''}
                                `}
                            >
                                <div className="flex items-start justify-between gap-2">
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                            {isActive && <ChevronRight className="h-4 w-4 text-primary flex-shrink-0" />}
                                            <p className={`font-medium text-sm truncate ${isDefeated ? 'line-through' : ''}`}>
                                                {combatant.name}
                                            </p>
                                        </div>
                                        <p className="text-xs text-muted-foreground mt-1">
                                            Init: {combatant.initiative} | AC: {combatant.ac}
                                        </p>
                                    </div>
                                    {!isPlayer && (
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-6 w-6 flex-shrink-0"
                                            onClick={() => handleRemoveCombatant(combatant.id, combatant.name)}
                                        >
                                            <X className="h-4 w-4" />
                                        </Button>
                                    )}
                                </div>

                                <div className="mt-2 flex items-center gap-2">
                                    <span className="text-xs text-muted-foreground">HP:</span>
                                    {isPlayer ? (
                                        // Players: Read-only (managed via character sheet)
                                        <span className={`text-sm font-mono ${isDefeated ? 'text-destructive' : ''}`}>
                                            {combatant.hpCurrent}/{combatant.hpMax}
                                        </span>
                                    ) : (
                                        // Enemies: Editable
                                        <div className="flex items-center gap-1">
                                            <Input
                                                type="number"
                                                min="0"
                                                max={combatant.hpMax}
                                                value={editingHP[combatant.id] ?? combatant.hpCurrent}
                                                onChange={(e) => handleHPChange(combatant.id, e.target.value)}
                                                onBlur={() => handleHPBlur(combatant)}
                                                className={`
                                                    h-7 w-14 text-xs font-mono text-center
                                                    ${isDefeated ? 'text-destructive border-destructive' : ''}
                                                `}
                                            />
                                            <span className="text-xs text-muted-foreground">/ {combatant.hpMax}</span>
                                        </div>
                                    )}
                                </div>

                                {isDefeated && (
                                    <p className="text-xs text-destructive mt-1 font-semibold">DEFEATED</p>
                                )}
                            </div>
                        );
                    })}
                </div>

                <div className="mt-6 text-xs text-muted-foreground text-center space-y-1 pb-4">
                    <p>Manually update enemy HP as combat progresses.</p>
                    <p>Player HP is managed via character sheet.</p>
                </div>
            </ScrollArea>
        </aside>
    );
}
