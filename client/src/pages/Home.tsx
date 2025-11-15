import { useState } from 'react';
import { useAuth } from '@/_core/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { getLoginUrl, APP_TITLE } from '@/const';
import SessionManager from '@/components/SessionManager';
import CharacterPanel from '@/components/CharacterPanel';
import CharacterCreationDialog from '@/components/CharacterCreationDialog';
import ChatInterface from '@/components/ChatInterface';
import { trpc } from '@/lib/trpc';
import { Loader2, Scroll, Settings } from 'lucide-react';
import SettingsDialog from '@/components/SettingsDialog';

export default function Home() {
  // Bypass authentication for local use - use a mock user
  const user = { id: 1, name: 'Local User', openId: 'local-user' };
  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(null);
  const [selectedCharacterId, setSelectedCharacterId] = useState<number | null>(null);
  const [isCharacterDialogOpen, setIsCharacterDialogOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const { data: characters, refetch: refetchCharacters } = trpc.characters.list.useQuery(
    { sessionId: selectedSessionId! },
    { enabled: !!selectedSessionId }
  );

  const selectedCharacter = characters?.find((c) => c.id === selectedCharacterId);

  const handleSessionSelect = (sessionId: number) => {
    setSelectedSessionId(sessionId);
    setSelectedCharacterId(null);
  };

  const handleCharacterCreated = () => {
    refetchCharacters();
  };

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Header */}
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Scroll className="h-6 w-6 text-primary" />
            <h1 className="text-xl font-bold">{APP_TITLE}</h1>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">Welcome, {user.name}</span>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsSettingsOpen(true)}
              title="Settings"
            >
              <Settings className="h-5 w-5" />
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Sidebar */}
        <aside className="w-80 border-r bg-card p-4 overflow-y-auto space-y-4">
          <SessionManager
            selectedSessionId={selectedSessionId}
            onSessionSelect={handleSessionSelect}
          />
          <CharacterPanel
            sessionId={selectedSessionId}
            selectedCharacterId={selectedCharacterId}
            onCharacterSelect={setSelectedCharacterId}
            onCreateCharacter={() => setIsCharacterDialogOpen(true)}
          />
        </aside>

        {/* Main Chat Area */}
        <main className="flex-1 bg-background">
          <ChatInterface
            sessionId={selectedSessionId}
            characterId={selectedCharacterId}
            characterName={selectedCharacter?.name || null}
          />
        </main>
      </div>

      {/* Character Creation Dialog */}
      <CharacterCreationDialog
        sessionId={selectedSessionId}
        open={isCharacterDialogOpen}
        onOpenChange={setIsCharacterDialogOpen}
        onSuccess={handleCharacterCreated}
      />

      {/* Settings Dialog */}
      <SettingsDialog
        open={isSettingsOpen}
        onOpenChange={setIsSettingsOpen}
      />
    </div>
  );
}
