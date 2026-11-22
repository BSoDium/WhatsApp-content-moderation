import { createLlmClient } from './llm-client.ts';
import type { InstalledModel } from './llm-client.ts';

const LIST_TIMEOUT_MS = 5000;

type InstalledModelsResult = { ok: true; models: InstalledModel[] } | { ok: false; error: string };

/**
 * The models the configured LLM provider offers, for the Settings model
 * picker. Fails open like the classifier: an unreachable provider returns
 * { ok: false } and the picker falls back to a free-text field.
 */
export async function listInstalledModels(): Promise<InstalledModelsResult> {
  try {
    const models = await createLlmClient(LIST_TIMEOUT_MS).listModels();
    return { ok: true, models: models.sort((a, b) => a.name.localeCompare(b.name)) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
