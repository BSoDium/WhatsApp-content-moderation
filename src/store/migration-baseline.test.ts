import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { readMigrationFiles } from 'drizzle-orm/migrator';

process.env.DB_PATH = 'data/test-migration-baseline.test.sqlite';

const { getDb, closeDb } = await import('./db.ts');
const { resolveMigrationBaseline } = await import('./migration-baseline.ts');
const { openNodeSqliteOrm } = await import('./node-sqlite-driver.ts');
const { getStrikeCount, recordStrike } = await import('./strikes.ts');
const { getActiveBlock, markUnblocked } = await import('./blocks.ts');
const { getAuditLog, getAuditLogPage, getAuditLogStats, logMessage } = await import('./audit-log.ts');
const { getMonitored, setContext, addMonitored, listMonitored } = await import('./monitored-contacts.ts');
const { ensureDefaultsSeeded, getRawSetting, getRawValue, setSetting } = await import('./settings.ts');
const { getPhotoCache, setPhotoCache } = await import('./contact-photos.ts');
const { createContactDirectory, canonicalContactId } = await import('../whatsapp/contact-directory.ts');

const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../drizzle', import.meta.url));
// All real migrations in drizzle/, not just the baseline — a database that's actually been fully migrated (as opposed to one that adopted the baseline without running it) ends up with every one of these recorded, whatever gets added to drizzle/ next.
const REAL_MIGRATIONS = readMigrationFiles({ migrationsFolder: MIGRATIONS_FOLDER });
const [BASELINE] = REAL_MIGRATIONS;
const ALL_MIGRATION_ROWS = REAL_MIGRATIONS.map((migration) => ({ hash: migration.hash, created_at: migration.folderMillis }));

const createdPaths: string[] = [process.env.DB_PATH];
const createdDirs: string[] = [];

after(() => {
  closeDb();
  for (const path of createdPaths) {
    for (const ext of ['', '-wal', '-shm']) rmSync(`${path}${ext}`, { force: true });
  }
  for (const dir of createdDirs) rmSync(dir, { recursive: true, force: true });
});

// Every table/column/index the pre-ORM schema had once fully migrated, written out independently of schema.ts. Deliberately does NOT include anything a post-baseline Drizzle migration (e.g. 0001's call_strikes table) has since added — this is "fully caught up on pre-ORM history alone," which is what a raw pre-ORM SQL fixture below can actually reach. See FULLY_MIGRATED_SHAPE below for the real end state once such a fixture is booted through the actual app and every migration runs.
const EXPECTED_SHAPE = {
  audit_log: {
    columns: ['action text', 'category text', 'classification_ok integer', 'contact_id text', 'created_at integer', 'direction text', 'error text', 'flagged integer', 'id integer', 'message text', 'reason text'],
    indexes: ['audit_log_contact_cursor_idx(contact_id,id)', 'audit_log_contact_idx(contact_id,created_at)'],
  },
  blocks: {
    columns: ['blocked_at integer', 'contact_id text', 'id integer', 'unblock_at integer', 'unblocked_at integer'],
    indexes: ['blocks_expiry_idx(unblocked_at,unblock_at)', 'blocks_pending_idx(contact_id,unblocked_at)'],
  },
  contacts: {
    columns: ['contact_id text', 'last_message_at integer', 'lid text', 'name text', 'notify text', 'photo_fetched_at integer', 'photo_url text', 'updated_at integer', 'verified_name text'],
    indexes: [],
  },
  monitored_contacts: {
    columns: ['added_at integer', 'contact_id text', 'context text', 'escalation_enabled integer'],
    indexes: [],
  },
  settings: {
    columns: ['key text', 'updated_at integer', 'value text'],
    indexes: [],
  },
  strikes: {
    columns: ['contact_id text', 'count integer', 'updated_at integer'],
    indexes: [],
  },
};

// EXPECTED_SHAPE plus whatever every post-baseline Drizzle migration in drizzle/ has added — the shape a database ends up with once actually, fully migrated: a fresh install, or a pre-ORM database that's been adopted and then caught up.
const FULLY_MIGRATED_SHAPE = {
  ...EXPECTED_SHAPE,
  call_strikes: {
    columns: ['contact_id text', 'strike_count integer', 'unanswered_count integer', 'unanswered_updated_at integer', 'updated_at integer'],
    indexes: [],
  },
  monitored_contacts: {
    columns: ['added_at integer', 'block_backoff_max_ms integer', 'call_nuisance_threshold integer', 'contact_id text', 'context text', 'escalation_enabled integer'],
    indexes: [],
  },
};

// Pre-ORM DDL, verbatim from src/store/db.ts's SCHEMA/migrate*Table across its history (git log -- src/store/db.ts).
const STRIKES_DDL = `CREATE TABLE IF NOT EXISTS strikes (
  contact_id TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
)`;
const BLOCKS_DDL = `CREATE TABLE IF NOT EXISTS blocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id TEXT NOT NULL,
  blocked_at INTEGER NOT NULL,
  unblock_at INTEGER NOT NULL,
  unblocked_at INTEGER
)`;
const BLOCKS_PENDING_IDX = 'CREATE INDEX IF NOT EXISTS blocks_pending_idx ON blocks (contact_id, unblocked_at)';
const BLOCKS_EXPIRY_IDX = 'CREATE INDEX IF NOT EXISTS blocks_expiry_idx ON blocks (unblocked_at, unblock_at)';
const AUDIT_LOG_DDL = `CREATE TABLE IF NOT EXISTS audit_log (
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
)`;
const AUDIT_LOG_CONTACT_IDX = 'CREATE INDEX IF NOT EXISTS audit_log_contact_idx ON audit_log (contact_id, created_at)';
const AUDIT_LOG_CURSOR_IDX = 'CREATE INDEX IF NOT EXISTS audit_log_contact_cursor_idx ON audit_log (contact_id, id)';
const MONITORED_CONTACTS_DDL = `CREATE TABLE IF NOT EXISTS monitored_contacts (
  contact_id TEXT PRIMARY KEY,
  escalation_enabled INTEGER NOT NULL DEFAULT 1,
  added_at INTEGER NOT NULL
)`;
const CONTACTS_WITHOUT_LID_DDL = `CREATE TABLE IF NOT EXISTS contacts (
  contact_id TEXT PRIMARY KEY,
  name TEXT,
  notify TEXT,
  verified_name TEXT,
  updated_at INTEGER NOT NULL
)`;
const CONTACTS_WITH_LID_DDL = `CREATE TABLE IF NOT EXISTS contacts (
  contact_id TEXT PRIMARY KEY,
  name TEXT,
  notify TEXT,
  verified_name TEXT,
  lid TEXT,
  updated_at INTEGER NOT NULL
)`;
const SETTINGS_DDL = `CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
)`;
const ADD_LAST_MESSAGE_AT = 'ALTER TABLE contacts ADD COLUMN last_message_at INTEGER';
const ADD_LID = 'ALTER TABLE contacts ADD COLUMN lid TEXT';
const ADD_PHOTO_URL = 'ALTER TABLE contacts ADD COLUMN photo_url TEXT';
const ADD_PHOTO_FETCHED_AT = 'ALTER TABLE contacts ADD COLUMN photo_fetched_at INTEGER';
const ADD_CONTEXT = 'ALTER TABLE monitored_contacts ADD COLUMN context TEXT';

const RELEASE_777253B = [STRIKES_DDL, BLOCKS_DDL, BLOCKS_PENDING_IDX, AUDIT_LOG_DDL, AUDIT_LOG_CONTACT_IDX];
const RELEASE_8302B72 = [...RELEASE_777253B, BLOCKS_EXPIRY_IDX, MONITORED_CONTACTS_DDL, CONTACTS_WITHOUT_LID_DDL];
// 1caba42 (last_message_at), bc1bc46 (cursor index), 3b180cb (lid, via ALTER on an existing table), b44a8ac (settings, context).
const UPGRADE_8302B72_TO_B44A8AC = [ADD_LAST_MESSAGE_AT, AUDIT_LOG_CURSOR_IDX, ADD_LID, SETTINGS_DDL, ADD_CONTEXT];
const UPGRADE_B44A8AC_TO_CE0E3A5 = [ADD_PHOTO_URL, ADD_PHOTO_FETCHED_AT];
// A first install on ce0e3a5 (the last pre-ORM release): its SCHEMA already had lid in CREATE TABLE, then the migrate functions ran.
const INSTALL_CE0E3A5 = [
  ...RELEASE_777253B, BLOCKS_EXPIRY_IDX, AUDIT_LOG_CURSOR_IDX, MONITORED_CONTACTS_DDL, CONTACTS_WITH_LID_DDL, SETTINGS_DDL,
  ADD_LAST_MESSAGE_AT, ADD_PHOTO_URL, ADD_PHOTO_FETCHED_AT, ADD_CONTEXT,
];

const ALICE = 'alice@s.whatsapp.net';
const BOB = 'bob@s.whatsapp.net';
const ALICE_LID = '123456@lid';
const ALICE_CONTEXT = 'Alice is my sister; banter is fine.';
const ALICE_PHOTO = 'https://pps.whatsapp.net/v/alice.jpg';

const CORE_ROWS = [
  `INSERT INTO strikes (contact_id, count, updated_at) VALUES ('${ALICE}', 2, ${Date.now()}), ('${BOB}', 0, 1700000000500)`,
  `INSERT INTO blocks (contact_id, blocked_at, unblock_at, unblocked_at) VALUES
    ('${ALICE}', 1700000001000, 1700086401000, NULL),
    ('carol@s.whatsapp.net', 1690000000000, 1690086400000, 1690086500000)`,
  `INSERT INTO audit_log (contact_id, direction, message, classification_ok, flagged, category, reason, error, action, created_at) VALUES
    ('${ALICE}', 'them', 'buy my course', 1, 1, 'spam', 'promotion', NULL, 'delete+warn', 1700000000000),
    ('${ALICE}', 'me', 'please stop', 1, 0, 'none', 'own reply', NULL, 'none', 1700000000100),
    ('${BOB}', 'them', 'hello?', 0, NULL, NULL, NULL, 'ollama timeout', 'classifier_error', 1700000000200)`,
];
const ROSTER_ROWS = [
  `INSERT INTO monitored_contacts (contact_id, escalation_enabled, added_at) VALUES ('${ALICE}', 1, 1690000000000), ('${BOB}', 0, 1690000000001)`,
  `INSERT INTO contacts (contact_id, name, notify, verified_name, updated_at) VALUES
    ('${ALICE}', 'Alice', NULL, NULL, 1700000000000),
    ('${BOB}', NULL, 'bobby', NULL, 1700000000000),
    ('shop@s.whatsapp.net', NULL, NULL, 'Shop Inc', 1700000000000)`,
];
const B44A8AC_ROWS = [
  `UPDATE contacts SET last_message_at = 1700000005000, lid = '${ALICE_LID}' WHERE contact_id = '${ALICE}'`,
  `UPDATE monitored_contacts SET context = '${ALICE_CONTEXT}' WHERE contact_id = '${ALICE}'`,
  `INSERT INTO settings (key, value, updated_at) VALUES ('STRIKE_THRESHOLD', '5', 1700000000000), ('GLOBAL_POLICY', 'No spam.', 1700000000000)`,
];
const CE0E3A5_ROWS = [
  `UPDATE contacts SET photo_url = '${ALICE_PHOTO}', photo_fetched_at = 1700000006000 WHERE contact_id = '${ALICE}'`,
  `UPDATE contacts SET photo_fetched_at = 1700000006000 WHERE contact_id = '${BOB}'`,
];

const UP_TO_DATE_FIXTURES = {
  'installed before contacts.lid existed, upgraded through every pre-ORM release': [
    ...RELEASE_8302B72, ...CORE_ROWS, ...ROSTER_ROWS, ...UPGRADE_8302B72_TO_B44A8AC, ...B44A8AC_ROWS, ...UPGRADE_B44A8AC_TO_CE0E3A5, ...CE0E3A5_ROWS,
  ],
  'first installed on the last pre-ORM release': [...INSTALL_CE0E3A5, ...CORE_ROWS, ...ROSTER_ROWS, ...B44A8AC_ROWS, ...CE0E3A5_ROWS],
};

const OUTDATED_FIXTURES = {
  'last ran b44a8ac: no contacts.photo_url/photo_fetched_at': [...RELEASE_8302B72, ...CORE_ROWS, ...ROSTER_ROWS, ...UPGRADE_8302B72_TO_B44A8AC, ...B44A8AC_ROWS],
  'last ran 8302b72: no last_message_at/lid/photo columns, no context, no settings table, no cursor index': [...RELEASE_8302B72, ...CORE_ROWS, ...ROSTER_ROWS],
  'last ran 777253b: no roster/contacts/settings tables, no blocks_expiry_idx or cursor index': [...RELEASE_777253B, ...CORE_ROWS],
};

type Row = Record<string, unknown>;

let fixtureCounter = 0;

function newDbPath(label: string): string {
  fixtureCounter += 1;
  const path = `data/test-migration-baseline-${fixtureCounter}-${label}.test.sqlite`;
  createdPaths.push(path);
  return path;
}

// Built the way the pre-ORM getDb() opened a file (WAL on), then closed so the copy below is a single self-contained file.
function buildFixture(statements: string[]): string {
  const path = newDbPath('fixture');
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL;');
  for (const statement of statements) db.exec(statement);
  db.close();
  return path;
}

function copyOf(fixture: string): string {
  const path = newDbPath('copy');
  copyFileSync(fixture, path);
  return path;
}

function startup(path: string): DatabaseSync {
  closeDb();
  process.env.DB_PATH = path;
  return getDb();
}

function withConnection<T>(path: string, fn: (db: DatabaseSync) => T): T {
  const db = new DatabaseSync(path);
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

function tableNames(db: DatabaseSync): string[] {
  const rows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != '__drizzle_migrations' ORDER BY name").all() as { name: string }[];
  return rows.map((row) => row.name);
}

function hasTable(db: DatabaseSync, name: string): boolean {
  return db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) !== undefined;
}

function columnNames(db: DatabaseSync, table: string): string[] {
  return (db.prepare('SELECT name FROM pragma_table_info(?)').all(table) as { name: string }[]).map((row) => row.name);
}

function shapeOf(db: DatabaseSync) {
  return Object.fromEntries(tableNames(db).map((table) => {
    const columns = (db.prepare('SELECT name, type FROM pragma_table_info(?)').all(table) as { name: string; type: string }[])
      .map((col) => `${col.name} ${col.type.toLowerCase()}`)
      .sort();
    const indexes = (db.prepare("SELECT name FROM pragma_index_list(?) WHERE origin = 'c'").all(table) as { name: string }[])
      .map(({ name }) => `${name}(${(db.prepare('SELECT name FROM pragma_index_info(?) ORDER BY seqno').all(name) as { name: string }[]).map((c) => c.name).join(',')})`)
      .sort();
    return [table, { columns, indexes }];
  }));
}

function dumpTables(db: DatabaseSync): Record<string, { columns: string[]; rows: Row[] }> {
  return Object.fromEntries(tableNames(db).map((table) => {
    const columns = columnNames(db, table);
    const rows = db.prepare(`SELECT ${columns.map((c) => `"${c}"`).join(', ')} FROM "${table}" ORDER BY rowid`).all() as Row[];
    return [table, { columns, rows: rows.map((row) => ({ ...row })) }];
  }));
}

function migrationRows(db: DatabaseSync): Row[] {
  if (!hasTable(db, '__drizzle_migrations')) return [];
  return (db.prepare('SELECT hash, created_at FROM "__drizzle_migrations"').all() as Row[]).map((row) => ({ ...row }));
}

function tableDdl(db: DatabaseSync, table: string): string | undefined {
  return (db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) as { sql: string } | undefined)?.sql;
}

// Proves every pre-existing row and value survived, and that anything the bridge added is NULL/empty rather than guessed.
function assertPreserved(before: ReturnType<typeof dumpTables>, db: DatabaseSync): void {
  for (const [table, { columns, rows }] of Object.entries(before)) {
    const after = db.prepare(`SELECT ${columns.map((c) => `"${c}"`).join(', ')} FROM "${table}" ORDER BY rowid`).all() as Row[];
    assert.deepEqual(after.map((row) => ({ ...row })), rows, `rows of ${table} changed`);
    for (const added of columnNames(db, table).filter((c) => !columns.includes(c))) {
      const nonNull = db.prepare(`SELECT COUNT(*) AS n FROM "${table}" WHERE "${added}" IS NOT NULL`).get() as { n: number };
      assert.equal(nonNull.n, 0, `${table}.${added} was added with non-NULL values`);
    }
  }
  for (const table of tableNames(db).filter((t) => !(t in before))) {
    assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get() as { n: number }).n, 0, `new table ${table} is not empty`);
  }
}

test('fresh database: the bootstrap leaves the baseline to the migrator, which creates every table and index', () => {
  withConnection(newDbPath('fresh-direct'), (db) => {
    assert.equal(resolveMigrationBaseline(db, MIGRATIONS_FOLDER), 'fresh');
    assert.equal(hasTable(db, '__drizzle_migrations'), false, 'bootstrap must not seed a fresh database');
    assert.deepEqual(tableNames(db), []);

    openNodeSqliteOrm(db).migrate(MIGRATIONS_FOLDER);
    assert.deepEqual(shapeOf(db), FULLY_MIGRATED_SHAPE);
    assert.deepEqual(migrationRows(db), ALL_MIGRATION_ROWS);
  });
});

test('fresh database through the real startup path, restarted twice, stays at every migration recorded exactly once', () => {
  const path = newDbPath('fresh-startup');
  const first = startup(path);
  assert.deepEqual(shapeOf(first), FULLY_MIGRATED_SHAPE);
  assert.deepEqual(migrationRows(first), ALL_MIGRATION_ROWS);

  addMonitored(ALICE);
  setContext(ALICE, ALICE_CONTEXT);
  assert.deepEqual(migrationRows(startup(path)), ALL_MIGRATION_ROWS);
  assert.deepEqual(migrationRows(startup(path)), ALL_MIGRATION_ROWS);
  assert.equal(getMonitored(ALICE)?.context, ALICE_CONTEXT);
});

for (const [label, statements] of Object.entries(UP_TO_DATE_FIXTURES)) {
  test(`up-to-date pre-ORM database (${label}): baseline recorded as applied, not executed, no row changed`, () => {
    const fixture = buildFixture(statements);
    assert.deepEqual(withConnection(fixture, (db) => shapeOf(db)), EXPECTED_SHAPE, 'fixture must already be fully up to date');

    const direct = copyOf(fixture);
    withConnection(direct, (db) => assert.equal(resolveMigrationBaseline(db, MIGRATIONS_FOLDER), 'adopted'));

    const path = copyOf(fixture);
    const { before, legacyContactsDdl } = withConnection(path, (db) => ({ before: dumpTables(db), legacyContactsDdl: tableDdl(db, 'contacts') }));

    const db = startup(path);
    // Not a byte-for-byte dumpTables comparison against `before`: this fixture is only up to date with pre-ORM history, so the real startup path still runs 0001 on top of the adopted baseline, same as any other pre-ORM database — assertPreserved is the right invariant here (existing rows untouched, anything new is NULL/empty).
    assertPreserved(before, db);
    assert.deepEqual(shapeOf(db), FULLY_MIGRATED_SHAPE);
    assert.deepEqual(migrationRows(db), ALL_MIGRATION_ROWS);
    assert.equal(tableDdl(db, 'contacts'), legacyContactsDdl, 'the baseline CREATE TABLE must not have been run');
  });
}

for (const [label, statements] of Object.entries(OUTDATED_FIXTURES)) {
  test(`outdated pre-ORM database (${label}): missing columns/tables/indexes added, rows kept, then baseline recorded`, () => {
    const fixture = buildFixture(statements);
    const before = withConnection(fixture, (db) => dumpTables(db));
    assert.notDeepEqual(withConnection(fixture, (db) => shapeOf(db)), EXPECTED_SHAPE, 'fixture must actually be missing something');

    const direct = copyOf(fixture);
    withConnection(direct, (db) => assert.equal(resolveMigrationBaseline(db, MIGRATIONS_FOLDER), 'adopted'));

    const db = startup(copyOf(fixture));
    assertPreserved(before, db);
    assert.deepEqual(shapeOf(db), FULLY_MIGRATED_SHAPE);
    assert.deepEqual(migrationRows(db), ALL_MIGRATION_ROWS);
  });
}

test('every store module reads and writes an adopted up-to-date database correctly', () => {
  const [statements] = Object.values(UP_TO_DATE_FIXTURES);
  startup(copyOf(buildFixture(statements)));
  const directory = createContactDirectory();

  assert.equal(getStrikeCount(ALICE), 2);
  assert.equal(recordStrike(ALICE), 3);

  const block = getActiveBlock(ALICE);
  assert.ok(block);
  assert.equal(block.unblock_at, 1700086401000);
  assert.equal(markUnblocked(block.id), true);
  assert.equal(getActiveBlock(ALICE), undefined);

  assert.deepEqual(getAuditLog(ALICE).map((row) => row.message), ['please stop', 'buy my course']);
  assert.deepEqual(getAuditLogPage({ search: 'course' }).map((row) => row.message), ['buy my course']);
  logMessage({ contactId: BOB, direction: 'them', message: 'new one', classification: { ok: true, flagged: false, category: 'none', reason: 'fine' }, action: 'none' });
  const stats = getAuditLogStats();
  assert.equal(stats.totalLogged, 4);
  assert.equal(stats.totalFlaggedDeleted, 1);
  assert.equal(stats.totalClassifierErrors, 1);
  assert.deepEqual(stats.byCategory, [{ category: 'spam', count: 1 }]);

  assert.deepEqual(getMonitored(ALICE), {
    contactId: ALICE,
    escalationEnabled: true,
    addedAt: 1690000000000,
    context: ALICE_CONTEXT,
    callNuisanceThreshold: null,
    blockBackoffMaxMs: null,
  });
  assert.equal(getMonitored(BOB)?.escalationEnabled, false);
  assert.deepEqual(listMonitored().map((m) => m.contactId), [ALICE, BOB]);

  ensureDefaultsSeeded();
  assert.equal(getRawSetting('STRIKE_THRESHOLD'), '5', 'seeding defaults must not overwrite a pre-existing value');
  assert.equal(getRawValue('GLOBAL_POLICY'), 'No spam.');
  assert.deepEqual(setSetting('STRIKE_THRESHOLD', '6'), { ok: true });
  assert.equal(getRawSetting('STRIKE_THRESHOLD'), '6');

  assert.deepEqual(directory.get(ALICE), { id: ALICE, name: 'Alice', lastMessageAt: 1700000005000 });
  assert.equal(canonicalContactId({ id: ALICE_LID }), ALICE, 'the legacy lid column still resolves');
  assert.deepEqual(getPhotoCache(ALICE), { url: ALICE_PHOTO, fetchedAt: 1700000006000 });
  assert.deepEqual(getPhotoCache(BOB), { url: null, fetchedAt: 1700000006000 });
});

test('every store module reads and writes a database adopted from before the runtime-added columns', () => {
  const statements = OUTDATED_FIXTURES['last ran 8302b72: no last_message_at/lid/photo columns, no context, no settings table, no cursor index'];
  startup(copyOf(buildFixture(statements)));
  const directory = createContactDirectory();

  assert.equal(getMonitored(ALICE)?.context, null);
  assert.equal(setContext(ALICE, ALICE_CONTEXT), true);
  assert.equal(getMonitored(ALICE)?.context, ALICE_CONTEXT);

  assert.deepEqual(directory.get(BOB), { id: BOB, name: 'bobby', lastMessageAt: null });
  assert.deepEqual(getPhotoCache(BOB), { url: null, fetchedAt: null });
  setPhotoCache(BOB, ALICE_PHOTO, 1700000009000);
  assert.deepEqual(getPhotoCache(BOB), { url: ALICE_PHOTO, fetchedAt: 1700000009000 });

  assert.equal(getRawSetting('STRIKE_THRESHOLD'), '3');
  ensureDefaultsSeeded();
  assert.deepEqual(setSetting('STRIKE_THRESHOLD', '4'), { ok: true });
  assert.equal(getRawSetting('STRIKE_THRESHOLD'), '4');

  assert.equal(getStrikeCount(ALICE), 2);
  assert.deepEqual(getAuditLogPage({ contactId: ALICE }).map((row) => row.message), ['please stop', 'buy my course']);
});

test('restarting on an adopted database is a no-op: no errors, no re-seeding, no row changes', () => {
  const statements = OUTDATED_FIXTURES['last ran b44a8ac: no contacts.photo_url/photo_fetched_at'];
  const path = copyOf(buildFixture(statements));

  const firstRun = dumpTables(startup(path));
  const second = startup(path);
  assert.deepEqual(dumpTables(second), firstRun);
  assert.deepEqual(migrationRows(second), ALL_MIGRATION_ROWS);
  assert.equal(resolveMigrationBaseline(second, MIGRATIONS_FOLDER), 'already-tracked');

  const third = startup(path);
  assert.deepEqual(dumpTables(third), firstRun);
  assert.deepEqual(migrationRows(third), ALL_MIGRATION_ROWS);
});

test('an empty __drizzle_migrations table next to pre-ORM tables still adopts rather than re-running the baseline', () => {
  const [statements] = Object.values(UP_TO_DATE_FIXTURES);
  const fixture = buildFixture([...statements, 'CREATE TABLE "__drizzle_migrations" (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)']);
  const path = copyOf(fixture);
  const before = withConnection(path, (db) => dumpTables(db));

  withConnection(copyOf(fixture), (db) => assert.equal(resolveMigrationBaseline(db, MIGRATIONS_FOLDER), 'adopted'));
  const db = startup(path);
  // Not a strict dumpTables equality against `before`, for the same reason as the up-to-date-fixtures loop above: adoption only means the baseline itself isn't re-run, not that nothing after it runs either.
  assertPreserved(before, db);
  assert.deepEqual(migrationRows(db), ALL_MIGRATION_ROWS);
});

test('a pre-ORM database that does not match the baseline is refused and left untouched', () => {
  const mismatched = [
    ...RELEASE_8302B72,
    ...CORE_ROWS,
    ...ROSTER_ROWS,
    'ALTER TABLE contacts ADD COLUMN last_message_at TEXT',
  ];
  const path = copyOf(buildFixture(mismatched));
  const before = withConnection(path, (db) => ({ tables: dumpTables(db), shape: shapeOf(db) }));

  assert.throws(() => startup(path), /does not match the migration baseline: contacts\.last_message_at has type TEXT, expected integer/);
  assert.throws(() => getDb(), /does not match the migration baseline/, 'a refused database must not be cached as open');
  closeDb();

  withConnection(path, (db) => {
    assert.deepEqual(dumpTables(db), before.tables);
    assert.deepEqual(shapeOf(db), before.shape, 'the bridge must roll back everything it added');
    assert.equal(hasTable(db, '__drizzle_migrations'), false);
  });
});

test('a migration generated after the baseline still runs on an adopted database', () => {
  const folder = mkdtempSync(join(tmpdir(), 'wcm-migrations-'));
  createdDirs.push(folder);
  mkdirSync(join(folder, 'meta'));
  // Deliberately NOT a copy of the real drizzle/ folder (which may already have its own migrations after the baseline by now) — a synthetic baseline-plus-one-future-migration folder, so this test's meaning ("a migration generated after the baseline") stays correct regardless of how many real migrations exist on top of the baseline when it runs. loadBaseline() (migration-baseline.ts) always reads meta/0000_snapshot.json by that fixed path, so it has to come along with the baseline SQL.
  copyFileSync(join(MIGRATIONS_FOLDER, '0000_baseline.sql'), join(folder, '0000_baseline.sql'));
  copyFileSync(join(MIGRATIONS_FOLDER, 'meta/0000_snapshot.json'), join(folder, 'meta/0000_snapshot.json'));
  writeFileSync(join(folder, '0001_future.sql'), 'ALTER TABLE `contacts` ADD `future_column` text;');
  writeFileSync(
    join(folder, 'meta/_journal.json'),
    JSON.stringify({
      version: '7',
      dialect: 'sqlite',
      entries: [
        { idx: 0, version: '6', when: BASELINE.folderMillis, tag: '0000_baseline', breakpoints: true },
        // Timestamped long before "now": a seed that used the adoption time instead of the baseline's own timestamp would skip it.
        { idx: 1, version: '6', when: BASELINE.folderMillis + 1, tag: '0001_future', breakpoints: true },
      ],
    }),
  );

  const statements = OUTDATED_FIXTURES['last ran b44a8ac: no contacts.photo_url/photo_fetched_at'];
  withConnection(copyOf(buildFixture(statements)), (db) => {
    assert.equal(resolveMigrationBaseline(db, folder), 'adopted');
    openNodeSqliteOrm(db).migrate(folder);
    assert.ok(columnNames(db, 'contacts').includes('future_column'));
    assert.ok(columnNames(db, 'contacts').includes('photo_url'));
    assert.equal(migrationRows(db).length, 2);

    openNodeSqliteOrm(db).migrate(folder);
    assert.equal(migrationRows(db).length, 2);
  });
});
