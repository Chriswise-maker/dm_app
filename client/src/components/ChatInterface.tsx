import { useState, useEffect, useRef, useCallback } from 'react';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Streamdown } from 'streamdown';
import { useCombatState } from '@/hooks/combat/useCombatState';
import InitiativeDisplay from '@/components/combat/InitiativeDisplay';
import ContextViewer from '@/components/ContextViewer';
import { Input } from '@/components/ui/input';
import RevealText from '@/components/RevealText';

/** Steady stream reveal — ChatGPT / Claude speed. */
const STREAM_REVEAL_CHARS_PER_SECOND = 350;

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
  const stickToBottomRef = useRef(true);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const streamTargetTextRef = useRef('');
  const streamDisplayedLengthRef = useRef(0);
  const streamDrainRafRef = useRef<number | null>(null);
  const streamLastFrameRef = useRef<number | null>(null);
  const streamDrainResolveRef = useRef<(() => void) | null>(null);
  const streamDrainCarryRef = useRef(0);
  const seenMessageIdsRef = useRef<Set<number>>(new Set());
  const [revealQueue, setRevealQueue] = useState<number[]>([]);
  const currentRevealId = revealQueue[0] ?? null;
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

  // Combat state
  const [showEnemyDialog, setShowEnemyDialog] = useState(false);

  const { data: combatV2State } = trpc.combatV2.getState.useQuery(
    { sessionId: sessionId! },
    { enabled: !!sessionId, refetchInterval: 3000 }
  );
  const isInCombat = combatState?.inCombat ||
    (combatV2State?.phase != null && combatV2State.phase !== 'IDLE' && combatV2State.phase !== 'RESOLVED');

  const { data: messages, isLoading, refetch } = trpc.messages.list.useQuery(
    { sessionId: sessionId!, limit: 100 },
    { enabled: !!sessionId, refetchInterval: isInCombat ? 2000 : false }
  );

  const seenSeededRef = useRef(false);
  useEffect(() => {
    seenMessageIdsRef.current = new Set();
    seenSeededRef.current = false;
    setRevealQueue([]);
  }, [sessionId]);
  useEffect(() => {
    if (!seenSeededRef.current && messages && messages.length > 0) {
      for (const m of messages) {
        seenMessageIdsRef.current.add(m.id);
      }
      seenSeededRef.current = true;
      return;
    }
    if (seenSeededRef.current && messages) {
      const newIds: number[] = [];
      for (const m of messages) {
        if (m.isDm && !seenMessageIdsRef.current.has(m.id)) {
          newIds.push(m.id);
        }
        if (!m.isDm && !seenMessageIdsRef.current.has(m.id)) {
          seenMessageIdsRef.current.add(m.id);
        }
      }
      if (newIds.length > 0) {
        setRevealQueue(prev => {
          const existing = new Set(prev);
          const toAdd = newIds.filter(id => !existing.has(id));
          return toAdd.length > 0 ? [...prev, ...toAdd] : prev;
        });
      }
    }
  }, [messages]);

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
                      `Combat initiated! ${ev.enemiesAdded ?? 0} ${(ev.enemiesAdded ?? 0) === 1 ? 'enemy' : 'enemies'} appeared!`
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
          toast.success(`${result.targetName} defeated!`);
          setPendingAttack(null);
          void postChatStream(result.mechanicalOutcome, { showPendingUser: true });
        } else if (result.damage !== undefined) {
          toast.success(`Hit! ${result.damage} damage dealt.`);
          setPendingAttack(null);
          void postChatStream(result.mechanicalOutcome, { showPendingUser: true });
        } else {
          toast.info(`Hit! Roll damage.`);
          setPendingAttack(prev => prev ? { ...prev, awaitingDamage: true, attackRoll: result.attackRoll } : null);
        }
      } else {
        toast.info(`Miss! (${result.attackRoll} vs AC ${result.targetAC})`);
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

      setAudioCache(prev => new Map(prev).set(messageId, audioUrl));

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
    if (playingMessageId === messageId) {
      handleStopTTS();
      return;
    }

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
      await initiateCombat.mutateAsync({ sessionId });

      toast.info('Generating enemies for this encounter...');

      const result = await generateEnemiesMutation.mutateAsync({ sessionId });

      if (result.success && result.count > 0) {
        toast.success(`${result.count} ${result.count === 1 ? 'enemy' : 'enemies'} appeared!`);
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
      const characters = await utils.characters.list.fetch({ sessionId });
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
      const characters = await utils.characters.list.fetch({ sessionId });
      const character = characters.find(c => c.name.toLowerCase() === characterName.toLowerCase());

      if (!character) {
        toast.error(`Character ${characterName} not found`);
        return;
      }

      await addPlayer.mutateAsync({
        sessionId,
        characterId: character.id,
        initiative,
      });

      setAwaitingInitiativeFrom(prev => prev.filter(n => n !== characterName));

      toast.success(`${characterName} added to combat with initiative ${initiative}`);

      const updatedAwaiting = awaitingInitiativeFrom.filter(n => n !== characterName);
      if (updatedAwaiting.length === 0) {
        await sortInitiative.mutateAsync({ sessionId });
        refetchCombatState?.();
        toast.success('Combat begins!');
      }
    } catch (error: any) {
      toast.error('Failed to add character to combat: ' + error.message);
    }
  };

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
        <p className="font-serif text-xl italic text-ghost">Select a campaign to begin your chronicle</p>
      </div>
    );
  }

  // Combine history messages with pending/streaming messages
  const allMessages: (Message | { id: string; characterName: string; content: string; isDm: number; timestamp: string; isStreaming?: boolean; isThinking?: boolean; isPending?: boolean })[] = [
    ...(messages || []),
  ];

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
    <div className="flex flex-col h-full relative">
      {/* Messages Area — The Narrative Scroll */}
      <div
        ref={messagesContainerRef}
        onScroll={handleMessagesScroll}
        className="flex-1 overflow-y-auto px-8 py-6 space-y-12"
      >
        {isLoading ? (
          <div className="flex justify-center items-center h-full">
            <Loader2 className="h-6 w-6 animate-spin text-ghost" />
          </div>
        ) : allMessages.length > 0 ? (
          allMessages.map((msg) => {
            const messageId = 'id' in msg && typeof msg.id === 'number' ? msg.id : null;
            const isTTSEnabled = settings?.ttsEnabled && settings?.ttsApiKey && msg.isDm;
            const isCurrentlyPlaying = messageId && playingMessageId === messageId;
            const isTTSLoading = ttsMutation.isPending && (ttsMutation.variables as any)?.messageId === messageId;

            return (
              <div
                key={messageId || ('id' in msg ? msg.id : 'unknown')}
                className={`max-w-3xl ${msg.isDm ? '' : 'ml-auto'} ${'isPending' in msg && msg.isPending ? 'opacity-60' : ''}`}
              >
                {/* Speaker attribution */}
                <div className="flex items-center gap-3 mb-3">
                  {msg.isDm ? (
                    <span className="font-sans text-[9px] tracking-[0.3em] uppercase text-brass">
                      The Archivist
                    </span>
                  ) : (
                    <span className="font-sans text-[9px] tracking-[0.3em] uppercase text-ghost">
                      {msg.characterName}
                    </span>
                  )}
                  <span className="font-sans text-[9px] text-ghost/40">
                    {typeof msg.timestamp === 'string'
                      ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                      : msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  {isTTSEnabled && messageId && !('isThinking' in msg) && msg.content && (
                    <button
                      onClick={() => handlePlayTTS(messageId, msg.content)}
                      disabled={isTTSLoading}
                      className="font-sans text-[9px] tracking-[0.2em] uppercase text-ghost hover:text-vellum transition-colors ml-auto"
                    >
                      {isTTSLoading ? 'Generating...' : isCurrentlyPlaying ? 'Silence' : 'Listen'}
                    </button>
                  )}
                </div>

                {/* Message content */}
                {'isThinking' in msg && msg.isThinking ? (
                  <div className="font-serif italic text-ghost">
                    <span>The Archivist contemplates</span>
                    <span className="inline-flex gap-1 ml-1">
                      <span className="animate-bounce" style={{ animationDelay: '0ms' }}>.</span>
                      <span className="animate-bounce" style={{ animationDelay: '150ms' }}>.</span>
                      <span className="animate-bounce" style={{ animationDelay: '300ms' }}>.</span>
                    </span>
                  </div>
                ) : msg.isDm ? (
                  <div className="prose prose-invert max-w-none font-serif text-lg leading-[2] text-foreground/90">
                    {'isStreaming' in msg && msg.isStreaming ? (
                      <div className="whitespace-pre-wrap break-words [text-rendering:optimizeLegibility]">
                        {msg.content}
                      </div>
                    ) : (() => {
                      const numId = typeof msg.id === 'number' ? msg.id : null;
                      if (numId != null && numId === currentRevealId) {
                        return (
                          <RevealText
                            content={msg.content}
                            onRevealComplete={() => {
                              seenMessageIdsRef.current.add(numId);
                              setRevealQueue(prev => prev.slice(1));
                            }}
                          />
                        );
                      }
                      if (numId != null && revealQueue.includes(numId)) {
                        return null;
                      }
                      return <Streamdown>{msg.content}</Streamdown>;
                    })()}
                  </div>
                ) : (
                  <div className="font-serif text-base italic text-ghost leading-relaxed">
                    <Streamdown>{msg.content}</Streamdown>
                  </div>
                )}
              </div>
            );
          })
        ) : (
          <div className="flex flex-col justify-center items-center h-full gap-4">
            <p className="font-serif text-3xl tracking-tighter text-vellum">Begin Your Chronicle</p>
            <p className="font-serif italic text-ghost">The pages await your first words</p>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area — Receded Player Intent */}
      <div className="bg-gradient-to-t from-background via-background to-transparent pt-12 pb-6 px-8">
        {characterId ? (
          <div className="space-y-3">
            <input
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={handleKeyPress}
              placeholder="Declare your intent..."
              disabled={isSendingChat}
              className="w-full bg-transparent border-b border-border focus:border-vellum focus:outline-none font-serif text-lg py-3 transition-all placeholder:italic placeholder:text-ghost/40"
            />
            <div className="flex items-center justify-end gap-6">
              <ContextViewer
                sessionId={sessionId}
                characterId={characterId}
                currentMessage={message}
              />
              {!combatState?.inCombat && (
                <button
                  onClick={handleCombatInitiation}
                  disabled={initiateCombat.isPending}
                  className="font-sans text-[10px] tracking-[0.2em] uppercase text-ghost hover:text-brass transition-colors"
                >
                  {initiateCombat.isPending ? 'Initiating...' : 'Begin Combat'}
                </button>
              )}
              <button
                onClick={handleSend}
                disabled={isSendingChat || !message.trim()}
                className="font-sans text-[10px] tracking-[0.2em] uppercase text-ghost hover:text-vellum transition-colors disabled:opacity-30"
              >
                {isSendingChat ? 'Inscribing...' : 'Submit'}
              </button>
            </div>

            {/* Attack Roll Input Panel */}
            {combatState?.inCombat && pendingAttack && (
              <div className="p-4 bg-surface-high">
                <div className="flex items-center gap-2 mb-3">
                  <span className="font-sans text-[10px] tracking-[0.2em] uppercase text-destructive font-bold">
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
                      className="flex-1 bg-transparent border-b border-border focus:border-vellum"
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
                      variant="ghost"
                      className="font-sans text-xs uppercase tracking-wider"
                    >
                      {processAttackMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Roll Attack'}
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => setPendingAttack(null)}
                      className="font-sans text-xs uppercase tracking-wider text-ghost"
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
                      className="flex-1 bg-transparent border-b border-border focus:border-vellum"
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
                      variant="ghost"
                      className="font-sans text-xs uppercase tracking-wider"
                    >
                      {processAttackMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Apply Damage'}
                    </Button>
                  </div>
                )}
              </div>
            )}

            {/* Quick Attack Buttons during combat */}
            {combatState?.inCombat && !pendingAttack && combatState.combatants?.length > 0 && (
              <div className="flex flex-wrap gap-4">
                {combatState.combatants
                  .filter((c: any) => c.type === 'enemy' && c.hpCurrent > 0)
                  .map((enemy: any) => (
                    <button
                      key={enemy.id}
                      onClick={() => setPendingAttack({ targetName: enemy.name, awaitingDamage: false })}
                      className="font-sans text-[10px] tracking-[0.2em] uppercase text-destructive hover:text-vellum transition-colors"
                    >
                      Attack {enemy.name}
                    </button>
                  ))}
              </div>
            )}
          </div>
        ) : (
          <button
            onClick={onCreateCharacter}
            className="w-full font-serif text-xl text-vellum hover:text-brass transition-colors py-6"
          >
            Create a Character to Enter the Chronicle
          </button>
        )}
      </div>
    </div>
  );
}
