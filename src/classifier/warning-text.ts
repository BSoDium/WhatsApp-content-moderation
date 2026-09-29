import { getRawSetting } from '../store/settings.ts';

// Empty WARNING_MODEL (its manifest default) means "inherit the classifier model", so `||` not `??`.
export function warningModel(): string {
  return getRawSetting('WARNING_MODEL') || getRawSetting('OLLAMA_MODEL');
}

// Collapses the formatting a small local model adds (quotes, stray newlines, emoji) into the single plain line a text message would be.
function sanitizeWarning(raw: string): string {
  const collapsed = raw.replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, '').replace(/\s+/g, ' ').trim();
  return collapsed.replace(/^["'“‘`]+/, '').replace(/["'”’`]+$/, '').trim();
}

const REFUSAL_PATTERN = /^(i can(?:no|['’])t|i cannot|i(?:['’]m| am) (?:sorry|unable|not able|not going)|i won['’]?t|sorry\b|je ne peux pas|je ne vais pas|je suis désolé|désolé)/i;

// A model that balks at the flagged text answers with a refusal, which is non-empty and would otherwise be sent to the contact as the warning.
function looksLikeRefusal(text: string): boolean {
  return REFUSAL_PATTERN.test(text);
}

type WarningFailure = 'empty' | 'refused' | 'too_long';
type CheckedWarning = { ok: true; text: string } | { ok: false; error: string; failure: WarningFailure };
type GeneratedWarning = { ok: true; text: string } | { ok: false; error: string };

const MAX_ATTEMPTS = 2;
const RETRY_LENGTH_FRACTION = 0.6;

/**
 * Cleans a generated warning and decides whether it is fit to send whole.
 * Never truncates: a warning cut mid-sentence reads worse than the static
 * fallback, so empty, refused and over-long output all fail.
 */
function checkWarning(raw: string, maxLength: number): CheckedWarning {
  const text = sanitizeWarning(raw);
  if (!text) return { ok: false, error: 'empty warning message generated', failure: 'empty' };
  if (looksLikeRefusal(text)) return { ok: false, error: `model refused to write the warning: ${text}`, failure: 'refused' };
  if (text.length > maxLength) {
    return { ok: false, error: `warning message too long (${text.length} > ${maxLength}): ${text}`, failure: 'too_long' };
  }
  return { ok: true, text };
}

function retryHint(failure: WarningFailure, maxLength: number): string | null {
  if (failure !== 'too_long') return null;
  const target = Math.max(Math.floor(maxLength * RETRY_LENGTH_FRACTION), 1);
  return `Your previous reply was too long. Write it again as ONE sentence of at most ${target} characters. Drop the mention of the removed message; say only that this is an automated system and the consequence.`;
}

/**
 * Runs `generate` until it yields a warning fit to send whole, up to
 * MAX_ATTEMPTS times, telling the model to be shorter after an over-long
 * attempt. Returns { ok: false } once attempts run out so the caller falls
 * back to the static message.
 *
 * `generate` may throw (Ollama unreachable, timeout); that propagates
 * without a retry, since repeating a timed-out call would only double the
 * wait before the fallback.
 */
export async function generateChecked(
  generate: (retryHint: string | null) => Promise<string>,
  maxLength: number,
): Promise<GeneratedWarning> {
  let hint: string | null = null;
  let lastError = '';

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const checked = checkWarning(await generate(hint), maxLength);
    if (checked.ok) return checked;
    lastError = checked.error;
    hint = retryHint(checked.failure, maxLength);
  }

  return { ok: false, error: lastError };
}
