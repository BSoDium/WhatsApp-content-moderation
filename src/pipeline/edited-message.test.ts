import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractEditedMessage } from './edited-message.ts';

const KEY = { remoteJid: 'target@s.whatsapp.net', fromMe: false, id: 'ORIGINAL' };

function editUpdate({ key = KEY, edited = { conversation: 'now it is harmful' }, timestamp = 1700000060 } = {}) {
  return {
    key,
    update: { message: { editedMessage: { message: edited } }, messageTimestamp: timestamp },
  };
}

test('extracts the new text of an edit, keyed to the original message', () => {
  assert.deepEqual(extractEditedMessage(editUpdate()), {
    text: 'now it is harmful',
    key: KEY,
    timestamp: 1700000060 * 1000,
  });
});

test('extracts extendedTextMessage text', () => {
  const update = editUpdate({ edited: { extendedTextMessage: { text: 'edited reply' } } });
  assert.equal(extractEditedMessage(update)?.text, 'edited reply');
});

test('ignores updates that are not edits (receipts, reactions, status changes)', () => {
  assert.equal(extractEditedMessage({ key: KEY, update: { status: 3 } }), null);
});

test('ignores an edit with no text (e.g. an edited media caption-less message)', () => {
  assert.equal(extractEditedMessage(editUpdate({ edited: { imageMessage: {} } })), null);
});

test('ignores our own edits unless allowSelf is set', () => {
  const update = editUpdate({ key: { ...KEY, fromMe: true } });
  assert.equal(extractEditedMessage(update), null);
  assert.equal(extractEditedMessage(update, true)?.text, 'now it is harmful');
});

test('falls back to now when the update carries no timestamp', () => {
  const before = Date.now();
  for (const timestamp of [undefined, null]) {
    const update = editUpdate();
    update.update.messageTimestamp = timestamp;
    assert.ok(extractEditedMessage(update).timestamp >= before);
  }
});
