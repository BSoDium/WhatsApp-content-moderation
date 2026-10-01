import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';

process.env.DB_PATH = 'data/test-audit-log.test.sqlite';

const { logMessage, setLoggedAction, getAuditLog, getAuditLogPage, getAuditLogStats, getLastActionAt } = await import('./audit-log.ts');

after(() => {
  for (const ext of ['', '-wal', '-shm']) rmSync(`${process.env.DB_PATH}${ext}`, { force: true });
});

test('getAuditLog is empty for a contact with no entries', () => {
  assert.deepEqual(getAuditLog('nobody@s.whatsapp.net'), []);
});

test('logMessage records an ok classification with its fields intact', () => {
  const contact = 'alice@s.whatsapp.net';
  logMessage({
    contactId: contact,
    direction: 'them',
    message: 'hey',
    classification: { ok: true, flagged: false, category: 'none', reason: 'friendly greeting' },
    action: 'none',
  });

  const [row] = getAuditLog(contact);
  assert.equal(row.direction, 'them');
  assert.equal(row.message, 'hey');
  assert.equal(row.classification_ok, 1);
  assert.equal(row.flagged, 0);
  assert.equal(row.category, 'none');
  assert.equal(row.reason, 'friendly greeting');
  assert.equal(row.error, null);
  assert.equal(row.action, 'none');
});

test('logMessage records a failed classification with error set and flagged/category/reason null', () => {
  const contact = 'bob@s.whatsapp.net';
  logMessage({
    contactId: contact,
    direction: 'them',
    message: 'hi',
    classification: { ok: false, error: 'Ollama unreachable' },
    action: 'classifier_error',
  });

  const [row] = getAuditLog(contact);
  assert.equal(row.classification_ok, 0);
  assert.equal(row.flagged, null);
  assert.equal(row.category, null);
  assert.equal(row.reason, null);
  assert.equal(row.error, 'Ollama unreachable');
});

test('getAuditLog returns entries newest-first and respects limit', () => {
  const contact = 'carol@s.whatsapp.net';
  for (const message of ['one', 'two', 'three']) {
    logMessage({
      contactId: contact,
      direction: 'them',
      message,
      classification: { ok: true, flagged: false, category: 'none', reason: '' },
      action: 'none',
    });
  }

  const all = getAuditLog(contact);
  assert.deepEqual(
    all.map((r) => r.message),
    ['three', 'two', 'one'],
  );

  const limited = getAuditLog(contact, 2);
  assert.deepEqual(
    limited.map((r) => r.message),
    ['three', 'two'],
  );
});

test('logMessage supports direction: me for the bot\'s own replies', () => {
  const contact = 'dave@s.whatsapp.net';
  logMessage({
    contactId: contact,
    direction: 'me',
    message: 'That message was removed for violating this chat\'s policy.',
    classification: { ok: true, flagged: false, category: 'warning', reason: 'automated warning sent' },
    action: 'warning_sent',
  });

  const [row] = getAuditLog(contact);
  assert.equal(row.direction, 'me');
  assert.equal(row.action, 'warning_sent');
});

test('getAuditLogPage with no filter returns newest-first across every contact', () => {
  const rows = getAuditLogPage();
  assert.ok(rows.length > 0);
  for (let i = 1; i < rows.length; i++) assert.ok(rows[i - 1].id > rows[i].id);
});

test('getAuditLogPage filters by contactId, action, and search', () => {
  const contact = 'erin@s.whatsapp.net';
  logMessage({ contactId: contact, direction: 'them', message: 'buy my crypto course now', classification: { ok: true, flagged: true, category: 'spam', reason: 'unsolicited promotion' }, action: 'delete+warn' });
  logMessage({ contactId: contact, direction: 'them', message: 'hows it going', classification: { ok: true, flagged: false, category: 'none', reason: '' }, action: 'none' });

  assert.deepEqual(getAuditLogPage({ contactId: contact }).map((r) => r.message), ['hows it going', 'buy my crypto course now']);
  assert.deepEqual(getAuditLogPage({ contactId: contact, action: 'delete+warn' }).map((r) => r.message), ['buy my crypto course now']);
  assert.deepEqual(getAuditLogPage({ contactId: contact, search: 'CRYPTO' }).map((r) => r.message), ['buy my crypto course now']);
  assert.deepEqual(getAuditLogPage({ contactId: contact, search: 'nonexistent' }), []);
});

test('getAuditLogPage paginates with a before cursor, oldest page has no gap or overlap', () => {
  const contact = 'frank@s.whatsapp.net';
  for (const message of ['a', 'b', 'c', 'd']) {
    logMessage({ contactId: contact, direction: 'them', message, classification: { ok: true, flagged: false, category: 'none', reason: '' }, action: 'none' });
  }

  const firstPage = getAuditLogPage({ contactId: contact, limit: 2 });
  assert.deepEqual(firstPage.map((r) => r.message), ['d', 'c']);

  const secondPage = getAuditLogPage({ contactId: contact, limit: 2, before: firstPage[firstPage.length - 1].id });
  assert.deepEqual(secondPage.map((r) => r.message), ['b', 'a']);
});

test('getAuditLogStats counts by action, across every contact logged so far in this suite', () => {
  // Exact totals aren't asserted — this file's tests share one DB and keep adding
  // rows — only that the aggregate reflects rows earlier tests are known to have added:
  // bob's classifier_error, dave's warning_sent, and erin's spam delete+warn.
  const stats = getAuditLogStats();
  assert.ok(stats.totalLogged >= 4);
  assert.ok(stats.totalFlaggedDeleted >= 1);
  assert.ok(stats.totalWarningsSent >= 1);
  assert.ok(stats.totalClassifierErrors >= 1);
  assert.ok(stats.byCategory.some((entry) => entry.category === 'spam' && entry.count >= 1));
  assert.ok(stats.byCategory.every((entry) => entry.count > 0));
});

test('getAuditLogStats charts a flagged shadow-mode message by category but not a passed one', () => {
  const contact = 'gina@s.whatsapp.net';
  logMessage({ contactId: contact, direction: 'them', message: 'x', classification: { ok: true, flagged: true, category: 'shadow_only_category', reason: '' }, action: 'shadow' });
  logMessage({ contactId: contact, direction: 'them', message: 'y', classification: { ok: true, flagged: false, category: 'shadow_passed_category', reason: '' }, action: 'shadow' });

  const { byCategory } = getAuditLogStats();
  assert.ok(byCategory.some((entry) => entry.category === 'shadow_only_category'));
  assert.ok(byCategory.every((entry) => entry.category !== 'shadow_passed_category'));
});

test('getLastActionAt returns the newest matching entry for that contact only, or null', () => {
  const contact = 'hank@s.whatsapp.net';
  const classification = { ok: true, flagged: false, category: 'none', reason: '' };
  assert.equal(getLastActionAt(contact, 'warning_sent'), null);

  logMessage({ contactId: contact, direction: 'me', message: 'w', classification, action: 'warning_sent' });
  logMessage({ contactId: 'someone-else@s.whatsapp.net', direction: 'me', message: 'w', classification, action: 'warning_sent' });

  assert.equal(typeof getLastActionAt(contact, 'warning_sent'), 'number');
  assert.equal(getLastActionAt(contact, 'delete+warn'), null);
});

test('getAuditLogStats counts a grouped delete as a deletion', () => {
  const before = getAuditLogStats().totalFlaggedDeleted;
  logMessage({ contactId: 'ida@s.whatsapp.net', direction: 'them', message: 'x', classification: { ok: true, flagged: true, category: 'spam', reason: '' }, action: 'delete' });

  assert.equal(getAuditLogStats().totalFlaggedDeleted, before + 1);
});

test('logMessage returns the row id and setLoggedAction relabels that row only', async () => {
  const contact = 'relabel@s.whatsapp.net';
  const classification = { ok: true, flagged: true, category: 'spam', reason: 'promo' };
  const first = logMessage({ contactId: contact, direction: 'them', message: 'one', classification, action: 'delete' });
  const second = logMessage({ contactId: contact, direction: 'them', message: 'two', classification, action: 'delete' });

  setLoggedAction(first, 'delete+warn');

  const actions = Object.fromEntries(getAuditLog(contact).map((row) => [row.id, row.action]));
  assert.deepEqual(actions, { [first]: 'delete+warn', [second]: 'delete' });
});
