import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { DatabaseSync as Database } from 'node:sqlite';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS strikes (
  contact_id TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS blocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id TEXT NOT NULL,
  blocked_at INTEGER NOT NULL,
  unblock_at INTEGER NOT NULL,
  unblocked_at INTEGER
);

CREATE INDEX IF NOT EXISTS blocks_pending_idx
  ON blocks (contact_id, unblocked_at);

CREATE INDEX IF NOT EXISTS blocks_expiry_idx
  ON blocks (unblocked_at, unblock_at);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id TEXT NOT NULL,
  direction TEXT NOT NULL,
  message TEXT NOT NULL,
  classification_ok INTEGER NOT NULL,
  flagged INTEGER,
  category TEXT,
  reason TEXT,
  error TEXT,
  action TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS audit_log_contact_idx
  ON audit_log (contact_id, created_at);

CREATE INDEX IF NOT EXISTS audit_log_contact_cursor_idx
  ON audit_log (contact_id, id);

CREATE TABLE IF NOT EXISTS monitored_contacts (
  contact_id TEXT PRIMARY KEY,
  escalation_enabled INTEGER NOT NULL DEFAULT 1,
  added_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS contacts (
  contact_id TEXT PRIMARY KEY,
  name TEXT,
  notify TEXT,
  verified_name TEXT,
  lid TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
`;

let db: Database | undefined;

// One-off, narrowly-scoped exception to this project's "no migrations,
// pre-release" stance (see docs/decisions.md): CREATE TABLE IF NOT EXISTS
// can't retroactively add a column to a contacts table that already shipped
// in an earlier commit, and unlike the roster/env-var concepts that's fine
// to drop outright, an existing contacts table can hold a real contact list
// a user only got by actually relinking their WhatsApp device — not
// something to force them to redo.
function migrateContactsTable(database: Database): void {
  const hasLastMessageAt = database
    .prepare("SELECT 1 FROM pragma_table_info('contacts') WHERE name = 'last_message_at'")
    .get();
  if (!hasLastMessageAt) database.exec('ALTER TABLE contacts ADD COLUMN last_message_at INTEGER');

  // Tracks a contact's @lid identity (WhatsApp's alternate-JID privacy
  // migration) alongside their phone-number contact_id, so a lid-only event
  // (e.g. a bare {id, notify} contacts.update, before the pn mapping is
  // known) can still resolve to the same directory row instead of creating
  // a second one — see contact-directory.ts's reconcileJid().
  const hasLid = database.prepare("SELECT 1 FROM pragma_table_info('contacts') WHERE name = 'lid'").get();
  if (!hasLid) database.exec('ALTER TABLE contacts ADD COLUMN lid TEXT');

  // Cached result of Baileys' profilePictureUrl() (a signed WhatsApp CDN
  // URL, or NULL for "no photo") and when it was looked up, so the photo
  // proxy route doesn't re-query WhatsApp on every request — see
  // src/whatsapp/profile-photos.ts. A NULL photo_fetched_at means "never
  // looked up (or invalidated)", distinct from a fresh NULL photo_url.
  const hasPhotoUrl = database.prepare("SELECT 1 FROM pragma_table_info('contacts') WHERE name = 'photo_url'").get();
  if (!hasPhotoUrl) database.exec('ALTER TABLE contacts ADD COLUMN photo_url TEXT');

  const hasPhotoFetchedAt = database.prepare("SELECT 1 FROM pragma_table_info('contacts') WHERE name = 'photo_fetched_at'").get();
  if (!hasPhotoFetchedAt) database.exec('ALTER TABLE contacts ADD COLUMN photo_fetched_at INTEGER');
}

// Same exception as migrateContactsTable above: an existing monitored_contacts
// table is an operator's actual roster, not something to force them to redo.
function migrateMonitoredContactsTable(database: Database): void {
  const hasContext = database
    .prepare("SELECT 1 FROM pragma_table_info('monitored_contacts') WHERE name = 'context'")
    .get();
  if (!hasContext) database.exec('ALTER TABLE monitored_contacts ADD COLUMN context TEXT');
}

// Lazy-opened, like policy.js's loadPolicy, so importing this module never
// has a side effect and every caller shares one connection.
export function getDb(): Database {
  if (db) return db;

  const dbPath = process.env.DB_PATH ?? 'data/moderation.sqlite';
  const dir = dirname(dbPath);
  if (dir !== '.' && !existsSync(dir)) mkdirSync(dir, { recursive: true });

  db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  migrateContactsTable(db);
  migrateMonitoredContactsTable(db);
  return db;
}

/**
 * Closes the shared connection, if one is open. For graceful shutdown only
 * — WAL-mode SQLite shouldn't be left mid-write when the process exits.
 */
export function closeDb() {
  if (!db) return;
  db.close();
  db = undefined;
}
