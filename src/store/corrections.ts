import { desc, eq, inArray } from 'drizzle-orm';
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
const KINDS_FOR_FLAGGED: readonly CorrectionKind[] = ['false_positive', 'confirmed_flag'];
const KINDS_FOR_UNFLAGGED: readonly CorrectionKind[] = ['false_negative', 'confirmed_pass'];

export type Verdict = 'acceptable' | 'unacceptable';

/**
 * What the operator decided about the message: a false positive or a
 * confirmed pass says it was fine, a false negative or a confirmed flag says
 * it was not. This is the label rule suggestions learn from.
 */
export function verdictOf(kind: CorrectionKind): Verdict {
  return kind === 'false_positive' || kind === 'confirmed_pass' ? 'acceptable' : 'unacceptable';
}
const STRIKE_RECORDED_ACTION = 'delete+warn';

/**
 * Records the operator's verdict on a logged message: either that the
 * classifier got it wrong (a false positive or negative, which undoes what can
 * be undone) or that it got it right (a confirmation, which only records). A false positive on the message that opened a strike gives that
 * strike back; the deleted message itself can't be restored, since "delete
 * for me" removes it from this device only and WhatsApp offers no way to
 * bring it back. A false negative or a confirmation is recorded without
 * acting: warning a contact retroactively would be a new moderation action,
 * not an undo.
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

  const flagged = row.flagged === 1 && FLAGGED_ACTIONS.includes(row.action);
  const passed = row.flagged === 0 && UNFLAGGED_ACTIONS.includes(row.action);
  const eligible = row.direction === 'them' && row.classification_ok === 1 && ((flagged && KINDS_FOR_FLAGGED.includes(kind)) || (passed && KINDS_FOR_UNFLAGGED.includes(kind)));
  if (!eligible) {
    return { ok: false, reason: 'ineligible', error: `${kind} does not apply to this message: ${flagged ? 'the classifier flagged it' : passed ? 'the classifier let it through' : 'it was not classified'}` };
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

export interface LabelledExample {
  auditLogId: number;
  contactId: string;
  message: string;
  createdAt: number;
  verdict: Verdict;
  note: string | null;
  // What the classifier decided at the time.
  flagged: boolean;
}

/**
 * Returns every message the operator has labelled, newest first, for one
 * contact or all of them, each paired with what the classifier decided.
 */
export function getLabelledExamples({ contactId, limit }: { contactId?: string; limit: number }): LabelledExample[] {
  const rows = getOrm()
    .select({ correction: corrections, message: auditLog.message, flagged: auditLog.flagged, createdAt: auditLog.created_at })
    .from(corrections)
    .innerJoin(auditLog, eq(auditLog.id, corrections.audit_log_id))
    .where(contactId === undefined ? undefined : eq(corrections.contact_id, contactId))
    .orderBy(desc(corrections.id))
    .limit(limit)
    .all();
  return rows.map(({ correction, message, flagged, createdAt }) => ({
    auditLogId: correction.audit_log_id,
    contactId: correction.contact_id,
    message,
    createdAt,
    verdict: verdictOf(correction.kind),
    note: correction.note,
    flagged: flagged === 1,
  }));
}
