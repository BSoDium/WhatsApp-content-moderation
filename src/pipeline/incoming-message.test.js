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

test('accepts a plain text message', () => {
  const result = extractIncomingMessage(baseMsg());
  assert.deepEqual(result, { text: 'hello', key: baseMsg().key, timestamp: 1700000000 * 1000 });
});

test('extracts extendedTextMessage text when conversation is absent', () => {
  const msg = baseMsg({ message: { extendedTextMessage: { text: 'quoted reply' } } });
  const result = extractIncomingMessage(msg);
  assert.equal(result.text, 'quoted reply');
});

test('rejects anything but type "notify" (own sync/append traffic)', () => {
  assert.equal(extractIncomingMessage(baseMsg(), false, 'append'), null);
  assert.equal(extractIncomingMessage(baseMsg(), true, 'append'), null);
});

test('rejects a message with no message payload', () => {
  const msg = baseMsg({ message: undefined });
  assert.equal(extractIncomingMessage(msg), null);
});

test('rejects our own message unless allowSelf is set', () => {
  const msg = baseMsg({ key: { remoteJid: TARGET, fromMe: true, id: 'X' } });
  assert.equal(extractIncomingMessage(msg, false), null);
  assert.equal(extractIncomingMessage(msg, true).text, 'hello');
});

test('rejects a message with no extractable text (e.g. media only)', () => {
  const msg = baseMsg({ message: { imageMessage: {} } });
  assert.equal(extractIncomingMessage(msg), null);
});

test('defaults type to "notify" and allowSelf to false when omitted', () => {
  assert.equal(extractIncomingMessage(baseMsg()).text, 'hello');
  const ownMsg = baseMsg({ key: { remoteJid: TARGET, fromMe: true, id: 'X' } });
  assert.equal(extractIncomingMessage(ownMsg), null);
});
