import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyTailscaleWhoIs } from './tailscale-whois-auth.ts';

const ALLOWED = 'alice@github';

// A stand-in for tailscaled's local API: listens on a Unix socket like the
// real one, and lets each test control exactly what /localapi/v0/whois
// returns, regardless of the `addr` queried — this module's job is to
// react correctly to whatever tailscaled says, not to reimplement
// tailscaled's own connection tracking (that's the live-host check in
// docs/decisions.md, not something a unit test can cover).
async function startFakeTailscaled(handler) {
  const socketDir = mkdtempSync(join(tmpdir(), 'ts-whois-'));
  const socketPath = join(socketDir, 'tailscaled.sock');
  const server = createServer(handler);
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

function respondWithLogin(login) {
  return (req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ UserProfile: { LoginName: login } }));
  };
}

test('resolves true when whois returns the allowed login', async () => {
  const fake = await startFakeTailscaled(respondWithLogin(ALLOWED));
  try {
    const result = await verifyTailscaleWhoIs('127.0.0.1', 4321, ALLOWED, { socketPath: fake.socketPath });
    assert.equal(result, true);
  } finally {
    await fake.close();
  }
});

test('resolves false when whois returns a different login', async () => {
  const fake = await startFakeTailscaled(respondWithLogin('mallory@github'));
  try {
    const result = await verifyTailscaleWhoIs('127.0.0.1', 4321, ALLOWED, { socketPath: fake.socketPath });
    assert.equal(result, false);
  } finally {
    await fake.close();
  }
});

test('resolves false when whois has no UserProfile at all', async () => {
  const fake = await startFakeTailscaled((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({}));
  });
  try {
    const result = await verifyTailscaleWhoIs('127.0.0.1', 4321, ALLOWED, { socketPath: fake.socketPath });
    assert.equal(result, false);
  } finally {
    await fake.close();
  }
});

test('resolves false on a non-200 response, without throwing', async () => {
  const fake = await startFakeTailscaled((req, res) => {
    res.writeHead(400);
    res.end('no such connection');
  });
  try {
    const result = await verifyTailscaleWhoIs('127.0.0.1', 4321, ALLOWED, { socketPath: fake.socketPath });
    assert.equal(result, false);
  } finally {
    await fake.close();
  }
});

test('resolves false on a malformed JSON body, without throwing', async () => {
  const fake = await startFakeTailscaled((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('not json');
  });
  try {
    const result = await verifyTailscaleWhoIs('127.0.0.1', 4321, ALLOWED, { socketPath: fake.socketPath });
    assert.equal(result, false);
  } finally {
    await fake.close();
  }
});

test('resolves false when the socket is unreachable, without throwing', async () => {
  const socketDir = mkdtempSync(join(tmpdir(), 'ts-whois-'));
  const missingSocketPath = join(socketDir, 'no-such-tailscaled.sock');
  try {
    const result = await verifyTailscaleWhoIs('127.0.0.1', 4321, ALLOWED, { socketPath: missingSocketPath });
    assert.equal(result, false);
  } finally {
    rmSync(socketDir, { recursive: true, force: true });
  }
});

test('resolves false without making a request when the remote address or port is empty', async () => {
  const result = await verifyTailscaleWhoIs('', 0, ALLOWED, { socketPath: '/nonexistent/does-not-matter.sock' });
  assert.equal(result, false);
});
