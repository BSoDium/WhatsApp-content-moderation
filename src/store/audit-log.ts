import { getDb } from './db.ts';
import { emitControlEvent } from './events.ts';
import type { AuditLogRecord, Classification } from '../types.ts';

interface AuditLogInput {
  contactId: string;
  direction: 'me' | 'them';
  message: string;
  classification: Classification;
  action: string;
}

export interface AuditLogPageFilter {
  contactId?: string;
  action?: string;
  search?: string;
  before?: number;
  limit?: number;
}

export interface AuditLogStats {
  totalLogged: number;
  totalFlaggedDeleted: number;
  totalWarningsSent: number;
  totalClassifierErrors: number;
  byCategory: { category: string; count: number }[];
}

const DEFAULT_PAGE_LIMIT = 50;

/**
 * Records a message and the outcome of moderating it. Logs classifier
 * failures too, not just flagged/passed verdicts — once a message is
 * actually deleted, this is the only remaining record of what happened and
 * why (see docs/decisions.md "State & audit log via SQLite").
 *
 * @param {{
 *   contactId: string,
 *   direction: 'me'|'them',
 *   message: string,
 *   classification: { ok: true, flagged: boolean, category: string, reason: string }
 *     | { ok: false, error: string },
 *   action: string,
 * }} entry
 */
export function logMessage({ contactId, direction, message, classification, action }: AuditLogInput): void {
  getDb()
    .prepare(
      `INSERT INTO audit_log
         (contact_id, direction, message, classification_ok, flagged, category, reason, error, action, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      contactId,
      direction,
      message,
      classification.ok ? 1 : 0,
      classification.ok ? Number(classification.flagged) : null,
      classification.ok ? classification.category : null,
      classification.ok ? classification.reason : null,
      classification.ok ? null : classification.error,
      action,
      Date.now(),
    );
  emitControlEvent('audit-log');
}

/**
 * Returns a contact's most recent audit log entries, newest first.
 */
export function getAuditLog(contactId: string, limit = DEFAULT_PAGE_LIMIT): AuditLogRecord[] {
  return getDb()
    .prepare('SELECT * FROM audit_log WHERE contact_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(contactId, limit) as unknown as AuditLogRecord[];
}

/**
 * Returns a filterable, cursor-paginated page of audit log entries across
 * every contact (or one, via `contactId`), newest first — the message
 * explorer's backing query. `before` is exclusive on `id` ("older than this
 * row"), not `created_at`: `id` is monotonic with insertion order and never
 * ties the way two events in the same millisecond can, which matters for a
 * stable cursor. `search` matches `message` as a case-insensitive substring.
 */
export function getAuditLogPage({ contactId, action, search, before, limit = DEFAULT_PAGE_LIMIT }: AuditLogPageFilter = {}): AuditLogRecord[] {
  const clauses: string[] = [];
  const params: (string | number)[] = [];
  if (contactId) {
    clauses.push('contact_id = ?');
    params.push(contactId);
  }
  if (action) {
    clauses.push('action = ?');
    params.push(action);
  }
  if (search) {
    clauses.push("message LIKE ? ESCAPE '\\'");
    params.push(`%${search.replace(/[\\%_]/g, '\\$&')}%`);
  }
  if (before !== undefined) {
    clauses.push('id < ?');
    params.push(before);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return getDb()
    .prepare(`SELECT * FROM audit_log ${where} ORDER BY id DESC LIMIT ?`)
    .all(...params, limit) as unknown as AuditLogRecord[];
}

/**
 * All-time counts across every contact, for the control app's activity
 * stats panel. `byCategory` is scoped to actually-flagged-and-deleted
 * messages only (a passed message's category is usually "none" and isn't
 * useful to chart).
 */
export function getAuditLogStats(): AuditLogStats {
  const db = getDb();
  const counts = db
    .prepare(
      `SELECT
         COUNT(*) AS totalLogged,
         SUM(CASE WHEN action = 'delete+warn' THEN 1 ELSE 0 END) AS totalFlaggedDeleted,
         SUM(CASE WHEN action = 'warning_sent' THEN 1 ELSE 0 END) AS totalWarningsSent,
         SUM(CASE WHEN action = 'classifier_error' THEN 1 ELSE 0 END) AS totalClassifierErrors
       FROM audit_log`,
    )
    .get() as { totalLogged: number; totalFlaggedDeleted: number | null; totalWarningsSent: number | null; totalClassifierErrors: number | null };

  return {
    totalLogged: counts.totalLogged,
    totalFlaggedDeleted: counts.totalFlaggedDeleted ?? 0,
    totalWarningsSent: counts.totalWarningsSent ?? 0,
    totalClassifierErrors: counts.totalClassifierErrors ?? 0,
    byCategory: db
      .prepare(
        "SELECT category, COUNT(*) AS count FROM audit_log WHERE action = 'delete+warn' AND category IS NOT NULL GROUP BY category ORDER BY count DESC",
      )
      .all() as { category: string; count: number }[],
  };
}
