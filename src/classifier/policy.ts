import { getRawValue, setRawValue } from '../store/settings.ts';
import { emitControlEvent } from '../store/events.ts';

const POLICY_KEY = 'GLOBAL_POLICY';

// Seeded the same way every other tunable is (src/store/settings.ts) —
// no first-boot file import, no separate config/policy.md to mount.
// Deliberately an instruction to flag nothing: a fresh install has no idea
// what a real contact's policy should be, so it must not start moderating
// against a guessed default.
export const DEFAULT_POLICY_TEXT =
  'No moderation policy has been written yet. Do not flag any message for any reason until this text is replaced with a real policy in the Policy editor.';

/**
 * The moderation policy classifyMessage judges every message against.
 * Reads live from the settings store, not a module-level cache, so an edit
 * made via the control app's policy editor takes effect on the next
 * classification without a restart. Falls back to DEFAULT_POLICY_TEXT on a
 * fresh install rather than throwing.
 */
export function loadPolicy(): string {
  return getRawValue(POLICY_KEY)?.trim() || DEFAULT_POLICY_TEXT;
}

/**
 * The policy's raw text for the control app's editor. Returns
 * DEFAULT_POLICY_TEXT (not '') when none is set yet, so the editor opens
 * showing the same text the classifier is actually using.
 */
export function getPolicyText(): string {
  return getRawValue(POLICY_KEY) ?? DEFAULT_POLICY_TEXT;
}

/**
 * Persists a new policy from the control app's editor. Rejects
 * empty/whitespace-only text rather than letting the classifier silently
 * fall back to DEFAULT_POLICY_TEXT without the operator noticing.
 */
export function setPolicyText(text: string): { ok: true } | { ok: false; error: string } {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, error: 'policy text must not be empty' };
  setRawValue(POLICY_KEY, trimmed);
  emitControlEvent('policy');
  return { ok: true };
}
