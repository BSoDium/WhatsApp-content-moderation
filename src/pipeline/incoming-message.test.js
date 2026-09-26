import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractIncomingMessage } from './incoming-message.js';

const TARGET = 'target@s.whatsapp.net';

function baseMsg(overrides = {}) {
  return {
    key: { remoteJid: TARGET, fromMe: false, id: 'ABC' },
    message: { conversation: 'hello' },
    messageTimestamp: 1700000000,
    ...overrides,
  };
}

test('accepts a plain text message from the target contact', () => {
  const result = extractIncomingMessage(baseMsg(), TARGET);
  assert.deepEqual(result, { text: 'hello', key: baseMsg().key, timestamp: 1700000000 * 1000 });
});

test('extracts extendedTextMessage text when conversation is absent', () => {
  const msg = baseMsg({ message: { extendedTextMessage: { text: 'quoted reply' } } });
  const result = extractIncomingMessage(msg, TARGET);
  assert.equal(result.text, 'quoted reply');
});

test('rejects anything but type "notify" (own sync/append traffic)', () => {
  assert.equal(extractIncomingMessage(baseMsg(), TARGET, false, 'append'), null);
  assert.equal(extractIncomingMessage(baseMsg(), TARGET, true, 'append'), null);
});

test('rejects a message with no message payload', () => {
  const msg = baseMsg({ message: undefined });
  assert.equal(extractIncomingMessage(msg, TARGET), null);
});

test('rejects our own message unless allowSelf is set', () => {
  const msg = baseMsg({ key: { remoteJid: TARGET, fromMe: true, id: 'X' } });
  assert.equal(extractIncomingMessage(msg, TARGET, false), null);
  assert.equal(extractIncomingMessage(msg, TARGET, true).text, 'hello');
});

test('rejects a message from a contact other than the target', () => {
  const msg = baseMsg({ key: { remoteJid: 'someone-else@s.whatsapp.net', fromMe: false, id: 'X' } });
  assert.equal(extractIncomingMessage(msg, TARGET), null);
});

test('rejects a message with no extractable text (e.g. media only)', () => {
  const msg = baseMsg({ message: { imageMessage: {} } });
  assert.equal(extractIncomingMessage(msg, TARGET), null);
});

test('defaults type to "notify" and allowSelf to false when omitted', () => {
  assert.equal(extractIncomingMessage(baseMsg(), TARGET).text, 'hello');
  const ownMsg = baseMsg({ key: { remoteJid: TARGET, fromMe: true, id: 'X' } });
  assert.equal(extractIncomingMessage(ownMsg, TARGET), null);
});
