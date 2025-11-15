import { invokeLLM, InvokeParams, InvokeResult } from './_core/llm';
import { getUserSettings } from './db';

/**
 * Invoke LLM with user-specific settings
 * Falls back to Manus built-in if no settings are configured
 */
export async function invokeLLMWithSettings(
  userId: number,
  params: InvokeParams
): Promise<InvokeResult> {
  const settings = await getUserSettings(userId);
  
  // If using Manus built-in or no settings, use default invokeLLM
  if (!settings || settings.llmProvider === 'manus') {
    return invokeLLM(params);
  }
  
  // Build provider-specific API URL
  const apiUrls: Record<string, string> = {
    openai: 'https://api.openai.com/v1/chat/completions',
    anthropic: 'https://api.anthropic.com/v1/messages',
    google: 'https://generativelanguage.googleapis.com/v1beta/models',
  };
  
  const apiUrl = apiUrls[settings.llmProvider];
  if (!apiUrl) {
    throw new Error(`Unsupported LLM provider: ${settings.llmProvider}`);
  }
  
  if (!settings.llmApiKey) {
    throw new Error(`API key not configured for provider: ${settings.llmProvider}`);
  }
  
  // Use configured model or provider default
  const model = settings.llmModel || getDefaultModel(settings.llmProvider);
  
  // Handle provider-specific API formats
  if (settings.llmProvider === 'anthropic') {
    return await invokeAnthropic(apiUrl, settings.llmApiKey, model, params);
  } else if (settings.llmProvider === 'google') {
    return await invokeGoogle(apiUrl, settings.llmApiKey, model, params);
  } else {
    // OpenAI-compatible format
    return await invokeOpenAI(apiUrl, settings.llmApiKey, model, params);
  }
}

function getDefaultModel(provider: string): string {
  const defaults: Record<string, string> = {
    openai: 'gpt-4o',
    anthropic: 'claude-3-5-sonnet-20241022',
    google: 'gemini-2.0-flash-exp',
  };
  return defaults[provider] || 'gpt-4o';
}

async function invokeOpenAI(
  apiUrl: string,
  apiKey: string,
  model: string,
  params: InvokeParams
): Promise<InvokeResult> {
  const payload: Record<string, unknown> = {
    model,
    messages: params.messages,
  };
  
  if (params.tools) payload.tools = params.tools;
  if (params.tool_choice || params.toolChoice) {
    payload.tool_choice = params.tool_choice || params.toolChoice;
  }
  if (params.max_tokens || params.maxTokens) {
    payload.max_tokens = params.max_tokens || params.maxTokens;
  }
  if (params.response_format || params.responseFormat) {
    payload.response_format = params.response_format || params.responseFormat;
  }
  
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `OpenAI API failed: ${response.status} ${response.statusText} – ${errorText}`
    );
  }
  
  return (await response.json()) as InvokeResult;
}

async function invokeAnthropic(
  apiUrl: string,
  apiKey: string,
  model: string,
  params: InvokeParams
): Promise<InvokeResult> {
  // Extract system message
  const systemMessage = params.messages.find(m => m.role === 'system');
  const userMessages = params.messages.filter(m => m.role !== 'system');
  
  const payload: Record<string, unknown> = {
    model,
    messages: userMessages.map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
    })),
    max_tokens: params.max_tokens || params.maxTokens || 4096,
  };
  
  if (systemMessage) {
    payload.system = typeof systemMessage.content === 'string' 
      ? systemMessage.content 
      : JSON.stringify(systemMessage.content);
  }
  
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(payload),
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Anthropic API failed: ${response.status} ${response.statusText} – ${errorText}`
    );
  }
  
  const result = await response.json();
  
  // Convert Anthropic format to OpenAI format
  return {
    id: result.id,
    created: Date.now(),
    model: result.model,
    choices: [{
      index: 0,
      message: {
        role: 'assistant',
        content: result.content[0].text,
      },
      finish_reason: result.stop_reason,
    }],
    usage: {
      prompt_tokens: result.usage.input_tokens,
      completion_tokens: result.usage.output_tokens,
      total_tokens: result.usage.input_tokens + result.usage.output_tokens,
    },
  };
}

async function invokeGoogle(
  baseUrl: string,
  apiKey: string,
  model: string,
  params: InvokeParams
): Promise<InvokeResult> {
  const apiUrl = `${baseUrl}/${model}:generateContent?key=${apiKey}`;
  
  // Convert messages to Gemini format
  const contents = params.messages
    .filter(m => m.role !== 'system')
    .map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{
        text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
      }],
    }));
  
  const systemInstruction = params.messages.find(m => m.role === 'system');
  
  const payload: Record<string, unknown> = {
    contents,
  };
  
  if (systemInstruction) {
    payload.systemInstruction = {
      parts: [{
        text: typeof systemInstruction.content === 'string' 
          ? systemInstruction.content 
          : JSON.stringify(systemInstruction.content),
      }],
    };
  }
  
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Google API failed: ${response.status} ${response.statusText} – ${errorText}`
    );
  }
  
  const result = await response.json();
  
  // Convert Gemini format to OpenAI format
  const candidate = result.candidates[0];
  return {
    id: 'gemini-' + Date.now(),
    created: Date.now(),
    model,
    choices: [{
      index: 0,
      message: {
        role: 'assistant',
        content: candidate.content.parts[0].text,
      },
      finish_reason: candidate.finishReason,
    }],
  };
}
