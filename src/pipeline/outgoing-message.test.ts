import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';

process.env.DB_PATH = 'data/test-outgoing-message.test.sqlite';

const { extractOutgoingMessage, recordOutgoingMessage, OUTGOING_ACTION } = await import('./outgoing-message.ts');
const { getAuditLog } = await import('../store/audit-log.ts');

after(() => {
  for (const ext of ['', '-wal', '-shm']) rmSync(`${process.env.DB_PATH}${ext}`, { force: true });
});

const CONTACT = 'target@s.whatsapp.net';

function ownMsg(overrides = {}) {
  return {
    key: { remoteJid: CONTACT, fromMe: true, id: 'OWN' },
    message: { conversation: 'lol you idiot' },
    messageTimestamp: 1700000000,
    ...overrides,
  };
}

test('accepts a live text message sent from the user\'s own phone', () => {
  assert.deepEqual(extractOutgoingMessage(ownMsg()), { text: 'lol you idiot', timestamp: 1700000000 * 1000 });
});

test('extracts extendedTextMessage text', () => {
  const msg = ownMsg({ message: { extendedTextMessage: { text: 'a reply' } } });
  assert.equal(extractOutgoingMessage(msg)?.text, 'a reply');
});

test('ignores type "append" so the bot\'s own warning replies are never recorded as the user\'s', () => {
  assert.equal(extractOutgoingMessage(ownMsg(), 'append'), null);
});

test('ignores messages from the contact', () => {
  const msg = ownMsg({ key: { remoteJid: CONTACT, fromMe: false, id: 'THEIRS' } });
  assert.equal(extractOutgoingMessage(msg), null);
});

test('ignores messages with no text (e.g. media only)', () => {
  assert.equal(extractOutgoingMessage(ownMsg({ message: { imageMessage: {} } })), null);
  assert.equal(extractOutgoingMessage(ownMsg({ message: undefined })), null);
});

test('recordOutgoingMessage logs a "me" row stamped with the message time, never flagged', () => {
  recordOutgoingMessage(CONTACT, { text: 'hey', timestamp: 1234 });

  const [row] = getAuditLog(CONTACT, 1);
  assert.equal(row.direction, 'me');
  assert.equal(row.message, 'hey');
  assert.equal(row.action, OUTGOING_ACTION);
  assert.equal(row.flagged, 0);
  assert.equal(row.created_at, 1234);
});
