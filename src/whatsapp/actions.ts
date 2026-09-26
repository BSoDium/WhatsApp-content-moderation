import type { WAMessageKey, WASocket } from '@whiskeysockets/baileys';

// Split out of index.ts so test-actions.js can exercise these directly, without booting the classifier/buffer/pipeline.

/**
 * Deletes `key` from `jid`'s chat via a `deleteForMe` app-state patch.
 * Needs an app-state sync key WhatsApp pushes a few minutes after a fresh
 * companion-device link settles — throws `App state key not present!`
 * until then (see README "Validating 'delete for me'").
 */
export function deleteForMe(sock: WASocket, jid: string, key: WAMessageKey, timestamp: number) {
  return sock.chatModify({ deleteForMe: { deleteMedia: false, key, timestamp } }, jid);
}

export function sendWarning(sock: WASocket, jid: string, text: string) {
  return sock.sendMessage(jid, { text });
}

export function block(sock: WASocket, jid: string) {
  return sock.updateBlockStatus(jid, 'block');
}

export function unblock(sock: WASocket, jid: string) {
  return sock.updateBlockStatus(jid, 'unblock');
}
