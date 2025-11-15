import { useState, useEffect } from 'react';
import { trpc } from '@/lib/trpc';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const DEFAULT_SYSTEM_PROMPT = `You are an expert Dungeon Master for D&D 5th Edition.

Your role is to:
- Create immersive, engaging narratives that respond to player actions
- Maintain consistency with established game state, character conditions, and previous events
- Apply D&D 5e rules accurately for combat, skill checks, and abilities
- Describe scenes vividly with sensory details (sights, sounds, smells)
- Present meaningful choices and consequences
- Balance challenge with fun - neither too easy nor frustratingly difficult

During combat:
- Clearly state damage dealt and to whom
- Track and mention HP changes
- Describe attacks and their effects cinematically
- Maintain initiative order and turn structure

For roleplay:
- Give NPCs distinct personalities and motivations
- Respond authentically to character actions and dialogue
- Create memorable moments and emotional beats
- Reward creative problem-solving

Tone: Epic fantasy with moments of humor, tension, and wonder. Adapt to the party's preferred style (serious, lighthearted, gritty, etc.).`;

const MODEL_OPTIONS = {
  manus: [
    { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash (Default)' },
    { value: 'gpt-4o', label: 'GPT-4o' },
    { value: 'claude-3.5-sonnet', label: 'Claude 3.5 Sonnet' },
  ],
  openai: [
    { value: 'gpt-5', label: 'GPT-5' },
    { value: 'gpt-4o', label: 'GPT-4o' },
    { value: 'gpt-4o-mini', label: 'GPT-4o Mini' },
    { value: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
    { value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo' },
  ],
  anthropic: [
    { value: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5' },
    { value: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet' },
    { value: 'claude-3-5-haiku-20241022', label: 'Claude 3.5 Haiku' },
    { value: 'claude-3-opus-20240229', label: 'Claude 3 Opus' },
  ],
  google: [
    { value: 'gemini-2.0-flash-exp', label: 'Gemini 2.0 Flash' },
    { value: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' },
    { value: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash' },
  ],
};

export default function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const { data: settings, isLoading } = trpc.settings.get.useQuery(undefined, {
    enabled: open,
  });
  
  const updateSettings = trpc.settings.update.useMutation({
    onSuccess: () => {
      toast.success('Settings saved successfully');
      onOpenChange(false);
    },
    onError: (error) => {
      toast.error(`Failed to save settings: ${error.message}`);
    },
  });

  const [llmProvider, setLlmProvider] = useState<'manus' | 'openai' | 'anthropic' | 'google'>('manus');
  const [llmModel, setLlmModel] = useState<string>('');
  const [llmApiKey, setLlmApiKey] = useState<string>('');
  const [ttsEnabled, setTtsEnabled] = useState(false);
  const [ttsProvider, setTtsProvider] = useState<string>('');
  const [ttsVoice, setTtsVoice] = useState<string>('');
  const [ttsApiKey, setTtsApiKey] = useState<string>('');
  const [systemPrompt, setSystemPrompt] = useState<string>(DEFAULT_SYSTEM_PROMPT);

  useEffect(() => {
    if (settings) {
      setLlmProvider(settings.llmProvider);
      setLlmModel(settings.llmModel || '');
      setLlmApiKey(settings.llmApiKey || '');
      setTtsEnabled(settings.ttsEnabled);
      setTtsProvider(settings.ttsProvider || '');
      setTtsVoice(settings.ttsVoice || '');
      setTtsApiKey(settings.ttsApiKey || '');
      setSystemPrompt(settings.systemPrompt || DEFAULT_SYSTEM_PROMPT);
    }
  }, [settings]);

  const handleSave = () => {
    updateSettings.mutate({
      llmProvider,
      llmModel: llmModel || null,
      llmApiKey: llmApiKey || null,
      ttsEnabled,
      ttsProvider: ttsProvider || null,
      ttsVoice: ttsVoice || null,
      ttsApiKey: ttsApiKey || null,
      systemPrompt: systemPrompt || null,
    });
  };

  const availableModels = MODEL_OPTIONS[llmProvider] || [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Configure your LLM provider and text-to-speech preferences
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <Tabs defaultValue="llm" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="llm">LLM Configuration</TabsTrigger>
              <TabsTrigger value="dm">DM Personality</TabsTrigger>
              <TabsTrigger value="tts">Text-to-Speech</TabsTrigger>
            </TabsList>

            <TabsContent value="llm" className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label htmlFor="provider">Provider</Label>
                <Select
                  value={llmProvider}
                  onValueChange={(value: any) => {
                    setLlmProvider(value);
                    setLlmModel(''); // Reset model when provider changes
                  }}
                >
                  <SelectTrigger id="provider">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="manus">Manus Built-in (No API key needed)</SelectItem>
                    <SelectItem value="openai">OpenAI</SelectItem>
                    <SelectItem value="anthropic">Anthropic (Claude)</SelectItem>
                    <SelectItem value="google">Google (Gemini)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-sm text-muted-foreground">
                  {llmProvider === 'manus' 
                    ? 'Using Manus built-in API - no API key required. Currently using Gemini 2.5 Flash.'
                    : 'You will need to provide your own API key for this provider.'}
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="model">Model</Label>
                <Select
                  value={llmModel}
                  onValueChange={setLlmModel}
                >
                  <SelectTrigger id="model">
                    <SelectValue placeholder="Select a model" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableModels.map((model) => (
                      <SelectItem key={model.value} value={model.value}>
                        {model.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {llmProvider !== 'manus' && (
                <div className="space-y-2">
                  <Label htmlFor="apiKey">API Key</Label>
                  <Input
                    id="apiKey"
                    type="password"
                    value={llmApiKey}
                    onChange={(e) => setLlmApiKey(e.target.value)}
                    placeholder="sk-..."
                  />
                  <p className="text-sm text-muted-foreground">
                    Your API key is stored securely and only used for API calls.
                  </p>
                </div>
              )}

              <div className="rounded-lg border border-blue-500/20 bg-blue-500/10 p-4">
                <h4 className="font-semibold text-sm mb-2">Current Configuration</h4>
                <div className="text-sm space-y-1">
                  <p><span className="text-muted-foreground">Provider:</span> {llmProvider}</p>
                  <p><span className="text-muted-foreground">Model:</span> {llmModel || 'Default'}</p>
                  {llmProvider !== 'manus' && (
                    <p><span className="text-muted-foreground">API Key:</span> {llmApiKey ? '••••••••' : 'Not set'}</p>
                  )}
                </div>
              </div>
            </TabsContent>

            <TabsContent value="dm" className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label htmlFor="systemPrompt">DM System Prompt</Label>
                <p className="text-sm text-muted-foreground">
                  Customize how your Dungeon Master behaves, their personality, worldbuilding style, and interaction rules.
                  This prompt is sent with every message to guide the AI's responses.
                </p>
                <Textarea
                  id="systemPrompt"
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  placeholder="Enter your custom system prompt..."
                  className="min-h-[300px] font-mono text-sm"
                />
                <div className="flex justify-between items-center text-sm text-muted-foreground">
                  <span>{systemPrompt.length} characters</span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setSystemPrompt(DEFAULT_SYSTEM_PROMPT)}
                  >
                    Reset to Default
                  </Button>
                </div>
              </div>

              <div className="bg-muted/50 p-4 rounded-lg space-y-2">
                <h4 className="font-semibold text-sm">Tips for Writing System Prompts:</h4>
                <ul className="text-sm space-y-1 list-disc list-inside text-muted-foreground">
                  <li>Be specific about tone and style (serious, humorous, gritty, whimsical)</li>
                  <li>Define how combat should be narrated (cinematic, tactical, brief)</li>
                  <li>Set expectations for NPC personalities and dialogue</li>
                  <li>Specify any house rules or custom mechanics</li>
                  <li>Mention preferred level of detail for descriptions</li>
                </ul>
              </div>
            </TabsContent>

            <TabsContent value="tts" className="space-y-4 mt-4">
              <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/10 p-4 mb-4">
                <p className="text-sm">
                  <strong>Coming Soon:</strong> Text-to-speech integration will allow the DM's responses to be read aloud.
                  Configure your preferences here for when this feature is available.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="ttsProvider">TTS Provider</Label>
                <Select
                  value={ttsProvider}
                  onValueChange={setTtsProvider}
                  disabled
                >
                  <SelectTrigger id="ttsProvider">
                    <SelectValue placeholder="Select provider (coming soon)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="elevenlabs">ElevenLabs</SelectItem>
                    <SelectItem value="openai">OpenAI TTS</SelectItem>
                    <SelectItem value="google">Google Cloud TTS</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="ttsVoice">Voice</Label>
                <Input
                  id="ttsVoice"
                  value={ttsVoice}
                  onChange={(e) => setTtsVoice(e.target.value)}
                  placeholder="Voice ID or name"
                  disabled
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="ttsApiKey">TTS API Key</Label>
                <Input
                  id="ttsApiKey"
                  type="password"
                  value={ttsApiKey}
                  onChange={(e) => setTtsApiKey(e.target.value)}
                  placeholder="API key for TTS provider"
                  disabled
                />
              </div>
            </TabsContent>
          </Tabs>
        )}

        <div className="flex justify-end gap-2 mt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={updateSettings.isPending}>
            {updateSettings.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save Settings
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
