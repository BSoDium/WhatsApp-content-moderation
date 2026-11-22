import type { Ollama } from 'ollama';
import { createOllamaClient } from './ollama-client.ts';
import { createOpenAiClient } from './openai-client.ts';
import { getRawSetting } from '../store/settings.ts';

export interface ChatRequest {
  model: string;
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[];
  // A JSON schema constraining the reply, as Ollama's `format` takes it.
  format?: object;
  options?: { temperature?: number; num_predict?: number; repeat_penalty?: number };
}

export interface ChatResponse {
  message: { content: string };
  // 'length' when the reply stopped at the token limit rather than by itself.
  done_reason?: string;
}

export interface InstalledModel {
  name: string;
  sizeBytes: number | null;
}

/**
 * The part of an LLM backend the classifier and warning generators use: one
 * chat call, plus listing the models a picker can offer. Ollama and any
 * OpenAI-compatible API sit behind it.
 */
export interface LlmClient {
  chat(request: ChatRequest): Promise<ChatResponse>;
  listModels(): Promise<InstalledModel[]>;
}

/**
 * Builds the client for the configured LLM_PROVIDER, wrapping every request
 * in `AbortSignal.timeout(timeoutMs)`. Settings are read on every call, so an
 * edit in the control app applies to the next classification without a restart.
 */
export function createLlmClient(timeoutMs: number): LlmClient {
  if (getRawSetting('LLM_PROVIDER') === 'openai') {
    return createOpenAiClient({ baseUrl: getRawSetting('LLM_BASE_URL'), apiKey: getRawSetting('LLM_API_KEY'), timeoutMs });
  }

  return ollamaLlmClient(createOllamaClient(timeoutMs));
}

export function ollamaLlmClient(ollama: Ollama): LlmClient {
  return {
    chat: (request) => ollama.chat(request),
    listModels: async () => (await ollama.list()).models.map(({ name, size }) => ({ name, sizeBytes: size })),
  };
}
