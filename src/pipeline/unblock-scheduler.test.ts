import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';

process.env.DB_PATH = 'data/test-unblock-scheduler.test.sqlite';

const { runTick, startUnblockScheduler } = await import('./unblock-scheduler.ts');
const { createBlock, getActiveBlock, markUnblocked } = await import('../store/blocks.ts');
const { setSetting } = await import('../store/settings.ts');

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

test('startUnblockScheduler polls at the configured interval and unblocks expired blocks', async () => {
  setSetting('UNBLOCK_POLL_INTERVAL_MS', '10');
  const contact = 'ivan@s.whatsapp.net';
  createBlock(contact, Date.now() - 1000);
  const unblocked = [];

  const scheduler = startUnblockScheduler({ unblock: async (jid) => unblocked.push(jid) });
  await new Promise((resolve) => setTimeout(resolve, 50));
  await scheduler.stop();

  assert.ok(unblocked.includes(contact));
});

test('stop() suppresses the in-flight tick\'s own reschedule, leaving no dangling timer', async () => {
  setSetting('UNBLOCK_POLL_INTERVAL_MS', '10');
  let tickCount = 0;
  const scheduler = startUnblockScheduler({ unblock: async () => { tickCount += 1; } });

  await new Promise((resolve) => setTimeout(resolve, 30)); // let a few ticks happen
  await scheduler.stop();
  const countAtStop = tickCount;

  // Long enough that a stray reschedule from the in-flight tick's own
  // `finally` — the exact race stop()'s `stopped` flag guards against —
  // would have fired again by now if it weren't suppressed.
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(tickCount, countAtStop, 'no further ticks should fire once stop() has resolved');
});
