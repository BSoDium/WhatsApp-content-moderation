import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';

process.env.DB_PATH = 'data/test-contact-directory.test.sqlite';

const { createContactDirectory } = await import('./contact-directory.js');
const { getDb } = await import('../store/db.js');

beforeEach(() => {
  getDb().exec('DELETE FROM contacts');
});

after(() => {
  for (const ext of ['', '-wal', '-shm']) rmSync(`${process.env.DB_PATH}${ext}`, { force: true });
});

function fakeSock() {
  const handlers = {};
  return {
    ev: { on: (event, handler) => (handlers[event] = handler) },
    emit: (event, payload) => handlers[event](payload),
  };
}

test('list() is empty before any event fires', () => {
  const directory = createContactDirectory();
  assert.deepEqual(directory.list(), []);
});

test('messaging-history.set seeds full contacts with a name', () => {
  const directory = createContactDirectory();
  const sock = fakeSock();
  directory.attach(sock);

  sock.emit('messaging-history.set', { contacts: [{ id: 'alice@s.whatsapp.net', name: 'Alice' }] });

  assert.equal(directory.get('alice@s.whatsapp.net').name, 'Alice');
});

test('a later contacts.update partial does not erase a fuller name from history sync', () => {
  const directory = createContactDirectory();
  const sock = fakeSock();
  directory.attach(sock);

  sock.emit('messaging-history.set', { contacts: [{ id: 'alice@s.whatsapp.net', name: 'Alice' }] });
  sock.emit('contacts.update', [{ id: 'alice@s.whatsapp.net', notify: 'Al' }]);

  assert.equal(directory.get('alice@s.whatsapp.net').name, 'Alice');
});

test('contacts.update on a never-seen contact still produces a usable entry via notify', () => {
  const directory = createContactDirectory();
  const sock = fakeSock();
  directory.attach(sock);

  sock.emit('contacts.update', [{ id: 'bob@s.whatsapp.net', notify: 'Bob' }]);

  assert.equal(directory.get('bob@s.whatsapp.net').name, 'Bob');
});

test('a contact with no name/notify/verifiedName falls back to a formatted JID', () => {
  const directory = createContactDirectory();
  const sock = fakeSock();
  directory.attach(sock);

  sock.emit('contacts.upsert', [{ id: '15551234567@s.whatsapp.net' }]);

  assert.equal(directory.get('15551234567@s.whatsapp.net').name, '+15551234567');
});

test('a contact never seen at all still returns a formatted-JID fallback from get()', () => {
  const directory = createContactDirectory();
  assert.equal(directory.get('99999999999@s.whatsapp.net').name, '+99999999999');
});

test('group and broadcast JIDs are filtered out of the directory', () => {
  const directory = createContactDirectory();
  const sock = fakeSock();
  directory.attach(sock);

  sock.emit('messaging-history.set', {
    contacts: [
      { id: 'alice@s.whatsapp.net', name: 'Alice' },
      { id: '123-456@g.us', name: 'Some Group' },
      { id: 'status@broadcast', name: 'Status' },
    ],
  });

  assert.deepEqual(
    directory.list().map((c) => c.id),
    ['alice@s.whatsapp.net'],
  );
});

test('contacts.upsert bulk-adds multiple contacts', () => {
  const directory = createContactDirectory();
  const sock = fakeSock();
  directory.attach(sock);

  sock.emit('contacts.upsert', [
    { id: 'alice@s.whatsapp.net', name: 'Alice' },
    { id: 'bob@s.whatsapp.net', name: 'Bob' },
  ]);

  assert.deepEqual(
    directory.list().map((c) => c.name).sort(),
    ['Alice', 'Bob'],
  );
});

test('contacts persist across separate createContactDirectory() instances (i.e. across restarts)', () => {
  const first = createContactDirectory();
  const sock = fakeSock();
  first.attach(sock);
  sock.emit('messaging-history.set', { contacts: [{ id: 'carol@s.whatsapp.net', name: 'Carol' }] });

  const second = createContactDirectory();
  assert.equal(second.get('carol@s.whatsapp.net').name, 'Carol');
});
