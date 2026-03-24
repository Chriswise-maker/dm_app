import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, Minus, Plus, User, Edit2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useState } from 'react';

interface CharacterPanelProps {
  sessionId: number | null;
  selectedCharacterId: number | null;
  onCharacterSelect: (characterId: number) => void;
  onCreateCharacter: () => void;
  onEditCharacter: (characterId: number) => void;
}

export default function CharacterPanel({
  sessionId,
  selectedCharacterId,
  onCharacterSelect,
  onCreateCharacter,
  onEditCharacter,
}: CharacterPanelProps) {
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [characterToDelete, setCharacterToDelete] = useState<number | null>(null);

  const { data: characters, isLoading, refetch } = trpc.characters.list.useQuery(
    { sessionId: sessionId! },
    { enabled: !!sessionId, refetchInterval: 3000 }
  );

  const updateHPMutation = trpc.characters.updateHP.useMutation({
    onSuccess: () => {
      refetch();
    },
    onError: (error) => {
      toast.error('Failed to update HP: ' + error.message);
    },
  });

  const deleteMutation = trpc.characters.delete.useMutation({
    onSuccess: () => {
      toast.success('Character deleted');
      refetch();
      setDeleteDialogOpen(false);
      setCharacterToDelete(null);
    },
    onError: (error) => {
      toast.error('Failed to delete character: ' + error.message);
    },
  });

  const handleHPChange = (characterId: number, currentHP: number, maxHP: number, delta: number) => {
    const newHP = Math.max(0, Math.min(maxHP, currentHP + delta));
    updateHPMutation.mutate({ characterId, hpCurrent: newHP });
  };

  const handleDeleteClick = (characterId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setCharacterToDelete(characterId);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = () => {
    if (characterToDelete) {
      deleteMutation.mutate({ characterId: characterToDelete });
    }
  };

  if (!sessionId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Characters</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground text-center py-4">
            Select a campaign first
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">Characters</CardTitle>
          <Button size="sm" variant="outline" onClick={onCreateCharacter}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : characters && characters.length > 0 ? (
          characters.map((char) => (
            <div
              key={char.id}
              onClick={() => onCharacterSelect(char.id)}
              className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                selectedCharacterId === char.id
                  ? 'bg-primary/10 border-primary'
                  : 'hover:bg-accent border-border'
              }`}
            >
              <div className="flex items-start justify-between mb-2">
                <div>
                  <h3 className="font-semibold">{char.name}</h3>
                  <p className="text-sm text-muted-foreground">
                    {char.className} • Level {char.level}
                  </p>
                </div>
                <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 p-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      onEditCharacter(char.id);
                    }}
                    title="Edit character"
                  >
                    <Edit2 className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                    onClick={(e) => handleDeleteClick(char.id, e)}
                    title="Delete character"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>

              {/* HP Bar */}
              <div className="mb-2">
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="font-medium">HP</span>
                  <span className="text-muted-foreground">
                    {char.hpCurrent}/{char.hpMax}
                  </span>
                </div>
                <div className="h-2 bg-secondary rounded-full overflow-hidden">
                  <div
                    className="h-full bg-red-500 transition-all"
                    style={{ width: `${(char.hpCurrent / char.hpMax) * 100}%` }}
                  />
                </div>
                <div className="flex items-center gap-1 mt-2" onClick={(e) => e.stopPropagation()}>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 w-7 p-0"
                    onClick={() => handleHPChange(char.id, char.hpCurrent, char.hpMax, -1)}
                  >
                    <Minus className="h-3 w-3" />
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 w-7 p-0"
                    onClick={() => handleHPChange(char.id, char.hpCurrent, char.hpMax, 1)}
                  >
                    <Plus className="h-3 w-3" />
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 flex-1 text-xs"
                    onClick={() => handleHPChange(char.id, char.hpCurrent, char.hpMax, -5)}
                  >
                    -5
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 flex-1 text-xs"
                    onClick={() => handleHPChange(char.id, char.hpCurrent, char.hpMax, 5)}
                  >
                    +5
                  </Button>
                </div>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div className="text-center">
                  <div className="text-muted-foreground">AC</div>
                  <div className="font-semibold">{char.ac}</div>
                </div>
                <div className="text-center">
                  <div className="text-muted-foreground">STR</div>
                  <div className="font-semibold">{char.stats.str}</div>
                </div>
                <div className="text-center">
                  <div className="text-muted-foreground">DEX</div>
                  <div className="font-semibold">{char.stats.dex}</div>
                </div>
                <div className="text-center">
                  <div className="text-muted-foreground">CON</div>
                  <div className="font-semibold">{char.stats.con}</div>
                </div>
                <div className="text-center">
                  <div className="text-muted-foreground">INT</div>
                  <div className="font-semibold">{char.stats.int}</div>
                </div>
                <div className="text-center">
                  <div className="text-muted-foreground">WIS</div>
                  <div className="font-semibold">{char.stats.wis}</div>
                </div>
              </div>
            </div>
          ))
        ) : (
          <p className="text-sm text-muted-foreground text-center py-4">
            No characters yet
          </p>
        )}
      </CardContent>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Character?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete the character.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
