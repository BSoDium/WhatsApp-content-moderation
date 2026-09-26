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

test('!pause and !resume toggle isPaused', async () => {
  const override = createManualOverride({ targetContactId: TARGET, unblock: async () => {} });
  assert.equal(override.isPaused(), false);

  await override.runCommand('pause');
  assert.equal(override.isPaused(), true);

  await override.runCommand('resume');
  assert.equal(override.isPaused(), false);
});

test('status reports pause state, strikes, and block status', async () => {
  const contact = 'status-check@s.whatsapp.net';
  recordStrike(contact);
  recordStrike(contact);
  const override = createManualOverride({ targetContactId: contact, unblock: async () => {} });

  const reply = await override.runCommand('status');
  assert.match(reply, /Paused: false/);
  assert.match(reply, /Strikes: 2/);
  assert.match(reply, /not blocked/);
});

test('unblock calls actions.unblock and clears the active block', async () => {
  const contact = 'blocked-contact@s.whatsapp.net';
  createBlock(contact, Date.now() + 60_000);
  const unblocked = [];
  const override = createManualOverride({
    targetContactId: contact,
    unblock: async (jid) => unblocked.push(jid),
  });

  const reply = await override.runCommand('unblock');

  assert.deepEqual(unblocked, [contact]);
  assert.match(reply, /unblocked/i);

  const status = await override.runCommand('status');
  assert.match(status, /not blocked/);
});

test('unblock on a contact with no active block is a no-op', async () => {
  const override = createManualOverride({ targetContactId: 'never-blocked@s.whatsapp.net', unblock: async () => {} });
  const reply = await override.runCommand('unblock');
  assert.match(reply, /not currently blocked/);
});

test('unblock reports failure without clearing the block when actions.unblock throws', async () => {
  const contact = 'unblock-fails@s.whatsapp.net';
  createBlock(contact, Date.now() + 60_000);
  const override = createManualOverride({
    targetContactId: contact,
    unblock: async () => {
      throw new Error('WhatsApp call failed');
    },
  });

  const reply = await override.runCommand('unblock');
  assert.match(reply, /Unblock failed/);

  const status = await override.runCommand('status');
  assert.match(status, /blocked until/);
});

test('an unrecognized command returns null', async () => {
  const override = createManualOverride({ targetContactId: TARGET, unblock: async () => {} });
  assert.equal(await override.runCommand('nonsense'), null);
});
