import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';

// Set before the dynamic imports below, so moderation-pipeline.js's
// module-level `const STRIKE_THRESHOLD = Number(process.env.STRIKE_THRESHOLD ?? 3)` picks this up.
process.env.DB_PATH = 'data/test-moderation-pipeline.test.sqlite';
process.env.STRIKE_THRESHOLD = '2';

const { handleBurst } = await import('./moderation-pipeline.js');
const { getAuditLog } = await import('../store/audit-log.js');
const { createBlock, getActiveBlock } = await import('../store/blocks.js');

after(() => {
  for (const ext of ['', '-wal', '-shm']) rmSync(`${process.env.DB_PATH}${ext}`, { force: true });
});

const okPass = async () => ({ ok: true, flagged: false, category: 'none', reason: 'fine' });
const okFlag = async () => ({ ok: true, flagged: true, category: 'harassment', reason: 'bad' });
const noopActions = {
  deleteForMe: async () => {},
  sendWarning: async () => {},
  block: async () => {},
};

function burst(contactId, texts) {
  return {
    contactId,
    messages: texts.map((text, i) => ({ text, key: { id: `${contactId}-${i}` }, timestamp: Date.now() })),
  };
}

test('classifier ok:false fails open: no strike, no action, logged as classifier_error', async () => {
  const contact = 'alice@s.whatsapp.net';
  const classify = async () => ({ ok: false, error: 'Ollama unreachable' });
  let deleteForMeCalled = false;

  const { strikeCount } = await handleBurst(burst(contact, ['hello']), {
    ...noopActions,
    deleteForMe: async () => {
      deleteForMeCalled = true;
    },
    classify,
  });

  assert.equal(strikeCount, 0);
  assert.equal(deleteForMeCalled, false);
  const [entry] = getAuditLog(contact);
  assert.equal(entry.action, 'classifier_error');
});

test('a passed message decays the strike count and logs action: none', async () => {
  const contact = 'bob@s.whatsapp.net';

  const { strikeCount } = await handleBurst(burst(contact, ['hey there']), { ...noopActions, classify: okPass });

  assert.equal(strikeCount, 0);
  const [entry] = getAuditLog(contact);
  assert.equal(entry.action, 'none');
});

test('a flagged message deletes+warns, records a strike, and logs both the "them" and "me" rows', async () => {
  const contact = 'carol@s.whatsapp.net';
  const deleted = [];
  const warned = [];

  const { strikeCount } = await handleBurst(burst(contact, ['bad message']), {
    deleteForMe: async (jid) => deleted.push(jid),
    sendWarning: async (jid) => warned.push(jid),
    block: async () => {},
    classify: okFlag,
  });

  assert.equal(strikeCount, 1);
  assert.deepEqual(deleted, [contact]);
  assert.deepEqual(warned, [contact]);

  const log = getAuditLog(contact);
  assert.equal(log.length, 2);
  const [warningRow, flaggedRow] = log; // newest first
  assert.equal(warningRow.direction, 'me');
  assert.equal(warningRow.action, 'warning_sent');
  assert.equal(flaggedRow.direction, 'them');
  assert.equal(flaggedRow.action, 'delete+warn');
});

test('deleteForMe/sendWarning throwing logs action_failed and does not record a strike', async () => {
  const contact = 'dave@s.whatsapp.net';

  const { strikeCount } = await handleBurst(burst(contact, ['bad message']), {
    deleteForMe: async () => {
      throw new Error('chatModify failed');
    },
    sendWarning: async () => {},
    block: async () => {},
    classify: okFlag,
  });

  assert.equal(strikeCount, 0);
  const [entry] = getAuditLog(contact);
  assert.equal(entry.action, 'action_failed');
});

test('crossing STRIKE_THRESHOLD triggers block()', async () => {
  const contact = 'erin@s.whatsapp.net';
  let blockedJid;

  // STRIKE_THRESHOLD=2 (set at the top of this file) — two flagged messages in one burst cross it.
  await handleBurst(burst(contact, ['bad one', 'bad two']), {
    deleteForMe: async () => {},
    sendWarning: async () => {},
    block: async (jid) => {
      blockedJid = jid;
    },
    classify: okFlag,
  });

  assert.equal(blockedJid, contact);
  assert.ok(getActiveBlock(contact));
});

test('a contact with an existing active block is not re-blocked', async () => {
  const contact = 'frank@s.whatsapp.net';
  createBlock(contact, Date.now() + 60_000);
  let blockCalled = false;

  await handleBurst(burst(contact, ['bad one', 'bad two']), {
    deleteForMe: async () => {},
    sendWarning: async () => {},
    block: async () => {
      blockCalled = true;
    },
    classify: okFlag,
  });

  assert.equal(blockCalled, false);
});

test('bursts for the same contact are serialized: a slow classify does not let a second burst interleave', async () => {
  const contact = 'grace@s.whatsapp.net';
  const order = [];
  let releaseFirst;
  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve;
  });

  const first = handleBurst(burst(contact, ['first']), {
    ...noopActions,
    classify: async () => {
      order.push('first-start');
      await firstGate;
      order.push('first-end');
      return okPass();
    },
  });

  // Give the first burst a chance to actually start before queuing the second.
  await new Promise((resolve) => setImmediate(resolve));

  const second = handleBurst(burst(contact, ['second']), {
    ...noopActions,
    classify: async () => {
      order.push('second-start');
      return okPass();
    },
  });

  releaseFirst();
  await Promise.all([first, second]);

  assert.deepEqual(order, ['first-start', 'first-end', 'second-start']);
});
