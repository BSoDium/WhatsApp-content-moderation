import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { getRawValue, setRawValue } from '../store/settings.ts';
import { emitControlEvent } from '../store/events.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Overridable for tests only, the same way DB_PATH is — the real path is
// otherwise always config/policy.md next to this checkout.
const POLICY_MD_PATH = process.env.POLICY_MD_PATH ?? join(__dirname, '..', '..', 'config', 'policy.md');
const POLICY_KEY = 'GLOBAL_POLICY';

/**
 * The moderation policy classifyMessage judges every message against.
 * Reads live from the settings store, not a module-level cache, so an edit
 * made via the control app's policy editor takes effect on the next
 * classification without a restart.
 *
 * Throws if no policy has ever been set — a fresh install with no
 * config/policy.md to import (see importPolicyFromFileIfUnset below) and no
 * policy entered yet via the control app.
 */
export function loadPolicy(): string {
  const text = getRawValue(POLICY_KEY)?.trim();
  if (!text) {
    throw new Error('No moderation policy is configured yet — set one in the control app.');
  }
  return text;
}

/**
 * The policy's raw text for the control app's editor, or '' if none is set
 * yet — distinct from loadPolicy(), which throws, since an empty editor is
 * the expected first-run state, not an error.
 */
export function getPolicyText(): string {
  return getRawValue(POLICY_KEY) ?? '';
}

/**
 * Persists a new policy from the control app's editor. Rejects
 * empty/whitespace-only text rather than letting the classifier silently
 * lose its policy.
 */
export function setPolicyText(text: string): { ok: true } | { ok: false; error: string } {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, error: 'policy text must not be empty' };
  setRawValue(POLICY_KEY, trimmed);
  emitControlEvent('policy');
  return { ok: true };
}

/**
 * One-time migration for deployments upgrading from the file-based policy:
 * if no policy has ever been set in the DB and config/policy.md exists with
 * real content, imports it verbatim. Idempotent — a no-op once GLOBAL_POLICY
 * has a row, whether from this import or a later control-app edit — so it's
 * safe to call unconditionally on every startup. config/policy.md itself
 * stays gitignored (it describes a real person) and is never read again
 * after the import that consumes it.
 */
export function importPolicyFromFileIfUnset(): void {
  if (getRawValue(POLICY_KEY) !== undefined) return;
  if (!existsSync(POLICY_MD_PATH)) return;

  const text = readFileSync(POLICY_MD_PATH, 'utf-8').trim();
  if (text) setRawValue(POLICY_KEY, text);
}
