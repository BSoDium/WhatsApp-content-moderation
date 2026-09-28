import { BetterSQLiteSession } from 'drizzle-orm/better-sqlite3/session';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { BaseSQLiteDatabase, SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import type { TablesRelationalConfig } from 'drizzle-orm';
import type { DatabaseSync, SQLInputValue, StatementResultingChanges, StatementSync } from 'node:sqlite';

export type OrmDatabase = BaseSQLiteDatabase<'sync', StatementResultingChanges, Record<string, unknown>, TablesRelationalConfig>;

export interface NodeSqliteOrm {
  orm: OrmDatabase;
  migrate: (migrationsFolder: string) => void;
}

type TransactionBehavior = 'deferred' | 'immediate' | 'exclusive';

// Positional rows (better-sqlite3's Statement#raw()) come from node:sqlite's array mode, not Object.values() of an object row, where two selected columns sharing a name (a join's two `id`s) collapse into one key.
function adaptStatement(stmt: StatementSync) {
  function rows(arrays: boolean) {
    stmt.setReturnArrays(arrays);
    return stmt;
  }
  return {
    run: (...params: SQLInputValue[]) => stmt.run(...params),
    all: (...params: SQLInputValue[]) => rows(false).all(...params),
    get: (...params: SQLInputValue[]) => rows(false).get(...params),
    raw: () => ({
      all: (...params: SQLInputValue[]) => rows(true).all(...params),
      get: (...params: SQLInputValue[]) => rows(true).get(...params),
    }),
  };
}

// better-sqlite3's Database#transaction(fn) shape, which BetterSQLiteSession calls as `client.transaction(fn)[behavior](tx)`.
function adaptTransaction(client: DatabaseSync) {
  return <T>(fn: (...args: unknown[]) => T) => {
    const runAs = (behavior: TransactionBehavior) => (...args: unknown[]): T => {
      client.exec(`BEGIN ${behavior.toUpperCase()}`);
      try {
        const result = fn(...args);
        client.exec('COMMIT');
        return result;
      } catch (err) {
        client.exec('ROLLBACK');
        throw err;
      }
    };
    return { deferred: runAs('deferred'), immediate: runAs('immediate'), exclusive: runAs('exclusive') };
  };
}

/**
 * Wraps a node:sqlite connection in a synchronous Drizzle database, plus the
 * matching synchronous migrator. Reuses Drizzle's own better-sqlite3 session
 * (query building, result mapping, savepoints) behind a thin adapter, since
 * drizzle-orm 0.45 ships no node:sqlite driver and its sqlite-proxy driver is
 * async-only — see docs/decisions.md. The session module is imported
 * directly: it never loads the native better-sqlite3 package, only its
 * driver entry point does.
 */
export function openNodeSqliteOrm(client: DatabaseSync): NodeSqliteOrm {
  const dialect = new SQLiteSyncDialect();
  const adapter = {
    prepare: (sql: string) => adaptStatement(client.prepare(sql)),
    transaction: adaptTransaction(client),
  };
  const session = new BetterSQLiteSession(adapter, dialect, undefined);
  const orm: OrmDatabase = new BaseSQLiteDatabase('sync', dialect, session, undefined);

  function migrate(migrationsFolder: string): void {
    const config = { migrationsFolder };
    dialect.migrate(readMigrationFiles(config), session, config);
  }

  return { orm, migrate };
}
