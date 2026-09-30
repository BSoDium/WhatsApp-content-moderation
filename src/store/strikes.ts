import { eq } from 'drizzle-orm';
import { getOrm } from './db.ts';
import { emitControlEvent } from './events.ts';
import { excluded } from './excluded.ts';
import { strikes } from './schema.ts';
import { getNumberSetting } from './settings.ts';
import { settleStrikes } from './strike-decay.ts';
import type { DecayableStrikes } from './strike-decay.ts';

function readSettled(contactId: string): DecayableStrikes {
  const row = getOrm().select({ count: strikes.count, updated_at: strikes.updated_at }).from(strikes).where(eq(strikes.contact_id, contactId)).get();
  if (!row) return { count: 0, updatedAt: 0 };
  return settleStrikes({ count: row.count, updatedAt: row.updated_at }, Date.now(), getNumberSetting('STRIKE_DECAY_MS'));
}

/**
 * Returns a contact's current strike count, net of time-based decay (0 if
 * they have no row yet). Decay is computed on read from `updated_at`, the
 * time of the last strike, so nothing has to run in the background.
 */
export function getStrikeCount(contactId: string): number {
  return readSettled(contactId).count;
}

/**
 * Records a flagged message: increments the contact's decayed strike count by
 * one and restarts the decay timer.
 */
export function recordStrike(contactId: string): number {
  const count = readSettled(contactId).count + 1;
  getOrm()
    .insert(strikes)
    .values({ contact_id: contactId, count, updated_at: Date.now() })
    .onConflictDoUpdate({ target: strikes.contact_id, set: { count, updated_at: excluded(strikes.updated_at) } })
    .run();
  emitControlEvent('roster');
  return count;
}

/**
 * Clears a contact's strike count back to zero. A no-op when they have none.
 * Doesn't emit a control event: the caller resets several counters at once
 * and announces the change a single time.
 */
export function resetStrikes(contactId: string): void {
  getOrm().update(strikes).set({ count: 0, updated_at: Date.now() }).where(eq(strikes.contact_id, contactId)).run();
}
