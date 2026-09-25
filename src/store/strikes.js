import { getDb } from './db.js';

/**
 * Returns a contact's current strike count (0 if they have no row yet).
 */
export function getStrikeCount(contactId) {
  const row = getDb()
    .prepare('SELECT count FROM strikes WHERE contact_id = ?')
    .get(contactId);
  return row?.count ?? 0;
}

/**
 * Records a flagged message: increments the contact's strike count by one.
 */
export function recordStrike(contactId) {
  const db = getDb();
  db.prepare(
    `INSERT INTO strikes (contact_id, count, updated_at) VALUES (?, 1, ?)
     ON CONFLICT (contact_id) DO UPDATE SET count = count + 1, updated_at = excluded.updated_at`,
  ).run(contactId, Date.now());
  return getStrikeCount(contactId);
}

/**
 * Records a passed (non-flagged) message: decays the contact's strike count
 * by one, floored at zero — see docs/roadmap.md issue #5.
 */
export function decayStrike(contactId) {
  const db = getDb();
  db.prepare(
    `INSERT INTO strikes (contact_id, count, updated_at) VALUES (?, 0, ?)
     ON CONFLICT (contact_id) DO UPDATE SET count = MAX(count - 1, 0), updated_at = excluded.updated_at`,
  ).run(contactId, Date.now());
  return getStrikeCount(contactId);
}
