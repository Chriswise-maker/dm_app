import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Eye, Loader2, Copy, Check, RefreshCw, Swords, Brain, Activity, User } from 'lucide-react';
import { toast } from 'sonner';

interface ContextViewerProps {
    sessionId: number;
    characterId: number;
    currentMessage: string;
}

// Activity type icons and colors
const activityConfig: Record<string, { icon: string; color: string }> = {
    parser: { icon: '🎯', color: 'text-blue-400' },
    engine: { icon: '⚔️', color: 'text-orange-400' },
    roll: { icon: '🎲', color: 'text-purple-400' },
    damage: { icon: '💥', color: 'text-red-400' },
    death: { icon: '💀', color: 'text-red-600' },
    ai: { icon: '🤖', color: 'text-green-400' },
    llm: { icon: '🧠', color: 'text-cyan-400' },
    narrator: { icon: '🎭', color: 'text-yellow-400' },
    system: { icon: '📢', color: 'text-gray-400' },
    error: { icon: '❌', color: 'text-red-500' },
};

export default function ContextViewer({ sessionId, characterId, currentMessage }: ContextViewerProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [copied, setCopied] = useState<string | null>(null);

    // LLM Context query (combines user + system)
    const { data: contextData, isLoading: contextLoading, refetch: refetchContext } = trpc.messages.previewContext.useQuery(
        {
            sessionId,
            characterId,
            message: currentMessage || undefined,
        },
        {
            enabled: isOpen,
            refetchOnWindowFocus: false,
            retry: false,
        }
    );

    // Combat state query (Game State tab)
    const { data: combatState, refetch: refetchCombat } = trpc.combatV2.getState.useQuery(
        { sessionId },
        {
            enabled: isOpen,
            refetchOnWindowFocus: false,
            retry: false,
        }
    );

    // Activity log query
    const { data: activityData, refetch: refetchActivity } = trpc.messages.getActivityLog.useQuery(
        { sessionId, limit: 50 },
        {
            enabled: isOpen,
            refetchOnWindowFocus: false,
            refetchInterval: 2000, // Auto-refresh every 2s when open
        }
    );

    const copyToClipboard = (text: string, label: string) => {
        navigator.clipboard.writeText(text);
        setCopied(label);
        toast.success(`${label} copied to clipboard`);
        setTimeout(() => setCopied(null), 2000);
    };

    const estimateTokens = (text: string) => Math.ceil(text.length / 4);

    const formatTimestamp = (timestamp: number) => {
        const date = new Date(timestamp);
        return date.toLocaleTimeString('en-US', { hour12: false });
    };

    return (
        <Dialog open={isOpen} onOpenChange={(open) => {
            setIsOpen(open);
            if (open) {
                refetchContext();
                refetchCombat();
                refetchActivity();
            }
        }}>
            <DialogTrigger asChild>
                <Button variant="ghost" size="icon" title="View AI Context (Debug)">
                    <Eye className="h-4 w-4 text-muted-foreground" />
                </Button>
            </DialogTrigger>
            <DialogContent className="max-w-4xl h-[80vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        Debug Viewer
                        {contextLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                    </DialogTitle>
                </DialogHeader>

                <Tabs defaultValue="activity" className="flex-1 flex flex-col min-h-0">
                    <TabsList className="grid w-full grid-cols-3">
                        <TabsTrigger value="activity" className="flex items-center gap-1">
                            <Activity className="h-3 w-3" />
                            Activity
                        </TabsTrigger>
                        <TabsTrigger value="game-state" className="flex items-center gap-1">
                            <Swords className="h-3 w-3" />
                            Game State
                        </TabsTrigger>
                        <TabsTrigger value="llm-context" className="flex items-center gap-1">
                            <Brain className="h-3 w-3" />
                            LLM Context
                        </TabsTrigger>
                    </TabsList>

                    {/* Activity Log Tab */}
                    <TabsContent value="activity" className="flex-1 min-h-0 relative">
                        <div className="h-full flex flex-col">
                            <div className="flex justify-between items-center py-2 px-1 text-xs text-muted-foreground bg-muted/30 rounded-t-md border-x border-t">
                                <span className="flex items-center gap-1">
                                    <Activity className="h-3 w-3" />
                                    Backend Activity Feed
                                </span>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-6"
                                    onClick={() => refetchActivity()}
                                >
                                    <RefreshCw className="h-3 w-3 mr-1" />
                                    Refresh
                                </Button>
                            </div>
                            <ScrollArea className="flex-1 border rounded-b-md bg-muted/10 p-2 overflow-auto">
                                {activityData?.entries && activityData.entries.length > 0 ? (
                                    <div className="space-y-1 font-mono text-xs">
                                        {activityData.entries.map((entry: any) => {
                                            const config = activityConfig[entry.type] || { icon: '📌', color: 'text-gray-400' };
                                            return (
                                                <div
                                                    key={entry.id}
                                                    className="flex items-start gap-2 py-1 border-b border-border/50 last:border-0"
                                                >
                                                    <span className="text-muted-foreground whitespace-nowrap">
                                                        [{formatTimestamp(entry.timestamp)}]
                                                    </span>
                                                    <span>{config.icon}</span>
                                                    <span className={config.color}>{entry.message}</span>
                                                </div>
                                            );
                                        })}
                                    </div>
                                ) : (
                                    <div className="flex items-center justify-center h-full text-muted-foreground">
                                        No activity logged yet. Events will appear here during gameplay.
                                    </div>
                                )}
                            </ScrollArea>
                        </div>
                    </TabsContent>

                    {/* Game State Tab */}
                    <TabsContent value="game-state" className="flex-1 min-h-0 relative">
                        <div className="h-full flex flex-col">
                            <div className="flex justify-between items-center py-2 px-1 text-xs text-muted-foreground bg-muted/30 rounded-t-md border-x border-t">
                                <span className="flex items-center gap-1">
                                    <Swords className="h-3 w-3" />
                                    Current Game State
                                </span>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-6 gap-1"
                                    onClick={() => copyToClipboard(JSON.stringify(combatState, null, 2), 'Game State')}
                                >
                                    {copied === 'Game State' ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                                    Copy JSON
                                </Button>
                            </div>
                            <ScrollArea className="flex-1 border rounded-b-md bg-muted/10 p-4 overflow-auto">
                                {combatState ? (
                                    <div className="space-y-4">
                                        {/* Combat Status */}
                                        <div className="p-3 rounded-md bg-muted/20 border">
                                            <h3 className="font-semibold text-sm mb-2 flex items-center gap-2">
                                                <Swords className="h-4 w-4" />
                                                Combat Status
                                            </h3>
                                            <div className="grid grid-cols-2 gap-2 text-xs">
                                                <div>
                                                    <span className="text-muted-foreground">Phase:</span>{' '}
                                                    <span className={combatState.phase === 'ACTIVE' ? 'text-green-400 font-bold' : ''}>
                                                        {combatState.phase}
                                                    </span>
                                                </div>
                                                <div>
                                                    <span className="text-muted-foreground">Round:</span> {combatState.round}
                                                </div>
                                                <div>
                                                    <span className="text-muted-foreground">Current Turn:</span>{' '}
                                                    {combatState.entities[combatState.turnIndex]?.name || 'N/A'}
                                                </div>
                                            </div>
                                        </div>

                                        {/* Entities */}
                                        {combatState.entities && combatState.entities.length > 0 && (
                                            <div className="p-3 rounded-md bg-muted/20 border">
                                                <h3 className="font-semibold text-sm mb-2 flex items-center gap-2">
                                                    <User className="h-4 w-4" />
                                                    Entities ({combatState.entities.length})
                                                </h3>
                                                <div className="space-y-2">
                                                    {combatState.entities.map((entity: any, idx: number) => (
                                                        <div
                                                            key={entity.id}
                                                            className={`p-2 rounded text-xs ${idx === combatState.turnIndex
                                                                    ? 'bg-green-500/20 border-green-500/50 border'
                                                                    : 'bg-muted/30'
                                                                } ${entity.status === 'DEAD' ? 'opacity-50 line-through' : ''}`}
                                                        >
                                                            <div className="flex justify-between">
                                                                <span className="font-medium">
                                                                    {idx === combatState.turnIndex && '→ '}
                                                                    {entity.name}
                                                                    <span className="text-muted-foreground ml-1">
                                                                        ({entity.type})
                                                                    </span>
                                                                </span>
                                                                <span className={entity.hp <= 0 ? 'text-red-400' : ''}>
                                                                    HP: {entity.hp}/{entity.maxHp}
                                                                </span>
                                                            </div>
                                                            <div className="text-muted-foreground mt-1">
                                                                AC: {entity.baseAC} | Status: {entity.status}
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {/* Combat Log */}
                                        {combatState.log && combatState.log.length > 0 && (
                                            <div className="p-3 rounded-md bg-muted/20 border">
                                                <h3 className="font-semibold text-sm mb-2">
                                                    Combat Log ({combatState.log.length} entries)
                                                </h3>
                                                <div className="space-y-1 font-mono text-xs max-h-48 overflow-y-auto">
                                                    {combatState.log.slice(-10).map((entry: any) => (
                                                        <div key={entry.id} className="text-muted-foreground">
                                                            [{entry.type}] {entry.description || JSON.stringify(entry)}
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <div className="flex items-center justify-center h-full text-muted-foreground">
                                        No combat active
                                    </div>
                                )}
                            </ScrollArea>
                        </div>
                    </TabsContent>

                    {/* LLM Context Tab */}
                    <TabsContent value="llm-context" className="flex-1 min-h-0 relative">
                        {contextData ? (
                            <div className="h-full flex flex-col gap-4">
                                {/* System Prompt */}
                                <div className="flex flex-col min-h-0 flex-1">
                                    <div className="flex justify-between items-center py-2 px-1 text-xs text-muted-foreground bg-muted/30 rounded-t-md border-x border-t">
                                        <span>System Prompt (~{estimateTokens(contextData.systemPrompt)} tokens)</span>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            className="h-6 gap-1"
                                            onClick={() => copyToClipboard(contextData.systemPrompt, 'System Prompt')}
                                        >
                                            {copied === 'System Prompt' ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                                            Copy
                                        </Button>
                                    </div>
                                    <ScrollArea className="flex-1 border rounded-b-md bg-muted/10 p-3 font-mono text-xs whitespace-pre-wrap overflow-auto max-h-40">
                                        {contextData.systemPrompt}
                                    </ScrollArea>
                                </div>

                                {/* User Context */}
                                <div className="flex flex-col min-h-0 flex-1">
                                    <div className="flex justify-between items-center py-2 px-1 text-xs text-muted-foreground bg-muted/30 rounded-t-md border-x border-t">
                                        <span>User Context (~{estimateTokens(contextData.enrichedPrompt)} tokens)</span>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            className="h-6 gap-1"
                                            onClick={() => copyToClipboard(contextData.enrichedPrompt, 'User Context')}
                                        >
                                            {copied === 'User Context' ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                                            Copy
                                        </Button>
                                    </div>
                                    <ScrollArea className="flex-1 border rounded-b-md bg-muted/10 p-3 font-mono text-xs whitespace-pre-wrap overflow-auto">
                                        {contextData.enrichedPrompt}
                                    </ScrollArea>
                                </div>
                            </div>
                        ) : (
                            <div className="flex items-center justify-center h-full text-muted-foreground">
                                Loading context...
                            </div>
                        )}
                    </TabsContent>
                </Tabs>
            </DialogContent>
        </Dialog>
    );
}
