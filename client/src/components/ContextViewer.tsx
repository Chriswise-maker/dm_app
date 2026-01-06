import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Eye, Loader2, Copy, Check, Swords } from 'lucide-react';
import { toast } from 'sonner';

interface ContextViewerProps {
    sessionId: number;
    characterId: number;
    currentMessage: string;
}

export default function ContextViewer({ sessionId, characterId, currentMessage }: ContextViewerProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [copied, setCopied] = useState<string | null>(null);

    const { data, isLoading, error, refetch } = trpc.messages.previewContext.useQuery(
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

    // Combat log query
    const { data: combatLogData, refetch: refetchCombatLog } = trpc.combat.getCombatLog.useQuery(
        { sessionId, limit: 20 },
        {
            enabled: isOpen,
            refetchOnWindowFocus: false,
        }
    );

    const copyToClipboard = (text: string, label: string) => {
        navigator.clipboard.writeText(text);
        setCopied(label);
        toast.success(`${label} copied to clipboard`);
        setTimeout(() => setCopied(null), 2000);
    };

    const estimateTokens = (text: string) => Math.ceil(text.length / 4);

    return (
        <Dialog open={isOpen} onOpenChange={(open) => {
            setIsOpen(open);
            if (open) refetch();
        }}>
            <DialogTrigger asChild>
                <Button variant="ghost" size="icon" title="View AI Context (Debug)">
                    <Eye className="h-4 w-4 text-muted-foreground" />
                </Button>
            </DialogTrigger>
            <DialogContent className="max-w-4xl h-[80vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        AI Context Viewer
                        {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                    </DialogTitle>
                </DialogHeader>

                <Tabs defaultValue="user-context" className="flex-1 flex flex-col min-h-0">
                    <TabsList className="grid w-full grid-cols-4">
                        <TabsTrigger value="user-context">User Context</TabsTrigger>
                        <TabsTrigger value="system-prompt">System Prompt</TabsTrigger>
                        <TabsTrigger value="db-state">Database State</TabsTrigger>
                        <TabsTrigger value="combat-log">Combat Log</TabsTrigger>
                    </TabsList>

                    <TabsContent value="user-context" className="flex-1 min-h-0 relative">
                        {data ? (
                            <div className="h-full flex flex-col">
                                <div className="flex justify-between items-center py-2 px-1 text-xs text-muted-foreground bg-muted/30 rounded-t-md border-x border-t">
                                    <span>Estimated Tokens: ~{estimateTokens(data.enrichedPrompt)}</span>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-6 gap-1"
                                        onClick={() => copyToClipboard(data.enrichedPrompt, 'User Context')}
                                    >
                                        {copied === 'User Context' ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                                        Copy
                                    </Button>
                                </div>
                                <ScrollArea className="flex-1 border rounded-b-md bg-muted/10 p-4 font-mono text-xs whitespace-pre-wrap overflow-auto">
                                    {data.enrichedPrompt}
                                </ScrollArea>
                            </div>
                        ) : error ? (
                            <div className="flex items-center justify-center h-full text-destructive p-4 text-center">
                                Error loading context: {error.message}
                            </div>
                        ) : (
                            <div className="flex items-center justify-center h-full text-muted-foreground">
                                Loading context...
                            </div>
                        )}
                    </TabsContent>

                    <TabsContent value="system-prompt" className="flex-1 min-h-0 relative">
                        {data ? (
                            <div className="h-full flex flex-col">
                                <div className="flex justify-between items-center py-2 px-1 text-xs text-muted-foreground bg-muted/30 rounded-t-md border-x border-t">
                                    <span>Estimated Tokens: ~{estimateTokens(data.systemPrompt)}</span>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-6 gap-1"
                                        onClick={() => copyToClipboard(data.systemPrompt, 'System Prompt')}
                                    >
                                        {copied === 'System Prompt' ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                                        Copy
                                    </Button>
                                </div>
                                <ScrollArea className="flex-1 border rounded-b-md bg-muted/10 p-4 font-mono text-xs whitespace-pre-wrap overflow-auto">
                                    {data.systemPrompt}
                                </ScrollArea>
                            </div>
                        ) : error ? (
                            <div className="flex items-center justify-center h-full text-destructive p-4 text-center">
                                Error loading prompt: {error.message}
                            </div>
                        ) : (
                            <div className="flex items-center justify-center h-full text-muted-foreground">
                                Loading prompt...
                            </div>
                        )}
                    </TabsContent>

                    <TabsContent value="db-state" className="flex-1 min-h-0 relative">
                        {data ? (
                            <div className="h-full flex flex-col">
                                <div className="flex justify-between items-center py-2 px-1 text-xs text-muted-foreground bg-muted/30 rounded-t-md border-x border-t">
                                    <span>Raw JSON Data</span>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-6 gap-1"
                                        onClick={() => copyToClipboard(JSON.stringify(data.databaseState, null, 2), 'Database State')}
                                    >
                                        {copied === 'Database State' ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                                        Copy
                                    </Button>
                                </div>
                                <ScrollArea className="flex-1 border rounded-b-md bg-muted/10 p-4 font-mono text-xs whitespace-pre-wrap overflow-auto">
                                    {JSON.stringify(data.databaseState, null, 2)}
                                </ScrollArea>
                            </div>
                        ) : error ? (
                            <div className="flex items-center justify-center h-full text-destructive p-4 text-center">
                                Error loading state: {error.message}
                            </div>
                        ) : (
                            <div className="flex items-center justify-center h-full text-muted-foreground">
                                Loading state...
                            </div>
                        )}
                    </TabsContent>

                    <TabsContent value="combat-log" className="flex-1 min-h-0 relative">
                        <div className="h-full flex flex-col">
                            <div className="flex justify-between items-center py-2 px-1 text-xs text-muted-foreground bg-muted/30 rounded-t-md border-x border-t">
                                <span className="flex items-center gap-1">
                                    <Swords className="h-3 w-3" />
                                    Recent Combat Actions
                                </span>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-6"
                                    onClick={() => refetchCombatLog()}
                                >
                                    Refresh
                                </Button>
                            </div>
                            <ScrollArea className="flex-1 border rounded-b-md bg-muted/10 p-4 overflow-auto">
                                {combatLogData?.log && combatLogData.log.length > 0 ? (
                                    <div className="space-y-2">
                                        {combatLogData.log.map((entry: any) => (
                                            <div
                                                key={entry.id}
                                                className={`p-2 rounded text-xs font-mono ${entry.outcome === 'killed'
                                                        ? 'bg-destructive/20 border-destructive/30'
                                                        : entry.outcome === 'hit'
                                                            ? 'bg-green-500/10 border-green-500/30'
                                                            : 'bg-muted border-border'
                                                    } border`}
                                            >
                                                <div className="flex justify-between items-start">
                                                    <span className="font-semibold">
                                                        R{entry.round}: {entry.actorName} → {entry.targetName}
                                                    </span>
                                                    <span className={`text-xs px-1 rounded ${entry.outcome === 'hit' || entry.outcome === 'killed'
                                                            ? 'bg-green-500/20 text-green-700'
                                                            : 'bg-red-500/20 text-red-700'
                                                        }`}>
                                                        {entry.outcome?.toUpperCase()}
                                                    </span>
                                                </div>
                                                <div className="text-muted-foreground mt-1">
                                                    Roll: {entry.rollResult}
                                                    {entry.damageDealt && ` | Damage: ${entry.damageDealt}`}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="flex items-center justify-center h-full text-muted-foreground">
                                        No combat actions logged yet.
                                    </div>
                                )}
                            </ScrollArea>
                        </div>
                    </TabsContent>
                </Tabs>
            </DialogContent>
        </Dialog>
    );
}
