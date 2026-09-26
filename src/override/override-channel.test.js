import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';

process.env.DB_PATH = 'data/test-override-channel.test.sqlite';

const { parseOverrideCommand, extractOverrideMessage, createOverrideChannel } = await import('./override-channel.js');
const { createBlock } = await import('../store/blocks.js');
const { recordStrike } = await import('../store/strikes.js');

after(() => {
  for (const ext of ['', '-wal', '-shm']) rmSync(`${process.env.DB_PATH}${ext}`, { force: true });
});

const SELF = 'me@s.whatsapp.net';
const TARGET = 'target@s.whatsapp.net';

function selfMsg(text, overrides = {}) {
  return {
    key: { remoteJid: SELF, fromMe: true, id: 'ABC' },
    message: { conversation: text },
    ...overrides,
  };
}

test('parseOverrideCommand recognizes each command, case-insensitively, ignoring trailing words', () => {
  assert.equal(parseOverrideCommand('!pause'), 'pause');
  assert.equal(parseOverrideCommand('!RESUME'), 'resume');
  assert.equal(parseOverrideCommand('!Unblock now please'), 'unblock');
  assert.equal(parseOverrideCommand('  !status  '), 'status');
});

test('parseOverrideCommand rejects anything else', () => {
  assert.equal(parseOverrideCommand('hello'), null);
  assert.equal(parseOverrideCommand('pause'), null);
  assert.equal(parseOverrideCommand(''), null);
});

test('extractOverrideMessage accepts a self-sent message in the self-chat', () => {
  assert.equal(extractOverrideMessage(selfMsg('!status'), SELF), '!status');
});

test('extractOverrideMessage rejects a message not sent by us', () => {
  const msg = selfMsg('!status', { key: { remoteJid: SELF, fromMe: false, id: 'X' } });
  assert.equal(extractOverrideMessage(msg, SELF), null);
});

test('extractOverrideMessage rejects a message outside the self-chat (e.g. the moderated contact)', () => {
  const msg = selfMsg('!status', { key: { remoteJid: TARGET, fromMe: true, id: 'X' } });
  assert.equal(extractOverrideMessage(msg, SELF), null);
});

test('extractOverrideMessage rejects when selfJid is not yet known', () => {
  assert.equal(extractOverrideMessage(selfMsg('!status'), undefined), null);
});

test('extractOverrideMessage rejects non-notify sync/append traffic', () => {
  assert.equal(extractOverrideMessage(selfMsg('!status'), SELF, 'append'), null);
});

test('!pause and !resume toggle isPaused', async () => {
  const channel = createOverrideChannel({ targetContactId: TARGET, unblock: async () => {} });
  assert.equal(channel.isPaused(), false);

  await channel.runCommand('pause');
  assert.equal(channel.isPaused(), true);

  await channel.runCommand('resume');
  assert.equal(channel.isPaused(), false);
});

test('!status reports pause state, strikes, and block status', async () => {
  const contact = 'status-check@s.whatsapp.net';
  recordStrike(contact);
  recordStrike(contact);
  const channel = createOverrideChannel({ targetContactId: contact, unblock: async () => {} });

  const reply = await channel.runCommand('status');
  assert.match(reply, /Paused: false/);
  assert.match(reply, /Strikes: 2/);
  assert.match(reply, /not blocked/);
});

test('!unblock calls actions.unblock and clears the active block', async () => {
  const contact = 'blocked-contact@s.whatsapp.net';
  createBlock(contact, Date.now() + 60_000);
  const unblocked = [];
  const channel = createOverrideChannel({
    targetContactId: contact,
    unblock: async (jid) => unblocked.push(jid),
  });

  const reply = await channel.runCommand('unblock');

  assert.deepEqual(unblocked, [contact]);
  assert.match(reply, /unblocked/i);

  const status = await channel.runCommand('status');
  assert.match(status, /not blocked/);
});

test('!unblock on a contact with no active block is a no-op', async () => {
  const channel = createOverrideChannel({ targetContactId: 'never-blocked@s.whatsapp.net', unblock: async () => {} });
  const reply = await channel.runCommand('unblock');
  assert.match(reply, /not currently blocked/);
});

test('!unblock reports failure without clearing the block when actions.unblock throws', async () => {
  const contact = 'unblock-fails@s.whatsapp.net';
  createBlock(contact, Date.now() + 60_000);
  const channel = createOverrideChannel({
    targetContactId: contact,
    unblock: async () => {
      throw new Error('WhatsApp call failed');
    },
  });

  const reply = await channel.runCommand('unblock');
  assert.match(reply, /Unblock failed/);

  const status = await channel.runCommand('status');
  assert.match(status, /blocked until/);
});

test('an unrecognized command returns null', async () => {
  const channel = createOverrideChannel({ targetContactId: TARGET, unblock: async () => {} });
  assert.equal(await channel.runCommand('nonsense'), null);
});
