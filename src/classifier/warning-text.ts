import { getRawSetting } from '../store/settings.ts';

// Empty WARNING_MODEL (its manifest default) means "inherit the classifier model", so `||` not `??`.
export function warningModel(): string {
  return getRawSetting('WARNING_MODEL') || getRawSetting('OLLAMA_MODEL');
}

// Collapses the formatting a small local model adds (quotes, stray newlines) into the single plain line a text message would be.
export function sanitizeWarning(raw: string, maxLength: number): string {
  const collapsed = raw.replace(/\s+/g, ' ').trim();
  const unquoted = collapsed.replace(/^["'“‘`]+/, '').replace(/["'”’`]+$/, '').trim();
  if (unquoted.length <= maxLength) return unquoted;
  // Math.max guards maxLength <= 1: slice(0, negative) counts from the end in JS.
  return `${unquoted.slice(0, Math.max(maxLength - 1, 0)).trimEnd()}…`;
}

const REFUSAL_PATTERN = /^(i can(?:no|')t|i cannot|i(?:'m| am) (?:sorry|unable|not able)|i won'?t|sorry\b|je ne peux pas|je suis désolé|désolé)/i;

// A model that balks at the flagged text answers with a refusal, which is non-empty and would otherwise be sent to the contact as the warning.
export function looksLikeRefusal(text: string): boolean {
  return REFUSAL_PATTERN.test(text);
}
