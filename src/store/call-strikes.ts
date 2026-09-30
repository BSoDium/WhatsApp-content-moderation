import { eq, sql } from 'drizzle-orm';
import { getOrm } from './db.ts';
import { emitControlEvent } from './events.ts';
import { excluded } from './excluded.ts';
import { callStrikes } from './schema.ts';
import { getNumberSetting } from './settings.ts';
import { settleStrikes } from './strike-decay.ts';

export interface CallState {
  unansweredCount: number;
  strikeCount: number;
}

const EMPTY_STATE: CallState = { unansweredCount: 0, strikeCount: 0 };

/**
 * Returns a contact's current nuisance-call state (zeroes if they have no
 * row yet). The strike count is net of time-based decay, computed on read
 * from `updated_at` — the time of the last call strike, which nothing else
 * in this file moves.
 */
export function getCallState(contactId: string): CallState {
  const row = getOrm()
    .select({ unanswered_count: callStrikes.unanswered_count, strike_count: callStrikes.strike_count, updated_at: callStrikes.updated_at })
    .from(callStrikes)
    .where(eq(callStrikes.contact_id, contactId))
    .get();
  if (!row) return EMPTY_STATE;
  const { count } = settleStrikes({ count: row.strike_count, updatedAt: row.updated_at }, Date.now(), getNumberSetting('STRIKE_DECAY_MS'));
  return { unansweredCount: row.unanswered_count, strikeCount: count };
}

/**
 * Clears a contact's unanswered-call and call-strike counts back to zero. A
 * no-op when they have no row. Doesn't emit a control event, for the same
 * reason as strikes.ts's resetStrikes.
 */
export function resetCallState(contactId: string): void {
  getOrm().update(callStrikes).set({ unanswered_count: 0, strike_count: 0, updated_at: Date.now() }).where(eq(callStrikes.contact_id, contactId)).run();
}

/**
 * Records a call that rang out without being answered (or was manually
 * declined): increments the contact's unanswered-call count by one.
 */
export function recordUnansweredCall(contactId: string): number {
  const row = getOrm()
    .insert(callStrikes)
    .values({ contact_id: contactId, unanswered_count: 1, strike_count: 0, updated_at: Date.now() })
    .onConflictDoUpdate({
      target: callStrikes.contact_id,
      set: { unanswered_count: sql`${callStrikes.unanswered_count} + 1` },
    })
    .returning({ unanswered_count: callStrikes.unanswered_count })
    .get();
  emitControlEvent('roster');
  return row.unanswered_count;
}

/**
 * Records a nuisance call that was rejected and/or warned: increments the
 * contact's decayed call-strike count by one, toward
 * NUISANCE_CALL_STRIKE_THRESHOLD, and restarts the decay timer.
 */
export function recordCallStrike(contactId: string): number {
  const strikeCount = getCallState(contactId).strikeCount + 1;
  getOrm()
    .insert(callStrikes)
    .values({ contact_id: contactId, unanswered_count: 0, strike_count: strikeCount, updated_at: Date.now() })
    .onConflictDoUpdate({ target: callStrikes.contact_id, set: { strike_count: strikeCount, updated_at: excluded(callStrikes.updated_at) } })
    .run();
  emitControlEvent('roster');
  return strikeCount;
}

/**
 * Records an answered call: resets the unanswered-call count to zero (the
 * contact got through this time). Strikes are untouched — they only decay
 * with time, see strike-decay.ts.
 */
export function recordAnsweredCall(contactId: string): void {
  getOrm()
    .insert(callStrikes)
    .values({ contact_id: contactId, unanswered_count: 0, strike_count: 0, updated_at: Date.now() })
    .onConflictDoUpdate({ target: callStrikes.contact_id, set: { unanswered_count: 0 } })
    .run();
  emitControlEvent('roster');
}
