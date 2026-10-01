import type { InstalledModel } from './useInstalledModels';
import type { Setting } from './types';

// Settings whose value is an Ollama model name; `inheritsClassifier` ones may be blank, meaning "use the classifier model".
export const MODEL_SETTINGS: Record<string, { inheritsClassifier: boolean }> = {
  OLLAMA_MODEL: { inheritsClassifier: false },
  WARNING_MODEL: { inheritsClassifier: true },
};

export function pullCommand(model: string): string {
  return `docker compose exec ollama ollama pull ${model}`;
}

export function isModelMissing(setting: Setting, installedModels: InstalledModel[] | null): boolean {
  return installedModels !== null && setting.key in MODEL_SETTINGS && setting.value !== '' && !installedModels.some((model) => model.name === setting.value);
}
