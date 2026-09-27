import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
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

function makeAuditLog(rows = []) {
  return {
    calls: [],
    getPage(filter) {
      this.calls.push(filter);
      let filtered = rows;
      if (filter.contactId) filtered = filtered.filter((r) => r.contact_id === filter.contactId);
      if (filter.action) filtered = filtered.filter((r) => r.action === filter.action);
      if (filter.search) filtered = filtered.filter((r) => r.message.toLowerCase().includes(filter.search.toLowerCase()));
      if (filter.before !== undefined) filtered = filtered.filter((r) => r.id < filter.before);
      return filtered.slice(0, filter.limit ?? 50);
    },
    getStats: () => ({ totalLogged: rows.length, totalFlaggedDeleted: 0, totalWarningsSent: 0, totalClassifierErrors: 0, byCategory: [] }),
  };
}

function makeBlocks(activeCount = 0) {
  return { countActive: () => activeCount };
}

async function withServer(
  {
    manualOverride = makeOverride(),
    contactDirectory = makeContactDirectory(),
    monitoredContacts = makeMonitoredContacts(),
    auditLog = makeAuditLog(),
    blocks = makeBlocks(),
    getSelfId = () => null,
    allowSelf = false,
  } = {},
  run,
) {
  const server = createControlServer({ manualOverride, contactDirectory, monitoredContacts, auditLog, blocks, allowedLogin: ALLOWED, getSelfId, allowSelf });
  const port = await server.listen(0);
  try {
    await run(`http://127.0.0.1:${port}`, { manualOverride, contactDirectory, monitoredContacts, auditLog, blocks });
  } finally {
    await server.close();
  }
}

function authHeaders(extra = {}) {
  return { 'Tailscale-User-Login': ALLOWED, ...extra };
}

test('GET /assets/* (the built frontend bundle) is served with no auth headers at all', async () => {
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

test('rejects a request with no Tailscale-User-Login header', async () => {
  await withServer({}, async (base) => {
    const res = await fetch(`${base}/api/roster`);
    assert.equal(res.status, 403);
  });
});

test('rejects a request with a mismatched login', async () => {
  await withServer({}, async (base) => {
    const res = await fetch(`${base}/api/roster`, { headers: authHeaders({ 'Tailscale-User-Login': 'mallory@github' }) });
    assert.equal(res.status, 403);
  });
});

test('rejects an empty Tailscale-User-Login header', async () => {
  await withServer({}, async (base) => {
    const res = await fetch(`${base}/api/roster`, { headers: { 'Tailscale-User-Login': '' } });
    assert.equal(res.status, 403);
  });
});

test('GET / serves the static control page with no query param or cookie needed', async () => {
  await withServer({}, async (base) => {
    const res = await fetch(base, { headers: authHeaders() });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
    assert.match(await res.text(), /<html/i);
  });
});

test('GET / sets no cookie — identity is re-verified on every request, nothing to persist', async () => {
  await withServer({}, async (base) => {
    const res = await fetch(base, { headers: authHeaders() });
    assert.equal(res.headers.get('set-cookie'), null);
  });
});

test('no response ever carries Access-Control-Allow-Origin, so a cross-origin preflight can never succeed', async () => {
  await withServer({}, async (base) => {
    const get = await fetch(base, { headers: authHeaders() });
    assert.equal(get.headers.get('access-control-allow-origin'), null);

    const post = await fetch(`${base}/api/roster`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
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
    const res = await fetch(`${base}/api/contacts`, { headers: authHeaders() });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(
      body.sort((a, b) => a.id.localeCompare(b.id)),
      [
        { id: 'alice@s.whatsapp.net', name: 'Alice', monitored: true, isSelf: false, allowSelf: false },
        { id: 'bob@s.whatsapp.net', name: 'Bob', monitored: false, isSelf: false, allowSelf: false },
      ],
    );
  });
});

test('GET /api/contacts marks the self contact via isSelf and reports the allowSelf policy', async () => {
  const contactDirectory = makeContactDirectory([
    { id: 'alice@s.whatsapp.net', name: 'Alice' },
    { id: 'me@s.whatsapp.net', name: 'Me' },
  ]);

  await withServer({ contactDirectory, getSelfId: () => 'me@s.whatsapp.net', allowSelf: true }, async (base) => {
    const res = await fetch(`${base}/api/contacts`, { headers: authHeaders() });
    const body = await res.json();
    assert.deepEqual(
      body.sort((a, b) => a.id.localeCompare(b.id)),
      [
        { id: 'alice@s.whatsapp.net', name: 'Alice', monitored: false, isSelf: false, allowSelf: true },
        { id: 'me@s.whatsapp.net', name: 'Me', monitored: false, isSelf: true, allowSelf: true },
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

test('GET /api/stats combines audit-log stats with the roster count and active block count', async () => {
  const monitoredContacts = makeMonitoredContacts([{ contactId: 'alice@s.whatsapp.net', escalationEnabled: true, addedAt: 1 }]);
  const auditLog = makeAuditLog([{ id: 1, contact_id: 'alice@s.whatsapp.net', action: 'delete+warn', message: 'bad' }]);
  const blocks = makeBlocks(2);

  await withServer({ monitoredContacts, auditLog, blocks }, async (base) => {
    const res = await fetch(`${base}/api/stats`, { headers: authHeaders() });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), {
      monitoredCount: 1,
      activeBlocks: 2,
      totalLogged: 1,
      totalFlaggedDeleted: 0,
      totalWarningsSent: 0,
      totalClassifierErrors: 0,
      byCategory: [],
    });
  });
});

test('GET /api/audit-log returns entries with the contact name resolved and a nextBefore cursor', async () => {
  const contactDirectory = makeContactDirectory([{ id: 'alice@s.whatsapp.net', name: 'Alice' }]);
  const auditLog = makeAuditLog([
    { id: 2, contact_id: 'alice@s.whatsapp.net', direction: 'them', message: 'bad message', classification_ok: 1, flagged: 1, category: 'harassment', reason: 'threat', error: null, action: 'delete+warn', created_at: 200 },
    { id: 1, contact_id: 'alice@s.whatsapp.net', direction: 'them', message: 'hey', classification_ok: 1, flagged: 0, category: 'none', reason: '', error: null, action: 'none', created_at: 100 },
  ]);

  await withServer({ contactDirectory, auditLog }, async (base) => {
    const res = await fetch(`${base}/api/audit-log?limit=1`, { headers: authHeaders() });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.entries, [
      {
        id: 2,
        contactId: 'alice@s.whatsapp.net',
        contactName: 'Alice',
        direction: 'them',
        message: 'bad message',
        classificationOk: true,
        flagged: true,
        category: 'harassment',
        reason: 'threat',
        error: null,
        action: 'delete+warn',
        createdAt: 200,
      },
    ]);
    assert.equal(body.nextBefore, 2);
  });
});

test('GET /api/audit-log forwards contactId/action/search filters and clamps an out-of-range limit', async () => {
  const auditLog = makeAuditLog([]);

  await withServer({ auditLog }, async (base) => {
    await fetch(`${base}/api/audit-log?contactId=${encodeURIComponent('alice@s.whatsapp.net')}&action=delete%2Bwarn&search=crypto&limit=99999`, {
      headers: authHeaders(),
    });
    assert.deepEqual(auditLog.calls, [{ contactId: 'alice@s.whatsapp.net', action: 'delete+warn', search: 'crypto', before: undefined, limit: 201 }]);
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

test('POST /api/roster rejects a group JID', async () => {
  await withServer({}, async (base, { monitoredContacts }) => {
    const res = await fetch(`${base}/api/roster`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ contactId: '1203630xxxx@g.us' }),
    });
    assert.equal(res.status, 400);
    assert.equal(monitoredContacts.isMonitored('1203630xxxx@g.us'), false);
  });
});

test('POST /api/roster rejects the self contact when TEST_ALLOW_SELF is not enabled', async () => {
  await withServer({ getSelfId: () => 'me@s.whatsapp.net', allowSelf: false }, async (base, { monitoredContacts }) => {
    const res = await fetch(`${base}/api/roster`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ contactId: 'me@s.whatsapp.net' }),
    });
    assert.equal(res.status, 400);
    assert.equal(monitoredContacts.isMonitored('me@s.whatsapp.net'), false);
  });
});

test('POST /api/roster allows the self contact when TEST_ALLOW_SELF is enabled', async () => {
  await withServer({ getSelfId: () => 'me@s.whatsapp.net', allowSelf: true }, async (base, { monitoredContacts }) => {
    const res = await fetch(`${base}/api/roster`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ contactId: 'me@s.whatsapp.net' }),
    });
    assert.equal(res.status, 201);
    assert.equal(monitoredContacts.isMonitored('me@s.whatsapp.net'), true);
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
  const monitoredContacts = makeMonitoredContacts([{ contactId: 'alice@s.whatsapp.net', escalationEnabled: true, addedAt: 1 }]);
  await withServer({ monitoredContacts }, async (base) => {
    const res = await fetch(`${base}/api/roster/${encodeURIComponent('alice@s.whatsapp.net')}/pause`, {
      method: 'POST',
      headers: authHeaders(),
    });
    assert.equal(res.status, 415);
  });
});

test('POST /api/roster/:contactId/pause|resume|unblock on an unmonitored contact returns 404', async () => {
  await withServer({}, async (base, { manualOverride }) => {
    const res = await fetch(`${base}/api/roster/${encodeURIComponent('nobody@s.whatsapp.net')}/unblock`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
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

test('a malformed percent-encoded path segment returns 400, not a 500', async () => {
  await withServer({}, async (base) => {
    const res = await fetch(`${base}/api/roster/%E0%A4%A/pause`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: '{}',
    });
    assert.equal(res.status, 400);
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
    auditLog: makeAuditLog(),
    blocks: makeBlocks(),
    allowedLogin: ALLOWED,
    getSelfId: () => null,
    allowSelf: false,
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
