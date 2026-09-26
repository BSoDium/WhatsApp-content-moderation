import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';

process.env.DB_PATH = 'data/test-audit-log.test.sqlite';

const { logMessage, getAuditLog } = await import('./audit-log.js');

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
