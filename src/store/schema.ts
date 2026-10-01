import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// Keys mirror the snake_case column names so selected rows already have src/types.ts's *Record shapes, which callers and the control app consume as-is.

export const strikes = sqliteTable('strikes', {
  contact_id: text().primaryKey(),
  count: integer().notNull().default(0),
  updated_at: integer().notNull(),
});

export const callStrikes = sqliteTable('call_strikes', {
  contact_id: text().primaryKey(),
  unanswered_count: integer().notNull().default(0),
  strike_count: integer().notNull().default(0),
  updated_at: integer().notNull(),
  unanswered_updated_at: integer().notNull().default(0),
});

export const blocks = sqliteTable(
  'blocks',
  {
    id: integer().primaryKey({ autoIncrement: true }),
    contact_id: text().notNull(),
    blocked_at: integer().notNull(),
    unblock_at: integer().notNull(),
    unblocked_at: integer(),
  },
  (table) => [
    index('blocks_pending_idx').on(table.contact_id, table.unblocked_at),
    index('blocks_expiry_idx').on(table.unblocked_at, table.unblock_at),
  ],
);

export const auditLog = sqliteTable(
  'audit_log',
  {
    id: integer().primaryKey({ autoIncrement: true }),
    contact_id: text().notNull(),
    direction: text().$type<'me' | 'them'>().notNull(),
    message: text().notNull(),
    classification_ok: integer().notNull(),
    flagged: integer(),
    category: text(),
    reason: text(),
    error: text(),
    action: text().notNull(),
    created_at: integer().notNull(),
  },
  (table) => [
    index('audit_log_contact_idx').on(table.contact_id, table.created_at),
    index('audit_log_contact_cursor_idx').on(table.contact_id, table.id),
  ],
);

export const monitoredContacts = sqliteTable('monitored_contacts', {
  contact_id: text().primaryKey(),
  escalation_enabled: integer().notNull().default(1),
  added_at: integer().notNull(),
  context: text(),
  // null = use the global NUISANCE_CALL_THRESHOLD setting.
  call_nuisance_threshold: integer(),
});

export const contacts = sqliteTable('contacts', {
  contact_id: text().primaryKey(),
  name: text(),
  notify: text(),
  verified_name: text(),
  lid: text(),
  updated_at: integer().notNull(),
  last_message_at: integer(),
  photo_url: text(),
  photo_fetched_at: integer(),
});

export const settings = sqliteTable('settings', {
  key: text().primaryKey(),
  value: text().notNull(),
  updated_at: integer().notNull(),
});
