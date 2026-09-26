import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createControlServer } from './control-server.js';

const ALLOWED = 'alice@github';

function makeOverride() {
  let paused = false;
  let block = null;
  const calls = [];
  return {
    calls,
    isPaused: () => paused,
    getStatus: () => ({ paused, strikeCount: 2, block }),
    runCommand: async (command) => {
      calls.push(command);
      switch (command) {
        case 'pause':
          paused = true;
          return 'Moderation paused.';
        case 'resume':
          paused = false;
          return 'Moderation resumed.';
        case 'unblock':
          block = null;
          return 'Contact unblocked.';
        default:
          return null;
      }
    },
  };
}

async function withServer(manualOverride, run) {
  const server = createControlServer({ manualOverride, allowedLogin: ALLOWED });
  const port = await server.listen(0);
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await server.close();
  }
}

function authHeaders(extra = {}) {
  return { 'Tailscale-User-Login': ALLOWED, ...extra };
}

test('rejects a request with no Tailscale-User-Login header', async () => {
  await withServer(makeOverride(), async (base) => {
    const res = await fetch(`${base}/api/status`);
    assert.equal(res.status, 403);
  });
});

test('rejects a request with a mismatched login', async () => {
  await withServer(makeOverride(), async (base) => {
    const res = await fetch(`${base}/api/status`, {
      headers: authHeaders({ 'Tailscale-User-Login': 'mallory@github' }),
    });
    assert.equal(res.status, 403);
  });
});

test('GET /api/status returns the current structured status', async () => {
  await withServer(makeOverride(), async (base) => {
    const res = await fetch(`${base}/api/status`, { headers: authHeaders() });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { paused: false, strikeCount: 2, block: null });
  });
});

test('GET / serves the static control page', async () => {
  await withServer(makeOverride(), async (base) => {
    const res = await fetch(base, { headers: authHeaders() });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
    assert.match(await res.text(), /<html/i);
  });
});

test('POST /api/pause without JSON content-type is rejected (CSRF guard)', async () => {
  const override = makeOverride();
  await withServer(override, async (base) => {
    const res = await fetch(`${base}/api/pause`, { method: 'POST', headers: authHeaders() });
    assert.equal(res.status, 415);
    assert.deepEqual(override.calls, []);
  });
});

test('POST /api/pause runs the command and returns fresh status', async () => {
  const override = makeOverride();
  await withServer(override, async (base) => {
    const res = await fetch(`${base}/api/pause`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: '{}',
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.paused, true);
    assert.match(body.message, /paused/i);
    assert.deepEqual(override.calls, ['pause']);
  });
});

test('an unknown route returns 404', async () => {
  await withServer(makeOverride(), async (base) => {
    const res = await fetch(`${base}/nope`, { headers: authHeaders() });
    assert.equal(res.status, 404);
  });
});
