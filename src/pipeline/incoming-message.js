/**
 * Extracts the buffer-ready shape of one incoming Baileys message, or null
 * if it should be skipped: sent by us (including our own warning replies —
 * messages.upsert fires for those too), from a contact other than the one
 * being moderated, or without text content. Media messages are skipped
 * rather than passed through with a placeholder, since they're out of
 * scope for now (see docs/decisions.md "Media messages are out of scope
 * for now") — unlike src/prototype/test-delete-for-me.js, which deletes
 * unconditionally and doesn't need to classify anything.
 *
 * `allowSelf` mirrors src/prototype/test-delete-for-me.js's TEST_ALLOW_SELF:
 * without a second WhatsApp number, self-sent messages are the only way to
 * exercise this against real traffic, but it must stay opt-in — with it
 * off, a bot's own warning reply must never re-enter the pipeline.
 *
 * @param {object} msg - one entry from a Baileys `messages.upsert` event
 * @param {string} targetJid - the JID of the contact being moderated
 * @param {boolean} [allowSelf] - also accept messages sent from our own account
 * @returns {{ text: string, key: object, timestamp: number } | null}
 */
export function extractIncomingMessage(msg, targetJid, allowSelf = false) {
  if (!msg.message) return null;
  if (msg.key.fromMe && !allowSelf) return null;
  if (msg.key.remoteJid !== targetJid) return null;

  const text = msg.message.conversation ?? msg.message.extendedTextMessage?.text;
  if (!text) return null;

  return { text, key: msg.key, timestamp: Number(msg.messageTimestamp) * 1000 };
}
