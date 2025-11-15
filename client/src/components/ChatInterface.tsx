import { useState, useEffect, useRef } from 'react';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';
import { Loader2, Send } from 'lucide-react';
import { toast } from 'sonner';
import { Streamdown } from 'streamdown';

interface ChatInterfaceProps {
  sessionId: number | null;
  characterId: number | null;
  characterName: string | null;
}

interface Message {
  id: number;
  sessionId: number;
  characterName: string;
  content: string;
  isDm: number;
  timestamp: Date | string;
}

export default function ChatInterface({ sessionId, characterId, characterName }: ChatInterfaceProps) {
  const [message, setMessage] = useState('');
  const [streamingText, setStreamingText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [pendingUserMessage, setPendingUserMessage] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const utils = trpc.useUtils();

  const { data: messages, isLoading, refetch } = trpc.messages.list.useQuery(
    { sessionId: sessionId!, limit: 100 },
    { enabled: !!sessionId }
  );

  const sendMutation = trpc.messages.send.useMutation({
    onSuccess: (data) => {
      // Clear pending user message since it's now in the database
      setPendingUserMessage(null);
      
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

  // Track if user has manually scrolled away from bottom
  const userScrolledAwayRef = useRef(false);
  
  // Smart auto-scroll: only scroll if user is already near the bottom
  const scrollToBottom = (force: boolean = false) => {
    if (!messagesContainerRef.current) return;
    
    const container = messagesContainerRef.current;
    const scrollHeight = container.scrollHeight;
    const scrollTop = container.scrollTop;
    const clientHeight = container.clientHeight;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    
    // Update scroll tracking
    userScrolledAwayRef.current = distanceFromBottom > 100;
    
    // Only auto-scroll if forced OR user is already at the bottom (within 100px)
    if (force || distanceFromBottom < 100) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      userScrolledAwayRef.current = false;
    }
  };

  // Separate effect for initial load
  useEffect(() => {
    if (messages && !isStreaming) {
      scrollToBottom(true); // Force scroll on initial load
    }
  }, [messages]);

  // During streaming, only scroll if user hasn't scrolled away
  useEffect(() => {
    if ((isStreaming || pendingUserMessage) && !userScrolledAwayRef.current) {
      scrollToBottom();
    }
  }, [streamingText, pendingUserMessage, isStreaming]);

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

  if (!sessionId) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">Select a campaign to start playing</p>
      </div>
    );
  }

  if (!characterId) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">Select or create a character to begin</p>
      </div>
    );
  }

  // Combine regular messages with pending user message, thinking indicator, and streaming message
  const allMessages: (Message | { id: string; characterName: string; content: string; isDm: number; timestamp: string; isStreaming?: boolean; isThinking?: boolean; isPending?: boolean })[] = [
    ...(messages || []),
  ];

  // Show pending user message immediately
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
        {isLoading ? (
          <div className="flex justify-center items-center h-full">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : allMessages.length > 0 ? (
          allMessages.map((msg) => (
            <Card
              key={'id' in msg && typeof msg.id === 'number' ? msg.id : ('id' in msg ? msg.id : 'unknown')}
              className={`p-4 ${
                msg.isDm ? 'bg-primary/5 border-primary/20' : 'bg-accent/50'
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
          ))
        ) : (
          <div className="flex justify-center items-center h-full">
            <p className="text-muted-foreground">No messages yet. Start the adventure!</p>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="border-t p-4">
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
      </div>
    </div>
  );
}
