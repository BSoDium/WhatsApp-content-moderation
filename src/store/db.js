import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

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
`;

let db;

// Lazy-opened, like policy.js's loadPolicy, so importing this module never
// has a side effect and every caller shares one connection.
export function getDb() {
  if (db) return db;

  const dbPath = process.env.DB_PATH ?? 'data/moderation.sqlite';
  const dir = dirname(dbPath);
  if (dir !== '.' && !existsSync(dir)) mkdirSync(dir, { recursive: true });

  db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  return db;
}
