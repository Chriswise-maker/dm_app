import { useState, useEffect, useRef, useCallback } from 'react';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';
import { Loader2, Send, Volume2, VolumeX, Swords, Dices } from 'lucide-react';
import { toast } from 'sonner';
import { Streamdown } from 'streamdown';
import { useCombatState } from '@/hooks/combat/useCombatState';
import InitiativeDisplay from '@/components/combat/InitiativeDisplay';
import ContextViewer from '@/components/ContextViewer';
import { Input } from '@/components/ui/input';

/** Steady stream reveal: faster than typical reading (~20–30 chars/s), no burst catch-up. */
const STREAM_REVEAL_CHARS_PER_SECOND = 48;

/** If the user is within this many px of the bottom, treat them as "following" new messages. */
const SCROLL_STICK_BOTTOM_PX = 72;

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
  const [isSendingChat, setIsSendingChat] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [pendingUserMessage, setPendingUserMessage] = useState<string | null>(null);
  const [playingMessageId, setPlayingMessageId] = useState<number | null>(null);
  const [audioCache, setAudioCache] = useState<Map<number, string>>(new Map());
  const [awaitingInitiativeFrom, setAwaitingInitiativeFrom] = useState<string[]>([]);

  // Attack roll state
  const [pendingAttack, setPendingAttack] = useState<{
    targetName: string;
    awaitingDamage: boolean;
    attackRoll?: number;
  } | null>(null);
  const [attackRollInput, setAttackRollInput] = useState('');
  const [damageRollInput, setDamageRollInput] = useState('');

  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  /** When true, new content keeps the thread pinned to the bottom. Cleared when user scrolls up. */
  const stickToBottomRef = useRef(true);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  /** Holds the full streamed text received so far. */
  const streamTargetTextRef = useRef('');
  /** Tracks how much of the streamed text we have revealed to the user. */
  const streamDisplayedLengthRef = useRef(0);
  /** Drives a steady visual drain from buffered stream text to the UI. */
  const streamDrainRafRef = useRef<number | null>(null);
  const streamLastFrameRef = useRef<number | null>(null);
  const streamDrainResolveRef = useRef<(() => void) | null>(null);
  const streamDrainCarryRef = useRef(0);
  const utils = trpc.useUtils();

  const stopStreamDrain = useCallback((opts?: { reset?: boolean }) => {
    if (streamDrainRafRef.current != null) {
      cancelAnimationFrame(streamDrainRafRef.current);
      streamDrainRafRef.current = null;
    }
    streamLastFrameRef.current = null;
    streamDrainResolveRef.current?.();
    streamDrainResolveRef.current = null;
    if (opts?.reset) {
      streamTargetTextRef.current = '';
      streamDisplayedLengthRef.current = 0;
      streamDrainCarryRef.current = 0;
    }
  }, []);

  const ensureStreamDrain = useCallback(() => {
    if (streamDrainRafRef.current != null) return;

    const tick = (timestamp: number) => {
      const target = streamTargetTextRef.current;
      const displayedLength = streamDisplayedLengthRef.current;
      const remaining = target.length - displayedLength;

      if (remaining <= 0) {
        streamDrainCarryRef.current = 0;
        streamDrainRafRef.current = null;
        streamLastFrameRef.current = null;
        streamDrainResolveRef.current?.();
        streamDrainResolveRef.current = null;
        return;
      }

      const prevTimestamp = streamLastFrameRef.current ?? timestamp;
      const deltaMs = Math.max(16, timestamp - prevTimestamp);
      streamLastFrameRef.current = timestamp;

      const budget =
        (STREAM_REVEAL_CHARS_PER_SECOND * deltaMs) / 1000 + streamDrainCarryRef.current;
      let add = Math.floor(budget);
      streamDrainCarryRef.current = budget - add;
      add = Math.min(add, remaining);
      if (add < 1) {
        streamDrainRafRef.current = requestAnimationFrame(tick);
        return;
      }

      const nextLength = displayedLength + add;

      streamDisplayedLengthRef.current = nextLength;
      setStreamingText(target.slice(0, nextLength));
      streamDrainRafRef.current = requestAnimationFrame(tick);
    };

    streamDrainRafRef.current = requestAnimationFrame(tick);
  }, []);

  const waitForStreamDrain = useCallback(async () => {
    if (streamDisplayedLengthRef.current >= streamTargetTextRef.current.length) {
      return;
    }

    await new Promise<void>((resolve) => {
      streamDrainResolveRef.current = resolve;
      ensureStreamDrain();
    });
  }, [ensureStreamDrain]);

  // const { combatState, refetchCombatState } = useCombatState(sessionId); // Removed internal hook

  // Combat state
  const [showEnemyDialog, setShowEnemyDialog] = useState(false);
  // The following line is commented out as combatState and refetchCombatState are now passed via props
  // const { combatState, initiateCombat, addPlayer, sortInitiative, refetchCombatState } = useCombatState(sessionId);

  // Check V2 combat engine state for message polling (V1 combatState.inCombat is
  // false during V2 engine combat, so we need to check both)
  const { data: combatV2State } = trpc.combatV2.getState.useQuery(
    { sessionId: sessionId! },
    { enabled: !!sessionId, refetchInterval: 3000 }
  );
  const isInCombat = combatState?.inCombat ||
    (combatV2State?.phase != null && combatV2State.phase !== 'IDLE' && combatV2State.phase !== 'RESOLVED');

  const { data: messages, isLoading, refetch } = trpc.messages.list.useQuery(
    { sessionId: sessionId!, limit: 100 },
    { enabled: !!sessionId, refetchInterval: isInCombat ? 3000 : false }
  );

  const { data: settings } = trpc.settings.get.useQuery();

  const generateEnemiesMutation = trpc.combat.generateEnemies.useMutation();

  const postChatStream = useCallback(
    async (
      userMessage: string,
      opts?: { showPendingUser?: boolean }
    ) => {
      if (!sessionId || !characterId) return;
      const showPending = opts?.showPendingUser !== false;
      if (showPending) {
        setPendingUserMessage(userMessage);
      }
      setIsSendingChat(true);
      setStreamingText('');
      stopStreamDrain({ reset: true });
      let acc = '';
      try {
        const res = await fetch('/api/chat/stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            sessionId,
            characterId,
            message: userMessage,
          }),
        });
        if (!res.ok) {
          const errBody = await res.text();
          throw new Error(errBody || res.statusText || 'Stream request failed');
        }
        if (!res.body) throw new Error('No response body');
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let sep: number;
          while ((sep = buffer.indexOf('\n\n')) !== -1) {
            const raw = buffer.slice(0, sep);
            buffer = buffer.slice(sep + 2);
            if (!raw.trim()) continue;
            for (const line of raw.split('\n')) {
              if (!line.startsWith('data:')) continue;
              const payload = line.slice(5).trimStart();
              try {
                const ev = JSON.parse(payload) as {
                  type: string;
                  text?: string;
                  response?: string;
                  message?: string;
                  combatTriggered?: boolean;
                  enemiesAdded?: number;
                };
                if (ev.type === 'token' && ev.text) {
                  acc += ev.text;
                  streamTargetTextRef.current = acc;
                  ensureStreamDrain();
                }
                if (ev.type === 'done') {
                  if (ev.response) {
                    acc = ev.response;
                  }
                  streamTargetTextRef.current = acc;
                  ensureStreamDrain();
                  if (ev.combatTriggered) {
                    toast.success(
                      `⚔️ Combat initiated! ${ev.enemiesAdded ?? 0} ${(ev.enemiesAdded ?? 0) === 1 ? 'enemy' : 'enemies'} appeared!`
                    );
                    refetchCombatState?.();
                  }
                }
                if (ev.type === 'error') {
                  throw new Error(ev.message || 'Stream error');
                }
              } catch (e) {
                if (e instanceof SyntaxError) continue;
                throw e;
              }
            }
          }
        }
        await waitForStreamDrain();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        toast.error('Failed to send message: ' + msg);
        if (acc) {
          toast.error('Showing partial response before the error.');
          streamTargetTextRef.current = acc;
          ensureStreamDrain();
          await waitForStreamDrain();
        }
      } finally {
        setPendingUserMessage(null);
        setIsSendingChat(false);
        await refetch();
        if (sessionId) {
          await utils.characters.list.invalidate({ sessionId });
        }
        refetchCombatState?.();
        stopStreamDrain({ reset: true });
        setStreamingText('');
      }
    },
    [
      sessionId,
      characterId,
      ensureStreamDrain,
      refetch,
      refetchCombatState,
      stopStreamDrain,
      utils.characters.list,
      waitForStreamDrain,
    ]
  );

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

  const processAttackMutation = trpc.combat.processPlayerAttack.useMutation({
    onSuccess: (result) => {
      refetchCombatState?.();

      if (result.isHit) {
        if (result.isDead) {
          toast.success(`💀 ${result.targetName} defeated!`);
          setPendingAttack(null);
          void postChatStream(result.mechanicalOutcome, { showPendingUser: true });
        } else if (result.damage !== undefined) {
          toast.success(`🎯 Hit! ${result.damage} damage dealt.`);
          setPendingAttack(null);
          void postChatStream(result.mechanicalOutcome, { showPendingUser: true });
        } else {
          // Hit but awaiting damage
          toast.info(`🎯 Hit! Roll damage.`);
          setPendingAttack(prev => prev ? { ...prev, awaitingDamage: true, attackRoll: result.attackRoll } : null);
        }
      } else {
        toast.info(`❌ Miss! (${result.attackRoll} vs AC ${result.targetAC})`);
        setPendingAttack(null);
        void postChatStream(result.mechanicalOutcome, { showPendingUser: true });
      }

      setAttackRollInput('');
      setDamageRollInput('');
    },
    onError: (error) => {
      toast.error('Attack failed: ' + error.message);
    },
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

  const handleMessagesScroll = useCallback(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distanceFromBottom <= SCROLL_STICK_BOTTOM_PX;
  }, []);

  // Scroll to bottom on new messages only while the user is following the tail
  useEffect(() => {
    if (!stickToBottomRef.current || !messagesContainerRef.current) return;
    const el = messagesContainerRef.current;
    el.scrollTop = el.scrollHeight;
  }, [messages, streamingText, pendingUserMessage]);

  useEffect(() => {
    stickToBottomRef.current = true;
  }, [sessionId]);

  useEffect(() => {
    return () => {
      stopStreamDrain({ reset: true });
    };
  }, [stopStreamDrain]);

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

    void postChatStream(userMessage, { showPendingUser: true });
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
  if (isSendingChat && !streamingText) {
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
  if (streamingText) {
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
        onScroll={handleMessagesScroll}
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
                        {'isStreaming' in msg && msg.isStreaming ? (
                          <div className="whitespace-pre-wrap break-words leading-relaxed [text-rendering:optimizeLegibility]">
                            {msg.content}
                          </div>
                        ) : (
                          <Streamdown>{msg.content}</Streamdown>
                        )}
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
                disabled={isSendingChat}
              />
              <div className="flex flex-col gap-2">
                <Button
                  onClick={handleSend}
                  disabled={isSendingChat || !message.trim()}
                  size="icon"
                  className="h-[60px] w-[60px]"
                >
                  {isSendingChat ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <Send className="h-5 w-5" />
                  )}
                </Button>
                <ContextViewer
                  sessionId={sessionId}
                  characterId={characterId}
                  currentMessage={message}
                />
              </div>
            </div>

            {/* Attack Roll Input Panel */}
            {combatState?.inCombat && pendingAttack && (
              <Card className="p-4 bg-destructive/5 border-destructive/30">
                <div className="flex items-center gap-2 mb-3">
                  <Dices className="h-5 w-5 text-destructive" />
                  <span className="font-semibold">
                    {pendingAttack.awaitingDamage
                      ? `Roll Damage vs ${pendingAttack.targetName}`
                      : `Attack Roll vs ${pendingAttack.targetName}`}
                  </span>
                </div>

                {!pendingAttack.awaitingDamage ? (
                  <div className="flex gap-2">
                    <Input
                      type="number"
                      placeholder="d20 + modifier"
                      value={attackRollInput}
                      onChange={(e) => setAttackRollInput(e.target.value)}
                      className="flex-1"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && attackRollInput) {
                          processAttackMutation.mutate({
                            sessionId: sessionId!,
                            targetName: pendingAttack.targetName,
                            attackRoll: parseInt(attackRollInput),
                          });
                        }
                      }}
                    />
                    <Button
                      onClick={() => {
                        if (attackRollInput) {
                          processAttackMutation.mutate({
                            sessionId: sessionId!,
                            targetName: pendingAttack.targetName,
                            attackRoll: parseInt(attackRollInput),
                          });
                        }
                      }}
                      disabled={!attackRollInput || processAttackMutation.isPending}
                    >
                      {processAttackMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Roll Attack'}
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => setPendingAttack(null)}
                    >
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <Input
                      type="number"
                      placeholder="Damage roll total"
                      value={damageRollInput}
                      onChange={(e) => setDamageRollInput(e.target.value)}
                      className="flex-1"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && damageRollInput) {
                          processAttackMutation.mutate({
                            sessionId: sessionId!,
                            targetName: pendingAttack.targetName,
                            attackRoll: pendingAttack.attackRoll!,
                            damageRoll: parseInt(damageRollInput),
                          });
                        }
                      }}
                    />
                    <Button
                      onClick={() => {
                        if (damageRollInput) {
                          processAttackMutation.mutate({
                            sessionId: sessionId!,
                            targetName: pendingAttack.targetName,
                            attackRoll: pendingAttack.attackRoll!,
                            damageRoll: parseInt(damageRollInput),
                          });
                        }
                      }}
                      disabled={!damageRollInput || processAttackMutation.isPending}
                    >
                      {processAttackMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Apply Damage'}
                    </Button>
                  </div>
                )}
              </Card>
            )}

            {/* Quick Attack Button during combat */}
            {combatState?.inCombat && !pendingAttack && combatState.combatants?.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {combatState.combatants
                  .filter((c: any) => c.type === 'enemy' && c.hpCurrent > 0)
                  .map((enemy: any) => (
                    <Button
                      key={enemy.id}
                      variant="outline"
                      size="sm"
                      onClick={() => setPendingAttack({ targetName: enemy.name, awaitingDamage: false })}
                      className="gap-1"
                    >
                      <Swords className="h-4 w-4" />
                      Attack {enemy.name}
                    </Button>
                  ))}
              </div>
            )}

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

