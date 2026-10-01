// Settings whose value is an Ollama model name; `inheritsClassifier` ones may be blank, meaning "use the classifier model".
export const MODEL_SETTINGS: Record<string, { inheritsClassifier: boolean }> = {
  OLLAMA_MODEL: { inheritsClassifier: false },
  WARNING_MODEL: { inheritsClassifier: true },
};

export function pullCommand(model: string): string {
  return `docker compose exec ollama ollama pull ${model}`;
}
