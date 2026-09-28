import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import pino from 'pino';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import type { MigrationMeta } from 'drizzle-orm/migrator';
import type { DatabaseSync } from 'node:sqlite';

const logger = pino({ name: 'migration-baseline' });

// Must match the table name and DDL drizzle-orm's SQLiteSyncDialect.migrate() uses (pinned 0.45.3), so its migrator reads a seeded row exactly like one it wrote itself.
const MIGRATIONS_TABLE = '__drizzle_migrations';
const MIGRATIONS_TABLE_DDL = `CREATE TABLE IF NOT EXISTS "${MIGRATIONS_TABLE}" (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)`;

const BASELINE_SNAPSHOT_PATH = 'meta/0000_snapshot.json';

// Columns pre-ORM releases added with a runtime ALTER TABLE rather than in CREATE TABLE, so a pre-ORM database may still lack any of them.
const LEGACY_RUNTIME_COLUMNS: readonly { table: string; column: string }[] = [
  { table: 'contacts', column: 'last_message_at' },
  { table: 'contacts', column: 'lid' },
  { table: 'contacts', column: 'photo_url' },
  { table: 'contacts', column: 'photo_fetched_at' },
  { table: 'monitored_contacts', column: 'context' },
];

const CREATE_TABLE_PATTERN = /^CREATE TABLE `([^`]+)`/;
const CREATE_INDEX_PATTERN = /^CREATE (?:UNIQUE )?INDEX `([^`]+)`/;

interface SnapshotColumn {
  name: string;
  type: string;
  primaryKey: boolean;
  notNull: boolean;
}

interface SnapshotTable {
  name: string;
  columns: Record<string, SnapshotColumn>;
  indexes: Record<string, { name: string; columns: string[] }>;
}

interface Baseline {
  migration: MigrationMeta;
  tables: SnapshotTable[];
}

interface ColumnInfo {
  name: string;
  type: string;
  notnull: number;
  pk: number;
}

export type BaselineResolution = 'already-tracked' | 'fresh' | 'adopted';

function loadBaseline(migrationsFolder: string): Baseline {
  const [migration] = readMigrationFiles({ migrationsFolder });
  if (!migration) throw new Error(`no baseline migration found in ${migrationsFolder}`);
  const snapshot = JSON.parse(readFileSync(join(migrationsFolder, BASELINE_SNAPSHOT_PATH), 'utf8')) as { tables: Record<string, SnapshotTable> };
  return { migration, tables: Object.values(snapshot.tables) };
}

function hasSchemaObject(connection: DatabaseSync, type: 'table' | 'index', name: string): boolean {
  return connection.prepare('SELECT 1 FROM sqlite_master WHERE type = ? AND name = ?').get(type, name) !== undefined;
}

function isAlreadyTracked(connection: DatabaseSync): boolean {
  if (!hasSchemaObject(connection, 'table', MIGRATIONS_TABLE)) return false;
  return connection.prepare(`SELECT 1 FROM "${MIGRATIONS_TABLE}" LIMIT 1`).get() !== undefined;
}

function columnsOf(connection: DatabaseSync, table: string): Map<string, ColumnInfo> {
  const rows = connection.prepare('SELECT name, type, "notnull", pk FROM pragma_table_info(?)').all(table) as unknown as ColumnInfo[];
  return new Map(rows.map((row) => [row.name, row]));
}

function indexColumnsOf(connection: DatabaseSync, index: string): string[] {
  const rows = connection.prepare('SELECT name FROM pragma_index_info(?) ORDER BY seqno').all(index) as { name: string }[];
  return rows.map((row) => row.name);
}

function createdObject(statement: string): { type: 'table' | 'index'; name: string } {
  const table = CREATE_TABLE_PATTERN.exec(statement)?.[1];
  if (table) return { type: 'table', name: table };
  const index = CREATE_INDEX_PATTERN.exec(statement)?.[1];
  if (index) return { type: 'index', name: index };
  throw new Error(`unexpected statement in baseline migration: ${statement}`);
}

// Replays only the baseline's own CREATE statements for objects an older release never created, so a table or index added after that release comes out exactly as a fresh install would have it.
function createMissingObjects(connection: DatabaseSync, migration: MigrationMeta): void {
  for (const statement of migration.sql.map((stmt) => stmt.trim()).filter(Boolean)) {
    const { type, name } = createdObject(statement);
    if (hasSchemaObject(connection, type, name)) continue;
    connection.exec(statement);
    logger.info({ type, name }, 'created schema object missing from a pre-migration database');
  }
}

function addLegacyRuntimeColumns(connection: DatabaseSync, tables: SnapshotTable[]): void {
  for (const { table, column } of LEGACY_RUNTIME_COLUMNS) {
    if (columnsOf(connection, table).has(column)) continue;
    const type = tables.find((t) => t.name === table)?.columns[column]?.type;
    if (!type) throw new Error(`legacy column ${table}.${column} is not part of the baseline schema`);
    connection.exec(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${type}`);
    logger.info({ table, column }, 'added column missing from a pre-migration database');
  }
}

// NOT NULL is only compared for non-key columns: pre-ORM `TEXT PRIMARY KEY` columns are nullable under SQLite's legacy rule, while drizzle-kit always emits PRIMARY KEY NOT NULL.
function describeMismatches(connection: DatabaseSync, tables: SnapshotTable[]): string[] {
  const mismatches: string[] = [];
  for (const table of tables) {
    if (!hasSchemaObject(connection, 'table', table.name)) {
      mismatches.push(`missing table ${table.name}`);
      continue;
    }
    const actual = columnsOf(connection, table.name);
    for (const expected of Object.values(table.columns)) {
      const column = actual.get(expected.name);
      const label = `${table.name}.${expected.name}`;
      if (!column) mismatches.push(`missing column ${label}`);
      else if (column.type.toLowerCase() !== expected.type.toLowerCase()) mismatches.push(`${label} has type ${column.type}, expected ${expected.type}`);
      else if (Boolean(column.pk) !== expected.primaryKey) mismatches.push(`${label} primary key mismatch`);
      else if (!expected.primaryKey && Boolean(column.notnull) !== expected.notNull) mismatches.push(`${label} NOT NULL mismatch`);
    }
    for (const index of Object.values(table.indexes)) {
      const columns = indexColumnsOf(connection, index.name);
      if (!columns.length) mismatches.push(`missing index ${index.name}`);
      else if (columns.join(',') !== index.columns.join(',')) mismatches.push(`index ${index.name} covers (${columns.join(', ')}), expected (${index.columns.join(', ')})`);
    }
  }
  return mismatches;
}

// created_at is the migration's journal timestamp, not the adoption time: the migrator only runs migrations whose timestamp is newer than the latest row, so a wall-clock value would silently skip every migration generated before this startup.
function seedBaseline(connection: DatabaseSync, migration: MigrationMeta): void {
  connection.exec(MIGRATIONS_TABLE_DDL);
  connection.prepare(`INSERT INTO "${MIGRATIONS_TABLE}" ("hash", "created_at") VALUES (?, ?)`).run(migration.hash, migration.folderMillis);
}

function adoptExistingDatabase(connection: DatabaseSync, { migration, tables }: Baseline): void {
  createMissingObjects(connection, migration);
  addLegacyRuntimeColumns(connection, tables);
  const mismatches = describeMismatches(connection, tables);
  if (mismatches.length) throw new Error(`existing database does not match the migration baseline: ${mismatches.join('; ')}`);
  seedBaseline(connection, migration);
}

/**
 * Prepares a database for drizzle's migrator, which on its own would try to
 * run the baseline's CREATE TABLEs against a pre-ORM deployment. Three cases:
 * - already tracked (the migrator has recorded a migration): nothing to do;
 * - fresh (none of the baseline's tables exist): nothing to do, the migrator
 *   runs the baseline normally;
 * - a pre-ORM database: brings it up to the baseline (missing tables and
 *   indexes from the baseline's own DDL, missing runtime-added columns via
 *   ALTER TABLE), verifies every table, column and index now matches the
 *   baseline snapshot, and only then records the baseline as applied without
 *   executing it.
 * Adoption runs in one transaction: if the schema can't be verified it throws
 * and rolls back, leaving the database untouched rather than marking a
 * baseline applied that doesn't actually describe it.
 */
export function resolveMigrationBaseline(connection: DatabaseSync, migrationsFolder: string): BaselineResolution {
  if (isAlreadyTracked(connection)) return 'already-tracked';

  const baseline = loadBaseline(migrationsFolder);
  if (!baseline.tables.some((table) => hasSchemaObject(connection, 'table', table.name))) return 'fresh';

  connection.exec('BEGIN IMMEDIATE');
  try {
    adoptExistingDatabase(connection, baseline);
    connection.exec('COMMIT');
  } catch (err) {
    connection.exec('ROLLBACK');
    throw err;
  }
  logger.info({ hash: baseline.migration.hash }, 'adopted a pre-migration database: baseline recorded as applied');
  return 'adopted';
}
