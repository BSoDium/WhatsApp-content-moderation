import { and, count, desc, eq, isNull, lte } from 'drizzle-orm';
import { getOrm } from './db.ts';
import { blocks } from './schema.ts';
import type { BlockRecord } from '../types.ts';

/**
 * Opens a block record for a contact, due to expire at `unblockAt`
 * (a jittered timestamp — see docs/decisions.md "The block/unblock cycle is
 * itself a ban signal").
 */
export function createBlock(contactId: string, unblockAt: number): number {
  const { lastInsertRowid } = getOrm()
    .insert(blocks)
    .values({ contact_id: contactId, blocked_at: Date.now(), unblock_at: unblockAt })
    .run();
  return Number(lastInsertRowid);
}

/**
 * Returns the contact's current block record, or undefined if they aren't
 * currently blocked.
 */
export function getActiveBlock(contactId: string): BlockRecord | undefined {
  return getOrm()
    .select()
    .from(blocks)
    .where(and(eq(blocks.contact_id, contactId), isNull(blocks.unblocked_at)))
    .get();
}

/**
 * Returns every block record for a contact, resolved or not, newest first —
 * the history incremental block durations are derived from.
 */
export function getBlockHistory(contactId: string): BlockRecord[] {
  return getOrm().select().from(blocks).where(eq(blocks.contact_id, contactId)).orderBy(desc(blocks.blocked_at)).all();
}

/**
 * Returns every block record that hasn't been resolved yet.
 */
export function getActiveBlocks(): BlockRecord[] {
  return getOrm().select().from(blocks).where(isNull(blocks.unblocked_at)).all();
}

/**
 * Returns how many contacts are currently blocked, for the control app's
 * activity stats panel.
 */
export function countActiveBlocks(): number {
  const row = getOrm().select({ n: count() }).from(blocks).where(isNull(blocks.unblocked_at)).get();
  return row?.n ?? 0;
}

/**
 * Returns every active block whose `unblock_at` has passed, for the
 * jittered unblock scheduler (docs/roadmap.md issue #8) to act on.
 */
export function getExpiredBlocks(now = Date.now()): BlockRecord[] {
  return getOrm()
    .select()
    .from(blocks)
    .where(and(isNull(blocks.unblocked_at), lte(blocks.unblock_at, now)))
    .all();
}

/**
 * Marks a block record as resolved once the contact has actually been
 * unblocked. Conditioned on the record still being active, so a duplicate
 * call (e.g. two overlapping scheduler ticks) is a safe no-op rather than
 * overwriting unblocked_at twice — returns whether this call was the one
 * that resolved it.
 */
export function markUnblocked(blockId: number): boolean {
  const { changes } = getOrm()
    .update(blocks)
    .set({ unblocked_at: Date.now() })
    .where(and(eq(blocks.id, blockId), isNull(blocks.unblocked_at)))
    .run();
  return changes > 0;
}
