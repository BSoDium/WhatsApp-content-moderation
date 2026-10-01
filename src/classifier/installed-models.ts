import { createOllamaClient } from './ollama-client.ts';

const LIST_TIMEOUT_MS = 5000;

export interface InstalledModel {
  name: string;
  sizeBytes: number;
}

type InstalledModelsResult = { ok: true; models: InstalledModel[] } | { ok: false; error: string };

/**
 * The models the configured Ollama host has pulled, for the Settings model
 * picker. Fails open like the classifier: an unreachable Ollama returns
 * { ok: false } and the picker falls back to a free-text field.
 */
export async function listInstalledModels(): Promise<InstalledModelsResult> {
  try {
    const { models } = await createOllamaClient(LIST_TIMEOUT_MS).list();
    return { ok: true, models: models.map(({ name, size }) => ({ name, sizeBytes: size })).sort((a, b) => a.name.localeCompare(b.name)) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
