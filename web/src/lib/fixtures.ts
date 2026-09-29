// Sample data for Storybook stories only; nothing under src/ imports this at runtime.
import type { AuditLogEntry, Contact, RosterEntry, ServerStatus, SignedInUser, Setting, Stats } from './types';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

export const FIXTURE_CONTACTS: Contact[] = [
  { id: 'alice', name: 'Alice Moreau', lastMessageAt: Date.now() - 5 * MINUTE_MS, isSelf: false, allowSelf: false },
  { id: 'carol', name: 'Carol — Atelier Lumière', lastMessageAt: Date.now() - 3 * HOUR_MS, isSelf: false, allowSelf: false },
  { id: 'bob', name: 'Bob Nguyen', lastMessageAt: Date.now() - 32 * MINUTE_MS, isSelf: false, allowSelf: false },
  { id: 'dave', name: 'Dave (market)', lastMessageAt: Date.now() - 26 * HOUR_MS, isSelf: false, allowSelf: false },
  { id: 'erin', name: 'Erin', lastMessageAt: Date.now() - 4 * HOUR_MS, isSelf: false, allowSelf: false },
  { id: 'me', name: 'Elliot', lastMessageAt: null, isSelf: true, allowSelf: false },
];

export const FIXTURE_ROSTER: RosterEntry[] = [
  {
    id: 'alice',
    name: 'Alice Moreau',
    escalationEnabled: true,
    context: null,
    paused: false,
    strikeCount: 2,
    block: null,
    callNuisance: { unansweredCount: 0, strikeCount: 0, threshold: 2, thresholdOverride: null },
  },
  {
    id: 'carol',
    name: 'Carol — Atelier Lumière',
    escalationEnabled: true,
    context: 'Runs a small shop — invoice numbers and order links from her are expected, not spam.',
    paused: false,
    strikeCount: 0,
    block: { unblockAt: Date.now() + HOUR_MS },
    callNuisance: { unansweredCount: 1, strikeCount: 0, threshold: 2, thresholdOverride: null },
  },
];

export const FIXTURE_SETTINGS: Setting[] = [
  { key: 'SHADOW_MODE', section: 'general', label: 'Shadow mode', description: 'Log what would happen without deleting or blocking anything.', type: 'bool', value: '1', default: '1' },
  { key: 'classifier.model', section: 'classifier', label: 'Model', description: 'Ollama model used to classify messages.', type: 'string', value: 'llama3.1', default: 'llama3.1', required: true },
  {
    key: 'classifier.timeoutMs',
    section: 'classifier',
    label: 'Timeout (ms)',
    description: 'How long to wait for a classification before failing open.',
    type: 'int',
    value: '90000',
    default: '90000',
    min: 1000,
  },
  {
    key: 'warning.enabled',
    section: 'warning',
    label: 'Send warning messages',
    description: 'Reply to a flagged message with a warning before it counts as a strike.',
    type: 'bool',
    value: '1',
    default: '1',
  },
  { key: 'strikes.limit', section: 'strikes', label: 'Strike limit', description: 'Strikes before a contact is auto-blocked.', type: 'int', value: '3', default: '3', min: 1 },
  {
    key: 'strikes.blockHours',
    section: 'strikes',
    label: 'Block duration (hours)',
    description: 'How long an auto-block lasts once triggered.',
    type: 'float',
    value: '24',
    default: '24',
    min: 0.5,
  },
];

export const FIXTURE_STATS: Stats = {
  monitoredCount: FIXTURE_ROSTER.length,
  activeBlocks: 1,
  totalLogged: 214,
  totalFlaggedDeleted: 6,
  totalWarningsSent: 9,
  totalClassifierErrors: 1,
  byCategory: [
    { category: 'spam', count: 5 },
    { category: 'scam', count: 2 },
    { category: 'harassment', count: 2 },
  ],
};

export const FIXTURE_STATS_EMPTY: Stats = {
  monitoredCount: 0,
  activeBlocks: 0,
  totalLogged: 0,
  totalFlaggedDeleted: 0,
  totalWarningsSent: 0,
  totalClassifierErrors: 0,
  byCategory: [],
};

export const FIXTURE_AUDIT_LOG: AuditLogEntry[] = [
  {
    id: 5,
    contactId: 'alice',
    contactName: 'Alice Moreau',
    direction: 'them',
    message: 'Check out this link for free crypto!! [link]',
    classificationOk: true,
    flagged: true,
    category: 'scam',
    reason: 'Unsolicited investment link',
    error: null,
    action: 'delete+warn',
    createdAt: Date.now() - 10 * MINUTE_MS,
  },
  {
    id: 4,
    contactId: 'carol',
    contactName: 'Carol — Atelier Lumière',
    direction: 'them',
    message: 'Invoice #4821 attached, thanks!',
    classificationOk: true,
    flagged: false,
    category: null,
    reason: null,
    error: null,
    action: 'none',
    createdAt: Date.now() - 3 * HOUR_MS,
  },
  {
    id: 3,
    contactId: 'alice',
    contactName: 'Alice Moreau',
    direction: 'me',
    message: "That's the second time today, please stop.",
    classificationOk: true,
    flagged: false,
    category: null,
    reason: null,
    error: null,
    action: 'none',
    createdAt: Date.now() - 4 * HOUR_MS,
  },
  {
    id: 2,
    contactId: 'bob',
    contactName: 'Bob Nguyen',
    direction: 'them',
    message: 'hey can we talk later',
    classificationOk: false,
    flagged: null,
    category: null,
    reason: null,
    error: 'Ollama request timed out',
    action: 'classifier_error',
    createdAt: Date.now() - 26 * HOUR_MS,
  },
  {
    id: 1,
    contactId: 'dave',
    contactName: 'Dave (market)',
    direction: 'them',
    message: 'Reminder: pickup is at 6pm',
    classificationOk: true,
    flagged: false,
    category: null,
    reason: null,
    error: null,
    action: 'none',
    createdAt: Date.now() - 48 * HOUR_MS,
  },
];

export const FIXTURE_USER: SignedInUser = {
  login: 'elliot@example.com',
  name: 'Elliot Négrel-Jerzy',
  pictureUrl: null,
  tailnet: 'tail1234.ts.net',
};

export const FIXTURE_STATUS: ServerStatus = {
  version: '0.1.0',
  serverTime: Date.now(),
  startedAt: Date.now() - (26 * HOUR_MS + 14 * MINUTE_MS),
  whatsapp: { status: 'open', since: Date.now() - 3 * HOUR_MS, statusCode: null },
};
