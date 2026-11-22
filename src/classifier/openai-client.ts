import type { ChatRequest, ChatResponse, InstalledModel, LlmClient } from './llm-client.ts';

const ERROR_BODY_PREVIEW_CHARS = 200;
const HTTP_BAD_REQUEST = 400;

interface OpenAiClientConfig {
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
}

interface CompletionResponse {
  choices?: { message?: { content?: unknown }; finish_reason?: unknown }[];
}

function withoutTrailingSlashes(url: string): string {
  return url.replace(/\/+$/, '');
}

function requestBody({ model, messages, options }: ChatRequest, responseFormat: object | undefined) {
  return {
    model,
    messages,
    stream: false,
    temperature: options?.temperature,
    max_tokens: options?.num_predict,
    response_format: responseFormat,
  };
}

// Not every OpenAI-compatible server accepts a JSON schema; plain JSON mode plus the schema spelled out in the prompt is the widely supported fallback.
function jsonModeRequest(request: ChatRequest): ChatRequest {
  const schemaNote = `Reply with a single JSON object matching this JSON schema, and nothing else:\n${JSON.stringify(request.format)}`;
  return { ...request, messages: [...request.messages, { role: 'system', content: schemaNote }] };
}

/**
 * A client for any server speaking the OpenAI chat-completions API (OpenAI,
 * OpenRouter, vLLM, LiteLLM, FreeLLMAPI, ...). Throws on a transport error, a
 * non-2xx status or a reply with no text, like the Ollama client, so callers'
 * fail-open handling is identical for both.
 */
export function createOpenAiClient({ baseUrl, apiKey, timeoutMs }: OpenAiClientConfig): LlmClient {
  const root = withoutTrailingSlashes(baseUrl.trim());

  async function call(path: string, init: RequestInit): Promise<Response> {
    if (!root) throw new Error('LLM base URL is not set');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    return fetch(`${root}${path}`, { ...init, headers, signal: AbortSignal.timeout(timeoutMs) });
  }

  async function failure(res: Response): Promise<Error> {
    const body = (await res.text().catch(() => '')).slice(0, ERROR_BODY_PREVIEW_CHARS);
    return new Error(`LLM provider returned ${res.status}${body ? `: ${body}` : ''}`);
  }

  async function complete(request: ChatRequest, responseFormat: object | undefined): Promise<Response> {
    return call('/chat/completions', { method: 'POST', body: JSON.stringify(requestBody(request, responseFormat)) });
  }

  return {
    async chat(request) {
      let res = await complete(request, request.format ? { type: 'json_schema', json_schema: { name: 'response', strict: true, schema: request.format } } : undefined);
      if (!res.ok && res.status === HTTP_BAD_REQUEST && request.format) {
        res = await complete(jsonModeRequest(request), { type: 'json_object' });
      }
      if (!res.ok) throw await failure(res);

      const choice = ((await res.json()) as CompletionResponse).choices?.[0];
      const content = choice?.message?.content;
      if (typeof content !== 'string') throw new Error('LLM provider returned no message content');
      const result: ChatResponse = { message: { content } };
      if (choice?.finish_reason === 'length') result.done_reason = 'length';
      return result;
    },

    async listModels() {
      const res = await call('/models', { method: 'GET' });
      if (!res.ok) throw await failure(res);
      const { data } = (await res.json()) as { data?: { id?: unknown }[] };
      const models: InstalledModel[] = (data ?? []).flatMap(({ id }) => (typeof id === 'string' ? [{ name: id, sizeBytes: null }] : []));
      return models;
    },
  };
}
