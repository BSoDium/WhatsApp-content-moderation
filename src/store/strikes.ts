import { eq, sql } from 'drizzle-orm';
import { getOrm } from './db.ts';
import { emitControlEvent } from './events.ts';
import { excluded } from './excluded.ts';
import { strikes } from './schema.ts';

/**
 * Returns a contact's current strike count (0 if they have no row yet).
 */
export function getStrikeCount(contactId: string): number {
  const row = getOrm().select({ count: strikes.count }).from(strikes).where(eq(strikes.contact_id, contactId)).get();
  return row?.count ?? 0;
}

/**
 * Records a flagged message: increments the contact's strike count by one.
 */
export function recordStrike(contactId: string): number {
  getOrm()
    .insert(strikes)
    .values({ contact_id: contactId, count: 1, updated_at: Date.now() })
    .onConflictDoUpdate({
      target: strikes.contact_id,
      set: { count: sql`${strikes.count} + 1`, updated_at: excluded(strikes.updated_at) },
    })
    .run();
  emitControlEvent('roster');
  return getStrikeCount(contactId);
}

/**
 * Records a passed (non-flagged) message: decays the contact's strike count
 * by one, floored at zero — see docs/roadmap.md issue #5.
 */
export function decayStrike(contactId: string): number {
  getOrm()
    .insert(strikes)
    .values({ contact_id: contactId, count: 0, updated_at: Date.now() })
    .onConflictDoUpdate({
      target: strikes.contact_id,
      set: { count: sql`MAX(${strikes.count} - 1, 0)`, updated_at: excluded(strikes.updated_at) },
    })
    .run();
  emitControlEvent('roster');
  return getStrikeCount(contactId);
}
