import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
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

interface SessionManagerProps {
  selectedSessionId: number | null;
  onSessionSelect: (sessionId: number | null) => void;
}

export default function SessionManager({ selectedSessionId, onSessionSelect }: SessionManagerProps) {
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [campaignName, setCampaignName] = useState('');
  const [narrativePrompt, setNarrativePrompt] = useState('');
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [sessionToDelete, setSessionToDelete] = useState<number | null>(null);
  const [isEditNarrativeOpen, setIsEditNarrativeOpen] = useState(false);
  const [editingSessionId, setEditingSessionId] = useState<number | null>(null);
  const [editingNarrativePrompt, setEditingNarrativePrompt] = useState('');
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [sessionToReset, setSessionToReset] = useState<number | null>(null);

  const utils = trpc.useUtils();
  const { data: sessions, isLoading, refetch } = trpc.sessions.list.useQuery();

  const createMutation = trpc.sessions.create.useMutation({
    onSuccess: (data) => {
      toast.success('Campaign created!');
      setIsCreateOpen(false);
      setCampaignName('');
      setNarrativePrompt('');
      refetch();
      onSessionSelect(data.id);
    },
    onError: (error) => {
      toast.error('Failed to create campaign: ' + error.message);
    },
  });

  const deleteMutation = trpc.sessions.delete.useMutation({
    onSuccess: () => {
      toast.success('Campaign deleted');
      refetch();
      setDeleteDialogOpen(false);
      setSessionToDelete(null);
      if (selectedSessionId === sessionToDelete) {
        onSessionSelect(sessions?.[0]?.id || null);
      }
    },
    onError: (error) => {
      toast.error('Failed to delete campaign: ' + error.message);
    },
  });

  const generateMutation = trpc.sessions.generate.useMutation({
    onSuccess: (data) => {
      toast.success('Campaign generated successfully!');
      setNarrativePrompt('');
      refetch();
      onSessionSelect(data.id);
    },
    onError: (error) => {
      toast.error('Failed to generate campaign: ' + error.message);
    },
  });

  const updateNarrativeMutation = trpc.sessions.updateNarrative.useMutation({
    onSuccess: () => {
      toast.success('Campaign narrative updated!');
      setIsEditNarrativeOpen(false);
      refetch();
    },
    onError: (error) => {
      toast.error('Failed to update narrative: ' + error.message);
    },
  });

  const resetMutation = trpc.sessions.reset.useMutation({
    onSuccess: (_data, variables) => {
      toast.success('Campaign reset! Chat history cleared, characters restored to full HP.');
      refetch();
      const { sessionId } = variables;
      utils.messages.list.invalidate({ sessionId });
      utils.messages.getActivityLog.invalidate({ sessionId });
      utils.characters.list.invalidate({ sessionId });
      setResetDialogOpen(false);
      setSessionToReset(null);
    },
    onError: (error) => {
      toast.error('Failed to reset campaign: ' + error.message);
    },
  });

  const handleCreate = () => {
    if (!campaignName.trim()) {
      toast.error('Please enter a campaign name');
      return;
    }
    createMutation.mutate({
      campaignName: campaignName.trim(),
      narrativePrompt: narrativePrompt.trim() || undefined
    });
  };

  const handleDeleteClick = (sessionId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setSessionToDelete(sessionId);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = () => {
    if (sessionToDelete) {
      deleteMutation.mutate({ sessionId: sessionToDelete });
    }
  };

  const handleEditNarrativeClick = (session: any, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingSessionId(session.id);
    setEditingNarrativePrompt(session.narrativePrompt || '');
    setIsEditNarrativeOpen(true);
  };

  const handleUpdateNarrative = () => {
    if (editingSessionId) {
      updateNarrativeMutation.mutate({
        sessionId: editingSessionId,
        narrativePrompt: editingNarrativePrompt,
      });
    }
  };

  const handleResetClick = (sessionId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setSessionToReset(sessionId);
    setResetDialogOpen(true);
  };

  const handleResetConfirm = () => {
    if (sessionToReset) {
      resetMutation.mutate({ sessionId: sessionToReset });
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <span className="font-sans text-[9px] tracking-[0.3em] uppercase text-ghost">Campaigns</span>
        <div className="flex items-center gap-3">
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <button className="font-sans text-[9px] tracking-[0.2em] uppercase text-ghost hover:text-brass transition-colors">
                New
              </button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle className="font-serif text-xl">New Campaign</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-4">
                <div className="space-y-2">
                  <Label htmlFor="campaign-name" className="font-sans text-[9px] tracking-[0.2em] uppercase text-ghost">Campaign Name</Label>
                  <Input
                    id="campaign-name"
                    value={campaignName}
                    onChange={(e) => setCampaignName(e.target.value)}
                    placeholder="Enter campaign name..."
                    className="bg-transparent border-b border-border focus:border-vellum font-serif"
                    onKeyPress={(e) => e.key === 'Enter' && !e.shiftKey && handleCreate()}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="narrative-prompt" className="font-sans text-[9px] tracking-[0.2em] uppercase text-ghost">
                    Narrative Setting & Tone
                  </Label>
                  <Textarea
                    id="narrative-prompt"
                    value={narrativePrompt}
                    onChange={(e) => setNarrativePrompt(e.target.value)}
                    placeholder="e.g., Gothic horror setting with Lovecraftian themes. Dark, adult-oriented content..."
                    rows={5}
                    className="resize-none bg-transparent font-serif"
                  />
                  <p className="font-sans text-[9px] text-ghost/60">
                    Describe the setting, tone, themes, and style for your campaign.
                  </p>
                </div>
                <button
                  onClick={handleCreate}
                  disabled={createMutation.isPending}
                  className="w-full font-sans text-[10px] tracking-[0.2em] uppercase text-vellum hover:text-brass transition-colors py-3 disabled:opacity-50"
                >
                  {createMutation.isPending ? 'Creating...' : 'Create Campaign'}
                </button>
              </div>
            </DialogContent>
          </Dialog>

          <Dialog>
            <DialogTrigger asChild>
              <button className="font-sans text-[9px] tracking-[0.2em] uppercase text-ghost hover:text-brass transition-colors">
                Generate
              </button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle className="font-serif text-xl">Generate Campaign</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-4">
                <div className="space-y-2">
                  <Label htmlFor="gen-prompt" className="font-sans text-[9px] tracking-[0.2em] uppercase text-ghost">Campaign Theme</Label>
                  <Textarea
                    id="gen-prompt"
                    value={narrativePrompt}
                    onChange={(e) => setNarrativePrompt(e.target.value)}
                    placeholder="A post-apocalyptic world where magic has returned..."
                    rows={4}
                    className="bg-transparent font-serif"
                  />
                  <p className="font-sans text-[9px] text-ghost/60">
                    Leave blank for a completely random campaign.
                  </p>
                </div>
                <button
                  onClick={() => {
                    generateMutation.mutate({ prompt: narrativePrompt });
                  }}
                  disabled={generateMutation.isPending}
                  className="w-full font-sans text-[10px] tracking-[0.2em] uppercase text-vellum hover:text-brass transition-colors py-3 disabled:opacity-50"
                >
                  {generateMutation.isPending ? 'Generating...' : 'Generate Campaign'}
                </button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="space-y-1">
        {isLoading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="h-5 w-5 animate-spin text-ghost" />
          </div>
        ) : sessions && sessions.length > 0 ? (
          sessions.map((session) => (
            <div
              key={session.id}
              className={`group flex items-center justify-between gap-1 py-2 transition-colors cursor-pointer ${
                selectedSessionId === session.id
                  ? 'text-vellum'
                  : 'text-ghost hover:text-foreground'
              }`}
            >
              <button
                onClick={() => onSessionSelect(session.id)}
                className="flex-1 text-left min-w-0 font-serif text-sm truncate"
              >
                {session.campaignName}
              </button>
              <div className="flex items-center shrink-0 opacity-0 group-hover:opacity-100 transition-opacity gap-2">
                <button
                  onClick={(e) => handleEditNarrativeClick(session, e)}
                  className="font-sans text-[8px] tracking-[0.2em] uppercase text-ghost hover:text-vellum transition-colors"
                >
                  Edit
                </button>
                <button
                  onClick={(e) => handleResetClick(session.id, e)}
                  className="font-sans text-[8px] tracking-[0.2em] uppercase text-ghost hover:text-vellum transition-colors"
                >
                  Reset
                </button>
                <button
                  onClick={(e) => handleDeleteClick(session.id, e)}
                  className="font-sans text-[8px] tracking-[0.2em] uppercase text-destructive/60 hover:text-destructive transition-colors"
                >
                  Delete
                </button>
              </div>
            </div>
          ))
        ) : (
          <p className="font-serif text-sm italic text-ghost/60 py-4">
            No campaigns yet
          </p>
        )}
      </div>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-serif">Delete Campaign?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete the campaign,
              including all characters, messages, and game context.
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

      {/* Reset Confirmation Dialog */}
      <AlertDialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-serif">Reset Campaign?</AlertDialogTitle>
            <AlertDialogDescription>
              This will clear all chat history, combat logs, and game context.
              Characters will be restored to full HP.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleResetConfirm}
              className="bg-brass text-background hover:bg-brass/90"
            >
              Reset Campaign
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Edit Narrative Dialog */}
      <Dialog open={isEditNarrativeOpen} onOpenChange={setIsEditNarrativeOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="font-serif text-xl">Edit Campaign Narrative</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-4">
            <div className="space-y-2">
              <Label htmlFor="edit-narrative" className="font-sans text-[9px] tracking-[0.2em] uppercase text-ghost">
                Narrative Setting & Tone
              </Label>
              <Textarea
                id="edit-narrative"
                value={editingNarrativePrompt}
                onChange={(e) => setEditingNarrativePrompt(e.target.value)}
                placeholder="Describe the setting, tone, themes, and style..."
                rows={10}
                className="resize-none bg-transparent font-serif"
              />
              <p className="font-sans text-[9px] text-ghost/60">
                This text is sent to the AI with every message to maintain consistency.
              </p>
            </div>
            <button
              onClick={handleUpdateNarrative}
              disabled={updateNarrativeMutation.isPending}
              className="w-full font-sans text-[10px] tracking-[0.2em] uppercase text-vellum hover:text-brass transition-colors py-3 disabled:opacity-50"
            >
              {updateNarrativeMutation.isPending ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
