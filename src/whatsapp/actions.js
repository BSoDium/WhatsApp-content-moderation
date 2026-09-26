// Split out of index.js so test-actions.js can exercise these directly, without booting the classifier/buffer/pipeline.

/**
 * Deletes `key` from `jid`'s chat via a `deleteForMe` app-state patch.
 * Needs an app-state sync key WhatsApp pushes a few minutes after a fresh
 * companion-device link settles — throws `App state key not present!`
 * until then (see README "Validating 'delete for me'").
 */
export function deleteForMe(sock, jid, key, timestamp) {
  return sock.chatModify({ deleteForMe: { deleteMedia: false, key, timestamp } }, jid);
}

export function sendMessage(sock, jid, text) {
  return sock.sendMessage(jid, { text });
}

export function sendWarning(sock, jid, text) {
  return sendMessage(sock, jid, text);
}

export function block(sock, jid) {
  return sock.updateBlockStatus(jid, 'block');
}

export function unblock(sock, jid) {
  return sock.updateBlockStatus(jid, 'unblock');
}
