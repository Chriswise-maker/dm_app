import { useState, useEffect, useRef } from 'react';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';
import { Loader2, Send, Volume2, VolumeX } from 'lucide-react';
import { toast } from 'sonner';
import { Streamdown } from 'streamdown';
import { useCombatState } from '@/hooks/combat/useCombatState';
import InitiativeDisplay from '@/components/combat/InitiativeDisplay';

interface ChatInterfaceProps {
  sessionId: number | null;
  characterId: number | null;
  characterName: string | null;
  onCreateCharacter: () => void;
  combatState?: any;
  refetchCombatState?: () => void;
}

interface Message {
  id: number;
  sessionId: number;
  characterName: string;
  content: string;
  isDm: number;
  timestamp: Date | string;
}

export default function ChatInterface({
  sessionId,
  characterId,
  characterName,
  onCreateCharacter,
  combatState,
  refetchCombatState
}: ChatInterfaceProps) {
  const [message, setMessage] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [pendingUserMessage, setPendingUserMessage] = useState<string | null>(null);
  const [playingMessageId, setPlayingMessageId] = useState<number | null>(null);
  const [audioCache, setAudioCache] = useState<Map<number, string>>(new Map());
  const [awaitingInitiativeFrom, setAwaitingInitiativeFrom] = useState<string[]>([]);

  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const utils = trpc.useUtils();

  // const { combatState, refetchCombatState } = useCombatState(sessionId); // Removed internal hook

  // Combat state
  const [showEnemyDialog, setShowEnemyDialog] = useState(false);
  // The following line is commented out as combatState and refetchCombatState are now passed via props
  // const { combatState, initiateCombat, addPlayer, sortInitiative, refetchCombatState } = useCombatState(sessionId);

  const { data: messages, isLoading, refetch } = trpc.messages.list.useQuery(
    { sessionId: sessionId!, limit: 100 },
    { enabled: !!sessionId }
  );

  const { data: settings } = trpc.settings.get.useQuery();

  const generateEnemiesMutation = trpc.combat.generateEnemies.useMutation();

  const initiateCombat = trpc.combat.initiate.useMutation({
    onSuccess: () => {
      refetchCombatState?.();
    }
  });

  const addPlayer = trpc.combat.addPlayer.useMutation({
    onSuccess: () => {
      refetchCombatState?.();
    }
  });

  const sortInitiative = trpc.combat.sortInitiative.useMutation({
    onSuccess: () => {
      refetchCombatState?.();
    }
  });

  const ttsMutation = trpc.tts.generate.useMutation({
    onSuccess: (data, variables) => {
      const messageId = (variables as any).messageId;
      const audioUrl = `data:audio/mp3;base64,${data.audio}`;

      // Cache the audio
      setAudioCache(prev => new Map(prev).set(messageId, audioUrl));

      // Play the audio
      if (audioRef.current) {
        audioRef.current.pause();
      }

      const audio = new Audio(audioUrl);
      audioRef.current = audio;
      setPlayingMessageId(messageId);

      audio.onended = () => {
        setPlayingMessageId(null);
        audioRef.current = null;
      };

      audio.onerror = () => {
        toast.error('Failed to play audio');
        setPlayingMessageId(null);
        audioRef.current = null;
      };

      audio.play().catch((err) => {
        toast.error('Failed to play audio: ' + err.message);
        setPlayingMessageId(null);
        audioRef.current = null;
      });
    },
    onError: (error) => {
      toast.error('Failed to generate speech: ' + error.message);
      setPlayingMessageId(null);
    },
  });

  const sendMutation = trpc.messages.send.useMutation({
    onSuccess: (data) => {
      // Clear pending user message since it's now in the database
      setPendingUserMessage(null);

      // Check for combat initiation
      if (data.response.toLowerCase().includes('roll for initiative')) {
        handleCombatInitiation();
      }

      // Start streaming effect
      const fullText = data.response;
      setIsStreaming(true);
      setStreamingText('');

      let currentIndex = 0;
      const streamInterval = setInterval(() => {
        if (currentIndex < fullText.length) {
          // Add 2-5 characters at a time for more natural streaming
          const charsToAdd = Math.min(Math.floor(Math.random() * 4) + 2, fullText.length - currentIndex);
          setStreamingText(fullText.substring(0, currentIndex + charsToAdd));
          currentIndex += charsToAdd;
        } else {
          clearInterval(streamInterval);
          setIsStreaming(false);
          setStreamingText('');
          refetch();
          // Invalidate character query to refresh HP and inventory
          if (sessionId) {
            utils.characters.list.invalidate({ sessionId });
          }
        }
      }, 30); // Adjust speed here (lower = faster)
    },
    onError: (error) => {
      toast.error('Failed to send message: ' + error.message);
      setPendingUserMessage(null); // Clear pending message on error
    },
  });

  // Scroll to bottom on new messages
  useEffect(() => {
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
    }
  }, [messages, streamingText, pendingUserMessage]);

  // Poll for combat state updates if we don't have the hook doing it
  // Actually, the hook in Home.tsx handles polling, so we just receive updates via props

  const playAudio = (url: string, messageId: number) => {
    if (audioRef.current) {
      audioRef.current.pause();
    }

    const audio = new Audio(url);
    audioRef.current = audio;

    audio.onended = () => {
      setPlayingMessageId(null);
      audioRef.current = null;
    };

    setPlayingMessageId(messageId);

    audio.play().catch((err) => {
      toast.error('Failed to play audio: ' + err.message);
      setPlayingMessageId(null);
      audioRef.current = null;
    });
  };

  const handleSend = () => {
    if (!sessionId || !characterId) {
      toast.error('Please select a campaign and character');
      return;
    }

    if (!message.trim()) {
      toast.error('Please enter a message');
      return;
    }

    const userMessage = message.trim();
    setMessage('');

    // Immediately show the user's message
    setPendingUserMessage(userMessage);

    sendMutation.mutate({
      sessionId,
      characterId,
      message: userMessage,
    });
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handlePlayTTS = (messageId: number, text: string) => {
    // If already playing this message, stop it
    if (playingMessageId === messageId) {
      handleStopTTS();
      return;
    }

    // Check if we have cached audio
    const existingAudio = document.querySelector(`audio[data-message-id="${messageId}"]`) as HTMLAudioElement;
    if (existingAudio) {
      if (audioRef.current) {
        audioRef.current.pause();
      }
      audioRef.current = existingAudio;
      setPlayingMessageId(messageId);
      existingAudio.onended = () => {
        setPlayingMessageId(null);
        audioRef.current = null;
      };
      existingAudio.play().catch((err) => {
        toast.error('Failed to play audio: ' + err.message);
        setPlayingMessageId(null);
        audioRef.current = null;
      });
    } else {
      // Generate new audio
      ttsMutation.mutate({ text, messageId } as any);
    }
  };

  const handleStopTTS = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setPlayingMessageId(null);
  };

  // Combat handlers
  const handleCombatInitiation = async () => {
    if (!sessionId) return;

    try {
      // Initiate combat
      await initiateCombat.mutateAsync({ sessionId });

      toast.info('Generating enemies for this encounter...', { duration: 2000 });

      // Automatically generate enemies based on context
      const result = await generateEnemiesMutation.mutateAsync({ sessionId });

      if (result.success && result.count > 0) {
        toast.success(`${result.count} ${result.count === 1 ? 'enemy' : 'enemies'} appeared!`);

        // Now prompt for player initiative
        await handleEnemiesAdded();
        refetchCombatState?.();
      } else {
        toast.error('Failed to generate enemies');
      }
    } catch (error: any) {
      toast.error('Failed to initiate combat: ' + error.message);
    }
  };

  const handleEnemiesAdded = async () => {
    if (!sessionId || !characterId) return;

    try {
      // Get characters to add to combat
      const characters = await utils.characters.list.fetch({ sessionId });

      // Prompt for initiative for all characters
      const characterNames = characters.map(c => c.name);
      setAwaitingInitiativeFrom(characterNames);

      toast.info('Roll initiative for your character! (Type: "Initiative: [number]")');
    } catch (error: any) {
      toast.error('Failed to setup combat: ' + error.message);
    }
  };

  const handleInitiativeInput = async (characterName: string, initiative: number) => {
    if (!sessionId) return;

    try {
      // Find character
      const characters = await utils.characters.list.fetch({ sessionId });
      const character = characters.find(c => c.name.toLowerCase() === characterName.toLowerCase());

      if (!character) {
        toast.error(`Character ${characterName} not found`);
        return;
      }

      // Add player to combat
      await addPlayer.mutateAsync({
        sessionId,
        characterId: character.id,
        initiative,
      });

      // Remove from awaiting list
      setAwaitingInitiativeFrom(prev => prev.filter(n => n !== characterName));

      toast.success(`${characterName} added to combat with initiative ${initiative}`);

      // If all initiatives collected, sort and start combat
      const updatedAwaiting = awaitingInitiativeFrom.filter(n => n !== characterName);
      if (updatedAwaiting.length === 0) {
        await sortInitiative.mutateAsync({ sessionId });
        refetchCombatState?.();
        toast.success('Combat begins!', { duration: 3000 });
      }
    } catch (error: any) {
      toast.error('Failed to add character to combat: ' + error.message);
    }
  };

  // Cleanup audio on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  if (!sessionId) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">Select a campaign to start playing</p>
      </div>
    );
  }

  // Combine history messages with pending/streaming messages
  const allMessages: (Message | { id: string; characterName: string; content: string; isDm: number; timestamp: string; isStreaming?: boolean; isThinking?: boolean; isPending?: boolean })[] = [
    ...(messages || []),
  ];

  // Show pending user message
  if (pendingUserMessage) {
    allMessages.push({
      id: 'pending-user',
      characterName: characterName || 'Player',
      content: pendingUserMessage,
      isDm: 0,
      timestamp: new Date().toISOString(),
      isPending: true,
    });
  }

  // Show thinking indicator while waiting for response
  if (sendMutation.isPending && !isStreaming) {
    allMessages.push({
      id: 'thinking',
      characterName: 'DM',
      content: '',
      isDm: 1,
      timestamp: new Date().toISOString(),
      isThinking: true,
    });
  }

  // Show streaming DM response
  if (isStreaming && streamingText) {
    allMessages.push({
      id: 'streaming',
      characterName: 'DM',
      content: streamingText,
      isDm: 1,
      timestamp: new Date().toISOString(),
      isStreaming: true,
    });
  }

  return (
    <div className="flex flex-col h-full">
      {/* Messages Area */}
      <div
        ref={messagesContainerRef}
        className="flex-1 overflow-y-auto p-4 space-y-4"
      >
        {/* Combat Initiative Display - REMOVED (Moved to Sidebar) */}

        {isLoading ? (
          <div className="flex justify-center items-center h-full">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : allMessages.length > 0 ? (
          allMessages.map((msg) => {
            const messageId = 'id' in msg && typeof msg.id === 'number' ? msg.id : null;
            const isTTSEnabled = settings?.ttsEnabled && settings?.ttsApiKey && msg.isDm;
            const isCurrentlyPlaying = messageId && playingMessageId === messageId;
            const isTTSLoading = ttsMutation.isPending && (ttsMutation.variables as any)?.messageId === messageId;

            return (
              <Card
                key={messageId || ('id' in msg ? msg.id : 'unknown')}
                className={`p-4 ${msg.isDm ? 'bg-primary/5 border-primary/20' : 'bg-accent/50'
                  } ${'isPending' in msg && msg.isPending ? 'opacity-70' : ''}`}
              >
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center font-bold text-sm">
                    {msg.isDm ? 'DM' : (msg.characterName?.[0] || 'P')}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold text-sm">{msg.characterName}</span>
                      <span className="text-xs text-muted-foreground">
                        {typeof msg.timestamp === 'string'
                          ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                          : msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      {isTTSEnabled && messageId && !('isThinking' in msg) && msg.content && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 ml-auto"
                          onClick={() => handlePlayTTS(messageId, msg.content)}
                          disabled={isTTSLoading}
                          title={isCurrentlyPlaying ? 'Stop' : 'Play audio'}
                        >
                          {isTTSLoading ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : isCurrentlyPlaying ? (
                            <VolumeX className="h-4 w-4" />
                          ) : (
                            <Volume2 className="h-4 w-4" />
                          )}
                        </Button>
                      )}
                    </div>
                    {'isThinking' in msg && msg.isThinking ? (
                      <div className="flex items-center gap-2 text-muted-foreground italic">
                        <span>DM is thinking</span>
                        <span className="inline-flex gap-1">
                          <span className="animate-bounce" style={{ animationDelay: '0ms' }}>.</span>
                          <span className="animate-bounce" style={{ animationDelay: '150ms' }}>.</span>
                          <span className="animate-bounce" style={{ animationDelay: '300ms' }}>.</span>
                        </span>
                      </div>
                    ) : (
                      <div className="prose prose-sm dark:prose-invert max-w-none">
                        <Streamdown>{msg.content}</Streamdown>
                      </div>
                    )}
                  </div>
                </div>
              </Card>
            );
          })
        ) : (
          <div className="flex justify-center items-center h-full">
            <p className="text-muted-foreground">No messages yet. Start the adventure!</p>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="border-t p-4">
        {characterId ? (
          <div className="space-y-2">
            <div className="flex gap-2">
              <Textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={handleKeyPress}
                placeholder={`What does ${characterName} do?`}
                className="flex-1 min-h-[60px] max-h-[200px]"
                disabled={sendMutation.isPending}
              />
              <Button
                onClick={handleSend}
                disabled={sendMutation.isPending || !message.trim()}
                size="icon"
                className="h-[60px] w-[60px]"
              >
                {sendMutation.isPending ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <Send className="h-5 w-5" />
                )}
              </Button>
            </div>
            {!combatState?.inCombat && (
              <Button
                onClick={handleCombatInitiation}
                variant="outline"
                className="w-full"
                disabled={initiateCombat.isPending}
              >
                {initiateCombat.isPending ? 'Starting Combat...' : '⚔️ Start Combat'}
              </Button>
            )}
          </div>
        ) : (
          <Button
            onClick={onCreateCharacter}
            className="w-full h-[60px] text-lg font-semibold"
            variant="default"
          >
            Create Character to Join Adventure
          </Button>
        )}
      </div>
    </div>
  );
}

