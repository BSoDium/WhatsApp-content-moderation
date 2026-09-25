import { getDb } from './db.js';

/**
 * Opens a block record for a contact, due to expire at `unblockAt`
 * (a jittered timestamp — see docs/decisions.md "The block/unblock cycle is
 * itself a ban signal").
 */
export function createBlock(contactId, unblockAt) {
  const db = getDb();
  const { lastInsertRowid } = db
    .prepare('INSERT INTO blocks (contact_id, blocked_at, unblock_at) VALUES (?, ?, ?)')
    .run(contactId, Date.now(), unblockAt);
  return lastInsertRowid;
}

/**
 * Returns the contact's current block record, or undefined if they aren't
 * currently blocked.
 */
export function getActiveBlock(contactId) {
  return getDb()
    .prepare('SELECT * FROM blocks WHERE contact_id = ? AND unblocked_at IS NULL')
    .get(contactId);
}

/**
 * Returns every active block whose `unblock_at` has passed, for the
 * jittered unblock scheduler (docs/roadmap.md issue #8) to act on.
 */
export function getExpiredBlocks(now = Date.now()) {
  return getDb()
    .prepare('SELECT * FROM blocks WHERE unblocked_at IS NULL AND unblock_at <= ?')
    .all(now);
}

/**
 * Marks a block record as resolved once the contact has actually been
 * unblocked.
 */
export function markUnblocked(blockId) {
  getDb()
    .prepare('UPDATE blocks SET unblocked_at = ? WHERE id = ?')
    .run(Date.now(), blockId);
}
