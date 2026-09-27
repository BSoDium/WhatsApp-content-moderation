import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';

process.env.DB_PATH = 'data/test-contact-directory.test.sqlite';

const { createContactDirectory, canonicalContactId, canonicalMessageContactId } = await import('./contact-directory.ts');
const { getDb } = await import('../store/db.ts');

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

test('an empty-string notify never erases a fuller name (COALESCE treats "" as non-null)', () => {
  const directory = createContactDirectory();
  const sock = fakeSock();
  directory.attach(sock);

  sock.emit('messaging-history.set', { contacts: [{ id: 'alice@s.whatsapp.net', name: 'Alice' }] });
  sock.emit('contacts.update', [{ id: 'alice@s.whatsapp.net', notify: '' }]);

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

test('a contact with no activity at all has a null lastMessageAt', () => {
  const directory = createContactDirectory();
  const sock = fakeSock();
  directory.attach(sock);

  sock.emit('contacts.upsert', [{ id: 'alice@s.whatsapp.net', name: 'Alice' }]);

  assert.equal(directory.get('alice@s.whatsapp.net').lastMessageAt, null);
});

test("messaging-history.set's chats array backfills lastMessageAt via conversationTimestamp", () => {
  const directory = createContactDirectory();
  const sock = fakeSock();
  directory.attach(sock);

  sock.emit('messaging-history.set', {
    contacts: [{ id: 'alice@s.whatsapp.net', name: 'Alice' }],
    chats: [{ id: 'alice@s.whatsapp.net', conversationTimestamp: 1_700_000_000 }],
  });

  assert.equal(directory.get('alice@s.whatsapp.net').lastMessageAt, 1_700_000_000_000);
});

test('a live messages.upsert event advances lastMessageAt, in either direction', () => {
  const directory = createContactDirectory();
  const sock = fakeSock();
  directory.attach(sock);

  sock.emit('messages.upsert', {
    messages: [{ key: { remoteJid: 'alice@s.whatsapp.net', fromMe: true }, messageTimestamp: 1_700_000_100 }],
    type: 'notify',
  });

  assert.equal(directory.get('alice@s.whatsapp.net').lastMessageAt, 1_700_000_100_000);
});

test('an older/out-of-order timestamp never regresses lastMessageAt', () => {
  const directory = createContactDirectory();
  const sock = fakeSock();
  directory.attach(sock);

  sock.emit('messages.upsert', { messages: [{ key: { remoteJid: 'alice@s.whatsapp.net' }, messageTimestamp: 1_700_000_200 }], type: 'notify' });
  sock.emit('messages.upsert', { messages: [{ key: { remoteJid: 'alice@s.whatsapp.net' }, messageTimestamp: 1_700_000_100 }], type: 'notify' });

  assert.equal(directory.get('alice@s.whatsapp.net').lastMessageAt, 1_700_000_200_000);
});

test('a name-only update never clears an existing lastMessageAt', () => {
  const directory = createContactDirectory();
  const sock = fakeSock();
  directory.attach(sock);

  sock.emit('messages.upsert', { messages: [{ key: { remoteJid: 'alice@s.whatsapp.net' }, messageTimestamp: 1_700_000_100 }], type: 'notify' });
  sock.emit('contacts.update', [{ id: 'alice@s.whatsapp.net', notify: 'Al' }]);

  assert.equal(directory.get('alice@s.whatsapp.net').lastMessageAt, 1_700_000_100_000);
});

test('a Contact carrying both .id (lid) and .phoneNumber reconciles to one row under the phone number', () => {
  const directory = createContactDirectory();
  const sock = fakeSock();
  directory.attach(sock);

  sock.emit('contacts.upsert', [{ id: '111@lid', phoneNumber: '15551234567@s.whatsapp.net', name: 'Alain Négrel' }]);

  assert.deepEqual(directory.list().map((c) => c.id), ['15551234567@s.whatsapp.net']);
  assert.equal(directory.get('15551234567@s.whatsapp.net').name, 'Alain Négrel');
});

test('a bare lid-only contacts.update folds into the phone-number row once the pairing is already known', () => {
  const directory = createContactDirectory();
  const sock = fakeSock();
  directory.attach(sock);

  sock.emit('messaging-history.set', { contacts: [{ id: '15551234567@s.whatsapp.net', name: 'Alain Négrel' }] });
  sock.emit('contacts.upsert', [{ id: '111@lid', phoneNumber: '15551234567@s.whatsapp.net' }]);
  // A later event addressed purely by lid, with no phoneNumber field at all (the exact shape a bare pushname sync sends).
  sock.emit('contacts.update', [{ id: '111@lid', notify: 'Négrel' }]);

  assert.deepEqual(directory.list().map((c) => c.id), ['15551234567@s.whatsapp.net']);
  assert.equal(directory.get('15551234567@s.whatsapp.net').name, 'Alain Négrel');
});

test('a lid-only contact seen before its phone-number pairing is learned merges once the pairing arrives, in either order', () => {
  const directory = createContactDirectory();
  const sock = fakeSock();
  directory.attach(sock);

  // The lid-addressed pushname arrives first, with no pairing known yet.
  sock.emit('contacts.update', [{ id: '222@lid', notify: 'Négrel' }]);
  assert.deepEqual(directory.list().map((c) => c.id), ['222@lid']);

  // The full address-book sync (or a later contacts.upsert) reveals the pairing.
  sock.emit('contacts.upsert', [{ id: '222@lid', phoneNumber: '15559876543@s.whatsapp.net', name: 'Alain Négrel' }]);

  assert.deepEqual(directory.list().map((c) => c.id), ['15559876543@s.whatsapp.net']);
  assert.equal(directory.get('15559876543@s.whatsapp.net').name, 'Alain Négrel');
});

test('a message with remoteJidAlt reconciles a lid-addressed chat to its phone-number contact', () => {
  const directory = createContactDirectory();
  const sock = fakeSock();
  directory.attach(sock);

  sock.emit('messaging-history.set', { contacts: [{ id: '15551234567@s.whatsapp.net', name: 'Alice' }] });
  sock.emit('messages.upsert', {
    messages: [{ key: { remoteJid: '333@lid', remoteJidAlt: '15551234567@s.whatsapp.net' }, messageTimestamp: 1_700_000_500 }],
    type: 'notify',
  });

  assert.deepEqual(directory.list().map((c) => c.id), ['15551234567@s.whatsapp.net']);
  assert.equal(directory.get('15551234567@s.whatsapp.net').lastMessageAt, 1_700_000_500_000);
});

test('a lid contact with no phone-number pairing known yet stays as its own row instead of being lost', () => {
  const directory = createContactDirectory();
  const sock = fakeSock();
  directory.attach(sock);

  sock.emit('contacts.update', [{ id: '444@lid', notify: 'Unpaired' }]);

  assert.equal(directory.get('444@lid').name, 'Unpaired');
});

test('canonicalContactId strips a device suffix, e.g. sock.user.id vs. a message-derived remoteJid', () => {
  assert.equal(canonicalContactId({ id: '15551234567:31@s.whatsapp.net' }), '15551234567@s.whatsapp.net');
});

test('canonicalContactId resolves a bare lid (no .phoneNumber on the object) via a mapping the directory already learned', () => {
  const directory = createContactDirectory();
  const sock = fakeSock();
  directory.attach(sock);

  // Some other event already taught the directory this lid<->pn pairing...
  sock.emit('contacts.upsert', [{ id: '555@lid', phoneNumber: '15551234567@s.whatsapp.net' }]);

  // ...so resolving sock.user, which often exposes only the bare lid with no
  // populated .phoneNumber, still lands on the same canonical row.
  assert.equal(canonicalContactId({ id: '555@lid' }), '15551234567@s.whatsapp.net');
});

test('canonicalContactId falls back to the (normalized) lid itself when no mapping is known at all', () => {
  assert.equal(canonicalContactId({ id: '999:5@lid' }), '999@lid');
});

test("a self contact (device-suffixed sock.user.id) matches the directory's normalized row for the same JID", () => {
  const directory = createContactDirectory();
  const sock = fakeSock();
  directory.attach(sock);

  sock.emit('messages.upsert', {
    messages: [{ key: { remoteJid: '15551234567@s.whatsapp.net', fromMe: true }, messageTimestamp: 1_700_000_100 }],
    type: 'notify',
  });

  const selfId = canonicalContactId({ id: '15551234567:31@s.whatsapp.net' });
  assert.deepEqual(directory.list().map((c) => c.id), [selfId]);
});

test('canonicalMessageContactId matches a contact added to the roster under the phone-number JID, for a message key carrying remoteJidAlt', () => {
  // The exact failure mode: a contact gets added to the roster (via the
  // control app, which shows the directory's canonicalized id) under their
  // phone-number JID, but a live message for that same conversation arrives
  // addressed via @lid — index.ts's isMonitored() lookup must still match.
  const rosterId = canonicalContactId({ id: '15551234567@s.whatsapp.net' });
  const messageId = canonicalMessageContactId({ remoteJid: '777@lid', remoteJidAlt: '15551234567@s.whatsapp.net' });
  assert.equal(messageId, rosterId);
});

test('canonicalMessageContactId resolves a bare-lid message key via a mapping the directory already learned', () => {
  const directory = createContactDirectory();
  const sock = fakeSock();
  directory.attach(sock);
  sock.emit('contacts.upsert', [{ id: '888@lid', phoneNumber: '15551234567@s.whatsapp.net' }]);

  // A later message with no remoteJidAlt of its own still resolves correctly.
  assert.equal(canonicalMessageContactId({ remoteJid: '888@lid' }), '15551234567@s.whatsapp.net');
});

test('canonicalMessageContactId returns null for a message with no remoteJid', () => {
  assert.equal(canonicalMessageContactId({}), null);
});

test('contacts persist across separate createContactDirectory() instances (i.e. across restarts)', () => {
  const first = createContactDirectory();
  const sock = fakeSock();
  first.attach(sock);
  sock.emit('messaging-history.set', { contacts: [{ id: 'carol@s.whatsapp.net', name: 'Carol' }] });

  const second = createContactDirectory();
  assert.equal(second.get('carol@s.whatsapp.net').name, 'Carol');
});
