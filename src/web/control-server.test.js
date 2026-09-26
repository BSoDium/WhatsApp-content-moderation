import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createControlServer } from './control-server.js';

const ALLOWED = 'alice@github';
const TOKEN = 'test-control-token';

function makeOverride() {
  const paused = new Map();
  const calls = [];
  return {
    calls,
    isPaused: (contactId) => paused.get(contactId) ?? false,
    getStatus: (contactId) => ({ paused: paused.get(contactId) ?? false, strikeCount: 2, block: null }),
    runCommand: async (contactId, command) => {
      calls.push([contactId, command]);
      switch (command) {
        case 'pause':
          paused.set(contactId, true);
          return 'Moderation paused.';
        case 'resume':
          paused.set(contactId, false);
          return 'Moderation resumed.';
        case 'unblock':
          return 'Contact unblocked.';
        default:
          return null;
      }
    },
  };
}

function makeContactDirectory(entries = []) {
  const byId = new Map(entries.map((e) => [e.id, e]));
  return {
    list: () => Array.from(byId.values()),
    get: (contactId) => byId.get(contactId) ?? { id: contactId, name: contactId },
  };
}

function makeMonitoredContacts(initial = []) {
  const roster = new Map(initial.map((row) => [row.contactId, row]));
  return {
    list: () => Array.from(roster.values()),
    isMonitored: (contactId) => roster.has(contactId),
    add: (contactId) => {
      if (!roster.has(contactId)) roster.set(contactId, { contactId, escalationEnabled: true, addedAt: Date.now() });
    },
    remove: (contactId) => roster.delete(contactId),
    setEscalationEnabled: (contactId, enabled) => {
      const row = roster.get(contactId);
      if (!row) return false;
      row.escalationEnabled = enabled;
      return true;
    },
  };
}

async function withServer({ manualOverride = makeOverride(), contactDirectory = makeContactDirectory(), monitoredContacts = makeMonitoredContacts() } = {}, run) {
  const server = createControlServer({ manualOverride, contactDirectory, monitoredContacts, allowedLogin: ALLOWED, controlToken: TOKEN });
  const port = await server.listen(0);
  try {
    await run(`http://127.0.0.1:${port}`, { manualOverride, contactDirectory, monitoredContacts });
  } finally {
    await server.close();
  }
}

function authHeaders(extra = {}) {
  return { 'Tailscale-User-Login': ALLOWED, 'X-Control-Token': TOKEN, ...extra };
}

test('GET /styles.css and GET /app.js are served with no auth headers at all', async () => {
  await withServer({}, async (base) => {
    const css = await fetch(`${base}/styles.css`);
    assert.equal(css.status, 200);
    assert.match(css.headers.get('content-type'), /text\/css/);

    const js = await fetch(`${base}/app.js`);
    assert.equal(js.status, 200);
    assert.match(js.headers.get('content-type'), /javascript/);
  });
});

test('rejects a request with no Tailscale-User-Login header', async () => {
  await withServer({}, async (base) => {
    const res = await fetch(`${base}/api/roster`, { headers: { 'X-Control-Token': TOKEN } });
    assert.equal(res.status, 403);
  });
});

test('rejects a request with a mismatched login', async () => {
  await withServer({}, async (base) => {
    const res = await fetch(`${base}/api/roster`, { headers: authHeaders({ 'Tailscale-User-Login': 'mallory@github' }) });
    assert.equal(res.status, 403);
  });
});

test('rejects a request with the right login but no control token (local forgery of the header alone)', async () => {
  await withServer({}, async (base) => {
    const res = await fetch(`${base}/api/roster`, { headers: { 'Tailscale-User-Login': ALLOWED } });
    assert.equal(res.status, 403);
  });
});

test('rejects a request with a mismatched control token', async () => {
  await withServer({}, async (base) => {
    const res = await fetch(`${base}/api/roster`, { headers: authHeaders({ 'X-Control-Token': 'wrong' }) });
    assert.equal(res.status, 403);
  });
});

test('accepts the control token via a query string on GET /', async () => {
  await withServer({}, async (base) => {
    const res = await fetch(`${base}/?token=${TOKEN}`, { headers: { 'Tailscale-User-Login': ALLOWED } });
    assert.equal(res.status, 200);
  });
});

test('GET / serves the static control page', async () => {
  await withServer({}, async (base) => {
    const res = await fetch(base, { headers: authHeaders() });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
    assert.match(await res.text(), /<html/i);
  });
});

test('GET /api/contacts merges the directory with the monitored flag', async () => {
  const contactDirectory = makeContactDirectory([
    { id: 'alice@s.whatsapp.net', name: 'Alice' },
    { id: 'bob@s.whatsapp.net', name: 'Bob' },
  ]);
  const monitoredContacts = makeMonitoredContacts([{ contactId: 'alice@s.whatsapp.net', escalationEnabled: true, addedAt: 1 }]);

  await withServer({ contactDirectory, monitoredContacts }, async (base) => {
    const res = await fetch(`${base}/api/contacts`, { headers: authHeaders() });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(
      body.sort((a, b) => a.id.localeCompare(b.id)),
      [
        { id: 'alice@s.whatsapp.net', name: 'Alice', monitored: true },
        { id: 'bob@s.whatsapp.net', name: 'Bob', monitored: false },
      ],
    );
  });
});

test('GET /api/roster returns one aggregate entry per monitored contact', async () => {
  const contactDirectory = makeContactDirectory([{ id: 'alice@s.whatsapp.net', name: 'Alice' }]);
  const monitoredContacts = makeMonitoredContacts([{ contactId: 'alice@s.whatsapp.net', escalationEnabled: false, addedAt: 1 }]);

  await withServer({ contactDirectory, monitoredContacts }, async (base) => {
    const res = await fetch(`${base}/api/roster`, { headers: authHeaders() });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), [
      { id: 'alice@s.whatsapp.net', name: 'Alice', escalationEnabled: false, paused: false, strikeCount: 2, block: null },
    ]);
  });
});

test('POST /api/roster without JSON content-type is rejected (CSRF guard)', async () => {
  await withServer({}, async (base) => {
    const res = await fetch(`${base}/api/roster`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ contactId: 'x' }) });
    assert.equal(res.status, 415);
  });
});

test('POST /api/roster adds a contact and returns its roster entry', async () => {
  await withServer({}, async (base, { monitoredContacts }) => {
    const res = await fetch(`${base}/api/roster`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ contactId: 'new@s.whatsapp.net' }),
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.id, 'new@s.whatsapp.net');
    assert.equal(monitoredContacts.isMonitored('new@s.whatsapp.net'), true);
  });
});

test('POST /api/roster rejects a missing/empty contactId', async () => {
  await withServer({}, async (base) => {
    const res = await fetch(`${base}/api/roster`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
  });
});

test('POST /api/roster with malformed JSON returns 400', async () => {
  await withServer({}, async (base) => {
    const res = await fetch(`${base}/api/roster`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: 'not json',
    });
    assert.equal(res.status, 400);
  });
});

test('DELETE /api/roster/:contactId removes a monitored contact, decoding the JID', async () => {
  const monitoredContacts = makeMonitoredContacts([{ contactId: 'gone@s.whatsapp.net', escalationEnabled: true, addedAt: 1 }]);
  await withServer({ monitoredContacts }, async (base) => {
    const res = await fetch(`${base}/api/roster/${encodeURIComponent('gone@s.whatsapp.net')}`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
    assert.equal(res.status, 200);
    assert.equal(monitoredContacts.isMonitored('gone@s.whatsapp.net'), false);
  });
});

test('DELETE /api/roster/:contactId on an unmonitored contact returns 404', async () => {
  await withServer({}, async (base) => {
    const res = await fetch(`${base}/api/roster/${encodeURIComponent('nobody@s.whatsapp.net')}`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
    assert.equal(res.status, 404);
  });
});

test('POST /api/roster/:contactId/pause|resume|unblock route to the right contact', async () => {
  const monitoredContacts = makeMonitoredContacts([{ contactId: 'alice@s.whatsapp.net', escalationEnabled: true, addedAt: 1 }]);
  await withServer({ monitoredContacts }, async (base, { manualOverride }) => {
    const res = await fetch(`${base}/api/roster/${encodeURIComponent('alice@s.whatsapp.net')}/pause`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: '{}',
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.paused, true);
    assert.deepEqual(manualOverride.calls, [['alice@s.whatsapp.net', 'pause']]);
  });
});

test('POST /api/roster/:contactId/pause without JSON content-type is rejected', async () => {
  await withServer({}, async (base) => {
    const res = await fetch(`${base}/api/roster/${encodeURIComponent('alice@s.whatsapp.net')}/pause`, {
      method: 'POST',
      headers: authHeaders(),
    });
    assert.equal(res.status, 415);
  });
});

test('POST /api/roster/:contactId/escalation toggles the flag', async () => {
  const monitoredContacts = makeMonitoredContacts([{ contactId: 'alice@s.whatsapp.net', escalationEnabled: true, addedAt: 1 }]);
  await withServer({ monitoredContacts }, async (base) => {
    const res = await fetch(`${base}/api/roster/${encodeURIComponent('alice@s.whatsapp.net')}/escalation`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ enabled: false }),
    });
    assert.equal(res.status, 200);
    assert.equal(monitoredContacts.list()[0].escalationEnabled, false);
  });
});

test('POST /api/roster/:contactId/escalation rejects a non-boolean enabled', async () => {
  await withServer({}, async (base) => {
    const res = await fetch(`${base}/api/roster/${encodeURIComponent('alice@s.whatsapp.net')}/escalation`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ enabled: 'yes' }),
    });
    assert.equal(res.status, 400);
  });
});

test('POST /api/roster/:contactId/escalation on an unmonitored contact returns 404', async () => {
  await withServer({}, async (base) => {
    const res = await fetch(`${base}/api/roster/${encodeURIComponent('nobody@s.whatsapp.net')}/escalation`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ enabled: false }),
    });
    assert.equal(res.status, 404);
  });
});

test('an unknown nested route returns 404', async () => {
  await withServer({}, async (base) => {
    const res = await fetch(`${base}/api/roster/x/nonsense`, { method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }) });
    assert.equal(res.status, 404);
  });
});

test('an unknown top-level route returns 404', async () => {
  await withServer({}, async (base) => {
    const res = await fetch(`${base}/nope`, { headers: authHeaders() });
    assert.equal(res.status, 404);
  });
});

test('close() resolves promptly even with a request in flight', async () => {
  let releaseCommand;
  const held = new Promise((resolve) => (releaseCommand = resolve));
  const manualOverride = {
    isPaused: () => false,
    getStatus: () => ({ paused: false, strikeCount: 0, block: null }),
    runCommand: async () => {
      await held;
      return 'done';
    },
  };
  const server = createControlServer({
    manualOverride,
    contactDirectory: makeContactDirectory(),
    monitoredContacts: makeMonitoredContacts([{ contactId: 'alice@s.whatsapp.net', escalationEnabled: true, addedAt: 1 }]),
    allowedLogin: ALLOWED,
    controlToken: TOKEN,
  });
  const port = await server.listen(0);

  const inFlight = fetch(`http://127.0.0.1:${port}/api/roster/${encodeURIComponent('alice@s.whatsapp.net')}/pause`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: '{}',
  }).catch(() => {});

  await new Promise((resolve) => setTimeout(resolve, 50));

  const start = Date.now();
  await server.close();
  assert.ok(Date.now() - start < 1000, 'close() should not wait for the in-flight request to finish');

  releaseCommand();
  await inFlight;
});
