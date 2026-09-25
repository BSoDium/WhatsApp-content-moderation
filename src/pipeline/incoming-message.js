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
 * @param {object} msg - one entry from a Baileys `messages.upsert` event
 * @param {string} targetJid - the JID of the contact being moderated
 * @returns {{ text: string, key: object, timestamp: number } | null}
 */
export function extractIncomingMessage(msg, targetJid) {
  if (!msg.message) return null;
  if (msg.key.fromMe) return null;
  if (msg.key.remoteJid !== targetJid) return null;

  const text = msg.message.conversation ?? msg.message.extendedTextMessage?.text;
  if (!text) return null;

  return { text, key: msg.key, timestamp: Number(msg.messageTimestamp) * 1000 };
}
