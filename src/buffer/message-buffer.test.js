import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMessageBuffer } from './message-buffer.js';

test('groups messages arriving within windowMs into one flush', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });

  const flushes = [];
  const buffer = createMessageBuffer((contactId, messages) => flushes.push({ contactId, messages }), {
    windowMs: 1000,
  });

  buffer.push('alice', 'hey');
  t.mock.timers.tick(500);
  buffer.push('alice', 'you there');
  t.mock.timers.tick(999);
  assert.deepEqual(flushes, []);

  t.mock.timers.tick(1);
  assert.deepEqual(flushes, [{ contactId: 'alice', messages: ['hey', 'you there'] }]);
});

test('starts a new burst once windowMs of silence has passed', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });

  const flushes = [];
  const buffer = createMessageBuffer((contactId, messages) => flushes.push(messages), { windowMs: 1000 });

  buffer.push('alice', 'first burst');
  t.mock.timers.tick(1000);
  buffer.push('alice', 'second burst');
  t.mock.timers.tick(1000);

  assert.deepEqual(flushes, [['first burst'], ['second burst']]);
});

test('buffers each contact independently', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });

  const flushes = [];
  const buffer = createMessageBuffer((contactId, messages) => flushes.push({ contactId, messages }), {
    windowMs: 1000,
  });

  buffer.push('alice', 'hi');
  t.mock.timers.tick(500);
  buffer.push('bob', 'yo');
  t.mock.timers.tick(500);

  assert.deepEqual(flushes, [{ contactId: 'alice', messages: ['hi'] }]);

  t.mock.timers.tick(500);
  assert.deepEqual(flushes, [
    { contactId: 'alice', messages: ['hi'] },
    { contactId: 'bob', messages: ['yo'] },
  ]);
});

test('flushAll drains every pending contact immediately, without waiting for windowMs', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });

  const flushes = [];
  const buffer = createMessageBuffer((contactId, messages) => flushes.push({ contactId, messages }), {
    windowMs: 10_000,
  });

  buffer.push('alice', 'a');
  buffer.push('bob', 'b');
  await buffer.flushAll();

  assert.deepEqual(flushes.map((f) => f.contactId).sort(), ['alice', 'bob']);
});

test('flushAll on an empty buffer resolves without flushing anything', async () => {
  const flushes = [];
  const buffer = createMessageBuffer((contactId, messages) => flushes.push({ contactId, messages }));

  await buffer.flushAll();

  assert.deepEqual(flushes, []);
});

test('a contact flushed by flushAll does not flush again on its old timer', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });

  const flushes = [];
  const buffer = createMessageBuffer((contactId, messages) => flushes.push(messages), { windowMs: 1000 });

  buffer.push('alice', 'a');
  await buffer.flushAll();
  t.mock.timers.tick(1000);

  assert.deepEqual(flushes, [['a']]);
});
