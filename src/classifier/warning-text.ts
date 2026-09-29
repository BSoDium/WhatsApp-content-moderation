import { getRawSetting } from '../store/settings.ts';

// Empty WARNING_MODEL (its manifest default) means "inherit the classifier model", so `||` not `??`.
export function warningModel(): string {
  return getRawSetting('WARNING_MODEL') || getRawSetting('OLLAMA_MODEL');
}

// Collapses the formatting a small local model adds (quotes, stray newlines) into the single plain line a text message would be.
function sanitizeWarning(raw: string): string {
  const collapsed = raw.replace(/\s+/g, ' ').trim();
  return collapsed.replace(/^["'“‘`]+/, '').replace(/["'”’`]+$/, '').trim();
}

const REFUSAL_PATTERN = /^(i can(?:no|['’])t|i cannot|i(?:['’]m| am) (?:sorry|unable|not able|not going)|i won['’]?t|sorry\b|je ne peux pas|je ne vais pas|je suis désolé|désolé)/i;

// A model that balks at the flagged text answers with a refusal, which is non-empty and would otherwise be sent to the contact as the warning.
function looksLikeRefusal(text: string): boolean {
  return REFUSAL_PATTERN.test(text);
}

type CheckedWarning = { ok: true; text: string } | { ok: false; error: string };

/**
 * Cleans a generated warning and decides whether it is fit to send whole.
 * Never truncates: a warning cut mid-sentence reads worse than the static
 * fallback, so empty, refused and over-long output all return { ok: false }
 * and the caller falls back.
 */
export function checkWarning(raw: string, maxLength: number): CheckedWarning {
  const text = sanitizeWarning(raw);
  if (!text) return { ok: false, error: 'empty warning message generated' };
  if (looksLikeRefusal(text)) return { ok: false, error: `model refused to write the warning: ${text}` };
  if (text.length > maxLength) return { ok: false, error: `warning message too long (${text.length} > ${maxLength}): ${text}` };
  return { ok: true, text };
}
