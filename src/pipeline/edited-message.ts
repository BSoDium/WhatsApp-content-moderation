import { extractMessageText, extractMessageTimestamp } from './message-text.ts';
import type { WAMessageUpdate } from '@whiskeysockets/baileys';
import type { IncomingMessage } from '../types.ts';

/**
 * Extracts the new text of an edited message from a Baileys
 * `messages.update` event, in the same buffer-ready shape as
 * extractIncomingMessage, or null if the update isn't a text edit (delivery
 * receipts, reactions, and so on arrive on the same event) or was made by us
 * (unless allowSelf). The key is the original message's, so a flagged edit
 * is deleted in place of the version that first passed.
 *
 * Unlike extractIncomingMessage there is no `type` guard: `messages.update`
 * carries no upsert type, and our own warning replies are never edited.
 *
 * @param {object} update - one entry from a Baileys `messages.update` event
 * @param {boolean} [allowSelf] - also accept edits made from our own account
 * @returns {{ text: string, key: object, timestamp: number } | null}
 */
export function extractEditedMessage(update: WAMessageUpdate, allowSelf = false): IncomingMessage | null {
  const edited = update.update.message?.editedMessage?.message;
  if (!edited) return null;
  if (update.key.fromMe && !allowSelf) return null;

  const text = extractMessageText(edited);
  if (!text) return null;

  return { text, key: update.key, timestamp: extractMessageTimestamp(update.update.messageTimestamp) };
}
