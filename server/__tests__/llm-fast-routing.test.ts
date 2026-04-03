import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the db module before importing the module under test
vi.mock('../db', () => ({
  getUserSettings: vi.fn(),
}));

// Mock the _core/llm module (Manus fallback)
vi.mock('../_core/llm', () => ({
  invokeLLM: vi.fn().mockResolvedValue({
    id: 'manus-1',
    created: Date.now(),
    model: 'manus-default',
    choices: [{ index: 0, message: { role: 'assistant', content: 'manus response' }, finish_reason: 'stop' }],
  }),
  invokeLLMStream: vi.fn().mockResolvedValue((async function* () { yield 'manus stream'; })()),
}));

// Mock fetch globally for provider API calls
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { getUserSettings } from '../db';
import { invokeFastLLMWithSettings, invokeFastLLMWithSettingsStream } from '../llm-with-settings';

const mockedGetUserSettings = vi.mocked(getUserSettings);

const baseParams = {
  messages: [{ role: 'user' as const, content: 'test' }],
  maxTokens: 100,
};

function mockOpenAIResponse(model: string) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      id: 'test-1',
      created: Date.now(),
      model,
      choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
    }),
  });
}

describe('invokeFastLLMWithSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses fastModel when set', async () => {
    mockedGetUserSettings.mockResolvedValue({
      id: 1,
      userId: 1,
      llmProvider: 'openai',
      llmModel: 'gpt-4o',
      fastModel: 'gpt-4o-mini',
      llmApiKey: 'sk-test',
      ttsEnabled: 0,
      ttsProvider: null,
      ttsModel: null,
      ttsVoice: null,
      ttsApiKey: null,
      systemPrompt: null,
      campaignGenerationPrompt: null,
      characterGenerationPrompt: null,
      combatTurnPrompt: null,
      combatNarrationPrompt: null,
      combatSummaryPrompt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    mockOpenAIResponse('gpt-4o-mini');

    await invokeFastLLMWithSettings(1, baseParams);

    expect(mockFetch).toHaveBeenCalledOnce();
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.model).toBe('gpt-4o-mini');
  });

  it('falls back to provider fast default when fastModel is null', async () => {
    mockedGetUserSettings.mockResolvedValue({
      id: 1,
      userId: 1,
      llmProvider: 'openai',
      llmModel: 'gpt-4o',
      fastModel: null,
      llmApiKey: 'sk-test',
      ttsEnabled: 0,
      ttsProvider: null,
      ttsModel: null,
      ttsVoice: null,
      ttsApiKey: null,
      systemPrompt: null,
      campaignGenerationPrompt: null,
      characterGenerationPrompt: null,
      combatTurnPrompt: null,
      combatNarrationPrompt: null,
      combatSummaryPrompt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    mockOpenAIResponse('gpt-4o-mini');

    await invokeFastLLMWithSettings(1, baseParams);

    expect(mockFetch).toHaveBeenCalledOnce();
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.model).toBe('gpt-4o-mini');
  });

  it('falls back to anthropic fast default (claude-haiku-4-5-20251001)', async () => {
    mockedGetUserSettings.mockResolvedValue({
      id: 1,
      userId: 1,
      llmProvider: 'anthropic',
      llmModel: 'claude-sonnet-4-5',
      fastModel: null,
      llmApiKey: 'sk-ant-test',
      ttsEnabled: 0,
      ttsProvider: null,
      ttsModel: null,
      ttsVoice: null,
      ttsApiKey: null,
      systemPrompt: null,
      campaignGenerationPrompt: null,
      characterGenerationPrompt: null,
      combatTurnPrompt: null,
      combatNarrationPrompt: null,
      combatSummaryPrompt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'msg-1',
        model: 'claude-haiku-4-5-20251001',
        content: [{ type: 'text', text: 'ok' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
    });

    await invokeFastLLMWithSettings(1, baseParams);

    expect(mockFetch).toHaveBeenCalledOnce();
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.model).toBe('claude-haiku-4-5-20251001');
  });

  it('uses custom fastModel over provider default', async () => {
    mockedGetUserSettings.mockResolvedValue({
      id: 1,
      userId: 1,
      llmProvider: 'anthropic',
      llmModel: 'claude-sonnet-4-5',
      fastModel: 'claude-3-5-haiku-20241022',
      llmApiKey: 'sk-ant-test',
      ttsEnabled: 0,
      ttsProvider: null,
      ttsModel: null,
      ttsVoice: null,
      ttsApiKey: null,
      systemPrompt: null,
      campaignGenerationPrompt: null,
      characterGenerationPrompt: null,
      combatTurnPrompt: null,
      combatNarrationPrompt: null,
      combatSummaryPrompt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'msg-2',
        model: 'claude-3-5-haiku-20241022',
        content: [{ type: 'text', text: 'ok' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
    });

    await invokeFastLLMWithSettings(1, baseParams);

    expect(mockFetch).toHaveBeenCalledOnce();
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.model).toBe('claude-3-5-haiku-20241022');
  });
});
