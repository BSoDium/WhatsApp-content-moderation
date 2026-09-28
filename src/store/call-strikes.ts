import { eq, sql } from 'drizzle-orm';
import { getOrm } from './db.ts';
import { emitControlEvent } from './events.ts';
import { excluded } from './excluded.ts';
import { callStrikes } from './schema.ts';

export interface CallState {
  unansweredCount: number;
  strikeCount: number;
}

const EMPTY_STATE: CallState = { unansweredCount: 0, strikeCount: 0 };

/**
 * Returns a contact's current nuisance-call state (zeroes if they have no
 * row yet).
 */
export function getCallState(contactId: string): CallState {
  const row = getOrm()
    .select({ unanswered_count: callStrikes.unanswered_count, strike_count: callStrikes.strike_count })
    .from(callStrikes)
    .where(eq(callStrikes.contact_id, contactId))
    .get();
  return row ? { unansweredCount: row.unanswered_count, strikeCount: row.strike_count } : EMPTY_STATE;
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
      set: { unanswered_count: sql`${callStrikes.unanswered_count} + 1`, updated_at: excluded(callStrikes.updated_at) },
    })
    .returning({ unanswered_count: callStrikes.unanswered_count })
    .get();
  emitControlEvent('roster');
  return row.unanswered_count;
}

/**
 * Records a nuisance call that was rejected and/or warned: increments the
 * contact's call-strike count by one, toward NUISANCE_CALL_STRIKE_THRESHOLD.
 */
export function recordCallStrike(contactId: string): number {
  const row = getOrm()
    .insert(callStrikes)
    .values({ contact_id: contactId, unanswered_count: 0, strike_count: 1, updated_at: Date.now() })
    .onConflictDoUpdate({
      target: callStrikes.contact_id,
      set: { strike_count: sql`${callStrikes.strike_count} + 1`, updated_at: excluded(callStrikes.updated_at) },
    })
    .returning({ strike_count: callStrikes.strike_count })
    .get();
  emitControlEvent('roster');
  return row.strike_count;
}

/**
 * Records an answered call: resets the unanswered-call count to zero (the
 * contact got through this time) and decays the call-strike count by one,
 * floored at zero — mirrors src/store/strikes.ts's decayStrike.
 */
export function recordAnsweredCall(contactId: string): CallState {
  const row = getOrm()
    .insert(callStrikes)
    .values({ contact_id: contactId, unanswered_count: 0, strike_count: 0, updated_at: Date.now() })
    .onConflictDoUpdate({
      target: callStrikes.contact_id,
      set: {
        unanswered_count: 0,
        strike_count: sql`MAX(${callStrikes.strike_count} - 1, 0)`,
        updated_at: excluded(callStrikes.updated_at),
      },
    })
    .returning({ unanswered_count: callStrikes.unanswered_count, strike_count: callStrikes.strike_count })
    .get();
  emitControlEvent('roster');
  return { unansweredCount: row.unanswered_count, strikeCount: row.strike_count };
}
