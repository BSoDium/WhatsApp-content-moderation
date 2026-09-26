import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';

process.env.DB_PATH = 'data/test-monitored-contacts.test.sqlite';

const { listMonitored, isMonitored, getMonitored, addMonitored, removeMonitored, setEscalationEnabled, isEscalationEnabled } =
  await import('./monitored-contacts.js');

after(() => {
  for (const ext of ['', '-wal', '-shm']) rmSync(`${process.env.DB_PATH}${ext}`, { force: true });
});

test('a contact not on the roster is not monitored and defaults to escalation disabled', () => {
  assert.equal(isMonitored('nobody@s.whatsapp.net'), false);
  assert.equal(isEscalationEnabled('nobody@s.whatsapp.net'), false);
});

test('getMonitored returns the roster row, or undefined if there is none', () => {
  assert.equal(getMonitored('nobody@s.whatsapp.net'), undefined);
  const contact = 'eve@s.whatsapp.net';
  addMonitored(contact);
  const row = getMonitored(contact);
  assert.equal(row.contactId, contact);
  assert.equal(row.escalationEnabled, true);
  assert.equal(typeof row.addedAt, 'number');
});

test('addMonitored adds a contact with escalation on by default', () => {
  const contact = 'alice@s.whatsapp.net';
  addMonitored(contact);
  assert.equal(isMonitored(contact), true);
  assert.equal(isEscalationEnabled(contact), true);
});

test('addMonitored is idempotent and does not reset an existing escalation flag', () => {
  const contact = 'bob@s.whatsapp.net';
  addMonitored(contact);
  setEscalationEnabled(contact, false);
  addMonitored(contact);
  assert.equal(isEscalationEnabled(contact), false);
});

test('setEscalationEnabled toggles the flag and returns whether a row was updated', () => {
  const contact = 'carol@s.whatsapp.net';
  addMonitored(contact);
  assert.equal(setEscalationEnabled(contact, false), true);
  assert.equal(isEscalationEnabled(contact), false);
  assert.equal(setEscalationEnabled(contact, true), true);
  assert.equal(isEscalationEnabled(contact), true);
});

test('setEscalationEnabled returns false for a contact not on the roster', () => {
  assert.equal(setEscalationEnabled('ghost@s.whatsapp.net', false), false);
});

test('removeMonitored removes the roster row and reports whether one existed', () => {
  const contact = 'dave@s.whatsapp.net';
  addMonitored(contact);
  assert.equal(removeMonitored(contact), true);
  assert.equal(isMonitored(contact), false);
  assert.equal(removeMonitored(contact), false);
});

test('listMonitored returns roster rows ordered oldest-added first', () => {
  addMonitored('first@s.whatsapp.net');
  addMonitored('second@s.whatsapp.net');
  const ids = listMonitored().map((r) => r.contactId);
  assert.ok(ids.indexOf('first@s.whatsapp.net') < ids.indexOf('second@s.whatsapp.net'));

  const row = listMonitored().find((r) => r.contactId === 'first@s.whatsapp.net');
  assert.equal(row.escalationEnabled, true);
  assert.equal(typeof row.addedAt, 'number');
});
