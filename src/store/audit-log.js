import { getDb } from './db.js';

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
export function logMessage({ contactId, direction, message, classification, action }) {
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
}

/**
 * Returns a contact's most recent audit log entries, newest first.
 */
export function getAuditLog(contactId, limit = 50) {
  return getDb()
    .prepare('SELECT * FROM audit_log WHERE contact_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(contactId, limit);
}
