import { getDb } from './db.ts';
import { emitControlEvent } from './events.ts';
import type { SettingRecord } from '../types.ts';

export type SettingSection = 'classifier' | 'warning' | 'strikes';
export type SettingType = 'string' | 'int' | 'float';

export interface SettingDef {
  key: string;
  section: SettingSection;
  label: string;
  description: string;
  type: SettingType;
  default: string;
}

// Same defaults this project used to document in .env.example. Hardcoded
// here, not read from process.env — moderation tuning moved into the web
// control app entirely, see docs/decisions.md.
export const SETTINGS: readonly SettingDef[] = [
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
  },
  {
    key: 'CLASSIFIER_HISTORY_LIMIT',
    section: 'classifier',
    label: 'History limit',
    description: 'Number of prior messages included as conversation context.',
    type: 'int',
    default: '10',
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
    description: 'How long to wait for a generated warning before falling back to the static message below.',
    type: 'int',
    default: '90000',
  },
  {
    key: 'WARNING_TEMPERATURE',
    section: 'warning',
    label: 'Warning temperature',
    description: '0 = deterministic, higher = more varied phrasing.',
    type: 'float',
    default: '0.4',
  },
  {
    key: 'WARNING_MAX_LENGTH',
    section: 'warning',
    label: 'Warning max length',
    description: "Hard cap on the generated warning's length, in characters — a warning read on a phone screen needs to be a text, not a paragraph.",
    type: 'int',
    default: '180',
  },
  {
    key: 'WARNING_MESSAGE',
    section: 'warning',
    label: 'Fallback warning message',
    description: 'Sent to a contact only if the generated warning fails open (Ollama unreachable, timeout, empty response).',
    type: 'string',
    default: "That message was removed for violating this chat's policy.",
  },
  {
    key: 'STRIKE_THRESHOLD',
    section: 'strikes',
    label: 'Strike threshold',
    description: 'Strikes before a block is triggered.',
    type: 'int',
    default: '3',
  },
  {
    key: 'BLOCK_DURATION_MS',
    section: 'strikes',
    label: 'Block duration (ms)',
    description: 'Block length before auto-unblock is scheduled. Default: 24h.',
    type: 'int',
    default: String(24 * 60 * 60 * 1000),
  },
  {
    key: 'BLOCK_JITTER_MS',
    section: 'strikes',
    label: 'Block jitter (ms)',
    description: '+/- randomization applied to the block duration. Default: 4h.',
    type: 'int',
    default: String(4 * 60 * 60 * 1000),
  },
  {
    key: 'UNBLOCK_POLL_INTERVAL_MS',
    section: 'strikes',
    label: 'Unblock poll interval (ms)',
    description: 'How often the unblock scheduler checks for expired blocks.',
    type: 'int',
    default: String(2 * 60 * 1000),
  },
  {
    key: 'BUFFER_WINDOW_MS',
    section: 'strikes',
    label: 'Buffer window (ms)',
    description: 'Debounce window messages are buffered for before classification.',
    type: 'int',
    default: '7000',
  },
];

const SETTINGS_BY_KEY = new Map(SETTINGS.map((def) => [def.key, def]));

function validateValue(def: SettingDef, raw: string): string | undefined {
  if (def.type === 'string') return undefined;
  if (raw.trim() === '' || Number.isNaN(Number(raw))) return `${def.label} must be a number`;
  if (def.type === 'int' && !Number.isInteger(Number(raw))) return `${def.label} must be an integer`;
  return undefined;
}

function readRow(key: string): SettingRecord | undefined {
  return getDb().prepare('SELECT key, value, updated_at FROM settings WHERE key = ?').get(key) as SettingRecord | undefined;
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
  getDb()
    .prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .run(key, value, Date.now());
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

export interface SettingView {
  key: string;
  section: SettingSection;
  label: string;
  description: string;
  type: SettingType;
  value: string;
  default: string;
}

export function listSettings(): SettingView[] {
  return SETTINGS.map((def) => ({
    key: def.key,
    section: def.section,
    label: def.label,
    description: def.description,
    type: def.type,
    value: getRawSetting(def.key),
    default: def.default,
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
 * Seeds every manifest key with its hardcoded default the first time it's
 * ever read (i.e. it has no row yet). Idempotent and safe to call on every
 * startup — a no-op once a key has a row, whether from this seeding or a
 * later web-UI edit.
 */
export function ensureDefaultsSeeded(): void {
  const insert = getDb().prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO NOTHING');
  const now = Date.now();
  for (const def of SETTINGS) insert.run(def.key, def.default, now);
}
