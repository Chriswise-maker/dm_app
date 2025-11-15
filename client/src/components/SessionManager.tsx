import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';

interface SessionManagerProps {
  selectedSessionId: number | null;
  onSessionSelect: (sessionId: number) => void;
}

export default function SessionManager({ selectedSessionId, onSessionSelect }: SessionManagerProps) {
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [campaignName, setCampaignName] = useState('');
  
  const { data: sessions, isLoading, refetch } = trpc.sessions.list.useQuery();
  const createMutation = trpc.sessions.create.useMutation({
    onSuccess: (data) => {
      toast.success('Campaign created!');
      setIsCreateOpen(false);
      setCampaignName('');
      refetch();
      onSessionSelect(data.id);
    },
    onError: (error) => {
      toast.error('Failed to create campaign: ' + error.message);
    },
  });

  const handleCreate = () => {
    if (!campaignName.trim()) {
      toast.error('Please enter a campaign name');
      return;
    }
    createMutation.mutate({ campaignName: campaignName.trim() });
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
            <DialogContent>
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
                    onKeyPress={(e) => e.key === 'Enter' && handleCreate()}
                  />
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
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : sessions && sessions.length > 0 ? (
          sessions.map((session) => (
            <button
              key={session.id}
              onClick={() => onSessionSelect(session.id)}
              className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                selectedSessionId === session.id
                  ? 'bg-primary text-primary-foreground'
                  : 'hover:bg-accent'
              }`}
            >
              {session.campaignName}
            </button>
          ))
        ) : (
          <p className="text-sm text-muted-foreground text-center py-4">
            No campaigns yet
          </p>
        )}
      </CardContent>
    </Card>
  );
}
