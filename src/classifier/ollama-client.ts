import { Ollama } from 'ollama';

const OLLAMA_HOST = process.env.OLLAMA_HOST ?? 'http://127.0.0.1:11434';

/**
 * Builds an Ollama client whose every request is wrapped in
 * `AbortSignal.timeout(timeoutMs)` — shared by classifier.ts and
 * warning-message.ts (each with their own independently configured
 * timeout) so a future change to how that timeout is wired into the
 * client's fetch only has to be made in one place.
 */
export function createOllamaClient(timeoutMs: number): Ollama {
  return new Ollama({
    host: OLLAMA_HOST,
    fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(timeoutMs) }),
  });
}
