import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';

process.env.DB_PATH = 'data/test-call-pipeline.test.sqlite';

const { handleCallEvent } = await import('./call-pipeline.ts');
const { getAuditLog, logMessage } = await import('../store/audit-log.ts');
const { getCallState } = await import('../store/call-strikes.ts');
const { createBlock, getActiveBlock } = await import('../store/blocks.ts');
const { addMonitored, setEscalationEnabled, setCallNuisanceThreshold } = await import('../store/monitored-contacts.ts');
const { setSetting } = await import('../store/settings.ts');

setSetting('NUISANCE_CALL_THRESHOLD', '2');
setSetting('NUISANCE_CALL_STRIKE_THRESHOLD', '2');
setSetting('NUISANCE_CALL_AUTO_REJECT', '1');
setSetting('NUISANCE_CALL_WARNING_MESSAGE', 'TEST_WARNING strike={strikes} threshold={threshold}');
setSetting('SHADOW_MODE', '0');

after(() => {
  for (const ext of ['', '-wal', '-shm']) rmSync(`${process.env.DB_PATH}${ext}`, { force: true });
});

let nextCallId = 0;
function call(contactId, status, overrides = {}) {
  nextCallId += 1;
  return {
    contactId,
    call: {
      chatId: contactId,
      from: contactId,
      id: `call-${nextCallId}`,
      date: new Date(),
      isVideo: false,
      status,
      offline: false,
      ...overrides,
    },
  };
}

const noopActions = {
  rejectCall: async () => {},
  sendWarning: async () => {},
  block: async () => {},
};

test('an offer under the nuisance threshold takes no action and logs call_received', async () => {
  const contact = 'alice@s.whatsapp.net';
  let acted = false;
  await handleCallEvent(call(contact, 'offer'), {
    rejectCall: async () => {
      acted = true;
    },
    sendWarning: async () => {
      acted = true;
    },
    block: async () => {
      acted = true;
    },
  });

  assert.equal(acted, false);
  assert.deepEqual(getCallState(contact), { unansweredCount: 0, strikeCount: 0 });
  const [entry] = getAuditLog(contact);
  assert.equal(entry.action, 'call_received');
});

test('timeout increments the unanswered count and logs call_unanswered', async () => {
  const contact = 'bob@s.whatsapp.net';
  await handleCallEvent(call(contact, 'timeout'), noopActions);
  await handleCallEvent(call(contact, 'timeout'), noopActions);

  assert.deepEqual(getCallState(contact), { unansweredCount: 2, strikeCount: 0 });
  const [entry] = getAuditLog(contact);
  assert.equal(entry.action, 'call_unanswered');
});

test('a manually declined call (reject we did not initiate) counts as unanswered', async () => {
  const contact = 'carol@s.whatsapp.net';
  await handleCallEvent(call(contact, 'reject'), noopActions);

  assert.deepEqual(getCallState(contact), { unansweredCount: 1, strikeCount: 0 });
  const [entry] = getAuditLog(contact);
  assert.equal(entry.action, 'call_unanswered');
});

test('an offer at/over the threshold rejects and warns, recording a call strike', async () => {
  const contact = 'dave@s.whatsapp.net';
  await handleCallEvent(call(contact, 'timeout'), noopActions);
  await handleCallEvent(call(contact, 'timeout'), noopActions); // unansweredCount now 2, at NUISANCE_CALL_THRESHOLD

  const rejected = [];
  const warned = [];
  await handleCallEvent(call(contact, 'offer'), {
    rejectCall: async (callId, callFrom) => rejected.push([callId, callFrom]),
    sendWarning: async (contactId, text) => warned.push([contactId, text]),
    block: async () => {},
  });

  assert.equal(rejected.length, 1);
  assert.deepEqual(warned, [[contact, 'TEST_WARNING strike=1 threshold=2']]);
  assert.deepEqual(getCallState(contact), { unansweredCount: 2, strikeCount: 1 });

  const log = getAuditLog(contact);
  assert.equal(log[0].action, 'call_nuisance_warned');
});

test("the 'reject' event our own rejectCall triggers is not double-counted as unanswered", async () => {
  const contact = 'erin@s.whatsapp.net';
  await handleCallEvent(call(contact, 'timeout'), noopActions);
  await handleCallEvent(call(contact, 'timeout'), noopActions);

  const offerEvent = call(contact, 'offer');
  const rejectedCallId = offerEvent.call.id;
  await handleCallEvent(offerEvent, {
    rejectCall: async () => {},
    sendWarning: async () => {},
    block: async () => {},
  });
  assert.deepEqual(getCallState(contact), { unansweredCount: 2, strikeCount: 1 });

  // The reject echo Baileys sends back for the call we just rejected ourselves.
  await handleCallEvent(call(contact, 'reject', { id: rejectedCallId }), noopActions);
  assert.deepEqual(getCallState(contact), { unansweredCount: 2, strikeCount: 1 }); // unchanged — not double-counted
});

test('rejectCall failing still sends the warning and records the strike, logging call_reject_failed', async () => {
  const contact = 'frank@s.whatsapp.net';
  await handleCallEvent(call(contact, 'timeout'), noopActions);
  await handleCallEvent(call(contact, 'timeout'), noopActions);

  const warned = [];
  await handleCallEvent(call(contact, 'offer'), {
    rejectCall: async () => {
      throw new Error('rejectCall failed');
    },
    sendWarning: async (contactId, text) => warned.push(text),
    block: async () => {},
  });

  assert.equal(warned.length, 1);
  assert.deepEqual(getCallState(contact), { unansweredCount: 2, strikeCount: 1 });
  const log = getAuditLog(contact);
  assert.ok(log.some((row) => row.action === 'call_reject_failed'));
  assert.ok(log.some((row) => row.action === 'call_nuisance_warned'));
});

test('sendWarning failing (rejectCall succeeding) does not record a strike, logging call_warn_failed', async () => {
  const contact = 'grace@s.whatsapp.net';
  await handleCallEvent(call(contact, 'timeout'), noopActions);
  await handleCallEvent(call(contact, 'timeout'), noopActions);

  await handleCallEvent(call(contact, 'offer'), {
    rejectCall: async () => {},
    sendWarning: async () => {
      throw new Error('sendMessage failed');
    },
    block: async () => {},
  });

  assert.deepEqual(getCallState(contact), { unansweredCount: 2, strikeCount: 0 });
  const [entry] = getAuditLog(contact);
  assert.equal(entry.action, 'call_warn_failed');
});

test('an answered call resets the unanswered count but keeps the strike count', async () => {
  const contact = 'heidi@s.whatsapp.net';
  await handleCallEvent(call(contact, 'timeout'), noopActions);
  await handleCallEvent(call(contact, 'timeout'), noopActions);
  await handleCallEvent(call(contact, 'offer'), noopActions); // records a strike

  await handleCallEvent(call(contact, 'accept'), noopActions);

  assert.deepEqual(getCallState(contact), { unansweredCount: 0, strikeCount: 1 });
  const [entry] = getAuditLog(contact);
  assert.equal(entry.action, 'call_answered');
});

test('SHADOW_MODE classifies as nuisance and logs call_shadow, but takes no action', async () => {
  const contact = 'ivy@s.whatsapp.net';
  await handleCallEvent(call(contact, 'timeout'), noopActions);
  await handleCallEvent(call(contact, 'timeout'), noopActions);

  let acted = false;
  setSetting('SHADOW_MODE', '1');
  try {
    await handleCallEvent(call(contact, 'offer'), {
      rejectCall: async () => {
        acted = true;
      },
      sendWarning: async () => {
        acted = true;
      },
      block: async () => {
        acted = true;
      },
    });
  } finally {
    setSetting('SHADOW_MODE', '0');
  }

  assert.equal(acted, false);
  assert.deepEqual(getCallState(contact), { unansweredCount: 2, strikeCount: 0 });
  const [entry] = getAuditLog(contact);
  assert.equal(entry.action, 'call_shadow');
});

test('crossing NUISANCE_CALL_STRIKE_THRESHOLD triggers block()', async () => {
  const contact = 'jack@s.whatsapp.net';
  addMonitored(contact); // escalation defaults to enabled once on the roster
  await handleCallEvent(call(contact, 'timeout'), noopActions);
  await handleCallEvent(call(contact, 'timeout'), noopActions);

  let blockedContactId;
  const actions = {
    rejectCall: async () => {},
    sendWarning: async () => {},
    block: async (contactId) => {
      blockedContactId = contactId;
    },
  };
  // NUISANCE_CALL_STRIKE_THRESHOLD=2 (set at the top of this file) — two nuisance offers cross it.
  await handleCallEvent(call(contact, 'offer'), actions);
  await handleCallEvent(call(contact, 'offer'), actions);

  assert.equal(blockedContactId, contact);
  assert.ok(getActiveBlock(contact));
});

test('escalation disabled: the strike/warning/reject still happen, but block() is never called', async () => {
  const contact = 'karl@s.whatsapp.net';
  addMonitored(contact);
  setEscalationEnabled(contact, false);
  await handleCallEvent(call(contact, 'timeout'), noopActions);
  await handleCallEvent(call(contact, 'timeout'), noopActions);

  let blockCalled = false;
  const actions = {
    rejectCall: async () => {},
    sendWarning: async () => {},
    block: async () => {
      blockCalled = true;
    },
  };
  await handleCallEvent(call(contact, 'offer'), actions);
  await handleCallEvent(call(contact, 'offer'), actions);

  assert.equal(blockCalled, false);
  assert.equal(getActiveBlock(contact), undefined);
});

test('a contact with an existing active block is not re-blocked', async () => {
  const contact = 'laura@s.whatsapp.net';
  createBlock(contact, Date.now() + 60_000);
  await handleCallEvent(call(contact, 'timeout'), noopActions);
  await handleCallEvent(call(contact, 'timeout'), noopActions);

  let blockCalled = false;
  const actions = {
    rejectCall: async () => {},
    sendWarning: async () => {},
    block: async () => {
      blockCalled = true;
    },
  };
  // Two nuisance offers to actually cross NUISANCE_CALL_STRIKE_THRESHOLD=2 — otherwise maybeBlockContact would short-circuit on the strike count alone, never reaching the getActiveBlock check this test is about.
  await handleCallEvent(call(contact, 'offer'), actions);
  await handleCallEvent(call(contact, 'offer'), actions);

  assert.equal(blockCalled, false);
});

test("a contact's own call-nuisance threshold override takes precedence over the global default", async () => {
  const contact = 'mallory@s.whatsapp.net';
  addMonitored(contact);
  setCallNuisanceThreshold(contact, 0); // stricter than the global default of 2 — the very first unanswered call is already nuisance

  let acted = false;
  await handleCallEvent(call(contact, 'offer'), {
    rejectCall: async () => {
      acted = true;
    },
    sendWarning: async () => {
      acted = true;
    },
    block: async () => {},
  });

  assert.equal(acted, true);
  assert.deepEqual(getCallState(contact), { unansweredCount: 0, strikeCount: 1 });
});

test('call events for the same contact are serialized: a slow rejectCall does not let a second event interleave', async () => {
  const contact = 'nora@s.whatsapp.net';
  // Two timeouts first so both offers below are already over the nuisance threshold and actually invoke rejectCall — 'timeout' itself is synchronous bookkeeping with no action to gate on.
  await handleCallEvent(call(contact, 'timeout'), noopActions);
  await handleCallEvent(call(contact, 'timeout'), noopActions);

  const order = [];
  let releaseFirst;
  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve;
  });

  const first = handleCallEvent(call(contact, 'offer'), {
    rejectCall: async () => {
      order.push('first-start');
      await firstGate;
      order.push('first-end');
    },
    sendWarning: async () => {},
    block: async () => {},
  });

  await new Promise((resolve) => setImmediate(resolve));

  const second = handleCallEvent(call(contact, 'offer'), {
    rejectCall: async () => {
      order.push('second-start');
    },
    sendWarning: async () => {},
    block: async () => {},
  });

  releaseFirst();
  await Promise.all([first, second]);

  assert.deepEqual(order, ['first-start', 'first-end', 'second-start']);
  assert.deepEqual(getCallState(contact), { unansweredCount: 2, strikeCount: 2 });
});

async function nuisanceOffer(contact, generateWarning) {
  await handleCallEvent(call(contact, 'timeout'), noopActions);
  await handleCallEvent(call(contact, 'timeout'), noopActions);
  const sent = [];
  await handleCallEvent(call(contact, 'offer'), {
    rejectCall: async () => {},
    sendWarning: async (_jid, text) => {
      sent.push(text);
    },
    block: async () => {},
    generateWarning,
  });
  return sent;
}

test('the nuisance warning is generated from the contact\'s recent chat messages', async () => {
  const contact = 'olga@s.whatsapp.net';
  logMessage({ contactId: contact, direction: 'them', message: 'Bonjour, tu peux me rappeler ?', classification: { ok: true, flagged: false, category: 'none', reason: '' }, action: 'none' });
  let received;

  const sent = await nuisanceOffer(contact, async (input) => {
    received = input;
    return { ok: true, text: 'Arrêtez d\'appeler, ceci est un système automatique.' };
  });

  assert.deepEqual(received.recentMessages, ['Bonjour, tu peux me rappeler ?']);
  assert.deepEqual(sent, ['Arrêtez d\'appeler, ceci est un système automatique.']);
});

test('a failed generation falls back to the configured static warning', async () => {
  const contact = 'paul@s.whatsapp.net';
  logMessage({ contactId: contact, direction: 'them', message: 'hello', classification: { ok: true, flagged: false, category: 'none', reason: '' }, action: 'none' });

  const sent = await nuisanceOffer(contact, async () => ({ ok: false, error: 'ollama down' }));

  assert.deepEqual(sent, ['TEST_WARNING strike=1 threshold=2']);
});

test('a contact with no chat history gets the static warning without calling the generator', async () => {
  const contact = 'quinn@s.whatsapp.net';
  let called = false;

  const sent = await nuisanceOffer(contact, async () => {
    called = true;
    return { ok: true, text: 'unused' };
  });

  assert.equal(called, false);
  assert.deepEqual(sent, ['TEST_WARNING strike=1 threshold=2']);
});

test('the nuisance warning that comes with the blocking strike is told a block follows', async () => {
  const contact = 'rita@s.whatsapp.net';
  addMonitored(contact);
  logMessage({ contactId: contact, direction: 'them', message: 'hello', classification: { ok: true, flagged: false, category: 'none', reason: '' }, action: 'none' });
  const flags = [];
  const generateWarning = async (input) => {
    flags.push(input.blockOutlook);
    return { ok: true, text: 'stop calling' };
  };

  await nuisanceOffer(contact, generateWarning);
  await handleCallEvent(call(contact, 'timeout'), noopActions);
  await handleCallEvent(call(contact, 'timeout'), noopActions);
  await handleCallEvent(call(contact, 'offer'), { ...noopActions, generateWarning });

  assert.deepEqual(flags, ['countdown', 'blocking']);
});
