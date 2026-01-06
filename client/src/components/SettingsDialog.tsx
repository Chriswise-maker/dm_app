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
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const DEFAULT_SYSTEM_PROMPT = `You are the CHAOS WEAVER, an expert Dungeon Master for D&D 5e.
Your goal is to weave a tapestry of narrative from the threads of player choices and dice rolls.

**CORE DIRECTIVES:**
1.  **Immersive Narration**: Describe the world through all senses. Don't just say "You hit"; describe the sound of steel on steel, the spray of blood, the smell of ozone.
2.  **Reactive World**: The world is alive. NPCs have agendas. Actions have consequences. If a player acts foolishly, the world reacts realistically.
3.  **Mechanical Transparency**: When resolving actions, be clear about the mechanics (DC, damage, saving throws) but wrap them in narrative.
    *   *Example*: "The guard narrows his eyes (Insight Check: 14). He doesn't seem convinced."
4.  **Pacing**: Keep the story moving. End descriptions with a call to action or a hook for the players. "The door creaks open... what do you do?"
5.  **Character Focus**: Address the characters by name. Acknowledge their specific abilities, backgrounds, and current status.

**TONE:**
Epic, dangerous, and wondrous. Magic is powerful but volatile. Combat is visceral.

**RULES OF ENGAGEMENT:**
*   Never break character as the DM unless clarifying a rule.
*   Respect the dice. A natural 1 is a narrative complication; a natural 20 is a moment of brilliance.
*   Use the provided game state (Inventory, HP, AC) as absolute truth.`;

const DEFAULT_CAMPAIGN_GENERATION_PROMPT = `You are the CHAOS WEAVER, architect of worlds.
Generate a D&D 5e campaign setting that is ripe for adventure, conflict, and mystery.

**REQUIREMENTS:**
1.  **Setting**: Create a world that feels ancient and lived-in. Avoid generic tropes; give them a twist.
2.  **Central Tension**: Establish a major conflict that drives the world (e.g., a magical catastrophe, a civil war, a planar invasion).
3.  **Atmosphere**: Define the "mood" (e.g., Gothic Horror, High Magic Espionage, Post-Apocalyptic Fantasy).
4.  **The Hook**: The prologue must immediately grab the player. It should not be an exposition dump but a "cold open" that places them in media res or on the precipice of change.

**OUTPUT FORMAT**:
Return a valid JSON object with \`title\`, \`narrativePrompt\` (the world bible), and \`prologue\` (the opening scene).`;

const DEFAULT_CHARACTER_GENERATION_PROMPT = `You are the CHAOS WEAVER, forger of souls.
Create a D&D 5e character who is more than a stat block—they are a story waiting to unfold.

**GUIDELINES:**
1.  **Optimization vs. Flavor**: Create characters that are competent but flawed. Give them a reason to adventure.
2.  **Backstory**: Weave their class and background together. A Rogue isn't just a thief; they are a disgraced noble or a street rat fighting for survival.
3.  **Equipment**: Ensure their gear tells a story. A "dented shield" says more than "shield".
4.  **Mechanics**: Ensure all stats, HP, and AC are mathematically correct for 5e rules.

**OUTPUT**:
Return ONLY the raw JSON object defining this character.`;

const DEFAULT_COMBAT_TURN_PROMPT = `[COMBAT MODE: ACTIVE]
FOCUS: {{actorName}} ({{actorType}})

**BATTLEFIELD AWARENESS:**
{{statusList}}

**NARRATIVE INSTRUCTION:**
{{instructions}}
If this is a PLAYER: Set the scene for their turn. Describe the immediate threats, the chaos around them, and the opportunities present. End with: "The spotlight is yours. What do you do?"
If this is an ENEMY: Describe their action with intent and menace. Do not resolve the outcome yet, just the attempt. "The Orc Warlord raises his greataxe, screaming a challenge as he charges..."`;

const DEFAULT_COMBAT_NARRATION_PROMPT = `**ACTION RESOLUTION:**
Actor: {{actorName}}
Target: {{targetName}}
Outcome: {{outcome}}
Damage Dealt: {{damage}}
Target Status: {{targetHP}}

**CHAOS WEAVER NARRATION:**
{{instructions}}
*   **On HIT**: Make it visceral. Describe the impact, the reaction of the target, and the physical toll.
*   **On MISS**: Describe *why* it missed. Was it parried? Dodged? Did the armor absorb the blow? Make the failure tactical, not incompetent.
*   **On CRITICAL**: Amplify the effect. Bones break, armor shatters, morale breaks.
*   **On KILL**: Give the target a memorable death. Whether it's a silent collapse or a final curse, make it matter.`;

const DEFAULT_COMBAT_SUMMARY_PROMPT = `**COMBAT RESOLVED**
Victors: {{victor}}
Duration: {{duration}} rounds

**THE AFTERMATH:**
The dust settles. The noise of battle fades, replaced by heavy breathing and the groans of the fallen.
Describe the scene now that violence has ended.
*   What is the condition of the survivors?
*   What loot or clues are immediately visible?
*   How does the environment reflect the battle (broken furniture, scorched earth)?

End with a transition back to exploration mode. "The immediate threat is gone, but the danger remains. What is your next move?"`;

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
  const [ttsProvider, setTtsProvider] = useState<string>('openai');
  const [ttsModel, setTtsModel] = useState<string>('tts-1');
  const [ttsVoice, setTtsVoice] = useState<string>('alloy');
  const [ttsApiKey, setTtsApiKey] = useState<string>('');
  const [systemPrompt, setSystemPrompt] = useState<string>(DEFAULT_SYSTEM_PROMPT);
  const [campaignGenerationPrompt, setCampaignGenerationPrompt] = useState<string>(DEFAULT_CAMPAIGN_GENERATION_PROMPT);
  const [characterGenerationPrompt, setCharacterGenerationPrompt] = useState<string>(DEFAULT_CHARACTER_GENERATION_PROMPT);
  const [combatTurnPrompt, setCombatTurnPrompt] = useState<string>(DEFAULT_COMBAT_TURN_PROMPT);
  const [combatNarrationPrompt, setCombatNarrationPrompt] = useState<string>(DEFAULT_COMBAT_NARRATION_PROMPT);
  const [combatSummaryPrompt, setCombatSummaryPrompt] = useState<string>(DEFAULT_COMBAT_SUMMARY_PROMPT);

  useEffect(() => {
    if (settings) {
      setLlmProvider(settings.llmProvider);
      setLlmModel(settings.llmModel || '');
      setLlmApiKey(settings.llmApiKey || '');
      setTtsEnabled(settings.ttsEnabled);
      setTtsProvider(settings.ttsProvider || 'openai');
      setTtsModel(settings.ttsModel || 'tts-1');
      setTtsVoice(settings.ttsVoice || 'alloy');
      setTtsApiKey(settings.ttsApiKey || '');
      setSystemPrompt(settings.systemPrompt || DEFAULT_SYSTEM_PROMPT);
      setCampaignGenerationPrompt(settings.campaignGenerationPrompt || DEFAULT_CAMPAIGN_GENERATION_PROMPT);
      setCharacterGenerationPrompt(settings.characterGenerationPrompt || DEFAULT_CHARACTER_GENERATION_PROMPT);
      setCombatTurnPrompt(settings.combatTurnPrompt || DEFAULT_COMBAT_TURN_PROMPT);
      setCombatNarrationPrompt(settings.combatNarrationPrompt || DEFAULT_COMBAT_NARRATION_PROMPT);
      setCombatSummaryPrompt(settings.combatSummaryPrompt || DEFAULT_COMBAT_SUMMARY_PROMPT);
    }
  }, [settings]);

  const handleSave = () => {
    updateSettings.mutate({
      llmProvider,
      llmModel: llmModel || null,
      llmApiKey: llmApiKey || null,
      ttsEnabled,
      ttsProvider: ttsProvider || null,
      ttsModel: ttsModel || null,
      ttsVoice: ttsVoice || null,
      ttsApiKey: ttsApiKey || null,
      systemPrompt: systemPrompt || null,
      campaignGenerationPrompt: campaignGenerationPrompt || null,
      characterGenerationPrompt: characterGenerationPrompt || null,
      combatTurnPrompt: combatTurnPrompt || null,
      combatNarrationPrompt: combatNarrationPrompt || null,
      combatSummaryPrompt: combatSummaryPrompt || null,
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
              <Tabs defaultValue="general" className="w-full">
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="general">General</TabsTrigger>
                  <TabsTrigger value="generation">Generation</TabsTrigger>
                  <TabsTrigger value="combat">Combat</TabsTrigger>
                </TabsList>

                <TabsContent value="general" className="space-y-4 mt-4">
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

                <TabsContent value="generation" className="space-y-4 mt-4">
                  <div className="space-y-2">
                    <Label htmlFor="campaignGenerationPrompt">Campaign Generator Prompt</Label>
                    <p className="text-sm text-muted-foreground">
                      Customize the instruction used when generating a new campaign. This is the "seed" instruction sent to the AI.
                    </p>
                    <Textarea
                      id="campaignGenerationPrompt"
                      value={campaignGenerationPrompt}
                      onChange={(e) => setCampaignGenerationPrompt(e.target.value)}
                      placeholder="Generate a D&D 5e campaign setting."
                      className="min-h-[150px] font-mono text-sm"
                    />
                    <div className="flex justify-end">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCampaignGenerationPrompt(DEFAULT_CAMPAIGN_GENERATION_PROMPT)}
                      >
                        Reset to Default
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-2 pt-4 border-t">
                    <Label htmlFor="characterGenerationPrompt">Character Generator Prompt</Label>
                    <p className="text-sm text-muted-foreground">
                      Customize the instruction used when generating a new character.
                    </p>
                    <Textarea
                      id="characterGenerationPrompt"
                      value={characterGenerationPrompt}
                      onChange={(e) => setCharacterGenerationPrompt(e.target.value)}
                      placeholder="Enter custom character generation prompt..."
                      className="min-h-[150px] font-mono text-sm"
                    />
                    <div className="flex justify-end">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCharacterGenerationPrompt(DEFAULT_CHARACTER_GENERATION_PROMPT)}
                      >
                        Reset to Default
                      </Button>
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="combat" className="space-y-4 mt-4">
                  <div className="space-y-2">
                    <Label htmlFor="combatTurnPrompt">Combat Turn Prompt</Label>
                    <p className="text-sm text-muted-foreground">
                      Instructions for describing the start of a turn. Use {'{{actorName}}'} placeholders.
                    </p>
                    <Textarea
                      id="combatTurnPrompt"
                      value={combatTurnPrompt}
                      onChange={(e) => setCombatTurnPrompt(e.target.value)}
                      placeholder="[COMBAT MODE] Current Turn: {{actorName}}..."
                      className="min-h-[150px] font-mono text-sm"
                    />
                    <div className="flex justify-end">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCombatTurnPrompt(DEFAULT_COMBAT_TURN_PROMPT)}
                      >
                        Reset to Default
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-2 pt-4 border-t">
                    <Label htmlFor="combatNarrationPrompt">Combat Narration Prompt</Label>
                    <p className="text-sm text-muted-foreground">
                      Instructions for narrating attack results. Use {'{{actorName}}'}, {'{{targetName}}'}, {'{{damage}}'} placeholders.
                    </p>
                    <Textarea
                      id="combatNarrationPrompt"
                      value={combatNarrationPrompt}
                      onChange={(e) => setCombatNarrationPrompt(e.target.value)}
                      placeholder="Narrate this combat action..."
                      className="min-h-[150px] font-mono text-sm"
                    />
                    <div className="flex justify-end">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCombatNarrationPrompt(DEFAULT_COMBAT_NARRATION_PROMPT)}
                      >
                        Reset to Default
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-2 pt-4 border-t">
                    <Label htmlFor="combatSummaryPrompt">Combat Summary Prompt</Label>
                    <p className="text-sm text-muted-foreground">
                      Instructions for summarizing the combat encounter after it ends.
                    </p>
                    <Textarea
                      id="combatSummaryPrompt"
                      value={combatSummaryPrompt}
                      onChange={(e) => setCombatSummaryPrompt(e.target.value)}
                      placeholder="Combat has ended..."
                      className="min-h-[150px] font-mono text-sm"
                    />
                    <div className="flex justify-end">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCombatSummaryPrompt(DEFAULT_COMBAT_SUMMARY_PROMPT)}
                      >
                        Reset to Default
                      </Button>
                    </div>
                  </div>
                </TabsContent>
              </Tabs>
            </TabsContent>

            <TabsContent value="tts" className="space-y-4 mt-4">
              <div className="rounded-lg border border-blue-500/20 bg-blue-500/10 p-4 mb-4">
                <p className="text-sm">
                  <strong>Text-to-Speech:</strong> Configure OpenAI's TTS to have the DM's responses read aloud.
                  You'll see a play button next to DM messages when this is enabled.
                </p>
              </div>

              <div className="flex items-center justify-between space-x-2 p-4 rounded-lg border">
                <div className="space-y-0.5">
                  <Label htmlFor="tts-enabled" className="text-base font-semibold">
                    Enable Text-to-Speech
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    Turn on to hear DM responses read aloud
                  </p>
                </div>
                <Switch
                  id="tts-enabled"
                  checked={ttsEnabled}
                  onCheckedChange={setTtsEnabled}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="ttsProvider">TTS Provider</Label>
                <Select
                  value={ttsProvider}
                  onValueChange={setTtsProvider}
                >
                  <SelectTrigger id="ttsProvider">
                    <SelectValue placeholder="Select provider" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="openai">OpenAI TTS</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-sm text-muted-foreground">
                  Currently only OpenAI TTS is supported.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="ttsModel">TTS Model</Label>
                <Select
                  value={ttsModel}
                  onValueChange={setTtsModel}
                >
                  <SelectTrigger id="ttsModel">
                    <SelectValue placeholder="Select model" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="tts-1">TTS-1 (Faster, Standard Quality)</SelectItem>
                    <SelectItem value="tts-1-hd">TTS-1-HD (Higher Quality, Slower)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-sm text-muted-foreground">
                  TTS-1-HD is OpenAI's most powerful text-to-speech model with better audio quality.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="ttsVoice">Voice</Label>
                <Select
                  value={ttsVoice}
                  onValueChange={setTtsVoice}
                >
                  <SelectTrigger id="ttsVoice">
                    <SelectValue placeholder="Select voice" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="alloy">Alloy (Neutral)</SelectItem>
                    <SelectItem value="echo">Echo (Male)</SelectItem>
                    <SelectItem value="fable">Fable (British Male)</SelectItem>
                    <SelectItem value="onyx">Onyx (Deep Male)</SelectItem>
                    <SelectItem value="nova">Nova (Female)</SelectItem>
                    <SelectItem value="shimmer">Shimmer (Soft Female)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-sm text-muted-foreground">
                  Choose a voice that fits your DM's personality.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="ttsApiKey">OpenAI API Key</Label>
                <Input
                  id="ttsApiKey"
                  type="password"
                  value={ttsApiKey}
                  onChange={(e) => setTtsApiKey(e.target.value)}
                  placeholder="sk-..."
                />
                <p className="text-sm text-muted-foreground">
                  Your API key is stored securely and only used for TTS API calls.
                </p>
              </div>

              <div className="rounded-lg border border-green-500/20 bg-green-500/10 p-4">
                <h4 className="font-semibold text-sm mb-2">Current TTS Configuration</h4>
                <div className="text-sm space-y-1">
                  <p><span className="text-muted-foreground">Provider:</span> {ttsProvider || 'Not set'}</p>
                  <p><span className="text-muted-foreground">Model:</span> {ttsModel || 'Not set'}</p>
                  <p><span className="text-muted-foreground">Voice:</span> {ttsVoice || 'Not set'}</p>
                  <p><span className="text-muted-foreground">API Key:</span> {ttsApiKey ? '••••••••' : 'Not set'}</p>
                </div>
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
