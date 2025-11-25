import { Card } from '@/components/ui/card';
import { Sword, Shield } from 'lucide-react';

interface Combatant {
    id: number;
    name: string;
    type: string; // Changed from 'player' | 'enemy' to string for compatibility
    initiative: number;
    ac: number;
    hpCurrent: number;
    hpMax: number;
}

interface InitiativeDisplayProps {
    round: number;
    combatants: Combatant[];
    currentTurnIndex: number;
}

export default function InitiativeDisplay({ round, combatants, currentTurnIndex }: InitiativeDisplayProps) {
    if (combatants.length === 0) {
        return null;
    }

    return (
        <Card className="p-4 mb-4 bg-destructive/5 border-destructive/20">
            <div className="font-mono text-center">
                <div className="border-b border-destructive/20 pb-2 mb-3">
                    <div className="flex items-center justify-center gap-2">
                        <Sword className="h-4 w-4 text-destructive" />
                        <span className="text-sm font-bold tracking-wide">COMBAT - ROUND {round}</span>
                        <Sword className="h-4 w-4 text-destructive" />
                    </div>
                </div>

                <div className="space-y-1.5">
                    {combatants.map((combatant, index) => {
                        const isCurrent = index === currentTurnIndex;
                        const isPlayer = combatant.type === 'player';
                        const hpPercentage = (combatant.hpCurrent / combatant.hpMax) * 100;
                        const isBloodied = hpPercentage <= 50 && hpPercentage > 0;
                        const isDead = combatant.hpCurrent <= 0;

                        return (
                            <div
                                key={combatant.id}
                                className={`
                  flex items-center gap-3 p-2 rounded-md text-sm
                  ${isCurrent ? 'bg-primary/10 border border-primary/30 font-semibold' : 'bg-background/50'}
                  ${isDead ? 'opacity-50 line-through' : ''}
                `}
                            >
                                <span className="w-6 text-muted-foreground">{index + 1}.</span>

                                <span className={`flex-1 text-left ${isPlayer ? 'text-primary' : 'text-destructive'}`}>
                                    {combatant.name}
                                    {isCurrent && <span className="ml-2 text-xs">← Current Turn</span>}
                                </span>

                                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                    <span className="flex items-center gap-1">
                                        <Shield className="h-3 w-3" />
                                        {combatant.initiative}
                                    </span>
                                    <span className={`
                    ${isBloodied ? 'text-destructive font-semibold' : ''}
                    ${isDead ? 'text-muted-foreground' : ''}
                  `}>
                                        HP: {combatant.hpCurrent}/{combatant.hpMax}
                                    </span>
                                </div>
                            </div>
                        );
                    })}
                </div>

                <div className="border-t border-destructive/20 mt-3 pt-2">
                    <span className="text-xs text-muted-foreground">═══════════════════</span>
                </div>
            </div>
        </Card>
    );
}
