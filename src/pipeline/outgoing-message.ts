import { logMessage } from '../store/audit-log.ts';
import { extractMessageText, extractMessageTimestamp } from './message-text.ts';
import type { WAMessage } from '@whiskeysockets/baileys';

export const OUTGOING_ACTION = 'outgoing';

interface OutgoingMessage {
  text: string;
  timestamp: number;
}

/**
 * Extracts a text message the user sent to a contact from their own phone,
 * or null if it isn't one. Only live `notify` deliveries count: Baileys
 * tags this socket's own sends (the bot's warning replies) as `append`, so
 * the same `type` guard as extractIncomingMessage keeps automated warnings
 * from being recorded as the user's words.
 */
export function extractOutgoingMessage(msg: WAMessage, type: string = 'notify'): OutgoingMessage | null {
  if (type !== 'notify' || !msg.key.fromMe) return null;

  const text = extractMessageText(msg);
  if (!text) return null;

  return { text, timestamp: extractMessageTimestamp(msg) };
}

/**
 * Logs the user's own message to the audit log so it appears as `Me:` in the
 * classifier's history. Never classified or acted on.
 */
export function recordOutgoingMessage(contactId: string, { text, timestamp }: OutgoingMessage): void {
  logMessage({
    contactId,
    direction: 'me',
    message: text,
    classification: { ok: true, flagged: false, category: 'outgoing', reason: 'sent by the user' },
    action: OUTGOING_ACTION,
    createdAt: timestamp,
  });
}
