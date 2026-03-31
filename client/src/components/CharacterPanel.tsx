import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
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

      <div className="space-y-6">
        {isLoading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="h-5 w-5 animate-spin text-ghost" />
          </div>
        ) : characters && characters.length > 0 ? (
          characters.map((char) => (
            <div
              key={char.id}
              onClick={() => onCharacterSelect(char.id)}
              className={`cursor-pointer transition-colors py-4 px-3 ${
                selectedCharacterId === char.id
                  ? 'bg-surface-high/50'
                  : 'hover:bg-surface-high/30'
              }`}
            >
              {/* Name & class */}
              <div className="flex items-start justify-between gap-1 mb-3">
                <div className="min-w-0 flex-1">
                  <h3 className={`font-serif text-lg tracking-tight ${
                    selectedCharacterId === char.id ? 'text-vellum' : 'text-foreground'
                  }`}>{char.name}</h3>
                  <p className="font-sans text-[9px] tracking-[0.2em] uppercase text-ghost mt-1">
                    {char.className} &middot; Level {char.level}
                  </p>
                </div>
                <div className="flex gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onEditCharacter(char.id);
                    }}
                    className="font-sans text-[8px] tracking-[0.2em] uppercase text-ghost hover:text-vellum transition-colors"
                  >
                    Edit
                  </button>
                  <button
                    onClick={(e) => handleDeleteClick(char.id, e)}
                    className="font-sans text-[8px] tracking-[0.2em] uppercase text-destructive/60 hover:text-destructive transition-colors"
                  >
                    Remove
                  </button>
                </div>
              </div>

              {/* Vitality — Typography-driven HP */}
              <div className="mb-3">
                <span className="font-sans text-[9px] tracking-[0.3em] uppercase text-ghost block mb-1">Vitality</span>
                <div className="flex items-baseline gap-1">
                  <span className="font-serif text-2xl text-foreground leading-none tracking-tighter">
                    {char.hpCurrent}
                  </span>
                  <span className="font-serif text-sm text-ghost">/ {char.hpMax}</span>
                </div>
                <div className="flex items-center gap-2 mt-2" onClick={(e) => e.stopPropagation()}>
                  <button
                    onClick={() => handleHPChange(char.id, char.hpCurrent, char.hpMax, -5)}
                    className="font-sans text-[9px] text-ghost hover:text-vellum transition-colors"
                  >
                    -5
                  </button>
                  <button
                    onClick={() => handleHPChange(char.id, char.hpCurrent, char.hpMax, -1)}
                    className="font-sans text-[9px] text-ghost hover:text-vellum transition-colors"
                  >
                    -1
                  </button>
                  <button
                    onClick={() => handleHPChange(char.id, char.hpCurrent, char.hpMax, 1)}
                    className="font-sans text-[9px] text-ghost hover:text-vellum transition-colors"
                  >
                    +1
                  </button>
                  <button
                    onClick={() => handleHPChange(char.id, char.hpCurrent, char.hpMax, 5)}
                    className="font-sans text-[9px] text-ghost hover:text-vellum transition-colors"
                  >
                    +5
                  </button>
                </div>
              </div>

              {/* Defense */}
              <div className="mb-3">
                <span className="font-sans text-[9px] tracking-[0.3em] uppercase text-ghost block mb-1">Defense</span>
                <span className="font-serif text-2xl text-foreground leading-none tracking-tighter">{char.ac}</span>
              </div>

              {/* Ability Scores — The Spine Layout */}
              <div className="space-y-1">
                {[
                  ['Str', char.stats.str],
                  ['Dex', char.stats.dex],
                  ['Con', char.stats.con],
                  ['Int', char.stats.int],
                  ['Wis', char.stats.wis],
                  ['Cha', char.stats.cha],
                ].map(([label, value]) => (
                  <div key={label as string} className="flex items-baseline justify-between">
                    <span className="font-sans text-[9px] tracking-[0.2em] uppercase text-ghost">{label}</span>
                    <span className="font-serif text-sm text-foreground">{value as number}</span>
                  </div>
                ))}
              </div>
            </div>
          ))
        ) : (
          <p className="font-serif text-sm italic text-ghost/60">No characters yet</p>
        )}
      </div>

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
