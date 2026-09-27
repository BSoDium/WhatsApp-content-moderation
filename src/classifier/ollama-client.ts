import { Ollama } from 'ollama';
import { getRawSetting } from '../store/settings.ts';

/**
 * Builds an Ollama client whose every request is wrapped in
 * `AbortSignal.timeout(timeoutMs)` — shared by classifier.ts and
 * warning-message.ts (each with their own independently configured
 * timeout) so a future change to how that timeout is wired into the
 * client's fetch only has to be made in one place.
 *
 * Reads OLLAMA_HOST fresh on every call, not once at import time, so an
 * edit made via the control app's settings panel takes effect on the next
 * classification/warning generation without a restart.
 */
export function createOllamaClient(timeoutMs: number): Ollama {
  return new Ollama({
    host: getRawSetting('OLLAMA_HOST'),
    fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(timeoutMs) }),
  });
}
