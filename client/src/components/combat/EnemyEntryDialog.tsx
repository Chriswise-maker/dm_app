import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Plus, Trash2 } from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { toast } from 'sonner';

interface Enemy {
    name: string;
    ac: number;
    hpMax: number;
    attackBonus: number;
    damageFormula: string;
    damageType: string;
    initiative: number;
}

interface EnemyEntryDialogProps {
    open: boolean;
    onClose: () => void;
    sessionId: number;
    onEnemiesAdded: () => void;
}

export default function EnemyEntryDialog({ open, onClose, sessionId, onEnemiesAdded }: EnemyEntryDialogProps) {
    const [enemies, setEnemies] = useState<Enemy[]>([
        {
            name: 'Goblin 1',
            ac: 15,
            hpMax: 7,
            attackBonus: 4,
            damageFormula: '1d6+2',
            damageType: 'slashing',
            initiative: 0,
        },
    ]);

    const addEnemyMutation = trpc.combat.addEnemy.useMutation();

    const addEnemy = () => {
        setEnemies([
            ...enemies,
            {
                name: `Enemy ${enemies.length + 1}`,
                ac: 13,
                hpMax: 10,
                attackBonus: 3,
                damageFormula: '1d6+1',
                damageType: 'slashing',
                initiative: 0,
            },
        ]);
    };

    const removeEnemy = (index: number) => {
        setEnemies(enemies.filter((_, i) => i !== index));
    };

    const updateEnemy = (index: number, field: keyof Enemy, value: string | number) => {
        const updated = [...enemies];
        updated[index] = { ...updated[index], [field]: value };
        setEnemies(updated);
    };

    const rollInitiative = (index: number) => {
        const roll = Math.floor(Math.random() * 20) + 1;
        updateEnemy(index, 'initiative', roll);
    };

    const rollAllInitiatives = () => {
        const updated = enemies.map(enemy => ({
            ...enemy,
            initiative: Math.floor(Math.random() * 20) + 1,
        }));
        setEnemies(updated);
    };

    const handleSubmit = async () => {
        if (enemies.length === 0) {
            toast.error('Add at least one enemy');
            return;
        }

        // Validate enemies
        for (const enemy of enemies) {
            if (!enemy.name.trim()) {
                toast.error('All enemies must have names');
                return;
            }
            if (enemy.initiative === 0) {
                toast.error('Roll initiative for all enemies first');
                return;
            }
        }

        try {
            // Add all enemies to combat
            for (const enemy of enemies) {
                await addEnemyMutation.mutateAsync({
                    sessionId,
                    name: enemy.name,
                    ac: enemy.ac,
                    hpMax: enemy.hpMax,
                    attackBonus: enemy.attackBonus,
                    damageFormula: enemy.damageFormula,
                    damageType: enemy.damageType,
                    initiative: enemy.initiative,
                });
            }

            toast.success(`Added ${enemies.length} ${enemies.length === 1 ? 'enemy' : 'enemies'} to combat`);
            onEnemiesAdded();
            onClose();

            // Reset form
            setEnemies([
                {
                    name: 'Goblin 1',
                    ac: 15,
                    hpMax: 7,
                    attackBonus: 4,
                    damageFormula: '1d6+2',
                    damageType: 'slashing',
                    initiative: 0,
                },
            ]);
        } catch (error: any) {
            toast.error('Failed to add enemies: ' + error.message);
        }
    };

    return (
        <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
            <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Add Enemies to Combat</DialogTitle>
                    <DialogDescription>
                        Enter enemy stats. Initiative will be rolled automatically or manually.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                    <div className="flex gap-2">
                        <Button onClick={addEnemy} variant="outline" size="sm">
                            <Plus className="h-4 w-4 mr-2" />
                            Add Enemy
                        </Button>
                        <Button onClick={rollAllInitiatives} variant="outline" size="sm">
                            Roll All Initiatives
                        </Button>
                    </div>

                    {enemies.map((enemy, index) => (
                        <div key={index} className="border rounded-lg p-4 space-y-3">
                            <div className="flex items-center justify-between mb-2">
                                <h4 className="font-semibold">Enemy {index + 1}</h4>
                                {enemies.length > 1 && (
                                    <Button
                                        onClick={() => removeEnemy(index)}
                                        variant="ghost"
                                        size="icon"
                                        className="h-6 w-6"
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                )}
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div className="col-span-2">
                                    <Label htmlFor={`name-${index}`}>Name</Label>
                                    <Input
                                        id={`name-${index}`}
                                        value={enemy.name}
                                        onChange={(e) => updateEnemy(index, 'name', e.target.value)}
                                        placeholder="Goblin Archer"
                                    />
                                </div>

                                <div>
                                    <Label htmlFor={`ac-${index}`}>AC</Label>
                                    <Input
                                        id={`ac-${index}`}
                                        type="number"
                                        value={enemy.ac}
                                        onChange={(e) => updateEnemy(index, 'ac', parseInt(e.target.value) || 0)}
                                    />
                                </div>

                                <div>
                                    <Label htmlFor={`hp-${index}`}>HP (Max)</Label>
                                    <Input
                                        id={`hp-${index}`}
                                        type="number"
                                        value={enemy.hpMax}
                                        onChange={(e) => updateEnemy(index, 'hpMax', parseInt(e.target.value) || 1)}
                                    />
                                </div>

                                <div>
                                    <Label htmlFor={`attack-${index}`}>Attack Bonus</Label>
                                    <Input
                                        id={`attack-${index}`}
                                        type="number"
                                        value={enemy.attackBonus}
                                        onChange={(e) => updateEnemy(index, 'attackBonus', parseInt(e.target.value) || 0)}
                                        placeholder="+4"
                                    />
                                </div>

                                <div>
                                    <Label htmlFor={`damage-${index}`}>Damage Formula</Label>
                                    <Input
                                        id={`damage-${index}`}
                                        value={enemy.damageFormula}
                                        onChange={(e) => updateEnemy(index, 'damageFormula', e.target.value)}
                                        placeholder="1d6+2"
                                    />
                                </div>

                                <div>
                                    <Label htmlFor={`damage-type-${index}`}>Damage Type</Label>
                                    <Input
                                        id={`damage-type-${index}`}
                                        value={enemy.damageType}
                                        onChange={(e) => updateEnemy(index, 'damageType', e.target.value)}
                                        placeholder="slashing"
                                    />
                                </div>

                                <div className="flex items-end gap-2">
                                    <div className="flex-1">
                                        <Label htmlFor={`initiative-${index}`}>Initiative</Label>
                                        <Input
                                            id={`initiative-${index}`}
                                            type="number"
                                            value={enemy.initiative || ''}
                                            onChange={(e) => updateEnemy(index, 'initiative', parseInt(e.target.value) || 0)}
                                            placeholder="0"
                                        />
                                    </div>
                                    <Button
                                        onClick={() => rollInitiative(index)}
                                        variant="outline"
                                        size="sm"
                                    >
                                        Roll d20
                                    </Button>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={onClose}>
                        Cancel
                    </Button>
                    <Button onClick={handleSubmit} disabled={addEnemyMutation.isPending}>
                        {addEnemyMutation.isPending ? 'Adding...' : `Add ${enemies.length} ${enemies.length === 1 ? 'Enemy' : 'Enemies'}`}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
