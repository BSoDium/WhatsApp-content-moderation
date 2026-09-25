// Thin wrappers around the Baileys socket calls the moderation pipeline
// acts through. Kept separate from index.js's connection wiring so these
// can be exercised directly against a live socket — see test-actions.js —
// without booting the classifier/buffer/pipeline at all.

export function deleteForMe(sock, jid, key, timestamp) {
  return sock.chatModify({ deleteForMe: { deleteMedia: false, key, timestamp } }, jid);
}

export function sendWarning(sock, jid, text) {
  return sock.sendMessage(jid, { text });
}
