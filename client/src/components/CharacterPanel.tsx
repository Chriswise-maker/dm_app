import { trpc } from '@/lib/trpc';
import { Loader2 } from 'lucide-react';
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
import CharacterSheet from './character-sheet/CharacterSheet';

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
      <div>
        <span className="font-sans text-[9px] tracking-[0.3em] uppercase text-ghost block mb-4">Characters</span>
        <p className="font-serif text-sm italic text-ghost/60">Select a campaign first</p>
      </div>
    );
  }

  const selectedCharacter = characters?.find((c) => c.id === selectedCharacterId);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <span className="font-sans text-[9px] tracking-[0.3em] uppercase text-ghost">Characters</span>
        <button
          onClick={onCreateCharacter}
          className="font-sans text-[9px] tracking-[0.2em] uppercase text-ghost hover:text-brass transition-colors"
        >
          New
        </button>
      </div>

      {/* Character list — compact cards */}
      <div className="space-y-1">
        {isLoading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="h-5 w-5 animate-spin text-ghost" />
          </div>
        ) : characters && characters.length > 0 ? (
          characters.map((char) => {
            const isSelected = selectedCharacterId === char.id;
            const hpPct = char.hpMax > 0 ? char.hpCurrent / char.hpMax : 0;

            return (
              <div
                key={char.id}
                onClick={() => onCharacterSelect(char.id)}
                className={`cursor-pointer transition-colors py-2 px-3 ${
                  isSelected
                    ? 'bg-surface-high/50'
                    : 'hover:bg-surface-high/30'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <span className={`font-serif text-sm tracking-tight ${
                      isSelected ? 'text-vellum' : 'text-foreground'
                    }`}>{char.name}</span>
                    <span className="font-sans text-[8px] tracking-[0.15em] uppercase text-ghost ml-2">
                      {char.className} {char.level}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {/* Mini HP indicator */}
                    <span className="font-sans text-[9px] text-ghost">
                      {char.hpCurrent}/{char.hpMax}
                    </span>
                    <div className="w-8 h-1 rounded-full bg-ghost/10 overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${Math.min(100, hpPct * 100)}%`,
                          backgroundColor: hpPct > 0.5 ? 'hsl(100, 60%, 40%)' : hpPct > 0.25 ? 'hsl(45, 70%, 40%)' : 'hsl(0, 80%, 40%)',
                        }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        ) : (
          <p className="font-serif text-sm italic text-ghost/60">No characters yet</p>
        )}
      </div>

      {/* Selected character — full sheet */}
      {selectedCharacter && (
        <div className="mt-4 pt-4 border-t border-ghost/10">
          {/* Edit / Delete controls */}
          <div className="flex items-center justify-end gap-2 mb-3" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => onEditCharacter(selectedCharacter.id)}
              className="font-sans text-[8px] tracking-[0.2em] uppercase text-ghost hover:text-vellum transition-colors"
            >
              Edit
            </button>
            <button
              onClick={(e) => handleDeleteClick(selectedCharacter.id, e)}
              className="font-sans text-[8px] tracking-[0.2em] uppercase text-destructive/60 hover:text-destructive transition-colors"
            >
              Remove
            </button>
          </div>

          <CharacterSheet
            character={selectedCharacter}
            onHPAdjust={(delta) =>
              handleHPChange(
                selectedCharacter.id,
                selectedCharacter.hpCurrent,
                selectedCharacter.hpMax,
                delta,
              )
            }
          />
        </div>
      )}

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
    </div>
  );
}
