import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pino from 'pino';
import { resolveMigrationBaseline } from './migration-baseline.ts';
import { openNodeSqliteOrm } from './node-sqlite-driver.ts';
import type { OrmDatabase } from './node-sqlite-driver.ts';

const logger = pino({ name: 'db' });

const DEFAULT_DB_PATH = 'data/moderation.sqlite';
const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../drizzle', import.meta.url));

let connection: DatabaseSync | undefined;
let orm: OrmDatabase | undefined;

function migrateToLatest(client: DatabaseSync): OrmDatabase {
  resolveMigrationBaseline(client, MIGRATIONS_FOLDER);
  const { orm: database, migrate } = openNodeSqliteOrm(client);
  migrate(MIGRATIONS_FOLDER);
  return database;
}

// Lazy-opened, like policy.ts's loadPolicy, so importing this module never has a side effect and every caller shares one connection.
function open(): { connection: DatabaseSync; orm: OrmDatabase } {
  if (connection && orm) return { connection, orm };

  const dbPath = process.env.DB_PATH ?? DEFAULT_DB_PATH;
  const dir = dirname(dbPath);
  if (dir !== '.' && !existsSync(dir)) mkdirSync(dir, { recursive: true });

  const client = new DatabaseSync(dbPath);
  try {
    client.exec('PRAGMA journal_mode = WAL;');
    const database = migrateToLatest(client);
    connection = client;
    orm = database;
    return { connection, orm };
  } catch (err) {
    logger.error({ dbPath, error: err instanceof Error ? err.message : String(err) }, 'database schema setup failed');
    client.close();
    throw err;
  }
}

/**
 * The Drizzle query builder every store module reads and writes through,
 * opening and migrating the database on first use.
 */
export function getOrm(): OrmDatabase {
  return open().orm;
}

/**
 * The underlying node:sqlite connection — for connection lifecycle and
 * tests only. Application modules go through getOrm() rather than issuing
 * hand-written SQL against this.
 */
export function getDb(): DatabaseSync {
  return open().connection;
}

/**
 * Closes the shared connection, if one is open. For graceful shutdown only
 * — WAL-mode SQLite shouldn't be left mid-write when the process exits.
 */
export function closeDb() {
  if (!connection) return;
  connection.close();
  connection = undefined;
  orm = undefined;
}
