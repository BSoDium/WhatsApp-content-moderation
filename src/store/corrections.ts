import { eq, inArray } from 'drizzle-orm';
import { getOrm } from './db.ts';
import { emitControlEvent } from './events.ts';
import { auditLog, corrections } from './schema.ts';
import { removeStrike } from './strikes.ts';
import type { CorrectionKind, CorrectionRecord } from '../types.ts';

export type CorrectionResult =
  | { ok: true; correction: CorrectionRecord }
  | { ok: false; reason: 'not-found' | 'already-marked' | 'ineligible'; error: string };

const FLAGGED_ACTIONS = ['delete+warn', 'delete', 'shadow'];
const UNFLAGGED_ACTIONS = ['none', 'shadow'];
const STRIKE_RECORDED_ACTION = 'delete+warn';

/**
 * Records that the classifier got a logged message wrong and undoes what can
 * be undone. A false positive on the message that opened a strike gives that
 * strike back; the deleted message itself can't be restored, since "delete
 * for me" removes it from this device only and WhatsApp offers no way to
 * bring it back. A false negative is recorded without acting: warning a
 * contact retroactively would be a new moderation action, not an undo.
 *
 * One correction per audit row; a second attempt is refused so a strike can
 * never be handed back twice. The audit row itself is left as it was, so the
 * log keeps showing what the classifier decided at the time.
 */
export function markCorrection(auditLogId: number, kind: CorrectionKind, note?: string): CorrectionResult {
  const orm = getOrm();
  const row = orm.select().from(auditLog).where(eq(auditLog.id, auditLogId)).get();
  if (!row) return { ok: false, reason: 'not-found', error: 'audit log entry not found' };
  if (orm.select({ id: corrections.id }).from(corrections).where(eq(corrections.audit_log_id, auditLogId)).get()) {
    return { ok: false, reason: 'already-marked', error: 'this message is already marked' };
  }

  const eligible =
    row.direction === 'them' &&
    row.classification_ok === 1 &&
    (kind === 'false_positive' ? row.flagged === 1 && FLAGGED_ACTIONS.includes(row.action) : row.flagged === 0 && UNFLAGGED_ACTIONS.includes(row.action));
  if (!eligible) {
    const expected = kind === 'false_positive' ? 'a message the classifier flagged' : 'a message the classifier let through';
    return { ok: false, reason: 'ineligible', error: `${kind === 'false_positive' ? 'a false positive' : 'a false negative'} must be ${expected}` };
  }

  const strikeReverted = kind === 'false_positive' && row.action === STRIKE_RECORDED_ACTION;
  if (strikeReverted) removeStrike(row.contact_id);

  const correction = orm
    .insert(corrections)
    .values({ audit_log_id: auditLogId, contact_id: row.contact_id, kind, note: note || null, strike_reverted: Number(strikeReverted), created_at: Date.now() })
    .returning()
    .get();
  emitControlEvent('audit-log');
  return { ok: true, correction };
}

/**
 * Returns the corrections for the given audit log ids, keyed by audit log id.
 */
export function getCorrectionsByAuditLogId(auditLogIds: number[]): Map<number, CorrectionRecord> {
  if (auditLogIds.length === 0) return new Map();
  const rows = getOrm().select().from(corrections).where(inArray(corrections.audit_log_id, auditLogIds)).all();
  return new Map(rows.map((row) => [row.audit_log_id, row]));
}
