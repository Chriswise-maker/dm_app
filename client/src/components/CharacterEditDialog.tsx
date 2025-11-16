import { useState, useEffect } from 'react';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface Character {
  id: number;
  name: string;
  className: string;
  level: number;
  hpMax: number;
  hpCurrent: number;
  ac: number;
  stats: {
    str: number;
    dex: number;
    con: number;
    int: number;
    wis: number;
    cha: number;
  };
  inventory: string[];
  notes: string | null;
}

interface CharacterEditDialogProps {
  character: Character | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export default function CharacterEditDialog({
  character,
  open,
  onOpenChange,
  onSuccess,
}: CharacterEditDialogProps) {
  const [formData, setFormData] = useState({
    name: '',
    className: '',
    level: 1,
    hpMax: 10,
    hpCurrent: 10,
    ac: 10,
    stats: {
      str: 10,
      dex: 10,
      con: 10,
      int: 10,
      wis: 10,
      cha: 10,
    },
    inventory: '',
    notes: '',
  });

  useEffect(() => {
    if (character) {
      setFormData({
        name: character.name,
        className: character.className,
        level: character.level,
        hpMax: character.hpMax,
        hpCurrent: character.hpCurrent,
        ac: character.ac,
        stats: character.stats,
        inventory: character.inventory.join(', '),
        notes: character.notes || '',
      });
    }
  }, [character]);

  const updateMutation = trpc.characters.update.useMutation({
    onSuccess: () => {
      toast.success('Character updated!');
      onOpenChange(false);
      onSuccess();
    },
    onError: (error) => {
      toast.error('Failed to update character: ' + error.message);
    },
  });

  const handleSubmit = () => {
    if (!character) return;

    if (!formData.name.trim() || !formData.className.trim()) {
      toast.error('Please fill in name and class');
      return;
    }

    const inventoryArray = formData.inventory
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0);

    updateMutation.mutate({
      characterId: character.id,
      data: {
        name: formData.name.trim(),
        className: formData.className.trim(),
        level: formData.level,
        hpMax: formData.hpMax,
        ac: formData.ac,
        stats: formData.stats,
        inventory: inventoryArray,
        notes: formData.notes.trim() || undefined,
      },
    });
  };

  const updateStat = (stat: keyof typeof formData.stats, value: number) => {
    setFormData((prev) => ({
      ...prev,
      stats: { ...prev.stats, [stat]: Math.max(1, Math.min(30, value)) },
    }));
  };

  if (!character) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Character</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-4">
          {/* Basic Info */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="name">Character Name *</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="Enter character name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="className">Class *</Label>
              <Input
                id="className"
                value={formData.className}
                onChange={(e) => setFormData({ ...formData, className: e.target.value })}
                placeholder="e.g., Fighter, Wizard"
              />
            </div>
          </div>

          {/* Level and Combat Stats */}
          <div className="grid grid-cols-4 gap-4">
            <div className="space-y-2">
              <Label htmlFor="level">Level</Label>
              <Input
                id="level"
                type="number"
                min="1"
                value={formData.level}
                onChange={(e) => setFormData({ ...formData, level: parseInt(e.target.value) || 1 })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="hpMax">Max HP</Label>
              <Input
                id="hpMax"
                type="number"
                min="1"
                value={formData.hpMax}
                onChange={(e) => {
                  const val = parseInt(e.target.value) || 1;
                  setFormData({ ...formData, hpMax: val });
                }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="hpCurrent">Current HP</Label>
              <Input
                id="hpCurrent"
                type="number"
                min="0"
                max={formData.hpMax}
                value={formData.hpCurrent}
                onChange={(e) =>
                  setFormData({ ...formData, hpCurrent: parseInt(e.target.value) || 0 })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ac">AC</Label>
              <Input
                id="ac"
                type="number"
                min="0"
                value={formData.ac}
                onChange={(e) => setFormData({ ...formData, ac: parseInt(e.target.value) || 0 })}
              />
            </div>
          </div>

          {/* Ability Scores */}
          <div>
            <Label className="mb-2 block">Ability Scores</Label>
            <div className="grid grid-cols-6 gap-3">
              {(['str', 'dex', 'con', 'int', 'wis', 'cha'] as const).map((stat) => (
                <div key={stat} className="space-y-1">
                  <Label htmlFor={stat} className="text-xs uppercase">
                    {stat}
                  </Label>
                  <Input
                    id={stat}
                    type="number"
                    min="1"
                    max="30"
                    value={formData.stats[stat]}
                    onChange={(e) => updateStat(stat, parseInt(e.target.value) || 10)}
                    className="text-center"
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Inventory */}
          <div className="space-y-2">
            <Label htmlFor="inventory">Inventory (comma-separated)</Label>
            <Input
              id="inventory"
              value={formData.inventory}
              onChange={(e) => setFormData({ ...formData, inventory: e.target.value })}
              placeholder="Longsword, Shield, Potion of Healing"
            />
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              placeholder="Character background, personality traits, etc."
              rows={3}
            />
          </div>

          <Button onClick={handleSubmit} disabled={updateMutation.isPending} className="w-full">
            {updateMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Update Character
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
