import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';

/**
 * SQLite's `excluded.<column>` — the value an upsert tried to insert — for
 * an onConflictDoUpdate `set`, which Drizzle 0.45 has no builder for.
 */
export function excluded(column: SQLiteColumn): SQL {
  return sql`excluded.${sql.identifier(column.name)}`;
}
