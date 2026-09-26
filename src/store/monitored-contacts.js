import { getDb } from './db.js';

/**
 * Returns the full roster of monitored contacts, oldest-added first.
 */
export function listMonitored() {
  return getDb()
    .prepare('SELECT contact_id, escalation_enabled, added_at FROM monitored_contacts ORDER BY added_at ASC, rowid ASC')
    .all()
    .map((row) => ({
      contactId: row.contact_id,
      escalationEnabled: Boolean(row.escalation_enabled),
      addedAt: row.added_at,
    }));
}

export function isMonitored(contactId) {
  return getDb().prepare('SELECT 1 FROM monitored_contacts WHERE contact_id = ?').get(contactId) !== undefined;
}

/**
 * Adds a contact to the roster with escalation on by default. Idempotent —
 * a contact already on the roster keeps its current escalation_enabled
 * value rather than being reset to the default.
 */
export function addMonitored(contactId) {
  getDb()
    .prepare(
      `INSERT INTO monitored_contacts (contact_id, escalation_enabled, added_at) VALUES (?, 1, ?)
       ON CONFLICT (contact_id) DO NOTHING`,
    )
    .run(contactId, Date.now());
}

/**
 * Removes a contact from the roster only — its strikes/blocks/audit-log
 * rows are untouched, see docs/decisions.md's audit-log permanence
 * principle.
 *
 * @returns {boolean} whether a roster row was actually removed
 */
export function removeMonitored(contactId) {
  const { changes } = getDb().prepare('DELETE FROM monitored_contacts WHERE contact_id = ?').run(contactId);
  return changes > 0;
}

/**
 * @returns {boolean} whether contactId was on the roster to update
 */
export function setEscalationEnabled(contactId, enabled) {
  const { changes } = getDb()
    .prepare('UPDATE monitored_contacts SET escalation_enabled = ? WHERE contact_id = ?')
    .run(enabled ? 1 : 0, contactId);
  return changes > 0;
}

/**
 * Defaults to true for a contactId with no roster row, matching the
 * always-escalate behavior from before this roster existed.
 */
export function isEscalationEnabled(contactId) {
  const row = getDb()
    .prepare('SELECT escalation_enabled FROM monitored_contacts WHERE contact_id = ?')
    .get(contactId);
  return row ? Boolean(row.escalation_enabled) : true;
}
