import { createLogger } from '../cli/logger.ts';
import { eq } from 'drizzle-orm';
import { getOrm } from './db.ts';
import { emitControlEvent } from './events.ts';
import { excluded } from './excluded.ts';
import { settings } from './schema.ts';
import type { SettingRecord } from '../types.ts';

const logger = createLogger('settings');

export type SettingSection = 'general' | 'classifier' | 'warning' | 'strikes' | 'calls';
export type SettingType = 'string' | 'int' | 'float' | 'bool';

export interface SettingDef {
  key: string;
  section: SettingSection;
  label: string;
  description: string;
  type: SettingType;
  default: string;
  // Inclusive lower bound for 'int'/'float' types — most of these are
  // durations/counts that are meaningless at zero or negative.
  min?: number;
  // 'string' types only: rejects blank, for the rare setting (a fail-open
  // fallback message) where an empty value would defeat its own purpose.
  required?: boolean;
}

// Hardcoded here, not read from process.env — moderation tuning lives
// entirely in the web control app, see docs/decisions.md.
export const SETTINGS: readonly SettingDef[] = [
  {
    key: 'SHADOW_MODE',
    section: 'general',
    label: 'Shadow mode',
    description: 'Classify and log every message without deleting, warning, or blocking. Review the activity log before turning this off.',
    type: 'bool',
    default: '1',
  },
  {
    key: 'OLLAMA_HOST',
    section: 'classifier',
    label: 'Ollama host',
    description: 'Docker Compose and a local Ollama both use this loopback address.',
    type: 'string',
    default: 'http://127.0.0.1:11434',
  },
  {
    key: 'OLLAMA_MODEL',
    section: 'classifier',
    label: 'Classifier model',
    description: 'The Ollama model used to classify incoming messages against the policy.',
    type: 'string',
    default: 'llama3.2:3b',
  },
  {
    key: 'CLASSIFIER_TIMEOUT_MS',
    section: 'classifier',
    label: 'Classifier timeout (ms)',
    description: 'How long to wait for a classification before failing open.',
    type: 'int',
    default: '90000',
    min: 1,
  },
  {
    key: 'CLASSIFIER_HISTORY_LIMIT',
    section: 'classifier',
    label: 'History limit',
    description: 'Number of prior messages included as conversation context.',
    type: 'int',
    default: '10',
    min: 0,
  },
  {
    key: 'WARNING_MODEL',
    section: 'warning',
    label: 'Warning model',
    description: 'Model used to generate the warning reply. Leave blank to inherit the classifier model.',
    type: 'string',
    default: '',
  },
  {
    key: 'WARNING_TIMEOUT_MS',
    section: 'warning',
    label: 'Warning timeout (ms)',
    description: 'How long to wait for each model call while generating a warning (language detection, then the warning itself) before falling back to the static message below.',
    type: 'int',
    default: '90000',
    min: 1,
  },
  {
    key: 'WARNING_TEMPERATURE',
    section: 'warning',
    label: 'Warning temperature',
    description: '0 = deterministic, higher = more varied phrasing.',
    type: 'float',
    default: '0.4',
    min: 0,
  },
  {
    key: 'WARNING_MAX_LENGTH',
    section: 'warning',
    label: 'Warning max length',
    description: "Hard cap on the generated warning's length, in characters — a warning read on a phone screen needs to be a text, not a paragraph.",
    type: 'int',
    default: '180',
    min: 1,
  },
  {
    key: 'WARNING_MESSAGE',
    section: 'warning',
    label: 'Fallback warning message',
    description: 'Sent to a contact only if the generated warning fails open (Ollama unreachable, timeout, empty response).',
    type: 'string',
    default: "That message was removed for violating this chat's policy.",
    required: true,
  },
  {
    key: 'STRIKE_THRESHOLD',
    section: 'strikes',
    label: 'Strike threshold',
    description: 'Strikes before a block is triggered.',
    type: 'int',
    default: '3',
    min: 1,
  },
  {
    key: 'BLOCK_DURATION_MS',
    section: 'strikes',
    label: 'Block duration (ms)',
    description: 'Block length before auto-unblock is scheduled. Default: 24h.',
    type: 'int',
    default: String(24 * 60 * 60 * 1000),
    min: 1,
  },
  {
    key: 'BLOCK_JITTER_MS',
    section: 'strikes',
    label: 'Block jitter (ms)',
    description: '+/- randomization applied to the block duration. Default: 4h.',
    type: 'int',
    default: String(4 * 60 * 60 * 1000),
    min: 0,
  },
  {
    key: 'UNBLOCK_POLL_INTERVAL_MS',
    section: 'strikes',
    label: 'Unblock poll interval (ms)',
    description: 'How often the unblock scheduler checks for expired blocks.',
    type: 'int',
    default: String(2 * 60 * 1000),
    min: 1,
  },
  {
    key: 'BUFFER_WINDOW_MS',
    section: 'strikes',
    label: 'Buffer window (ms)',
    description: 'Debounce window messages are buffered for before classification.',
    type: 'int',
    default: '7000',
    min: 0,
  },
  {
    key: 'NUISANCE_CALL_THRESHOLD',
    section: 'calls',
    label: 'Nuisance call threshold',
    description: 'Unanswered calls tolerated before further calls from that contact are treated as harassment. Overridable per contact.',
    type: 'int',
    default: '2',
    min: 0,
  },
  {
    key: 'NUISANCE_CALL_STRIKE_THRESHOLD',
    section: 'calls',
    label: 'Nuisance call strike threshold',
    description: 'Nuisance-flagged calls before a block is triggered — independent from the message strike threshold.',
    type: 'int',
    default: '3',
    min: 1,
  },
  {
    key: 'NUISANCE_CALL_AUTO_REJECT',
    section: 'calls',
    label: 'Auto-reject nuisance calls',
    description: 'Reject the call itself once it crosses the threshold, in addition to sending the warning. Turn off to only ever send the warning and let the call keep ringing.',
    type: 'bool',
    default: 'true',
  },
  {
    key: 'NUISANCE_CALL_WARNING_MESSAGE',
    section: 'calls',
    label: 'Nuisance call fallback warning',
    description: "Sent instead of a generated, same-language warning when generation fails or the contact has no recent messages to match a language from. {strikes} and {threshold} are replaced with the contact's current call-strike count and NUISANCE_CALL_STRIKE_THRESHOLD.",
    type: 'string',
    default: "Please stop calling repeatedly without a reply — this is strike {strikes} of {threshold}. Further calls may result in you being blocked.",
    required: true,
  },
];

const SETTINGS_BY_KEY = new Map(SETTINGS.map((def) => [def.key, def]));

function validateValue(def: SettingDef, raw: string): string | undefined {
  if (def.type === 'string') {
    if (def.required && raw.trim() === '') return `${def.label} must not be empty`;
    return undefined;
  }
  if (def.type === 'bool') {
    return raw === '0' || raw === '1' ? undefined : `${def.label} must be "0" or "1"`;
  }
  const num = Number(raw);
  if (raw.trim() === '' || Number.isNaN(num) || !Number.isFinite(num)) return `${def.label} must be a number`;
  if (def.type === 'int' && !Number.isInteger(num)) return `${def.label} must be an integer`;
  if (def.min !== undefined && num < def.min) return `${def.label} must be at least ${def.min}`;
  return undefined;
}

// Falls back to "no row" (letting callers use the manifest default) rather
// than throwing, on the rare chance the DB read itself fails (locked file,
// corruption) — this sits under classifyMessage/generateWarningMessage's
// documented fail-open contract, so a config-read hiccup must not become an
// uncaught exception that aborts the rest of a burst mid-processing.
function readRow(key: string): SettingRecord | undefined {
  try {
    return getOrm().select().from(settings).where(eq(settings.key, key)).get();
  } catch (err) {
    logger.error({ key, error: err instanceof Error ? err.message : String(err) }, 'settings read failed; falling back to default');
    return undefined;
  }
}

/**
 * Raw key/value access, independent of the tunables manifest below — for
 * callers (policy.ts) that manage their own settings-table key outside of
 * SETTINGS, such as the free-text global policy.
 */
export function getRawValue(key: string): string | undefined {
  return readRow(key)?.value;
}

export function setRawValue(key: string, value: string): void {
  getOrm()
    .insert(settings)
    .values({ key, value, updated_at: Date.now() })
    .onConflictDoUpdate({ target: settings.key, set: { value: excluded(settings.value), updated_at: excluded(settings.updated_at) } })
    .run();
}

/**
 * A manifest setting's current value — the DB row if one exists, otherwise
 * its hardcoded default. Throws on a key not in SETTINGS: every call site
 * should be reading a key that's actually part of the tunables manifest,
 * so an unknown key here is a programming error, not a fallible lookup.
 */
export function getRawSetting(key: string): string {
  const def = SETTINGS_BY_KEY.get(key);
  if (!def) throw new Error(`unknown setting: ${key}`);
  return getRawValue(key) ?? def.default;
}

export function getNumberSetting(key: string): number {
  return Number(getRawSetting(key));
}

export function getBoolSetting(key: string): boolean {
  return getRawSetting(key) === '1';
}

export interface SettingView {
  key: string;
  section: SettingSection;
  label: string;
  description: string;
  type: SettingType;
  value: string;
  default: string;
  // Surfaced so the web control app can mirror validateValue()'s own
  // constraints client-side (an inline check before the round-trip, not a
  // replacement for it) instead of only finding out a value was rejected
  // after submitting it.
  min?: number;
  required?: boolean;
}

export function listSettings(): SettingView[] {
  const rows = getOrm().select({ key: settings.key, value: settings.value }).from(settings).all();
  const values = new Map(rows.map((row) => [row.key, row.value]));
  return SETTINGS.map((def) => ({
    key: def.key,
    section: def.section,
    label: def.label,
    description: def.description,
    type: def.type,
    value: values.get(def.key) ?? def.default,
    default: def.default,
    min: def.min,
    required: def.required,
  }));
}

/**
 * Validates against the manifest and persists a tunable. Fails closed on an
 * unknown key or a value that doesn't match the declared type, rather than
 * silently storing something the classifier/pipeline would later choke on.
 */
export function setSetting(key: string, value: string): { ok: true } | { ok: false; error: string } {
  const def = SETTINGS_BY_KEY.get(key);
  if (!def) return { ok: false, error: `unknown setting: ${key}` };

  const error = validateValue(def, value);
  if (error) return { ok: false, error };

  setRawValue(key, value);
  emitControlEvent('settings');
  return { ok: true };
}

/**
 * One-time carry-over for anyone upgrading from a version where SHADOW_MODE
 * was a process-env flag (checked once at startup, `=== '1'`) rather than a
 * settings-store tunable. Call this *before* ensureDefaultsSeeded() — it
 * only acts when SHADOW_MODE has no row yet, so ensureDefaultsSeeded's own
 * hardcoded-default seed would otherwise win the race and this becomes a
 * silent no-op. Without this, an operator who had already verified real
 * traffic and set SHADOW_MODE=0 in their old .env would have that
 * moderation actually running silently revert to log-only after upgrading,
 * with nothing in the logs calling out why.
 */
export function migrateShadowModeFromEnv(): void {
  const raw = process.env.SHADOW_MODE;
  if (raw === undefined) return;
  if (getRawValue('SHADOW_MODE') !== undefined) return;
  // Matches the old env-var contract exactly: only the literal string '1'
  // meant "shadow mode on," any other value meant off.
  setRawValue('SHADOW_MODE', raw === '1' ? '1' : '0');
}

/**
 * Seeds every manifest key with its hardcoded default the first time it's
 * ever read (i.e. it has no row yet). Idempotent and safe to call on every
 * startup — a no-op once a key has a row, whether from this seeding or a
 * later web-UI edit. Call migrateShadowModeFromEnv() first (see its own
 * doc comment) so SHADOW_MODE's carry-over isn't raced by this function's
 * own hardcoded default for that same key.
 */
export function ensureDefaultsSeeded(): void {
  const now = Date.now();
  getOrm()
    .insert(settings)
    .values(SETTINGS.map((def) => ({ key: def.key, value: def.default, updated_at: now })))
    .onConflictDoNothing({ target: settings.key })
    .run();
}
