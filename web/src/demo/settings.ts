import type { Setting } from '@/lib/types';

const HOUR_MS = 60 * 60 * 1000;

function setting(definition: Omit<Setting, 'value'> & { value?: string }): Setting {
  return { value: definition.default, ...definition };
}

// Mirrors SETTINGS in src/store/settings.ts; the demo has no server to ask, so a change there needs the same change here.
export const DEMO_SETTINGS: Setting[] = [
  setting({
    key: 'SHADOW_MODE',
    section: 'general',
    label: 'Shadow mode',
    description: 'Classify and log every message without deleting, warning, or blocking. Review the activity log before turning this off.',
    type: 'bool',
    default: '1',
    value: '0',
  }),
  setting({ key: 'OLLAMA_HOST', section: 'classifier', label: 'Ollama host', description: 'Docker Compose and a local Ollama both use this loopback address.', type: 'string', default: 'http://127.0.0.1:11434' }),
  setting({
    key: 'OLLAMA_MODEL',
    section: 'classifier',
    label: 'Classifier model',
    description: 'The Ollama model used to classify incoming messages against the policy.',
    type: 'string',
    default: 'llama3.2:3b',
  }),
  setting({
    key: 'CLASSIFIER_TIMEOUT_MS',
    section: 'classifier',
    label: 'Classifier timeout (ms)',
    description: 'How long to wait for a classification before failing open.',
    type: 'int',
    default: '90000',
    min: 1,
  }),
  setting({
    key: 'CLASSIFIER_HISTORY_LIMIT',
    section: 'classifier',
    label: 'History limit',
    description: 'Number of prior messages included as conversation context.',
    type: 'int',
    default: '10',
    min: 0,
  }),
  setting({
    key: 'WARNING_MODEL',
    section: 'warning',
    label: 'Warning model',
    description: 'Model used to generate the warning reply. Leave blank to inherit the classifier model.',
    type: 'string',
    default: '',
  }),
  setting({
    key: 'WARNING_TIMEOUT_MS',
    section: 'warning',
    label: 'Warning timeout (ms)',
    description: 'How long to wait for each model call while generating a warning (language detection, then the warning itself) before falling back to the static message below.',
    type: 'int',
    default: '90000',
    min: 1,
  }),
  setting({ key: 'WARNING_TEMPERATURE', section: 'warning', label: 'Warning temperature', description: '0 = deterministic, higher = more varied phrasing.', type: 'float', default: '0.4', min: 0 }),
  setting({
    key: 'WARNING_MAX_LENGTH',
    section: 'warning',
    label: 'Warning max length',
    description: 'Longest generated warning that will be sent, in characters. A longer one is never cut short: the static fallback message is sent instead.',
    type: 'int',
    default: '500',
    min: 1,
  }),
  setting({
    key: 'WARNING_MESSAGE',
    section: 'warning',
    label: 'Fallback warning message',
    description: 'Sent to a contact only if the generated warning fails open (Ollama unreachable, timeout, empty response).',
    type: 'string',
    default: "That message was removed for violating this chat's policy.",
    required: true,
  }),
  setting({ key: 'STRIKE_THRESHOLD', section: 'strikes', label: 'Strike threshold', description: 'Strikes before a block is triggered.', type: 'int', default: '3', min: 1 }),
  setting({
    key: 'STRIKE_COOLDOWN_MS',
    section: 'strikes',
    label: 'Strike cooldown (ms)',
    description:
      'After a contact is warned, further flagged messages within this window are still deleted but add no strike and send no new warning, so a contact who sends one violation across several messages is not struck once per message. 0 disables it. Default: 5 min.',
    type: 'int',
    default: String(5 * 60 * 1000),
    min: 0,
  }),
  setting({
    key: 'STRIKE_DECAY_MS',
    section: 'strikes',
    label: 'Strike decay (ms)',
    description:
      'One message strike and one call strike are forgiven for every full window since the contact last earned one. Clean messages and answered calls never erase strikes. 0 disables decay. Default: 24h.',
    type: 'int',
    default: String(24 * HOUR_MS),
    min: 0,
  }),
  setting({
    key: 'BLOCK_DURATION_MS',
    section: 'strikes',
    label: 'Block duration (ms)',
    description: 'Block length before auto-unblock is scheduled. Default: 24h.',
    type: 'int',
    default: String(24 * HOUR_MS),
    min: 1,
  }),
  setting({
    key: 'BLOCK_ESCALATING',
    section: 'strikes',
    label: 'Escalating blocks',
    description:
      'Lengthen the block each time the same contact is blocked again, instead of always using the fixed block duration above. A contact who stays clear of blocks for the reset window starts over at the first step.',
    type: 'bool',
    default: '0',
  }),
  setting({
    key: 'BLOCK_ESCALATION_BASE_MS',
    section: 'strikes',
    label: 'Escalation first block (ms)',
    description: 'Length of the first block when escalating blocks are on. Default: 3h.',
    type: 'int',
    default: String(3 * HOUR_MS),
    min: 1,
  }),
  setting({
    key: 'BLOCK_ESCALATION_FACTOR',
    section: 'strikes',
    label: 'Escalation factor',
    description: 'Each repeat block lasts this many times as long as the previous one. Default: 2 (3h, 6h, 12h, 24h...).',
    type: 'float',
    default: '2',
    min: 1,
  }),
  setting({
    key: 'BLOCK_ESCALATION_MAX_MS',
    section: 'strikes',
    label: 'Escalation longest block (ms)',
    description: 'Upper limit for an escalated block. Default: 7 days.',
    type: 'int',
    default: String(7 * 24 * HOUR_MS),
    min: 1,
  }),
  setting({
    key: 'BLOCK_ESCALATION_RESET_MS',
    section: 'strikes',
    label: 'Escalation reset (ms)',
    description: 'Time a contact must go without being blocked, counted from the end of their last block, before the next block starts over at the first step. Default: 7 days.',
    type: 'int',
    default: String(7 * 24 * HOUR_MS),
    min: 1,
  }),
  setting({
    key: 'BLOCK_JITTER_MS',
    section: 'strikes',
    label: 'Block jitter (ms)',
    description: '+/- randomization applied to the block duration. Default: 4h.',
    type: 'int',
    default: String(4 * HOUR_MS),
    min: 0,
  }),
  setting({
    key: 'UNBLOCK_POLL_INTERVAL_MS',
    section: 'strikes',
    label: 'Unblock poll interval (ms)',
    description: 'How often the unblock scheduler checks for expired blocks.',
    type: 'int',
    default: String(2 * 60 * 1000),
    min: 1,
  }),
  setting({
    key: 'BUFFER_WINDOW_MS',
    section: 'strikes',
    label: 'Buffer window (ms)',
    description: 'Debounce window messages are buffered for before classification.',
    type: 'int',
    default: '7000',
    min: 0,
  }),
  setting({
    key: 'NUISANCE_CALL_THRESHOLD',
    section: 'calls',
    label: 'Nuisance call threshold',
    description: 'Unanswered calls tolerated before further calls from that contact are treated as harassment. Overridable per contact.',
    type: 'int',
    default: '2',
    min: 0,
  }),
  setting({
    key: 'NUISANCE_CALL_STRIKE_THRESHOLD',
    section: 'calls',
    label: 'Nuisance call strike threshold',
    description: 'Nuisance-flagged calls before a block is triggered — independent from the message strike threshold.',
    type: 'int',
    default: '3',
    min: 1,
  }),
  setting({
    key: 'NUISANCE_CALL_AUTO_REJECT',
    section: 'calls',
    label: 'Auto-reject nuisance calls',
    description: 'Reject the call itself once it crosses the threshold, in addition to sending the warning. Turn off to only ever send the warning and let the call keep ringing.',
    type: 'bool',
    default: '1',
  }),
  setting({
    key: 'NUISANCE_CALL_WARNING_MESSAGE',
    section: 'calls',
    label: 'Nuisance call fallback warning',
    description:
      "Sent instead of a generated, same-language warning when generation fails or the contact has no recent messages to match a language from. {strikes} and {threshold} are replaced with the contact's current call-strike count and NUISANCE_CALL_STRIKE_THRESHOLD.",
    type: 'string',
    default: 'Please stop calling repeatedly without a reply — this is strike {strikes} of {threshold}. Further calls may result in you being blocked.',
    required: true,
  }),
];

export const DEMO_POLICY_TEXT = `Protect me from unwanted contact. Flag a message when the contact:
- sends unsolicited promotions, get-rich-quick offers, or cryptocurrency pitches (spam)
- impersonates a bank, tax office, delivery service, relative or recruiter to get money or personal details (scam)
- keeps messaging after being asked to stop, threatens, insults or tries to intimidate me (harassment)
- keeps pressuring me about something I already declined (unwanted contact)

Leave alone: friends and family, colleagues, shops I have ordered from, and ordinary back-and-forth. Teasing between close friends is banter, not harassment. Messages written in French or English are both fine.`;

export function validateSettingValue(definition: Setting, raw: string): string | undefined {
  if (definition.type === 'bool') return raw === '0' || raw === '1' ? undefined : `${definition.key} must be 0 or 1`;
  if (definition.type === 'string') return definition.required && raw.trim() === '' ? `${definition.key} must not be blank` : undefined;
  const parsed = Number(raw);
  if (raw.trim() === '' || !Number.isFinite(parsed)) return `${definition.key} must be a number`;
  if (definition.type === 'int' && !Number.isInteger(parsed)) return `${definition.key} must be a whole number`;
  if (definition.min !== undefined && parsed < definition.min) return `${definition.key} must be at least ${definition.min}`;
  return undefined;
}
