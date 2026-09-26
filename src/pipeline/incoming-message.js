/**
 * Extracts the buffer-ready shape of one incoming Baileys message, or null
 * if it should be skipped: not a real-time delivery, sent by us (unless
 * allowSelf), or without text content. Whether the sender is actually a
 * monitored contact is checked by the caller (index.js, against the
 * monitored-contacts roster — issue #32) before this is even called, so
 * this function is a pure structural filter, not a roster check. Media
 * messages are skipped rather than passed through with a placeholder, since
 * they're out of scope for now (see docs/decisions.md "Media messages are
 * out of scope for now") — unlike src/prototype/test-delete-for-me.js,
 * which deletes unconditionally and doesn't need to classify anything.
 *
 * `type !== 'notify'` is the actual anti-feedback-loop guard, not
 * `fromMe`/`allowSelf`: Baileys tags our own sendWarning replies (and other
 * own-account sync traffic) as type 'append', not 'notify', so they're
 * filtered here regardless of allowSelf. `fromMe` alone can't tell a
 * human's self-sent test message apart from the bot's own warning reply —
 * both are `fromMe: true` — so allowSelf must not be treated as safe
 * without this check.
 *
 * @param {object} msg - one entry from a Baileys `messages.upsert` event
 * @param {boolean} [allowSelf] - also accept messages sent from our own account
 * @param {string} [type] - the `messages.upsert` event's own `type` field
 * @returns {{ text: string, key: object, timestamp: number } | null}
 */
export function extractIncomingMessage(msg, allowSelf = false, type = 'notify') {
  if (type !== 'notify') return null;
  if (!msg.message) return null;
  if (msg.key.fromMe && !allowSelf) return null;

  const text = msg.message.conversation ?? msg.message.extendedTextMessage?.text;
  if (!text) return null;

  return { text, key: msg.key, timestamp: Number(msg.messageTimestamp) * 1000 };
}
