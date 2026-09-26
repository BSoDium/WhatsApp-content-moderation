import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createServer as createFakeSocketServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createControlServer } from './control-server.ts';

const DIST_ASSETS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../web/dist/assets');

const ALLOWED = 'alice@github';

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
    get: (contactId) => roster.get(contactId),
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

// A stand-in for tailscaled's local API — see tailscale-whois-auth.test.ts
// for why a canned response (ignoring the queried `addr`) is enough here:
// this file's job is to verify control-server.ts wires verifyTailscaleWhoIs
// into the request pipeline correctly, not to reimplement tailscaled's own
// per-connection tracking.
function respondWithLogin(login) {
  return (req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ UserProfile: { LoginName: login } }));
  };
}

async function startFakeTailscaled(handler) {
  const socketDir = mkdtempSync(join(tmpdir(), 'ts-whois-'));
  const socketPath = join(socketDir, 'tailscaled.sock');
  const server = createFakeSocketServer(handler);
  await new Promise((resolve) => server.listen(socketPath, resolve));
  return {
    socketPath,
    close: () =>
      new Promise((resolve) => {
        server.close(() => {
          rmSync(socketDir, { recursive: true, force: true });
          resolve();
        });
      }),
  };
}

async function withServer(
  {
    manualOverride = makeOverride(),
    contactDirectory = makeContactDirectory(),
    monitoredContacts = makeMonitoredContacts(),
    whoIs = respondWithLogin(ALLOWED),
  } = {},
  run,
) {
  const fake = await startFakeTailscaled(whoIs);
  const server = createControlServer({
    manualOverride,
    contactDirectory,
    monitoredContacts,
    allowedLogin: ALLOWED,
    tailscaledSocket: fake.socketPath,
  });
  const port = await server.listen(0);
  try {
    await run(`http://127.0.0.1:${port}`, { manualOverride, contactDirectory, monitoredContacts });
  } finally {
    await server.close();
    await fake.close();
  }
}

test('GET /assets/* (the built frontend bundle) is served with no auth at all', async () => {
  const assetNames = readdirSync(DIST_ASSETS_DIR);
  const jsFile = assetNames.find((name) => name.endsWith('.js'));
  const cssFile = assetNames.find((name) => name.endsWith('.css'));

  await withServer({}, async (base) => {
    const css = await fetch(`${base}/assets/${cssFile}`);
    assert.equal(css.status, 200);
    assert.match(css.headers.get('content-type'), /text\/css/);

    const js = await fetch(`${base}/assets/${jsFile}`);
    assert.equal(js.status, 200);
    assert.match(js.headers.get('content-type'), /javascript/);
  });
});

test('rejects a request when whois reports a different login', async () => {
  await withServer({ whoIs: respondWithLogin('mallory@github') }, async (base) => {
    const res = await fetch(`${base}/api/roster`);
    assert.equal(res.status, 403);
  });
});

test('rejects a request when whois is unreachable (e.g. tailscaled not running or socket not mounted)', async () => {
  const socketDir = mkdtempSync(join(tmpdir(), 'ts-whois-'));
  try {
    const server = createControlServer({
      manualOverride: makeOverride(),
      contactDirectory: makeContactDirectory(),
      monitoredContacts: makeMonitoredContacts(),
      allowedLogin: ALLOWED,
      tailscaledSocket: join(socketDir, 'no-such-tailscaled.sock'),
    });
    const port = await server.listen(0);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/roster`);
      assert.equal(res.status, 403);
    } finally {
      await server.close();
    }
  } finally {
    rmSync(socketDir, { recursive: true, force: true });
  }
});

test('GET / serves the static control page with no query param or cookie needed', async () => {
  await withServer({}, async (base) => {
    const res = await fetch(base);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
    assert.match(await res.text(), /<html/i);
  });
});

test('GET / sets no cookie — identity is re-verified on every request, nothing to persist', async () => {
  await withServer({}, async (base) => {
    const res = await fetch(base);
    assert.equal(res.headers.get('set-cookie'), null);
  });
});

test('no response ever carries Access-Control-Allow-Origin, so a cross-origin preflight can never succeed', async () => {
  await withServer({}, async (base) => {
    const get = await fetch(base);
    assert.equal(get.headers.get('access-control-allow-origin'), null);

    const post = await fetch(`${base}/api/roster`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contactId: 'cors-check@s.whatsapp.net' }),
    });
    assert.equal(post.headers.get('access-control-allow-origin'), null);
  });
});

test('GET /api/contacts merges the directory with the monitored flag', async () => {
  const contactDirectory = makeContactDirectory([
    { id: 'alice@s.whatsapp.net', name: 'Alice' },
    { id: 'bob@s.whatsapp.net', name: 'Bob' },
  ]);
  const monitoredContacts = makeMonitoredContacts([{ contactId: 'alice@s.whatsapp.net', escalationEnabled: true, addedAt: 1 }]);

  await withServer({ contactDirectory, monitoredContacts }, async (base) => {
    const res = await fetch(`${base}/api/contacts`);
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
    const res = await fetch(`${base}/api/roster`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), [
      { id: 'alice@s.whatsapp.net', name: 'Alice', escalationEnabled: false, paused: false, strikeCount: 2, block: null },
    ]);
  });
});

test('POST /api/roster without JSON content-type is rejected (CSRF guard)', async () => {
  await withServer({}, async (base) => {
    const res = await fetch(`${base}/api/roster`, { method: 'POST', body: JSON.stringify({ contactId: 'x' }) });
    assert.equal(res.status, 415);
  });
});

test('POST /api/roster adds a contact and returns its roster entry', async () => {
  await withServer({}, async (base, { monitoredContacts }) => {
    const res = await fetch(`${base}/api/roster`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contactId: 'new@s.whatsapp.net' }),
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.id, 'new@s.whatsapp.net');
    assert.equal(monitoredContacts.isMonitored('new@s.whatsapp.net'), true);
  });
});

test('POST /api/roster rejects a group JID', async () => {
  await withServer({}, async (base, { monitoredContacts }) => {
    const res = await fetch(`${base}/api/roster`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contactId: '1203630xxxx@g.us' }),
    });
    assert.equal(res.status, 400);
    assert.equal(monitoredContacts.isMonitored('1203630xxxx@g.us'), false);
  });
});

test('POST /api/roster rejects a missing/empty contactId', async () => {
  await withServer({}, async (base) => {
    const res = await fetch(`${base}/api/roster`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
  });
});

test('POST /api/roster with malformed JSON returns 400', async () => {
  await withServer({}, async (base) => {
    const res = await fetch(`${base}/api/roster`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    });
    assert.equal(res.status, 400);
  });
});

test('DELETE /api/roster/:contactId removes a monitored contact, decoding the JID', async () => {
  const monitoredContacts = makeMonitoredContacts([{ contactId: 'gone@s.whatsapp.net', escalationEnabled: true, addedAt: 1 }]);
  await withServer({ monitoredContacts }, async (base) => {
    const res = await fetch(`${base}/api/roster/${encodeURIComponent('gone@s.whatsapp.net')}`, { method: 'DELETE' });
    assert.equal(res.status, 200);
    assert.equal(monitoredContacts.isMonitored('gone@s.whatsapp.net'), false);
  });
});

test('DELETE /api/roster/:contactId on an unmonitored contact returns 404', async () => {
  await withServer({}, async (base) => {
    const res = await fetch(`${base}/api/roster/${encodeURIComponent('nobody@s.whatsapp.net')}`, { method: 'DELETE' });
    assert.equal(res.status, 404);
  });
});

test('POST /api/roster/:contactId/pause|resume|unblock route to the right contact', async () => {
  const monitoredContacts = makeMonitoredContacts([{ contactId: 'alice@s.whatsapp.net', escalationEnabled: true, addedAt: 1 }]);
  await withServer({ monitoredContacts }, async (base, { manualOverride }) => {
    const res = await fetch(`${base}/api/roster/${encodeURIComponent('alice@s.whatsapp.net')}/pause`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.paused, true);
    assert.deepEqual(manualOverride.calls, [['alice@s.whatsapp.net', 'pause']]);
  });
});

test('POST /api/roster/:contactId/pause without JSON content-type is rejected', async () => {
  const monitoredContacts = makeMonitoredContacts([{ contactId: 'alice@s.whatsapp.net', escalationEnabled: true, addedAt: 1 }]);
  await withServer({ monitoredContacts }, async (base) => {
    const res = await fetch(`${base}/api/roster/${encodeURIComponent('alice@s.whatsapp.net')}/pause`, { method: 'POST' });
    assert.equal(res.status, 415);
  });
});

test('POST /api/roster/:contactId/pause|resume|unblock on an unmonitored contact returns 404', async () => {
  await withServer({}, async (base, { manualOverride }) => {
    const res = await fetch(`${base}/api/roster/${encodeURIComponent('nobody@s.whatsapp.net')}/unblock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.equal(res.status, 404);
    assert.deepEqual(manualOverride.calls, []);
  });
});

test('POST /api/roster/:contactId/escalation toggles the flag', async () => {
  const monitoredContacts = makeMonitoredContacts([{ contactId: 'alice@s.whatsapp.net', escalationEnabled: true, addedAt: 1 }]);
  await withServer({ monitoredContacts }, async (base) => {
    const res = await fetch(`${base}/api/roster/${encodeURIComponent('alice@s.whatsapp.net')}/escalation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: 'yes' }),
    });
    assert.equal(res.status, 400);
  });
});

test('POST /api/roster/:contactId/escalation on an unmonitored contact returns 404', async () => {
  await withServer({}, async (base) => {
    const res = await fetch(`${base}/api/roster/${encodeURIComponent('nobody@s.whatsapp.net')}/escalation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    });
    assert.equal(res.status, 404);
  });
});

test('a malformed percent-encoded path segment returns 400, not a 500', async () => {
  await withServer({}, async (base) => {
    const res = await fetch(`${base}/api/roster/%E0%A4%A/pause`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.equal(res.status, 400);
  });
});

test('an unknown nested route returns 404', async () => {
  await withServer({}, async (base) => {
    const res = await fetch(`${base}/api/roster/x/nonsense`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    assert.equal(res.status, 404);
  });
});

test('an unknown top-level route returns 404', async () => {
  await withServer({}, async (base) => {
    const res = await fetch(`${base}/nope`);
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
  const fake = await startFakeTailscaled(respondWithLogin(ALLOWED));
  const server = createControlServer({
    manualOverride,
    contactDirectory: makeContactDirectory(),
    monitoredContacts: makeMonitoredContacts([{ contactId: 'alice@s.whatsapp.net', escalationEnabled: true, addedAt: 1 }]),
    allowedLogin: ALLOWED,
    tailscaledSocket: fake.socketPath,
  });
  const port = await server.listen(0);

  const inFlight = fetch(`http://127.0.0.1:${port}/api/roster/${encodeURIComponent('alice@s.whatsapp.net')}/pause`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  }).catch(() => {});

  await new Promise((resolve) => setTimeout(resolve, 50));

  const start = Date.now();
  await server.close();
  assert.ok(Date.now() - start < 1000, 'close() should not wait for the in-flight request to finish');

  releaseCommand();
  await inFlight;
  await fake.close();
});
