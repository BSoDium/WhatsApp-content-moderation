import { eq } from 'drizzle-orm';
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
 * row yet). Both counts are net of time-based decay, computed on read: the
 * strike count from `updated_at` (the last call strike, which nothing else
 * in this file moves) and the unanswered count from `unanswered_updated_at`
 * (the last unanswered call), each against its own setting.
 */
export function getCallState(contactId: string): CallState {
  const row = getOrm()
    .select({
      unanswered_count: callStrikes.unanswered_count,
      strike_count: callStrikes.strike_count,
      updated_at: callStrikes.updated_at,
      unanswered_updated_at: callStrikes.unanswered_updated_at,
    })
    .from(callStrikes)
    .where(eq(callStrikes.contact_id, contactId))
    .get();
  if (!row) return EMPTY_STATE;
  const now = Date.now();
  const strikes = settleStrikes({ count: row.strike_count, updatedAt: row.updated_at }, now, getNumberSetting('STRIKE_DECAY_MS'));
  const unanswered = settleStrikes({ count: row.unanswered_count, updatedAt: row.unanswered_updated_at }, now, getNumberSetting('UNANSWERED_CALL_DECAY_MS'));
  return { unansweredCount: unanswered.count, strikeCount: strikes.count };
}

/**
 * Clears a contact's unanswered-call and call-strike counts back to zero. A
 * no-op when they have no row. Doesn't emit a control event, for the same
 * reason as strikes.ts's resetStrikes.
 */
export function resetCallState(contactId: string): void {
  getOrm().update(callStrikes).set({ unanswered_count: 0, strike_count: 0, updated_at: Date.now(), unanswered_updated_at: Date.now() }).where(eq(callStrikes.contact_id, contactId)).run();
}

/**
 * Records a call that rang out without being answered (or was manually
 * declined): increments the contact's decayed unanswered-call count by one
 * and restarts its decay timer.
 */
export function recordUnansweredCall(contactId: string): number {
  const unansweredCount = getCallState(contactId).unansweredCount + 1;
  const now = Date.now();
  getOrm()
    .insert(callStrikes)
    .values({ contact_id: contactId, unanswered_count: unansweredCount, strike_count: 0, updated_at: now, unanswered_updated_at: now })
    .onConflictDoUpdate({
      target: callStrikes.contact_id,
      set: { unanswered_count: unansweredCount, unanswered_updated_at: now },
    })
    .run();
  emitControlEvent('roster');
  return unansweredCount;
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
 * Restarts the unanswered-call decay timer without changing the count. Called
 * for a call this app rejected: a rejected call never produces the 'timeout'
 * that would otherwise do it, so a contact who keeps calling stays over the
 * threshold until a full decay window passes without a call. A no-op when
 * they have no row.
 */
export function restartUnansweredDecay(contactId: string): void {
  const { unansweredCount } = getCallState(contactId);
  getOrm()
    .update(callStrikes)
    .set({ unanswered_count: unansweredCount, unanswered_updated_at: Date.now() })
    .where(eq(callStrikes.contact_id, contactId))
    .run();
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
