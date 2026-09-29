import { and, count, desc, eq, inArray, isNotNull, lt, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { getOrm } from './db.ts';
import { emitControlEvent } from './events.ts';
import { auditLog } from './schema.ts';
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
const FLAGGED_DELETED_ACTIONS = ['delete+warn', 'delete'];
const SHADOW_ACTION = 'shadow';
const WARNING_SENT_ACTION = 'warning_sent';
const CLASSIFIER_ERROR_ACTION = 'classifier_error';

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
  getOrm()
    .insert(auditLog)
    .values({
      contact_id: contactId,
      direction,
      message,
      classification_ok: classification.ok ? 1 : 0,
      flagged: classification.ok ? Number(classification.flagged) : null,
      category: classification.ok ? classification.category : null,
      reason: classification.ok ? classification.reason : null,
      error: classification.ok ? null : classification.error,
      action,
      created_at: Date.now(),
    })
    .run();
  emitControlEvent('audit-log');
}

/**
 * Returns a contact's most recent audit log entries, newest first.
 */
export function getAuditLog(contactId: string, limit = DEFAULT_PAGE_LIMIT): AuditLogRecord[] {
  return getOrm()
    .select()
    .from(auditLog)
    .where(eq(auditLog.contact_id, contactId))
    .orderBy(desc(auditLog.created_at))
    .limit(limit)
    .all();
}

/**
 * When `action` was last logged for a contact, or null if never.
 */
export function getLastActionAt(contactId: string, action: string): number | null {
  const row = getOrm()
    .select({ createdAt: auditLog.created_at })
    .from(auditLog)
    .where(and(eq(auditLog.contact_id, contactId), eq(auditLog.action, action)))
    .orderBy(desc(auditLog.id))
    .limit(1)
    .get();
  return row?.createdAt ?? null;
}

function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, '\\$&');
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
  const conditions: SQL[] = [];
  if (contactId) conditions.push(eq(auditLog.contact_id, contactId));
  if (action) conditions.push(eq(auditLog.action, action));
  // Drizzle's like() has no ESCAPE clause, which the escaped %/_ wildcards need.
  if (search) conditions.push(sql`${auditLog.message} LIKE ${`%${escapeLike(search)}%`} ESCAPE '\\'`);
  if (before !== undefined) conditions.push(lt(auditLog.id, before));
  return getOrm()
    .select()
    .from(auditLog)
    .where(and(...conditions))
    .orderBy(desc(auditLog.id))
    .limit(limit)
    .all();
}

function countWithActions(actions: string[]): SQL<number | null> {
  return sql<number | null>`SUM(CASE WHEN ${inArray(auditLog.action, actions)} THEN 1 ELSE 0 END)`;
}

/**
 * All-time counts across every contact, for the control app's activity
 * stats panel. `byCategory` is scoped to flagged messages only — deleted
 * ones, plus shadow-mode ones the classifier flagged but nothing acted on,
 * so the chart isn't empty while shadow mode is on (a passed message's
 * category is usually "none" and isn't useful to chart).
 */
export function getAuditLogStats(): AuditLogStats {
  const orm = getOrm();
  const counts = orm
    .select({
      totalLogged: count(),
      totalFlaggedDeleted: countWithActions(FLAGGED_DELETED_ACTIONS),
      totalWarningsSent: countWithActions([WARNING_SENT_ACTION]),
      totalClassifierErrors: countWithActions([CLASSIFIER_ERROR_ACTION]),
    })
    .from(auditLog)
    .get();

  const categoryCount = count();
  const byCategory = orm
    .select({ category: auditLog.category, count: categoryCount })
    .from(auditLog)
    .where(and(inArray(auditLog.action, [...FLAGGED_DELETED_ACTIONS, SHADOW_ACTION]), eq(auditLog.flagged, 1), isNotNull(auditLog.category)))
    .groupBy(auditLog.category)
    .orderBy(desc(categoryCount))
    .all() as { category: string; count: number }[];

  return {
    totalLogged: counts?.totalLogged ?? 0,
    totalFlaggedDeleted: counts?.totalFlaggedDeleted ?? 0,
    totalWarningsSent: counts?.totalWarningsSent ?? 0,
    totalClassifierErrors: counts?.totalClassifierErrors ?? 0,
    byCategory,
  };
}
