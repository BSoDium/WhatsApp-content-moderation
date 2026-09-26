import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';

process.env.DB_PATH = 'data/test-unblock-scheduler.test.sqlite';

const { runTick } = await import('./unblock-scheduler.js');
const { createBlock, getActiveBlock, markUnblocked } = await import('../store/blocks.js');

after(() => {
  for (const ext of ['', '-wal', '-shm']) rmSync(`${process.env.DB_PATH}${ext}`, { force: true });
});

test('unblocks an expired block and marks it resolved', async () => {
  const contact = 'alice@s.whatsapp.net';
  createBlock(contact, Date.now() - 1000);
  const unblocked = [];

  await runTick({ unblock: async (jid) => unblocked.push(jid) });

  assert.deepEqual(unblocked, [contact]);
  assert.equal(getActiveBlock(contact), undefined);
});

test('leaves a not-yet-expired block alone', async () => {
  const contact = 'bob@s.whatsapp.net';
  createBlock(contact, Date.now() + 60_000);
  const unblocked = [];

  await runTick({ unblock: async (jid) => unblocked.push(jid) });

  assert.deepEqual(unblocked, []);
  assert.ok(getActiveBlock(contact));
});

test('actions.unblock throwing leaves the block unresolved for the next tick to retry', async () => {
  const contact = 'carol@s.whatsapp.net';
  createBlock(contact, Date.now() - 1000);

  await runTick({
    unblock: async () => {
      throw new Error('WhatsApp call failed');
    },
  });

  const active = getActiveBlock(contact);
  assert.ok(active, 'block should still be active after a failed unblock call');
  markUnblocked(active.id); // clean up so later tests' getExpiredBlocks() sweeps don't pick this row back up
});

test('a block already marked unblocked (overlapping tick) is skipped without erroring', async () => {
  const contact = 'dave@s.whatsapp.net';
  const blockId = createBlock(contact, Date.now() - 1000);
  markUnblocked(blockId); // simulate a concurrent tick having already resolved it

  const unblocked = [];
  await assert.doesNotReject(runTick({ unblock: async (jid) => unblocked.push(jid) }));

  // getExpiredBlocks only returns unresolved rows, so a pre-resolved block
  // is never even handed to actions.unblock on a later tick.
  assert.ok(!unblocked.includes(contact));
});

test('processes every expired block in one pass', async () => {
  const contacts = ['erin@s.whatsapp.net', 'frank@s.whatsapp.net'];
  for (const contact of contacts) createBlock(contact, Date.now() - 1000);

  const unblocked = [];
  await runTick({ unblock: async (jid) => unblocked.push(jid) });

  assert.deepEqual(unblocked.sort(), contacts.sort());
});

test('one contact throwing does not stop the rest of the batch from unblocking', async () => {
  const failing = 'grace@s.whatsapp.net';
  const succeeding = 'heidi@s.whatsapp.net';
  createBlock(failing, Date.now() - 1000);
  createBlock(succeeding, Date.now() - 1000);

  const unblocked = [];
  await runTick({
    unblock: async (jid) => {
      if (jid === failing) throw new Error('boom');
      unblocked.push(jid);
    },
  });

  assert.ok(getActiveBlock(failing), 'the failing contact should remain blocked for retry');
  assert.equal(getActiveBlock(succeeding), undefined);
  assert.deepEqual(unblocked, [succeeding]);
});
