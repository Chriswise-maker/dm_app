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
  try {
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
    
    console.log(`[LLM] Using provider: ${settings.llmProvider}, model: ${model}`);
    
    // Handle provider-specific API formats
    if (settings.llmProvider === 'anthropic') {
      return await invokeAnthropic(apiUrl, settings.llmApiKey, model, params);
    } else if (settings.llmProvider === 'google') {
      return await invokeGoogle(apiUrl, settings.llmApiKey, model, params);
    } else {
      // OpenAI-compatible format
      return await invokeOpenAI(apiUrl, settings.llmApiKey, model, params);
    }
  } catch (error) {
    console.error('[LLM Error]', error);
    throw error;
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
  
  const result = await response.json();
  
  // Validate OpenAI response structure
  if (!result || typeof result !== 'object') {
    console.error('[OpenAI] Invalid response - not an object:', result);
    throw new Error('OpenAI API returned invalid response format');
  }
  
  if (!result.choices || !Array.isArray(result.choices) || result.choices.length === 0) {
    console.error('[OpenAI] Invalid response - no choices array:', result);
    throw new Error('OpenAI API returned response without choices');
  }
  
  if (!result.choices[0].message) {
    console.error('[OpenAI] Invalid response - no message in first choice:', result);
    throw new Error('OpenAI API returned response without message');
  }
  
  return result as InvokeResult;
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
  
  // Validate response structure
  if (!result || !result.content || !Array.isArray(result.content) || result.content.length === 0) {
    throw new Error(`Invalid Anthropic API response structure: ${JSON.stringify(result)}`);
  }
  
  const textContent = result.content[0]?.text;
  if (typeof textContent !== 'string') {
    throw new Error(`Anthropic API response missing text content: ${JSON.stringify(result.content[0])}`);
  }
  
  // Convert Anthropic format to OpenAI format
  return {
    id: result.id || 'anthropic-' + Date.now(),
    created: Date.now(),
    model: result.model || model,
    choices: [{
      index: 0,
      message: {
        role: 'assistant',
        content: textContent,
      },
      finish_reason: result.stop_reason || 'stop',
    }],
    usage: result.usage ? {
      prompt_tokens: result.usage.input_tokens || 0,
      completion_tokens: result.usage.output_tokens || 0,
      total_tokens: (result.usage.input_tokens || 0) + (result.usage.output_tokens || 0),
    } : undefined,
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
  
  // Validate response structure
  if (!result || !result.candidates || !Array.isArray(result.candidates) || result.candidates.length === 0) {
    throw new Error(`Invalid Google API response structure: ${JSON.stringify(result)}`);
  }
  
  const candidate = result.candidates[0];
  if (!candidate || !candidate.content || !candidate.content.parts || !Array.isArray(candidate.content.parts) || candidate.content.parts.length === 0) {
    throw new Error(`Invalid Google API candidate structure: ${JSON.stringify(candidate)}`);
  }
  
  const textContent = candidate.content.parts[0]?.text;
  if (typeof textContent !== 'string') {
    throw new Error(`Google API response missing text content: ${JSON.stringify(candidate.content.parts[0])}`);
  }
  
  // Convert Gemini format to OpenAI format
  return {
    id: 'gemini-' + Date.now(),
    created: Date.now(),
    model,
    choices: [{
      index: 0,
      message: {
        role: 'assistant',
        content: textContent,
      },
      finish_reason: candidate.finishReason || 'stop',
    }],
  };
}
