import { useState } from 'react';
import { useAuth } from '@/_core/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { getLoginUrl, APP_TITLE } from '@/const';
import SessionManager from '@/components/SessionManager';
import CharacterPanel from '@/components/CharacterPanel';
import CharacterCreationDialog from '@/components/CharacterCreationDialog';
import CharacterEditDialog from '@/components/CharacterEditDialog';
import CharacterGeneratorDialog from '@/components/CharacterGeneratorDialog';
import ChatInterface from '@/components/ChatInterface';
import { trpc } from '@/lib/trpc';
import { Loader2 } from 'lucide-react';
import SettingsDialog from '@/components/SettingsDialog';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';

import { useCombatState } from '@/hooks/combat/useCombatState';
import CombatSidebar from '@/components/combat/CombatSidebar';

export default function Home() {
  // Bypass authentication for local use - use a mock user
  const user = { id: 1, name: 'Local User', openId: 'local-user' };
  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(null);
  const [selectedCharacterId, setSelectedCharacterId] = useState<number | null>(null);
  const [isCharacterDialogOpen, setIsCharacterDialogOpen] = useState(false);
  const [isCharacterEditOpen, setIsCharacterEditOpen] = useState(false);
  const [isGeneratorOpen, setIsGeneratorOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [characterToEdit, setCharacterToEdit] = useState<number | null>(null);

  const { data: characters, refetch: refetchCharacters } = trpc.characters.list.useQuery(
    { sessionId: selectedSessionId! },
    { enabled: !!selectedSessionId }
  );

  // Lifted combat state
  const { combatState, refetchCombatState } = useCombatState(selectedSessionId);

  const selectedCharacter = characters?.find((c) => c.id === selectedCharacterId);
  const editingCharacter = characters?.find((c) => c.id === characterToEdit);

  const handleSessionSelect = (sessionId: number | null) => {
    setSelectedSessionId(sessionId);
    setSelectedCharacterId(null);
  };

  const handleCharacterCreated = () => {
    refetchCharacters();
  };

  const handleEditCharacter = (characterId: number) => {
    setCharacterToEdit(characterId);
    setIsCharacterEditOpen(true);
  };

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      {/* Header — The Archival Anchor */}
      <header className="bg-background px-8 py-5 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h1 className="text-2xl tracking-tighter text-vellum font-serif">{APP_TITLE}</h1>
        </div>
        <div className="flex items-center gap-6">
          <span className="font-sans text-[10px] tracking-[0.2em] uppercase text-ghost">
            {user.name}
          </span>
          <button
            onClick={() => setIsSettingsOpen(true)}
            className="font-sans text-[10px] tracking-[0.2em] uppercase text-ghost hover:text-vellum transition-colors"
          >
            Settings
          </button>
        </div>
      </header>

      {/* Main Content - Resizable Panels */}
      <div className="flex-1 overflow-hidden">
        <ResizablePanelGroup
          direction="horizontal"
          className="h-full"
          key={selectedSessionId ? 'with-combat' : 'no-combat'}
          autoSaveId={selectedSessionId ? 'dm-layout-combat' : 'dm-layout'}
        >
          {/* Left Sidebar — Campaigns & Characters */}
          <ResizablePanel
            defaultSize={20}
            minSize={12}
            maxSize={35}
            className="overflow-hidden"
          >
            <aside className="h-full w-full bg-background p-6 overflow-y-auto overflow-x-hidden space-y-8">
              <SessionManager
                selectedSessionId={selectedSessionId}
                onSessionSelect={handleSessionSelect}
              />
              <CharacterPanel
                sessionId={selectedSessionId}
                selectedCharacterId={selectedCharacterId}
                onCharacterSelect={setSelectedCharacterId}
                onCreateCharacter={() => setIsCharacterDialogOpen(true)}
                onEditCharacter={handleEditCharacter}
              />

              <button
                onClick={() => setIsGeneratorOpen(true)}
                disabled={!selectedSessionId}
                className="w-full font-sans text-[10px] tracking-[0.2em] uppercase text-ghost hover:text-brass transition-colors disabled:opacity-30 py-3"
              >
                Generate Character
              </button>
            </aside>
          </ResizablePanel>

          <ResizableHandle withHandle />

          {/* Main Chat Area — The Chronicle */}
          <ResizablePanel defaultSize={selectedSessionId ? 58 : 80} minSize={30}>
            <div className="h-full overflow-hidden">
              <ChatInterface
                sessionId={selectedSessionId}
                characterId={selectedCharacterId}
                characterName={selectedCharacter?.name || null}
                onCreateCharacter={() => setIsCharacterDialogOpen(true)}
                combatState={combatState}
                refetchCombatState={refetchCombatState}
              />
            </div>
          </ResizablePanel>

          {/* Right Sidebar — The Sequence (Combat) */}
          {selectedSessionId && (
            <>
              <ResizableHandle withHandle />
              <ResizablePanel defaultSize={22} minSize={14} maxSize={40} className="overflow-hidden">
                <CombatSidebar sessionId={selectedSessionId} />
              </ResizablePanel>
            </>
          )}
        </ResizablePanelGroup>
      </div>

      {/* Character Creation Dialog */}
      <CharacterCreationDialog
        sessionId={selectedSessionId}
        open={isCharacterDialogOpen}
        onOpenChange={setIsCharacterDialogOpen}
        onSuccess={handleCharacterCreated}
      />

      {/* Character Edit Dialog */}
      <CharacterEditDialog
        character={editingCharacter || null}
        open={isCharacterEditOpen}
        onOpenChange={setIsCharacterEditOpen}
        onSuccess={handleCharacterCreated}
      />

      {/* AI Character Generator Dialog */}
      <CharacterGeneratorDialog
        sessionId={selectedSessionId}
        open={isGeneratorOpen}
        onOpenChange={setIsGeneratorOpen}
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
