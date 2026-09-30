import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';

process.env.DB_PATH = 'data/test-moderation-pipeline.test.sqlite';

const { handleBurst } = await import('./moderation-pipeline.ts');
const { getAuditLog } = await import('../store/audit-log.ts');
const { createBlock, getActiveBlock } = await import('../store/blocks.ts');
const { addMonitored, setEscalationEnabled, setContext } = await import('../store/monitored-contacts.ts');
const { setSetting } = await import('../store/settings.ts');

setSetting('STRIKE_THRESHOLD', '2');
setSetting('WARNING_MESSAGE', 'TEST_FALLBACK_WARNING');
// Off so back-to-back bursts each earn their own strike; the cooldown itself has its own tests below.
setSetting('STRIKE_COOLDOWN_MS', '0');
// Off by default here so the bulk of this suite exercises real
// delete/warn/strike/block behavior; shadow mode itself is covered by its
// own test below, which flips this back on for the duration of that test.
setSetting('SHADOW_MODE', '0');

after(() => {
  for (const ext of ['', '-wal', '-shm']) rmSync(`${process.env.DB_PATH}${ext}`, { force: true });
});

const okPass = async () => ({ ok: true, flagged: false, category: 'none', reason: 'fine' });
const okFlag = async () => ({ ok: true, flagged: true, category: 'harassment', reason: 'bad' });
const okWarning = async () => ({ ok: true, text: 'Stop that — this is an automated system and you will be blocked.' });
const noopActions = {
  deleteForMe: async () => {},
  sendWarning: async () => {},
  block: async () => {},
  generateWarning: okWarning,
};

async function handleTwoViolations(contactId, actions) {
  await handleBurst(burst(contactId, ['bad one']), actions);
  return handleBurst(burst(contactId, ['bad two']), actions);
}

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

test('shadow mode classifies and logs a flagged message but takes no action', async () => {
  const contact = 'shadow@s.whatsapp.net';
  let acted = false;
  const shadowActions = {
    deleteForMe: async () => {
      acted = true;
    },
    sendWarning: async () => {
      acted = true;
    },
    block: async () => {
      acted = true;
    },
    generateWarning: okWarning,
  };

  setSetting('SHADOW_MODE', '1');
  try {
    const { strikeCount } = await handleBurst(burst(contact, ['bad message']), { ...shadowActions, classify: okFlag });

    assert.equal(strikeCount, 0);
    assert.equal(acted, false);
    const [entry] = getAuditLog(contact);
    assert.equal(entry.action, 'shadow');
  } finally {
    setSetting('SHADOW_MODE', '0');
  }
});

test("a monitored contact's roster context is passed to classify as contactContext", async () => {
  const contact = 'ivy@s.whatsapp.net';
  addMonitored(contact);
  setContext(contact, 'This is my landlord — be lenient about payment disputes.');
  const seenInputs = [];
  const classify = async (input) => {
    seenInputs.push(input);
    return okPass();
  };

  await handleBurst(burst(contact, ['when is rent due?']), { ...noopActions, classify });

  assert.equal(seenInputs.length, 1);
  assert.equal(seenInputs[0].contactContext, 'This is my landlord — be lenient about payment disputes.');
});

test('a contact with no roster context passes contactContext: undefined to classify', async () => {
  const contact = 'jack@s.whatsapp.net';
  addMonitored(contact);
  const seenInputs = [];
  const classify = async (input) => {
    seenInputs.push(input);
    return okPass();
  };

  await handleBurst(burst(contact, ['hey']), { ...noopActions, classify });

  assert.equal(seenInputs[0].contactContext, undefined);
});

test('a passed message logs action: none and leaves the strike count alone', async () => {
  const contact = 'bob@s.whatsapp.net';

  const { strikeCount } = await handleBurst(burst(contact, ['hey there']), { ...noopActions, classify: okPass });

  assert.equal(strikeCount, 0);
  const [entry] = getAuditLog(contact);
  assert.equal(entry.action, 'none');
});

test('a flagged message deletes+warns with the generated text, records a strike, and logs both the "them" and "me" rows', async () => {
  const contact = 'carol@s.whatsapp.net';
  const deleted = [];
  const warned = [];

  const { strikeCount } = await handleBurst(burst(contact, ['bad message']), {
    deleteForMe: async (jid) => deleted.push(jid),
    sendWarning: async (jid, text) => warned.push({ jid, text }),
    block: async () => {},
    classify: okFlag,
    generateWarning: okWarning,
  });

  assert.equal(strikeCount, 1);
  assert.deepEqual(deleted, [contact]);
  assert.deepEqual(warned, [{ jid: contact, text: (await okWarning()).text }]);

  const log = getAuditLog(contact);
  assert.equal(log.length, 2);
  const [warningRow, flaggedRow] = log; // newest first
  assert.equal(warningRow.direction, 'me');
  assert.equal(warningRow.action, 'warning_sent');
  assert.equal(warningRow.message, (await okWarning()).text);
  assert.equal(flaggedRow.direction, 'them');
  assert.equal(flaggedRow.action, 'delete+warn');
});

test('warning generation failing open falls back to the static WARNING_MESSAGE, and the warning is still sent', async () => {
  const contact = 'judy@s.whatsapp.net';
  const warned = [];

  await handleBurst(burst(contact, ['bad message']), {
    deleteForMe: async () => {},
    sendWarning: async (jid, text) => warned.push(text),
    block: async () => {},
    classify: okFlag,
    generateWarning: async () => ({ ok: false, error: 'Ollama unreachable' }),
  });

  assert.deepEqual(warned, ['TEST_FALLBACK_WARNING']);
  const [warningRow] = getAuditLog(contact);
  assert.equal(warningRow.message, 'TEST_FALLBACK_WARNING');
});

test('deleteForMe throwing logs delete_failed and does not record a strike', async () => {
  const contact = 'dave@s.whatsapp.net';

  const { strikeCount } = await handleBurst(burst(contact, ['bad message']), {
    deleteForMe: async () => {
      throw new Error('chatModify failed');
    },
    sendWarning: async () => {},
    block: async () => {},
    classify: okFlag,
    generateWarning: okWarning,
  });

  assert.equal(strikeCount, 0);
  const [entry] = getAuditLog(contact);
  assert.equal(entry.action, 'delete_failed');
});

test('sendWarning throwing (deleteForMe succeeding) logs warn_failed distinctly, not a generic action_failed', async () => {
  const contact = 'dave2@s.whatsapp.net';
  const deleted = [];

  const { strikeCount } = await handleBurst(burst(contact, ['bad message']), {
    deleteForMe: async (jid) => deleted.push(jid),
    sendWarning: async () => {
      throw new Error('sendMessage failed');
    },
    block: async () => {},
    classify: okFlag,
    generateWarning: okWarning,
  });

  assert.deepEqual(deleted, [contact]);
  assert.equal(strikeCount, 0);
  const [entry] = getAuditLog(contact);
  assert.equal(entry.action, 'warn_failed');
});

test('crossing STRIKE_THRESHOLD triggers block()', async () => {
  const contact = 'erin@s.whatsapp.net';
  addMonitored(contact); // escalation defaults to enabled once a contact is actually on the roster
  let blockedJid;

  // STRIKE_THRESHOLD=2 (set at the top of this file) — two flagged bursts cross it.
  await handleTwoViolations(contact, {
    deleteForMe: async () => {},
    sendWarning: async () => {},
    block: async (jid) => {
      blockedJid = jid;
    },
    classify: okFlag,
    generateWarning: okWarning,
  });

  assert.equal(blockedJid, contact);
  assert.ok(getActiveBlock(contact));
});

test('STRIKE_THRESHOLD is captured once per burst, so a mid-burst change does not affect this burst\'s block decision', async () => {
  const contact = 'mallory@s.whatsapp.net';
  addMonitored(contact);
  let blockCalled = false;

  // Simulates an operator raising STRIKE_THRESHOLD in the Settings panel
  // while this burst is still being processed — the second burst's
  // flagged message still crosses the threshold captured at the start of the burst (2),
  // even though the setting has since changed to something no longer
  // crossed by strikeCount=2.
  const generateWarning = async (input) => {
    setSetting('STRIKE_THRESHOLD', '100');
    return okWarning(input);
  };

  const actions = {
    deleteForMe: async () => {},
    sendWarning: async () => {},
    block: async () => {
      blockCalled = true;
    },
    classify: okFlag,
  };
  await handleBurst(burst(contact, ['bad one']), { ...actions, generateWarning: okWarning });
  await handleBurst(burst(contact, ['bad two']), { ...actions, generateWarning });

  assert.equal(blockCalled, true);
  assert.ok(getActiveBlock(contact));

  setSetting('STRIKE_THRESHOLD', '2'); // restore for every test after this one
});

test('a contact with an existing active block is not re-blocked', async () => {
  const contact = 'frank@s.whatsapp.net';
  createBlock(contact, Date.now() + 60_000);
  let blockCalled = false;

  await handleTwoViolations(contact, {
    deleteForMe: async () => {},
    sendWarning: async () => {},
    block: async () => {
      blockCalled = true;
    },
    classify: okFlag,
    generateWarning: okWarning,
  });

  assert.equal(blockCalled, false);
});

test('escalation disabled: strikes/delete/warn/audit-log still happen, but block() is never called', async () => {
  const contact = 'heidi@s.whatsapp.net';
  addMonitored(contact);
  setEscalationEnabled(contact, false);
  let blockCalled = false;

  const { strikeCount } = await handleTwoViolations(contact, {
    deleteForMe: async () => {},
    sendWarning: async () => {},
    block: async () => {
      blockCalled = true;
    },
    classify: okFlag,
    generateWarning: okWarning,
  });

  assert.equal(strikeCount, 2);
  assert.equal(blockCalled, false);
  assert.equal(getActiveBlock(contact), undefined);
  const log = getAuditLog(contact);
  assert.ok(log.some((row) => row.action === 'delete+warn'));
});

test('a contact with no roster row at all (e.g. removed mid-burst) fails toward not blocking', async () => {
  const contact = 'ivan@s.whatsapp.net';
  let blockCalled = false;

  const { strikeCount } = await handleTwoViolations(contact, {
    deleteForMe: async () => {},
    sendWarning: async () => {},
    block: async () => {
      blockCalled = true;
    },
    classify: okFlag,
    generateWarning: okWarning,
  });

  assert.equal(strikeCount, 2);
  assert.equal(blockCalled, false);
  assert.equal(getActiveBlock(contact), undefined);
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

test('several flagged messages in one burst earn one strike and one warning, but are all deleted', async () => {
  const contact = 'burst-flood@s.whatsapp.net';
  const deleted = [];
  const warned = [];

  const { strikeCount } = await handleBurst(burst(contact, ['bad one', 'bad two', 'bad three']), {
    ...noopActions,
    deleteForMe: async (jid, key) => deleted.push(key.id),
    sendWarning: async (jid, text) => warned.push(text),
    classify: okFlag,
  });

  assert.equal(strikeCount, 1);
  assert.equal(deleted.length, 3);
  assert.equal(warned.length, 1);
  const actions = getAuditLog(contact).map((row) => row.action);
  assert.equal(actions.filter((action) => action === 'delete+warn').length, 1);
  assert.equal(actions.filter((action) => action === 'delete').length, 2);
});

test('a flagged burst within STRIKE_COOLDOWN_MS of the last warning is deleted without a new strike or warning', async () => {
  const contact = 'cooldown@s.whatsapp.net';
  const warned = [];
  const actions = { ...noopActions, sendWarning: async (jid, text) => warned.push(text), classify: okFlag };

  setSetting('STRIKE_COOLDOWN_MS', '60000');
  try {
    await handleBurst(burst(contact, ['first']), actions);
    const { strikeCount } = await handleBurst(burst(contact, ['second']), actions);

    assert.equal(strikeCount, 1);
    assert.equal(warned.length, 1);
    assert.equal(getAuditLog(contact)[0].action, 'delete');
  } finally {
    setSetting('STRIKE_COOLDOWN_MS', '0');
  }
});

test('a failing deleteForMe on a cooldown-covered message logs delete_failed and still adds no strike', async () => {
  const contact = 'cooldown-fail@s.whatsapp.net';
  setSetting('STRIKE_COOLDOWN_MS', '60000');
  try {
    await handleBurst(burst(contact, ['first']), { ...noopActions, classify: okFlag });
    const { strikeCount } = await handleBurst(burst(contact, ['second']), {
      ...noopActions,
      deleteForMe: async () => {
        throw new Error('chatModify failed');
      },
      classify: okFlag,
    });

    assert.equal(strikeCount, 1);
    assert.equal(getAuditLog(contact)[0].action, 'delete_failed');
  } finally {
    setSetting('STRIKE_COOLDOWN_MS', '0');
  }
});

test('a clean burst after a violation does not erase its strike', async () => {
  const contact = 'decay@s.whatsapp.net';
  await handleTwoViolations(contact, { ...noopActions, classify: okFlag });

  const { strikeCount } = await handleBurst(burst(contact, ['ok', 'fine', 'thanks']), { ...noopActions, classify: okPass });

  assert.equal(strikeCount, 2);
});
