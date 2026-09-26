import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createControlServer } from './control-server.js';

const ALLOWED = 'alice@github';
const TOKEN = 'test-control-token';

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
  const server = createControlServer({ manualOverride, allowedLogin: ALLOWED, controlToken: TOKEN });
  const port = await server.listen(0);
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await server.close();
  }
}

function authHeaders(extra = {}) {
  return { 'Tailscale-User-Login': ALLOWED, 'X-Control-Token': TOKEN, ...extra };
}

test('rejects a request with no Tailscale-User-Login header', async () => {
  await withServer(makeOverride(), async (base) => {
    const res = await fetch(`${base}/api/status`, { headers: { 'X-Control-Token': TOKEN } });
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

test('rejects a request with the right login but no control token (local forgery of the header alone)', async () => {
  await withServer(makeOverride(), async (base) => {
    const res = await fetch(`${base}/api/status`, { headers: { 'Tailscale-User-Login': ALLOWED } });
    assert.equal(res.status, 403);
  });
});

test('rejects a request with a mismatched control token', async () => {
  await withServer(makeOverride(), async (base) => {
    const res = await fetch(`${base}/api/status`, { headers: authHeaders({ 'X-Control-Token': 'wrong' }) });
    assert.equal(res.status, 403);
  });
});

test('accepts the control token via a query string on GET /', async () => {
  await withServer(makeOverride(), async (base) => {
    const res = await fetch(`${base}/?token=${TOKEN}`, { headers: { 'Tailscale-User-Login': ALLOWED } });
    assert.equal(res.status, 200);
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

test('POST /api/pause accepts a Content-Type with parameters (e.g. charset)', async () => {
  const override = makeOverride();
  await withServer(override, async (base) => {
    const res = await fetch(`${base}/api/pause`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json; charset=utf-8' }),
      body: '{}',
    });
    assert.equal(res.status, 200);
    assert.deepEqual(override.calls, ['pause']);
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

test('close() resolves promptly even with a request in flight', async () => {
  let releaseCommand;
  const held = new Promise((resolve) => (releaseCommand = resolve));
  const override = {
    isPaused: () => false,
    getStatus: () => ({ paused: false, strikeCount: 0, block: null }),
    runCommand: async () => {
      await held;
      return 'done';
    },
  };
  const server = createControlServer({ manualOverride: override, allowedLogin: ALLOWED, controlToken: TOKEN });
  const port = await server.listen(0);

  const inFlight = fetch(`http://127.0.0.1:${port}/api/pause`, {
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
