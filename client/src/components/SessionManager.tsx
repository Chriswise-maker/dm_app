import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Loader2, Plus, Trash2, Sparkles, Pencil, RotateCcw } from 'lucide-react';
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
      // Invalidate messages and activity log queries so UI refreshes
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
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">Campaigns</CardTitle>
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline">
                <Plus className="h-4 w-4" />
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>New Campaign</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-4">
                <div className="space-y-2">
                  <Label htmlFor="campaign-name">Campaign Name</Label>
                  <Input
                    id="campaign-name"
                    value={campaignName}
                    onChange={(e) => setCampaignName(e.target.value)}
                    placeholder="Enter campaign name..."
                    onKeyPress={(e) => e.key === 'Enter' && !e.shiftKey && handleCreate()}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="narrative-prompt">
                    Narrative Setting & Tone (Optional)
                  </Label>
                  <Textarea
                    id="narrative-prompt"
                    value={narrativePrompt}
                    onChange={(e) => setNarrativePrompt(e.target.value)}
                    placeholder="e.g., Gothic horror setting with Lovecraftian themes. Dark, adult-oriented content. The world is ruled by nebulous, cosmic forces beyond mortal comprehension..."
                    rows={5}
                    className="resize-none"
                  />
                  <p className="text-xs text-muted-foreground">
                    Describe the setting, tone, themes, and style for your campaign.
                    This will guide the AI to maintain consistency throughout your adventure.
                  </p>
                </div>
                <Button
                  onClick={handleCreate}
                  disabled={createMutation.isPending}
                  className="w-full"
                >
                  {createMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Create Campaign
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          <Dialog>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline" className="ml-2 gap-2">
                <Sparkles className="h-4 w-4" />
                Generate
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Generate Campaign with AI</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-4">
                <div className="space-y-2">
                  <Label htmlFor="gen-prompt">Campaign Theme / Idea (Optional)</Label>
                  <Textarea
                    id="gen-prompt"
                    value={narrativePrompt}
                    onChange={(e) => setNarrativePrompt(e.target.value)}
                    placeholder="e.g., A post-apocalyptic world where magic has returned, or a classic high fantasy setting with a twist..."
                    rows={4}
                  />
                  <p className="text-xs text-muted-foreground">
                    Leave blank for a completely random campaign.
                  </p>
                </div>
                <Button
                  onClick={() => {
                    generateMutation.mutate({ prompt: narrativePrompt });
                  }}
                  disabled={generateMutation.isPending}
                  className="w-full"
                >
                  {generateMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Generate Campaign
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : sessions && sessions.length > 0 ? (
          sessions.map((session) => (
            <div
              key={session.id}
              className={`flex items-center justify-between px-3 py-2 rounded-md text-sm transition-colors ${selectedSessionId === session.id
                ? 'bg-primary text-primary-foreground'
                : 'hover:bg-accent'
                }`}
            >
              <button
                onClick={() => onSessionSelect(session.id)}
                className="flex-1 text-left"
              >
                {session.campaignName}
              </button>
              <div className="flex items-center">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 w-6 p-0 hover:bg-transparent mr-1"
                  onClick={(e) => handleEditNarrativeClick(session, e)}
                  title="Edit Campaign Narrative"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 w-6 p-0 hover:bg-transparent mr-1"
                  onClick={(e) => handleResetClick(session.id, e)}
                  title="Reset Campaign (clear chat, keep characters)"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 w-6 p-0 hover:bg-transparent"
                  onClick={(e) => handleDeleteClick(session.id, e)}
                  title="Delete campaign"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))
        ) : (
          <p className="text-sm text-muted-foreground text-center py-4">
            No campaigns yet
          </p>
        )}
      </CardContent>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Campaign?</AlertDialogTitle>
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
            <AlertDialogTitle>Reset Campaign?</AlertDialogTitle>
            <AlertDialogDescription>
              This will clear all chat history, combat logs, and game context.
              Characters will be restored to full HP. The campaign name and narrative prompt will be preserved.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleResetConfirm}
              className="bg-amber-500 text-white hover:bg-amber-600"
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
            <DialogTitle>Edit Campaign Narrative</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-4">
            <div className="space-y-2">
              <Label htmlFor="edit-narrative">
                Narrative Setting & Tone (World Bible)
              </Label>
              <Textarea
                id="edit-narrative"
                value={editingNarrativePrompt}
                onChange={(e) => setEditingNarrativePrompt(e.target.value)}
                placeholder="Describe the setting, tone, themes, and style..."
                rows={10}
                className="resize-none"
              />
              <p className="text-xs text-muted-foreground">
                This text is sent to the AI with every message to maintain consistency.
              </p>
            </div>
            <Button
              onClick={handleUpdateNarrative}
              disabled={updateNarrativeMutation.isPending}
              className="w-full"
            >
              {updateNarrativeMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Changes
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card >
  );
}
