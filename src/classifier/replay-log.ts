// Replays a contact's real audit log through the classifier — see README "Development" (npm run classifier:replay).

import { readFileSync } from 'node:fs';
import { Ollama } from 'ollama';
import { classifyMessage } from './classifier.ts';
import { toConversationHistory } from '../pipeline/history.ts';
import type { AuditLogRecord } from '../types.ts';

const DEFAULT_REMOVED_CONTEXT_WINDOW_MS = 600_000;
const DEFAULT_TIMEOUT_MS = 300_000;
const MESSAGE_PREVIEW_LENGTH = 50;

const LOG_FILE = process.env.REPLAY_LOG;
const CONTACT_ID = process.env.REPLAY_CONTACT;
const POLICY_FILE = process.env.REPLAY_POLICY_FILE;
const CONTEXT_FILE = process.env.REPLAY_CONTEXT_FILE;
const MODEL = process.env.OLLAMA_MODEL ?? 'llama3.2:3b';
const OLLAMA_HOST = process.env.OLLAMA_HOST ?? 'http://127.0.0.1:11434';
const FROM_ID = Number(process.env.REPLAY_FROM_ID ?? 0);
const HISTORY_LIMIT = Number(process.env.REPLAY_HISTORY_LIMIT ?? 10);
const REMOVED_CONTEXT_WINDOW_MS = Number(process.env.REPLAY_REMOVED_WINDOW_MS ?? DEFAULT_REMOVED_CONTEXT_WINDOW_MS);
const TIMEOUT_MS = Number(process.env.REPLAY_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
const CALL_MARKER = '[voice call]';

if (!LOG_FILE || !CONTACT_ID) {
  console.error('Set REPLAY_LOG (a JSON dump of audit_log rows) and REPLAY_CONTACT (the contact id to replay).');
  process.exit(1);
}

const rows = (JSON.parse(readFileSync(LOG_FILE, 'utf8')) as AuditLogRecord[]).filter((row) => row.contact_id === CONTACT_ID);
const policy = POLICY_FILE ? readFileSync(POLICY_FILE, 'utf8').trim() : undefined;
const contactContext = CONTEXT_FILE ? readFileSync(CONTEXT_FILE, 'utf8').trim() : undefined;
const client = new Ollama({ host: OLLAMA_HOST, fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) }) });

const incoming = rows.filter((row) => row.direction === 'them' && row.id >= FROM_ID && !row.message.startsWith(CALL_MARKER) && row.action !== 'classifier_error');
const label = (flagged: boolean | null) => (flagged === null ? 'err ' : flagged ? 'FLAG' : 'pass');
let changed = 0;

console.log(`model=${MODEL} messages=${incoming.length}\nid    prod  now   message`);
for (const row of incoming) {
  const history = rows
    .filter((other) => other.id !== row.id && other.created_at <= row.created_at)
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, HISTORY_LIMIT);
  const result = await classifyMessage(
    { message: row.message, history: toConversationHistory(history, row.created_at - REMOVED_CONTEXT_WINDOW_MS), model: MODEL, contactContext },
    { client, policy },
  );
  const now = result.ok ? result.flagged : null;
  const prod = row.flagged === 1;
  if (now !== prod) changed++;
  console.log(`${String(row.id).padEnd(5)} ${label(prod)}  ${label(now)}  ${JSON.stringify(row.message.slice(0, MESSAGE_PREVIEW_LENGTH))}${result.ok ? '' : ` ${result.error}`}`);
}
console.log(`${changed}/${incoming.length} verdicts differ from what production recorded`);
