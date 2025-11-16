import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Loader2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';

interface CharacterGeneratorDialogProps {
  sessionId: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export default function CharacterGeneratorDialog({
  sessionId,
  open,
  onOpenChange,
  onSuccess,
}: CharacterGeneratorDialogProps) {
  const [formData, setFormData] = useState({
    className: '',
    race: '',
    background: '',
    level: 1,
  });

  const generateMutation = trpc.characters.generate.useMutation({
    onSuccess: (data) => {
      toast.success(`Character "${data.name}" generated successfully!`);
      resetForm();
      onOpenChange(false);
      onSuccess();
    },
    onError: (error) => {
      toast.error('Failed to generate character: ' + error.message);
    },
  });

  const resetForm = () => {
    setFormData({
      className: '',
      race: '',
      background: '',
      level: 1,
    });
  };

  const handleSubmit = () => {
    if (!sessionId) {
      toast.error('Please select a campaign first');
      return;
    }

    generateMutation.mutate({
      sessionId,
      className: formData.className.trim() || undefined,
      race: formData.race.trim() || undefined,
      background: formData.background.trim() || undefined,
      level: formData.level,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            AI Character Generator
          </DialogTitle>
          <DialogDescription>
            Let AI create a D&D 5e character for you! Leave fields blank for random choices.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-4">
          {/* Class */}
          <div className="space-y-2">
            <Label htmlFor="className">Class (optional)</Label>
            <Input
              id="className"
              value={formData.className}
              onChange={(e) => setFormData({ ...formData, className: e.target.value })}
              placeholder="e.g., Fighter, Wizard, Rogue..."
              disabled={generateMutation.isPending}
            />
          </div>

          {/* Race */}
          <div className="space-y-2">
            <Label htmlFor="race">Race (optional)</Label>
            <Input
              id="race"
              value={formData.race}
              onChange={(e) => setFormData({ ...formData, race: e.target.value })}
              placeholder="e.g., Human, Elf, Dwarf..."
              disabled={generateMutation.isPending}
            />
          </div>

          {/* Background */}
          <div className="space-y-2">
            <Label htmlFor="background">Background (optional)</Label>
            <Input
              id="background"
              value={formData.background}
              onChange={(e) => setFormData({ ...formData, background: e.target.value })}
              placeholder="e.g., Soldier, Sage, Criminal..."
              disabled={generateMutation.isPending}
            />
          </div>

          {/* Level */}
          <div className="space-y-2">
            <Label htmlFor="level">Level</Label>
            <Input
              id="level"
              type="number"
              min="1"
              max="20"
              value={formData.level}
              onChange={(e) => setFormData({ ...formData, level: parseInt(e.target.value) || 1 })}
              disabled={generateMutation.isPending}
            />
          </div>

          <Button 
            onClick={handleSubmit} 
            disabled={generateMutation.isPending} 
            className="w-full"
          >
            {generateMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Generating Character...
              </>
            ) : (
              <>
                <Sparkles className="mr-2 h-4 w-4" />
                Generate Character
              </>
            )}
          </Button>

          <p className="text-xs text-muted-foreground text-center">
            AI will create a rules-compliant D&D 5e character with appropriate stats, equipment, and personality.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
