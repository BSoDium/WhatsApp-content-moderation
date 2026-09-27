import { getDb } from './db.ts';
import type { BlockRecord } from '../types.ts';

/**
 * Opens a block record for a contact, due to expire at `unblockAt`
 * (a jittered timestamp — see docs/decisions.md "The block/unblock cycle is
 * itself a ban signal").
 */
export function createBlock(contactId: string, unblockAt: number): number {
  const db = getDb();
  const { lastInsertRowid } = db
    .prepare('INSERT INTO blocks (contact_id, blocked_at, unblock_at) VALUES (?, ?, ?)')
    .run(contactId, Date.now(), unblockAt);
  return Number(lastInsertRowid);
}

/**
 * Returns the contact's current block record, or undefined if they aren't
 * currently blocked.
 */
export function getActiveBlock(contactId: string): BlockRecord | undefined {
  return getDb()
    .prepare('SELECT * FROM blocks WHERE contact_id = ? AND unblocked_at IS NULL')
    .get(contactId) as BlockRecord | undefined;
}

/**
 * Returns how many contacts are currently blocked, for the control app's
 * activity stats panel.
 */
export function countActiveBlocks(): number {
  return (getDb().prepare('SELECT COUNT(*) AS n FROM blocks WHERE unblocked_at IS NULL').get() as { n: number }).n;
}

/**
 * Returns every active block whose `unblock_at` has passed, for the
 * jittered unblock scheduler (docs/roadmap.md issue #8) to act on.
 */
export function getExpiredBlocks(now = Date.now()): BlockRecord[] {
  return getDb()
    .prepare('SELECT * FROM blocks WHERE unblocked_at IS NULL AND unblock_at <= ?')
    .all(now) as unknown as BlockRecord[];
}

/**
 * Marks a block record as resolved once the contact has actually been
 * unblocked. Conditioned on the record still being active, so a duplicate
 * call (e.g. two overlapping scheduler ticks) is a safe no-op rather than
 * overwriting unblocked_at twice — returns whether this call was the one
 * that resolved it.
 */
export function markUnblocked(blockId: number): boolean {
  const { changes } = getDb()
    .prepare('UPDATE blocks SET unblocked_at = ? WHERE id = ? AND unblocked_at IS NULL')
    .run(Date.now(), blockId);
  return changes > 0;
}
