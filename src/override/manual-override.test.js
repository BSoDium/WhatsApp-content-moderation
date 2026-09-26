import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';

process.env.DB_PATH = 'data/test-manual-override.test.sqlite';

const { createManualOverride } = await import('./manual-override.js');
const { createBlock } = await import('../store/blocks.js');
const { recordStrike } = await import('../store/strikes.js');

after(() => {
  for (const ext of ['', '-wal', '-shm']) rmSync(`${process.env.DB_PATH}${ext}`, { force: true });
});

const TARGET = 'target@s.whatsapp.net';

test('pause and resume toggle isPaused for that contact', async () => {
  const override = createManualOverride({ unblock: async () => {} });
  assert.equal(override.isPaused(TARGET), false);

  await override.runCommand(TARGET, 'pause');
  assert.equal(override.isPaused(TARGET), true);

  await override.runCommand(TARGET, 'resume');
  assert.equal(override.isPaused(TARGET), false);
});

test('pause is per-contact, not global', async () => {
  const other = 'other@s.whatsapp.net';
  const override = createManualOverride({ unblock: async () => {} });

  await override.runCommand(TARGET, 'pause');
  assert.equal(override.isPaused(TARGET), true);
  assert.equal(override.isPaused(other), false);

  await override.runCommand(TARGET, 'resume');
  assert.equal(override.isPaused(TARGET), false);
});

test('getStatus reports pause state, strikes, and the real block field shape', async () => {
  const contact = 'status-check@s.whatsapp.net';
  recordStrike(contact);
  recordStrike(contact);
  const unblockAt = Date.now() + 60_000;
  createBlock(contact, unblockAt);
  const override = createManualOverride({ unblock: async () => {} });

  assert.deepEqual(override.getStatus(contact), { paused: false, strikeCount: 2, block: { unblockAt } });
});

test('getStatus reports block: null when there is no active block', () => {
  const override = createManualOverride({ unblock: async () => {} });
  assert.equal(override.getStatus('no-block@s.whatsapp.net').block, null);
});

test('unblock calls actions.unblock and clears the active block', async () => {
  const contact = 'blocked-contact@s.whatsapp.net';
  createBlock(contact, Date.now() + 60_000);
  const unblocked = [];
  const override = createManualOverride({ unblock: async (jid) => unblocked.push(jid) });

  const reply = await override.runCommand(contact, 'unblock');

  assert.deepEqual(unblocked, [contact]);
  assert.match(reply, /unblocked/i);
  assert.equal(override.getStatus(contact).block, null);
});

test('unblock on a contact with no active block is a no-op', async () => {
  const override = createManualOverride({ unblock: async () => {} });
  const reply = await override.runCommand('never-blocked@s.whatsapp.net', 'unblock');
  assert.match(reply, /not currently blocked/);
});

test('unblock reports failure without clearing the block when actions.unblock throws', async () => {
  const contact = 'unblock-fails@s.whatsapp.net';
  createBlock(contact, Date.now() + 60_000);
  const override = createManualOverride({
    unblock: async () => {
      throw new Error('WhatsApp call failed');
    },
  });

  const reply = await override.runCommand(contact, 'unblock');
  assert.match(reply, /Unblock failed/);
  assert.ok(override.getStatus(contact).block, 'block should still be active after a failed unblock call');
});

test('unblock is a no-op (not a duplicate WhatsApp call) when already resolved by something else', async () => {
  const contact = 'already-unblocked@s.whatsapp.net';
  const blockId = createBlock(contact, Date.now() + 60_000);
  const { markUnblocked } = await import('../store/blocks.js');
  markUnblocked(blockId); // simulate a concurrent scheduler tick / second request having already resolved it

  const unblockCalls = [];
  const override = createManualOverride({ unblock: async (jid) => unblockCalls.push(jid) });

  // getActiveBlock no longer finds it once markUnblocked has resolved it, so this exercises the plain no-op path.
  const reply = await override.runCommand(contact, 'unblock');
  assert.match(reply, /not currently blocked/);
  assert.deepEqual(unblockCalls, []);
});

test('two concurrent unblock calls for the same contact only invoke actions.unblock once', async () => {
  const contact = 'concurrent-unblock@s.whatsapp.net';
  createBlock(contact, Date.now() + 60_000);
  let resolveUnblock;
  const unblockCalls = [];
  const override = createManualOverride({
    unblock: async (jid) => {
      unblockCalls.push(jid);
      await new Promise((resolve) => (resolveUnblock = resolve));
    },
  });

  const first = override.runCommand(contact, 'unblock');
  await new Promise((resolve) => setImmediate(resolve)); // let the first call reach the in-flight guard
  const second = override.runCommand(contact, 'unblock');

  const secondReply = await second;
  assert.match(secondReply, /already in progress/);

  resolveUnblock();
  await first;

  assert.deepEqual(unblockCalls, [contact]);
});

test('concurrent unblock calls for different contacts do not block each other', async () => {
  const contactA = 'concurrent-a@s.whatsapp.net';
  const contactB = 'concurrent-b@s.whatsapp.net';
  createBlock(contactA, Date.now() + 60_000);
  createBlock(contactB, Date.now() + 60_000);
  const unblockCalls = [];
  const override = createManualOverride({ unblock: async (jid) => unblockCalls.push(jid) });

  await Promise.all([override.runCommand(contactA, 'unblock'), override.runCommand(contactB, 'unblock')]);

  assert.deepEqual(unblockCalls.sort(), [contactA, contactB].sort());
});

test('an unrecognized command returns null', async () => {
  const override = createManualOverride({ unblock: async () => {} });
  assert.equal(await override.runCommand(TARGET, 'nonsense'), null);
});
